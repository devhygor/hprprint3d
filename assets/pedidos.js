// Oficina: acompanhamento de pedidos. Usa as funções expostas por admin.js em window.Oficina.
(function () {
  const O = window.Oficina;
  const P = window.Precificador;
  const H = window.HPR_ITENS;
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
    "quantidade", "cor", "prazo", "entrega", "detalhes", "valor", "sinal", "notas", "mensagem", "historico", "transportadora", "rastreio", "link_rastreio", "frete", "envio", "cep", "pago", "endereco", "numero", "complemento", "bairro", "uf", "documento", "etiqueta", "itens"];
  let colunaItens = true; // vira false se o banco ainda não tem a coluna "itens" (SQL novo não rodado)
  const deDb = (r) => ({ ...r, pecaId: r.peca_id || "", criadoEm: r.criado_em, atualizadoEm: r.atualizado_em, entrega: r.entrega || "" });
  function paraDb(p) {
    const r = {};
    const fonte = { ...p, peca_id: p.pecaId || null, criado_em: p.criadoEm, atualizado_em: p.atualizadoEm, entrega: p.entrega || null };
    for (const c of COLUNAS) if (fonte[c] !== undefined) r[c] = fonte[c] === "" ? null : fonte[c];
    if (!colunaItens && !(r.itens && r.itens.length)) delete r.itens;
    return r;
  }
  async function carregar() {
    const { data, error } = await db.from("pedidos").select("*").order("criado_em", { ascending: false }).limit(1000);
    if (error) throw error;
    colunaItens = !data?.length || "itens" in data[0];
    estado.pedidos = (data || []).map(deDb);
  }
  async function salvarPedido(p) {
    const { error } = await db.from("pedidos").upsert(paraDb(p));
    if (error) {
      if (/itens/.test(error.message || "")) error.message = "o banco ainda não tem a coluna de itens: rode o docs/supabase.sql atualizado no Supabase";
      throw error;
    }
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
    const its = H.lista(p);
    let peca = estado.pecas.find((x) => x.id === p.pecaId);
    let qtd = Math.max(1, P.num(p.quantidade, 1));
    let custoUn = peca ? P.precificar(peca, estado.config).custo.total : NaN;
    let custo = custoUn * qtd;
    if (its.length) {
      // Carrinho: o custo é a soma das peças do catálogo (se alguma não estiver ligada, fica sem custo)
      const partes = its.map((i) => ({ peca: estado.pecas.find((x) => x.id === i.id), qtd: i.qtd }));
      const todas = partes.every((x) => x.peca);
      qtd = H.unidades(its);
      peca = todas ? partes[0].peca : undefined;
      custo = todas ? partes.reduce((s, x) => s + P.precificar(x.peca, estado.config).custo.total * x.qtd, 0) : NaN;
      custoUn = custo / qtd;
    }
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

  // Produção por peça no cartão: barra de progresso e, aberto, um contador (− n/total +) por item
  const producaoAberta = new Set();
  function producaoCartao(p) {
    const its = H.lista(p);
    if (!its.length) return "";
    const g = H.progresso(its);
    return `<details class="cp-producao" data-prod="${esc(p.id)}" ${producaoAberta.has(p.id) ? "open" : ""}>
      <summary>
        <span class="cp-prog-topo"><span>Produção<span class="seta" aria-hidden="true">›</span></span><b>${g.feitas} de ${g.total} ${g.total > 1 ? "peças" : "peça"}</b></span>
        <span class="barra-prod" role="progressbar" aria-valuemin="0" aria-valuemax="${g.total}" aria-valuenow="${g.feitas}" aria-label="Peças prontas de ${esc(p.id)}"><i style="width:${g.pct}%"></i></span>
      </summary>
      <ul class="cp-itens">${its.map((i, k) => `<li class="${i.feito >= i.qtd ? "pronto" : ""}">
        <span class="cpi-nome">${esc(i.nome)}${i.cor ? `<small>${esc(i.cor)}</small>` : ""}</span>
        <span class="cpi-ctrl">
          <button type="button" data-feito="${esc(p.id)}|${k}|-1" ${i.feito <= 0 ? "disabled" : ""} aria-label="Uma a menos: ${esc(i.nome)}">−</button>
          <b>${i.feito}/${i.qtd}</b>
          <button type="button" data-feito="${esc(p.id)}|${k}|1" ${i.feito >= i.qtd ? "disabled" : ""} aria-label="Mais uma pronta: ${esc(i.nome)}">+</button>
        </span></li>`).join("")}</ul>
    </details>`;
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
          <h3>${esc(p.peca || "Pedido sem descrição")}${c.qtd > 1 && !H.lista(p).length ? ` <span class="cp-qtd">× ${c.qtd}</span>` : ""}</h3>
          <p class="cp-cliente">${esc(p.cliente || "Cliente sem nome")}${p.cidade ? `, ${esc(p.cidade)}` : ""}${(p.canal || p.origem === "site") ? ` <span class="cp-canal">${esc(p.canal || "Site")}</span>` : ""}</p>
          <div class="cp-info">
            ${entrega}
            ${p.rastreio ? `<a class="cp-rastreio" href="${esc(window.HPR_RASTREIO.dePedido(p).link)}" target="_blank" rel="noopener" title="Abrir o rastreio">📦 ${esc(window.HPR_RASTREIO.limpar(p.rastreio))}</a>` : ""}
            ${(p.referencias || []).length ? `<span class="cp-ref">${p.referencias.length} ${p.referencias.length > 1 ? "imagens" : "imagem"} de referência</span>` : ""}
            ${Number.isFinite(c.valor) ? `<span>${brl(c.total)}${c.frete > 0 ? ` <small class="cp-frete">(frete ${brl(c.frete)})</small>` : ""}${c.pago ? ` <span class="cp-pago">pago</span>` : c.total > 0 ? ` <span class="cp-a-receber">${c.sinal > 0 ? `falta ${brl(c.falta)}` : "a receber"}</span>` : ""}</span>` : ""}
            ${p.envio ? `<span class="cp-envio">${esc(p.envio.split(" · ")[0])}</span>` : ""}
          </div>
          ${producaoCartao(p)}
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
  // opcoes.andamento: avisa que peças ficaram prontas, sem mudar de etapa
  let oferta = null;
  function oferecerWhatsapp(p, opcoes = {}) {
    const caixa = $("#aviso-zap");
    const temZap = !!soNumeros(p.telefone);
    const temEmail = !!opcoes.andamento && !!p.email && !!window.HPR_EMAIL?.configurado(estado.site?.email);
    if (!temZap && !temEmail) { caixa.hidden = true; return; }
    oferta = { p, opcoes };
    const nome = esc((p.cliente || "o cliente").split(" ")[0]);
    const g = H.progresso(H.lista(p));
    $("#aviso-zap-titulo").innerHTML = opcoes.andamento
      ? `Avisar <b>${nome}</b> que <b>${g.feitas} de ${g.total} ${g.total > 1 ? "peças" : "peça"}</b> do pedido ${g.completo ? "ficaram prontas" : "estão prontas"}?`
      : `Avisar <b>${nome}</b> que o pedido <b>${FRASE_STATUS[p.status] || "mudou de etapa"}</b>?`;
    $("#aviso-zap-link").hidden = !temZap;
    if (temZap) $("#aviso-zap-link").href = linkZap(p.telefone, window.HPR_EMAIL.mensagemWhatsapp(p, p.status, opcoes));
    $("#aviso-zap-email").hidden = !temEmail;
    caixa.hidden = false;
    clearTimeout(oferecerWhatsapp.t);
    oferecerWhatsapp.t = setTimeout(() => (caixa.hidden = true), 20000);
  }
  $("#aviso-zap-fechar").addEventListener("click", () => ($("#aviso-zap").hidden = true));
  $("#aviso-zap-email").addEventListener("click", async () => {
    if (!oferta) return;
    const { p, opcoes } = oferta;
    const b = $("#aviso-zap-email");
    b.disabled = true;
    const r = await window.HPR_EMAIL.enviarEmailPedido({ ...estado.site.email, whatsapp: estado.site.whatsapp }, p, p.status, opcoes).catch(() => ({ ok: false }));
    b.disabled = false;
    $("#aviso-zap").hidden = true;
    avisar(r.ok ? `E-mail enviado para ${p.email}.` : "O e-mail para o cliente falhou.", !r.ok, 5000);
  });
  $("#aviso-zap-link").addEventListener("click", () => setTimeout(() => ($("#aviso-zap").hidden = true), 300));

  // E-mail para o cliente quando o status muda (EmailJS, configurado na aba Loja)
  async function avisarCliente(p, opcoes = {}) {
    const cfg = estado.site?.email;
    if (!window.HPR_EMAIL?.configurado(cfg) || !p.email) return "";
    const r = await window.HPR_EMAIL.enviarEmailPedido({ ...cfg, whatsapp: estado.site.whatsapp }, p, p.status, opcoes).catch((e) => ({ ok: false, motivo: e.message }));
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
    const f = e.target.closest("[data-feito]");
    if (f) {
      const [id, k, delta] = f.dataset.feito.split("|");
      mudarProducao(id, Number(k), Number(delta));
    }
  });
  $("#lista-pedidos").addEventListener("toggle", (e) => {
    const d = e.target.closest?.("[data-prod]");
    if (d) d.open ? producaoAberta.add(d.dataset.prod) : producaoAberta.delete(d.dataset.prod);
  }, true);

  // A etapa acompanha a produção: primeira peça pronta = Imprimindo; todas prontas = Pronto
  function etapaPelaProducao(status, itens, delta) {
    const g = H.progresso(itens);
    if (g.completo && ["aprovado", "imprimindo"].includes(status)) return "pronto";
    if (g.feitas > 0 && status === "aprovado") return "imprimindo";
    if (delta < 0 && !g.completo && status === "pronto") return "imprimindo";
    return status;
  }
  async function mudarProducao(id, k, delta) {
    const p = estado.pedidos.find((x) => x.id === id);
    const its = p ? H.lista(p) : [];
    const it = its[k];
    if (!it) return;
    const feito = Math.min(it.qtd, Math.max(0, it.feito + delta));
    if (feito === it.feito) return;
    const antes = { itens: p.itens, status: p.status, historico: p.historico, atualizadoEm: p.atualizadoEm };
    its[k] = { ...it, feito };
    p.itens = its;
    const novoStatus = etapaPelaProducao(p.status, its, delta);
    const mudouStatus = novoStatus !== p.status;
    if (mudouStatus) {
      p.status = novoStatus;
      p.historico = [...(p.historico || []), { status: novoStatus, em: agora() }];
    }
    p.atualizadoEm = agora();
    desenharLista();
    try {
      await salvarPedido(p);
      if (mudouStatus) {
        // Mudou de etapa: o aviso é o de sempre (e-mail automático + WhatsApp pronto)
        const extra = (await avisarCliente(p)) + ((await O.lancarPedido?.(p)) || "");
        avisar(`${p.id} agora está ${statusDe(p.status).nome.toLowerCase()}.${extra}`, extra.includes("falhou"), 6000);
        oferecerWhatsapp(p);
      } else {
        oferecerWhatsapp(p, { andamento: true });
      }
    } catch (err) {
      Object.assign(p, antes);
      desenharLista();
      avisar("Não consegui salvar: " + erroLegivel(err), true, 7000);
    }
  }
  $("#novo-pedido").addEventListener("click", () => abrir(null));

  // ---------- Editor de pedido ----------
  const CAMPOS = {
    cliente: "#o-cliente", telefone: "#o-telefone", email: "#o-email", canal: "#o-canal", cidade: "#o-cidade", peca: "#o-peca", quantidade: "#o-quantidade",
    cor: "#o-cor", prazo: "#o-prazo", entrega: "#o-entrega", detalhes: "#o-detalhes", valor: "#o-valor", sinal: "#o-sinal",
    frete: "#o-frete", envio: "#o-envio", cep: "#o-cep",
    endereco: "#o-endereco", numero: "#o-numero", complemento: "#o-complemento", bairro: "#o-bairro", uf: "#o-uf", documento: "#o-documento",
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
    atual.itens = H.lista(atual);
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
    desenharItens();
    $("#o-pago").checked = !!atual.pago;
    atualizarRastreio(false);
    desenharEtiqueta();
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
    // Com itens, peça, quantidade e cor do pedido vêm da lista (as colunas antigas servem de resumo)
    const its = H.lista({ itens: atual.itens || [] });
    if (its.length) {
      d.peca = H.resumo(its).slice(0, 300);
      d.quantidade = String(Math.min(10000, H.unidades(its)));
      d.cor = [...new Set(its.map((i) => i.cor).filter(Boolean))].join(", ").slice(0, 120);
      d.pecaId = its.length === 1 ? its[0].id || "" : "";
    }
    return d;
  }

  // ---------- Itens do pedido (carrinho) e produção ----------
  const pecaPorNome = (nome) => estado.pecas.find((p) => p.nome.toLowerCase() === String(nome).trim().toLowerCase());
  function desenharItens() {
    const its = atual.itens || [];
    const tem = its.length > 0;
    for (const s of ["#o-peca-campo", "#o-quantidade-campo", "#o-cor-campo"]) $(s).hidden = tem;
    $("#o-tudo-pronto").hidden = !tem;
    const norm = H.lista({ itens: its });
    const g = H.progresso(norm);
    const pr = $("#o-progresso");
    pr.hidden = !norm.length;
    pr.innerHTML = norm.length
      ? `<div class="cp-prog-topo"><span>Peças prontas</span><b>${g.feitas} de ${g.total} (${g.pct}%)</b></div><div class="barra-prod" role="progressbar" aria-valuemin="0" aria-valuemax="${g.total}" aria-valuenow="${g.feitas}"><i style="width:${g.pct}%"></i></div>`
      : "";
    $("#o-itens").innerHTML = its.map((i, k) => {
      const qtd = Math.max(1, parseInt(i.qtd, 10) || 1);
      const feito = Math.min(qtd, Math.max(0, parseInt(i.feito, 10) || 0));
      return `<div class="o-item${feito >= qtd ? " pronto" : ""}" data-k="${k}">
        <input data-campo="nome" list="o-lista-pecas" value="${esc(i.nome)}" placeholder="Peça" aria-label="Peça do item ${k + 1}">
        <input data-campo="qtd" type="number" min="1" inputmode="numeric" value="${qtd}" aria-label="Quantidade do item ${k + 1}">
        <input data-campo="cor" value="${esc(i.cor || "")}" placeholder="Cor" aria-label="Cor do item ${k + 1}">
        <div class="cpi-ctrl">
          <button type="button" data-delta="-1" ${feito <= 0 ? "disabled" : ""} aria-label="Uma a menos produzida">−</button>
          <b>${feito}/${qtd}</b>
          <button type="button" data-delta="1" ${feito >= qtd ? "disabled" : ""} aria-label="Mais uma produzida">+</button>
          <button type="button" class="ok" data-pronto ${feito >= qtd ? "disabled" : ""}>Pronto</button>
        </div>
        <button type="button" class="o-rem" data-rem aria-label="Remover item ${k + 1}">×</button>
      </div>`;
    }).join("");
    $("#o-itens-dica").textContent = tem
      ? "Use + a cada peça que sair da impressora. O cliente vê o andamento em Meus pedidos e, ao salvar, dá para avisar por e-mail e WhatsApp."
      : "Pedido de uma peça só ou ideia livre. Para acompanhar a produção peça por peça, adicione itens.";
  }
  // A etapa do pedido acompanha a produção (só sugere mudando o campo Status; quem confirma é o Salvar)
  function acertarEtapaDoEditor(delta) {
    const novo = etapaPelaProducao($("#o-status").value, H.lista({ itens: atual.itens || [] }), delta);
    if (novo !== $("#o-status").value) {
      $("#o-status").value = novo;
      avisar(`Pedido passou para ${statusDe(novo).nome}. Salve para avisar o cliente.`, false, 4000);
    }
  }
  function mexeuNosItens(delta = 0) {
    if (delta) acertarEtapaDoEditor(delta);
    desenharItens();
    atualizarLado();
  }
  $("#o-itens").addEventListener("input", (e) => {
    const campo = e.target.closest("[data-campo]");
    if (!campo) return;
    const i = atual.itens[Number(campo.closest("[data-k]").dataset.k)];
    if (!i) return;
    const c = campo.dataset.campo;
    if (c === "nome") {
      i.nome = campo.value;
      const pc = pecaPorNome(campo.value);
      i.id = pc ? pc.id : null;
      i.foto = pc ? pc.foto || pc.fotos?.[0] || "" : "";
      i.preco = pc ? pc.precoVitrine || null : null;
    } else if (c === "qtd") {
      i.qtd = Math.max(1, parseInt(campo.value, 10) || 1);
      i.feito = Math.min(i.qtd, i.feito || 0);
    } else i.cor = campo.value;
    atualizarLado();
  });
  // Ao sair do campo de quantidade, redesenha (o contador "n/total" muda)
  $("#o-itens").addEventListener("change", (e) => { if (e.target.closest('[data-campo="qtd"], [data-campo="nome"]')) mexeuNosItens(); });
  $("#o-itens").addEventListener("click", (e) => {
    const linha = e.target.closest("[data-k]");
    if (!linha) return;
    const k = Number(linha.dataset.k);
    const i = atual.itens[k];
    if (!i) return;
    const qtd = Math.max(1, parseInt(i.qtd, 10) || 1);
    if (e.target.closest("[data-delta]")) {
      const delta = Number(e.target.closest("[data-delta]").dataset.delta);
      i.feito = Math.min(qtd, Math.max(0, (i.feito || 0) + delta));
      mexeuNosItens(delta);
    } else if (e.target.closest("[data-pronto]")) {
      i.feito = qtd;
      mexeuNosItens(1);
    } else if (e.target.closest("[data-rem]")) {
      atual.itens.splice(k, 1);
      mexeuNosItens();
    }
  });
  $("#o-add-item").addEventListener("click", () => {
    atual.itens ||= [];
    const d = lerForm();
    if (!atual.itens.length && d.peca) {
      // Primeiro item: aproveita a peça, quantidade e cor que já estavam preenchidas
      atual.itens.push({ id: d.pecaId || null, nome: d.peca, qtd: Math.max(1, parseInt(d.quantidade, 10) || 1), cor: d.cor, feito: 0 });
      avisar("Passei a peça do pedido para a lista de itens. Toque de novo para somar outro item.", false, 5000);
    } else {
      atual.itens.push({ id: null, nome: "", qtd: 1, cor: "", feito: 0 });
    }
    mexeuNosItens();
    const linhas = $$("#o-itens .o-item");
    linhas[linhas.length - 1]?.querySelector('[data-campo="nome"]').focus();
  });
  $("#o-tudo-pronto").addEventListener("click", () => {
    (atual.itens || []).forEach((i) => (i.feito = Math.max(1, parseInt(i.qtd, 10) || 1)));
    mexeuNosItens(1);
  });
  // Frete e etiqueta consideram todas as peças numa caixa só
  function listaFreteAdm() {
    const its = H.lista({ itens: atual.itens || [] });
    if (its.length < 2) return null;
    return its.map((i) => {
      const pc = estado.pecas.find((x) => x.id === i.id);
      return { peca: pc && { id: pc.id, preco: pc.precoVitrine, caracteristicas: pc.caracteristicas }, quantidade: i.qtd };
    });
  }

  function atualizarLado() {
    const d = { ...atual, ...lerForm() };
    $("#o-codigo").textContent = atual.id || "será gerado ao salvar";
    const c = contas(d);
    $("#o-peca-ligada").textContent = H.lista(d).length
      ? ""
      : c.peca
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
      const r = await F.simular({ sb: window.HPR_SUPABASE, site: estado.site, cep: d.cep, peca: peca && { id: peca.id, preco: peca.precoVitrine, caracteristicas: peca.caracteristicas }, quantidade: d.quantidade, lista: listaFreteAdm() });
      opcoesAdm = r.opcoes;
      alvo.innerHTML = `<p class="dica">${esc(r.endereco.cidade)}/${esc(r.endereco.uf)} · ${r.fonte === "real" ? "preço do Melhor Envio" : "tabela da loja"}. Toque para usar:</p>` +
        (r.opcoes.length ? `<div class="frete-adm-opcoes">${r.opcoes.map((o, i) => `<button type="button" class="filtro" data-frete="${i}">${esc(o.nome)} · ${o.valor > 0 ? brl(o.valor) : "grátis"}${o.prazo ? ` <small>${esc(o.prazo)}</small>` : ""}</button>`).join("")}</div>`
          : `<p class="dica alerta">Sem valor para essa região. Preencha a tabela de frete na aba Loja.</p>`);
      if (!$("#o-cidade").value.trim()) $("#o-cidade").value = `${r.endereco.cidade}/${r.endereco.uf}`;
      if (!$("#o-endereco").value.trim()) $("#o-endereco").value = r.endereco.rua || "";
      if (!$("#o-bairro").value.trim()) $("#o-bairro").value = r.endereco.bairro || "";
      $("#o-uf").value = r.endereco.uf || $("#o-uf").value;
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
      uf: d.uf.toUpperCase().slice(0, 2),
      documento: d.documento.replace(/\D/g, "") || null,
      sinal: d.sinal === "" ? null : P.num(d.sinal),
      itens: H.lista({ itens: atual.itens || [] }),
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
      // Peças prontas a mais (ou a menos) sem mudar de etapa: avisa o andamento
      const mudouProducao = !!existente && !mudouStatus && pedido.itens.length > 0 &&
        H.progresso(pedido.itens).feitas !== H.progresso(H.lista(existente)).feitas;
      // E-mail: ao criar um pedido manual (Recebemos seu pedido) e a cada mudança de status ou de produção
      const extra = ((mudouStatus || mudouProducao) && $("#o-avisar").checked ? await avisarCliente(pedido, { andamento: mudouProducao }) : "") +
        (mudouStatus ? (await O.lancarPedido?.(pedido)) || "" : "");
      if (existente && (!!existente.pago !== !!pedido.pago || P.num(existente.valor, 0) !== P.num(pedido.valor, 0) || P.num(existente.frete, 0) !== P.num(pedido.frete, 0)))
        await O.sincronizarPago?.(pedido);
      avisar(`Pedido ${id} salvo.${extra}`, extra.includes("falhou"), extra ? 6000 : 3800);
      if (mudouStatus) oferecerWhatsapp(pedido);
      else if (mudouProducao) oferecerWhatsapp(pedido, { andamento: true });
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

  // ---------- Etiqueta do Melhor Envio ----------
  async function chamarEtiqueta(corpo) {
    const { data, error } = await db.functions.invoke("etiqueta", { body: corpo });
    if (error) {
      let j = {};
      try { j = await error.context.json(); } catch {}
      const e = new Error(j.erro || error.message);
      e.dados = j;
      throw e;
    }
    return data;
  }
  function desenharEtiqueta() {
    const et = atual?.etiqueta;
    const info = $("#o-etiqueta-info");
    const botao = $("#o-gerar-etiqueta");
    botao.hidden = !!et?.gerada;
    botao.textContent = et?.id && !et.gerada ? "Concluir etiqueta" : "Gerar etiqueta no Melhor Envio";
    if (!et?.id) { info.innerHTML = `<p class="dica">Compra a etiqueta com o saldo do Melhor Envio e já preenche o código de rastreio.</p>`; return; }
    const desc = [et.nome_servico, et.empresa].filter(Boolean).join(" · ");
    info.innerHTML = et.gerada
      ? `<p class="dica"><b>Etiqueta gerada</b>${desc ? ` (${esc(desc)}${et.valor ? `, ${brl(et.valor)}` : ""})` : ""}${et.rastreio ? ` · rastreio ${esc(et.rastreio)}` : " · o código de rastreio pode levar alguns minutos"}.</p>
         <div class="acoes-linha">
           ${et.url ? `<a class="botao botao-principal botao-pequeno" href="${esc(et.url)}" target="_blank" rel="noopener">Imprimir etiqueta</a>` : ""}
           <button class="botao botao-contorno botao-pequeno" type="button" id="o-etiqueta-atualizar">${et.url && et.rastreio ? "Atualizar" : "Buscar link e rastreio"}</button>
         </div>
         <p class="dica">Depois de postar, mude o status para <b>Enviado</b> e salve: o cliente recebe o rastreio.</p>`
      : `<p class="dica alerta">A etiqueta está no carrinho do Melhor Envio, mas ainda não foi paga. Coloque saldo lá e toque em <b>Concluir etiqueta</b>.</p>`;
  }
  function aplicarEtiqueta(et) {
    atual.etiqueta = et;
    if (et.rastreio) {
      atual.rastreio = et.rastreio;
      $("#o-rastreio").value = et.rastreio;
      const t = /^ME/i.test(et.rastreio) ? "outra" : /correios/i.test(et.empresa) ? "correios" : /jadlog/i.test(et.empresa) ? "jadlog" : /loggi/i.test(et.empresa) ? "loggi" : /j&t/i.test(et.empresa) ? "jt" : "outra";
      atual.transportadora = t;
      $("#o-transportadora").value = t;
    }
    if (et.envio_texto && !$("#o-envio").value) $("#o-envio").value = et.envio_texto;
    const salvo = estado.pedidos.find((x) => x.id === atual.id);
    if (salvo) Object.assign(salvo, { etiqueta: et, rastreio: atual.rastreio, transportadora: atual.transportadora });
    atualizarRastreio(false);
    desenharEtiqueta();
    atualizarLado();
  }

  const dlgEt = $("#dlg-etiqueta");
  let opcoesEt = [];
  $("#o-gerar-etiqueta").addEventListener("click", async () => {
    if (!atual?.id || !estado.pedidos.some((x) => x.id === atual.id)) { avisar("Salve o pedido antes de gerar a etiqueta.", true); return; }
    const d = lerForm();
    const salvo = estado.pedidos.find((x) => x.id === atual.id);
    const norm = (k, v) => (k === "cep" || k === "documento" ? String(v || "").replace(/\D/g, "") : String(v || "").trim().toLowerCase());
    const mudou = ["cliente", "cep", "endereco", "numero", "complemento", "bairro", "uf", "documento", "telefone"]
      .some((k) => norm(k, d[k]) !== norm(k, salvo[k]));
    if (mudou) { avisar("Salve o pedido primeiro: o endereço ou os dados do cliente mudaram.", true, 6000); return; }
    if (!d.endereco || !d.numero || d.cep.replace(/\D/g, "").length !== 8) { avisar("Preencha CEP, rua e número do cliente e salve.", true, 6000); $("#o-endereco").focus(); return; }
    // Etiqueta que ficou no carrinho: só conclui
    if (atual.etiqueta?.id && !atual.etiqueta.gerada) return concluirEtiqueta();
    const F = window.HPR_FRETE;
    const cfg = F.config(estado.site);
    const peca = estado.pecas.find((p) => p.id === d.pecaId);
    const varias = listaFreteAdm();
    const cx = varias ? F.caixaVarios(cfg, varias) : F.caixa(cfg, peca && { id: peca.id, preco: peca.precoVitrine, caracteristicas: peca.caracteristicas }, d.quantidade);
    $("#et-altura").value = cx.altura; $("#et-largura").value = cx.largura; $("#et-comprimento").value = cx.comprimento; $("#et-peso").value = cx.peso;
    $("#et-caixa-origem").textContent = cx.origem === "peca" ? "(pelas medidas da peça + folga)" : "(caixa padrão + folga; confira)";
    $("#et-valor").value = (P.num(d.valor, 0) || cx.valor).toFixed(2);
    $("#et-opcoes").innerHTML = "";
    $("#et-comprar").disabled = true;
    opcoesEt = [];
    dlgEt.showModal();
    $("#et-saldo").textContent = "Consultando saldo do Melhor Envio…";
    try {
      const r = await chamarEtiqueta({ acao: "saldo" });
      $("#et-saldo").innerHTML = `Saldo no Melhor Envio: <b>${brl(r.saldo)}</b>`;
    } catch (e) { $("#et-saldo").innerHTML = `<span class="erro">${esc(e.message)}</span>`; }
    cotarEtiqueta();
  });
  const volumeEt = () => ({ altura: $("#et-altura").value, largura: $("#et-largura").value, comprimento: $("#et-comprimento").value, peso: $("#et-peso").value });
  async function cotarEtiqueta() {
    const alvo = $("#et-opcoes");
    alvo.innerHTML = `<p class="dica">Buscando preços…</p>`;
    $("#et-comprar").disabled = true;
    try {
      const r = await chamarEtiqueta({ acao: "cotar", pedido: atual.id, volume: volumeEt(), valor: $("#et-valor").value });
      opcoesEt = r.opcoes || [];
      const escolhido = (atual.envio || "").toLowerCase();
      alvo.innerHTML = opcoesEt.length
        ? `<div class="frete-adm-opcoes et-lista">${opcoesEt.map((o, i) => {
            const marcar = escolhido && escolhido.includes(o.nome.toLowerCase());
            return `<label class="et-opcao"><input type="radio" name="et-servico" value="${i}" ${marcar ? "checked" : ""}>
              <span>${esc(o.nome)} <small>${esc(o.empresa)}${o.prazoMax ? ` · ${window.HPR_FRETE.textoPrazo(o.prazoMin, o.prazoMax)}` : ""}</small></span><b>${brl(o.valor)}</b></label>`;
          }).join("")}</div>`
        : `<p class="dica alerta">Nenhuma opção para essa caixa e esse CEP.</p>`;
      $("#et-comprar").disabled = !alvo.querySelector("input:checked");
    } catch (e) { alvo.innerHTML = `<p class="dica erro">${esc(e.message)}</p>`; }
  }
  $("#et-cotar").addEventListener("click", cotarEtiqueta);
  $("#et-opcoes").addEventListener("change", () => ($("#et-comprar").disabled = !$("#et-opcoes input:checked")));
  $("#et-fechar").addEventListener("click", () => dlgEt.close());
  $("#et-comprar").addEventListener("click", async () => {
    const o = opcoesEt[Number($("#et-opcoes input:checked")?.value)];
    if (!o) return;
    if (!confirm(`Comprar etiqueta ${o.nome} (${o.empresa}) por ${brl(o.valor)} com o saldo do Melhor Envio?`)) return;
    const b = $("#et-comprar");
    b.disabled = true; b.textContent = "Comprando…";
    try {
      const r = await chamarEtiqueta({ acao: "comprar", pedido: atual.id, servico: o.servico, nome: o.nome, empresa: o.empresa, preco: o.valor, volume: volumeEt(), valor: $("#et-valor").value });
      aplicarEtiqueta(r.etiqueta);
      dlgEt.close();
      avisar(`Etiqueta gerada!${r.etiqueta.rastreio ? ` Rastreio ${r.etiqueta.rastreio}.` : ""} Imprima, cole na caixa e poste.`, false, 9000);
      if (r.etiqueta.url) window.open(r.etiqueta.url, "_blank", "noopener");
    } catch (e) {
      if (e.dados?.etiqueta) aplicarEtiqueta(e.dados.etiqueta);
      avisar(e.message, true, 12000);
    } finally { b.textContent = "Comprar etiqueta"; b.disabled = false; }
  });
  async function concluirEtiqueta() {
    const b = $("#o-etiqueta-atualizar") || $("#o-gerar-etiqueta");
    b.disabled = true;
    try {
      const r = await chamarEtiqueta({ acao: "atualizar", pedido: atual.id });
      aplicarEtiqueta(r.etiqueta);
      avisar(r.etiqueta.rastreio ? `Rastreio ${r.etiqueta.rastreio}.` : "Etiqueta ok. O rastreio ainda não saiu, tente de novo em alguns minutos.");
    } catch (e) { avisar(e.message, true, 10000); }
    finally { b.disabled = false; }
  }
  $("#o-etiqueta-info").addEventListener("click", (e) => { if (e.target.closest("#o-etiqueta-atualizar")) concluirEtiqueta(); });

  O.ganchos.pedidos = abrirPedidos;
  O.lerMensagemPedido = lerMensagem; // usado nos testes
})();
