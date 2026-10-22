// Simulador de frete: usado no formulário de pedido (vitrine) e na aba Loja (Oficina).
// Dois jeitos de calcular:
// 1. Tabela por região, com os valores que a loja define na aba Loja (funciona sempre);
// 2. Preço real do Melhor Envio (Correios, Jadlog, Loggi...), pela função "frete" do Supabase,
//    que guarda o token em segredo. Se ela falhar, o site volta para a tabela.
(function (raiz) {
  const REGIOES = [
    { id: "DF", nome: "DF e Goiás", ufs: ["DF", "GO"] },
    { id: "CO", nome: "Mato Grosso e MS", ufs: ["MT", "MS"] },
    { id: "SE", nome: "Sudeste", ufs: ["SP", "RJ", "MG", "ES"] },
    { id: "S", nome: "Sul", ufs: ["PR", "SC", "RS"] },
    { id: "NE", nome: "Nordeste", ufs: ["BA", "SE", "AL", "PE", "PB", "RN", "CE", "PI", "MA"] },
    { id: "N", nome: "Norte", ufs: ["AM", "PA", "AC", "RO", "RR", "AP", "TO"] },
  ];
  const PADRAO = {
    cepOrigem: "",
    ufsLocal: "DF, GO",
    retirada: { ativo: true, texto: "Retirar com a gente" },
    local: { ativo: false, valor: "", prazo: "", texto: "Entrega em mãos (motoboy)" },
    tabela: REGIOES.map((r) => ({ id: r.id, valor: "", prazo: "" })),
    pacote: { largura: 16, altura: 12, comprimento: 20, peso: 300 },
    folgaPeso: 100, // gramas somadas sempre (embalagem, fita, papel): melhor sobrar que faltar
    folgaCm: 10,    // centímetros somados em cada medida da peça (espaço da embalagem)
    real: false,
  };
  const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
  const soDigitos = (t) => String(t || "").replace(/\D/g, "");
  const formatarCep = (c) => { const d = soDigitos(c); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
  const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function config(site) {
    const f = site?.frete || {};
    const tabela = REGIOES.map((r) => ({ id: r.id, valor: "", prazo: "", ...(f.tabela || []).find((t) => t.id === r.id) }));
    return {
      ...PADRAO, ...f,
      ufsLocal: /^\s*DF\s*$/i.test(f.ufsLocal || "") ? PADRAO.ufsLocal : f.ufsLocal ?? PADRAO.ufsLocal,
      retirada: { ...PADRAO.retirada, ...f.retirada },
      local: { ...PADRAO.local, ...f.local },
      pacote: { ...PADRAO.pacote, ...f.pacote },
      folgaPeso: f.folgaPeso === "" || f.folgaPeso == null || !(num(f.folgaPeso) >= 0) ? PADRAO.folgaPeso : num(f.folgaPeso),
      folgaCm: f.folgaCm === "" || f.folgaCm == null || !(num(f.folgaCm) >= 0) ? PADRAO.folgaCm : num(f.folgaCm),
      tabela,
    };
  }
  // Quem salvou só "DF" antes da mudança passa a atender GO também (a loja fica no entorno do DF)
  const ufsLocal = (cfg) => String(/^\s*DF\s*$/i.test(cfg.ufsLocal || "") ? PADRAO.ufsLocal : cfg.ufsLocal || "").toUpperCase().split(/[^A-Z]+/).filter(Boolean);

  // Endereço pelo CEP (ViaCEP, gratuito)
  async function buscarCep(cep) {
    const d = soDigitos(cep);
    if (d.length !== 8) throw new Error("cep");
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (!r.ok || j.erro) throw new Error("cep");
    return { cep: formatarCep(d), uf: j.uf, cidade: j.localidade, bairro: j.bairro || "", rua: j.logradouro || "" };
  }

  const textoPrazo = (min, max) => {
    min = Math.round(num(min)); max = Math.round(num(max));
    if (!(min > 0) && !(max > 0)) return "";
    if (min > 0 && max > 0 && max !== min) return `${min} a ${max} dias úteis`;
    const d = max > 0 ? max : min;
    return d > 1 ? `até ${d} dias úteis` : "em 1 dia útil";
  };

  // Retirada e entrega local (só para quem está nos estados atendidos em mãos)
  function opcoesLocais(cfg, end) {
    const ops = [];
    const perto = !ufsLocal(cfg).length || ufsLocal(cfg).includes(end.uf);
    if (!perto) return ops;
    if (cfg.retirada.ativo) ops.push({ id: "retirada", nome: cfg.retirada.texto || "Retirar com a gente", valor: 0, prazo: "combinamos pelo WhatsApp" });
    if (cfg.local.ativo && num(cfg.local.valor) >= 0 && cfg.local.valor !== "")
      ops.push({ id: "local", nome: cfg.local.texto || "Entrega em mãos", valor: num(cfg.local.valor), prazo: cfg.local.prazo ? textoPrazo(0, cfg.local.prazo) : "combinamos pelo WhatsApp" });
    return ops;
  }

  // Estimativa pela tabela da loja
  function opcoesTabela(cfg, end) {
    const reg = REGIOES.find((r) => r.ufs.includes(end.uf));
    const linha = reg && cfg.tabela.find((t) => t.id === reg.id);
    if (!linha || linha.valor === "" || !(num(linha.valor) >= 0)) return [];
    return [{ id: "tabela-" + reg.id, nome: "Envio pelos Correios", valor: num(linha.valor), prazo: textoPrazo(0, linha.prazo), estimado: true }];
  }

  // Caixa do pedido (um volume só):
  // - peça com medidas no catálogo: medidas + folga (padrão 10 cm) em cada medida; com mais de 1 unidade,
  //   empilha pela menor medida; peso = peso da peça × quantidade + folga de peso;
  // - peça sem medidas: caixa padrão da aba Loja (peso × quantidade + folga de peso).
  // Respeita o mínimo dos Correios (16 × 11 × 2 cm).
  function caixa(cfg, peca, quantidade) {
    const c = peca?.caracteristicas || {};
    const p = cfg.pacote;
    const qtd = Math.max(1, Math.min(50, Math.round(num(quantidade)) || 1));
    const folga = num(cfg.folgaCm) >= 0 ? num(cfg.folgaCm) : 10;
    const temMedidas = num(c.largura) > 0 && num(c.altura) > 0;
    let medidas;
    if (temMedidas) {
      const m = [num(c.largura), num(c.altura), num(c.profundidade) > 0 ? num(c.profundidade) : num(c.largura)].sort((a, b) => a - b);
      m[0] = m[0] * qtd; // empilha as unidades pela menor medida
      medidas = m.map((x) => x + folga);
    } else {
      medidas = [num(p.altura), num(p.largura), num(p.comprimento)].map((x) => (x > 0 ? x : 12));
      if (qtd > 1) medidas[0] = medidas[0] * Math.min(qtd, 4);
    }
    const [altura, largura, comprimento] = medidas.sort((a, b) => a - b);
    const pesoBase = num(c.peso) > 0 ? num(c.peso) * qtd : (num(p.peso) > 0 ? num(p.peso) : 300) * qtd;
    return {
      altura: Math.min(100, Math.max(2, Math.ceil(altura))),
      largura: Math.min(100, Math.max(11, Math.ceil(largura))),
      comprimento: Math.min(100, Math.max(16, Math.ceil(comprimento))),
      peso: Math.round(pesoBase + (num(cfg.folgaPeso) >= 0 ? num(cfg.folgaPeso) : 100)),
      valor: Math.max(20, (num(peca?.preco) || 0) * qtd),
      origem: temMedidas ? "peca" : "padrao",
    };
  }
  // Carrinho com várias peças numa caixa só: empilha as alturas, usa a maior largura e o maior comprimento
  // e soma os pesos (a folga de peso entra uma vez só). `lista`: [{ peca, quantidade }]
  function caixaVarios(cfg, lista) {
    const cx = lista.map(({ peca, quantidade }) => caixa(cfg, peca, quantidade));
    if (cx.length === 1) return cx[0];
    const folga = num(cfg.folgaPeso) >= 0 ? num(cfg.folgaPeso) : 100;
    return {
      altura: Math.min(100, cx.reduce((s, c) => s + c.altura, 0)),
      largura: Math.max(...cx.map((c) => c.largura)),
      comprimento: Math.max(...cx.map((c) => c.comprimento)),
      peso: Math.round(cx.reduce((s, c) => s + c.peso, 0) - folga * (cx.length - 1)),
      valor: cx.reduce((s, c) => s + c.valor, 0),
      origem: cx.every((c) => c.origem === "peca") ? "peca" : "padrao",
    };
  }
  // Formato que o Melhor Envio espera (um produto = a caixa inteira)
  function produtos(cfg, peca, quantidade, lista) {
    const cx = lista?.length > 1 ? caixaVarios(cfg, lista) : caixa(cfg, peca, quantidade);
    return [{ id: peca?.id || "pedido", width: cx.largura, height: cx.altura, length: cx.comprimento, weight: cx.peso / 1000, insurance_value: cx.valor, quantity: 1 }];
  }

  // Preço real pelo Melhor Envio (função "frete" no Supabase)
  async function cotarReal(sb, cfg, cepDestino, itens) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(`${sb.url}/functions/v1/frete`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", apikey: sb.chave },
        body: JSON.stringify({ origem: soDigitos(cfg.cepOrigem), destino: soDigitos(cepDestino), produtos: itens }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.opcoes)) throw new Error(j.erro || "frete " + r.status);
      return j.opcoes.map((o) => ({
        id: "me-" + o.id, servico: o.id, empresa: o.empresa, nome: o.empresa && !o.nome.includes(o.empresa) ? `${o.nome} (${o.empresa})` : o.nome,
        valor: num(o.valor), prazo: textoPrazo(o.prazoMin, o.prazoMax),
      }));
    } finally { clearTimeout(t); }
  }

  // Tudo junto: endereço + opções. Nunca joga erro por causa do Melhor Envio.
  async function simular({ sb, site, cep, peca, quantidade, lista }) {
    const cfg = config(site);
    const end = await buscarCep(cep);
    let envio = [];
    let fonte = "tabela";
    if (cfg.real && sb?.url && soDigitos(cfg.cepOrigem).length === 8) {
      try { envio = await cotarReal(sb, cfg, end.cep, produtos(cfg, peca, quantidade, lista)); fonte = "real"; } catch { envio = []; }
    }
    if (!envio.length) { envio = opcoesTabela(cfg, end); fonte = "tabela"; }
    return { endereco: end, fonte, opcoes: [...opcoesLocais(cfg, end), ...envio] };
  }

  const descreverOpcao = (o) => `${o.nome} – ${o.valor > 0 ? brl(o.valor) : "grátis"}${o.prazo ? `, ${o.prazo}` : ""}`;

  raiz.HPR_FRETE = { REGIOES, PADRAO, config, buscarCep, simular, caixa, caixaVarios, produtos, cotarReal, formatarCep, textoPrazo, descreverOpcao, num };
})(window);
