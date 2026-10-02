#!/usr/bin/env python3
"""Busca dados públicos de um modelo do MakerWorld: nome, foto, licença e perfis (gramas e tempo).

Uso: python scripts/makerworld.py <url> <id>
Grava data/makerworld/<id>.json e img/mw/<id>.jpg. Sem dependências externas.
"""
import datetime
import gzip
import html
import json
import os
import re
import sys
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
CABECALHOS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip",
}


def baixar(url, cabecalhos=None, limite=15_000_000):
    req = urllib.request.Request(url, headers=cabecalhos or CABECALHOS)
    with urllib.request.urlopen(req, timeout=40) as r:
        dados = r.read(limite)
        if r.headers.get("Content-Encoding") == "gzip":
            dados = gzip.decompress(dados)
        return dados, r.headers.get("Content-Type", "")


def meta(pagina, prop):
    padroes = [
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']*)["\']',
        rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']',
    ]
    for p in padroes:
        m = re.search(p, pagina, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return ""


def percorrer(obj):
    """Gera todos os dicionários dentro de um JSON."""
    pilha = [obj]
    while pilha:
        atual = pilha.pop()
        if isinstance(atual, dict):
            yield atual
            pilha.extend(atual.values())
        elif isinstance(atual, list):
            pilha.extend(atual)


def numero(v):
    try:
        n = float(v)
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def extrair_perfis(dados):
    """Procura os perfis de impressão (instances) com peso e tempo previstos."""
    perfis = []
    vistos = set()
    for d in percorrer(dados):
        lista = d.get("instances")
        if not isinstance(lista, list):
            continue
        for inst in lista:
            if not isinstance(inst, dict):
                continue
            gramas = None
            for k in ("weight", "totalWeight", "filamentWeight", "needAmsWeight"):
                gramas = gramas or numero(inst.get(k))
            segundos = None
            for k in ("prediction", "printTime", "estimatedTime", "predictionTime"):
                segundos = segundos or numero(inst.get(k))
            # Alguns perfis trazem os valores por placa
            placas = inst.get("plates") or inst.get("platesInfo") or []
            if isinstance(placas, list) and (not gramas or not segundos):
                g_soma = sum(numero(p.get("weight")) or 0 for p in placas if isinstance(p, dict))
                s_soma = sum(numero(p.get("prediction")) or 0 for p in placas if isinstance(p, dict))
                gramas = gramas or (g_soma or None)
                segundos = segundos or (s_soma or None)
            if not gramas and not segundos:
                continue
            nome = inst.get("title") or inst.get("name") or inst.get("profileName") or ""
            chave = (nome, gramas, segundos)
            if chave in vistos:
                continue
            vistos.add(chave)
            perfis.append({
                "nome": str(nome)[:80],
                "gramas": round(gramas, 1) if gramas else None,
                "minutos": round(segundos / 60) if segundos else None,
                "placas": len(placas) if isinstance(placas, list) else None,
            })
        if perfis:
            break
    return perfis[:12]


def extrair_licenca(dados):
    for d in percorrer(dados):
        lic = d.get("license")
        if isinstance(lic, str) and lic.strip():
            return lic.strip()
        if isinstance(lic, dict):
            nome = lic.get("name") or lic.get("title")
            if nome:
                return str(nome)
    return ""


def extrair_designer(dados):
    for d in percorrer(dados):
        criador = d.get("designCreator") or d.get("creator")
        if isinstance(criador, dict) and criador.get("name"):
            return str(criador["name"])
    return ""


def main():
    url, ident = sys.argv[1].strip(), re.sub(r"[^a-z0-9-]", "", sys.argv[2].lower())[:80]
    if not ident:
        sys.exit("id inválido")
    os.makedirs("data/makerworld", exist_ok=True)
    os.makedirs("img/mw", exist_ok=True)
    agora = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    saida = {"ok": False, "url": url, "atualizadoEm": agora}

    try:
        if not re.match(r"^https?://(www\.)?makerworld\.com/", url, re.I):
            raise ValueError("o link não é do makerworld.com")
        bruto, _ = baixar(url)
        pagina = bruto.decode("utf-8", "replace")

        titulo = meta(pagina, "og:title")
        titulo = re.sub(r"\s*[-|]\s*(Free\s+)?3D Print Model.*$", "", titulo, flags=re.I).strip()
        imagem_url = meta(pagina, "og:image")

        dados = None
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', pagina, re.S)
        if m:
            try:
                dados = json.loads(m.group(1))
            except json.JSONDecodeError:
                dados = None

        saida.update({
            "titulo": titulo,
            "designer": extrair_designer(dados) if dados else "",
            "licenca": extrair_licenca(dados) if dados else "",
            "perfis": extrair_perfis(dados) if dados else [],
        })

        if imagem_url and "og-icon" not in imagem_url:
            try:
                img, tipo = baixar(imagem_url, {"User-Agent": UA, "Referer": url})
                if tipo.startswith("image/") and len(img) > 1000:
                    caminho = f"img/mw/{ident}.jpg"
                    with open(caminho, "wb") as f:
                        f.write(img)
                    saida["imagem"] = caminho
            except Exception as e:  # foto é opcional
                saida["avisoImagem"] = str(e)[:200]

        if not titulo and not saida.get("imagem"):
            raise ValueError("o MakerWorld bloqueou ou o modelo não existe")
        saida["ok"] = True
    except Exception as e:
        saida["erro"] = str(e)[:200]

    with open(f"data/makerworld/{ident}.json", "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(saida, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
