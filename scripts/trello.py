#!/usr/bin/env python3
"""Sincroniza o roadmap (docs/roadmap.json) com o quadro do Trello da HPR Print 3D.

Credenciais ficam só no seu PC, em variáveis de ambiente (nunca no repositório):
  TRELLO_KEY    chave de https://trello.com/power-ups/admin (novo Power-Up -> API key)
  TRELLO_TOKEN  token gerado pelo link "Token" na mesma página

Uso:
  python scripts/trello.py criar            # cria listas, etiquetas e cards que ainda não existem
  python scripts/trello.py criar --simular  # só mostra o que faria
  python scripts/trello.py mover "parte do título" Feito
  python scripts/trello.py listar
"""
import json, os, sys, urllib.parse, urllib.request
from pathlib import Path

BOARD = "j9kfn8lG"
RAIZ = Path(__file__).resolve().parent.parent
API = "https://api.trello.com/1"


def chamar(metodo, caminho, **params):
    chave, token = os.environ.get("TRELLO_KEY"), os.environ.get("TRELLO_TOKEN")
    if not chave or not token:
        sys.exit("Defina TRELLO_KEY e TRELLO_TOKEN (veja o topo deste arquivo).")
    params.update(key=chave, token=token)
    dados = urllib.parse.urlencode(params)
    url = f"{API}{caminho}"
    req = urllib.request.Request(url + ("?" + dados if metodo == "GET" else ""), method=metodo,
                                 data=dados.encode() if metodo != "GET" else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def carregar():
    return json.loads((RAIZ / "docs" / "roadmap.json").read_text(encoding="utf-8"))


def quadro():
    return chamar("GET", f"/boards/{BOARD}", fields="id,name")["id"]


def criar(simular):
    rm = carregar()
    bid = quadro()
    listas = {l["name"]: l["id"] for l in chamar("GET", f"/boards/{bid}/lists", filter="open")}
    etiquetas = {e["name"]: e["id"] for e in chamar("GET", f"/boards/{bid}/labels", limit=100) if e["name"]}
    existentes = {c["name"] for c in chamar("GET", f"/boards/{bid}/cards", fields="name")}

    for nome in rm["listas"]:
        if nome not in listas:
            print(f"[lista] {nome}")
            if not simular:
                listas[nome] = chamar("POST", "/lists", name=nome, idBoard=bid, pos="bottom")["id"]
    for nome, cor in rm["etiquetas"].items():
        if nome not in etiquetas:
            print(f"[etiqueta] {nome}")
            if not simular:
                etiquetas[nome] = chamar("POST", "/labels", name=nome, color=cor, idBoard=bid)["id"]

    novos = 0
    for c in rm["cards"]:
        if c["titulo"] in existentes:
            continue
        print(f"[card] {c['lista']:<9} {c['titulo']}")
        novos += 1
        if simular:
            continue
        card = chamar("POST", "/cards", idList=listas[c["lista"]], name=c["titulo"], desc=c.get("descricao", ""),
                      idLabels=etiquetas.get(c.get("etiqueta"), ""), pos="bottom")
        if c.get("checklist"):
            cl = chamar("POST", "/checklists", idCard=card["id"], name="Passos")
            for item in c["checklist"]:
                chamar("POST", f"/checklists/{cl['id']}/checkItems", name=item)
    print(f"{novos} card(s) {'a criar' if simular else 'criados'}.")


def achar_card(trecho):
    cards = chamar("GET", f"/boards/{quadro()}/cards", fields="name")
    achados = [c for c in cards if trecho.lower() in c["name"].lower()]
    if len(achados) != 1:
        sys.exit(f"{len(achados)} cards combinam com '{trecho}': " + "; ".join(c["name"] for c in achados))
    return achados[0]


def mover(trecho, lista):
    bid = quadro()
    destino = {l["name"].lower(): l["id"] for l in chamar("GET", f"/boards/{bid}/lists", filter="open")}.get(lista.lower())
    if not destino:
        sys.exit(f"Lista '{lista}' não existe.")
    card = achar_card(trecho)
    chamar("PUT", f"/cards/{card['id']}", idList=destino, pos="top")
    print(f"'{card['name']}' -> {lista}")


def listar():
    bid = quadro()
    for l in chamar("GET", f"/boards/{bid}/lists", filter="open", cards="open", card_fields="name"):
        print(f"\n== {l['name']} ({len(l['cards'])})")
        for c in l["cards"]:
            print("  -", c["name"])


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["criar"]:
        criar("--simular" in a)
    elif a[:1] == ["mover"] and len(a) == 3:
        mover(a[1], a[2])
    elif a[:1] == ["listar"]:
        listar()
    else:
        print(__doc__)
