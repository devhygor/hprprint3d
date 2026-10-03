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
    entregue: ["Pedido entregue", "Pedido entregue. Obrigado por comprar com a HPR Print 3D! Se puder, marca a gente no Instagram @hprprint3d."],
    cancelado: ["Pedido cancelado", "Seu pedido foi cancelado. Se ficou alguma dúvida, fala com a gente no WhatsApp."],
  };

  // Barrinha de etapas em HTML de e-mail (tabelas e estilos inline, que funcionam no Gmail e no Outlook)
  const ETAPAS = [["novo", "Recebido"], ["orcamento", "Orçamento"], ["aprovado", "Aprovado"], ["imprimindo", "Imprimindo"], ["pronto", "Pronto"], ["entregue", "Entregue"]];
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
      return `<td width="16%" align="center" valign="top" style="padding:0 2px">` +
        `<div style="width:16px;height:16px;margin:0 auto;border-radius:50%;background:${bola};border:3px solid ${borda};font-size:0;line-height:0">&nbsp;</div>` +
        `<div style="margin-top:6px;font:${agora ? "700" : "500"} 11px Arial,sans-serif;color:${cor}">${nome}</div></td>`;
    }).join("");
    const barra = ETAPAS.map((_, i) => `<td width="16%" height="4" style="height:4px;font-size:0;line-height:0;background:${i <= atual ? "#8b3dff" : "#3b2575"}">&nbsp;</td>`).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${barra}</tr></table>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr>${celulas}</tr></table>`;
  }

  const configurado = (cfg) => !!(cfg && cfg.servico && cfg.template && cfg.chave);

  async function enviarEmailPedido(cfg, pedido, status) {
    if (!configurado(cfg)) return { ok: false, motivo: "E-mail não configurado na aba Loja." };
    const para = String(pedido.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) return { ok: false, motivo: "Pedido sem e-mail do cliente." };
    const [titulo, mensagem] = TEXTOS[status] || TEXTOS.novo;
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
          progresso: progressoHtml(status),
          etapa: (ETAPAS.find(([id]) => id === status) || [, status === "cancelado" ? "Cancelado" : "Recebido"])[1],
          link_conta: "https://devhygor.github.io/hprprint3d/conta.html",
          whatsapp: "https://wa.me/" + (String(cfg.whatsapp || "").replace(/\D/g, "") || "5561981600889"),
        },
      }),
    });
    if (!r.ok) return { ok: false, motivo: (await r.text().catch(() => "")) || "Erro " + r.status };
    return { ok: true };
  }

  raiz.HPR_EMAIL = { TEXTOS, configurado, enviarEmailPedido, progressoHtml };
})(window);
