// Vitrine pública: lê data/site.json e data/catalogo.json e monta a grade de peças.
(function () {
  const CORES = ["var(--coral)", "var(--sol)", "var(--menta)", "var(--lilas)"];
  const grade = document.getElementById("grade");
  const filtros = document.getElementById("filtros");
  let site = {};
  let pecas = [];
  let filtroAtual = "Todas";

  const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function linkPedido(nomePeca) {
    const msg = (site.mensagemPedido || "Oi! Vi no site e quero saber sobre: ") + (nomePeca || "uma peça personalizada");
    const numero = String(site.whatsapp || "").replace(/\D/g, "");
    if (numero) return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
    return site.instagram || "https://www.instagram.com/hprprint3d/";
  }

  function corDaCategoria(cat) {
    const cats = [...new Set(pecas.map((p) => p.categoria || "Outros"))];
    return CORES[Math.max(0, cats.indexOf(cat)) % CORES.length];
  }

  function desenharFiltros() {
    const cats = ["Todas", ...new Set(pecas.map((p) => p.categoria || "Outros"))];
    if (cats.length <= 2) { filtros.innerHTML = ""; return; }
    filtros.innerHTML = cats
      .map((c) => `<button class="filtro" type="button" aria-pressed="${c === filtroAtual}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join("");
  }

  function desenharGrade() {
    const lista = pecas.filter((p) => filtroAtual === "Todas" || (p.categoria || "Outros") === filtroAtual);
    if (!lista.length) {
      grade.innerHTML = `<div class="vazio" style="grid-column:1/-1"><strong>As peças estão na impressora</strong>Enquanto o catálogo não fica pronto, veja as novidades no nosso Instagram ou peça um orçamento.<br><br><a class="botao botao-principal" href="#pedido">Pedir orçamento</a></div>`;
      return;
    }
    grade.innerHTML = lista
      .map((p) => {
        const foto = p.foto
          ? `<img src="${esc(p.foto)}" alt="${esc(p.nome)}" loading="lazy">`
          : `<span class="sem-foto">Foto em breve</span>`;
        const preco = p.preco ? `<span class="preco"><small>a partir de</small>${brl(Number(p.preco))}</span>` : `<span class="preco"><small>valor</small>Sob consulta</span>`;
        return `<article class="peca">
          <div class="peca-foto">${foto}</div>
          <div class="peca-corpo">
            <span class="peca-categoria" style="--cor:${corDaCategoria(p.categoria || "Outros")}">${esc(p.categoria || "Outros")}</span>
            <h3>${esc(p.nome)}</h3>
            ${p.descricao ? `<p class="peca-desc">${esc(p.descricao)}</p>` : ""}
            <div class="peca-rodape">
              ${preco}
              <a class="botao botao-principal botao-pequeno" href="#pedido" data-pedir="${esc(p.nome)}">Pedir</a>
            </div>
          </div>
        </article>`;
      })
      .join("");
  }

  filtros.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    filtroAtual = b.dataset.cat;
    desenharFiltros();
    desenharGrade();
  });

  // ---------- Pedido pelo WhatsApp ----------
  const numeroZap = () => String(site.whatsapp || "5561981600889").replace(/\D/g, "");

  // Botão "Pedir" do card: leva ao formulário já com a peça preenchida
  grade.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pedir]");
    if (!b) return;
    e.preventDefault();
    const campo = document.getElementById("pedido-peca");
    campo.value = b.dataset.pedir;
    document.getElementById("pedido").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setTimeout(() => document.querySelector('#form-pedido [name="nome"]').focus({ preventScroll: true }), 400);
  });

  document.getElementById("form-pedido").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const v = (k) => String(f.get(k) || "").trim();
    const erro = document.getElementById("pedido-erro");
    const faltando = [!v("nome") && "seu nome", !v("peca") && "a peça ou ideia"].filter(Boolean);
    if (faltando.length) {
      erro.textContent = "Preencha " + faltando.join(" e ") + " para enviar.";
      erro.hidden = false;
      e.target.querySelector(!v("nome") ? '[name="nome"]' : '[name="peca"]').focus();
      return;
    }
    erro.hidden = true;
    // Código curto pra vocês acharem o pedido depois: HPR-MMDD-XXX
    const hoje = new Date();
    const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const sorteio = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => letras[n % letras.length]).join("");
    const codigo = `HPR-${String(hoje.getMonth() + 1).padStart(2, "0")}${String(hoje.getDate()).padStart(2, "0")}-${sorteio}`;
    const detalhes = [
      `*Código:* ${codigo}`,
      `*Pedido:* ${v("peca")}`,
      `*Quantidade:* ${v("quantidade") || "1"}`,
      v("cor") && `*Cor:* ${v("cor")}`,
      v("cidade") && `*Cidade/bairro:* ${v("cidade")}`,
      v("prazo") && `*Para quando:* ${v("prazo")}`,
      v("detalhes") && `*Detalhes:* ${v("detalhes")}`,
    ].filter(Boolean);
    const texto = [`Oi! Meu nome é ${v("nome")} e vi o site da HPR Print 3D.`, "", ...detalhes].join("\n");
    const link = `https://wa.me/${numeroZap()}?text=${encodeURIComponent(texto)}`;
    const ok = document.getElementById("pedido-ok");
    ok.innerHTML = `Pedido <strong>${codigo}</strong> pronto. Se o WhatsApp não abriu, <a href="${link}" target="_blank" rel="noopener">toque aqui para enviar</a>.`;
    ok.hidden = false;
    // Abre o WhatsApp já (precisa ser no mesmo clique, senão o navegador bloqueia)
    window.open(link, "_blank", "noopener");
    registrarPedido({
      id: codigo,
      origem: "site",
      status: "novo",
      cliente: v("nome").slice(0, 120),
      telefone: v("telefone").replace(/[^\d+ ()-]/g, "").slice(0, 30),
      cidade: v("cidade").slice(0, 160),
      peca: v("peca").slice(0, 300),
      quantidade: Math.min(10000, Math.max(1, parseInt(v("quantidade"), 10) || 1)),
      cor: v("cor").slice(0, 120),
      prazo: v("prazo").slice(0, 160),
      detalhes: v("detalhes").slice(0, 2000),
      mensagem: texto.slice(0, 4000),
      historico: [{ status: "novo", em: new Date().toISOString() }],
    });
  });

  // Grava o pedido no Supabase em segundo plano. Se falhar, o pedido ainda chega
  // pelo WhatsApp e pode ser registrado na oficina colando a mensagem.
  function registrarPedido(pedido) {
    const cfg = window.HPR_SUPABASE;
    if (!cfg?.url || !cfg?.chave) return;
    try {
      fetch(`${cfg.url}/rest/v1/pedidos`, {
        method: "POST",
        keepalive: true,
        headers: { apikey: cfg.chave, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(pedido),
      }).catch(() => {});
    } catch {}
  }

  // ---------- Destaques do Instagram ----------
  function desenharInstagram() {
    const links = (site.destaquesInstagram || [])
      .map((u) => String(u).trim())
      .map((u) => u.match(/^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/))
      .filter(Boolean)
      .slice(0, 9);
    if (!links.length) return;
    document.getElementById("grade-insta").innerHTML = links
      .map((m) => `<div class="insta-item"><blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/${m[2]}/${m[3]}/" data-instgrm-version="14"><a href="https://www.instagram.com/${m[2]}/${m[3]}/" target="_blank" rel="noopener">Ver no Instagram</a></blockquote></div>`)
      .join("");
    document.getElementById("instagram").hidden = false;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://www.instagram.com/embed.js";
    document.body.appendChild(s);
  }

  // Ajusta o "bico" da animação do título à altura real do h1
  const h1 = document.querySelector(".heroi h1");
  if (h1) document.documentElement.style.setProperty("--altura-h1", h1.offsetHeight + "px");

  // Dados vêm do Supabase; se ele não responder, usa os arquivos do próprio site como reserva.
  const semCache = "?v=" + Date.now();
  const sb = window.HPR_SUPABASE || {};
  const lerSupabase = (caminho) =>
    fetch(`${sb.url}/rest/v1/${caminho}`, { headers: { apikey: sb.chave } }).then((r) => {
      if (!r.ok) throw new Error("supabase " + r.status);
      return r.json();
    });
  const reserva = (arquivo, padrao) => fetch(arquivo + semCache).then((r) => r.json()).catch(() => padrao);
  Promise.all([
    lerSupabase("ajustes?select=valor&chave=eq.site").then((l) => l[0]?.valor || reserva("data/site.json", {})).catch(() => reserva("data/site.json", {})),
    lerSupabase("pecas?select=id,nome,categoria,descricao,foto,preco,ativo,ordem&ativo=eq.true&order=ordem.asc,nome.asc").catch(() => reserva("data/catalogo.json", [])),
  ]).then(([s, c]) => {
    site = s || {};
    pecas = (Array.isArray(c) ? c : []).filter((p) => p.ativo !== false).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    document.querySelectorAll('[data-link="whatsapp"]').forEach((a) => (a.href = linkPedido()));
    document.querySelectorAll('[data-link="instagram"]').forEach((a) => (a.href = site.instagram || a.href));
    desenharFiltros();
    desenharGrade();
    desenharInstagram();
  });
})();
