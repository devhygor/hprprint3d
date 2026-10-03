// Área do cliente: entrar com Google ou e-mail/senha e acompanhar os próprios pedidos.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const cfg = window.HPR_SUPABASE || {};
  const db = window.supabase && cfg.url ? window.supabase.createClient(cfg.url, cfg.chave) : null;
  const AQUI = location.origin + location.pathname;

  const ETAPAS = [
    { id: "novo", nome: "Recebido", texto: "Recebemos seu pedido e vamos mandar o orçamento pelo WhatsApp." },
    { id: "orcamento", nome: "Orçamento", texto: "Mandamos o orçamento pelo WhatsApp. É só responder por lá." },
    { id: "aprovado", nome: "Aprovado", texto: "Pedido confirmado e na fila da impressora." },
    { id: "imprimindo", nome: "Imprimindo", texto: "Sua peça está na impressora agora." },
    { id: "pronto", nome: "Pronto", texto: "Ficou pronta! Vamos combinar a entrega pelo WhatsApp." },
    { id: "entregue", nome: "Entregue", texto: "Pedido entregue. Obrigado!" },
  ];

  let timer;
  function avisar(msg, erro = false, ms = 5000) {
    const el = $("#aviso");
    el.textContent = msg;
    el.classList.toggle("erro", erro);
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => (el.hidden = true), ms);
  }
  function mostrar(tela) {
    ["entrar", "senha", "pedidos"].forEach((t) => ($("#tela-" + t).hidden = t !== tela));
  }
  function traduzirErro(e) {
    const m = String(e?.message || e || "");
    if (/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
    if (/not confirmed/i.test(m)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
    if (/already registered|already exists/i.test(m)) return "Esse e-mail já tem conta. Use a aba Entrar.";
    if (/Password should be|at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
    if (/provider is not enabled|Unsupported provider/i.test(m)) return "O login com Google ainda não foi ativado pela loja.";
    if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Espere alguns minutos e tente de novo.";
    if (/fetch|network/i.test(m)) return "Sem conexão. Confira a internet e tente de novo.";
    return m;
  }

  // ---------- Entrar ----------
  let modo = "entrar";
  function definirModo(m) {
    modo = m;
    $("#aba-entrar").setAttribute("aria-selected", m === "entrar");
    $("#aba-criar").setAttribute("aria-selected", m === "criar");
    $("#campo-nome").hidden = m !== "criar";
    $("#c-enviar").textContent = m === "criar" ? "Criar conta" : "Entrar";
    $("#c-senha").autocomplete = m === "criar" ? "new-password" : "current-password";
    $("#esqueci").hidden = m === "criar";
  }
  $("#aba-entrar").addEventListener("click", () => definirModo("entrar"));
  $("#aba-criar").addEventListener("click", () => definirModo("criar"));

  $("#entrar-google").addEventListener("click", async () => {
    const { error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: AQUI } });
    if (error) avisar(traduzirErro(error), true);
  });

  $("#form-entrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#c-email").value.trim();
    const senha = $("#c-senha").value;
    const botao = $("#c-enviar");
    botao.disabled = true;
    try {
      if (modo === "criar") {
        const { data, error } = await db.auth.signUp({
          email, password: senha,
          options: { emailRedirectTo: AQUI, data: { full_name: $("#c-nome").value.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          avisar("Conta criada! Enviamos um link de confirmação para " + email + ". Abra o e-mail e confirme para entrar.", false, 12000);
          definirModo("entrar");
          return;
        }
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      }
      $("#c-senha").value = "";
      carregar();
    } catch (err) {
      avisar(traduzirErro(err), true, 7000);
    } finally {
      botao.disabled = false;
    }
  });

  $("#esqueci").addEventListener("click", async () => {
    const email = $("#c-email").value.trim();
    if (!email) { avisar("Digite seu e-mail no campo acima e toque de novo em Esqueci minha senha.", true); $("#c-email").focus(); return; }
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: AQUI });
    if (error) avisar(traduzirErro(error), true);
    else avisar("Se esse e-mail tiver conta, mandamos um link para criar uma nova senha.", false, 9000);
  });

  $("#form-senha").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await db.auth.updateUser({ password: $("#nova-senha").value });
    if (error) { avisar(traduzirErro(error), true); return; }
    avisar("Senha alterada.");
    carregar();
  });

  $("#sair").addEventListener("click", async () => {
    await db.auth.signOut();
    mostrar("entrar");
  });

  // ---------- Pedidos ----------
  function cartao(p) {
    const cancelado = p.status === "cancelado";
    const atual = Math.max(0, ETAPAS.findIndex((e) => e.id === p.status));
    const etapa = ETAPAS[atual];
    const quando = (st) => (p.historico || []).filter((h) => h.status === st).map((h) => h.em).pop();
    const data = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
    const passos = ETAPAS.map((e, i) => {
      const classe = cancelado ? "" : i < atual ? "feito" : i === atual ? "atual" : "";
      return `<li class="${classe}" ${i === atual && !cancelado ? 'aria-current="step"' : ""}><span class="ponto"></span><span class="nome">${e.nome}</span>${classe && quando(e.id) ? `<span class="quando">${data(quando(e.id))}</span>` : ""}</li>`;
    }).join("");
    const falta = p.valor != null ? Number(p.valor) - Number(p.sinal || 0) : null;
    return `<article class="pedido-conta${cancelado ? " cancelado" : ""}">
      <div class="pc-topo"><span class="pc-codigo">${esc(p.id)}</span><span>Feito em ${data(p.criado_em)}</span></div>
      <h2>${esc(p.peca || "Pedido")}${p.quantidade > 1 ? ` <span class="pc-qtd">× ${p.quantidade}</span>` : ""}</h2>
      ${cancelado ? `<p class="pc-status">Pedido cancelado. Qualquer dúvida, fale com a gente no WhatsApp.</p>` : `<p class="pc-status">${esc(etapa.texto)}</p>`}
      <ol class="etapas" aria-label="Andamento do pedido">${passos}</ol>
      <dl class="pc-info">
        ${p.cor ? `<div><dt>Cor</dt><dd>${esc(p.cor)}</dd></div>` : ""}
        ${p.entrega ? `<div><dt>Entrega prevista</dt><dd>${new Date(p.entrega + "T12:00").toLocaleDateString("pt-BR")}</dd></div>` : p.prazo ? `<div><dt>Você pediu para</dt><dd>${esc(p.prazo)}</dd></div>` : ""}
        ${p.valor != null ? `<div><dt>Valor</dt><dd>${brl(p.valor)}${falta > 0.004 ? ` <span class="pc-falta">(falta ${brl(falta)})</span>` : " <span class='pc-pago'>(pago)</span>"}</dd></div>` : ""}
        ${p.qtd_referencias ? `<div><dt>Imagens enviadas</dt><dd>${p.qtd_referencias}</dd></div>` : ""}
      </dl>
    </article>`;
  }

  async function carregar() {
    const { data } = await db.auth.getSession();
    const sessao = data.session;
    if (!sessao) { mostrar("entrar"); return; }
    mostrar("pedidos");
    const u = sessao.user;
    const nome = u.user_metadata?.full_name || u.user_metadata?.name || "";
    $("#ola").textContent = nome ? `Olá, ${nome.split(" ")[0]}!` : "Seus pedidos";
    $("#conta-email").textContent = `Conectado como ${u.email}`;
    db.rpc("eh_equipe").then(({ data: equipe }) => ($("#ir-oficina").hidden = !equipe)).catch(() => {});
    $("#lista").innerHTML = `<p class="apoio">Carregando seus pedidos…</p>`;
    const { data: pedidos, error } = await db.rpc("meus_pedidos");
    if (error) {
      $("#lista").innerHTML = `<div class="vazio"><strong>Não consegui carregar seus pedidos</strong>${esc(traduzirErro(error))}</div>`;
      return;
    }
    if (!pedidos?.length) {
      $("#lista").innerHTML = `<div class="vazio"><strong>Nenhum pedido por aqui ainda</strong>Faça um pedido pelo site usando o e-mail ${esc(u.email)} e ele aparece nesta página.<br><br><a class="botao botao-principal" href="./#pedido">Fazer um pedido</a></div>`;
      return;
    }
    $("#lista").innerHTML = pedidos.map(cartao).join("");
  }

  if (!db) {
    mostrar("entrar");
    avisar("Não consegui carregar o sistema de login. Recarregue a página.", true, 10000);
    return;
  }
  db.auth.onAuthStateChange((evento) => {
    if (evento === "PASSWORD_RECOVERY") mostrar("senha");
    else if (evento === "SIGNED_IN") setTimeout(carregar, 0);
  });
  const erroUrl = new URLSearchParams(location.hash.slice(1)).get("error_description") || new URLSearchParams(location.search).get("error_description");
  if (erroUrl) avisar(traduzirErro(erroUrl), true, 9000);
  carregar();
})();
