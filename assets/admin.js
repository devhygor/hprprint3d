// Oficina HPR Print 3D: cadastro de peças e precificação, salvando direto no GitHub.
(function () {
  const P = window.Precificador;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const brl = (v) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ARQ = {
    catalogo: "data/catalogo.json",
    site: "data/site.json",
    pecas: "pecas.json",
    pedidos: "pedidos.json",
    config: "config.json",
  };
  const COR_ITENS = {
    filamento: ["Filamento", "var(--coral)"],
    energia: ["Energia", "var(--sol)"],
    desgaste: ["Desgaste da impressora", "var(--lilas)"],
    falha: ["Reserva p/ falhas", "#ff9fb2"],
    maoDeObra: ["Mão de obra", "var(--menta)"],
    embalagem: ["Embalagem e acabamento", "#7cc4ff"],
    licenca: ["Licença", "#d9d2ff"],
    outros: ["Outros", "#8b84b3"],
  };

  // ---------- Estado ----------
  const estado = {
    token: lerLocal("hpr_token"),
    repoSite: lerLocal("hpr_repo_site") || "devhygor/hprprint3d",
    repoDados: lerLocal("hpr_repo_dados") || "devhygor/hprprint3d-dados",
    config: P.mesclar(P.CONFIG_PADRAO, {}),
    pecas: [],
    catalogo: [],
    site: {},
    sha: {},
    editando: null, // id da peça em edição
    fotoNova: null, // { base64, ext, dataUrl }
    fotoAtual: "",
  };

  function lerLocal(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }
  function gravarLocal(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} }

  let timerAviso;
  function avisar(msg, erro = false, ms = 3800) {
    const el = $("#aviso");
    el.textContent = msg;
    el.classList.toggle("erro", erro);
    el.hidden = false;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => (el.hidden = true), ms);
  }

  // ---------- GitHub ----------
  const b64enc = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64dec = (b64) => decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));

  async function gh(caminho, opcoes = {}) {
    const r = await fetch("https://api.github.com" + caminho, {
      ...opcoes,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + estado.token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
    });
    if (r.status === 204) return null;
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(corpo.message || "Erro " + r.status);
      e.status = r.status;
      throw e;
    }
    return corpo;
  }

  async function lerJson(repo, caminho) {
    try {
      const r = await gh(`/repos/${repo}/contents/${caminho}?ref=main&t=${Date.now()}`);
      estado.sha[repo + ":" + caminho] = r.sha;
      return JSON.parse(b64dec(r.content));
    } catch (e) {
      if (e.status === 404) { estado.sha[repo + ":" + caminho] = undefined; return null; }
      throw e;
    }
  }

  async function gravarArquivo(repo, caminho, base64, mensagem) {
    const chave = repo + ":" + caminho;
    const tentar = () =>
      gh(`/repos/${repo}/contents/${caminho}`, {
        method: "PUT",
        body: JSON.stringify({ message: mensagem, content: base64, branch: "main", ...(estado.sha[chave] ? { sha: estado.sha[chave] } : {}) }),
      });
    let r;
    try {
      r = await tentar();
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      // Alguém salvou antes: pega a versão nova e tenta de novo
      try {
        const atual = await gh(`/repos/${repo}/contents/${caminho}?ref=main&t=${Date.now()}`);
        estado.sha[chave] = atual.sha;
      } catch (e2) { if (e2.status === 404) estado.sha[chave] = undefined; else throw e2; }
      r = await tentar();
    }
    estado.sha[chave] = r.content.sha;
    return r;
  }

  const gravarJson = (repo, caminho, dados, msg) => gravarArquivo(repo, caminho, b64enc(JSON.stringify(dados, null, 2) + "\n"), msg);
  const urlBruta = (caminho) => `https://raw.githubusercontent.com/${estado.repoSite}/main/${caminho}`;
  const urlFoto = (caminho) => (!caminho ? "" : /^https?:/.test(caminho) ? caminho : urlBruta(caminho));

  // ---------- Navegação ----------
  function mostrar(aba) {
    ["conectar", "pedidos", "pedido", "pecas", "editor", "custos", "loja"].forEach((t) => ($("#tela-" + t).hidden = t !== aba));
    const abaMenu = aba === "pedido" ? "pedidos" : aba;
    $$(".aba").forEach((b) => (b.dataset.aba === abaMenu ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    window.Oficina?.ganchos?.[aba]?.();
    $$(".aba").forEach((b) => (b.dataset.aba === aba ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    if (aba === "pecas") desenharLista();
    if (aba === "custos") preencherCustos();
    if (aba === "loja") preencherLoja();
    window.scrollTo({ top: 0 });
  }
  $("#abas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-aba]");
    if (!b) return;
    if (b.dataset.aba === "editor") abrirEditor(null);
    else mostrar(b.dataset.aba);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ir]");
    if (b) abrirEditor(null);
  });

  // ---------- Conectar ----------
  $("#form-conectar").addEventListener("submit", async (e) => {
    e.preventDefault();
    estado.token = $("#token").value.trim();
    estado.repoSite = $("#repo-site").value.trim();
    estado.repoDados = $("#repo-dados").value.trim();
    await conectar(true);
  });

  async function conectar(novo) {
    try {
      avisar("Carregando dados da loja…", false, 20000);
      const [config, pecas, pedidos, catalogo, site] = await Promise.all([
        lerJson(estado.repoDados, ARQ.config),
        lerJson(estado.repoDados, ARQ.pecas),
        lerJson(estado.repoDados, ARQ.pedidos),
        lerJson(estado.repoSite, ARQ.catalogo),
        lerJson(estado.repoSite, ARQ.site),
      ]);
      estado.config = P.mesclar(P.CONFIG_PADRAO, config || {});
      estado.pecas = Array.isArray(pecas) ? pecas : [];
      estado.pedidos = Array.isArray(pedidos) ? pedidos : [];
      estado.catalogo = Array.isArray(catalogo) ? catalogo : [];
      estado.site = site || {};
      if (novo) {
        gravarLocal("hpr_token", estado.token);
        gravarLocal("hpr_repo_site", estado.repoSite);
        gravarLocal("hpr_repo_dados", estado.repoDados);
      }
      $("#abas").hidden = false;
      $("#aviso").hidden = true;
      mostrar("pedidos");
    } catch (e) {
      $("#abas").hidden = true;
      mostrar("conectar");
      const msg = e.status === 401 ? "Chave inválida ou vencida. Crie uma nova chave." : e.status === 404 ? "Repositório não encontrado. Confira os nomes e se a chave tem acesso aos dois." : "Não consegui conectar: " + e.message;
      avisar(msg, true, 8000);
    }
  }

  // ---------- Lista de peças ----------
  function desenharLista() {
    const alvo = $("#lista-pecas");
    if (!estado.pecas.length) {
      alvo.innerHTML = `<div class="vazio"><strong>Nenhuma peça cadastrada</strong>Cole um link do MakerWorld ou cadastre uma peça própria para ver quanto custa produzir.<br><br><button class="botao botao-principal" type="button" data-ir="editor">Cadastrar peça</button></div>`;
      return;
    }
    const linhas = [...estado.pecas]
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.nome).localeCompare(b.nome))
      .map((p) => {
        const r = P.precificar(p, estado.config);
        const pub = estado.catalogo.find((c) => c.id === p.id);
        const preco = P.num(p.precoVitrine, NaN);
        const lucro = Number.isFinite(preco) ? P.analisar(preco, r.custo.total, estado.config.canais.direta, P.num(estado.config.impostoPct)).lucro : NaN;
        return `<tr>
          <td>${p.foto ? `<img class="mini" src="${esc(urlFoto(p.foto))}" alt="">` : `<span class="mini"></span>`}</td>
          <td class="nome">${esc(p.nome)}<small>${esc(p.categoria || "Sem categoria")}</small></td>
          <td class="num">${brl(r.custo.total)}</td>
          <td class="num ocultar-celular">${brl(r.canais.direta.sugerido)}</td>
          <td class="num">${brl(preco)}</td>
          <td class="num ocultar-celular ${lucro < 0 ? "neg" : ""}">${brl(lucro)}</td>
          <td class="ocultar-celular"><span class="etiqueta ${pub && pub.ativo !== false ? "ativa" : ""}">${pub && pub.ativo !== false ? "Na vitrine" : "Oculta"}</span></td>
          <td><div class="botoes-linha">
            <button class="botao botao-contorno botao-pequeno" type="button" data-editar="${esc(p.id)}">Editar</button>
            <button class="botao botao-contorno botao-pequeno" type="button" data-excluir="${esc(p.id)}" aria-label="Excluir ${esc(p.nome)}">Excluir</button>
          </div></td>
        </tr>`;
      })
      .join("");
    alvo.innerHTML = `<div style="overflow-x:auto"><table class="tabela-pecas">
      <thead><tr><th></th><th>Peça</th><th class="num">Custo</th><th class="num ocultar-celular">Sugerido</th><th class="num">Na vitrine</th><th class="num ocultar-celular">Lucro (direta)</th><th class="ocultar-celular">Status</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>`;
  }

  $("#lista-pecas").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-editar]");
    if (ed) return abrirEditor(ed.dataset.editar);
    const ex = e.target.closest("[data-excluir]");
    if (!ex) return;
    const p = estado.pecas.find((x) => x.id === ex.dataset.excluir);
    if (!p || !confirm(`Excluir "${p.nome}"? Ela sai da vitrine também.`)) return;
    try {
      estado.pecas = estado.pecas.filter((x) => x.id !== p.id);
      estado.catalogo = estado.catalogo.filter((x) => x.id !== p.id);
      await gravarJson(estado.repoDados, ARQ.pecas, estado.pecas, `Remove peça: ${p.nome}`);
      await gravarJson(estado.repoSite, ARQ.catalogo, estado.catalogo, `Remove da vitrine: ${p.nome}`);
      desenharLista();
      avisar("Peça excluída.");
    } catch (err) { avisar("Não consegui excluir: " + err.message, true); }
  });

  // ---------- Editor ----------
  const CAMPOS = {
    makerworld: "#p-makerworld", nome: "#p-nome", categoria: "#p-categoria", ordem: "#p-ordem", descricao: "#p-descricao",
    gramas: "#p-gramas", horas: "#p-horas", minutos: "#p-minutos", pecasPorImpressao: "#p-qtd", falhaPct: "#p-falha",
    trabalhoMinutos: "#p-trabalho", acabamento: "#p-acabamento", embalagem: "#p-embalagem", licenca: "#p-licenca",
    outros: "#p-outros", margemPct: "#p-margem", precoVitrine: "#p-preco",
  };
  const PADRAO_PECA = { horas: 0, minutos: 0, pecasPorImpressao: 1, trabalhoMinutos: 0, acabamento: 0, licenca: 0, outros: 0, ordem: 0 };
  let precoEditadoManual = false;

  function abrirEditor(id) {
    const p = id ? estado.pecas.find((x) => x.id === id) : null;
    estado.editando = p ? p.id : null;
    estado.fotoNova = null;
    estado.idBusca = null;
    estado.fotoAtual = p?.foto || "";
    precoEditadoManual = !!(p && p.precoVitrine);
    $("#titulo-editor").textContent = p ? "Editar peça" : "Nova peça";
    const dados = { ...PADRAO_PECA, ...(p || {}) };
    for (const [k, sel] of Object.entries(CAMPOS)) $(sel).value = dados[k] ?? "";
    const pub = p && estado.catalogo.find((c) => c.id === p.id);
    $("#p-ativo").checked = p ? !!(pub && pub.ativo !== false) : true;
    $("#lista-categorias").innerHTML = [...new Set(estado.pecas.map((x) => x.categoria).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
    estado.fotoSalva = estado.fotoAtual;
    $("#p-foto-url").value = /^https?:/.test(estado.fotoAtual) ? estado.fotoAtual : "";
    $("#p-makerworld").dispatchEvent(new Event("input"));
    desenharFoto();
    mostrar("editor");
    $$(".aba").forEach((b) => (b.dataset.aba === "editor" ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    calcular();
  }

  function lerFormulario() {
    const p = {};
    for (const [k, sel] of Object.entries(CAMPOS)) p[k] = $(sel).value.trim();
    return p;
  }

  function desenharFoto() {
    const src = estado.fotoNova?.dataUrl || urlFoto(estado.fotoAtual);
    $("#foto-previa").innerHTML = src ? `<img src="${esc(src)}" alt="Foto da peça">` : `<span>Sem foto</span>`;
  }


  function calcular() {
    const p = lerFormulario();
    const r = P.precificar(p, estado.config);
    $("#r-custo").textContent = brl(r.custo.total);

    const itens = Object.entries(r.custo.itens).filter(([, v]) => v > 0.004);
    const total = r.custo.total || 1;
    $("#r-itens").innerHTML =
      `<div class="barra" aria-hidden="true">${itens.map(([k, v]) => `<span style="--cor:${COR_ITENS[k][1]};width:${(v / total) * 100}%"></span>`).join("")}</div>` +
      itens.map(([k, v]) => `<dt style="--cor:${COR_ITENS[k][1]}">${COR_ITENS[k][0]}</dt><dd>${brl(v)}</dd>`).join("");

    $("#r-canais").innerHTML = Object.values(r.canais)
      .map((c) => `<tr><td>${esc(c.nome)}</td><td class="destaque">${brl(c.sugerido)}</td><td>${brl(c.recebe)}</td><td class="${c.lucro < 0 ? "neg" : "pos"}">${brl(c.lucro)}</td></tr>`)
      .join("");
    $("#r-minimo").textContent = Number.isFinite(r.canais.direta.minimo) ? `Abaixo de ${brl(r.canais.direta.minimo)} na venda direta vocês têm prejuízo. Margem usada: ${r.margem}%.` : "Margem + taxas passam de 100%. Diminua a margem.";

    if (!precoEditadoManual) $("#p-preco").value = Number.isFinite(r.canais.direta.sugerido) && r.custo.total > 0 ? r.canais.direta.sugerido.toFixed(2) : "";
    const preco = P.num($("#p-preco").value, NaN);
    if (Number.isFinite(preco) && preco > 0) {
      const a = P.analisar(preco, r.custo.total, estado.config.canais.direta, P.num(estado.config.impostoPct));
      $("#r-teste").className = "dica" + (a.lucro < 0 ? " erro" : "");
      $("#r-teste").textContent = `Vendendo por ${brl(preco)} direto: lucro de ${brl(a.lucro)} por peça (${a.margemReal.toFixed(0)}% do preço).`;
    } else $("#r-teste").textContent = "";
    return r;
  }
  $("#form-peca").addEventListener("input", calcular);
  $("#p-preco").addEventListener("input", () => { precoEditadoManual = $("#p-preco").value !== ""; calcular(); });

  // Foto enviada: reduz para no máximo 1200 px antes de salvar
  $("#p-foto-arquivo").addEventListener("change", async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;
    try {
      const img = await new Promise((ok, falha) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = falha;
        i.src = URL.createObjectURL(arq);
      });
      const max = 1200;
      const fator = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * fator);
      c.height = Math.round(img.height * fator);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.85);
      estado.fotoNova = { dataUrl, base64: dataUrl.split(",")[1], ext: "jpg" };
      $("#p-foto-url").value = "";
      desenharFoto();
    } catch { avisar("Não consegui abrir essa imagem. Tente uma foto JPG ou PNG.", true); }
    e.target.value = "";
  });

  // ---------- Foto e link do MakerWorld ----------
  const novoId = (nome) =>
    (String(nome || "peca").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "peca") +
    "-" + Date.now().toString(36);

  const ehUrlFoto = (u) => /^https:\/\/\S+$/i.test(u);
  $("#p-foto-url").addEventListener("input", (e) => {
    const u = e.target.value.trim();
    if (u && !ehUrlFoto(u)) return;
    estado.fotoNova = null;
    estado.fotoAtual = u || estado.fotoSalva || "";
    desenharFoto();
  });
  $("#p-makerworld").addEventListener("input", (e) => {
    const u = e.target.value.trim();
    $("#abrir-mw").href = /^https?:\/\/(www\.)?makerworld\.com\//i.test(u) ? u : "https://makerworld.com/";
  });

  // ---------- Salvar peça ----------
  $("#salvar-peca").addEventListener("click", async () => {
    const f = lerFormulario();
    if (!f.nome) { avisar("Dê um nome para a peça.", true); $("#p-nome").focus(); return; }
    const botao = $("#salvar-peca");
    botao.disabled = true;
    try {
      const id = estado.editando || estado.idBusca || novoId(f.nome);
      let foto = estado.fotoAtual;
      if (estado.fotoNova) {
        foto = `img/pecas/${id}.${estado.fotoNova.ext}`;
        avisar("Enviando foto…", false, 20000);
        await gravarArquivo(estado.repoSite, foto, estado.fotoNova.base64, `Foto: ${f.nome}`);
      }
      const r = P.precificar(f, estado.config);
      const interno = {
        ...f,
        id,
        foto,
        custoNoCadastro: Math.round(r.custo.total * 100) / 100,
        atualizadoEm: new Date().toISOString(),
      };
      const publico = {
        id,
        nome: f.nome,
        categoria: f.categoria || "",
        descricao: f.descricao || "",
        foto,
        preco: P.num(f.precoVitrine, 0) || null,
        ativo: $("#p-ativo").checked,
        ordem: P.num(f.ordem, 0),
      };
      const i = estado.pecas.findIndex((x) => x.id === id);
      i >= 0 ? (estado.pecas[i] = interno) : estado.pecas.push(interno);
      const j = estado.catalogo.findIndex((x) => x.id === id);
      j >= 0 ? (estado.catalogo[j] = publico) : estado.catalogo.push(publico);

      avisar("Salvando…", false, 20000);
      await gravarJson(estado.repoDados, ARQ.pecas, estado.pecas, `${i >= 0 ? "Atualiza" : "Nova"} peça: ${f.nome}`);
      await gravarJson(estado.repoSite, ARQ.catalogo, estado.catalogo, `Vitrine: ${f.nome}`);
      estado.idBusca = null;
      avisar("Peça salva. A vitrine atualiza em cerca de 1 minuto.");
      mostrar("pecas");
    } catch (e) {
      avisar("Não consegui salvar: " + e.message, true, 8000);
    } finally {
      botao.disabled = false;
    }
  });
  $("#cancelar-peca").addEventListener("click", () => { estado.idBusca = null; mostrar("pecas"); });

  // ---------- Custos ----------
  const obterCaminho = (obj, cam) => cam.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  function definirCaminho(obj, cam, v) {
    const ks = cam.split(".");
    let o = obj;
    ks.slice(0, -1).forEach((k) => (o = o[k]));
    o[ks.at(-1)] = v;
  }

  function preencherCustos() {
    $$("#form-custos [data-c]").forEach((el) => (el.value = obterCaminho(estado.config, el.dataset.c) ?? ""));
    desenharFaixas();
    atualizarPrecoGrama();
  }
  function atualizarPrecoGrama() {
    const g = P.num(estado.config.filamento.precoRolo) / Math.max(1, P.num(estado.config.filamento.pesoRolo, 1000));
    $("#c-preco-grama").textContent = `Cada grama sai por ${brl(g)}.`;
  }
  function desenharFaixas() {
    const html = ["shopee", "mercadolivre"]
      .map((id) => {
        const c = estado.config.canais[id];
        const faixas = c.faixas
          .map((f, i) => `<div class="faixa">
            <label class="campo">Preço até (R$)<input type="number" step="0.01" data-c="canais.${id}.faixas.${i}.ate" value="${f.ate ?? ""}" placeholder="sem limite"></label>
            <label class="campo">Comissão (%)<input type="number" step="0.1" data-c="canais.${id}.faixas.${i}.comissaoPct" value="${f.comissaoPct}"></label>
            <label class="campo">Tarifa fixa (R$)<input type="number" step="0.01" data-c="canais.${id}.faixas.${i}.fixo" value="${f.fixo}"></label>
          </div>`)
          .join("");
        const frete = id === "mercadolivre"
          ? `<div class="faixa"><label class="campo">Frete grátis a partir de (R$)<input type="number" step="0.01" data-c="canais.mercadolivre.freteAcimaDe" value="${c.freteAcimaDe ?? ""}"></label><label class="campo">Custo médio do frete (R$)<input type="number" step="0.01" data-c="canais.mercadolivre.freteValor" value="${c.freteValor ?? 0}"></label></div>`
          : "";
        return `<div class="canal-faixas"><h3>${esc(c.nome)}</h3>${faixas}${frete}</div>`;
      })
      .join("");
    $("#c-faixas").innerHTML = html;
  }
  $("#form-custos").addEventListener("input", (e) => {
    const el = e.target.closest("[data-c]");
    if (!el) return;
    let v = el.value;
    if (el.type === "number") v = v === "" ? (el.dataset.c.endsWith(".ate") ? null : 0) : P.num(v);
    definirCaminho(estado.config, el.dataset.c, v);
    if (el.id === "c-modelo") {
      const kw = el.selectedOptions[0]?.dataset.kw;
      if (kw) { estado.config.impressora.consumoKw = Number(kw); $('[data-c="impressora.consumoKw"]').value = kw; }
    }
    atualizarPrecoGrama();
  });
  $("#salvar-custos").addEventListener("click", async () => {
    try {
      await gravarJson(estado.repoDados, ARQ.config, estado.config, "Atualiza custos da oficina");
      avisar("Custos salvos.");
    } catch (e) { avisar("Não consegui salvar: " + e.message, true); }
  });

  // ---------- Loja ----------
  function preencherLoja() {
    $("#l-whatsapp").value = estado.site.whatsapp || "";
    $("#l-instagram").value = estado.site.instagram || "https://www.instagram.com/hprprint3d/";
    $("#l-destaques").value = (estado.site.destaquesInstagram || []).join("\n");
  }
  $("#salvar-loja").addEventListener("click", async () => {
    let zap = $("#l-whatsapp").value.replace(/\D/g, "");
    if (zap && zap.length <= 11) zap = "55" + zap;
    estado.site = {
      ...estado.site,
      nome: estado.site.nome || "HPR Print 3D",
      whatsapp: zap,
      instagram: $("#l-instagram").value.trim(),
      destaquesInstagram: $("#l-destaques").value
        .split(/\s+/)
        .map((u) => u.trim().split("?")[0])
        .filter((u) => /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//.test(u))
        .slice(0, 9),
    };
    try {
      await gravarJson(estado.repoSite, ARQ.site, estado.site, "Atualiza dados da loja");
      $("#l-whatsapp").value = zap;
      $("#l-destaques").value = estado.site.destaquesInstagram.join("\n");
      avisar("Dados da loja salvos.");
    } catch (e) { avisar("Não consegui salvar: " + e.message, true); }
  });
  $("#sair").addEventListener("click", () => {
    gravarLocal("hpr_token", "");
    estado.token = "";
    $("#abas").hidden = true;
    $("#token").value = "";
    mostrar("conectar");
  });

  // ---------- API para outros módulos (pedidos.js) ----------
  window.Oficina = Object.assign(window.Oficina || {}, { estado, ARQ, gravarJson, lerJson, avisar, mostrar, brl, esc, $, $$ });
  window.Oficina.ganchos = window.Oficina.ganchos || {};

  // ---------- Início ----------
  $("#repo-site").value = estado.repoSite;
  $("#repo-dados").value = estado.repoDados;
  if (estado.token) conectar(false);
  else mostrar("conectar");
})();
