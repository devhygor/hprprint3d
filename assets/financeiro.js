// Oficina: financeiro (entradas e saídas por mês). Usa window.Oficina exposto por admin.js.
(function () {
  const O = window.Oficina;
  const { estado, $, $$, brl, esc, avisar, db, erroLegivel } = O;

  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const CAT_SAIDA = ["Filamento", "Curso", "Ferramentas", "Peças e manutenção", "Embalagem", "Energia", "Anúncios", "Frete", "Taxas", "Outros"];
  const CAT_ENTRADA = ["Venda direta", "Encomenda", "Shopee", "Mercado Livre", "Feira/evento", "Outros"];

  const hoje = new Date();
  let lancs = [];
  let carregado = false;
  let modo = "mes"; // "mes" | "ano"
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth(); // 0-11
  let busca = "";
  let editando = null; // lançamento em edição

  const n = (v) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
  const chaveMes = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const mesDe = (data) => String(data || "").slice(0, 7);
  const brlCurto = (v) => {
    const a = Math.abs(v);
    if (a >= 1000) return (v < 0 ? "-" : "") + "R$ " + (a / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
    return brl(v);
  };
  const dataBR = (d) => (d ? new Date(d + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
  const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // ---------- Banco ----------
  async function carregar() {
    const { data, error } = await db.from("lancamentos").select("*").order("data", { ascending: false }).limit(10000);
    if (error) throw error;
    lancs = (data || []).map((l) => ({ ...l, valor: n(l.valor), quantidade: n(l.quantidade) }));
    carregado = true;
  }

  // ---------- Recortes ----------
  function noPeriodo(l) {
    if (modo === "ano") return String(l.data).startsWith(String(ano));
    return mesDe(l.data) === chaveMes(ano, mes);
  }
  function totais(lista) {
    const t = { entrou: 0, aReceber: 0, saiu: 0, aPagar: 0, vendas: 0, pecas: 0 };
    for (const l of lista) {
      if (l.tipo === "entrada") {
        if (l.pago) t.entrou += l.valor; else t.aReceber += l.valor;
        t.vendas += 1;
        t.pecas += l.quantidade || 0;
      } else {
        if (l.pago) t.saiu += l.valor; else t.aPagar += l.valor;
      }
    }
    t.saldo = t.entrou - t.saiu;
    t.ticket = t.vendas ? (t.entrou + t.aReceber) / t.vendas : 0;
    return t;
  }
  function periodoAnterior() {
    if (modo === "ano") return (l) => String(l.data).startsWith(String(ano - 1));
    const d = new Date(ano, mes - 1, 1);
    return (l) => mesDe(l.data) === chaveMes(d.getFullYear(), d.getMonth());
  }

  // ---------- Desenho ----------
  function desenhar() {
    $("#fin-rotulo").textContent = modo === "ano" ? String(ano) : `${MESES[mes][0].toUpperCase() + MESES[mes].slice(1)} de ${ano}`;
    $$("[data-fin-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.finModo === modo)));
    const doPeriodo = lancs.filter(noPeriodo);
    desenharResumo(totais(doPeriodo), totais(lancs.filter(periodoAnterior())));
    desenharGrafico();
    const q = busca.trim().toLowerCase();
    const filtra = (l) => !q || [l.cliente, l.descricao, l.categoria, l.notas].some((x) => String(x || "").toLowerCase().includes(q));
    const ordena = (a, b) => String(b.data).localeCompare(String(a.data)) || String(b.criado_em).localeCompare(String(a.criado_em));
    desenharEntradas(doPeriodo.filter((l) => l.tipo === "entrada" && filtra(l)).sort(ordena));
    desenharSaidas(doPeriodo.filter((l) => l.tipo === "saida" && filtra(l)).sort(ordena));
    desenharCategorias(doPeriodo.filter((l) => l.tipo === "saida"));
    desenharRanking("#fin-top-pecas", doPeriodo.filter((l) => l.tipo === "entrada"), (l) => l.descricao, true);
    desenharRanking("#fin-top-clientes", doPeriodo.filter((l) => l.tipo === "entrada"), (l) => l.cliente, false);
  }

  function variacao(atual, antes, maiorEhBom = true) {
    if (!antes) return "";
    const pct = ((atual - antes) / Math.abs(antes)) * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) < 0.5) return `<span class="fin-delta">igual ao ${modo === "ano" ? "ano" : "mês"} anterior</span>`;
    const bom = (pct > 0) === maiorEhBom;
    return `<span class="fin-delta ${bom ? "bom" : "ruim"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}% vs ${modo === "ano" ? "ano" : "mês"} anterior</span>`;
  }

  function desenharResumo(t, ant) {
    const pend = [];
    if (t.aReceber > 0.004) pend.push(`${brl(t.aReceber)} a receber`);
    if (t.aPagar > 0.004) pend.push(`${brl(t.aPagar)} a pagar`);
    $("#fin-resumo").innerHTML = `
      <div class="fin-saldo ${t.saldo < 0 ? "negativo" : ""}">
        <span class="fin-rotulo">Saldo ${modo === "ano" ? "do ano" : "do mês"}</span>
        <strong>${brl(t.saldo)}</strong>
        ${variacao(t.saldo, ant.saldo)}
        ${pend.length ? `<span class="fin-pendente">Fora do saldo: ${pend.join(" · ")}</span>` : ""}
      </div>
      <div class="fin-tile"><span class="fin-rotulo"><i style="background:var(--fin-entrada)"></i>Entrou</span><strong>${brl(t.entrou)}</strong>${variacao(t.entrou, ant.entrou)}</div>
      <div class="fin-tile"><span class="fin-rotulo"><i style="background:var(--fin-saida)"></i>Saiu</span><strong>${brl(t.saiu)}</strong>${variacao(t.saiu, ant.saiu, false)}</div>
      <div class="fin-tile"><span class="fin-rotulo">Vendas</span><strong>${t.vendas}</strong><span class="fin-delta">${t.pecas.toLocaleString("pt-BR")} peça${t.pecas === 1 ? "" : "s"}</span></div>
      <div class="fin-tile"><span class="fin-rotulo">Ticket médio</span><strong>${brl(t.ticket)}</strong><span class="fin-delta">por venda</span></div>`;
  }

  // Gráfico de colunas: 12 meses (do ano em "Ano"; os 12 até o mês escolhido em "Mês")
  function mesesDoGrafico() {
    const lista = [];
    if (modo === "ano") for (let m = 0; m < 12; m++) lista.push([ano, m]);
    else for (let i = 11; i >= 0; i--) { const d = new Date(ano, mes - i, 1); lista.push([d.getFullYear(), d.getMonth()]); }
    return lista.map(([y, m]) => {
      const t = totais(lancs.filter((l) => mesDe(l.data) === chaveMes(y, m)));
      return { y, m, entrou: t.entrou, saiu: t.saiu, saldo: t.saldo, atual: modo === "mes" && y === ano && m === mes };
    });
  }
  // Passo "redondo" do eixo (1, 2, 2,5 ou 5 × potência de 10) para 4 linhas
  function passoEixo(maximo) {
    const bruto = Math.max(maximo, 100) / 4;
    const p = Math.pow(10, Math.floor(Math.log10(bruto)));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= bruto) return k * p;
    return 10 * p;
  }
  function desenharGrafico() {
    const dados = mesesDoGrafico();
    const passo = passoEixo(Math.max(...dados.map((d) => Math.max(d.entrou, d.saiu)), 0));
    const max = passo * 4;
    const largCaixa = $("#fin-grafico").clientWidth || 760;
    const W = Math.max(300, Math.round(largCaixa)), H = W < 520 ? 200 : 240, esq = W < 520 ? 44 : 58, dir = 6, topo = 12, base = 28;
    const larg = (W - esq - dir) / dados.length;
    const barra = Math.max(4, Math.min(22, (larg - 8) / 2));
    const y = (v) => topo + (H - topo - base) * (1 - v / max);
    const coluna = (x, v, cor) => {
      if (v <= 0) return "";
      const y0 = H - base, y1 = y(v), r = Math.min(4, (y0 - y1) / 2, barra / 2);
      return `<path d="M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barra - r} Q${x + barra},${y1} ${x + barra},${y1 + r} V${y0} Z" fill="${cor}"/>`;
    };
    let svg = "";
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg += `<line x1="${esq}" x2="${W - dir}" y1="${yy}" y2="${yy}" class="fin-grade"/>`;
      svg += `<text x="${esq - 8}" y="${yy + 4}" text-anchor="end" class="fin-eixo">${v >= 1000 ? (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : v.toLocaleString("pt-BR")}</text>`;
    }
    dados.forEach((d, i) => {
      const cx = esq + larg * i + larg / 2;
      const xe = cx - barra - 1, xs = cx + 1; // 2px de espaço entre as duas colunas
      if (d.atual) svg += `<rect x="${esq + larg * i + 2}" y="${topo}" width="${larg - 4}" height="${H - topo - base}" rx="6" class="fin-mes-atual"/>`;
      svg += coluna(xe, d.entrou, "var(--fin-entrada)") + coluna(xs, d.saiu, "var(--fin-saida)");
      // Em telas estreitas, mostra o nome de um mês sim, outro não (e sempre o mês escolhido)
      const mostrarRotulo = larg >= 34 || d.atual || (dados.length - 1 - i) % 2 === 0;
      if (mostrarRotulo) svg += `<text x="${cx}" y="${H - 9}" text-anchor="middle" class="fin-eixo ${d.atual ? "forte" : ""}">${MESES_CURTOS[d.m]}${modo === "mes" && d.m === 0 && larg >= 34 ? " " + String(d.y).slice(2) : ""}</text>`;
      svg += `<rect x="${esq + larg * i}" y="${topo}" width="${larg}" height="${H - topo}" fill="transparent" class="fin-alvo" data-i="${i}" tabindex="0" role="button" aria-label="${MESES[d.m]} de ${d.y}: entrou ${brl(d.entrou)}, saiu ${brl(d.saiu)}, saldo ${brl(d.saldo)}"/>`;
    });
    svg += `<line x1="${esq}" x2="${W - dir}" y1="${H - base}" y2="${H - base}" class="fin-base"/>`;
    $("#fin-grafico").innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas dos últimos 12 meses">${svg}</svg><div class="fin-dica-grafico" hidden></div>`;
    $("#fin-grafico-tabela").innerHTML = `<table class="fin-tabela"><thead><tr><th>Mês</th><th class="num">Entrou</th><th class="num">Saiu</th><th class="num">Saldo</th></tr></thead><tbody>${dados
      .map((d) => `<tr><td>${MESES[d.m]} ${d.y}</td><td class="num">${brl(d.entrou)}</td><td class="num">${brl(d.saiu)}</td><td class="num ${d.saldo < 0 ? "neg" : ""}">${brl(d.saldo)}</td></tr>`)
      .join("")}</tbody></table>`;

    const caixa = $("#fin-grafico"), dica = caixa.querySelector(".fin-dica-grafico");
    const mostrarDica = (alvo) => {
      const d = dados[Number(alvo.dataset.i)];
      dica.innerHTML = `<strong>${MESES[d.m][0].toUpperCase() + MESES[d.m].slice(1)} de ${d.y}</strong>
        <span><i style="background:var(--fin-entrada)"></i>Entrou <b>${brl(d.entrou)}</b></span>
        <span><i style="background:var(--fin-saida)"></i>Saiu <b>${brl(d.saiu)}</b></span>
        <span class="fin-dica-saldo">Saldo <b class="${d.saldo < 0 ? "neg" : ""}">${brl(d.saldo)}</b></span>
        ${modo === "ano" || !d.atual ? `<em>Toque para abrir o mês</em>` : ""}`;
      dica.hidden = false;
      const r = alvo.getBoundingClientRect(), c = caixa.getBoundingClientRect();
      const x = r.left - c.left + r.width / 2;
      dica.style.left = Math.max(8, Math.min(c.width - dica.offsetWidth - 8, x - dica.offsetWidth / 2)) + "px";
    };
    caixa.querySelectorAll(".fin-alvo").forEach((a) => {
      a.addEventListener("mouseenter", () => mostrarDica(a));
      a.addEventListener("focus", () => mostrarDica(a));
      a.addEventListener("mouseleave", () => (dica.hidden = true));
      a.addEventListener("blur", () => (dica.hidden = true));
      const abrir = () => { const d = dados[Number(a.dataset.i)]; modo = "mes"; ano = d.y; mes = d.m; desenhar(); };
      a.addEventListener("click", abrir);
      a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
    });
  }

  function linhaVazia(texto) { return `<p class="fin-vazio">${texto}</p>`; }

  function desenharEntradas(lista) {
    $("#fin-n-entradas").textContent = lista.length ? `(${lista.length})` : "";
    if (!lista.length) {
      $("#fin-entradas").innerHTML = linhaVazia(busca ? "Nada encontrado nessa busca." : `Nenhuma venda ${modo === "ano" ? "neste ano" : "neste mês"}. Toque em <b>+ Venda</b> ou cole da planilha.`);
      return;
    }
    $("#fin-entradas").innerHTML = `<div class="fin-tabela-rolagem"><table class="fin-tabela">
      <thead><tr><th>Data</th><th>Cliente</th><th>Peça</th><th class="num">Qtd</th><th class="num">Valor</th><th>Pagamento</th></tr></thead>
      <tbody>${lista
        .map((l) => `<tr data-lanc="${l.id}" tabindex="0">
          <td class="fin-data">${dataBR(l.data)}</td>
          <td class="c-pri">${esc(l.cliente || "—")}</td>
          <td class="fin-desc c-sec">${esc(l.descricao)}${l.pedido_id ? ` <span class="fin-tag">pedido</span>` : ""}</td>
          <td class="num c-qtd"><span class="so-celular">Qtd </span>${n(l.quantidade).toLocaleString("pt-BR")}</td>
          <td class="num c-val"><b>${brl(l.valor)}</b></td>
          <td class="c-pag"><button type="button" class="fin-status ${l.pago ? "pago" : "pendente"}" data-alternar-pago="${l.id}" title="Toque para alternar">${l.pago ? "Pago" : "A receber"}</button></td>
        </tr>`)
        .join("")}</tbody></table></div>`;
  }

  function desenharSaidas(lista) {
    $("#fin-n-saidas").textContent = lista.length ? `(${lista.length})` : "";
    if (!lista.length) {
      $("#fin-saidas").innerHTML = linhaVazia(busca ? "Nada encontrado nessa busca." : `Nenhum gasto ${modo === "ano" ? "neste ano" : "neste mês"}. Toque em <b>+ Gasto</b> para registrar filamento, ferramentas, cursos…`);
      return;
    }
    $("#fin-saidas").innerHTML = `<div class="fin-tabela-rolagem"><table class="fin-tabela">
      <thead><tr><th>Data</th><th>O que saiu</th><th>Categoria</th><th class="num">Qtd</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${lista
        .map((l) => `<tr data-lanc="${l.id}" tabindex="0">
          <td class="fin-data">${dataBR(l.data)}</td>
          <td class="fin-desc c-pri">${esc(l.descricao)}</td>
          <td class="c-sec">${esc(l.categoria || "Outros")}</td>
          <td class="num c-qtd"><span class="so-celular">Qtd </span>${n(l.quantidade).toLocaleString("pt-BR")}</td>
          <td class="num c-val"><b>${brl(l.valor)}</b></td>
          <td class="c-pag">${l.pago ? "" : `<button type="button" class="fin-status pendente" data-alternar-pago="${l.id}">A pagar</button>`}</td>
        </tr>`)
        .join("")}</tbody></table></div>`;
  }

  function desenharCategorias(saidas) {
    const mapa = new Map();
    for (const l of saidas) mapa.set(l.categoria || "Outros", (mapa.get(l.categoria || "Outros") || 0) + l.valor);
    const itens = [...mapa].sort((a, b) => b[1] - a[1]);
    const total = itens.reduce((s, [, v]) => s + v, 0);
    if (!itens.length) { $("#fin-categorias").innerHTML = linhaVazia("Sem gastos no período."); return; }
    $("#fin-categorias").innerHTML = `<ul class="fin-barras">${itens
      .map(([nome, v]) => `<li><div class="fin-barra-topo"><span>${esc(nome)}</span><b>${brl(v)}</b></div>
        <div class="fin-barra-trilho"><span style="width:${Math.max(2, (v / itens[0][1]) * 100)}%;background:var(--fin-saida)"></span></div>
        <small>${((v / total) * 100).toFixed(0)}% dos gastos</small></li>`)
      .join("")}</ul>`;
  }

  function desenharRanking(sel, entradas, chave, mostrarQtd) {
    const mapa = new Map();
    for (const l of entradas) {
      const k = String(chave(l) || "").trim();
      if (!k) continue;
      // Junta "Andréia" e "Andreia", "Porta lata" e "porta-lata"
      const nome = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-\s]+/g, " ");
      const atual = mapa.get(nome) || { nome: k, valor: 0, qtd: 0, vezes: 0 };
      atual.valor += l.valor; atual.qtd += l.quantidade || 0; atual.vezes += 1;
      mapa.set(nome, atual);
    }
    const itens = [...mapa.values()].sort((a, b) => b.valor - a.valor).slice(0, 6);
    if (!itens.length) { $(sel).innerHTML = linhaVazia("Sem vendas no período."); return; }
    $(sel).innerHTML = `<ol class="fin-ranking">${itens
      .map((it) => `<li><span class="fin-rk-nome">${esc(it.nome)}</span>
        <span class="fin-rk-info">${mostrarQtd ? `${it.qtd.toLocaleString("pt-BR")} un.` : `${it.vezes} compra${it.vezes > 1 ? "s" : ""}`}</span>
        <b>${brl(it.valor)}</b></li>`)
      .join("")}</ol>`;
  }

  // Redesenha o gráfico quando a largura da tela muda (girar o celular, redimensionar a janela)
  let larguraAnterior = 0;
  window.addEventListener("resize", () => {
    clearTimeout(desenharGrafico.t);
    desenharGrafico.t = setTimeout(() => {
      const w = $("#fin-grafico").clientWidth;
      if (!$("#tela-financeiro").hidden && carregado && Math.abs(w - larguraAnterior) > 20) { larguraAnterior = w; desenharGrafico(); }
    }, 200);
  });

  // ---------- Navegação ----------
  $("#fin-anterior").addEventListener("click", () => { if (modo === "ano") ano--; else { mes--; if (mes < 0) { mes = 11; ano--; } } desenhar(); });
  $("#fin-proximo").addEventListener("click", () => { if (modo === "ano") ano++; else { mes++; if (mes > 11) { mes = 0; ano++; } } desenhar(); });
  $$("[data-fin-modo]").forEach((b) => b.addEventListener("click", () => { modo = b.dataset.finModo; desenhar(); }));
  $("#fin-busca").addEventListener("input", (e) => { busca = e.target.value; desenhar(); });

  // Pago / a receber com um toque
  $("#tela-financeiro").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-alternar-pago]");
    if (b) {
      e.stopPropagation();
      const l = lancs.find((x) => x.id === b.dataset.alternarPago);
      if (!l) return;
      l.pago = !l.pago;
      desenhar();
      const { error } = await db.from("lancamentos").update({ pago: l.pago, atualizado_em: new Date().toISOString() }).eq("id", l.id);
      if (error) { l.pago = !l.pago; desenhar(); avisar("Não consegui salvar: " + erroLegivel(error), true, 7000); }
      return;
    }
    const tr = e.target.closest("[data-lanc]");
    if (tr) abrirForm(lancs.find((x) => x.id === tr.dataset.lanc));
    const novo = e.target.closest("[data-novo-lanc]");
    if (novo) abrirForm(null, novo.dataset.novoLanc);
  });
  $("#tela-financeiro").addEventListener("keydown", (e) => {
    const tr = e.target.closest?.("[data-lanc]");
    if (tr && e.key === "Enter") abrirForm(lancs.find((x) => x.id === tr.dataset.lanc));
  });

  // ---------- Formulário ----------
  const dlg = $("#fin-dialogo");
  let tipoForm = "entrada";
  function aplicarTipo(t) {
    tipoForm = t;
    $$("[data-fin-tipo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.finTipo === t)));
    const venda = t === "entrada";
    $("#f-cliente-campo").hidden = !venda;
    $("#f-descricao-rotulo").textContent = venda ? "Peça vendida" : "O que saiu (ex.: Filamento preto PLA)";
    $("#f-pago-rotulo").textContent = venda ? "Já recebido" : "Já pago";
    $("#f-lista-categorias").innerHTML = (venda ? CAT_ENTRADA : CAT_SAIDA).map((c) => `<option value="${esc(c)}">`).join("");
    const descs = new Set([...lancs.filter((l) => l.tipo === t).map((l) => l.descricao), ...(venda ? estado.pecas.map((p) => p.nome) : [])]);
    $("#f-lista-descricoes").innerHTML = [...descs].filter(Boolean).slice(0, 200).map((d) => `<option value="${esc(d)}">`).join("");
    $("#fin-dialogo-titulo").textContent = (editando ? "Editar " : "Novo ") + (venda ? "venda" : "gasto");
    if (!editando) $("#fin-dialogo-titulo").textContent = venda ? "Nova venda" : "Novo gasto";
  }
  $$("[data-fin-tipo]").forEach((b) => b.addEventListener("click", () => aplicarTipo(b.dataset.finTipo)));

  function atualizarUnitario() {
    const q = n($("#f-quantidade").value), v = n($("#f-valor").value);
    $("#f-unitario").textContent = q > 1 && v > 0 ? `${brl(v / q)} cada` : "";
  }
  $("#f-quantidade").addEventListener("input", atualizarUnitario);
  $("#f-valor").addEventListener("input", atualizarUnitario);
  // Ao escolher uma peça do catálogo, sugere o preço da vitrine × quantidade
  $("#f-descricao").addEventListener("change", () => {
    if (tipoForm !== "entrada" || $("#f-valor").value) return;
    const p = estado.pecas.find((x) => x.nome.toLowerCase() === $("#f-descricao").value.trim().toLowerCase());
    if (p && n(p.precoVitrine) > 0) { $("#f-valor").value = (n(p.precoVitrine) * Math.max(1, n($("#f-quantidade").value))).toFixed(2); atualizarUnitario(); }
  });
  $("#f-descricao").addEventListener("change", () => {
    if (tipoForm !== "saida" || $("#f-categoria").value) return;
    $("#f-categoria").value = adivinharCategoria($("#f-descricao").value);
  });

  function abrirForm(l, tipo) {
    editando = l || null;
    const t = l ? l.tipo : tipo || "entrada";
    const padraoData = modo === "mes" && chaveMes(ano, mes) !== hojeISO().slice(0, 7) ? `${chaveMes(ano, mes)}-01` : hojeISO();
    $("#f-data").value = l?.data || padraoData;
    $("#f-cliente").value = l?.cliente || "";
    $("#f-descricao").value = l?.descricao || "";
    $("#f-quantidade").value = l ? n(l.quantidade) : 1;
    $("#f-valor").value = l ? n(l.valor).toFixed(2) : "";
    $("#f-categoria").value = l?.categoria || "";
    $("#f-forma").value = l?.forma || "";
    $("#f-pago").checked = l ? !!l.pago : true;
    $("#f-notas").value = l?.notas || "";
    $("#f-pedido").textContent = l?.pedido_id ? `Ligado ao pedido ${l.pedido_id}.` : "";
    $("#f-excluir").hidden = !l;
    $("#f-lista-clientes").innerHTML = [...new Set(lancs.map((x) => x.cliente).filter(Boolean))].slice(0, 300).map((c) => `<option value="${esc(c)}">`).join("");
    aplicarTipo(t);
    atualizarUnitario();
    dlg.showModal();
    setTimeout(() => (l ? $("#f-valor") : t === "entrada" ? $("#f-cliente") : $("#f-descricao")).focus(), 30);
  }

  $("#f-cancelar").addEventListener("click", () => dlg.close());
  $("#fin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const linha = {
      tipo: tipoForm,
      data: $("#f-data").value || hojeISO(),
      descricao: $("#f-descricao").value.trim(),
      cliente: tipoForm === "entrada" ? $("#f-cliente").value.trim() || null : null,
      quantidade: n($("#f-quantidade").value) || 1,
      valor: Math.round(n($("#f-valor").value) * 100) / 100,
      categoria: $("#f-categoria").value.trim() || (tipoForm === "saida" ? adivinharCategoria($("#f-descricao").value) : null),
      forma: $("#f-forma").value || null,
      pago: $("#f-pago").checked,
      notas: $("#f-notas").value.trim() || null,
      atualizado_em: new Date().toISOString(),
    };
    if (!linha.descricao) { avisar(tipoForm === "entrada" ? "Escreva qual peça foi vendida." : "Escreva o que foi comprado.", true); $("#f-descricao").focus(); return; }
    if (!(linha.valor > 0)) { avisar("Coloque o valor.", true); $("#f-valor").focus(); return; }
    $("#f-salvar").disabled = true;
    const req = editando ? db.from("lancamentos").update(linha).eq("id", editando.id).select().single() : db.from("lancamentos").insert(linha).select().single();
    const { data, error } = await req;
    $("#f-salvar").disabled = false;
    if (error) { avisar("Não consegui salvar: " + erroLegivel(error), true, 8000); return; }
    const salvo = { ...data, valor: n(data.valor), quantidade: n(data.quantidade) };
    const i = lancs.findIndex((x) => x.id === salvo.id);
    i >= 0 ? (lancs[i] = salvo) : lancs.unshift(salvo);
    dlg.close();
    // Vai para o mês do lançamento, para ele aparecer na tela
    const [y, m] = salvo.data.split("-").map(Number);
    if (modo === "mes") { ano = y; mes = m - 1; } else ano = y;
    desenhar();
    avisar(salvo.tipo === "entrada" ? "Venda salva." : "Gasto salvo.");
  });
  $("#f-excluir").addEventListener("click", async () => {
    if (!editando || !confirm(`Excluir "${editando.descricao}" (${brl(editando.valor)})?`)) return;
    const { error } = await db.from("lancamentos").delete().eq("id", editando.id);
    if (error) { avisar("Não consegui excluir: " + erroLegivel(error), true, 7000); return; }
    lancs = lancs.filter((x) => x.id !== editando.id);
    dlg.close();
    desenhar();
    avisar("Lançamento excluído.");
  });

  // ---------- Colar da planilha ----------
  const imp = $("#fin-importar");
  let impTipo = "entrada";
  let impLinhas = [];

  function adivinharCategoria(texto) {
    const t = String(texto || "").toLowerCase();
    if (/filament|pla\b|petg|abs\b|tpu|rolo|silk/.test(t)) return "Filamento";
    // Só o nome de uma cor (ex.: "Azul claro") quase sempre é um rolo de filamento
    if (/^(preto|branco|cinza|vermelho|laranja|amarelo|verde|azul|roxo|rosa|marrom|bege|dourado|prata|transparente|capuccino|lil[aá]s|vinho|creme)(\s+(claro|escuro|beb[eê]|pastel|neon|fosco|silk))?$/.test(t.trim())) return "Filamento";
    if (/curso|aula|treinamento/.test(t)) return "Curso";
    if (/bico|hotend|mesa|placa|correia|pe[cç]a de reposi|manuten/.test(t)) return "Peças e manutenção";
    if (/ferrament|alicate|lixa|estilete|cola|tinta|pincel/.test(t)) return "Ferramentas";
    if (/embalag|caixa|caixinh|saquinho|sacola|etiqueta|papel/.test(t)) return "Embalagem";
    if (/energia|luz|eletric/.test(t)) return "Energia";
    if (/anúnc|anunc|impulsion|ads/.test(t)) return "Anúncios";
    if (/frete|correio|envio|uber|motoboy/.test(t)) return "Frete";
    return "Outros";
  }
  const numeroBR = (s) => {
    let t = String(s || "").replace(/[R$\s]/g, "");
    if (!t) return NaN;
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
    return Number(t);
  };
  const ehPago = (s) => /^(pg|pago|ok|sim|s|x|✓|lg|pix|recebido)$/i.test(String(s || "").trim());

  function interpretar(texto, tipo) {
    const linhas = String(texto || "").split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
    const res = [];
    for (const bruta of linhas) {
      const c = (bruta.includes("\t") ? bruta.split("\t") : bruta.split(/;|\s{2,}/)).map((x) => x.trim());
      if (/^(clientes?|sa[ií]da|relat[oó]rio|aloca[cç][aã]o)/i.test(c[0])) continue; // cabeçalhos
      if (tipo === "entrada") {
        const [cliente, peca, qtd, valor, pag] = c;
        if (!cliente && !peca) continue;
        const v = numeroBR(valor);
        res.push({ cliente, descricao: peca, quantidade: numeroBR(qtd) || 1, valor: v, pago: ehPago(pag), pagTexto: pag || "", ok: !!peca && v > 0 });
      } else {
        const [desc, qtd, valor] = c;
        if (!desc) continue;
        const v = numeroBR(valor);
        res.push({ descricao: desc, quantidade: numeroBR(qtd) || 1, valor: v, categoria: adivinharCategoria(desc), pago: true, ok: v > 0 });
      }
    }
    return res;
  }

  function desenharPrevia() {
    impLinhas = interpretar($("#imp-texto").value, impTipo);
    const validas = impLinhas.filter((l) => l.ok);
    const ignoradas = impLinhas.length - validas.length;
    $("#imp-confirmar").disabled = !validas.length || !$("#imp-mes").value;
    $("#imp-confirmar").textContent = validas.length ? `Importar ${validas.length} ${impTipo === "entrada" ? "venda" : "gasto"}${validas.length > 1 ? "s" : ""}` : "Importar";
    if (!impLinhas.length) { $("#imp-previa").innerHTML = ""; return; }
    const total = validas.reduce((s, l) => s + l.valor, 0);
    const cab = impTipo === "entrada"
      ? "<th>Cliente</th><th>Peça</th><th class='num'>Qtd</th><th class='num'>Valor</th><th>Pago?</th>"
      : "<th>O que saiu</th><th>Categoria</th><th class='num'>Qtd</th><th class='num'>Valor</th>";
    $("#imp-previa").innerHTML = `<p class="dica">Prévia: ${validas.length} linha${validas.length === 1 ? "" : "s"}, total ${brl(total)}${ignoradas ? `. ${ignoradas} sem valor ficam de fora (em cinza).` : "."}${impTipo === "entrada" ? " Desmarque as que ainda não foram pagas." : ""}</p>
      <div class="fin-tabela-rolagem imp-rolagem"><table class="fin-tabela"><thead><tr>${cab}</tr></thead><tbody>${impLinhas
        .map((l, i) => `<tr class="${l.ok ? "" : "imp-ignorada"}">${impTipo === "entrada"
          ? `<td>${esc(l.cliente || "—")}</td><td>${esc(l.descricao || "—")}</td><td class="num">${l.quantidade}</td><td class="num">${Number.isFinite(l.valor) ? brl(l.valor) : "—"}</td><td><input type="checkbox" data-imp-pago="${i}" ${l.pago ? "checked" : ""} ${l.ok ? "" : "disabled"} aria-label="Pago"> <small>${esc(l.pagTexto)}</small></td>`
          : `<td>${esc(l.descricao)}</td><td><select data-imp-cat="${i}">${CAT_SAIDA.map((c) => `<option ${c === l.categoria ? "selected" : ""}>${c}</option>`).join("")}</select></td><td class="num">${l.quantidade}</td><td class="num">${Number.isFinite(l.valor) ? brl(l.valor) : "—"}</td>`}</tr>`)
        .join("")}</tbody></table></div>`;
  }
  function aplicarImpTipo(t) {
    impTipo = t;
    $$("[data-imp-tipo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.impTipo === t)));
    $("#imp-colunas").textContent = t === "entrada" ? "Colunas esperadas: Cliente · Peça · Quantidade · Valor · Pagamento (Pg = pago)" : "Colunas esperadas: Saída · Quantidade · Valor";
    $("#imp-texto").placeholder = t === "entrada" ? "Andréia\tAbridor de ampola\t1\t12\tPg" : "Filamentos Preto\t5\t456,93";
    desenharPrevia();
  }
  $$("[data-imp-tipo]").forEach((b) => b.addEventListener("click", () => aplicarImpTipo(b.dataset.impTipo)));
  $("#imp-texto").addEventListener("input", desenharPrevia);
  $("#imp-mes").addEventListener("input", desenharPrevia);
  $("#imp-previa").addEventListener("change", (e) => {
    const p = e.target.closest("[data-imp-pago]"); if (p) impLinhas[Number(p.dataset.impPago)].pago = p.checked;
    const c = e.target.closest("[data-imp-cat]"); if (c) impLinhas[Number(c.dataset.impCat)].categoria = c.value;
  });
  $("#fin-colar").addEventListener("click", () => {
    $("#imp-texto").value = "";
    $("#imp-mes").value = chaveMes(ano, mes);
    aplicarImpTipo("entrada");
    imp.showModal();
    setTimeout(() => $("#imp-texto").focus(), 30);
  });
  $("#imp-cancelar").addEventListener("click", () => imp.close());
  $("#imp-confirmar").addEventListener("click", async () => {
    const data = `${$("#imp-mes").value}-01`;
    const linhas = impLinhas.filter((l) => l.ok).map((l) => ({
      tipo: impTipo, data,
      descricao: String(l.descricao).slice(0, 300),
      cliente: impTipo === "entrada" ? (l.cliente || null) : null,
      quantidade: l.quantidade || 1,
      valor: Math.round(l.valor * 100) / 100,
      categoria: impTipo === "saida" ? l.categoria : null,
      pago: !!l.pago,
      notas: "Importado da planilha",
    }));
    $("#imp-confirmar").disabled = true;
    const { data: salvos, error } = await db.from("lancamentos").insert(linhas).select();
    $("#imp-confirmar").disabled = false;
    if (error) { avisar("Não consegui importar: " + erroLegivel(error), true, 8000); return; }
    lancs.unshift(...salvos.map((x) => ({ ...x, valor: n(x.valor), quantidade: n(x.quantidade) })));
    imp.close();
    const [y, m] = $("#imp-mes").value.split("-").map(Number);
    modo = "mes"; ano = y; mes = m - 1;
    desenhar();
    avisar(`${salvos.length} lançamento${salvos.length > 1 ? "s" : ""} importado${salvos.length > 1 ? "s" : ""}.`);
  });

  // ---------- Baixar CSV ----------
  $("#fin-csv").addEventListener("click", () => {
    const lista = lancs.filter(noPeriodo).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const num = (v) => n(v).toFixed(2).replace(".", ",");
    const linhas = [["Data", "Tipo", "Cliente", "Descrição", "Categoria", "Quantidade", "Valor", "Situação", "Forma", "Pedido", "Observações"].map(cel).join(";")];
    for (const l of lista) {
      linhas.push([dataBR(l.data) + "/" + String(l.data).slice(0, 4), l.tipo === "entrada" ? "Entrada" : "Saída", l.cliente, l.descricao, l.categoria, num(l.quantidade), num(l.valor),
        l.pago ? (l.tipo === "entrada" ? "Recebido" : "Pago") : (l.tipo === "entrada" ? "A receber" : "A pagar"), l.forma, l.pedido_id, l.notas].map(cel).join(";"));
    }
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hpr-financeiro-${modo === "ano" ? ano : chaveMes(ano, mes)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------- Pedidos entregues viram venda ----------
  O.lancarPedido = async function (p) {
    if (!p || p.status !== "entregue" || !(n(p.valor) > 0)) return "";
    if (!carregado) { try { await carregar(); } catch { return ""; } }
    if (lancs.some((l) => l.pedido_id === p.id && l.tipo === "entrada")) return "";
    const linha = {
      tipo: "entrada", data: hojeISO(), descricao: p.peca || "Pedido " + p.id, cliente: p.cliente || null,
      quantidade: n(p.quantidade) || 1, valor: Math.round(n(p.valor) * 100) / 100, categoria: "Encomenda",
      pago: true, pedido_id: p.id, notas: "Lançado automaticamente ao entregar o pedido",
    };
    const { data, error } = await db.from("lancamentos").insert(linha).select().single();
    if (error) return "";
    lancs.unshift({ ...data, valor: n(data.valor), quantidade: n(data.quantidade) });
    return ` Venda de ${brl(linha.valor)} lançada no Financeiro.`;
  };

  // ---------- Entrada na aba ----------
  O.ganchos.financeiro = async () => {
    if (carregado) { desenhar(); return; }
    $("#fin-resumo").innerHTML = `<p class="dica">Carregando o financeiro…</p>`;
    try {
      await carregar();
      desenhar();
    } catch (e) {
      $("#fin-resumo").innerHTML = `<div class="vazio"><strong>Não consegui abrir o financeiro</strong>${esc(erroLegivel(e))}.</div>`;
    }
  };
  O.ganchos.sairFinanceiro = () => { lancs = []; carregado = false; };
})();
