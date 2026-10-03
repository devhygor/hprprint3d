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

  const configurado = (cfg) => !!(cfg && cfg.servico && cfg.template && cfg.chave);

  async function enviarEmailPedido(cfg, pedido, status) {
    if (!configurado(cfg)) return { ok: false, motivo: "E-mail não configurado na aba Loja." };
    const para = String(pedido.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) return { ok: false, motivo: "Pedido sem e-mail do cliente." };
    const [titulo, mensagem] = TEXTOS[status] || TEXTOS.novo;
    const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
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
          link_conta: "https://devhygor.github.io/hprprint3d/conta.html",
          whatsapp: "https://wa.me/" + (String(cfg.whatsapp || "").replace(/\D/g, "") || "5561981600889"),
        },
      }),
    });
    if (!r.ok) return { ok: false, motivo: (await r.text().catch(() => "")) || "Erro " + r.status };
    return { ok: true };
  }

  raiz.HPR_EMAIL = { TEXTOS, configurado, enviarEmailPedido };
})(window);
