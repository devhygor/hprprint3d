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

  const amostraCor = (hex) => (hex === "transparente"
    ? "background:repeating-conic-gradient(#d9d2ff 0 25%, #fff 0 50%) 0 0/8px 8px"
    : `background:${/^#[0-9a-f]{3,8}$/i.test(hex) ? hex : "#999"}`);
  const fmt = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  function resumoCaracteristicas(c = {}) {
    const itens = [];
    const medidas = [c.largura, c.altura, c.profundidade].filter((x) => Number(x) > 0);
    if (medidas.length) itens.push(`${medidas.map(fmt).join(" × ")} cm`);
    if (Number(c.peso) > 0) itens.push(`${fmt(c.peso)} g`);
    if (c.material) itens.push(c.material);
    return itens;
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
        return `<article class="peca" data-peca="${esc(p.id)}">
          <a class="peca-foto" href="#peca-${encodeURIComponent(p.id)}" data-detalhe="${esc(p.id)}" aria-label="Ver detalhes de ${esc(p.nome)}">${foto}</a>
          <div class="peca-corpo">
            <span class="peca-categoria" style="--cor:${corDaCategoria(p.categoria || "Outros")}">${esc(p.categoria || "Outros")}</span>
            <h3><a href="#peca-${encodeURIComponent(p.id)}" data-detalhe="${esc(p.id)}">${esc(p.nome)}</a></h3>
            ${p.descricao ? `<div class="peca-desc-bloco"><p class="peca-desc" id="desc-${esc(p.id)}">${esc(p.descricao)}</p><button type="button" class="ver-mais" data-ver-mais aria-expanded="false" aria-controls="desc-${esc(p.id)}" hidden>Ver mais</button></div>` : ""}
            ${(() => {
              const c = p.caracteristicas || {};
              const resumo = resumoCaracteristicas(c);
              const extras = (c.extras || []).slice(0, 4);
              if (!resumo.length && !extras.length) return "";
              return `<ul class="peca-carac" aria-label="Características">
                ${resumo.map((t) => `<li>${esc(t)}</li>`).join("")}
                ${extras.map((x) => `<li>${esc(x.nome)}${x.valor ? `: ${esc(x.valor)}` : ""}</li>`).join("")}
              </ul>`;
            })()}
            ${(p.cores || []).length ? `<div class="peca-cores" aria-label="Cores disponíveis: ${esc(p.cores.map((c) => c.nome).join(", "))}">
              ${p.cores.slice(0, 10).map((c) => `<span class="peca-cor" style="${amostraCor(c.hex)}" title="${esc(c.nome)}"></span>`).join("")}
              ${p.cores.length > 10 ? `<span class="peca-cores-mais">+${p.cores.length - 10}</span>` : ""}
              ${p.caracteristicas?.outrasCores ? `<span class="peca-cores-mais">e outras sob encomenda</span>` : ""}
            </div>` : ""}
            <div class="peca-rodape">
              ${preco}
              <a class="botao botao-principal botao-pequeno" href="#pedido" data-pedir="${esc(p.nome)}" data-id="${esc(p.id)}">Pedir</a>
            </div>
          </div>
        </article>`;
      })
      .join("");
    marcarTextosLongos();
  }

  // Mostra "Ver mais" só quando a descrição passa do limite de linhas do card
  function marcarTextosLongos() {
    requestAnimationFrame(() => {
      grade.querySelectorAll(".peca-desc-bloco").forEach((b) => {
        const p = b.querySelector(".peca-desc");
        b.querySelector("[data-ver-mais]").hidden = p.scrollHeight <= p.clientHeight + 2;
      });
    });
  }
  window.addEventListener("resize", () => { clearTimeout(marcarTextosLongos.t); marcarTextosLongos.t = setTimeout(marcarTextosLongos, 150); });

  grade.addEventListener("click", (e) => {
    const vm = e.target.closest("[data-ver-mais]");
    if (vm) {
      const aberto = vm.getAttribute("aria-expanded") === "true";
      vm.setAttribute("aria-expanded", String(!aberto));
      vm.textContent = aberto ? "Ver mais" : "Ver menos";
      vm.parentElement.classList.toggle("aberta", !aberto);
      return;
    }
    const d = e.target.closest("[data-detalhe]");
    if (d) { e.preventDefault(); abrirDetalhe(d.dataset.detalhe, true); }
  });

  // ---------- Detalhes da peça ----------
  const dialogo = document.getElementById("detalhe-peca");
  function abrirDetalhe(id, mudarEndereco) {
    const p = pecas.find((x) => x.id === id);
    if (!p) return;
    const c = p.caracteristicas || {};
    const medidas = [["Largura", c.largura], ["Altura", c.altura], ["Profundidade", c.profundidade]].filter(([, v]) => Number(v) > 0);
    const linhas = [
      medidas.length && ["Tamanho", `${medidas.map(([, v]) => fmt(v)).join(" × ")} cm`, medidas.map(([n]) => n.toLowerCase()).join(" × ")],
      Number(c.peso) > 0 && ["Peso", `${fmt(c.peso)} g`],
      c.material && ["Material", c.material],
      ...(c.extras || []).map((x) => [x.nome, x.valor || "Sim"]),
    ].filter(Boolean);
    const cores = p.cores || [];
    dialogo.querySelector(".detalhe-conteudo").innerHTML = `
      <div class="detalhe-foto${p.foto ? "" : " vazia"}" ${p.foto ? `style="--foto:url('${esc(p.foto).replace(/'/g, "%27")}')"` : ""}>
        ${p.foto
          ? `<a href="${esc(p.foto)}" target="_blank" rel="noopener" class="detalhe-foto-link" aria-label="Abrir a foto de ${esc(p.nome)} em tamanho original"><img src="${esc(p.foto)}" alt="${esc(p.nome)}"></a>
             <span class="detalhe-zoom" aria-hidden="true">Toque para ampliar</span>`
          : `<span class="sem-foto">Foto em breve</span>`}
      </div>
      <div class="detalhe-info">
        <span class="peca-categoria" style="--cor:${corDaCategoria(p.categoria || "Outros")}">${esc(p.categoria || "Outros")}</span>
        <h2 id="detalhe-titulo">${esc(p.nome)}</h2>
        <p class="detalhe-preco">${p.preco ? `<small>a partir de</small>${brl(Number(p.preco))}` : `<small>valor</small>Sob consulta`}</p>
        ${p.descricao ? `<div class="detalhe-desc">${esc(p.descricao).split(/\n{2,}/).map((par) => `<p>${par.replace(/\n/g, "<br>")}</p>`).join("")}</div>` : ""}
        ${linhas.length ? `<h3>Características</h3>
          <dl class="detalhe-tabela">${linhas.map(([k, v, obs]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${obs ? `<small>${esc(obs)}</small>` : ""}</dd></div>`).join("")}</dl>` : ""}
        ${cores.length ? `<h3>Cores disponíveis</h3>
          <ul class="detalhe-cores">${cores.map((cor) => `<li><span class="peca-cor" style="${amostraCor(cor.hex)}"></span>${esc(cor.nome)}</li>`).join("")}</ul>
          ${c.outrasCores ? `<p class="detalhe-obs">Outras cores sob encomenda, é só pedir.</p>` : ""}` : ""}
        <a class="botao botao-principal detalhe-pedir" href="#pedido" data-pedir="${esc(p.nome)}" data-id="${esc(p.id)}">Pedir esta peça</a>
      </div>`;
    if (!dialogo.open) dialogo.showModal();
    dialogo.querySelector(".detalhe-conteudo").scrollTop = 0;
    if (mudarEndereco) history.pushState({ peca: id }, "", `#peca-${encodeURIComponent(id)}`);
    document.title = `${p.nome} | HPR Print 3D`;
  }
  function fecharDetalhe(voltarEndereco) {
    if (dialogo.open) dialogo.close();
    document.title = "HPR Print 3D | Peças impressas em 3D";
    if (voltarEndereco && location.hash.startsWith("#peca-")) history.pushState({}, "", location.pathname + location.search);
  }
  dialogo.addEventListener("click", (e) => {
    if (e.target === dialogo || e.target.closest("[data-fechar]")) { fecharDetalhe(true); return; }
    const b = e.target.closest("[data-pedir]");
    if (b) { e.preventDefault(); fecharDetalhe(true); prepararPedido(b.dataset.pedir, b.dataset.id); }
  });
  dialogo.addEventListener("cancel", (e) => { e.preventDefault(); fecharDetalhe(true); });
  window.addEventListener("popstate", () => {
    const m = location.hash.match(/^#peca-(.+)$/);
    if (m) abrirDetalhe(decodeURIComponent(m[1]), false); else fecharDetalhe(false);
  });

  filtros.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    filtroAtual = b.dataset.cat;
    desenharFiltros();
    desenharGrade();
  });

  // ---------- Pedido pelo WhatsApp ----------
  const numeroZap = () => String(site.whatsapp || "5561981600889").replace(/\D/g, "");

  // Botão "Pedir": leva ao formulário já com a peça preenchida e sugere as cores dela
  function prepararPedido(nome, id) {
    document.getElementById("pedido-peca").value = nome;
    const peca = pecas.find((x) => x.id === id);
    const cores = (peca?.cores || []).map((c) => c.nome);
    document.getElementById("cores-sugeridas").innerHTML = cores.map((n) => `<option value="${esc(n)}">`).join("");
    document.querySelector('#form-pedido [name="cor"]').placeholder = cores.length ? `Disponível: ${cores.slice(0, 4).join(", ")}${cores.length > 4 ? "…" : ""}` : "Ex.: azul e branco";
    document.getElementById("pedido").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setTimeout(() => document.querySelector('#form-pedido [name="nome"]').focus({ preventScroll: true }), 400);
  }
  grade.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pedir]");
    if (!b) return;
    e.preventDefault();
    prepararPedido(b.dataset.pedir, b.dataset.id);
  });

  // ---------- Sessão do cliente (se ele entrou em "Meus pedidos") ----------
  function sessaoCliente() {
    try {
      const ref = (window.HPR_SUPABASE?.url || "").match(/https:\/\/([a-z0-9]+)\./)?.[1];
      const s = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) || "null");
      if (!s?.access_token || !s.user || (s.expires_at && s.expires_at * 1000 < Date.now() + 60000)) return null;
      return { token: s.access_token, id: s.user.id, email: s.user.email, nome: s.user.user_metadata?.full_name || s.user.user_metadata?.name || "" };
    } catch { return null; }
  }
  const cliente = sessaoCliente();
  if (cliente) {
    const form = document.getElementById("form-pedido");
    if (!form.email.value) form.email.value = cliente.email || "";
    if (!form.nome.value) form.nome.value = cliente.nome || "";
    document.getElementById("link-conta").textContent = "Minha conta";
  }

  // ---------- Imagens de referência ----------
  const MAX_REFS = 3;
  let refs = []; // { blob, url }
  const caixaRefs = document.getElementById("referencias");
  const botaoAdd = document.getElementById("ref-adicionar");

  async function reduzir(arquivo) {
    const img = await new Promise((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = falha;
      i.src = URL.createObjectURL(arquivo);
    });
    const fator = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * fator);
    c.height = Math.round(img.height * fator);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  }
  function desenharRefs() {
    caixaRefs.querySelectorAll(".ref-item").forEach((el) => el.remove());
    refs.forEach((r, i) => {
      const el = document.createElement("div");
      el.className = "ref-item";
      el.innerHTML = `<img src="${r.url}" alt="Imagem de referência ${i + 1}"><button type="button" aria-label="Remover imagem ${i + 1}" data-remover="${i}">×</button>`;
      caixaRefs.insertBefore(el, botaoAdd);
    });
    botaoAdd.hidden = refs.length >= MAX_REFS;
  }
  document.getElementById("ref-arquivos").addEventListener("change", async (e) => {
    const erro = document.getElementById("pedido-erro");
    for (const arq of [...e.target.files].slice(0, MAX_REFS - refs.length)) {
      try {
        const blob = await reduzir(arq);
        refs.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        erro.textContent = `Não consegui abrir "${arq.name}". Use foto JPG, PNG ou WEBP.`;
        erro.hidden = false;
      }
    }
    e.target.value = "";
    desenharRefs();
  });
  caixaRefs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remover]");
    if (!b) return;
    const [r] = refs.splice(Number(b.dataset.remover), 1);
    URL.revokeObjectURL(r.url);
    desenharRefs();
  });

  // ---------- Envio do pedido ----------
  const sb = window.HPR_SUPABASE || {};
  const cabecalhos = (extra = {}) => ({ apikey: sb.chave, ...(cliente ? { Authorization: "Bearer " + cliente.token } : {}), ...extra });
  const comTempo = (promessa, ms) => Promise.race([promessa, new Promise((_, falha) => setTimeout(() => falha(new Error("tempo esgotado")), ms))]);

  async function enviarReferencias(codigo) {
    const caminhos = [];
    for (let i = 0; i < refs.length; i++) {
      const caminho = `${codigo}/${i + 1}-${Date.now().toString(36)}.jpg`;
      try {
        const r = await comTempo(fetch(`${sb.url}/storage/v1/object/referencias/${caminho}`, {
          method: "POST", headers: cabecalhos({ "Content-Type": "image/jpeg" }), body: refs[i].blob,
        }), 20000);
        if (r.ok) caminhos.push(caminho);
      } catch {}
    }
    return caminhos;
  }
  async function registrarPedido(pedido) {
    if (!sb.url || !sb.chave) return false;
    try {
      const r = await comTempo(fetch(`${sb.url}/rest/v1/pedidos`, {
        method: "POST",
        headers: cabecalhos({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify(pedido),
      }), 12000);
      return r.ok;
    } catch { return false; }
  }

  document.getElementById("form-pedido").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    const v = (k) => String(f.get(k) || "").trim();
    const erro = document.getElementById("pedido-erro");
    const ok = document.getElementById("pedido-ok");
    const faltando = [!v("nome") && "seu nome", !v("peca") && "a peça ou ideia"].filter(Boolean);
    const emailRuim = v("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("email"));
    if (faltando.length || emailRuim) {
      erro.textContent = faltando.length ? "Preencha " + faltando.join(" e ") + " para enviar." : "Confira o e-mail: parece que falta alguma coisa.";
      erro.hidden = false;
      form.querySelector(!v("nome") ? '[name="nome"]' : !v("peca") ? '[name="peca"]' : '[name="email"]').focus();
      return;
    }
    erro.hidden = true;
    // O WhatsApp abre sozinho no fim. No computador, reservamos a aba agora (no clique),
    // porque o navegador bloqueia abas abertas depois de uma espera. No celular, o app abre direto.
    const celular = matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    let aba = null;
    if (!celular) {
      try {
        aba = window.open("", "_blank");
        if (aba) aba.document.write('<!doctype html><meta charset="utf-8"><title>Abrindo o WhatsApp…</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#110628;color:#f6f2ff;font:600 18px system-ui,sans-serif">Registrando seu pedido e abrindo o WhatsApp…</body>');
      } catch { aba = null; }
    }
    const botao = document.getElementById("pedido-enviar");
    botao.disabled = true;
    botao.textContent = refs.length ? "Enviando imagens…" : "Enviando…";

    // Código curto pra vocês acharem o pedido depois: HPR-MMDD-XXXX
    const hoje = new Date();
    const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const sorteio = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => letras[n % letras.length]).join("");
    const codigo = `HPR-${String(hoje.getMonth() + 1).padStart(2, "0")}${String(hoje.getDate()).padStart(2, "0")}-${sorteio}`;

    const caminhos = refs.length ? await enviarReferencias(codigo) : [];
    const detalhes = [
      `*Código:* ${codigo}`,
      `*Pedido:* ${v("peca")}`,
      `*Quantidade:* ${v("quantidade") || "1"}`,
      v("cor") && `*Cor:* ${v("cor")}`,
      v("cidade") && `*Cidade/bairro:* ${v("cidade")}`,
      v("prazo") && `*Para quando:* ${v("prazo")}`,
      v("detalhes") && `*Detalhes:* ${v("detalhes")}`,
      caminhos.length && `*Imagens de referência:* ${caminhos.length} enviada${caminhos.length > 1 ? "s" : ""} pelo site`,
    ].filter(Boolean);
    const texto = [`Oi! Meu nome é ${v("nome")} e vi o site da HPR Print 3D.`, "", ...detalhes].join("\n");
    const pedido = {
      id: codigo,
      origem: "site",
      canal: "Site",
      status: "novo",
      cliente: v("nome").slice(0, 120),
      telefone: v("telefone").replace(/[^\d+ ()-]/g, "").slice(0, 30),
      email: v("email").toLowerCase().slice(0, 200) || null,
      cidade: v("cidade").slice(0, 160),
      peca: v("peca").slice(0, 300),
      quantidade: Math.min(10000, Math.max(1, parseInt(v("quantidade"), 10) || 1)),
      cor: v("cor").slice(0, 120),
      prazo: v("prazo").slice(0, 160),
      detalhes: v("detalhes").slice(0, 2000),
      mensagem: texto.slice(0, 4000),
      referencias: caminhos,
      historico: [{ status: "novo", em: new Date().toISOString() }],
      ...(cliente ? { cliente_id: cliente.id } : {}),
    };
    botao.textContent = "Registrando…";
    const gravado = await registrarPedido(pedido);
    if (gravado && pedido.email && window.HPR_EMAIL?.configurado(site.email)) {
      window.HPR_EMAIL.enviarEmailPedido({ ...site.email, whatsapp: site.whatsapp }, pedido, "novo").catch(() => {});
    }

    const link = `https://wa.me/${numeroZap()}?text=${encodeURIComponent(texto)}`;
    ok.innerHTML = `<strong>Pedido ${codigo} ${gravado ? "registrado" : "pronto"}!</strong> ` +
      (gravado && pedido.email ? `Você vai receber o andamento em ${esc(pedido.email)}. ` : "") +
      `Estamos abrindo o WhatsApp com a mensagem pronta, é só tocar em enviar. Se não abriu:<a class="botao botao-principal pedido-zap" href="${link}" target="_blank" rel="noopener">Abrir o WhatsApp com o pedido</a>`;
    ok.hidden = false;
    botao.textContent = "Enviar pedido";
    botao.disabled = false;
    ok.scrollIntoView({ block: "nearest", behavior: "smooth" });

    // Abre o WhatsApp com a mensagem pronta
    if (aba && !aba.closed) {
      aba.location.href = link;
    } else if (celular) {
      window.location.href = link;
    } else {
      window.open(link, "_blank", "noopener");
    }
    if (gravado) {
      form.reset();
      refs.forEach((r) => URL.revokeObjectURL(r.url));
      refs = [];
      desenharRefs();
      if (cliente) { form.email.value = cliente.email || ""; form.nome.value = cliente.nome || ""; }
    }
  });

  // ---------- Destaques do Instagram ----------
  // Posts automáticos (data/instagram.json, atualizado 1x por dia). Sem eles, usa os links colados na oficina.
  async function desenharInstagram() {
    try {
      const r = await fetch("data/instagram.json" + semCache);
      if (r.ok) {
        const dados = await r.json();
        // Enquanto não houver um arquivo de logo próprio, usa a foto do perfil do Instagram
        if (dados.perfil?.foto && !document.querySelector(".marca-carretel[data-logo-fixo]")) {
          document.querySelectorAll(".marca-carretel").forEach((img) => { img.src = dados.perfil.foto; img.classList.add("marca-foto"); });
        }
        const posts = (dados.posts || []).filter((p) => p.imagem && /^https:\/\/(www\.)?instagram\.com\//.test(p.link)).slice(0, 6);
        if (posts.length) {
          document.getElementById("grade-insta").className = "grade-insta-auto";
          document.getElementById("grade-insta").innerHTML = posts
            .map((p) => `<a class="insta-post" href="${esc(p.link)}" target="_blank" rel="noopener">
              <img src="${esc(p.imagem)}" alt="${esc(p.legenda ? p.legenda.slice(0, 120) : "Post do Instagram da HPR Print 3D")}" loading="lazy">
              ${p.tipo === "VIDEO" ? `<span class="insta-tipo">Vídeo</span>` : ""}
              ${p.legenda ? `<span class="insta-legenda">${esc(p.legenda)}</span>` : ""}
            </a>`)
            .join("");
          document.getElementById("instagram").hidden = false;
          return;
        }
      }
    } catch {}
    desenharDestaquesManuais();
  }

  function desenharDestaquesManuais() {
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
  const lerSupabase = (caminho) =>
    fetch(`${sb.url}/rest/v1/${caminho}`, { headers: { apikey: sb.chave } }).then((r) => {
      if (!r.ok) throw new Error("supabase " + r.status);
      return r.json();
    });
  const reserva = (arquivo, padrao) => fetch(arquivo + semCache).then((r) => r.json()).catch(() => padrao);
  Promise.all([
    lerSupabase("ajustes?select=valor&chave=eq.site").then((l) => l[0]?.valor || reserva("data/site.json", {})).catch(() => reserva("data/site.json", {})),
    // Tenta com cores e características; se o banco ainda não tiver essas colunas, busca sem elas
    lerSupabase("pecas?select=id,nome,categoria,descricao,foto,preco,ativo,ordem,cores,caracteristicas&ativo=eq.true&order=ordem.asc,nome.asc")
      .catch(() => lerSupabase("pecas?select=id,nome,categoria,descricao,foto,preco,ativo,ordem&ativo=eq.true&order=ordem.asc,nome.asc"))
      .catch(() => reserva("data/catalogo.json", [])),
  ]).then(([s, c]) => {
    site = s || {};
    pecas = (Array.isArray(c) ? c : []).filter((p) => p.ativo !== false).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    document.querySelectorAll('[data-link="whatsapp"]').forEach((a) => (a.href = linkPedido()));
    document.querySelectorAll('[data-link="instagram"]').forEach((a) => (a.href = site.instagram || a.href));
    desenharFiltros();
    desenharGrade();
    desenharInstagram();
    const m = location.hash.match(/^#peca-(.+)$/);
    if (m) abrirDetalhe(decodeURIComponent(m[1]), false);
  });
})();
