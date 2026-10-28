#!/usr/bin/env python3
"""Porta de entrada da IA da loja (porta 4300), a única que o túnel (ngrok) mostra para a internet.

  /v1/*     -> proxy LiteLLM (127.0.0.1:4200): texto, descrição das peças
  /imagem   -> estudio/cena.py: foto de vitrine (recorte da peça + cenário no ComfyUI); cenários em estudio/cenas.json,
               ou cena "personalizado" com "texto" em português. layout: limpa | medidas | anuncio (título, preço,
               vantagens e medidas; o texto vem da própria peça: nome, categoria, material, descrição, kit)
  /saude    -> diz se o ComfyUI está no ar

Tudo exige "Authorization: Bearer <LOJA_IA_KEY>" (a chave fica em .env-loja, fora do git).
Só escuta em 127.0.0.1; quem chega de fora é o ngrok.
"""
import base64, io, json, os, re, sys, threading, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).parent))
import cena  # noqa: E402
from PIL import Image  # noqa: E402

CHAVE = os.environ.get("LOJA_IA_KEY", "")
LITELLM = os.environ.get("LITELLM_URL", "http://127.0.0.1:4200")
PORTA = int(os.environ.get("GATEWAY_PORT", "4300"))
MAX_BYTES = 14 * 1024 * 1024
trava_gpu = threading.Lock()  # uma imagem por vez: a placa é uma só


def _txt(v, n):
    return str(v or "").strip()[:n]


def _num(v):
    try:
        x = float(str(v).replace(",", "."))
        return x if 0 < x < 1000 else None
    except (TypeError, ValueError):
        return None


def dados_da_peca(c: dict) -> dict:
    """Só o que a peça tem de verdade: o texto do anúncio é escrito a partir disto."""
    return {
        "nome": _txt(c.get("nome"), 60), "categoria": _txt(c.get("categoria"), 40), "material": _txt(c.get("material"), 30),
        "descricao": _txt(c.get("descricao"), 500), "preco": _num(c.get("preco")),
        "altura": _num(c.get("altura")), "largura": _num(c.get("largura")), "profundidade": _num(c.get("profundidade")),
        "kit": [_txt(k, 50) for k in (c.get("kit") or [])[:12] if isinstance(k, str)],
    }


VANTAGENS_PADRAO = ["Impresso em 3D com capricho", "Ótima opção de presente", "Faça a sua encomenda"]


def textos_anuncio(d: dict, vantagens_prontas: list) -> dict:
    """Subtítulo e 3 vantagens da PRÓPRIA peça, escritos pela IA local (ou as que a equipe digitou)."""
    prontas = [_txt(v, 60) for v in vantagens_prontas if isinstance(v, str) and v.strip()][:3]
    if len(prontas) == 3:
        return {"subtitulo": "", "vantagens": prontas, "chamada": "Façam as suas encomendas!"}
    fatos = [f"Nome: {d['nome']}"]
    for rot, k in (("Categoria", "categoria"), ("Material", "material"), ("Descrição", "descricao")):
        if d[k]:
            fatos.append(f"{rot}: {d[k]}")
    if d["kit"]:
        fatos.append("Kit com: " + ", ".join(d["kit"]))
    corpo = json.dumps({
        "model": "loja-texto", "max_tokens": 320, "temperature": 0.5,
        "messages": [
            {"role": "system", "content":
                "Você escreve o texto de um anúncio da HPR Print 3D, loja brasileira de peças impressas em 3D. Responda SOMENTE um JSON: "
                '{"subtitulo": "...", "vantagens": ["...", "...", "..."]}. '
                "subtitulo: uma frase curta e acolhedora sobre ESTA peça (até 48 caracteres). "
                "vantagens: exatamente 3 frases curtas (até 40 caracteres cada) sobre ESTA peça: para que serve, por que é especial, acabamento. "
                "Use apenas o que está nos dados; não invente medidas, cores, materiais, preço, resistência, garantia nem prazos. "
                "'Impresso em 3D' é um fato e pode ser usado. Sem emojis, sem hashtags."},
            {"role": "user", "content": "\n".join(fatos)},
        ],
    }).encode()
    texto = {"subtitulo": "", "vantagens": list(prontas)}
    try:
        req = urllib.request.Request(LITELLM + "/v1/chat/completions", data=corpo,
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {CHAVE}"})
        bruto = json.load(urllib.request.urlopen(req, timeout=120))["choices"][0]["message"]["content"]
        achado = re.search(r"\{.*\}", bruto, re.S)
        j = json.loads(achado.group(0)) if achado else {}
        texto["subtitulo"] = _txt(j.get("subtitulo"), 60)
        if not prontas:
            texto["vantagens"] = [_txt(v, 60).rstrip(" .;") for v in (j.get("vantagens") or []) if isinstance(v, str) and v.strip()][:3]
    except Exception:  # noqa: BLE001  (IA de texto fora do ar: usa as frases padrão)
        pass
    for v in VANTAGENS_PADRAO:
        if len(texto["vantagens"]) >= 3:
            break
        texto["vantagens"].append(v)
    texto["chamada"] = "Façam as suas encomendas!"
    return texto


def cenario_em_ingles(texto: str) -> str:
    """Cenário descrito em português -> frase em inglês para o gerador, traduzida pela IA local (Ollama via proxy)."""
    corpo = json.dumps({
        "model": "loja-texto", "max_tokens": 120, "temperature": 0.3,
        "messages": [
            {"role": "system", "content": "You write short English descriptions of a product-photography BACKDROP (surface and softly blurred background only). "
             "The user describes it in Portuguese. Reply with one English phrase of at most 35 words, no quotes, never mention the product itself, "
             "end with: bright, soft light, high-key."},
            {"role": "user", "content": texto},
        ],
    }).encode()
    req = urllib.request.Request(LITELLM + "/v1/chat/completions", data=corpo,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {CHAVE}"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    saida = str(r["choices"][0]["message"]["content"]).strip().strip('"“”')
    if len(saida) < 8:
        raise ValueError("não consegui entender o cenário descrito")
    return saida[:300]


def foto_da_requisicao(c: dict) -> Image.Image:
    if c.get("foto_base64"):
        b64 = str(c["foto_base64"]).split(",", 1)[-1]
        if len(b64) > MAX_BYTES * 1.4:
            raise ValueError("foto grande demais")
        return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    u = urlparse(str(c.get("foto_url", "")))
    # só aceita fotos guardadas no Supabase: o gateway não vira porta para baixar qualquer coisa
    if u.scheme != "https" or not (u.hostname or "").endswith(".supabase.co"):
        raise ValueError("a foto precisa estar no Supabase (https://...supabase.co)")
    req = urllib.request.Request(u.geturl(), headers={"User-Agent": "hpr-gateway"})
    dados = urllib.request.urlopen(req, timeout=30).read(MAX_BYTES + 1)
    if len(dados) > MAX_BYTES:
        raise ValueError("foto grande demais")
    return Image.open(io.BytesIO(dados)).convert("RGB")


class H(BaseHTTPRequestHandler):
    server_version = "hpr-gateway"

    def _json(self, status, corpo):
        dados = json.dumps(corpo).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def _autorizado(self):
        return bool(CHAVE) and self.headers.get("Authorization", "") == f"Bearer {CHAVE}"

    def _corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BYTES * 2:
            raise ValueError("corpo grande demais")
        return self.rfile.read(n) if n else b""

    def _proxy(self, corpo=b""):
        req = urllib.request.Request(LITELLM + self.path, data=corpo or None, method=self.command,
                                     headers={k: v for k, v in self.headers.items() if k.lower() in ("authorization", "content-type")})
        try:
            r = urllib.request.urlopen(req, timeout=170)
            status, dados, tipo = r.status, r.read(), r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            status, dados, tipo = e.code, e.read(), e.headers.get("Content-Type", "application/json")
        except Exception:
            return self._json(502, {"erro": "o proxy de texto não respondeu"})
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        if not self._autorizado():
            return self._json(401, {"erro": "sem chave"})
        if self.path == "/saude":
            try:
                urllib.request.urlopen(cena.COMFY + "/system_stats", timeout=4)
                comfy = "no ar"
            except Exception:
                comfy = "desligado"
            return self._json(200, {"gateway": "no ar", "comfyui": comfy})
        if self.path.startswith("/v1/"):
            return self._proxy()
        self._json(404, {"erro": "não existe"})

    def do_POST(self):
        if not self._autorizado():
            return self._json(401, {"erro": "sem chave"})
        try:
            corpo = self._corpo()
            if self.path.startswith("/v1/"):
                return self._proxy(corpo)
            if self.path != "/imagem":
                return self._json(404, {"erro": "não existe"})
            c = json.loads(corpo or b"{}")
            cenario = c.get("cena", "madeira")
            if cenario == "personalizado":
                descricao = str(c.get("texto", "")).strip()[:240]
                if len(descricao) < 4:
                    return self._json(400, {"erro": "Descreva o cenário (ex.: mesa de madeira com velas e flores secas)."})
                cenario = cenario_em_ingles(descricao)
            elif cenario not in cena.CENAS:
                return self._json(400, {"erro": "cena inválida"})
            layout = c.get("layout", "limpa")
            if layout not in cena.LAYOUTS:
                return self._json(400, {"erro": "layout inválido"})
            foto = foto_da_requisicao(c)
            semente = c.get("semente")
            dados = dados_da_peca(c)
            if layout == "anuncio" and not dados["nome"]:
                return self._json(400, {"erro": "Falta o nome da peça para o anúncio."})
            textos = textos_anuncio(dados, c.get("vantagens") or []) if layout == "anuncio" else None
            with trava_gpu:
                img = cena.gerar(foto, cenario, int(semente) if semente is not None else None, layout, dados, textos)
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=92)
            self._json(200, {"imagem": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()})
        except ValueError as e:
            self._json(400, {"erro": str(e)})
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            self._json(503, {"erro": "o ComfyUI não está respondendo no PC da loja"})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"erro": f"falha ao gerar: {type(e).__name__}"})

    def log_message(self, fmt, *a):  # não grava a chave nem o corpo no log
        sys.stderr.write("%s %s\n" % (self.command, self.path))


if __name__ == "__main__":
    if not CHAVE:
        sys.exit("Defina LOJA_IA_KEY (use start-gateway.ps1, que lê o .env-loja).")
    print(f"Gateway da IA da loja em http://127.0.0.1:{PORTA}  (texto -> {LITELLM}, imagem -> {cena.COMFY})")
    ThreadingHTTPServer(("127.0.0.1", PORTA), H).serve_forever()
