"""Deixa leves as fotos das peças que ainda estão no tamanho original.

Para cada foto de `pecas.fotos` fora de `pecas/leve/`, baixa, gera JPEG de até 1600 px
e uma miniatura de 640 px ("-p.jpg"), envia para `fotos/pecas/leve/` e troca o link na peça.
Os arquivos originais NÃO são apagados (dá para voltar), e o antes/depois de cada peça
vai para um JSON de backup.

Uso (as credenciais vêm do Bitwarden):
    envrun HPRPRINT3D -- python scripts/fotos_leves.py            # só mostra o que faria
    envrun HPRPRINT3D -- python scripts/fotos_leves.py --aplicar  # faz de verdade
"""
import io
import json
import os
import random
import string
import sys
import time
import urllib.request

from PIL import Image, ImageOps

FOTO_MAX, MINI_MAX = 1600, 640
PASTA_LEVE = "/storage/v1/object/public/fotos/pecas/leve/"

TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
REF = os.environ["SUPABASE_PROJECT_REF"]
BASE = f"https://{REF}.supabase.co"


def pedir(url, metodo="GET", corpo=None, cabecalhos=None):
    req = urllib.request.Request(url, data=corpo, method=metodo, headers={"User-Agent": "hpr-oficina", **(cabecalhos or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def sql(consulta):
    corpo = json.dumps({"query": consulta}).encode()
    return json.loads(pedir(f"https://api.supabase.com/v1/projects/{REF}/database/query", "POST", corpo,
                            {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}))


def chave_servico():
    chaves = json.loads(pedir(f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true", cabecalhos={"Authorization": f"Bearer {TOKEN}"}))
    for c in chaves:
        if c.get("name") == "service_role" or c.get("type") == "secret":
            return c["api_key"]
    raise SystemExit("chave de serviço não encontrada")


def jpeg(img, maximo, qualidade):
    copia = img.copy()
    copia.thumbnail((maximo, maximo), Image.LANCZOS)
    saida = io.BytesIO()
    copia.save(saida, "JPEG", quality=qualidade, optimize=True, progressive=True)
    return saida.getvalue()


def abrir(dados):
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(dados)))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        fundo = Image.new("RGB", img.size, "white")
        fundo.paste(img, mask=img.split()[-1])
        return fundo
    return img.convert("RGB")


def enviar(chave, caminho, dados):
    pedir(f"{BASE}/storage/v1/object/fotos/{caminho}", "POST", dados, {
        "Authorization": f"Bearer {chave}", "apikey": chave,
        "Content-Type": "image/jpeg", "Cache-Control": "max-age=31536000", "x-upsert": "false",
    })
    return f"{BASE}/storage/v1/object/public/fotos/{caminho}"


def main():
    aplicar = "--aplicar" in sys.argv
    pecas = sql("select id, nome, foto, fotos from pecas order by ordem, nome")
    chave = chave_servico() if aplicar else None
    backup, antes_total, depois_total = [], 0, 0
    for p in pecas:
        fotos = p["fotos"] if isinstance(p["fotos"], list) and p["fotos"] else ([p["foto"]] if p["foto"] else [])
        novas, mudou = [], False
        for u in fotos:
            if not isinstance(u, str) or PASTA_LEVE in u or not u.startswith("https://"):
                novas.append(u)
                continue
            try:
                dados = pedir(u)
                img_formato = Image.open(io.BytesIO(dados)).format
                img = abrir(dados)
                grande, mini = jpeg(img, FOTO_MAX, 82), jpeg(img, MINI_MAX, 78)
                # JPEG que já era pequeno: mantém o arquivo original (recomprimir só piora)
                if img_formato == "JPEG" and max(img.size) <= FOTO_MAX and len(dados) <= len(grande):
                    grande = dados
            except Exception as e:  # foto quebrada: deixa como está
                print(f"  ! {p['nome']}: {u[-40:]} -> {e}")
                novas.append(u)
                continue
            antes_total += len(dados)
            depois_total += len(mini)  # o que a vitrine baixa no card
            print(f"  {p['nome'][:40]:40} {len(dados)//1024:>5} KB -> {len(grande)//1024:>4} KB (card {len(mini)//1024} KB)")
            if aplicar:
                sorteio = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
                base = f"pecas/leve/{p['id']}-{int(time.time()*1000):x}{sorteio}"
                enviar(chave, base + "-p.jpg", mini)
                u = enviar(chave, base + ".jpg", grande)
            novas.append(u)
            mudou = True
        if mudou:
            backup.append({"id": p["id"], "foto": p["foto"], "fotos": p["fotos"], "novas": novas})
            if aplicar:
                fotos_json = json.dumps(novas).replace("'", "''")
                capa = (novas[0] or "").replace("'", "''")
                sql(f"update pecas set fotos = '{fotos_json}'::jsonb, foto = '{capa}' where id = '{p['id'].replace(chr(39), chr(39)*2)}'")
    print(f"\nPeças com foto pesada: {len(backup)}. Fotos originais: {antes_total/1e6:.1f} MB; miniaturas dos cards: {depois_total/1e6:.1f} MB")
    if aplicar and backup:
        nome = f"fotos-leves-backup-{time.strftime('%Y%m%d-%H%M%S')}.json"
        with open(nome, "w", encoding="utf-8") as f:
            json.dump(backup, f, ensure_ascii=False, indent=1)
        print("Backup do antes/depois em", nome)
    elif not aplicar:
        print("Nada foi alterado. Rode com --aplicar para fazer de verdade.")


if __name__ == "__main__":
    main()
