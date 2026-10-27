// Função "ia": escreve a descrição da peça sem usar IA paga. Só a equipe (logada na Oficina) pode usar.
// Ordem: 1) a IA do PC da loja (Ollama atrás do proxy LiteLLM, por um túnel); 2) modelos gratuitos do OpenRouter.
// Segredos (Supabase > Edge Functions > Secrets), todos opcionais:
//   IA_PC_URL            endereço do proxy do PC, terminando em /v1 (ex.: https://ia.exemplo.com.br/v1)
//   IA_PC_KEY            chave do proxy do PC
//   IA_PC_MODELO         modelo de texto no proxy (padrão: free-local)
//   IA_PC_MODELO_VISAO   modelo que enxerga fotos no PC (sem ele, o PC recebe só texto)
//   OPENROUTER_API_KEY   chave do OpenRouter (modelos ":free" não cobram)
//   IA_NUVEM_MODELOS     lista de modelos do OpenRouter separados por vírgula (sem ela, escolhe os gratuitos sozinha)
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SISTEMA =
  "Você escreve descrições curtas para a vitrine de uma pequena loja brasileira de peças impressas em 3D, a HPR Print 3D. " +
  "Escreva em português do Brasil, em 2 a 4 frases, com no máximo 450 caracteres. A primeira frase deve resumir a peça sozinha, porque é a que aparece no card da vitrine. Tom simples e acolhedor, falando com o cliente. " +
  "Diga o que é a peça e para que serve ou por que é legal. Não invente medidas, materiais, cores ou preço. Sem emojis, sem hashtags, sem aspas. " +
  "Responda só com a descrição.";

type Msg = { role: string; content: unknown };
type Tentativa = { via: string; modelo: string; erro: string };

async function conversar(base: string, chave: string, modelo: string, mensagens: Msg[], ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(chave ? { Authorization: `Bearer ${chave}` } : {}) },
      body: JSON.stringify({ model: modelo, messages: mensagens, max_tokens: 700, temperature: 0.7 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || j?.detail || `erro ${r.status}`);
    return String(j.choices?.[0]?.message?.content || "");
  } finally { clearTimeout(t); }
}

const limpar = (t: string) =>
  t.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^["“'`]+|["”'`]+$/g, "").replace(/\s+\n/g, "\n").slice(0, 1000);

// Modelos gratuitos do OpenRouter, escolhidos na hora (os nomes mudam com o tempo)
let cacheModelos: { quando: number; lista: any[] } | null = null;
async function modelosGratis(comFoto: boolean): Promise<string[]> {
  const fixos = (Deno.env.get("IA_NUVEM_MODELOS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fixos.length) return fixos;
  if (!cacheModelos || Date.now() - cacheModelos.quando > 10 * 60_000) {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    const j = await r.json();
    cacheModelos = { quando: Date.now(), lista: j.data || [] };
  }
  return cacheModelos.lista
    .filter((m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
    .filter((m) => (m.architecture?.output_modalities || ["text"]).join() === "text")
    .filter((m) => !comFoto || (m.architecture?.input_modalities || []).includes("image"))
    .filter((m) => !/coder|thinking|reason|r1\b|guard|embed|moderation|vision-only/i.test(m.id))
    .sort((a, b) => (/gemma|llama|qwen|mistral/i.test(b.id) ? 1 : 0) - (/gemma|llama|qwen|mistral/i.test(a.id) ? 1 : 0) || (b.context_length || 0) - (a.context_length || 0))
    .slice(0, 4)
    .map((m) => m.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quem } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const email = quem?.user?.email?.toLowerCase();
  if (!email) return resposta(401, { erro: "Entre na Oficina para usar a IA." });
  const { data: equipe } = await admin.from("equipe").select("email").ilike("email", email).maybeSingle();
  if (!equipe) return resposta(403, { erro: "Só a equipe pode usar a IA." });

  let c: any;
  try { c = await req.json(); } catch { return resposta(400, { erro: "corpo inválido" }); }

  const urlPc = Deno.env.get("IA_PC_URL") || "";
  const chavePc = Deno.env.get("IA_PC_KEY") || "";
  const chaveNuvem = Deno.env.get("OPENROUTER_API_KEY") || "";

  if (c.acao === "status") {
    let pc = "não configurado";
    if (urlPc) {
      try {
        const r = await fetch(`${urlPc.replace(/\/+$/, "")}/models`, { headers: chavePc ? { Authorization: `Bearer ${chavePc}` } : {}, signal: AbortSignal.timeout(6000) });
        pc = r.ok ? "no ar" : `respondeu ${r.status}`;
      } catch { pc = "desligado ou sem rede"; }
    }
    return resposta(200, { pc, nuvem: chaveNuvem ? "configurada" : "sem chave" });
  }

  if (c.acao !== "descricao") return resposta(400, { erro: "ação desconhecida" });
  const nome = String(c.nome || "").trim().slice(0, 120);
  if (!nome) return resposta(400, { erro: "Falta o nome da peça." });

  const linhas = [`Peça: ${nome}`];
  if (c.categoria) linhas.push(`Categoria: ${String(c.categoria).slice(0, 60)}`);
  if (c.material) linhas.push(`Material: ${String(c.material).slice(0, 40)}`);
  if (Array.isArray(c.kit) && c.kit.length) linhas.push(`É um kit com: ${c.kit.map((k: any) => String(k).slice(0, 60)).slice(0, 12).join(", ")}`);
  if (c.ideia) linhas.push(`Ideia atual da descrição: ${String(c.ideia).slice(0, 600)}`);
  const texto = linhas.join("\n");
  const fotos: string[] = (Array.isArray(c.fotos) ? c.fotos : []).filter((u: unknown) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 2);
  const comFotos = (modelo: string): Msg[] => [
    { role: "system", content: SISTEMA },
    { role: "user", content: [{ type: "text", text: texto + "\nUse as fotos para entender a peça." }, ...fotos.map((url) => ({ type: "image_url", image_url: { url } }))] },
  ];
  const soTexto: Msg[] = [{ role: "system", content: SISTEMA }, { role: "user", content: texto }];

  const tentativas: Tentativa[] = [];
  const tentar = async (via: string, base: string, chave: string, modelo: string, visao: boolean, ms: number) => {
    try {
      const t = limpar(await conversar(base, chave, modelo, visao && fotos.length ? comFotos(modelo) : soTexto, ms));
      if (t.length < 20) throw new Error("resposta vazia");
      return resposta(200, { texto: t, via, modelo, tentativas });
    } catch (e) {
      tentativas.push({ via, modelo, erro: String((e as Error).message || e).slice(0, 160) });
      return null;
    }
  };

  // 1) PC da loja
  if (urlPc) {
    const visao = Deno.env.get("IA_PC_MODELO_VISAO");
    const ok = (fotos.length && visao ? await tentar("pc", urlPc, chavePc, visao, true, 60_000) : null) ||
      await tentar("pc", urlPc, chavePc, Deno.env.get("IA_PC_MODELO") || "free-local", false, 60_000);
    if (ok) return ok;
  }
  // 2) Nuvem gratuita
  if (chaveNuvem) {
    // Com fotos, primeiro os que enxergam; se todos falharem, os só de texto
    const rodadas = fotos.length ? [true, false] : [false];
    const jaTentados = new Set<string>();
    for (const enxerga of rodadas) {
      let modelos: string[] = [];
      try { modelos = await modelosGratis(enxerga); } catch (e) { tentativas.push({ via: "nuvem", modelo: "lista", erro: String((e as Error).message) }); }
      for (const m of modelos) {
        if (jaTentados.has(m + enxerga)) continue;
        jaTentados.add(m + enxerga);
        const ok = await tentar("nuvem", "https://openrouter.ai/api/v1", chaveNuvem, m, enxerga, 30_000);
        if (ok) return ok;
      }
    }
  }
  return resposta(503, {
    erro: !urlPc && !chaveNuvem ? "A IA ainda não foi configurada (faltam os segredos IA_PC_URL e/ou OPENROUTER_API_KEY no Supabase)." : "Nenhuma IA respondeu agora (PC desligado e a nuvem gratuita ocupada ou sem limite).",
    tentativas,
  });
});
