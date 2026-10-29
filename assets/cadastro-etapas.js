// Cadastro de peça em etapas: mostra só um grupo de campos por vez e guia o caminho.
(function () {
  const $ = (s) => document.querySelector(s);
  const secao = $("#tela-editor");
  const form = $("#form-peca");
  if (!secao || !form) return;

  const TOTAL = 5;
  const DICAS = {
    1: "Se a peça vem do MakerWorld, cole o link (ou o arquivo 3MF) e o resto se preenche sozinho. Se for peça própria, é só continuar.",
    2: "Como a peça aparece na vitrine: nome, categorias e descrição. As fotos ficam na etapa 4, depois das medidas.",
    3: "Cores que vocês fazem, medidas e peso. O cliente vê isso na vitrine e a IA usa para montar as imagens.",
    4: "Fotos da peça: adicione, ordene, amplie e gere fotos de vitrine com IA. A primeira é a capa.",
    5: "Dados de impressão e valores para calcular o custo. O preço da vitrine e o botão Salvar peça ficam no quadro do custo.",
  };
  let atual = 1;
  let visitadas = new Set([1]);

  // Medidas que a IA usa nas imagens (vêm da etapa Detalhes)
  function resumoMedidas() {
    const v = (id) => $(id).value.trim();
    const un = $("#c-unidade").value || "mm";
    const l = v("#c-largura"), a = v("#c-altura"), p = v("#c-profundidade"), peso = v("#c-peso");
    const caixa = $("#medidas-resumo");
    if (!caixa) return;
    const faltam = [!l && "largura", !a && "altura", !p && "profundidade"].filter(Boolean);
    caixa.className = "medidas-resumo" + (faltam.length ? " falta" : "");
    caixa.innerHTML = faltam.length === 3
      ? `<span><b>Sem medidas ainda.</b> As imagens com medidas e o anúncio usam largura, altura e profundidade da etapa Detalhes.</span><button type="button" class="botao botao-contorno botao-pequeno" data-etapa-ir="3">Preencher medidas</button>`
      : `<span><b>Medidas usadas nas imagens:</b> ${l || "?"} × ${a || "?"} × ${p || "?"} ${un}${peso ? ` · ${peso} g` : ""}${faltam.length ? ` <em>(falta ${faltam.join(", ")})</em>` : ""}</span><button type="button" class="botao botao-contorno botao-pequeno" data-etapa-ir="3">Editar</button>`;
  }

  function ir(n, rolar = true) {
    atual = Math.min(TOTAL, Math.max(1, n));
    visitadas.add(atual);
    form.querySelectorAll("[data-etapa]").forEach((f) => (f.hidden = Number(f.dataset.etapa) !== atual));
    secao.dataset.etapa = atual;
    $("#etapa-dica").textContent = DICAS[atual];
    if (atual === 4) resumoMedidas();
    $("#etapa-anterior").hidden = atual === 1;
    $("#etapa-proxima").hidden = atual === TOTAL;
    $("#etapa-salvar").hidden = atual !== TOTAL;
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
  $("#etapa-salvar").addEventListener("click", () => $("#salvar-peca").click());
  $("#etapa-anterior").addEventListener("click", () => ir(atual - 1));
  form.closest("section").addEventListener("click", (e) => {
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
