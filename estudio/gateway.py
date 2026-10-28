#!/usr/bin/env python3
"""Porta de entrada da IA da loja (porta 4300), a única que o túnel (ngrok) mostra para a internet.

  /v1/*     -> proxy LiteLLM (127.0.0.1:4200): texto, descrição das peças
  /imagem   -> estudio/cena.py: foto de vitrine (recorte da peça + cenário no ComfyUI)
  /saude    -> diz se o ComfyUI está no ar

Tudo exige "Authorization: Bearer <LOJA_IA_KEY>" (a chave fica em .env-loja, fora do git).
Só escuta em 127.0.0.1; quem chega de fora é o ngrok.
"""
import base64, io, json, os, sys, threading, urllib.error, urllib.request
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
CENAS = {"madeira", "bandeja", "natal"}
trava_gpu = threading.Lock()  # uma imagem por vez: a placa é uma só


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
            if cenario not in CENAS:
                return self._json(400, {"erro": "cena inválida"})
            foto = foto_da_requisicao(c)
            semente = c.get("semente")
            with trava_gpu:
                img = cena.gerar(foto, cenario, int(semente) if semente is not None else None)
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
