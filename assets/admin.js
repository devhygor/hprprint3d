// Oficina HPR Print 3D: pedidos, peças, custos e loja. Tudo salvo no Supabase com login por e-mail e senha.
(function () {
  const P = window.Precificador;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const brl = (v) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
    config: P.mesclar(P.CONFIG_PADRAO, {}),
    pecas: [],
    pedidos: [],
    site: {},
    editando: null, // id da peça em edição
    fotos: [], // galeria da peça em edição: { url } já salvas ou { dataUrl } novas
  };


  let timerAviso;
  function avisar(msg, erro = false, ms = 3800) {
    const el = $("#aviso");
    el.textContent = msg;
    el.classList.toggle("erro", erro);
    el.hidden = false;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => (el.hidden = true), ms);
  }

  // ---------- Supabase ----------
  const cfgSb = window.HPR_SUPABASE || {};
  const db = window.supabase && cfgSb.url ? window.supabase.createClient(cfgSb.url, cfgSb.chave) : null;

  function erroLegivel(e) {
    const m = String(e?.message || e || "");
    if (/fetch|network|Failed to/i.test(m)) return "sem conexão com o banco. Confira a internet; se faz tempo que ninguém usa, o Supabase pode ter pausado o projeto";
    if (/row-level security|permission|policy|violates/i.test(m)) return "esse login não tem permissão. Confira se o e-mail está na lista da equipe no Supabase";
    if (/relation .* does not exist|Could not find the table/i.test(m)) return "as tabelas ainda não foram criadas. Rode o docs/supabase.sql no SQL Editor do Supabase";
    if (/Could not find the '.*' column|column .* does not exist/i.test(m)) return "o banco está desatualizado. Rode o docs/supabase.sql de novo no SQL Editor do Supabase";
    if (/tempo esgotado|demorou/i.test(m)) return m + ". O Supabase pode estar pausado";
    return m;
  }
  async function lerAjuste(chave) {
    const { data, error } = await db.from("ajustes").select("valor").eq("chave", chave).maybeSingle();
    if (error) throw error;
    return data?.valor || null;
  }
  async function gravarAjuste(chave, valor) {
    const { error } = await db.from("ajustes").upsert({ chave, valor, atualizado_em: new Date().toISOString() });
    if (error) throw error;
  }
  // Linha da tabela "pecas" -> objeto usado pela oficina
  const deLinhaPeca = (r) => ({
    ...(r.interno || {}),
    id: r.id, nome: r.nome, categoria: r.categoria || "", descricao: r.descricao || "", foto: r.foto || "",
    fotos: Array.isArray(r.fotos) && r.fotos.length ? r.fotos : r.foto ? [r.foto] : [],
    ordem: r.ordem ?? 0, precoVitrine: r.preco ?? "", ativo: r.ativo !== false,
    cores: Array.isArray(r.cores) ? r.cores : [],
    caracteristicas: r.caracteristicas && typeof r.caracteristicas === "object" ? r.caracteristicas : {},
  });
  async function enviarFoto(id, dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const caminho = `pecas/${id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
    const { error } = await db.storage.from("fotos").upload(caminho, blob, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    return db.storage.from("fotos").getPublicUrl(caminho).data.publicUrl;
  }
  const urlFoto = (c) => c || "";
  // Foto guardada no nosso Supabase (não expira) x link de fora (Instagram, MakerWorld…), que pode sumir
  const ehFotoNossa = (u) => String(u || "").includes("/storage/v1/object/public/fotos/");
  // Baixa a imagem de fora (ou a do post do Instagram) e guarda no Supabase
  async function importarFoto(url) {
    const { data, error } = await db.functions.invoke("importar-foto", { body: { url } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).erro || msg; } catch {}
      throw new Error(msg);
    }
    if (!data?.url) throw new Error(data?.erro || "não consegui importar");
    return data.url;
  }

  // ---------- Navegação ----------
  function mostrar(aba) {
    ["conectar", "pedidos", "pedido", "pecas", "editor", "financeiro", "custos", "loja"].forEach((t) => ($("#tela-" + t).hidden = t !== aba));
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
    const ir = e.target.closest("[data-aba-ir]");
    if (ir) { mostrar(ir.dataset.abaIr); return; }
    const b = e.target.closest("[data-ir]");
    if (b) abrirEditor(null);
  });

  // ---------- Entrar ----------
  $("#entrar-google").addEventListener("click", async () => {
    const { error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) avisar(/not enabled|Unsupported provider/i.test(error.message) ? "O login com Google ainda não foi ativado no Supabase." : "Não consegui abrir o Google: " + erroLegivel(error), true, 8000);
  });
  $("#form-conectar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const botao = e.target.querySelector("button[type=submit]");
    botao.disabled = true;
    const { error } = await db.auth.signInWithPassword({ email: $("#lp-email").value.trim(), password: $("#lp-senha").value });
    botao.disabled = false;
    if (error) {
      avisar(/invalid/i.test(error.message) ? "E-mail ou senha incorretos." : "Não consegui entrar: " + erroLegivel(error), true, 6000);
      return;
    }
    $("#lp-senha").value = "";
    conectar();
  });

  // Promessa com limite de tempo: se o banco não responder, a tela não fica travada
  const comLimite = (promessa, ms, motivo) =>
    Promise.race([promessa, new Promise((_, falha) => setTimeout(() => falha(new Error(motivo || "tempo esgotado")), ms))]);

  // Confere se o Supabase está no ar antes de tudo (o projeto gratuito pausa quando fica parado)
  async function bancoNoAr() {
    try {
      const r = await comLimite(fetch(`${cfgSb.url}/auth/v1/health`, { headers: { apikey: cfgSb.chave } }), 8000);
      return r.status < 500;
    } catch { return false; }
  }

  function mostrarBancoFora() {
    $("#abas").hidden = true;
    mostrar("conectar");
    $("#entrada-campos").hidden = true;
    $("#estado-banco").hidden = false;
    $("#estado-banco").className = "estado-banco erro";
    $("#estado-banco").innerHTML = `<strong>O banco de dados não está respondendo</strong>
      <span>O mais provável é que o Supabase tenha pausado o projeto por falta de uso. Para voltar:</span>
      <ol>
        <li>Abra <a href="https://supabase.com/dashboard/project/jigtikrzkmbcknbnxulk" target="_blank" rel="noopener">o projeto no Supabase</a>.</li>
        <li>Clique em <b>Restore project</b> e espere alguns minutos.</li>
        <li>Volte aqui e toque em Tentar de novo.</li>
      </ol>
      <button class="botao botao-principal" type="button" id="tentar-de-novo">Tentar de novo</button>`;
    $("#tentar-de-novo").addEventListener("click", conectar);
  }

  async function conectar() {
    if (!db) {
      mostrar("conectar");
      avisar("Não consegui carregar o Supabase. Confira a internet e recarregue a página.", true, 10000);
      return;
    }
    // Mostra a tela de entrada na hora, com um aviso de que está verificando
    mostrar("conectar");
    $("#abas").hidden = true;
    $("#entrada-campos").hidden = true;
    $("#estado-banco").hidden = false;
    $("#estado-banco").className = "estado-banco";
    $("#estado-banco").textContent = "Conectando ao banco de dados…";
    if (!(await bancoNoAr())) { mostrarBancoFora(); return; }
    let data;
    try {
      ({ data } = await comLimite(db.auth.getSession(), 10000, "o login demorou para responder"));
    } catch {
      data = { session: null };
    }
    $("#estado-banco").hidden = true;
    $("#entrada-campos").hidden = false;
    if (!data.session) { $("#abas").hidden = true; mostrar("conectar"); return; }
    try {
      avisar("Carregando dados da loja…", false, 20000);
      const { data: daEquipe, error: erroEquipe } = await comLimite(db.rpc("eh_equipe"), 15000, "o banco demorou para responder");
      if (erroEquipe) throw erroEquipe;
      if (!daEquipe) {
        await db.auth.signOut();
        $("#abas").hidden = true;
        mostrar("conectar");
        avisar(`O e-mail ${data.session.user.email} não está na lista da equipe. Adicione na tabela "equipe" do Supabase.`, true, 10000);
        return;
      }
      const [config, site, ia, pecas] = await comLimite(Promise.all([
        lerAjuste("config"),
        lerAjuste("site"),
        lerAjuste("ia").catch(() => null),
        db.from("pecas").select("*").order("ordem").then(({ data, error }) => { if (error) throw error; return data; }),
      ]), 20000, "o banco demorou para responder");
      estado.config = P.mesclar(P.CONFIG_PADRAO, config || {});
      estado.site = site || {};
      estado.ia = ia || {};
      estado.pecas = (pecas || []).map(deLinhaPeca);
      estado.usuario = data.session.user.email;
      $("#quem").textContent = estado.usuario;
      $("#abas").hidden = false;
      $("#aviso").hidden = true;
      mostrar("pedidos");
    } catch (e) {
      $("#abas").hidden = true;
      mostrar("conectar");
      avisar("Não consegui carregar: " + erroLegivel(e), true, 10000);
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
        const preco = P.num(p.precoVitrine, NaN);
        const lucro = Number.isFinite(preco) ? P.analisar(preco, r.custo.total, estado.config.canais.direta, P.num(estado.config.impostoPct)).lucro : NaN;
        return `<tr data-id="${esc(p.id)}">
          <td class="col-alca"><button type="button" class="alca" aria-label="Mudar a posição de ${esc(p.nome)} na vitrine (setas para cima e para baixo)" title="Arraste para mudar a ordem">⋮⋮</button></td>
          <td>${p.foto ? `<img class="mini" src="${esc(urlFoto(p.foto))}" alt="">` : `<span class="mini"></span>`}</td>
          <td class="nome">${esc(p.nome)}<small>${esc(p.categoria || "Sem categoria")}</small></td>
          <td class="num">${brl(r.custo.total)}</td>
          <td class="num ocultar-celular">${brl(r.canais.direta.sugerido)}</td>
          <td class="num">${brl(preco)}</td>
          <td class="num ocultar-celular ${lucro < 0 ? "neg" : ""}">${brl(lucro)}</td>
          <td class="ocultar-celular"><span class="etiqueta ${p.ativo ? "ativa" : ""}">${p.ativo ? "Na vitrine" : "Oculta"}</span></td>
          <td><div class="botoes-linha">
            <button class="botao botao-contorno botao-pequeno" type="button" data-editar="${esc(p.id)}">Editar</button>
            <button class="botao botao-contorno botao-pequeno" type="button" data-excluir="${esc(p.id)}" aria-label="Excluir ${esc(p.nome)}">Excluir</button>
          </div></td>
        </tr>`;
      })
      .join("");
    const externas = estado.pecas.reduce((n, p) => n + (p.fotos || []).filter((u) => !ehFotoNossa(u)).length, 0);
    const avisoFotos = externas ? `<div class="aviso-fotos">
        <p><b>${externas} foto${externas > 1 ? "s estão" : " está"} com link de fora</b> (Instagram, MakerWorld…). Esses links expiram e a foto some da vitrine.</p>
        <button class="botao botao-principal botao-pequeno" type="button" id="importar-externas">Guardar todas no Supabase</button>
      </div>` : "";
    alvo.innerHTML = avisoFotos + `<p class="dica dica-ordem">Arraste pelo <b>⋮⋮</b> para mudar a ordem em que as peças aparecem na vitrine. Salva sozinho.</p>
      <div style="overflow-x:auto"><table class="tabela-pecas">
      <thead><tr><th><span class="sr-only">Ordem</span></th><th></th><th>Peça</th><th class="num">Custo</th><th class="num ocultar-celular">Sugerido</th><th class="num">Na vitrine</th><th class="num ocultar-celular">Lucro (direta)</th><th class="ocultar-celular">Status</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>`;
  }

  // ---------- Ordem da vitrine: arrastar na lista ----------
  // Funciona com mouse e com o dedo (eventos de ponteiro) e pelo teclado (setas no ⋮⋮).
  const corpoLista = () => $("#lista-pecas tbody");
  let salvandoOrdem = Promise.resolve();
  function salvarOrdem() {
    const ids = [...corpoLista().querySelectorAll("tr[data-id]")].map((tr) => tr.dataset.id);
    const mudou = [];
    ids.forEach((id, i) => {
      const p = estado.pecas.find((x) => x.id === id);
      if (p && Number(p.ordem) !== i + 1) { p.ordem = i + 1; mudou.push(p); }
    });
    if (!mudou.length) return;
    salvandoOrdem = salvandoOrdem.then(async () => {
      try {
        const res = await Promise.all(mudou.map((p) => db.from("pecas").update({ ordem: p.ordem }).eq("id", p.id)));
        const erro = res.find((r) => r.error)?.error;
        if (erro) throw erro;
        avisar("Ordem da vitrine salva.");
      } catch (err) {
        avisar("Não consegui salvar a ordem: " + erroLegivel(err), true, 7000);
        const { data } = await db.from("pecas").select("*").order("ordem");
        if (data) { estado.pecas = data.map(deLinhaPeca); desenharLista(); }
      }
    });
  }
  let arraste = null;
  $("#lista-pecas").addEventListener("pointerdown", (e) => {
    const alca = e.target.closest(".alca");
    if (!alca || e.button > 0) return;
    e.preventDefault();
    const tr = alca.closest("tr");
    alca.setPointerCapture(e.pointerId);
    tr.classList.add("arrastando");
    document.body.classList.add("ordenando");
    arraste = { tr, alca, antes: [...corpoLista().children].indexOf(tr), y: e.clientY, rolar: 0 };
    const rolar = () => {
      if (!arraste) return;
      const borda = 70, y = arraste.y;
      const v = y < borda ? -Math.ceil((borda - y) / 6) : y > innerHeight - borda ? Math.ceil((y - innerHeight + borda) / 6) : 0;
      if (v) { scrollBy(0, v); moverPara(y); }
      arraste.rolar = requestAnimationFrame(rolar);
    };
    arraste.rolar = requestAnimationFrame(rolar);
  });
  function moverPara(y) {
    const { tr } = arraste;
    const outras = [...corpoLista().children].filter((x) => x !== tr);
    const depois = outras.find((x) => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (depois) { if (tr.nextElementSibling !== depois) corpoLista().insertBefore(tr, depois); }
    else if (corpoLista().lastElementChild !== tr) corpoLista().appendChild(tr);
  }
  $("#lista-pecas").addEventListener("pointermove", (e) => {
    if (!arraste) return;
    arraste.y = e.clientY;
    moverPara(e.clientY);
  });
  const soltar = () => {
    if (!arraste) return;
    cancelAnimationFrame(arraste.rolar);
    arraste.tr.classList.remove("arrastando");
    document.body.classList.remove("ordenando");
    const mudou = [...corpoLista().children].indexOf(arraste.tr) !== arraste.antes;
    arraste = null;
    if (mudou) salvarOrdem();
  };
  $("#lista-pecas").addEventListener("pointerup", soltar);
  $("#lista-pecas").addEventListener("pointercancel", soltar);
  let esperaTeclado = 0;
  $("#lista-pecas").addEventListener("keydown", (e) => {
    const alca = e.target.closest(".alca");
    if (!alca || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const tr = alca.closest("tr");
    const vizinha = e.key === "ArrowUp" ? tr.previousElementSibling : tr.nextElementSibling;
    if (!vizinha) return;
    if (e.key === "ArrowUp") vizinha.before(tr); else vizinha.after(tr);
    alca.focus();
    clearTimeout(esperaTeclado);
    esperaTeclado = setTimeout(salvarOrdem, 700);
  });

  // Traz todas as fotos de fora para o Supabase de uma vez
  async function importarExternas(botao) {
    botao.disabled = true;
    const falhas = [];
    let feitas = 0;
    for (const p of estado.pecas) {
      const fotos = [...(p.fotos || [])];
      let mudou = false;
      for (let i = 0; i < fotos.length; i++) {
        if (ehFotoNossa(fotos[i])) continue;
        botao.textContent = `Trazendo fotos… (${feitas + falhas.length + 1})`;
        try { fotos[i] = await importarFoto(fotos[i]); mudou = true; feitas++; }
        catch (e) { falhas.push(`${p.nome} (${String(e.message).replace(/\.$/, "")})`); }
      }
      if (!mudou) continue;
      const { error } = await db.from("pecas").update({ fotos, foto: fotos[0] || null }).eq("id", p.id);
      if (error) { falhas.push(`${p.nome}: ${erroLegivel(error)}`); continue; }
      p.fotos = fotos;
      p.foto = fotos[0] || "";
    }
    desenharLista();
    avisar(falhas.length
      ? `${feitas} foto${feitas === 1 ? "" : "s"} guardada${feitas === 1 ? "" : "s"}. Não deu para: ${falhas.join("; ")}. Nessas, adicione de novo pelo link do post ou do celular.`
      : `Pronto! ${feitas} foto${feitas === 1 ? "" : "s"} guardada${feitas === 1 ? "" : "s"} no Supabase. Elas não expiram mais.`, falhas.length > 0, 15000);
  }

  $("#lista-pecas").addEventListener("click", async (e) => {
    const imp = e.target.closest("#importar-externas");
    if (imp) return importarExternas(imp);
    const ed = e.target.closest("[data-editar]");
    if (ed) return abrirEditor(ed.dataset.editar);
    const ex = e.target.closest("[data-excluir]");
    if (!ex) return;
    const p = estado.pecas.find((x) => x.id === ex.dataset.excluir);
    if (!p || !confirm(`Excluir "${p.nome}"? Ela sai da vitrine também.`)) return;
    try {
      const { error } = await db.from("pecas").delete().eq("id", p.id);
      if (error) throw error;
      estado.pecas = estado.pecas.filter((x) => x.id !== p.id);
      desenharLista();
      avisar("Peça excluída.");
    } catch (err) { avisar("Não consegui excluir: " + erroLegivel(err), true, 7000); }
  });

  // ---------- Editor ----------
  const STATUS_MW = "Cole o link do modelo: ao colar, o nome, as fotos (copiadas para o Supabase), o material, as cores, as gramas e o tempo já vêm preenchidos. Tudo pode ser editado. As medidas o MakerWorld não informa, preencha em Características. As gramas e o tempo são do perfil de impressão do autor; se vocês fatiam diferente, ajuste no Bambu Studio.";
  const CAMPOS = {
    makerworld: "#p-makerworld", nome: "#p-nome", categoria: "#p-categoria", ordem: "#p-ordem", descricao: "#p-descricao",
    gramas: "#p-gramas", horas: "#p-horas", minutos: "#p-minutos", pecasPorImpressao: "#p-qtd", falhaPct: "#p-falha",
    trabalhoMinutos: "#p-trabalho", acabamento: "#p-acabamento", embalagem: "#p-embalagem", licenca: "#p-licenca",
    outros: "#p-outros", margemPct: "#p-margem", precoVitrine: "#p-preco",
    precoRolo: "#p-preco-rolo", desgasteHora: "#p-desgaste", valorHora: "#p-valor-hora", preparoMinutos: "#p-preparo",
  };
  // Padrões vindos da aba Custos para os campos marcados com data-padrao
  const padroes = () => ({
    precoRolo: P.num(estado.config.filamento.precoRolo),
    desgasteHora: P.num(estado.config.impressora.desgasteHora),
    falhaPct: P.num(estado.config.falhaPct),
    valorHora: P.num(estado.config.trabalho.valorHora),
    preparoMinutos: Math.round(P.num(estado.config.trabalho.preparoHoras) * 60),
    embalagem: P.num(estado.config.embalagemPeca),
    margemPct: P.num(estado.config.margemPct),
  });
  function preencherPadroes(p, forcar) {
    const pad = padroes();
    $$("#form-peca [data-padrao]").forEach((el) => {
      const k = el.dataset.padrao;
      const proprio = !forcar && p && p[k] !== undefined && p[k] !== null && p[k] !== "";
      el.value = proprio ? p[k] : pad[k];
    });
    marcarPersonalizados();
  }
  function marcarPersonalizados() {
    const pad = padroes();
    $$("#form-peca [data-padrao]").forEach((el) => {
      const diferente = el.value !== "" && P.num(el.value, NaN) !== pad[el.dataset.padrao];
      el.classList.toggle("personalizado", diferente);
      el.title = diferente ? `Padrão da aba Custos: ${pad[el.dataset.padrao]}` : "";
    });
  }
  $("#p-restaurar").addEventListener("click", () => { preencherPadroes(null, true); calcular(); });
  const PADRAO_PECA = { horas: 0, minutos: 0, pecasPorImpressao: 1, trabalhoMinutos: 0, acabamento: 0, licenca: 0, outros: 0, ordem: 0 };
  let precoEditadoManual = false;

  // ---------- Cores e características ----------
  const CORES_PADRAO = [
    ["Preto", "#1b1b1f"], ["Branco", "#f5f5f2"], ["Cinza", "#8a8d93"], ["Vermelho", "#d7263d"], ["Laranja", "#f46a1f"],
    ["Amarelo", "#f6c90e"], ["Verde", "#2e9e4f"], ["Azul", "#1f5fd6"], ["Azul claro", "#6ec3f4"], ["Roxo", "#7b3fe4"],
    ["Rosa", "#f27bb5"], ["Marrom", "#7a4a2a"], ["Bege", "#d9c3a0"], ["Dourado", "#c9a227"], ["Prata", "#c0c4cc"],
    ["Transparente", "transparente"],
  ];
  let coresSel = []; // [{ nome, hex }]
  const amostra = (hex) => (hex === "transparente"
    ? "background:repeating-conic-gradient(#d9d2ff 0 25%, #fff 0 50%) 0 0/8px 8px"
    : `background:${hex}`);
  function desenharCores() {
    const extras = coresSel.filter((c) => !CORES_PADRAO.some(([n]) => n.toLowerCase() === c.nome.toLowerCase()));
    const todas = [...CORES_PADRAO.map(([nome, hex]) => ({ nome, hex })), ...extras];
    $("#cores-opcoes").innerHTML = todas
      .map((c) => {
        const ativa = coresSel.some((x) => x.nome.toLowerCase() === c.nome.toLowerCase());
        return `<button type="button" class="chip-cor" aria-pressed="${ativa}" data-cor="${esc(c.nome)}" data-hex="${esc(c.hex)}"><span class="bolinha" style="${amostra(c.hex)}"></span>${esc(c.nome)}</button>`;
      })
      .join("");
  }
  $("#cores-opcoes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cor]");
    if (!b) return;
    const i = coresSel.findIndex((c) => c.nome.toLowerCase() === b.dataset.cor.toLowerCase());
    if (i >= 0) coresSel.splice(i, 1); else coresSel.push({ nome: b.dataset.cor, hex: b.dataset.hex });
    desenharCores();
  });
  $("#cor-adicionar").addEventListener("click", () => {
    const nome = $("#cor-nova-nome").value.trim().slice(0, 40);
    if (!nome) { $("#cor-nova-nome").focus(); return; }
    if (!coresSel.some((c) => c.nome.toLowerCase() === nome.toLowerCase())) coresSel.push({ nome, hex: $("#cor-nova-hex").value });
    $("#cor-nova-nome").value = "";
    desenharCores();
  });
  $("#cor-nova-nome").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#cor-adicionar").click(); } });

  function linhaExtra(nome = "", valor = "") {
    const el = document.createElement("div");
    el.className = "c-extra";
    el.innerHTML = `<input class="c-extra-nome" placeholder="Característica" value="${esc(nome)}" aria-label="Nome da característica">
      <input class="c-extra-valor" placeholder="Valor (opcional)" value="${esc(valor)}" aria-label="Valor da característica">
      <button type="button" class="c-extra-tirar" aria-label="Remover característica">×</button>`;
    $("#c-extras").appendChild(el);
    return el;
  }
  $("#c-extra-adicionar").addEventListener("click", () => linhaExtra().querySelector("input").focus());
  $("#c-extras").addEventListener("click", (e) => { const b = e.target.closest(".c-extra-tirar"); if (b) b.parentElement.remove(); });

  // ---------- Kit: várias peças na mesma caixa ----------
  function linhaKit(k = {}) {
    const el = document.createElement("div");
    el.className = "c-kit-linha";
    const num = (v) => (v ?? "") === "" ? "" : v;
    el.innerHTML = `<input class="c-kit-nome" placeholder="Peça (ex.: Maria)" value="${esc(k.nome || "")}" aria-label="Nome da peça do kit">
      <input class="c-kit-l" type="number" inputmode="decimal" step="0.1" min="0" placeholder="Larg." value="${num(k.largura)}" aria-label="Largura em cm">
      <input class="c-kit-p" type="number" inputmode="decimal" step="0.1" min="0" placeholder="Prof." value="${num(k.profundidade)}" aria-label="Profundidade em cm">
      <input class="c-kit-a" type="number" inputmode="decimal" step="0.1" min="0" placeholder="Alt." value="${num(k.altura)}" aria-label="Altura em cm">
      <input class="c-kit-g" type="number" inputmode="decimal" step="1" min="0" placeholder="Peso g" value="${num(k.peso)}" aria-label="Peso em gramas">
      <input class="c-kit-q" type="number" inputmode="numeric" step="1" min="1" max="20" placeholder="Qtd" value="${num(k.qtd || 1)}" aria-label="Quantidade desta peça no kit">
      <button type="button" class="c-kit-tirar" aria-label="Remover peça do kit">×</button>`;
    $("#c-kit").appendChild(el);
    return el;
  }
  function lerKit() {
    const n = (el, s) => { const v = P.num(el.querySelector(s).value, NaN); return Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null; };
    return $$("#c-kit .c-kit-linha").map((el) => ({
      nome: el.querySelector(".c-kit-nome").value.trim().slice(0, 60),
      largura: n(el, ".c-kit-l"), profundidade: n(el, ".c-kit-p"), altura: n(el, ".c-kit-a"), peso: n(el, ".c-kit-g"),
      qtd: Math.max(1, Math.min(20, Math.round(P.num(el.querySelector(".c-kit-q").value, 1)) || 1)),
    })).filter((k) => k.nome || k.largura || k.profundidade || k.altura || k.peso);
  }
  // Soma o kit: a menor caixa onde cabem todas as peças e o peso total vão para os campos de medidas e peso,
  // que são os que o frete já usa
  function recalcularKit() {
    const resumo = $("#c-kit-resumo");
    const kit = lerKit();
    const completas = kit.filter((k) => k.largura && k.profundidade && k.altura);
    if (!completas.length) { resumo.hidden = true; return; }
    const todas = completas.flatMap((k) => Array.from({ length: k.qtd }, () => k));
    const cx = HPR_3MF.caixaConjunto(todas);
    const r1 = (x) => Math.round(x * 10) / 10;
    $("#c-largura").value = r1(cx.largura);
    $("#c-profundidade").value = r1(cx.profundidade);
    $("#c-altura").value = r1(cx.altura);
    const comPeso = kit.every((k) => k.peso) && kit.length;
    let txt = `Caixa do kit (${todas.length} ${todas.length === 1 ? "peça" : "peças"} juntas): ${r1(cx.largura)} × ${r1(cx.profundidade)} × ${r1(cx.altura)} cm`;
    if (comPeso) {
      const total = kit.reduce((s, k) => s + k.peso * k.qtd, 0);
      $("#c-peso").value = Math.round(total);
      txt += `, ${Math.round(total)} g`;
    } else txt += ". Falta o peso de alguma peça: o peso total continua o que está no campo acima";
    if (completas.length < kit.length) txt += ". Há peça sem as três medidas e ela ficou fora da conta";
    resumo.textContent = txt + ". Conta aproximada (fila ou pilha), confira se cabe na caixa real.";
    resumo.hidden = false;
  }
  $("#c-kit-adicionar").addEventListener("click", () => linhaKit().querySelector("input").focus());
  $("#c-kit").addEventListener("input", recalcularKit);
  $("#c-kit").addEventListener("click", (e) => { const b = e.target.closest(".c-kit-tirar"); if (b) { b.parentElement.remove(); recalcularKit(); } });

  function preencherCaracteristicas(c = {}) {
    $("#c-kit").innerHTML = "";
    $("#c-kit-resumo").hidden = true;
    (c.kit || []).forEach((k) => linhaKit(k));
    $("#c-largura").value = c.largura ?? "";
    $("#c-altura").value = c.altura ?? "";
    $("#c-profundidade").value = c.profundidade ?? "";
    $("#c-peso").value = c.peso ?? "";
    $("#c-material").value = c.material ?? "";
    $("#c-extras").innerHTML = "";
    (c.extras || []).forEach((x) => linhaExtra(x.nome, x.valor));
  }
  function lerCaracteristicas() {
    const n = (sel) => { const v = P.num($(sel).value, NaN); return Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null; };
    const c = {
      largura: n("#c-largura"), altura: n("#c-altura"), profundidade: n("#c-profundidade"), peso: n("#c-peso"),
      material: $("#c-material").value.trim().slice(0, 40) || null,
      kit: lerKit().slice(0, 30),
      extras: $$("#c-extras .c-extra")
        .map((el) => ({ nome: el.querySelector(".c-extra-nome").value.trim().slice(0, 40), valor: el.querySelector(".c-extra-valor").value.trim().slice(0, 60) }))
        .filter((x) => x.nome)
        .slice(0, 10),
    };
    for (const k of Object.keys(c)) if (c[k] === null || (Array.isArray(c[k]) && !c[k].length)) delete c[k];
    return c;
  }

  function atualizarContador() {
    const n = $("#p-descricao").value.length;
    $("#p-descricao-contador").textContent = `${n} de 1000 caracteres. Na vitrine aparecem as primeiras linhas, com "Ver mais".`;
  }
  $("#p-descricao").addEventListener("input", atualizarContador);

  function abrirEditor(id) {
    const p = id ? estado.pecas.find((x) => x.id === id) : null;
    estado.editando = p ? p.id : null;
    estado.idBusca = null;
    estado.fotos = (p?.fotos || []).map((url) => ({ url }));
    precoEditadoManual = !!(p && p.precoVitrine);
    $("#titulo-editor").textContent = p ? "Editar peça" : "Nova peça";
    // Peça nova entra no fim da vitrine
    const ultima = Math.max(0, ...estado.pecas.map((x) => Number(x.ordem) || 0));
    const dados = { ...PADRAO_PECA, ordem: ultima + 1, ...(p || {}) };
    for (const [k, sel] of Object.entries(CAMPOS)) $(sel).value = dados[k] ?? "";
    preencherPadroes(p, false);
    coresSel = (p?.cores || []).map((c) => ({ nome: String(c.nome || ""), hex: String(c.hex || "#cccccc") })).filter((c) => c.nome);
    desenharCores();
    $("#p-cor-personalizada").checked = !!p?.caracteristicas?.outrasCores;
    preencherCaracteristicas(p?.caracteristicas || {});
    atualizarContador();
    $("#p-ativo").checked = p ? p.ativo !== false : true;
    $("#lista-categorias").innerHTML = [...new Set(estado.pecas.map((x) => x.categoria).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
    $("#p-foto-url").value = "";
    $("#status-mw").className = "dica";
    $("#status-mw").textContent = STATUS_MW;
    $("#p-makerworld").dispatchEvent(new Event("input"));
    desenharGaleria();
    mostrar("editor");
    $$(".aba").forEach((b) => (b.dataset.aba === "editor" ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    calcular();
  }

  function lerFormulario() {
    const p = {};
    for (const [k, sel] of Object.entries(CAMPOS)) p[k] = $(sel).value.trim();
    return p;
  }

  // ---------- Galeria de fotos da peça ----------
  const MAX_FOTOS = 10;
  const srcFoto = (f) => f.dataUrl || urlFoto(f.url);
  function desenharGaleria() {
    const lista = estado.fotos;
    $("#galeria-contador").textContent = `${lista.length} de ${MAX_FOTOS}`;
    $("#galeria-edit").innerHTML = lista.length
      ? lista.map((f, i) => `<li class="galeria-item${i === 0 ? " capa" : ""}">
          <img src="${esc(srcFoto(f))}" alt="Foto ${i + 1} da peça">
          ${i === 0 ? `<span class="galeria-selo">Capa</span>` : ""}
          <div class="galeria-mover">
            <button type="button" class="galeria-btn" data-mover="${i}" data-dir="-1" aria-label="Mover foto ${i + 1} para a esquerda" ${i === 0 ? "disabled" : ""}>‹</button>
            ${i === 0 ? "" : `<button type="button" class="galeria-btn galeria-capa" data-capa="${i}" title="Usar como capa" aria-label="Usar a foto ${i + 1} como capa">★</button>`}
            <button type="button" class="galeria-btn" data-mover="${i}" data-dir="1" aria-label="Mover foto ${i + 1} para a direita" ${i === lista.length - 1 ? "disabled" : ""}>›</button>
            <button type="button" class="galeria-btn" data-ia="${i}" title="Gerar foto de vitrine com IA a partir desta foto" aria-label="Gerar foto de vitrine com IA a partir da foto ${i + 1}">✨</button>
            <button type="button" class="galeria-btn galeria-tirar" data-tirar="${i}" aria-label="Remover foto ${i + 1}">×</button>
          </div>
          ${f.dataUrl ? `<span class="galeria-nova">nova</span>` : ""}
        </li>`).join("")
      : `<li class="galeria-vazia">Nenhuma foto ainda</li>`;
    $("#p-fotos-arquivos").closest("label").classList.toggle("desativado", lista.length >= MAX_FOTOS);
  }
  $("#galeria-edit").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const f = estado.fotos;
    if (b.dataset.ia) { gerarFotoIA(Number(b.dataset.ia)); return; }
    if (b.dataset.tirar) f.splice(Number(b.dataset.tirar), 1);
    else if (b.dataset.capa) f.unshift(...f.splice(Number(b.dataset.capa), 1));
    else if (b.dataset.mover) {
      const i = Number(b.dataset.mover), j = i + Number(b.dataset.dir);
      if (j >= 0 && j < f.length) [f[i], f[j]] = [f[j], f[i]];
    }
    desenharGaleria();
  });


  // Foto de vitrine com IA: o PC recorta a peça e cria só o cenário; a nova foto entra logo depois da original
  let gerandoFoto = false;
  async function gerarFotoIA(i) {
    const st = $("#status-foto-ia");
    const origem = estado.fotos[i];
    if (!origem || gerandoFoto) return;
    if (estado.fotos.length >= MAX_FOTOS) { avisar(`O limite é de ${MAX_FOTOS} fotos por peça.`, true); return; }
    gerandoFoto = true;
    $$("#galeria-edit [data-ia]").forEach((b) => (b.disabled = true));
    st.className = "dica";
    st.textContent = "Gerando a foto de vitrine no PC da loja… (cerca de 30 segundos, pode levar mais na primeira vez)";
    try {
      const corpo = { cena: $("#cena-ia").value };
      if (origem.dataUrl) corpo.foto_base64 = origem.dataUrl; else corpo.foto_url = urlFoto(origem.url);
      const { data, error } = await db.functions.invoke("ia-imagem", { body: corpo });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).erro || msg; } catch {}
        throw new Error(msg);
      }
      if (!data?.imagem) throw new Error(data?.erro || "o PC não devolveu a imagem");
      estado.fotos.splice(i + 1, 0, { dataUrl: data.imagem });
      st.textContent = "Pronto: a foto nova entrou depois da original (marcada como \"nova\"). Veja se ficou boa; se não, gere de novo ou apague. Ela só é guardada quando você salvar a peça.";
      avisar("Foto de vitrine gerada.");
    } catch (e) {
      st.className = "dica erro";
      st.textContent = "Não consegui gerar a foto: " + e.message;
    } finally {
      gerandoFoto = false;
      desenharGaleria();
    }
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
  $("#form-peca").addEventListener("input", () => { marcarPersonalizados(); calcular(); });
  $("#p-preco").addEventListener("input", () => { precoEditadoManual = $("#p-preco").value !== ""; calcular(); });

  // Fotos enviadas: cada uma é reduzida para no máximo 1600 px antes de salvar
  async function reduzirFoto(arq) {
    const img = await new Promise((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = falha;
      i.src = URL.createObjectURL(arq);
    });
    const fator = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * fator);
    c.height = Math.round(img.height * fator);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return c.toDataURL("image/jpeg", 0.85);
  }
  $("#p-fotos-arquivos").addEventListener("change", async (e) => {
    const arquivos = [...e.target.files];
    const cabem = MAX_FOTOS - estado.fotos.length;
    if (arquivos.length > cabem) avisar(`Cabem mais ${cabem} foto${cabem === 1 ? "" : "s"} nesta peça. As demais ficaram de fora.`, true, 6000);
    for (const arq of arquivos.slice(0, Math.max(0, cabem))) {
      try { estado.fotos.push({ dataUrl: await reduzirFoto(arq) }); }
      catch { avisar(`Não consegui abrir "${arq.name}". Use foto JPG, PNG ou WEBP.`, true); }
      desenharGaleria();
    }
    e.target.value = "";
  });

  // ---------- Foto e link do MakerWorld ----------
  const novoId = (nome) =>
    (String(nome || "peca").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "peca") +
    "-" + Date.now().toString(36);

  const ehUrlFoto = (u) => /^https:\/\/\S+$/i.test(u);
  async function adicionarFotoPorLink() {
    const u = $("#p-foto-url").value.trim();
    if (!ehUrlFoto(u)) { avisar("Cole o link do post do Instagram ou de uma imagem (começando com https://)", true); $("#p-foto-url").focus(); return; }
    if (estado.fotos.length >= MAX_FOTOS) { avisar(`O limite é de ${MAX_FOTOS} fotos por peça.`, true); return; }
    if (estado.fotos.some((f) => f.url === u || f.origem === u)) { avisar("Essa foto já está na galeria.", true); return; }
    const botao = $("#p-foto-url-add");
    botao.disabled = true;
    botao.textContent = "Trazendo a foto…";
    try {
      // Guarda uma cópia no Supabase: link de imagem do Instagram expira em poucos dias
      const nossa = ehFotoNossa(u) ? u : await importarFoto(u);
      estado.fotos.push({ url: nossa, origem: u });
      $("#p-foto-url").value = "";
      desenharGaleria();
      avisar("Foto adicionada e guardada no Supabase.");
    } catch (e) {
      avisar("Não consegui trazer essa foto: " + e.message, true, 9000);
    } finally {
      botao.disabled = false;
      botao.textContent = "Adicionar por link";
    }
  }
  $("#p-foto-url-add").addEventListener("click", adicionarFotoPorLink);
  $("#p-foto-url").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); adicionarFotoPorLink(); } });
  $("#p-makerworld").addEventListener("input", (e) => {
    const u = e.target.value.trim();
    $("#abrir-mw").href = /^https?:\/\/(www\.)?makerworld\.com\//i.test(u) ? u : "https://makerworld.com/";
  });

  // Importa nome, fotos, material, cores, gramas e tempo a partir do link do MakerWorld
  const corProxima = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return null;
    const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = rgb(m[1]);
    let melhor = null, dist = Infinity;
    for (const [nome, h] of CORES_PADRAO) {
      if (!/^#/.test(h)) continue;
      const b = rgb(h.slice(1));
      const d = a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
      if (d < dist) { dist = d; melhor = { nome, hex: h }; }
    }
    return melhor;
  };
  const ehLinkMW = (u) => /^https:\/\/(www\.)?makerworld\.com\/(?:[a-z]{2}(?:-[A-Za-z]+)?\/)?models\/\d+/i.test(u);
  let importandoMW = false;
  async function importarMakerworld() {
    const u = $("#p-makerworld").value.trim();
    const st = $("#status-mw");
    if (!ehLinkMW(u)) { avisar("Cole o link de um modelo do MakerWorld (makerworld.com/.../models/123456).", true); $("#p-makerworld").focus(); return; }
    if (importandoMW) return;
    if ($("#p-nome").value.trim() && !confirm("Já tem dados nesta peça. Substituir nome, gramas, tempo, material e cores pelos do MakerWorld? (As fotos novas são só somadas à galeria.)")) return;
    importandoMW = true;
    const botao = $("#importar-mw");
    botao.disabled = true;
    botao.textContent = "Importando…";
    st.className = "dica";
    st.textContent = "Buscando o modelo e copiando as fotos…";
    try {
      const { data, error } = await db.functions.invoke("importar-makerworld", { body: { url: u } });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).erro || msg; } catch {}
        throw new Error(msg);
      }
      if (!data?.nome) throw new Error(data?.erro || "não consegui ler o modelo");

      $("#p-nome").value = data.nome.slice(0, 120);
      if (data.gramas) $("#p-gramas").value = Math.round(data.gramas * 10) / 10;
      if (data.segundos) {
        const min = Math.round(data.segundos / 60);
        $("#p-horas").value = Math.floor(min / 60);
        $("#p-minutos").value = min % 60;
      }
      const tipos = [...new Set((data.filamentos || []).map((f) => f.tipo).filter(Boolean))];
      if (tipos.length) $("#c-material").value = tipos[0];
      const cores = [];
      for (const f of data.filamentos || []) {
        const c = corProxima(f.cor);
        if (c && !cores.some((x) => x.nome === c.nome)) cores.push(c);
      }
      if (cores.length) { coresSel = cores; desenharCores(); }
      if (!$("#p-categoria").value.trim() && data.categoria) $("#p-categoria").value = data.categoria;
      for (const url of data.fotos || []) {
        if (estado.fotos.length >= MAX_FOTOS) break;
        if (!estado.fotos.some((f) => f.url === url)) estado.fotos.push({ url, origem: u });
      }
      desenharGaleria();
      $("#p-makerworld").dispatchEvent(new Event("input"));
      $("#form-peca").dispatchEvent(new Event("input"));

      const avisos = [];
      if (/NC/i.test(data.licenca)) avisos.push(`A licença do modelo (${data.licenca}) NÃO permite uso comercial. Não venda sem autorização do autor.`);
      else if (!data.licenca) avisos.push("Confira a licença do modelo antes de vender.");
      else avisos.push(`Licença: ${data.licenca}. Confira se permite venda.`);
      if (data.placas > 1) avisos.push(`O perfil tem ${data.placas} placas; gramas e tempo são a soma de todas.`);
      avisos.push("Medidas não vêm do MakerWorld: preencha em Características.");

      // Descrição: usa a IA (se cadastrada) a partir do texto original, que costuma estar em inglês
      if (!$("#p-descricao").value.trim()) {
        $("#p-descricao").value = data.descricaoOriginal.slice(0, 600);
        $("#p-descricao").dispatchEvent(new Event("input", { bubbles: true }));
        $("#gerar-descricao").click(); // IA da loja (PC ou nuvem gratuita); o resultado aparece abaixo do campo
      }
      st.className = /NÃO permite/.test(avisos[0]) ? "dica erro" : "dica";
      st.textContent = "Importado de " + (data.autor || "MakerWorld") + ". " + avisos.join(" ");
      avisar("Dados do MakerWorld importados. Revise e salve.");
    } catch (e) {
      st.className = "dica erro";
      st.textContent = "Não consegui importar: " + e.message;
    } finally {
      importandoMW = false;
      botao.disabled = false;
      botao.textContent = "Importar dados";
    }
  }
  $("#importar-mw").addEventListener("click", importarMakerworld);
  // Colou o link em peça nova (sem nome ainda): importa sozinho
  $("#p-makerworld").addEventListener("paste", () => {
    setTimeout(() => { if (ehLinkMW($("#p-makerworld").value.trim()) && !$("#p-nome").value.trim()) importarMakerworld(); }, 50);
  });

  // ---------- Arquivo 3MF: medidas, peso, tempo e cores exatos ----------
  async function lerArquivo3mf(arquivo) {
    const st = $("#status-3mf");
    if (!arquivo) return;
    if (!/\.3mf$/i.test(arquivo.name)) { st.className = "dica erro"; st.textContent = "Esse não é um arquivo .3mf."; return; }
    if (!window.JSZip) { st.className = "dica erro"; st.textContent = "Não consegui carregar o leitor de 3MF (sem internet?). Preencha as medidas à mão."; return; }
    st.className = "dica";
    st.textContent = "Lendo " + arquivo.name + "…";
    try {
      const r = await HPR_3MF.ler(arquivo);
      // Objetos diferentes = kit vendido junto: cada objeto vira uma peça do kit e a caixa que comporta todos
      // vai para as medidas (é o que o frete precisa)
      const m = r.conjunto;
      $("#c-kit").innerHTML = "";
      if (!r.iguais) r.pecas.forEach((p) => linhaKit(p));
      $("#c-largura").value = m.largura;
      $("#c-profundidade").value = m.profundidade;
      if (m.altura > 0) $("#c-altura").value = m.altura;
      const partes = [`${r.iguais ? "Medidas" : `Medidas do kit (${r.objetos} peças, todas juntas)`} ${m.largura} × ${m.profundidade}${m.altura > 0 ? " × " + m.altura : ""} cm`];
      if (r.fatiado) {
        $("#p-gramas").value = r.gramas;
        const min = Math.round(r.segundos / 60);
        $("#p-horas").value = Math.floor(min / 60);
        $("#p-minutos").value = min % 60;
        if (r.pesaPorPeca) $("#c-peso").value = r.pesaPorPeca;
        if (r.iguais && r.objetos > 1) $("#p-qtd").value = r.objetos;
        const tipos = [...new Set(r.filamentos.map((f) => f.tipo).filter(Boolean))];
        if (tipos.length && !$("#c-material").value.trim()) $("#c-material").value = tipos[0];
        const cores = [];
        for (const f of r.filamentos) {
          const c = corProxima(f.cor);
          if (c && !cores.some((x) => x.nome === c.nome)) cores.push(c);
        }
        if (cores.length) { coresSel = cores; desenharCores(); }
        partes.push(`${r.gramas} g e ${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")} no total${r.mesas > 1 ? ` (${r.mesas} mesas)` : ""}`);
        if (r.iguais && r.objetos > 1) partes.push(`${r.objetos} cópias por impressão, ${r.pesaPorPeca} g cada`);
      }
      const avisos = [];
      if (!r.fatiado) avisos.push("O arquivo não foi fatiado: só as medidas vieram. Salve o projeto fatiado no Bambu Studio para trazer peso e tempo.");
      if (!r.iguais) avisos.push(`Há ${r.objetos} objetos diferentes: medidas e peso são do conjunto inteiro, numa caixa só (cálculo aproximado, confira se as peças cabem assim).`);
      if (!r.iguais) recalcularKit();
      $("#form-peca").dispatchEvent(new Event("input"));
      st.className = avisos.length ? "dica alerta" : "dica";
      st.textContent = partes.join(". ") + "." + (avisos.length ? " " + avisos.join(" ") : "");
      avisar("Dados do 3MF aplicados. Revise e salve.");
    } catch (e) {
      st.className = "dica erro";
      st.textContent = "Não consegui ler: " + e.message;
    }
  }
  $("#p-3mf").addEventListener("change", (e) => { lerArquivo3mf(e.target.files[0]); e.target.value = ""; });
  const zona3mf = $("#zona-3mf").closest("fieldset");
  zona3mf.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) e.preventDefault(); });
  zona3mf.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); lerArquivo3mf(f); } });

  // ---------- Descrição com IA (OpenAI) ----------
  const MODELOS_RESERVA = ["gpt-5.4-nano", "gpt-5-nano", "gpt-4.1-mini", "gpt-4o-mini"];
  async function pedirDescricao(modelo, conteudo) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + estado.ia.chave },
      body: JSON.stringify({
        model: modelo,
        max_completion_tokens: 1600,
        messages: [
          {
            role: "system",
            content:
              "Você escreve descrições curtas para a vitrine de uma pequena loja brasileira de peças impressas em 3D, a HPR Print 3D. " +
              "Escreva em português do Brasil, em 2 a 4 frases, com no máximo 450 caracteres. A primeira frase deve resumir a peça sozinha, porque é a que aparece no card da vitrine. Tom simples e acolhedor, falando com o cliente. " +
              "Diga o que é a peça e para que serve ou por que é legal. Não invente medidas, materiais, cores ou preço. Sem emojis, sem hashtags, sem aspas. " +
              "Responda só com a descrição.",
          },
          { role: "user", content: conteudo },
        ],
      }),
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(corpo?.error?.message || "Erro " + r.status);
      e.status = r.status;
      e.codigo = corpo?.error?.code || "";
      throw e;
    }
    return String(corpo.choices?.[0]?.message?.content || "").trim().replace(/^["“]|["”]$/g, "");
  }

  $("#gerar-descricao").addEventListener("click", async () => {
    const st = $("#status-ia");
    st.hidden = false;
    st.className = "dica";
    const nome = $("#p-nome").value.trim();
    if (!nome) { st.className = "dica erro"; st.textContent = "Escreva o nome da peça primeiro."; $("#p-nome").focus(); return; }
    // 1º a IA da loja (função "ia": PC e depois nuvem gratuita); a OpenAI só entra se ainda houver chave cadastrada
    const botaoIA = $("#gerar-descricao");
    botaoIA.disabled = true;
    st.textContent = "Escrevendo a descrição…";
    let erroFuncao = "";
    try {
      const { data, error } = await db.functions.invoke("ia", {
        body: {
          acao: "descricao", nome, categoria: $("#p-categoria").value.trim(), material: $("#c-material").value.trim(),
          ideia: $("#p-descricao").value.trim(),
          kit: lerKit().map((k) => (k.qtd > 1 ? `${k.qtd}× ` : "") + (k.nome || "peça")),
          fotos: estado.fotos.slice(0, 2).map((f) => (f.dataUrl ? "" : urlFoto(f.url))).filter((u) => /^https:\/\//.test(u)),
        },
      });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).erro || msg; } catch {}
        throw new Error(msg);
      }
      if (!data?.texto) throw new Error(data?.erro || "a IA não respondeu");
      $("#p-descricao").value = data.texto.slice(0, 1000);
      $("#p-descricao").dispatchEvent(new Event("input", { bubbles: true }));
      st.textContent = `Pronto (${data.via === "pc" ? "IA do nosso PC" : "IA gratuita na nuvem"}). Revise e ajuste se quiser; clicar de novo gera outra opção.`;
      botaoIA.disabled = false;
      return;
    } catch (e) {
      erroFuncao = e.message;
    }
    botaoIA.disabled = false;
    if (!estado.ia?.chave) {
      st.className = "dica erro";
      st.textContent = "Não consegui gerar: " + erroFuncao + " Você pode escrever à mão.";
      return;
    }
    const categoria = $("#p-categoria").value.trim();
    const texto = `Peça: ${nome}${categoria ? `\nCategoria: ${categoria}` : ""}${$("#p-descricao").value.trim() ? `\nIdeia atual da descrição: ${$("#p-descricao").value.trim()}` : ""}`;
    const fotosIA = estado.fotos.slice(0, 2).map(srcFoto).filter(Boolean);
    const foto = fotosIA[0];
    const comFoto = foto ? [{ type: "text", text: texto + "\nUse as fotos para entender a peça." }, ...fotosIA.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } }))] : texto;
    const botao = $("#gerar-descricao");
    botao.disabled = true;
    st.textContent = "Escrevendo a descrição…";
    const modelos = [...new Set([estado.ia.modelo, ...MODELOS_RESERVA].filter(Boolean))];
    let resultado = "", ultimoErro = null;
    try {
      for (const m of modelos) {
        try {
          resultado = await pedirDescricao(m, comFoto);
        } catch (e) {
          ultimoErro = e;
          // Foto inacessível para a OpenAI: tenta só com o texto
          if (foto && /image|url|download/i.test(e.message) && e.status === 400) {
            try { resultado = await pedirDescricao(m, texto); } catch (e2) { ultimoErro = e2; }
          }
          if (!resultado && (e.status === 401 || e.status === 429 || e.codigo === "insufficient_quota")) break;
        }
        if (resultado) break;
      }
      if (!resultado) throw ultimoErro || new Error("a IA não respondeu");
      $("#p-descricao").value = resultado.slice(0, 1000);
      $("#p-descricao").dispatchEvent(new Event("input", { bubbles: true }));
      st.textContent = "Pronto. Revise e ajuste se quiser; clicar de novo gera outra opção.";
    } catch (e) {
      st.className = "dica erro";
      st.textContent =
        e.status === 401 ? "A chave da OpenAI foi recusada. Confira ou gere uma nova na aba Loja." :
        e.status === 429 || e.codigo === "insufficient_quota" ? "A OpenAI recusou por limite ou falta de crédito na conta." :
        "Não consegui gerar: " + e.message;
    } finally {
      botao.disabled = false;
    }
  });

  // ---------- Salvar peça ----------
  $("#salvar-peca").addEventListener("click", async () => {
    const f = lerFormulario();
    if (!f.nome) { avisar("Dê um nome para a peça.", true); $("#p-nome").focus(); return; }
    const botao = $("#salvar-peca");
    botao.disabled = true;
    try {
      const id = estado.editando || estado.idBusca || novoId(f.nome);
      // Envia as fotos novas na ordem da galeria
      const novas = estado.fotos.filter((f) => f.dataUrl).length;
      let enviadas = 0;
      for (const f of estado.fotos) {
        if (!f.dataUrl) continue;
        enviadas++;
        avisar(`Enviando foto ${enviadas} de ${novas}…`, false, 30000);
        f.url = await enviarFoto(id, f.dataUrl);
        delete f.dataUrl;
      }
      // Fotos antigas com link de fora: tenta guardar uma cópia agora (se o link ainda funcionar)
      for (const f of estado.fotos) {
        if (!f.url || ehFotoNossa(f.url)) continue;
        try { f.url = await importarFoto(f.url); } catch { /* fica o link antigo; a lista avisa */ }
      }
      const fotos = estado.fotos.map((f) => f.url).filter(Boolean);
      const foto = fotos[0] || "";
      const r = P.precificar(f, estado.config);
      const { nome, categoria, descricao, ordem, precoVitrine, ...calculo } = f;
      // Guarda só o que é diferente da aba Custos; o resto acompanha o padrão quando ele mudar
      const pad = padroes();
      for (const k of Object.keys(pad)) if (calculo[k] === "" || P.num(calculo[k], NaN) === pad[k]) calculo[k] = "";
      const linha = {
        id,
        nome,
        categoria: categoria || null,
        descricao: descricao || null,
        foto: foto || null,
        fotos,
        preco: P.num(precoVitrine, 0) || null,
        ativo: $("#p-ativo").checked,
        ordem: Math.round(P.num(ordem, 0)),
        cores: coresSel.slice(0, 24),
        caracteristicas: { ...lerCaracteristicas(), ...($("#p-cor-personalizada").checked ? { outrasCores: true } : {}) },
        interno: { ...calculo, custoNoCadastro: Math.round(r.custo.total * 100) / 100 },
        atualizado_em: new Date().toISOString(),
      };
      avisar("Salvando…", false, 20000);
      const { error } = await db.from("pecas").upsert(linha);
      if (error) throw error;
      const i = estado.pecas.findIndex((x) => x.id === id);
      i >= 0 ? (estado.pecas[i] = deLinhaPeca(linha)) : estado.pecas.push(deLinhaPeca(linha));
      estado.idBusca = null;
      avisar(linha.ativo ? "Peça salva. Já aparece na vitrine." : "Peça salva (oculta na vitrine).");
      mostrar("pecas");
    } catch (e) {
      avisar("Não consegui salvar: " + erroLegivel(e), true, 8000);
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
      await gravarAjuste("config", estado.config);
      avisar("Custos salvos.");
    } catch (e) { avisar("Não consegui salvar: " + erroLegivel(e), true, 7000); }
  });

  // ---------- Loja ----------
  function preencherLoja() {
    $("#l-ia-chave").value = estado.ia?.chave || "";
    $("#l-email-servico").value = estado.site.email?.servico || "";
    $("#l-email-template").value = estado.site.email?.template || "";
    $("#l-email-chave").value = estado.site.email?.chave || "";
    $("#l-ia-modelo").value = estado.ia?.modelo || "";
    $("#l-whatsapp").value = estado.site.whatsapp || "";
    $("#l-instagram").value = estado.site.instagram || "https://www.instagram.com/hprprint3d/";
    $("#l-destaques").value = (estado.site.destaquesInstagram || []).join("\n");
  }
  // Mensagens de erro do EmailJS em português
  function traduzirEmailJS(m) {
    m = String(m || "");
    if (/recipients address is empty|recipient/i.test(m)) return "no template do EmailJS, o campo To Email precisa ser {{to_email}}.";
    if (/service ID is invalid|service.*not found/i.test(m)) return "o Service ID está errado.";
    if (/template ID is invalid|template.*not found/i.test(m)) return "o Template ID está errado.";
    if (/public key is invalid|user.*invalid/i.test(m)) return "a Public Key está errada (Account > General).";
    if (/insufficient authentication scopes|Gmail_API/i.test(m)) return "reconecte o Gmail no EmailJS e marque a permissão para enviar e-mails em seu nome.";
    if (/origin|domain/i.test(m)) return "o EmailJS está bloqueando este site: libere hprprint3d.hygor.com.br nos domínios permitidos.";
    if (/limit|quota/i.test(m)) return "o limite gratuito de e-mails do mês acabou.";
    return m;
  }
  function lerEmailForm() {
    return { servico: $("#l-email-servico").value.trim(), template: $("#l-email-template").value.trim(), chave: $("#l-email-chave").value.trim() };
  }
  $("#salvar-email").addEventListener("click", async () => {
    const cfg = lerEmailForm();
    if (!window.HPR_EMAIL.configurado(cfg)) { avisar("Preencha Service ID, Template ID e Public Key.", true); return; }
    estado.site = { ...estado.site, email: cfg };
    try {
      await gravarAjuste("site", estado.site);
      avisar("Configuração de e-mail salva. Os clientes já passam a receber os e-mails.");
    } catch (e) { avisar("Não consegui salvar: " + erroLegivel(e), true, 7000); }
  });
  $("#testar-email").addEventListener("click", async () => {
    const r = await window.HPR_EMAIL.enviarEmailPedido(
      { ...lerEmailForm(), whatsapp: estado.site.whatsapp },
      { id: "HPR-TESTE", cliente: "Equipe HPR", email: estado.usuario, peca: "Peça de teste" },
      "imprimindo"
    ).catch((e) => ({ ok: false, motivo: e.message }));
    if (r.ok && !window.HPR_EMAIL.configurado(estado.site.email)) {
      estado.site = { ...estado.site, email: lerEmailForm() };
      await gravarAjuste("site", estado.site).catch(() => {});
    }
    avisar(r.ok ? `E-mail de teste enviado para ${estado.usuario}. A configuração ficou salva. Confira a caixa de entrada e o spam.` : "Não enviou: " + traduzirEmailJS(r.motivo), !r.ok, 12000);
  });

  $("#salvar-ia").addEventListener("click", async () => {
    const chave = $("#l-ia-chave").value.trim();
    if (chave && !/^sk-[A-Za-z0-9_-]{20,}$/.test(chave)) { avisar("Essa chave não parece da OpenAI. Ela começa com sk-.", true); return; }
    estado.ia = { chave, modelo: $("#l-ia-modelo").value.trim() };
    try {
      await gravarAjuste("ia", estado.ia);
      avisar(chave ? "Chave da IA salva." : "Chave da IA removida.");
    } catch (e) { avisar("Não consegui salvar: " + erroLegivel(e), true, 7000); }
  });

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
      await gravarAjuste("site", estado.site);
      $("#l-whatsapp").value = zap;
      $("#l-destaques").value = estado.site.destaquesInstagram.join("\n");
      avisar("Dados da loja salvos.");
    } catch (e) { avisar("Não consegui salvar: " + erroLegivel(e), true, 7000); }
  });
  $("#sair").addEventListener("click", async () => {
    window.Oficina?.ganchos?.sair?.();
    window.Oficina?.ganchos?.sairFinanceiro?.();
    await db.auth.signOut();
    estado.pecas = []; estado.pedidos = [];
    $("#abas").hidden = true;
    mostrar("conectar");
  });

  // ---------- API para outros módulos (pedidos.js) ----------
  window.Oficina = Object.assign(window.Oficina || {}, { estado, db, erroLegivel, avisar, mostrar, brl, esc, $, $$, gravarAjuste });
  window.Oficina.ganchos = window.Oficina.ganchos || {};

  // ---------- Início ----------
  conectar();
})();
