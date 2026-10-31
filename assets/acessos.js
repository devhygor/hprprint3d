// Oficina > Acessos: visitas e visitantes únicos do site (dados da tabela page_views, via metricas_acessos).
(function () {
  const O = window.Oficina;
  const { $, esc, db, erroLegivel } = O;
  let dados = null;
  let limpou = false;

  const num = (v) => Number(v || 0).toLocaleString("pt-BR");
  const NOME_PAGINA = { "/": "Vitrine (início)", "/conta.html": "Área do cliente" };
  const NOME_DISP = { desktop: "Computador", mobile: "Celular", tablet: "Tablet" };
  const nomePagina = (p) => NOME_PAGINA[p] || p;
  const diaCurto = (d) => new Date(d + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  // Gráfico de barras (visitas) com linha dos únicos, em SVG puro
  function grafico(serie) {
    const W = 760, H = 220, mE = 36, mD = 8, mT = 12, mB = 26;
    const max = Math.max(1, ...serie.map((s) => s.visitas));
    const topo = max <= 4 ? max : Math.ceil(max / 4) * 4;
    const iw = W - mE - mD, ih = H - mT - mB;
    const bw = iw / serie.length;
    const y = (v) => mT + ih - (v / topo) * ih;
    const grade = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const v = Math.round(topo * f), yy = y(v);
      return `<line x1="${mE}" x2="${W - mD}" y1="${yy}" y2="${yy}" stroke="var(--linha)" stroke-width="1"/><text x="${mE - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--texto-3)">${v}</text>`;
    }).join("");
    const barras = serie.map((s, i) => {
      const x = mE + i * bw + bw * 0.15, h = (s.visitas / topo) * ih;
      return `<rect x="${x}" y="${mT + ih - h}" width="${bw * 0.7}" height="${h}" rx="2" fill="var(--neon)"><title>${diaCurto(s.dia)}: ${s.visitas} visita(s), ${s.unicos} visitante(s) único(s)</title></rect>`;
    }).join("");
    const linha = serie.map((s, i) => `${mE + i * bw + bw / 2},${y(s.unicos)}`).join(" ");
    const rotulos = serie.map((s, i) => (i % 5 === 0 || i === serie.length - 1)
      ? `<text x="${mE + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--texto-3)">${diaCurto(s.dia)}</text>` : "").join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitas por dia nos últimos 30 dias" style="width:100%;height:auto;display:block">
      ${grade}${barras}<polyline points="${linha}" fill="none" stroke="var(--menta)" stroke-width="2" stroke-linejoin="round"/>${rotulos}</svg>
      <p class="dica"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--neon)"></i> Visitas &nbsp; <i style="display:inline-block;width:10px;height:3px;background:var(--menta)"></i> Visitantes únicos</p>`;
  }

  function lista(titulo, itens, rotulo) {
    const total = itens.reduce((a, i) => a + i.visitas, 0) || 1;
    const linhas = itens.length ? itens.map((i) => `
      <tr><td>${esc(rotulo(i))}</td><td class="num">${num(i.visitas)}</td><td class="num">${num(i.unicos)}</td>
      <td style="width:28%"><div style="background:var(--noite-3);border-radius:4px;height:8px"><div style="background:var(--neon);height:8px;border-radius:4px;width:${Math.round((i.visitas / total) * 100)}%"></div></div></td></tr>`).join("")
      : `<tr><td colspan="4" class="dica">Sem dados ainda.</td></tr>`;
    return `<section class="painel"><h2 class="fin-subtitulo" style="margin-top:0">${titulo}</h2>
      <div style="overflow-x:auto"><table class="tabela-pecas"><thead><tr><th></th><th class="num">Visitas</th><th class="num">Únicos</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div></section>`;
  }

  function desenhar() {
    const r = dados.resumo;
    const tile = (rot, v) => `<div class="fin-tile"><span class="fin-rotulo">${rot}</span><strong>${num(v.visitas)} visitas</strong><span class="fin-delta">${num(v.unicos)} visitante${v.unicos === 1 ? "" : "s"} único${v.unicos === 1 ? "" : "s"}</span></div>`;
    $("#ac-conteudo").innerHTML = `
      <div class="ac-tiles">${tile("Hoje", r.hoje)}${tile("Últimos 7 dias", r.d7)}${tile("Últimos 30 dias", r.d30)}</div>
      <section class="painel" style="margin-bottom:18px"><h2 class="fin-subtitulo" style="margin-top:0">Por dia (30 dias)</h2>${grafico(dados.serie)}</section>
      <div class="duas" style="align-items:start">
        ${lista("Páginas mais vistas", dados.paginas, (i) => nomePagina(i.path))}
        ${lista("De onde vieram", dados.origens, (i) => i.origem || "Direto / sem origem")}
      </div>
      <div style="margin-top:18px">${lista("Aparelho", dados.dispositivos, (i) => NOME_DISP[i.device] || i.device)}</div>
      <p class="dica" style="margin-top:12px">Os dias seguem o horário de Brasília. Cada página conta uma vez por sessão do visitante; quem ativa "Não rastrear" no navegador não aparece. Dados com mais de 180 dias são apagados.</p>`;
  }

  async function carregar() {
    $("#ac-conteudo").innerHTML = `<p class="dica">Carregando os acessos…</p>`;
    try {
      const { data, error } = await db.rpc("metricas_acessos", { p_dias: 30 });
      if (error) throw error;
      dados = data;
      desenhar();
      if (!limpou) { limpou = true; db.rpc("limpar_page_views").then(() => {}, () => {}); } // reserva caso o pg_cron não esteja ativo
    } catch (e) {
      const falta = /metricas_acessos|page_views|Could not find the function/i.test(erroLegivel(e) + (e?.message || ""));
      $("#ac-conteudo").innerHTML = `<div class="vazio"><strong>Não consegui abrir os acessos</strong>${falta
        ? "a função ainda não existe no banco. Rode o supabase/metricas_acessos.sql no SQL Editor do Supabase"
        : esc(erroLegivel(e))}.</div>`;
    }
  }

  O.ganchos.acessos = carregar;
  O.ganchos.sair = ((antigo) => () => { dados = null; limpou = false; antigo?.(); })(O.ganchos.sair);
  $("#ac-atualizar").addEventListener("click", carregar);
})();
