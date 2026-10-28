#!/usr/bin/env python3
"""Foto de vitrine no padrão da HPR Print 3D: recorta a peça de uma foto, cria só o cenário ao redor
(ComfyUI + SDXL, no PC da loja) e devolve a peça ORIGINAL por cima, pixel a pixel, para a IA não inventar
detalhes que a peça não tem.

  python estudio/cena.py --entrada foto.jpg --saida cena.png [--cena madeira|bandeja|natal] [--semente 1]

Precisa do ComfyUI rodando (padrão http://127.0.0.1:8188) com o modelo RealVisXL_V5.0_fp16.safetensors.
Variáveis: COMFY_URL, COMFY_PASTA (pasta ComfyUI dentro da instalação portátil), COMFY_MODELO.
"""
import argparse, io, json, os, sys, time, urllib.request, uuid
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

COMFY = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
PASTA = Path(os.environ.get("COMFY_PASTA", r"C:\Users\Hygor\ComfyUI\ComfyUI_windows_portable\ComfyUI"))
MODELO = os.environ.get("COMFY_MODELO", "RealVisXL_V5.0_fp16.safetensors")
LARG, ALT = 896, 1152  # retrato 4:5, tamanho nativo bom para SDXL

# Cenários no estilo das fotos da loja: ambiente aconchegante, luz quente, fundo creme com luzes desfocadas
CENAS = {
    "madeira": "a light birch wood slice on a pale wooden table, bright airy cozy home interior, very soft cream and blush "
               "pink blurred background with a few small soft warm bokeh lights, high-key, pastel",
    "bandeja": "a white ribbed ceramic tray on a light wooden table, bright airy cozy home interior, soft cream blurred "
               "background, a few small soft warm bokeh lights, high-key, pastel",
    "natal": "a light wooden table, bright cozy Christmas atmosphere, softly blurred christmas tree and pine cones in the "
             "background with golden bokeh lights, cream tones, high-key",
}
BASE = ", empty surface behind the product, professional product photography, bright natural window light, soft warm tones, shallow depth of field, photorealistic, 85mm"
NEGATIVO = ("text, watermark, logo, letters, people, hands, extra objects, extra figures, plants, flowers, pompom, fluffy, hat, crown, "
            "dark, moody, low key, black background, deformed, oversaturated, cartoon, illustration")


def recortar(img: Image.Image) -> Image.Image:
    # isnet-general-use: licença Apache-2.0 (vale para uso comercial). NÃO usar o bria-rmbg, que é só não comercial.
    from rembg import new_session, remove
    return remove(img.convert("RGB"), session=new_session("isnet-general-use")).convert("RGBA")


def so_o_corpo(peca: Image.Image) -> Image.Image:
    """Tira do recorte os pedaços soltos pequenos (restos do fundo velho), mantendo as partes grandes da peça."""
    from scipy import ndimage
    a = np.array(peca.getchannel("A"))
    rotulos, n = ndimage.label(a > 24)
    if n <= 1:
        return peca
    areas = ndimage.sum(np.ones_like(a), rotulos, range(1, n + 1))
    manter = [i + 1 for i, ar in enumerate(areas) if ar >= 0.08 * max(areas)]
    a[~np.isin(rotulos, manter)] = 0
    out = peca.copy()
    out.putalpha(Image.fromarray(a))
    return out


def sombra_no_chao(final: Image.Image, camada: Image.Image) -> Image.Image:
    """Sombra suave embaixo da peça, para ela não parecer flutuando."""
    alfa = np.array(camada.getchannel("A")) > 24
    ys, xs = np.where(alfa)
    if not len(ys):
        return final
    base, x0, x1 = ys.max(), xs.min(), xs.max()
    # só a faixa de baixo da peça (onde ela toca a superfície)
    faixa = alfa[max(0, base - int((base - ys.min()) * 0.06)): base + 1]
    cx = (x0 + x1) // 2
    larg = max(20, int((x1 - x0) * 0.62))
    sombra = Image.new("L", final.size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(sombra).ellipse([cx - larg // 2 - int(larg * 0.25), base - 6, cx + larg // 2 + int(larg * 0.25), base + int(larg * 0.16)], fill=150)
    sombra = sombra.filter(ImageFilter.GaussianBlur(max(8, larg // 7)))
    escuro = Image.new("RGBA", final.size, (45, 28, 14, 0))
    escuro.putalpha(sombra)
    return Image.alpha_composite(final, escuro)


def montar_tela(peca: Image.Image, escala=0.62, base=0.88):
    """Põe a peça recortada numa tela retrato, no terço de baixo, e devolve (tela RGB cinza, alfa da peça na tela)."""
    peca = so_o_corpo(peca)
    caixa = peca.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    peca = peca.crop(caixa)
    f = min(ALT * escala / peca.height, LARG * 0.8 / peca.width)
    peca = peca.resize((max(1, int(peca.width * f)), max(1, int(peca.height * f))), Image.LANCZOS)
    x = (LARG - peca.width) // 2
    y = int(ALT * base) - peca.height
    camada = Image.new("RGBA", (LARG, ALT), (0, 0, 0, 0))
    camada.paste(peca, (x, y), peca)
    # Encolhe 2 px a borda da peça: some o contorno de fundo velho que o recorte deixa
    alfa = camada.getchannel("A").filter(ImageFilter.MinFilter(5))
    camada.putalpha(alfa)
    return camada


def enviar_e_gerar(tela_rgba: Image.Image, cena: str, semente: int) -> Image.Image:
    nome = f"hpr_{uuid.uuid4().hex[:8]}.png"
    entrada = PASTA / "input"
    entrada.mkdir(exist_ok=True)
    tela_rgba.save(entrada / nome)  # LoadImage entrega a máscara = área transparente (o que a IA preenche)
    fluxo = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": MODELO}},
        "2": {"class_type": "LoadImage", "inputs": {"image": nome}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": CENAS.get(cena, cena) + BASE, "clip": ["1", 1]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVO, "clip": ["1", 1]}},
        "5": {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["1", 2]}},
        "6": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["5", 0], "mask": ["2", 1]}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["3", 0], "negative": ["4", 0],
              "latent_image": ["6", 0], "seed": semente, "steps": 32, "cfg": 5.5, "sampler_name": "dpmpp_2m",
              "scheduler": "karras", "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["1", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "hpr_cena"}},
    }
    req = urllib.request.Request(f"{COMFY}/prompt", data=json.dumps({"prompt": fluxo}).encode(), headers={"Content-Type": "application/json"})
    pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    for _ in range(600):
        h = json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}", timeout=30))
        if pid in h:
            saidas = h[pid]["outputs"]["9"]["images"][0]
            url = f"{COMFY}/view?filename={saidas['filename']}&subfolder={saidas['subfolder']}&type={saidas['type']}"
            (entrada / nome).unlink(missing_ok=True)
            return Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=60).read())).convert("RGB")
        time.sleep(1)
    raise TimeoutError("o ComfyUI não terminou em 10 minutos")


def gerar(foto: Image.Image, cena: str = "madeira", semente: int | None = None) -> Image.Image:
    """Foto da peça (qualquer fundo) -> foto de vitrine 896x1152 no padrão da loja."""
    semente = int(time.time()) % 100000 if semente is None else semente
    foto.thumbnail((1600, 1600))
    camada = montar_tela(recortar(foto))
    fundo = enviar_e_gerar(camada, cena, semente)
    final = fundo.convert("RGBA")
    # Devolve a peça original por cima, com borda suave de 1 px
    camada.putalpha(camada.getchannel("A").filter(ImageFilter.GaussianBlur(0.8)))
    final = sombra_no_chao(final, camada)
    final.alpha_composite(camada)
    return final.convert("RGB")


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--entrada", required=True)
    a.add_argument("--saida", required=True)
    a.add_argument("--cena", default="madeira", help="madeira, bandeja, natal ou um texto livre em inglês")
    a.add_argument("--semente", type=int, default=None)
    a.add_argument("--recorte", help="x0,y0,x1,y1 da peça na foto de entrada (opcional)")
    r = a.parse_args()
    foto = Image.open(r.entrada).convert("RGB")
    if r.recorte:
        foto = foto.crop(tuple(int(v) for v in r.recorte.split(",")))
    gerar(foto, r.cena, r.semente).save(r.saida, quality=94)
    print("ok", r.saida)


if __name__ == "__main__":
    sys.exit(main())
