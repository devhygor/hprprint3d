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
      grade.innerHTML = `<div class="vazio" style="grid-column:1/-1"><strong>As peças estão na impressora</strong>Enquanto o catálogo não fica pronto, veja as novidades no nosso Instagram ou peça um orçamento.<br><br><a class="botao botao-principal" href="${esc(linkPedido())}" target="_blank" rel="noopener">Pedir orçamento</a></div>`;
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
              <a class="botao botao-principal botao-pequeno" href="${esc(linkPedido(p.nome))}" target="_blank" rel="noopener">Pedir</a>
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

  // Ajusta o "bico" da animação do título à altura real do h1
  const h1 = document.querySelector(".heroi h1");
  if (h1) document.documentElement.style.setProperty("--altura-h1", h1.offsetHeight + "px");

  const semCache = "?v=" + Date.now();
  Promise.all([
    fetch("data/site.json" + semCache).then((r) => r.json()).catch(() => ({})),
    fetch("data/catalogo.json" + semCache).then((r) => r.json()).catch(() => []),
  ]).then(([s, c]) => {
    site = s || {};
    pecas = (Array.isArray(c) ? c : []).filter((p) => p.ativo !== false).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    document.querySelectorAll('[data-link="whatsapp"]').forEach((a) => (a.href = linkPedido()));
    document.querySelectorAll('[data-link="instagram"]').forEach((a) => (a.href = site.instagram || a.href));
    desenharFiltros();
    desenharGrade();
  });
})();
