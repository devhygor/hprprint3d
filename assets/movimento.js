/* Movimento compartilhado (vitrine, conta e oficina).
 * Regras: só transform e opacity; cada coisa aparece uma vez (não repete ao rolar de volta);
 * nada fica escondido sem JavaScript ou com "reduzir movimento" ligado (a classe .mov só entra quando dá para animar). */
(function () {
  const raiz = document.documentElement;
  const reduzir = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ponteiroFino = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const podeAnimar = !reduzir && "IntersectionObserver" in window;
  if (podeAnimar) raiz.classList.add("mov");

  // Elementos que chegam depois, desenhados pelo JS das páginas (cartões de peça, posts, pedidos do cliente)
  const AUTO = ".peca, .insta-post, .pedido-conta";

  // ---------- Revelar ao entrar na tela, em cascata ----------
  let io;
  if (podeAnimar) {
    io = new IntersectionObserver((entradas) => {
      const novas = entradas.filter((e) => e.isIntersecting).map((e) => e.target);
      // Ordena pela posição na tela: a cascata segue a leitura (cima → baixo, esquerda → direita)
      novas.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return Math.abs(ra.top - rb.top) > 8 ? ra.top - rb.top : ra.left - rb.left;
      });
      novas.forEach((el, k) => {
        // Passos que encurtam (60, 55, 50…): o grupo chega junto sem fila de espera
        const atraso = Math.round(Array.from({ length: Math.min(k, 8) }, (_, i) => Math.max(30, 60 - i * 5)).reduce((s, v) => s + v, 0));
        el.style.setProperty("--atraso", atraso + "ms");
        el.classList.add("visto");
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.12 });
  }
  function observar(no) {
    if (!io || !(no instanceof Element)) return;
    const lista = [];
    if (no.matches("[data-revelar], " + AUTO)) lista.push(no);
    no.querySelectorAll("[data-revelar], " + AUTO).forEach((el) => lista.push(el));
    lista.forEach((el) => {
      if (el.classList.contains("visto")) return;
      if (!el.hasAttribute("data-revelar")) el.setAttribute("data-revelar", "");
      io.observe(el);
    });
  }

  // ---------- Topo: ganha vidro e linha depois que a página rola ----------
  let rolou = null;
  function conferirRolagem() {
    const agora = scrollY > 8;
    if (agora !== rolou) { rolou = agora; raiz.toggleAttribute("data-rolou", agora); }
  }

  // ---------- Abertura da vitrine: a peça "imprimindo" com porcentagem e inclinação no mouse ----------
  function abertura() {
    const status = document.querySelector(".heroi-status b");
    const impressora = document.querySelector(".impressora");
    const concluir = () => {
      if (!status) return;
      status.previousElementSibling.textContent = "Impressão concluída"; status.hidden = true; status.parentElement.classList.add("feito");
    };
    if (impressora) {
      if (podeAnimar) imprimirLogo(impressora, status, concluir);
      else { impressora.classList.add("pronta"); concluir(); }
    }

    const moldura = document.querySelector(".heroi-moldura");
    if (!moldura || !podeAnimar || !ponteiroFino) return;
    const palco = moldura.closest(".heroi-foto");
    // Mola simples: o alvo muda com o mouse, a moldura persegue o alvo com atrito (decorativo, por isso pode ter inércia)
    let alvoX = 0, alvoY = 0, x = 0, y = 0, vx = 0, vy = 0, rodando = false;
    const RIGIDEZ = 0.08, ATRITO = 0.72, MAX = 7;
    function quadro() {
      vx = (vx + (alvoX - x) * RIGIDEZ) * ATRITO;
      vy = (vy + (alvoY - y) * RIGIDEZ) * ATRITO;
      x += vx; y += vy;
      moldura.style.transform = `perspective(1100px) rotateY(${(x * MAX).toFixed(3)}deg) rotateX(${(-y * MAX).toFixed(3)}deg)`;
      moldura.style.setProperty("--luz-x", (50 + x * 40).toFixed(1) + "%");
      moldura.style.setProperty("--luz-y", (40 + y * 40).toFixed(1) + "%");
      if (Math.abs(alvoX - x) + Math.abs(alvoY - y) + Math.abs(vx) + Math.abs(vy) > 0.0008) requestAnimationFrame(quadro);
      else rodando = false;
    }
    function mexer() { if (!rodando) { rodando = true; requestAnimationFrame(quadro); } }
    palco.addEventListener("pointermove", (e) => {
      const r = palco.getBoundingClientRect();
      alvoX = ((e.clientX - r.left) / r.width - 0.5) * 2;
      alvoY = ((e.clientY - r.top) / r.height - 0.5) * 2;
      mexer();
    });
    palco.addEventListener("pointerleave", () => { alvoX = 0; alvoY = 0; mexer(); });
  }


  // ---------- A impressora da abertura: imprime a logo camada por camada ----------
  // Cada camada tem a largura do círculo naquela altura e leva tempo proporcional a ela (camada larga demora mais),
  // o cabeçote vai e volta (zigue-zague, como o fatiador faz) e no fim sobe e estaciona no canto.
  function imprimirLogo(imp, status, concluir) {
    const peca = imp.querySelector(".logo-peca"), feito = imp.querySelector(".logo-feito"), camada = imp.querySelector(".logo-camada");
    const fios = imp.querySelector(".logo-fios"), cab = imp.querySelector(".cabecote"), trilho = imp.querySelector(".trilho");
    const N = 26, R = 0.492, TOTAL = 3200;
    const camadas = [];
    let soma = 0;
    for (let i = 0; i < N; i++) {
      const meio = 1 - (i + 0.5) / N, dy = meio - 0.5;
      const meia = Math.max(0.05, Math.sqrt(Math.max(0, R * R - dy * dy)));
      const c = { x0: 0.5 - meia, x1: 0.5 + meia, topo: 1 - (i + 1) / N, base: 1 - i / N, peso: 2 * meia + 0.15, inicio: soma };
      soma += c.peso;
      camadas.push(c);
    }
    const pct = (v) => (v * 100).toFixed(2) + "%";
    function posicionar(x, y) {
      const W = peca.clientWidth, H = peca.clientHeight;
      cab.style.transform = `translate(${(x * W).toFixed(1)}px, ${(y * H).toFixed(1)}px)`;
      // O trilho acompanha a altura do corpo do cabeçote
      trilho.style.transform = `translateY(${(peca.offsetTop + y * H - cab.offsetHeight * 55 / 92 - trilho.offsetTop - 3).toFixed(1)}px)`;
    }
    const mover = (ms) => { const v = ms ? `transform ${ms}ms cubic-bezier(0.23, 1, 0.32, 1)` : "none"; cab.style.transition = v; trilho.style.transition = v; };
    let estacionado = false;
    const estacionar = () => posicionar(0.92, 0);
    addEventListener("resize", () => { if (estacionado) { mover(0); estacionar(); } }, { passive: true });

    let comeco;
    function quadro(t) {
      if (comeco === undefined) comeco = t;
      const p = Math.min(1, (t - comeco) / TOTAL);
      const alvo = p * soma;
      let i = camadas.findIndex((c) => alvo < c.inicio + c.peso);
      if (i < 0) i = N - 1;
      const c = camadas[i], f = Math.min(1, (alvo - c.inicio) / c.peso);
      const ida = i % 2 === 0;
      const x = ida ? c.x0 + (c.x1 - c.x0) * f : c.x1 - (c.x1 - c.x0) * f;
      const prontas = `inset(${pct(c.base)} 0 0 0)`;
      feito.style.clipPath = prontas; fios.style.clipPath = prontas;
      camada.style.clipPath = ida
        ? `inset(${pct(c.topo)} ${pct(1 - x)} ${pct(1 - c.base)} ${pct(c.x0)})`
        : `inset(${pct(c.topo)} ${pct(1 - c.x1)} ${pct(1 - c.base)} ${pct(x)})`;
      posicionar(x, c.topo);
      if (status) status.textContent = Math.floor(p * 100) + "%";
      if (p < 1) { requestAnimationFrame(quadro); return; }
      // Fim: a peça fica inteira, o bico esfria e sobe para o canto
      imp.classList.remove("imprimindo"); imp.classList.add("pronta");
      feito.style.clipPath = ""; fios.style.clipPath = ""; camada.style.clipPath = "";
      mover(800); estacionar(); estacionado = true;
      concluir();
    }

    const comecar = () => {
      // O cabeçote sai do canto até o começo da primeira camada, e só então começa a imprimir
      imp.classList.add("imprimindo");
      // Sem JS o CSS estaciona o cabeçote com left; daqui em diante quem posiciona é o transform
      cab.style.left = "0"; mover(0); estacionar();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        mover(550); posicionar(camadas[0].x0, camadas[0].topo);
        setTimeout(() => { mover(0); requestAnimationFrame(quadro); }, 600);
      }));
    };
    // Espera a logo carregar e a mesa aparecer na tela (no celular ela fica abaixo da dobra)
    const carregou = (feito.decode ? feito.decode() : Promise.resolve()).catch(() => {});
    const apareceu = new Promise((ok) => {
      const vigia = new IntersectionObserver((e) => { if (e[0].isIntersecting) { vigia.disconnect(); ok(); } }, { threshold: 0.5 });
      vigia.observe(imp);
    });
    Promise.all([carregou, apareceu]).then(() => setTimeout(comecar, 250));
  }

  // ---------- Oficina: marcador que desliza até a aba atual ----------
  function marcadorDeAbas() {
    const nav = document.getElementById("abas");
    if (!nav) return;
    const marca = document.createElement("span");
    marca.className = "aba-marca";
    marca.setAttribute("aria-hidden", "true");
    nav.prepend(marca);
    let primeira = true;
    function posicionar() {
      const atual = nav.querySelector('.aba[aria-current="page"]');
      if (!atual || nav.hidden) { marca.style.opacity = "0"; return; }
      // Na primeira vez não desliza (nada de animação ao abrir a oficina)
      if (primeira) marca.style.transition = "none";
      marca.style.width = atual.offsetWidth + "px";
      marca.style.height = atual.offsetHeight + "px";
      marca.style.transform = `translate(${atual.offsetLeft}px, ${atual.offsetTop}px)`;
      marca.style.opacity = "1";
      if (primeira) { marca.offsetWidth; marca.style.transition = ""; primeira = false; }
    }
    new MutationObserver(posicionar).observe(nav, { subtree: true, attributes: true, attributeFilter: ["aria-current", "hidden"] });
    addEventListener("resize", posicionar, { passive: true });
    document.fonts?.ready.then(posicionar);
    posicionar();
  }

  // ---------- Pulo curto (contador do carrinho) ----------
  function pulsar(el) {
    if (!el || !podeAnimar) return;
    el.animate([{ transform: "scale(1)" }, { transform: "scale(1.28)" }, { transform: "scale(1)" }],
      { duration: 360, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }
  window.hprMov = { pulsar, observar };

  function iniciar() {
    conferirRolagem();
    addEventListener("scroll", conferirRolagem, { passive: true });
    observar(document.body);
    if (io) {
      new MutationObserver((mudancas) => {
        for (const m of mudancas) m.addedNodes.forEach(observar);
      }).observe(document.body, { childList: true, subtree: true });
    }
    abertura();
    marcadorDeAbas();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
