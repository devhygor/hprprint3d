// Motor de precificação — usado pela área interna. Sem dependências; também roda no Node para testes.
(function (raiz) {
  const CONFIG_PADRAO = {
    filamento: { precoRolo: 100, pesoRolo: 1000 },
    impressora: { modelo: "Bambu Lab A1", consumoKw: 0.12, tarifaKwh: 0.95, desgasteHora: 0.8 },
    falhaPct: 10,
    trabalho: { valorHora: 25, preparoHoras: 0.25 },
    embalagemPeca: 2,
    margemPct: 30,
    impostoPct: 0,
    arredondamento: "90", // "90" -> ,90 | "99" -> ,99 | "5" -> múltiplo de 5 | "nenhum"
    canais: {
      direta: { nome: "Venda direta (Pix)", faixas: [{ ate: null, comissaoPct: 0, fixo: 0 }], freteVendedor: 0 },
      shopee: {
        nome: "Shopee",
        faixas: [
          { ate: 7.99, comissaoPct: 50, fixo: 0 },
          { ate: 79.99, comissaoPct: 20, fixo: 4 },
          { ate: 99.99, comissaoPct: 14, fixo: 16 },
          { ate: 199.99, comissaoPct: 14, fixo: 20 },
          { ate: null, comissaoPct: 14, fixo: 26 },
        ],
        freteVendedor: 0,
      },
      mercadolivre: {
        nome: "Mercado Livre (clássico)",
        faixas: [
          { ate: 78.99, comissaoPct: 12, fixo: 6.5 },
          { ate: null, comissaoPct: 12, fixo: 0 },
        ],
        freteVendedor: 0,
        freteAcimaDe: 79,
        freteValor: 20,
      },
    },
  };

  const num = (v, p = 0) => {
    const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v);
    return Number.isFinite(n) ? n : p;
  };

  function mesclar(base, extra) {
    if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
    if (typeof base !== "object" || base === null) return extra === undefined ? base : extra;
    const out = { ...base };
    for (const k of Object.keys(extra || {})) out[k] = k in base ? mesclar(base[k], extra[k]) : extra[k];
    return out;
  }

  function arredondar(preco, modo) {
    if (!(preco > 0)) return preco;
    if (modo === "90" || modo === "99") {
      const cent = modo === "90" ? 0.9 : 0.99;
      let r = Math.floor(preco) + cent;
      if (r < preco - 1e-9) r += 1;
      return Math.round(r * 100) / 100;
    }
    if (modo === "5") return Math.ceil(preco / 5) * 5;
    return Math.ceil(preco * 100) / 100;
  }

  // Custo de produção de UMA peça.
  function custoPeca(peca, cfg) {
    cfg = mesclar(CONFIG_PADRAO, cfg || {});
    const qtd = Math.max(1, Math.round(num(peca.pecasPorImpressao, 1)));
    const horas = num(peca.horas) + num(peca.minutos) / 60;
    const gramas = num(peca.gramas);

    // Valor da própria peça, se preenchido; senão o padrão da aba Custos. 0 tira o item da conta.
    const valor = (campo, padrao) => (peca[campo] !== undefined && peca[campo] !== null && peca[campo] !== "" ? num(peca[campo]) : num(padrao));
    const precoRolo = valor("precoRolo", cfg.filamento.precoRolo);
    const desgasteHora = valor("desgasteHora", cfg.impressora.desgasteHora);
    const valorHora = valor("valorHora", cfg.trabalho.valorHora);
    const preparoHoras = valor("preparoMinutos", num(cfg.trabalho.preparoHoras) * 60) / 60;

    const filamento = (gramas / Math.max(1, num(cfg.filamento.pesoRolo, 1000))) * precoRolo;
    const energia = horas * num(cfg.impressora.consumoKw) * num(cfg.impressora.tarifaKwh);
    const desgaste = horas * desgasteHora;
    const falhaPct = valor("falhaPct", cfg.falhaPct);
    const falha = (filamento + energia + desgaste) * (falhaPct / 100);
    const preparo = preparoHoras * valorHora;

    const porImpressao = { filamento, energia, desgaste, falha, preparo };
    const lote = filamento + energia + desgaste + falha + preparo;

    const maoDeObra = (num(peca.trabalhoMinutos) / 60) * valorHora;
    const embalagem = valor("embalagem", cfg.embalagemPeca);
    const acabamento = num(peca.acabamento);
    const licenca = num(peca.licenca);
    const outros = num(peca.outros);

    const div = (v) => v / qtd;
    const itens = {
      filamento: div(filamento),
      energia: div(energia),
      desgaste: div(desgaste),
      falha: div(falha),
      maoDeObra: div(preparo) + maoDeObra,
      embalagem: embalagem + acabamento,
      licenca,
      outros,
    };
    const total = Object.values(itens).reduce((a, b) => a + b, 0);
    return { itens, total, quantidade: qtd, horas, gramas, porImpressao, lote };
  }

  // Encontra o preço para um canal com faixas de comissão (ex.: Shopee).
  // preço = (custo + fixo + frete) / (1 - margem - imposto - comissão), checando a faixa em que o preço cai.
  function precoNoCanal(custo, canal, margemPct, impostoPct, modoArred) {
    const faixas = [...(canal.faixas || [{ ate: null, comissaoPct: 0, fixo: 0 }])];
    const calcular = (margem) => {
      let piso = 0;
      for (const f of faixas) {
        const teto = f.ate == null ? Infinity : f.ate;
        const den = 1 - (margem + impostoPct + num(f.comissaoPct)) / 100;
        if (den > 0) {
          let frete = num(canal.freteVendedor);
          let p = (custo + num(f.fixo) + frete) / den;
          if (canal.freteAcimaDe && p >= canal.freteAcimaDe) {
            frete += num(canal.freteValor);
            p = (custo + num(f.fixo) + frete) / den;
          }
          // Preço cai abaixo do início desta faixa: o menor preço possível nela já cobre tudo.
          if (p <= teto + 1e-9) return Math.max(p, piso > 0 ? piso + 0.01 : 0);
        }
        piso = teto;
      }
      return NaN;
    };
    const bruto = calcular(margemPct);
    const minimo = calcular(0);
    const sugerido = arredondar(bruto, modoArred);
    return { bruto, minimo, sugerido, ...analisar(sugerido, custo, canal, impostoPct) };
  }

  // Dado um preço de venda, mostra quanto sobra.
  function analisar(preco, custo, canal, impostoPct) {
    if (!(preco > 0)) return { taxas: NaN, recebe: NaN, lucro: NaN, margemReal: NaN };
    const faixa = (canal.faixas || []).find((f) => f.ate == null || preco <= f.ate) || { comissaoPct: 0, fixo: 0 };
    let frete = num(canal.freteVendedor);
    if (canal.freteAcimaDe && preco >= canal.freteAcimaDe) frete += num(canal.freteValor);
    const taxas = preco * (num(faixa.comissaoPct) + impostoPct) / 100 + num(faixa.fixo) + frete;
    const recebe = preco - taxas;
    const lucro = recebe - custo;
    return { taxas, recebe, lucro, margemReal: (lucro / preco) * 100 };
  }

  function precificar(peca, cfg) {
    cfg = mesclar(CONFIG_PADRAO, cfg || {});
    const custo = custoPeca(peca, cfg);
    const margem = peca.margemPct !== undefined && peca.margemPct !== "" ? num(peca.margemPct) : num(cfg.margemPct);
    const canais = {};
    for (const [id, canal] of Object.entries(cfg.canais)) {
      canais[id] = { nome: canal.nome, ...precoNoCanal(custo.total, canal, margem, num(cfg.impostoPct), cfg.arredondamento) };
    }
    return { custo, margem, canais };
  }

  const api = { CONFIG_PADRAO, custoPeca, precificar, analisar, arredondar, mesclar, num };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Precificador = api;
})(typeof window !== "undefined" ? window : globalThis);
