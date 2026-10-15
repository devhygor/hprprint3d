// Oficina: acompanhamento de pedidos. Usa as funções expostas por admin.js em window.Oficina.
(function () {
  const O = window.Oficina;
  const P = window.Precificador;
  const { estado, $, $$, brl, esc, avisar, mostrar, db, erroLegivel } = O;

  const STATUS = [
    { id: "novo", nome: "Novo", cor: "var(--lilas)" },
    { id: "orcamento", nome: "Orçamento enviado", cor: "#7cc4ff" },
    { id: "aprovado", nome: "Aprovado", cor: "var(--sol)" },
    { id: "imprimindo", nome: "Imprimindo", cor: "var(--coral)" },
    { id: "pronto", nome: "Pronto", cor: "var(--menta)" },
    { id: "enviado", nome: "Enviado (postado)", cor: "#5ad1e6" },
    { id: "entregue", nome: "Entregue", cor: "#8b84b3" },
    { id: "cancelado", nome: "Cancelado", cor: "#5e5888" },
  ];
  const FECHADOS = ["entregue", "cancelado"];
  const statusDe = (id) => STATUS.find((s) => s.id === id) || STATUS[0];
  let filtro = "abertos";
  let atual = null; // pedido em edição (cópia)

  // ---------- Supabase ----------
  let canal = null;
  const COLUNAS = ["id", "criado_em", "atualizado_em", "origem", "status", "cliente", "telefone", "email", "canal", "cliente_id", "referencias", "cidade", "peca", "peca_id",
    "quantidade", "cor", "prazo", "entrega", "detalhes", "valor", "sinal", "notas", "mensagem", "historico", "transportadora", "rastreio", "link_rastreio", "frete", "envio", "cep", "pago"];
  const deDb = (r) => ({ ...r, pecaId: r.peca_id || "", criadoEm: r.criado_em, atualizadoEm: r.atualizado_em, entrega: r.entrega || "" });
  function paraDb(p) {
    const r = {};
    const fonte = { ...p, peca_id: p.pecaId || null, criado_em: p.criadoEm, atualizado_em: p.atualizadoEm, entrega: p.entrega || null };
    for (const c of COLUNAS) if (fonte[c] !== undefined) r[c] = fonte[c] === "" ? null : fonte[c];
    return r;
  }
  async function carregar() {
    const { data, error } = await db.from("pedidos").select("*").order("criado_em", { ascending: false }).limit(1000);
    if (error) throw error;
    estado.pedidos = (data || []).map(deDb);
  }
  async function salvarPedido(p) {
    const { error } = await db.from("pedidos").upsert(paraDb(p));
    if (error) throw error;
  }
  async function excluirPedido(id) {
    const { error } = await db.from("pedidos").delete().eq("id", id);
    if (error) throw error;
  }
  function ouvirMudancas() {
    if (canal) return;
    canal = db
      .channel("pedidos")
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, async (ev) => {
        await carregar().catch(() => {});
        if (!$("#tela-pedidos").hidden) desenharLista();
        if (ev.eventType === "INSERT" && ev.new?.origem === "site") avisar(`Pedido novo pelo site: ${ev.new.id}`);
      })
      .subscribe();
  }

  async function abrirPedidos() {
    $("#aviso-email").hidden = !!window.HPR_EMAIL?.configurado(estado.site?.email);
    $("#lista-pedidos").innerHTML = `<p class="dica">Carregando pedidos…</p>`;
    try {
      await carregar();
      ouvirMudancas();
      desenharLista();
    } catch (e) {
      $("#lista-pedidos").innerHTML = `<div class="vazio"><strong>Não consegui carregar os pedidos</strong>${esc(erroLegivel(e))}.</div>`;
    }
  }
  O.ganchos.sair = () => { if (canal) { db.removeChannel(canal); canal = null; } };

  $("#atualizar-pedidos").addEventListener("click", () => abrirPedidos());
  const agora = () => new Date().toISOString();
  const dataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
  const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const soNumeros = (t) => String(t || "").replace(/\D/g, "");
  const linkZap = (tel, texto) => {
    let n = soNumeros(tel);
    if (!n) return "";
    if (n.length <= 11) n = "55" + n;
    return `https://wa.me/${n}` + (texto ? `?text=${encodeURIComponent(texto)}` : "");
  };
  function novoCodigo() {
    const d = new Date();
    const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const s = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => letras[n % letras.length]).join("");
    return `HPR-${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${s}`;
  }

  // ---------- Leitura da mensagem do WhatsApp ----------
  function lerMensagem(texto) {
    const t = String(texto || "").replace(/\r/g, "");
    const campo = (rotulo) => {
      const m = t.match(new RegExp(`^\\s*\\*?${rotulo}\\*?:\\*?\\s*(.+)$`, "im"));
      return m ? m[1].replace(/\*/g, "").trim() : "";
    };
    const nome = (t.match(/meu nome (?:é|e)\s+(.+?)\s+e vi o site/i) || [])[1] || "";
    return {
      codigo: (t.match(/HPR-\d{4}-[A-Z0-9]{3,6}/i) || [""])[0].toUpperCase(),
      cliente: nome.trim(),
      peca: campo("Pedido"),
      quantidade: parseInt(campo("Quantidade"), 10) || "",
      cor: campo("Cor"),
      cidade: campo("Cidade/bairro"),
      prazo: campo("Para quando"),
      detalhes: campo("Detalhes"),
    };
  }

  // ---------- Lista ----------
  function contas(p) {
    const peca = estado.pecas.find((x) => x.id === p.pecaId);
    const qtd = Math.max(1, P.num(p.quantidade, 1));
    const custoUn = peca ? P.precificar(peca, estado.config).custo.total : NaN;
    const custo = custoUn * qtd;
    const valor = p.valor == null || p.valor === "" ? NaN : P.num(p.valor, NaN);
    const frete = p.frete == null || p.frete === "" ? 0 : P.num(p.frete, 0);
    const sinal = P.num(p.sinal, 0);
    const total = Number.isFinite(valor) ? valor + frete : NaN;
    // "Pago" só quando vocês marcam (ou quando o sinal já cobre o total)
    const falta = p.pago ? 0 : Number.isFinite(total) ? Math.max(0, total - sinal) : NaN;
    return { peca, qtd, custoUn, custo, valor, frete, total, sinal, falta, pago: !!p.pago || (Number.isFinite(total) && total > 0 && sinal >= total - 0.004), lucro: valor - custo };
  }

  function desenharFiltros() {
    const conta = (f) => estado.pedidos.filter(f).length;
    const opcoes = [
      { id: "abertos", nome: "Em aberto", n: conta((p) => !FECHADOS.includes(p.status)) },
      ...STATUS.map((s) => ({ id: s.id, nome: s.nome, n: conta((p) => p.status === s.id) })),
      { id: "todos", nome: "Todos", n: estado.pedidos.length },
    ].filter((o) => o.n > 0 || o.id === "abertos" || o.id === filtro);
    $("#filtros-pedidos").innerHTML = opcoes
      .map((o) => `<button class="filtro" type="button" data-filtro="${o.id}" aria-pressed="${o.id === filtro}">${esc(o.nome)} <span class="contagem">${o.n}</span></button>`)
      .join("");
  }

  function desenharLista() {
    desenharFiltros();
    const alvo = $("#lista-pedidos");
    const lista = estado.pedidos
      .filter((p) => (filtro === "todos" ? true : filtro === "abertos" ? !FECHADOS.includes(p.status) : p.status === filtro))
      .sort((a, b) => {
        // Abertos: entrega mais próxima primeiro; depois os mais novos
        const ea = a.entrega || "9999", eb = b.entrega || "9999";
        return ea === eb ? String(b.criadoEm).localeCompare(a.criadoEm) : ea.localeCompare(eb);
      });
    if (!estado.pedidos.length) {
      alvo.innerHTML = `<div class="vazio"><strong>Nenhum pedido registrado</strong>Pedidos do site entram sozinhos. Os que chegam por Instagram, WhatsApp, Shopee ou pessoalmente, cadastre em + Novo pedido.</div>`;
      return;
    }
    if (!lista.length) {
      alvo.innerHTML = `<div class="vazio"><strong>Nada por aqui</strong>Nenhum pedido com esse status.</div>`;
      return;
    }
    const hoje = new Date().toISOString().slice(0, 10);
    alvo.innerHTML = lista
      .map((p) => {
        const s = statusDe(p.status);
        const c = contas(p);
        const atrasado = p.entrega && p.entrega < hoje && !FECHADOS.includes(p.status);
        const entrega = p.entrega ? `<span class="${atrasado ? "atrasado" : ""}">Entrega ${new Date(p.entrega + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}${atrasado ? " (atrasado)" : ""}</span>` : p.prazo ? `<span>Cliente pediu: ${esc(p.prazo)}</span>` : "";
        return `<article class="cartao-pedido" style="--cor:${s.cor}">
          <div class="cp-topo">
            <span class="cp-codigo">${esc(p.id)}</span>
            <span class="cp-data">${dataCurta(p.criadoEm)}</span>
          </div>
          <h3>${esc(p.peca || "Pedido sem descrição")}${c.qtd > 1 ? ` <span class="cp-qtd">× ${c.qtd}</span>` : ""}</h3>
          <p class="cp-cliente">${esc(p.cliente || "Cliente sem nome")}${p.cidade ? `, ${esc(p.cidade)}` : ""}${(p.canal || p.origem === "site") ? ` <span class="cp-canal">${esc(p.canal || "Site")}</span>` : ""}</p>
          <div class="cp-info">
            ${entrega}
            ${p.rastreio ? `<a class="cp-rastreio" href="${esc(window.HPR_RASTREIO.dePedido(p).link)}" target="_blank" rel="noopener" title="Abrir o rastreio">📦 ${esc(window.HPR_RASTREIO.limpar(p.rastreio))}</a>` : ""}
            ${(p.referencias || []).length ? `<span class="cp-ref">${p.referencias.length} ${p.referencias.length > 1 ? "imagens" : "imagem"} de referência</span>` : ""}
            ${Number.isFinite(c.valor) ? `<span>${brl(c.total)}${c.frete > 0 ? ` <small class="cp-frete">(frete ${brl(c.frete)})</small>` : ""}${c.pago ? ` <span class="cp-pago">pago</span>` : c.total > 0 ? ` <span class="cp-a-receber">${c.sinal > 0 ? `falta ${brl(c.falta)}` : "a receber"}</span>` : ""}</span>` : ""}
            ${p.envio ? `<span class="cp-envio">${esc(p.envio.split(" · ")[0])}</span>` : ""}
          </div>
          <div class="cp-acoes">
            <label class="cp-status"><span class="sr">Status de ${esc(p.id)}</span>
              <select data-status="${esc(p.id)}">${STATUS.map((x) => `<option value="${x.id}" ${x.id === p.status ? "selected" : ""}>${x.nome}</option>`).join("")}</select>
            </label>
            <button class="botao botao-contorno botao-pequeno" type="button" data-abrir="${esc(p.id)}">Abrir</button>
          </div>
        </article>`;
      })
      .join("");
  }

  $("#filtros-pedidos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filtro]");
    if (!b) return;
    filtro = b.dataset.filtro;
    desenharLista();
  });

  const FRASE_STATUS = {
    novo: "foi recebido", orcamento: "teve o orçamento enviado", aprovado: "foi aprovado", imprimindo: "está sendo impresso",
    pronto: "está pronto", enviado: "foi postado", entregue: "foi entregue", cancelado: "foi cancelado",
  };
  // Depois de mudar o status: oferece mandar a mensagem pronta no WhatsApp do cliente
  function oferecerWhatsapp(p) {
    const caixa = $("#aviso-zap");
    if (!soNumeros(p.telefone)) { caixa.hidden = true; return; }
    $("#aviso-zap-titulo").innerHTML = `Avisar <b>${esc((p.cliente || "o cliente").split(" ")[0])}</b> que o pedido <b>${FRASE_STATUS[p.status] || "mudou de etapa"}</b>?`;
    $("#aviso-zap-link").href = linkZap(p.telefone, window.HPR_EMAIL.mensagemWhatsapp(p, p.status));
    caixa.hidden = false;
    clearTimeout(oferecerWhatsapp.t);
    oferecerWhatsapp.t = setTimeout(() => (caixa.hidden = true), 20000);
  }
  $("#aviso-zap-fechar").addEventListener("click", () => ($("#aviso-zap").hidden = true));
  $("#aviso-zap-link").addEventListener("click", () => setTimeout(() => ($("#aviso-zap").hidden = true), 300));

  // E-mail para o cliente quando o status muda (EmailJS, configurado na aba Loja)
  async function avisarCliente(p) {
    const cfg = estado.site?.email;
    if (!window.HPR_EMAIL?.configurado(cfg) || !p.email) return "";
    const r = await window.HPR_EMAIL.enviarEmailPedido({ ...cfg, whatsapp: estado.site.whatsapp }, p, p.status).catch((e) => ({ ok: false, motivo: e.message }));
    return r.ok ? ` E-mail enviado para ${p.email}.` : " (o e-mail para o cliente falhou)";
  }

  // Mudar status direto na lista
  $("#lista-pedidos").addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-status]");
    if (!sel) return;
    const p = estado.pedidos.find((x) => x.id === sel.dataset.status);
    if (!p || p.status === sel.value) return;
    if (sel.value === "enviado" && !p.rastreio) {
      // Precisa do código de rastreio: abre o pedido já em "Enviado" com o campo pronto para colar
      sel.value = p.status;
      abrir(p.id);
      $("#o-status").value = "enviado";
      atualizarLado();
      $("#o-envio").scrollIntoView({ block: "center" });
      $("#o-rastreio").focus();
      avisar("Cole o código de rastreio e salve. O cliente recebe o código com o link.", false, 6000);
      return;
    }
    const anterior = p.status;
    p.status = sel.value;
    (p.historico ||= []).push({ status: sel.value, em: agora() });
    sel.disabled = true;
    try {
      p.atualizadoEm = agora();
      await salvarPedido(p);
      avisar(`${p.id} agora está ${statusDe(sel.value).nome.toLowerCase()}.`);
      const extra = (await avisarCliente(p)) + ((await O.lancarPedido?.(p)) || "");
      if (extra) avisar(`${p.id} agora está ${statusDe(sel.value).nome.toLowerCase()}.${extra}`, extra.includes("falhou"), 7000);
      oferecerWhatsapp(p);
    } catch (err) {
      p.status = anterior;
      p.historico.pop();
      avisar("Não consegui salvar: " + erroLegivel(err), true, 7000);
    }
    desenharLista();
  });
  $("#lista-pedidos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-abrir]");
    if (b) abrir(b.dataset.abrir);
  });
  $("#novo-pedido").addEventListener("click", () => abrir(null));

  // ---------- Editor de pedido ----------
  const CAMPOS = {
    cliente: "#o-cliente", telefone: "#o-telefone", email: "#o-email", canal: "#o-canal", cidade: "#o-cidade", peca: "#o-peca", quantidade: "#o-quantidade",
    cor: "#o-cor", prazo: "#o-prazo", entrega: "#o-entrega", detalhes: "#o-detalhes", valor: "#o-valor", sinal: "#o-sinal",
    frete: "#o-frete", envio: "#o-envio", cep: "#o-cep",
    notas: "#o-notas", mensagem: "#o-mensagem", status: "#o-status",
    transportadora: "#o-transportadora", rastreio: "#o-rastreio", link_rastreio: "#o-link-rastreio",
  };
  const R = window.HPR_RASTREIO;
  $("#o-transportadora").innerHTML = `<option value="">Escolha…</option>` + R.TRANSPORTADORAS.map((t) => `<option value="${t.id}">${esc(t.nome)}</option>`).join("");
  const ANTES_DO_ENVIO = ["novo", "orcamento", "aprovado", "imprimindo", "pronto"];
  function atualizarRastreio(doCodigo) {
    const cod = R.limpar($("#o-rastreio").value);
    // Reconhece o código dos Correios sozinho
    if (doCodigo && cod && !$("#o-transportadora").value && R.detectar(cod)) $("#o-transportadora").value = R.detectar(cod);
    // Colocou o código: o pedido passa para Enviado
    if (doCodigo && cod && ANTES_DO_ENVIO.includes($("#o-status").value)) {
      $("#o-status").value = "enviado";
      avisar("Pedido marcado como Enviado. Salve para avisar o cliente.", false, 4000);
    }
    $("#o-link-rastreio-campo").hidden = $("#o-transportadora").value !== "outra";
    const r = R.dePedido({ rastreio: cod, transportadora: $("#o-transportadora").value, link_rastreio: $("#o-link-rastreio").value });
    const previa = $("#o-rastreio-previa");
    previa.hidden = !r;
    if (r) previa.innerHTML = `Link que o cliente vai receber: <a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link.replace(/^https:\/\//, ""))}</a>`;
    const aviso = cod && r?.transportadora === "correios" && !R.ehCorreios(cod);
    $("#o-rastreio-dica").className = aviso ? "dica alerta" : "dica";
    $("#o-rastreio-dica").innerHTML = aviso
      ? "Esse código não parece dos Correios (o padrão é 2 letras, 9 números e 2 letras, como AB123456789BR). Confira antes de salvar."
      : "Ao colocar o código, o pedido passa para <b>Enviado</b> e o cliente recebe o código com o link para acompanhar, no e-mail e no WhatsApp.";
  }
  $("#o-rastreio").addEventListener("change", () => { atualizarRastreio(true); atualizarLado(); });
  $("#o-rastreio").addEventListener("input", () => atualizarRastreio(false));
  $("#o-transportadora").addEventListener("change", () => { atualizarRastreio(false); atualizarLado(); });
  $("#o-link-rastreio").addEventListener("input", () => atualizarRastreio(false));

  function abrir(id) {
    const existente = id ? estado.pedidos.find((x) => x.id === id) : null;
    atual = existente ? JSON.parse(JSON.stringify(existente)) : { id: "", status: "novo", quantidade: 1, historico: [] };
    $("#titulo-pedido").textContent = existente ? `Pedido ${existente.id}` : "Novo pedido";
    $("#o-status").innerHTML = STATUS.map((s) => `<option value="${s.id}">${s.nome}</option>`).join("");
    for (const [k, sel] of Object.entries(CAMPOS)) $(sel).value = atual[k] ?? "";
    $("#o-lista-pecas").innerHTML = estado.pecas.map((p) => `<option value="${esc(p.nome)}">`).join("");
    $("#o-status-colar").className = "dica";
    $("#o-status-colar").textContent = "Opcional. Se o pedido veio pelo formulário do site, cole a mensagem e os campos se preenchem. Pedido de Instagram, Shopee, pessoalmente etc.: preencha direto abaixo.";
    $("#o-excluir").hidden = !existente;
    $("#bloco-colar").hidden = !!existente;
    const comEmail = window.HPR_EMAIL?.configurado(estado.site?.email);
    $("#o-avisar-campo").hidden = !comEmail;
    $("#o-avisar").checked = true;
    desenharReferencias(atual.referencias || []);
    $("#o-pago").checked = !!atual.pago;
    atualizarRastreio(false);
    $("#o-frete-opcoes").innerHTML = "";
    const doSite = atual.origem === "site" && atual.frete != null;
    $("#o-frete-dica").hidden = !doSite;
    $("#o-frete-dica").textContent = doSite ? "Frete simulado pelo cliente no site. Confira antes de mandar o orçamento." : "";
    mostrar("pedido");
    atualizarLado();
  }

  // Imagens de referência: ficam num armazenamento privado, então geramos links temporários
  async function desenharReferencias(caminhos) {
    const bloco = $("#o-refs-bloco");
    bloco.hidden = !caminhos.length;
    if (!caminhos.length) return;
    $("#o-refs").innerHTML = `<p class="dica">Carregando imagens…</p>`;
    const { data, error } = await db.storage.from("referencias").createSignedUrls(caminhos, 3600);
    if (error || !data) { $("#o-refs").innerHTML = `<p class="dica erro">Não consegui abrir as imagens: ${esc(erroLegivel(error))}</p>`; return; }
    $("#o-refs").innerHTML = data
      .filter((d) => d.signedUrl)
      .map((d, i) => `<a href="${esc(d.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(d.signedUrl)}" alt="Referência ${i + 1} enviada pelo cliente"></a>`)
      .join("");
  }

  function lerForm() {
    const d = {};
    for (const [k, sel] of Object.entries(CAMPOS)) d[k] = $(sel).value.trim();
    d.pago = $("#o-pago").checked;
    const peca = estado.pecas.find((p) => p.nome.toLowerCase() === d.peca.toLowerCase());
    d.pecaId = peca ? peca.id : atual.pecaId && d.peca === atual.peca ? atual.pecaId : "";
    return d;
  }

  function atualizarLado() {
    const d = { ...atual, ...lerForm() };
    $("#o-codigo").textContent = atual.id || "será gerado ao salvar";
    const c = contas(d);
    $("#o-peca-ligada").textContent = c.peca
      ? `Ligado à peça do catálogo: custo de ${brl(c.custoUn)} cada.`
      : estado.pecas.length ? "Digite o nome igual ao da aba Peças para ver custo e lucro." : "";
    const linhas = [];
    if (c.peca) linhas.push(["Custo de produção", brl(c.custo)]);
    if (Number.isFinite(c.valor)) {
      if (c.frete > 0) {
        linhas.push(["Peças", brl(c.valor)]);
        linhas.push(["Frete", brl(c.frete)]);
        linhas.push(["Total para o cliente", `<b>${brl(c.total)}</b>`]);
      } else linhas.push(["Valor combinado", brl(c.valor)]);
      linhas.push(["Sinal recebido", brl(c.sinal)]);
      linhas.push(["Falta receber", c.pago ? `<span class="pos">pago</span>` : brl(Math.max(0, c.falta))]);
      if (c.peca) linhas.push(["Lucro estimado", `<span class="${c.lucro < 0 ? "neg" : "pos"}">${brl(c.lucro)}</span>`]);
    }
    $("#o-contas").innerHTML = linhas.map(([a, b]) => `<dt style="--cor:transparent">${a}</dt><dd>${b}</dd>`).join("");

    const tel = d.telefone;
    const zap = $("#o-zap");
    zap.hidden = !soNumeros(tel);
    if (!zap.hidden) {
      const pedidoZap = { ...atual, ...d, id: atual.id || "(será gerado ao salvar)" };
      zap.href = linkZap(tel, window.HPR_EMAIL.mensagemWhatsapp(pedidoZap, d.status || "novo"));
      zap.textContent = `Avisar no WhatsApp: ${statusDe(d.status).nome}`;
    }

    const hist = atual.historico || [];
    $("#o-historico-bloco").hidden = !hist.length;
    $("#o-historico").innerHTML = hist
      .slice()
      .reverse()
      .map((h) => `<li style="--cor:${statusDe(h.status).cor}"><strong>${statusDe(h.status).nome}</strong> <span>${dataHora(h.em)}</span></li>`)
      .join("");
  }
  // Simular frete pelo CEP dentro do pedido (mesma conta do site)
  const F = window.HPR_FRETE;
  let opcoesAdm = [];
  $("#o-cep").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 8);
    e.target.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  });
  $("#o-simular-frete").addEventListener("click", async () => {
    const alvo = $("#o-frete-opcoes");
    const d = lerForm();
    if (d.cep.replace(/\D/g, "").length !== 8) { avisar("Coloque o CEP do cliente.", true); $("#o-cep").focus(); return; }
    alvo.innerHTML = `<p class="dica">Calculando…</p>`;
    try {
      const peca = estado.pecas.find((p) => p.id === d.pecaId);
      const r = await F.simular({ sb: window.HPR_SUPABASE, site: estado.site, cep: d.cep, peca: peca && { id: peca.id, preco: peca.precoVitrine, caracteristicas: peca.caracteristicas }, quantidade: d.quantidade });
      opcoesAdm = r.opcoes;
      alvo.innerHTML = `<p class="dica">${esc(r.endereco.cidade)}/${esc(r.endereco.uf)} · ${r.fonte === "real" ? "preço do Melhor Envio" : "tabela da loja"}. Toque para usar:</p>` +
        (r.opcoes.length ? `<div class="frete-adm-opcoes">${r.opcoes.map((o, i) => `<button type="button" class="filtro" data-frete="${i}">${esc(o.nome)} · ${o.valor > 0 ? brl(o.valor) : "grátis"}${o.prazo ? ` <small>${esc(o.prazo)}</small>` : ""}</button>`).join("")}</div>`
          : `<p class="dica alerta">Sem valor para essa região. Preencha a tabela de frete na aba Loja.</p>`);
      if (!$("#o-cidade").value.trim()) $("#o-cidade").value = `${r.endereco.cidade}/${r.endereco.uf}`;
    } catch {
      alvo.innerHTML = `<p class="dica erro">CEP não encontrado.</p>`;
    }
  });
  $("#o-frete-opcoes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-frete]");
    if (!b) return;
    const o = opcoesAdm[Number(b.dataset.frete)];
    $("#o-frete").value = o.valor > 0 ? o.valor.toFixed(2) : "0";
    $("#o-envio").value = o.nome + (o.prazo ? " · " + o.prazo : "");
    $$("#o-frete-opcoes [data-frete]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    atualizarLado();
  });

  $("#form-pedido-adm").addEventListener("input", atualizarLado);
  $("#o-status").addEventListener("change", atualizarLado);

  $("#o-preencher").addEventListener("click", () => {
    const lido = lerMensagem($("#o-mensagem").value);
    const achados = Object.entries(lido).filter(([k, v]) => v && k !== "codigo");
    const st = $("#o-status-colar");
    if (!achados.length && !lido.codigo) {
      st.className = "dica erro";
      st.textContent = "Não reconheci essa mensagem. Preencha os campos à mão.";
      return;
    }
    for (const [k, v] of achados) $(CAMPOS[k]).value = v;
    if (lido.codigo && !atual.id) {
      const repetido = estado.pedidos.find((p) => p.id === lido.codigo);
      if (repetido) {
        st.className = "dica alerta";
        st.textContent = `O pedido ${lido.codigo} já está registrado. Abra ele na lista para atualizar.`;
        return;
      }
      atual.id = lido.codigo;
    }
    st.className = "dica";
    st.textContent = `Preenchi ${achados.length} campo${achados.length === 1 ? "" : "s"}${lido.codigo ? ` do pedido ${lido.codigo}` : ""}. Confira e salve.`;
    atualizarLado();
  });

  $("#o-salvar").addEventListener("click", async () => {
    const d = lerForm();
    if (!d.cliente && !d.peca) {
      avisar("Preencha pelo menos o nome do cliente ou a peça.", true);
      $("#o-cliente").focus();
      return;
    }
    d.rastreio = R.limpar(d.rastreio);
    if (d.rastreio && !d.transportadora) d.transportadora = R.detectar(d.rastreio) || "outra";
    if (d.status === "enviado" && !d.rastreio &&
        !confirm("O pedido está como Enviado mas sem código de rastreio. Salvar mesmo assim? (bom para entrega em mãos ou motoboy)")) {
      $("#o-rastreio").focus();
      return;
    }
    const existente = estado.pedidos.find((p) => p.id === atual.id);
    const id = atual.id || novoCodigo();
    const historico = [...(atual.historico || [])];
    if (!existente || existente.status !== d.status) historico.push({ status: d.status, em: agora() });
    const pedido = {
      ...atual,
      ...d,
      id,
      origem: atual.origem || "manual",
      quantidade: Math.max(1, parseInt(d.quantidade, 10) || 1),
      valor: d.valor === "" ? null : P.num(d.valor),
      frete: d.frete === "" ? null : P.num(d.frete),
      cep: window.HPR_FRETE.formatarCep(d.cep) || null,
      sinal: d.sinal === "" ? null : P.num(d.sinal),
      criadoEm: atual.criadoEm || agora(),
      atualizadoEm: agora(),
      historico,
    };
    const antes = estado.pedidos.slice();
    const i = estado.pedidos.findIndex((p) => p.id === id);
    i >= 0 ? (estado.pedidos[i] = pedido) : estado.pedidos.unshift(pedido);
    $("#o-salvar").disabled = true;
    try {
      await salvarPedido(pedido);
      // Mudou o status, ou trocou o código de rastreio de um pedido já enviado: avisa o cliente de novo
    const mudouStatus = !existente || existente.status !== pedido.status ||
      (pedido.status === "enviado" && !!pedido.rastreio && R.limpar(existente.rastreio) !== pedido.rastreio);
      // E-mail: ao criar um pedido manual (Recebemos seu pedido) e a cada mudança de status
      const extra = (mudouStatus && $("#o-avisar").checked ? await avisarCliente(pedido) : "") +
        (mudouStatus ? (await O.lancarPedido?.(pedido)) || "" : "");
      if (existente && !!existente.pago !== !!pedido.pago) await O.sincronizarPago?.(pedido);
      avisar(`Pedido ${id} salvo.${extra}`, extra.includes("falhou"), extra ? 6000 : 3800);
      if (mudouStatus) oferecerWhatsapp(pedido);
      mostrar("pedidos");
    } catch (e) {
      estado.pedidos = antes;
      avisar("Não consegui salvar: " + erroLegivel(e), true, 8000);
    } finally {
      $("#o-salvar").disabled = false;
    }
  });

  $("#o-cancelar").addEventListener("click", () => mostrar("pedidos"));

  $("#o-excluir").addEventListener("click", async () => {
    if (!atual?.id || !confirm(`Excluir o pedido ${atual.id}? Isso não pode ser desfeito.`)) return;
    const antes = estado.pedidos.slice();
    estado.pedidos = estado.pedidos.filter((p) => p.id !== atual.id);
    try {
      await excluirPedido(atual.id);
      avisar("Pedido excluído.");
      mostrar("pedidos");
    } catch (e) {
      estado.pedidos = antes;
      avisar("Não consegui excluir: " + erroLegivel(e), true);
    }
  });

  O.ganchos.pedidos = abrirPedidos;
  O.lerMensagemPedido = lerMensagem; // usado nos testes
})();
