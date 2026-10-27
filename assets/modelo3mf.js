// Leitor de arquivos .3mf (Bambu Studio, MakerWorld, Prusa, Cura...), tudo no navegador (precisa do JSZip).
// Devolve as medidas da peça (caixa envolvente de cada objeto da mesa), e, quando o arquivo foi fatiado
// pelo Bambu Studio, o tempo, as gramas e os filamentos de cada mesa.
// Medidas em centímetros, como no cadastro. Os objetos são vistos como estão na mesa (largura = X, profundidade = Y, altura = Z).
(function (raiz) {
  const UNIDADE_CM = { micron: 0.0001, millimeter: 0.1, centimeter: 1, inch: 2.54, foot: 30.48, meter: 100 };

  // Matriz 3MF: 12 números (linhas de 3, a última é a translação), vetor em linha: v' = v · M
  const IDENTIDADE = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const lerMatriz = (t) => {
    const m = String(t || "").trim().split(/\s+/).map(Number);
    return m.length === 12 && m.every(Number.isFinite) ? m : IDENTIDADE;
  };
  // aplica A e depois B
  const compor = (A, B) => {
    const r = new Array(12);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    for (let j = 0; j < 3; j++) r[9 + j] = A[9] * B[j] + A[10] * B[3 + j] + A[11] * B[6 + j] + B[9 + j];
    return r;
  };
  const attr = (tag, nome) => (tag.match(new RegExp(`\\b${nome}="([^"]*)"`)) || [])[1];

  // Lê os objetos de um arquivo .model: { id: { vertices: Float64Array|null, componentes: [{ id, arquivo, m }], tipo } }
  function lerModelo(xml, arquivo) {
    const unidade = UNIDADE_CM[(xml.match(/<model\b[^>]*\bunit="([^"]+)"/) || [])[1]] ?? UNIDADE_CM.millimeter;
    const objetos = {};
    for (const bloco of xml.match(/<object\b[\s\S]*?<\/object>/g) || []) {
      const abre = bloco.match(/<object\b[^>]*>/)[0];
      const id = attr(abre, "id");
      const v = [];
      const re = /<vertex\b[^>]*?\bx="([^"]+)"[^>]*?\by="([^"]+)"[^>]*?\bz="([^"]+)"/g;
      let m;
      while ((m = re.exec(bloco))) v.push(+m[1], +m[2], +m[3]);
      const componentes = [];
      for (const c of bloco.match(/<component\b[^>]*>/g) || [])
        componentes.push({ id: attr(c, "objectid"), arquivo: attr(c, "p:path") || attr(c, "path") || arquivo, m: lerMatriz(attr(c, "transform")) });
      objetos[id] = { vertices: v.length ? Float64Array.from(v) : null, componentes, tipo: attr(abre, "type") || "model", nome: attr(abre, "name") || "" };
    }
    const itens = (xml.match(/<build\b[\s\S]*?<\/build>/) || [""])[0].match(/<item\b[^>]*>/g) || [];
    return {
      objetos, unidade,
      itens: itens.map((i) => ({ id: attr(i, "objectid"), m: lerMatriz(attr(i, "transform")), imprimivel: attr(i, "printable") !== "0" })),
    };
  }

  function caixa(modelos, arquivo, id, M, caixaAtual, fundo = 0) {
    const obj = modelos[arquivo]?.objetos[id];
    if (!obj || fundo > 8) return;
    if (obj.vertices) {
      const v = obj.vertices;
      for (let i = 0; i < v.length; i += 3) {
        const x = v[i] * M[0] + v[i + 1] * M[3] + v[i + 2] * M[6] + M[9];
        const y = v[i] * M[1] + v[i + 1] * M[4] + v[i + 2] * M[7] + M[10];
        const z = v[i] * M[2] + v[i + 1] * M[5] + v[i + 2] * M[8] + M[11];
        if (x < caixaAtual.min[0]) caixaAtual.min[0] = x; if (x > caixaAtual.max[0]) caixaAtual.max[0] = x;
        if (y < caixaAtual.min[1]) caixaAtual.min[1] = y; if (y > caixaAtual.max[1]) caixaAtual.max[1] = y;
        if (z < caixaAtual.min[2]) caixaAtual.min[2] = z; if (z > caixaAtual.max[2]) caixaAtual.max[2] = z;
      }
    }
    for (const c of obj.componentes) caixa(modelos, c.arquivo, c.id, compor(c.m, M), caixaAtual, fundo + 1);
  }

  const arred = (n, casas = 1) => Math.round(n * 10 ** casas) / 10 ** casas;

  // Menor caixa (aproximada) onde cabem todos os objetos juntos: lado a lado em uma fila (nos dois sentidos,
  // com cada peça deitada pelo lado mais curto ou não) ou empilhados. Escolhe a de menor volume.
  function caixaConjunto(objs) {
    if (objs.length === 1) return { largura: objs[0].largura, profundidade: objs[0].profundidade, altura: objs[0].altura };
    const soma = (f) => objs.reduce((s, o) => s + f(o), 0);
    const maxi = (f) => Math.max(...objs.map(f));
    const curto = (o) => Math.min(o.largura, o.profundidade), longo = (o) => Math.max(o.largura, o.profundidade);
    const H = maxi((o) => o.altura);
    const opcoes = [
      { largura: soma((o) => o.largura), profundidade: maxi((o) => o.profundidade), altura: H },
      { largura: maxi((o) => o.largura), profundidade: soma((o) => o.profundidade), altura: H },
      { largura: soma(curto), profundidade: maxi(longo), altura: H },
      { largura: maxi((o) => o.largura), profundidade: maxi((o) => o.profundidade), altura: soma((o) => o.altura) },
    ];
    const vol = (c) => c.largura * c.profundidade * c.altura;
    return opcoes.reduce((a, b) => (vol(b) < vol(a) ? b : a));
  }

  function lerFatiamento(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return null;
    const meta = (el, k) => el.querySelector(`metadata[key="${k}"]`)?.getAttribute("value");
    const mesas = [...doc.querySelectorAll("plate")].map((p) => ({
      segundos: Number(meta(p, "prediction")) || 0,
      gramas: Number(meta(p, "weight")) || 0,
      filamentos: [...p.querySelectorAll("filament")].map((f) => ({
        tipo: f.getAttribute("type") || "", cor: f.getAttribute("color") || "", gramas: Number(f.getAttribute("used_g")) || 0,
      })),
    }));
    return mesas.length ? mesas : null;
  }

  async function ler(arquivo) {
    const zip = await raiz.JSZip.loadAsync(await arquivo.arrayBuffer());
    const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const principal = nomes.find((n) => /^3D\/3dmodel\.model$/i.test(n));
    if (!principal) throw new Error("Esse arquivo não parece um .3mf (não achei o modelo 3D).");

    // Todos os .model (o do Bambu guarda os objetos em 3D/Objects/*.model)
    const modelos = {};
    for (const n of nomes.filter((x) => /\.model$/i.test(x))) modelos["/" + n] = lerModelo(await zip.files[n].async("string"), "/" + n);
    const raizModelo = modelos["/" + principal];
    const unidade = raizModelo.unidade;

    const objetos = [];
    for (const item of raizModelo.itens) {
      if (!item.imprimivel) continue;
      const o = raizModelo.objetos[item.id];
      if (!o || /support/i.test(o.tipo)) continue;
      const c = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      caixa(modelos, "/" + principal, item.id, item.m, c);
      if (!Number.isFinite(c.min[0])) continue;
      objetos.push({ nome: o.nome, largura: (c.max[0] - c.min[0]) * unidade, profundidade: (c.max[1] - c.min[1]) * unidade, altura: (c.max[2] - c.min[2]) * unidade });
    }
    // Arquivo fatiado exportado (.gcode.3mf) vem sem a malha 3D: usa o contorno de cada objeto na mesa
    // (plate_N.json, em mm) e a altura máxima da mesa (cabeçalho do gcode)
    if (!objetos.length) {
      for (const jn of nomes.filter((n) => /(^|\/)plate_(\d+)\.json$/i.test(n))) {
        const num = jn.match(/plate_(\d+)\.json$/i)[1];
        let info;
        try { info = JSON.parse(await zip.files[jn].async("string")); } catch { continue; }
        const gn = nomes.find((n) => new RegExp(`plate_${num}\\.gcode$`, "i").test(n));
        const cab = gn ? (await zip.files[gn].async("string")).slice(0, 400000) : "";
        const alturaMm = Number((cab.match(/;\s*max_z_height:\s*([\d.]+)/) || [])[1]) || 0;
        for (const o of info.bbox_objects || []) {
          if (!Array.isArray(o.bbox) || o.bbox.length < 4) continue;
          objetos.push({ nome: String(o.name || "").replace(/\.(stl|obj|3mf|step)(_\w)?$/i, ""), largura: (o.bbox[2] - o.bbox[0]) / 10, profundidade: (o.bbox[3] - o.bbox[1]) / 10, altura: alturaMm / 10 });
        }
      }
    }
    if (!objetos.length) throw new Error("Não achei nenhum objeto imprimível dentro do arquivo.");

    // Peça = o maior objeto (pela maior área na mesa)
    const maior = objetos.reduce((a, b) => (b.largura * b.profundidade > a.largura * a.profundidade ? b : a));
    const iguais = objetos.every((o) =>
      ["largura", "profundidade", "altura"].every((k) => Math.abs(o[k] - maior[k]) <= 0.02 * Math.max(maior[k], 0.1)));

    const infoNome = nomes.find((n) => /(^|\/)slice_info\.config$/i.test(n));
    const mesas = infoNome ? lerFatiamento(await zip.files[infoNome].async("string")) : null;
    const gramas = mesas ? mesas.reduce((s, m) => s + m.gramas, 0) : 0;
    const segundos = mesas ? mesas.reduce((s, m) => s + m.segundos, 0) : 0;
    const filamentos = [];
    for (const m of mesas || []) for (const f of m.filamentos) {
      const x = filamentos.find((y) => y.tipo === f.tipo && y.cor.toLowerCase() === f.cor.toLowerCase());
      if (x) x.gramas += f.gramas; else filamentos.push({ ...f });
    }

    return {
      largura: arred(maior.largura), profundidade: arred(maior.profundidade), altura: arred(maior.altura),
      conjunto: (() => { const c = caixaConjunto(iguais ? [maior] : objetos); return { largura: arred(c.largura), profundidade: arred(c.profundidade), altura: arred(c.altura) }; })(),
      pecas: objetos.map((o, i) => ({ nome: (o.nome || `Peça ${i + 1}`).slice(0, 60), largura: arred(o.largura), profundidade: arred(o.profundidade), altura: arred(o.altura), qtd: 1 })),
      objetos: objetos.length, iguais, mesas: mesas ? mesas.length : 0,
      fatiado: !!mesas && (gramas > 0 || segundos > 0),
      gramas: arred(gramas), segundos, filamentos,
      // cada peça pesa o total dividido pelas cópias; com partes diferentes, a peça é o conjunto todo
      pesaPorPeca: gramas > 0 ? arred(iguais ? gramas / objetos.length : gramas) : 0,
    };
  }

  raiz.HPR_3MF = { ler, lerModelo, compor, caixaConjunto };
})(typeof window !== "undefined" ? window : globalThis);
