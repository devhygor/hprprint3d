// Contador de visitas da loja. Sem cookies e sem dados pessoais:
// manda só um id aleatório do navegador, a página, o domínio de origem e o tipo de aparelho.
// Respeita "Não rastrear" (DNT/GPC) e não conta a equipe (marcada pela oficina neste navegador).
(function () {
  try {
    const sb = window.HPR_SUPABASE || {};
    if (!sb.url || !sb.chave) return;
    const nav = navigator;
    if (nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.msDoNotTrack === "1" || nav.globalPrivacyControl) return;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname) || location.protocol === "file:") return;
    if (nav.webdriver) return; // robôs de teste
    if (/bot|crawl|spider|slurp|preview|headless/i.test(nav.userAgent)) return;

    // Equipe: a oficina grava esta marca quando alguém da equipe entra
    try { if (localStorage.getItem("hpr_equipe") === "1") return; } catch {}

    // Id aleatório do navegador (não identifica a pessoa)
    let vid = null;
    try { vid = localStorage.getItem("hpr_vid"); } catch {}
    if (!vid || vid.length < 8) {
      const b = new Uint8Array(12);
      (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256)));
      vid = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      try { localStorage.setItem("hpr_vid", vid); } catch {}
    }

    let path = location.pathname.replace(/index\.html$/, "").replace(/\/{2,}/g, "/") || "/";
    if (path.charAt(0) !== "/") path = "/" + path;
    path = path.slice(0, 200);

    // Uma contagem por página a cada sessão (recarregar não infla)
    const chave = "hpr_v:" + path;
    try { if (sessionStorage.getItem(chave)) return; sessionStorage.setItem(chave, "1"); } catch {}

    let origem = null;
    try {
      const h = new URL(document.referrer).hostname.replace(/^www\./, "").toLowerCase();
      if (h && h !== location.hostname.replace(/^www\./, "").toLowerCase()) origem = h.slice(0, 100);
    } catch {}

    const ua = nav.userAgent || "";
    const aparelho = /ipad|tablet|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) || (/macintosh/i.test(ua) && nav.maxTouchPoints > 1)
      ? "tablet" : /mobi|iphone|ipod|android|phone/i.test(ua) ? "mobile" : "desktop";

    fetch(sb.url + "/rest/v1/page_views", {
      method: "POST",
      keepalive: true,
      headers: { apikey: sb.chave, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ visitor_id: vid, path, referrer_host: origem, device: aparelho }),
    }).catch(() => {});
  } catch {}
})();
