// Função "etiqueta": compra e gera a etiqueta de envio no Melhor Envio para um pedido.
// Só a equipe (logada na Oficina) pode usar. O token fica no segredo MELHOR_ENVIO_TOKEN.
// Ações: saldo | cotar | comprar | atualizar
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const limite = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

class Falha extends Error {
  constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); }
}

// Fala com a API do Melhor Envio
async function me(metodo: string, caminho: string, corpo?: unknown) {
  const token = Deno.env.get("MELHOR_ENVIO_TOKEN");
  if (!token) throw new Falha(503, "O Melhor Envio ainda não foi ligado: falta o segredo MELHOR_ENVIO_TOKEN no Supabase.");
  const base = Deno.env.get("MELHOR_ENVIO_SANDBOX") === "1" ? "https://sandbox.melhorenvio.com.br" : "https://www.melhorenvio.com.br";
  const email = Deno.env.get("MELHOR_ENVIO_EMAIL") || "contato@hprprint3d";
  let r: Response;
  try {
    r = await fetch(base + caminho, {
      method: metodo,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": `HPR Print 3D (${email})`,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new Falha(502, "Não consegui falar com o Melhor Envio. Tente de novo em instantes.");
  }
  const texto = await r.text();
  let dados: any = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  if (!r.ok) {
    if (r.status === 401) throw new Falha(401, "O token do Melhor Envio está errado ou venceu. Gere outro no painel deles.");
    if (r.status === 403) throw new Falha(403, "O token do Melhor Envio não tem permissão para isso. Gere um token marcando as permissões de carrinho, compra, geração e impressão de etiquetas.");
    const erros = dados?.errors ? Object.values(dados.errors).flat().join(" ") : "";
    const msg = [dados?.message, dados?.error, erros].filter((x) => x && x !== "The given data was invalid.").join(" ");
    throw new Falha(422, msg || `O Melhor Envio recusou (erro ${r.status}).`, { detalhe: dados });
  }
  return dados;
}

const transportadoraDe = (empresa: string, codigo: string) => {
  if (/^ME/i.test(codigo)) return "outra";
  const e = empresa.toLowerCase();
  if (e.includes("correios")) return "correios";
  if (e.includes("jadlog")) return "jadlog";
  if (e.includes("loggi")) return "loggi";
  if (e.includes("j&t") || e.includes("jt ")) return "jt";
  return "outra";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Só a equipe
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quem } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const email = quem?.user?.email?.toLowerCase();
  if (!email) return resposta(401, { erro: "Entre na Oficina para gerar etiquetas." });
  const { data: equipe } = await admin.from("equipe").select("email").ilike("email", email).maybeSingle();
  if (!equipe) return resposta(403, { erro: "Só a equipe pode gerar etiquetas." });

  let corpo: Record<string, any>;
  try { corpo = await req.json(); } catch { return resposta(400, { erro: "corpo inválido" }); }

  try {
    if (corpo.acao === "saldo") {
      const d = await me("GET", "/api/v2/me/balance");
      return resposta(200, { saldo: Number(d?.balance ?? d?.saldo ?? 0), reservado: Number(d?.reserved ?? 0) });
    }

    // Dados do pedido e do remetente
    const { data: pedido } = await admin.from("pedidos").select("*").eq("id", String(corpo.pedido || "")).maybeSingle();
    if (!pedido) throw new Falha(404, "Pedido não encontrado. Salve o pedido antes de gerar a etiqueta.");
    const { data: aj } = await admin.from("ajustes").select("valor").eq("chave", "remetente").maybeSingle();
    const rem = (aj?.valor || {}) as Record<string, string>;
    const { data: site } = await admin.from("ajustes").select("valor").eq("chave", "site").maybeSingle();
    const cepOrigem = digitos(rem.cep) || digitos((site?.valor as any)?.frete?.cepOrigem);

    const volume = {
      height: Math.ceil(limite(corpo.volume?.altura, 2, 100, 12)),
      width: Math.ceil(limite(corpo.volume?.largura, 11, 100, 16)),
      length: Math.ceil(limite(corpo.volume?.comprimento, 16, 100, 20)),
      weight: Math.round(limite(corpo.volume?.peso, 10, 30000, 400)) / 1000,
    };
    const valorDeclarado = Math.round(limite(corpo.valor, 0, 10000, Number(pedido.valor) || 20) * 100) / 100;
    const cepDestino = digitos(pedido.cep);

    if (corpo.acao === "cotar") {
      if (cepOrigem.length !== 8) throw new Falha(400, "Falta o CEP do remetente (aba Loja → Frete).");
      if (cepDestino.length !== 8) throw new Falha(400, "O pedido está sem CEP do cliente.");
      const d = await me("POST", "/api/v2/me/shipment/calculate", {
        from: { postal_code: cepOrigem }, to: { postal_code: cepDestino },
        volumes: [volume], options: { insurance_value: valorDeclarado, receipt: false, own_hand: false },
      });
      const opcoes = (Array.isArray(d) ? d : [])
        .filter((s: any) => !s.error && Number(s.custom_price ?? s.price) > 0)
        .map((s: any) => ({
          servico: s.id, nome: String(s.name || ""), empresa: String(s.company?.name || ""),
          valor: Math.round(Number(s.custom_price ?? s.price) * 100) / 100,
          prazoMin: Number(s.custom_delivery_range?.min ?? s.delivery_range?.min ?? s.custom_delivery_time ?? s.delivery_time) || null,
          prazoMax: Number(s.custom_delivery_range?.max ?? s.delivery_range?.max ?? s.custom_delivery_time ?? s.delivery_time) || null,
        }))
        .sort((a: any, b: any) => a.valor - b.valor);
      return resposta(200, { opcoes });
    }

    const salvarEtiqueta = async (et: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      await admin.from("pedidos").update({ etiqueta: et, atualizado_em: new Date().toISOString(), ...extra }).eq("id", pedido.id);
    };

    // Imprimir + rastreio (usado ao terminar a compra e ao "atualizar")
    const finalizar = async (et: Record<string, any>) => {
      try {
        const p = await me("POST", "/api/v2/me/shipment/print", { mode: "public", orders: [et.id] });
        const url = typeof p === "string" ? p : p?.url || Object.values(p || {}).find((v) => typeof v === "string" && /^https?:/.test(v as string));
        if (url) et.url = url;
      } catch (e) { et.erro_impressao = (e as Error).message; }
      try {
        const t = await me("POST", "/api/v2/me/shipment/tracking", { orders: [et.id] });
        const info = t?.[et.id] || t || {};
        const codigo = String(info.tracking || info.melhorenvio_tracking || "");
        if (codigo) et.rastreio = codigo;
        if (info.status) et.status = info.status;
        if (info.protocol) et.protocolo = info.protocol;
      } catch { /* o código pode demorar alguns minutos para sair */ }
      const extra: Record<string, unknown> = {};
      if (et.rastreio) {
        extra.rastreio = et.rastreio;
        extra.transportadora = transportadoraDe(String(et.empresa || ""), String(et.rastreio));
      }
      if (et.envio_texto && !pedido.envio) extra.envio = et.envio_texto;
      await salvarEtiqueta(et, extra);
      return et;
    };

    if (corpo.acao === "atualizar") {
      const et = (pedido.etiqueta || {}) as Record<string, any>;
      if (!et.id) throw new Falha(400, "Esse pedido ainda não tem etiqueta.");
      if (!et.gerada) {
        // Compra começou mas não terminou: tenta concluir
        if (!et.paga) { try { await me("POST", "/api/v2/me/shipment/checkout", { orders: [et.id] }); } catch (e) { if (!/pag/i.test((e as Error).message)) throw e; } et.paga = true; await salvarEtiqueta(et); }
        await me("POST", "/api/v2/me/shipment/generate", { orders: [et.id] });
        et.gerada = true;
      }
      return resposta(200, { etiqueta: await finalizar(et) });
    }

    if (corpo.acao === "comprar") {
      if ((pedido.etiqueta as any)?.gerada) throw new Falha(409, "Esse pedido já tem etiqueta gerada. Use \"Atualizar\" para ver o link e o rastreio.");
      const faltaRem = [["nome", "nome"], ["cpf", "CPF"], ["telefone", "telefone"], ["endereco", "rua"], ["numero", "número"], ["bairro", "bairro"], ["cidade", "cidade"], ["uf", "UF"]]
        .filter(([k]) => !String(rem[k] || "").trim()).map(([, n]) => n);
      if (cepOrigem.length !== 8) faltaRem.push("CEP");
      if (faltaRem.length) throw new Falha(400, `Complete o remetente na aba Loja → Frete: falta ${faltaRem.join(", ")}.`);
      const faltaDest = [[pedido.cliente, "nome do cliente"], [cepDestino.length === 8, "CEP"], [pedido.endereco, "rua"], [pedido.numero, "número"]]
        .filter(([v]) => !v).map(([, n]) => n);
      if (faltaDest.length) throw new Falha(400, `Complete o endereço do pedido: falta ${faltaDest.join(", ")}.`);
      const servico = Number(corpo.servico);
      if (!(servico > 0)) throw new Falha(400, "Escolha a forma de envio.");

      // Endereço de destino: cidade e UF pelo CEP se faltarem
      let cidade = String(pedido.cidade || "").split("/")[0].split(",").pop()?.trim() || "";
      let uf = String(pedido.uf || "");
      if (!uf || !cidade) {
        try {
          const v = await (await fetch(`https://viacep.com.br/ws/${cepDestino}/json/`)).json();
          cidade = v.localidade || cidade; uf = v.uf || uf;
        } catch { /* segue */ }
      }

      const carrinho = await me("POST", "/api/v2/me/cart", {
        service: servico,
        from: {
          name: rem.nome, phone: digitos(rem.telefone), email: rem.email || email, document: digitos(rem.cpf),
          address: rem.endereco, number: rem.numero, complement: rem.complemento || "", district: rem.bairro,
          city: rem.cidade, state_abbr: String(rem.uf).toUpperCase(), postal_code: cepOrigem, country_id: "BR",
        },
        to: {
          name: pedido.cliente, phone: digitos(pedido.telefone), email: pedido.email || undefined,
          document: digitos(pedido.documento) || undefined,
          address: pedido.endereco, number: pedido.numero, complement: pedido.complemento || "", district: pedido.bairro || "",
          city: cidade, state_abbr: uf.toUpperCase(), postal_code: cepDestino, country_id: "BR",
        },
        products: [{ name: String(pedido.peca || "Peça impressa em 3D").slice(0, 100), quantity: Number(pedido.quantidade) || 1, unitary_value: Math.round(valorDeclarado / (Number(pedido.quantidade) || 1) * 100) / 100 }],
        volumes: [volume],
        options: {
          insurance_value: valorDeclarado, receipt: false, own_hand: false, reverse: false, non_commercial: true,
          platform: "HPR Print 3D", tags: [{ tag: pedido.id, url: null }],
        },
      });
      const id = carrinho?.id;
      if (!id) throw new Falha(502, "O Melhor Envio não devolveu o número da etiqueta.");
      const et: Record<string, any> = {
        id, servico, empresa: String(corpo.empresa || ""), nome_servico: String(corpo.nome || ""),
        valor: Number(carrinho.price ?? corpo.preco ?? 0), volume, criada_em: new Date().toISOString(),
        envio_texto: [corpo.nome, corpo.empresa].filter(Boolean).join(" (") + (corpo.empresa ? ")" : ""),
      };
      await salvarEtiqueta(et);

      try {
        await me("POST", "/api/v2/me/shipment/checkout", { orders: [id] });
      } catch (e) {
        throw new Falha(402, "A etiqueta foi para o carrinho do Melhor Envio, mas não deu para pagar: " + (e as Error).message +
          " Coloque saldo no Melhor Envio e toque em \"Concluir etiqueta\".", { etiqueta: et });
      }
      et.paga = true;
      await salvarEtiqueta(et);
      await me("POST", "/api/v2/me/shipment/generate", { orders: [id] });
      et.gerada = true;
      return resposta(200, { etiqueta: await finalizar(et) });
    }

    return resposta(400, { erro: "ação desconhecida" });
  } catch (e) {
    if (e instanceof Falha) return resposta(e.status, { erro: e.message, ...e.extra });
    return resposta(500, { erro: "Erro inesperado: " + (e as Error).message });
  }
});
