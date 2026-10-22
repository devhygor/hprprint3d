// Itens de um pedido (carrinho): cada item tem quantidade pedida ("qtd") e quantas unidades já foram feitas ("feito").
// Usado pela vitrine, pela área do cliente, pelos e-mails e pela oficina.
(function (raiz) {
  const inteiro = (v, min, max, padrao) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
  };

  function normalizar(it) {
    const qtd = inteiro(it?.qtd, 1, 999, 1);
    const preco = Number(it?.preco);
    return {
      id: it?.id ? String(it.id).slice(0, 80) : null,
      nome: String(it?.nome ?? "").trim().slice(0, 120),
      qtd,
      cor: String(it?.cor ?? "").trim().slice(0, 120),
      foto: typeof it?.foto === "string" && /^https?:\/\//.test(it.foto) ? it.foto.slice(0, 500) : "",
      preco: Number.isFinite(preco) && preco > 0 ? Math.round(preco * 100) / 100 : null,
      feito: inteiro(it?.feito, 0, qtd, 0),
    };
  }

  const lista = (pedido) =>
    (Array.isArray(pedido?.itens) ? pedido.itens : []).map(normalizar).filter((i) => i.nome);

  const unidades = (itens) => itens.reduce((s, i) => s + i.qtd, 0);
  // "Dragão × 2 + Chaveiro" (vai nas colunas antigas peca/quantidade, que o financeiro e os e-mails já leem)
  const resumo = (itens) => itens.map((i) => i.nome + (i.qtd > 1 ? ` × ${i.qtd}` : "")).join(" + ");

  function progresso(itens) {
    const total = unidades(itens);
    const feitas = itens.reduce((s, i) => s + i.feito, 0);
    return {
      total, feitas,
      pct: total ? Math.round((feitas / total) * 100) : 0,
      prontos: itens.filter((i) => i.feito >= i.qtd).length,
      completo: total > 0 && feitas >= total,
    };
  }

  // Uma linha por item, para mensagens de texto (WhatsApp)
  function linhasTexto(itens) {
    return itens.map((i) => {
      const marca = i.feito >= i.qtd ? "✅" : i.feito > 0 ? "🔄" : "⏳";
      return `${marca} ${i.nome}${i.cor ? ` (${i.cor})` : ""}: ${i.feito}/${i.qtd}`;
    });
  }

  // Lista com barrinhas para e-mail (estilos inline, que funcionam no Gmail e no Outlook)
  const escH = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function progressoHtml(itens) {
    if (!itens.length) return "";
    const g = progresso(itens);
    const linhas = itens.map((i) => {
      const pct = Math.round((i.feito / i.qtd) * 100);
      const pronto = i.feito >= i.qtd;
      return '<tr><td style="padding:10px 0;border-top:1px solid #3b2575">' +
        `<div style="font:600 14px Arial,sans-serif;color:#ffffff">${escH(i.nome)}${i.cor ? ` <span style="font-weight:400;color:#a99bd6">· ${escH(i.cor)}</span>` : ""}` +
        `<span style="float:right;color:${pronto ? "#5ee0c8" : "#b98aff"}">${pronto ? "Pronto" : `${i.feito} de ${i.qtd}`}</span></div>` +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px"><tr>' +
        (pct > 0 ? `<td width="${pct}%" height="6" style="height:6px;font-size:0;line-height:0;background:${pronto ? "#5ee0c8" : "#8b3dff"}">&nbsp;</td>` : "") +
        (pct < 100 ? `<td width="${100 - pct}%" height="6" style="height:6px;font-size:0;line-height:0;background:#3b2575">&nbsp;</td>` : "") +
        "</tr></table></td></tr>";
    }).join("");
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr>' +
      '<td style="padding:16px 18px;border-radius:12px;background:#261552;border:1px solid #3b2575">' +
      `<div style="font:600 12px Arial,sans-serif;color:#b98aff;letter-spacing:.04em;text-transform:uppercase">Produção · ${g.feitas} de ${g.total} peças prontas</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${linhas}</table>` +
      "</td></tr></table>";
  }

  raiz.HPR_ITENS = { normalizar, lista, unidades, resumo, progresso, linhasTexto, progressoHtml };
})(window);
