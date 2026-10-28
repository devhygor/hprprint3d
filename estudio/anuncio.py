"""Textos e medidas desenhados em cima da foto de vitrine, no estilo dos anúncios da loja:
título em letra de mão, preço em faixa, vantagens e linhas de medida (altura, largura, profundidade) com setas.

  desenhar_medidas(img, bbox, medidas, estilo)   só as setas com as medidas da peça
  desenhar_anuncio(img, bbox, dados, textos)     título + preço + vantagens + chamada (e as medidas, se houver)

Fontes (Pacifico e Poppins, licença OFL, livres para uso comercial) ficam em estudio/fontes.
Todas as medidas chegam em centímetros; o texto vem do que foi cadastrado para a PRÓPRIA peça.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageStat

FONTES = Path(__file__).parent / "fontes"
MARROM = (75, 46, 31)
ROSA = (155, 79, 75)
ROSA_CLARO = (255, 232, 224)


def fonte(nome: str, tam: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTES / nome), tam)


def cm(v: float) -> str:
    s = f"{float(v):.1f}".replace(".", ",")
    return (s[:-2] if s.endswith(",0") else s) + " cm"


def reais(v: float) -> str:
    return "R$ " + f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _largura(d: ImageDraw.ImageDraw, texto: str, f) -> int:
    return int(d.textlength(texto, font=f))


def quebrar(d, texto: str, f, maxw: int, max_linhas: int):
    """Quebra o texto em linhas que cabem em maxw. Devolve (linhas, coube)."""
    palavras, linhas, atual = texto.split(), [], ""
    for p in palavras:
        teste = (atual + " " + p).strip()
        if _largura(d, teste, f) <= maxw or not atual:
            atual = teste
        else:
            linhas.append(atual)
            atual = p
    if atual:
        linhas.append(atual)
    coube = len(linhas) <= max_linhas and all(_largura(d, l, f) <= maxw for l in linhas)
    return linhas, coube


def _seta(d, p1, p2, cor, halo, espessura):
    """Linha com pontas de seta nas duas extremidades (halo claro por baixo para ler em qualquer fundo)."""
    (x1, y1), (x2, y2) = p1, p2
    ang = math.atan2(y2 - y1, x2 - x1)
    ponta = espessura * 4.2

    def triangulo(x, y, a):
        return [(x, y), (x - ponta * math.cos(a - 0.4), y - ponta * math.sin(a - 0.4)),
                (x - ponta * math.cos(a + 0.4), y - ponta * math.sin(a + 0.4))]

    for c, e in ((halo, espessura + 4), (cor, espessura)):
        d.line([p1, p2], fill=c, width=int(e))
    for (x, y, a) in ((x2, y2, ang), (x1, y1, ang + math.pi)):
        d.polygon(triangulo(x, y, a), fill=halo)
        d.polygon(triangulo(x - 0.0, y - 0.0, a), fill=cor)


def _pilula(camada, centro, valor: str, legenda: str, cor):
    d = ImageDraw.Draw(camada)
    f1, f2 = fonte("Poppins-SemiBold.ttf", 34), fonte("Poppins-Regular.ttf", 21)
    w = max(_largura(d, valor, f1), _largura(d, legenda, f2)) + 38
    h = 34 + 21 + 26
    x, y = centro
    caixa = [x - w // 2, y - h // 2, x + w // 2, y + h // 2]
    d.rounded_rectangle(caixa, radius=20, fill=(255, 255, 255, 232), outline=cor + (255,), width=3)
    d.text((x, caixa[1] + 12), valor, font=f1, fill=MARROM + (255,), anchor="mt")  # a caixinha é clara: texto sempre escuro
    d.text((x, caixa[1] + 12 + 40), legenda, font=f2, fill=(120, 80, 70, 255), anchor="mt")


def desenhar_medidas(img: Image.Image, bbox, medidas: dict, estilo: str = "claro") -> Image.Image:
    """Setas de altura (esquerda), largura (embaixo) e profundidade (diagonal, à direita) com os valores em cm."""
    W, H = img.size
    x0, y0, x1, y1 = bbox
    # Setas escuras em fundo claro, brancas em fundo escuro (vale pelo brilho real da imagem, não só pelo tipo do cenário)
    estilo = "claro" if _luz(img, (max(0, x0 - 120), max(0, y0 - 40), min(W, x1 + 200), min(H, y1 + 120))) >= 120 else "neon"
    cor = MARROM if estilo == "claro" else (255, 255, 255)
    halo = (255, 255, 255, 235) if estilo == "claro" else (20, 20, 40, 235)
    e = max(4, W // 210)
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    h, l, p = (float(medidas.get(k) or 0) for k in ("altura", "largura", "profundidade"))

    if h > 0:
        x = x0 - 54
        if x < 60:
            x = x1 + 54
        _seta(d, (x, y0), (x, y1), cor + (255,), halo, e)
    if l > 0:
        y = y1 + 52
        if y > H - 70:
            y = y0 - 52
        _seta(d, (x0, y), (x1, y), cor + (255,), halo, e)
    dprof = 0
    if p > 0:
        # a seta de profundidade sobe na diagonal a partir do canto de baixo à direita; o valor fica acima da ponta dela
        dprof = min(max(0.34 * (x1 - x0), 100), W - x1 - 120)
        if dprof >= 70:
            a = (x1 + 30, y1 - 4)
            b = (a[0] + dprof, a[1] - dprof * 0.55)
            _seta(d, a, b, cor + (255,), halo, e)
    # valores por cima das linhas, depois das setas (a pílula esconde o meio da linha)
    if h > 0:
        x = x0 - 54 if x0 - 54 >= 60 else x1 + 54
        _pilula(camada, (x, (y0 + y1) // 2), cm(h), "altura", cor)
    if l > 0:
        y = y1 + 52 if y1 + 52 <= H - 70 else y0 - 52
        _pilula(camada, ((x0 + x1) // 2, y), cm(l), "largura", cor)
    if p > 0 and dprof >= 70:
        px = min(x1 + 30 + dprof, W - 110)
        _pilula(camada, (px, max(60, y1 - 4 - dprof * 0.55 - 62)), cm(p), "profundidade", cor)
    return Image.alpha_composite(img.convert("RGBA"), camada)


def _faixa(texto: str, tam: int, cor_fundo, margem=(34, 18)) -> Image.Image:
    f = fonte("Pacifico-Regular.ttf", tam)
    tmp = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    caixa = tmp.textbbox((0, 0), texto, font=f)
    w, h = caixa[2] - caixa[0] + 2 * margem[0], caixa[3] - caixa[1] + 2 * margem[1]
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=int(h * 0.28), fill=cor_fundo + (245,))
    d.text((margem[0] - caixa[0], margem[1] - caixa[1]), texto, font=f, fill=(255, 255, 255, 255))
    return im


def _painel_se_escuro(base: Image.Image, caixa, limite=165):
    """Se o fundo atrás de um bloco de texto for escuro, põe um painel creme translúcido para o texto marrom ler bem.
    Em fundo claro não faz nada (o visual limpo dos anúncios da loja continua igual)."""
    x0, y0, x1, y1 = (int(v) for v in caixa)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(base.width, x1), min(base.height, y1)
    if x1 - x0 < 10 or y1 - y0 < 10:
        return False
    if _luz(base, (x0, y0, x1, y1)) >= limite:
        return False
    painel = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(painel).rounded_rectangle([x0, y0, x1, y1], radius=30, fill=(255, 247, 238, 226))
    base.alpha_composite(painel)
    return True


def _luz(img: Image.Image, caixa) -> float:
    """Brilho médio (0-255) de uma região da imagem."""
    x0, y0, x1, y1 = (int(v) for v in caixa)
    return ImageStat.Stat(img.convert("RGB").crop((max(0, x0), max(0, y0), min(img.width, x1), min(img.height, y1))).convert("L")).mean[0]


def _colar_girado(base: Image.Image, im: Image.Image, canto, graus: float):
    r = im.rotate(graus, expand=True, resample=Image.BICUBIC)
    base.alpha_composite(r, (int(canto[0]), int(canto[1])))
    return r.size


def desenhar_anuncio(img: Image.Image, bbox, dados: dict, textos: dict) -> Image.Image:
    """dados: nome, preco, altura/largura/profundidade. textos: subtitulo, vantagens (lista), chamada."""
    base = img.convert("RGBA")
    W, H = base.size
    d = ImageDraw.Draw(base)
    # véu claro no topo, para o título ler bem em qualquer cenário
    veu = Image.new("RGBA", base.size, (0, 0, 0, 0))
    vd = ImageDraw.Draw(veu)
    for y in range(int(H * 0.30)):
        vd.line([(0, y), (W, y)], fill=(255, 250, 245, int(185 * (1 - y / (H * 0.30)))))
    base.alpha_composite(veu)
    d = ImageDraw.Draw(base)

    # Título em letra de mão (até 2 linhas, ocupa no máximo 56% da largura)
    nome = str(dados.get("nome") or "").strip()
    maxw = int(W * 0.56)
    tam, linhas = 118, [nome]
    while tam >= 54:
        f = fonte("Pacifico-Regular.ttf", tam)
        linhas, coube = quebrar(d, nome, f, maxw, 2)
        if coube:
            break
        tam -= 4
    f = fonte("Pacifico-Regular.ttf", tam)
    # Primeiro mede tudo (a altura de cada linha vem da própria fonte), depois desenha: assim dá para saber o
    # tamanho do bloco e pôr um painel claro atrás se o fundo do cenário for escuro
    asc, desc = f.getmetrics()
    y, desenhos = 44, []
    for l in linhas:
        desenhos.append((58, y, l, f))
        y += asc + desc - int(tam * 0.12)
    sub = str(textos.get("subtitulo") or "").strip()
    if sub:
        fs = fonte("Poppins-Regular.ttf", 34)
        y += 14
        for l in quebrar(d, sub, fs, maxw, 2)[0]:
            desenhos.append((62, y, l, fs))
            y += 46
    larg_bloco = max([_largura(d, l, f_) for (_, _, l, f_) in desenhos] or [0])
    painel_topo = _painel_se_escuro(base, (30, 26, 58 + larg_bloco + 34, y + 12))
    fim_topo = y + 12
    for (x, yy, l, f_) in desenhos:
        d.text((x, yy), l, font=f_, fill=MARROM + (255,))

    # Preço em faixa
    if float(dados.get("preco") or 0) > 0:
        faixa = _faixa(reais(dados["preco"]), 66, ROSA)
        _colar_girado(base, faixa, (W - faixa.width - 40, 50), 3)

    # Vantagens (círculo + marca de ok), à direita da peça
    vant = [str(v).strip() for v in (textos.get("vantagens") or []) if str(v).strip()][:3]
    fv = fonte("Poppins-SemiBold.ttf", 31)
    x_icone, x_texto = int(W * 0.60), int(W * 0.60) + 92
    y = int(H * 0.30)
    if painel_topo:  # painel do título desceu até aqui: as vantagens começam abaixo dele para os painéis não se sobreporem
        y = max(y, fim_topo + 76)
    if vant:
        _painel_se_escuro(base, (x_icone - 62, y - 62, W - 24, y + 150 * (len(vant) - 1) + 82))
    for v in vant:
        linhas, _ = quebrar(d, v, fv, W - x_texto - 44, 3)
        d.ellipse([x_icone - 38, y - 38 + 6, x_icone + 38, y + 38 + 6], fill=ROSA_CLARO + (240,))
        d.line([(x_icone - 17, y + 8), (x_icone - 4, y + 21), (x_icone + 20, y - 8)], fill=ROSA + (255,), width=8, joint="curve")
        ty = y + 6 - (len(linhas) * 40) // 2
        for l in linhas:
            d.text((x_texto, ty), l, font=fv, fill=MARROM + (255,))
            ty += 40
        y += 150

    # Chamada para encomendar
    chamada = str(textos.get("chamada") or "Façam as suas encomendas!").strip()
    if chamada:
        fc = fonte("Pacifico-Regular.ttf", 46)
        linhas, _ = quebrar(d, chamada, fc, int(W * 0.40), 2)
        faixa = _faixa("\n".join(linhas) if len(linhas) > 1 else chamada, 46, ROSA) if len(linhas) == 1 else None
        if faixa is None:
            partes = [_faixa(l, 46, ROSA) for l in linhas]
            w = max(p.width for p in partes)
            faixa = Image.new("RGBA", (w, sum(p.height for p in partes) - 18 * (len(partes) - 1)), (0, 0, 0, 0))
            yy = 0
            for p in partes:
                faixa.alpha_composite(p, ((w - p.width) // 2, yy))
                yy += p.height - 18
        _colar_girado(base, faixa, (W - faixa.width - 40, int(H * 0.80)), 4)

    return desenhar_medidas(base, bbox, dados, "claro") if any(float(dados.get(k) or 0) > 0 for k in ("altura", "largura", "profundidade")) else base
