// Links de rastreio das transportadoras. Usado na Oficina, nos e-mails, no WhatsApp e na área do cliente.
// Links conferidos em out/2026:
// - Correios: o site oficial abre com o código já preenchido; o cliente só digita o captcha.
// - Melhor Rastreio: mostra o andamento sem captcha e reconhece Correios, Jadlog, Loggi, J&T e outras.
(function (raiz) {
  const enc = encodeURIComponent;
  const TRANSPORTADORAS = [
    { id: "correios", nome: "Correios", link: (c) => `https://rastreamento.correios.com.br/app/index.php?objetos=${enc(c)}` },
    { id: "jadlog", nome: "Jadlog", link: (c) => `https://www.jadlog.com.br/jadlog/tracking?cte=${enc(c)}` },
    { id: "loggi", nome: "Loggi", link: (c) => `https://app.loggi.com/rastreador/${enc(c)}` },
    { id: "jt", nome: "J&T Express", link: (c) => `https://melhorrastreio.com.br/rastreio/${enc(c)}` },
    { id: "outra", nome: "Outra", link: (c) => `https://melhorrastreio.com.br/rastreio/${enc(c)}` },
  ];
  const limpar = (c) => String(c || "").trim().replace(/\s+/g, "").toUpperCase();
  const buscar = (id) => TRANSPORTADORAS.find((t) => t.id === id) || null;

  // Código no padrão dos Correios: 2 letras, 9 números, 2 letras (ex.: AB123456789BR)
  const ehCorreios = (c) => /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(limpar(c));
  const detectar = (c) => (ehCorreios(c) ? "correios" : "");

  // Dados de rastreio de um pedido: { codigo, transportadora, nome, link, alternativo }
  function dePedido(p) {
    const codigo = limpar(p?.rastreio);
    if (!codigo) return null;
    const linkProprio = /^https:\/\/\S+$/i.test(String(p?.link_rastreio || "").trim()) ? String(p.link_rastreio).trim() : "";
    const t = buscar(p?.transportadora) || buscar(detectar(codigo)) || buscar("outra");
    const link = linkProprio || t.link(codigo);
    const alternativo = `https://melhorrastreio.com.br/rastreio/${enc(codigo)}`;
    return {
      codigo,
      transportadora: t.id,
      nome: t.id === "outra" ? "" : t.nome,
      link,
      alternativo: alternativo === link ? "" : alternativo,
    };
  }

  raiz.HPR_RASTREIO = { TRANSPORTADORAS, limpar, ehCorreios, detectar, dePedido };
})(window);
