// Oficina > Loja > Frete: tabela por região, retirada, entrega em mãos e Melhor Envio.
(function () {
  const O = window.Oficina;
  const F = window.HPR_FRETE;
  const { estado, $, esc, brl, avisar, erroLegivel } = O;

  function preencher() {
    const c = F.config(estado.site);
    $("#lf-cep").value = F.formatarCep(c.cepOrigem);
    $("#lf-ufs").value = c.ufsLocal;
    $("#lf-ret").checked = !!c.retirada.ativo;
    $("#lf-ret-texto").value = c.retirada.texto || "";
    $("#lf-local").checked = !!c.local.ativo;
    $("#lf-local-texto").value = c.local.texto || "";
    $("#lf-local-valor").value = c.local.valor ?? "";
    $("#lf-local-prazo").value = c.local.prazo ?? "";
    $("#lf-tabela").innerHTML =
      `<div class="tf-cab"><span>Região</span><span>Valor (R$)</span><span>Prazo (dias úteis)</span></div>` +
      F.REGIOES.map((r) => {
        const t = c.tabela.find((x) => x.id === r.id) || {};
        return `<div class="tf-linha">
          <span class="tf-nome">${esc(r.nome)}<small>${r.ufs.join(", ")}</small></span>
          <input data-tf-valor="${r.id}" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(t.valor ?? "")}" aria-label="Valor do frete para ${esc(r.nome)}" placeholder="a combinar">
          <input data-tf-prazo="${r.id}" type="number" min="0" inputmode="numeric" value="${esc(t.prazo ?? "")}" aria-label="Prazo para ${esc(r.nome)}">
        </div>`;
      }).join("");
    $("#lf-larg").value = c.pacote.largura;
    $("#lf-alt").value = c.pacote.altura;
    $("#lf-comp").value = c.pacote.comprimento;
    $("#lf-peso").value = c.pacote.peso;
    $("#lf-real").checked = !!c.real;
    $("#lf-teste").innerHTML = "";
  }

  function ler() {
    const n = (sel) => { const v = $(sel).value.trim(); return v === "" ? "" : Number(v); };
    return {
      cepOrigem: $("#lf-cep").value.replace(/\D/g, "").slice(0, 8),
      ufsLocal: $("#lf-ufs").value.toUpperCase().replace(/[^A-Z,\s]/g, "").trim(),
      retirada: { ativo: $("#lf-ret").checked, texto: $("#lf-ret-texto").value.trim() },
      local: { ativo: $("#lf-local").checked, texto: $("#lf-local-texto").value.trim(), valor: n("#lf-local-valor"), prazo: n("#lf-local-prazo") },
      tabela: F.REGIOES.map((r) => ({ id: r.id, valor: n(`[data-tf-valor="${r.id}"]`), prazo: n(`[data-tf-prazo="${r.id}"]`) })),
      pacote: { largura: n("#lf-larg") || 16, altura: n("#lf-alt") || 12, comprimento: n("#lf-comp") || 20, peso: n("#lf-peso") || 300 },
      real: $("#lf-real").checked,
    };
  }

  $("#lf-cep").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 8);
    e.target.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  });

  $("#lf-salvar").addEventListener("click", async () => {
    const frete = ler();
    if (frete.real && frete.cepOrigem.length !== 8) { avisar("Para o Melhor Envio, preencha o CEP de onde vocês enviam.", true); $("#lf-cep").focus(); return; }
    estado.site = { ...estado.site, frete };
    try {
      await O.gravarAjuste("site", estado.site);
      avisar("Frete salvo. O simulador do site já usa esses valores.");
    } catch (e) { avisar("Não consegui salvar: " + erroLegivel(e), true, 7000); }
  });

  // Testa a cotação real para um CEP de São Paulo (Av. Paulista)
  $("#lf-testar").addEventListener("click", async () => {
    const frete = ler();
    const alvo = $("#lf-teste");
    if (frete.cepOrigem.length !== 8) { avisar("Preencha o CEP de onde vocês enviam.", true); $("#lf-cep").focus(); return; }
    alvo.innerHTML = `<p class="dica">Consultando o Melhor Envio…</p>`;
    try {
      const ops = await F.cotarReal(window.HPR_SUPABASE, frete, "01310100", F.produtos(frete, null, 1));
      alvo.innerHTML = ops.length
        ? `<p class="dica">Funcionou! Caixa padrão para São Paulo/SP:</p><ul class="lista-teste">${ops.map((o) => `<li>${esc(o.nome)}: <b>${brl(o.valor)}</b>${o.prazo ? `, ${esc(o.prazo)}` : ""}</li>`).join("")}</ul>`
        : `<p class="dica alerta">O Melhor Envio respondeu, mas sem opções para essa caixa.</p>`;
    } catch (e) {
      const m = String(e.message || "");
      const motivo = /não configurado/i.test(m) ? "o segredo MELHOR_ENVIO_TOKEN ainda não foi criado no Supabase."
        : /inválido|vencido/i.test(m) ? "o token do Melhor Envio está errado ou venceu. Gere outro."
        : /frete 404|Failed to fetch|NetworkError|abort/i.test(m) ? "a função de frete não está publicada no Supabase."
        : m;
      alvo.innerHTML = `<p class="dica erro">Não deu: ${esc(motivo)} Enquanto isso, o site usa a tabela.</p>`;
    }
  });

  O.ganchos.loja = preencher;
})();
