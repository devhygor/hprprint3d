// E-mails para o cliente sobre o pedido, enviados pelo EmailJS (plano gratuito: 200 por mês).
// A configuração (serviço, template e chave pública) fica em ajustes "site" no Supabase:
// esses três valores são públicos por natureza; a proteção é a lista de domínios no painel do EmailJS.
(function (raiz) {
  const TEXTOS = {
    novo: ["Recebemos seu pedido", "Recebemos seu pedido e já vamos olhar com carinho. Em breve mandamos o orçamento pelo WhatsApp."],
    orcamento: ["Orçamento enviado", "Mandamos o orçamento do seu pedido pelo WhatsApp. Dá uma olhada e responde por lá."],
    aprovado: ["Pedido aprovado", "Pedido confirmado! Ele já entrou na fila da impressora."],
    imprimindo: ["Seu pedido está sendo impresso", "Sua peça está na impressora agora, sendo feita camada por camada."],
    pronto: ["Seu pedido está pronto", "Sua peça ficou pronta! Vamos combinar a entrega ou o envio pelo WhatsApp."],
    enviado: ["Seu pedido foi postado", "Seu pedido já está a caminho! Use o código de rastreio para acompanhar a entrega."],
    entregue: ["Pedido entregue", "Pedido entregue. Obrigado por comprar com a HPR Print 3D! Se puder, marca a gente no Instagram @hprprint3d."],
    cancelado: ["Pedido cancelado", "Seu pedido foi cancelado. Se ficou alguma dúvida, fala com a gente no WhatsApp."],
  };

  // Barrinha de etapas em HTML de e-mail (tabelas e estilos inline, que funcionam no Gmail e no Outlook)
  const ETAPAS = [["novo", "Recebido"], ["orcamento", "Orçamento"], ["aprovado", "Aprovado"], ["imprimindo", "Imprimindo"], ["pronto", "Pronto"], ["enviado", "Enviado"], ["entregue", "Entregue"]];
  function progressoHtml(status) {
    if (status === "cancelado") {
      return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 16px;border-radius:10px;background:#3a1030;color:#ffb3c7;font:600 14px Arial,sans-serif;text-align:center">Pedido cancelado</td></tr></table>';
    }
    const atual = Math.max(0, ETAPAS.findIndex(([id]) => id === status));
    const celulas = ETAPAS.map(([, nome], i) => {
      const feito = i < atual, agora = i === atual;
      const cor = agora ? "#ffffff" : feito ? "#b98aff" : "#5b4a8f";
      const bola = agora ? "#8b3dff" : feito ? "#6d2fd6" : "#261552";
      const borda = agora ? "#ffffff" : feito ? "#6d2fd6" : "#3b2575";
      return `<td width="14%" align="center" valign="top" style="padding:0 2px">` +
        `<div style="width:16px;height:16px;margin:0 auto;border-radius:50%;background:${bola};border:3px solid ${borda};font-size:0;line-height:0">&nbsp;</div>` +
        `<div style="margin-top:6px;font:${agora ? "700" : "500"} 11px Arial,sans-serif;color:${cor}">${nome}</div></td>`;
    }).join("");
    const barra = ETAPAS.map((_, i) => `<td width="14%" height="4" style="height:4px;font-size:0;line-height:0;background:${i <= atual ? "#8b3dff" : "#3b2575"}">&nbsp;</td>`).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${barra}</tr></table>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr>${celulas}</tr></table>`;
  }

  // Bloco com o código de rastreio e botão para acompanhar (vai junto do progresso no e-mail)
  const escH = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rastreioDe = (pedido, status) =>
    ["enviado", "entregue"].includes(status) ? raiz.HPR_RASTREIO?.dePedido(pedido) || null : null;
  function rastreioHtml(r) {
    if (!r) return "";
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr>' +
      '<td style="padding:16px 18px;border-radius:12px;background:#261552;border:1px solid #3b2575">' +
      `<div style="font:600 12px Arial,sans-serif;color:#b98aff;letter-spacing:.04em;text-transform:uppercase">Código de rastreio${r.nome ? " · " + escH(r.nome) : ""}</div>` +
      `<div style="margin-top:6px;font:700 22px 'Courier New',monospace;color:#ffffff;letter-spacing:.06em">${escH(r.codigo)}</div>` +
      `<a href="${escH(r.link)}" target="_blank" style="display:inline-block;margin-top:14px;padding:12px 22px;border-radius:999px;background:#8b3dff;color:#ffffff;font:700 15px Arial,sans-serif;text-decoration:none">Acompanhar a entrega</a>` +
      (r.alternativo ? `<div style="margin-top:10px;font:400 12px Arial,sans-serif;color:#a99bd6">Se o site pedir para digitar letras, é só copiar o código acima. Ou veja direto no <a href="${escH(r.alternativo)}" target="_blank" style="color:#b98aff">Melhor Rastreio</a>.</div>` : "") +
      "</td></tr></table>";
  }

  const configurado = (cfg) => !!(cfg && cfg.servico && cfg.template && cfg.chave);

  async function enviarEmailPedido(cfg, pedido, status) {
    if (!configurado(cfg)) return { ok: false, motivo: "E-mail não configurado na aba Loja." };
    const para = String(pedido.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) return { ok: false, motivo: "Pedido sem e-mail do cliente." };
    const [titulo, mensagem] = TEXTOS[status] || TEXTOS.novo;
    const rastreio = rastreioDe(pedido, status);
    const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: cfg.servico,
        template_id: cfg.template,
        user_id: cfg.chave,
        template_params: {
          to_email: para,
          to_name: (pedido.cliente || "").split(" ")[0] || "tudo bem",
          codigo: pedido.id,
          titulo,
          mensagem,
          peca: pedido.peca || "",
          progresso: progressoHtml(status) + rastreioHtml(rastreio),
          rastreio: rastreio?.codigo || "",
          link_rastreio: rastreio?.link || "",
          transportadora: rastreio?.nome || "",
          etapa: (ETAPAS.find(([id]) => id === status) || [, status === "cancelado" ? "Cancelado" : "Recebido"])[1],
          link_conta: "https://hprprint3d.hygor.com.br/conta.html",
          whatsapp: "https://wa.me/" + (String(cfg.whatsapp || "").replace(/\D/g, "") || "5561981600889"),
        },
      }),
    });
    if (!r.ok) return { ok: false, motivo: (await r.text().catch(() => "")) || "Erro " + r.status };
    return { ok: true };
  }

  // Mensagem pronta para o WhatsApp do cliente, de acordo com o status
  function mensagemWhatsapp(pedido, status) {
    const [titulo, mensagem] = TEXTOS[status] || TEXTOS.novo;
    const nome = (pedido.cliente || "").trim().split(" ")[0];
    const etapa = (ETAPAS.find(([id]) => id === status) || [, status === "cancelado" ? "Cancelado" : "Recebido"])[1];
    const linhas = [
      `Oi${nome ? ", " + nome : ""}! Aqui é da *HPR Print 3D* 💜`,
      "",
      `*${titulo}*`,
      mensagem,
      "",
      `*Pedido:* ${pedido.id}${pedido.peca ? " – " + pedido.peca : ""}`,
      `*Etapa:* ${etapa}`,
    ];
    const rastreio = rastreioDe(pedido, status);
    if (rastreio) {
      linhas.push(`*Rastreio${rastreio.nome ? " (" + rastreio.nome + ")" : ""}:* ${rastreio.codigo}`, "", `📦 Acompanhe a entrega: ${rastreio.link}`);
    }
    if (pedido.email) linhas.push("", `Acompanhe por aqui: https://hprprint3d.hygor.com.br/conta.html`);
    return linhas.join("\n");
  }

  raiz.HPR_EMAIL = { TEXTOS, configurado, enviarEmailPedido, progressoHtml, rastreioHtml, mensagemWhatsapp };
})(window);
