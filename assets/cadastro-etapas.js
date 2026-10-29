// Cadastro de peça em etapas: mostra só um grupo de campos por vez e guia o caminho.
(function () {
  const $ = (s) => document.querySelector(s);
  const secao = $("#tela-editor");
  const form = $("#form-peca");
  if (!secao || !form) return;

  const TOTAL = 4;
  const DICAS = {
    1: "Se a peça vem do MakerWorld, cole o link (ou o arquivo 3MF) e o resto se preenche sozinho. Se for peça própria, é só continuar.",
    2: "Como a peça aparece na vitrine: nome, categorias, descrição e fotos. A primeira foto é a capa.",
    3: "Cores que vocês fazem, medidas e peso. O cliente vê isso na vitrine.",
    4: "Dados de impressão e valores para calcular o custo. O preço da vitrine e o botão Salvar peça ficam no quadro do custo.",
  };
  let atual = 1;
  let visitadas = new Set([1]);

  function ir(n, rolar = true) {
    atual = Math.min(TOTAL, Math.max(1, n));
    visitadas.add(atual);
    form.querySelectorAll("[data-etapa]").forEach((f) => (f.hidden = Number(f.dataset.etapa) !== atual));
    secao.dataset.etapa = atual;
    $("#etapa-dica").textContent = DICAS[atual];
    $("#etapa-anterior").hidden = atual === 1;
    $("#etapa-proxima").hidden = atual === TOTAL;
    document.querySelectorAll("#etapas-cad button").forEach((b) => {
      const i = Number(b.dataset.etapaIr);
      if (i === atual) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      b.classList.toggle("feita", i < atual && visitadas.has(i));
      if (i === atual) b.scrollIntoView({ inline: "center", block: "nearest" });
    });
    if (rolar) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function avancar() {
    if (atual === 2 && !$("#p-nome").value.trim()) {
      window.Oficina?.avisar?.("Dê um nome para a peça antes de continuar.", true);
      $("#p-nome").focus();
      return;
    }
    ir(atual + 1);
  }

  $("#etapa-proxima").addEventListener("click", avancar);
  $("#etapa-anterior").addEventListener("click", () => ir(atual - 1));
  $("#etapas-cad").addEventListener("click", (e) => {
    const b = e.target.closest("[data-etapa-ir]");
    if (b) ir(Number(b.dataset.etapaIr));
  });

  // Ao abrir o editor: peça nova começa pela importação; peça existente, direto nos dados
  function aoAbrir() {
    visitadas = new Set([1]);
    ir(window.Oficina?.estado?.editando ? 2 : 1, false);
  }
  const O = (window.Oficina = window.Oficina || {});
  O.ganchos = O.ganchos || {};
  const anterior = O.ganchos.editor;
  O.ganchos.editor = () => { anterior?.(); aoAbrir(); };
  ir(1, false);
})();
