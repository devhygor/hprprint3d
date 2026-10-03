#!/usr/bin/env python3
"""Busca os últimos posts do Instagram pelo feed JSON do Behold e grava no site.

O link do feed fica em data/instagram-fonte.txt. Gera data/instagram.json e baixa
as imagens em img/insta/, assim a vitrine não depende do Behold a cada visita.
"""
import json
import os
import re
import sys
import urllib.request

FONTE = "data/instagram-fonte.txt"
SAIDA = "data/instagram.json"
PASTA = "img/insta"
UA = {"User-Agent": "Mozilla/5.0 (HPR Print 3D site)"}


def baixar(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return r.read()


def main():
    if not os.path.exists(FONTE):
        print("Sem data/instagram-fonte.txt; nada a fazer.")
        return
    url = open(FONTE).read().strip()
    if not re.match(r"^https://feeds\.behold\.so/[A-Za-z0-9]+$", url):
        sys.exit("Link do Behold inválido em data/instagram-fonte.txt")

    dados = json.loads(baixar(url))
    posts = dados.get("posts", dados) if isinstance(dados, dict) else dados
    os.makedirs(PASTA, exist_ok=True)

    saida, usados = [], set()
    for p in posts[:6]:
        tamanhos = p.get("sizes") or {}
        img = (
            (tamanhos.get("medium") or {}).get("mediaUrl")
            or (tamanhos.get("large") or {}).get("mediaUrl")
            or p.get("thumbnailUrl")
            or p.get("mediaUrl")
        )
        ident = re.sub(r"[^A-Za-z0-9_-]", "", str(p.get("id", "")))[:40]
        if not img or not ident:
            continue
        arquivo = f"{PASTA}/{ident}.jpg"
        if not os.path.exists(arquivo):
            try:
                with open(arquivo, "wb") as f:
                    f.write(baixar(img))
            except Exception as e:
                print("Falha ao baixar imagem", ident, e)
                continue
        usados.add(os.path.basename(arquivo))
        legenda = (p.get("prunedCaption") or p.get("caption") or "").strip()
        saida.append({
            "id": ident,
            "link": p.get("permalink", ""),
            "imagem": arquivo,
            "legenda": legenda[:220],
            "tipo": p.get("mediaType", ""),
            "data": p.get("timestamp", ""),
        })

    # Apaga imagens de posts que saíram da lista
    for nome in os.listdir(PASTA):
        if nome not in usados:
            os.remove(os.path.join(PASTA, nome))

    perfil = {}
    if isinstance(dados, dict):
        foto = dados.get("profilePictureUrl")
        if foto:
            try:
                with open("img/perfil-instagram.jpg", "wb") as f:
                    f.write(baixar(foto))
                perfil["foto"] = "img/perfil-instagram.jpg"
            except Exception as e:
                print("Falha ao baixar foto do perfil", e)
        perfil["usuario"] = dados.get("username", "")

    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump({"perfil": perfil, "posts": saida}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{len(saida)} posts gravados.")


if __name__ == "__main__":
    main()
