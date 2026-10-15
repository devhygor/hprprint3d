// Função "importar-foto": baixa uma imagem de fora (link da imagem ou link de post do Instagram)
// e guarda uma cópia no armazenamento "fotos" do Supabase, onde o link não expira.
// Só a equipe (logada na Oficina) pode usar.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const MAX_BYTES = 12 * 1024 * 1024;

const decodificar = (t: string) => t.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"');

// Link de post/reel do Instagram -> link da imagem (og:image)
async function imagemDoPost(codigo: string): Promise<string> {
  const tentativas: Array<[string, string]> = [
    [`https://www.instagram.com/p/${codigo}/`, "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    [`https://www.instagram.com/p/${codigo}/embed/captioned/`, NAVEGADOR],
  ];
  for (const [url, ua] of tentativas) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": ua, "Accept-Language": "pt-BR,pt;q=0.9" }, redirect: "follow" });
      if (!r.ok) continue;
      const html = await r.text();
      const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      if (og) return decodificar(og[1]);
      const emb = html.match(/class=["']EmbeddedMediaImage["'][^>]+src=["']([^"']+)["']/i) ||
        html.match(/<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]*src=["']([^"']+)["']/i);
      if (emb) return decodificar(emb[1]);
    } catch { /* tenta a próxima */ }
  }
  throw new Error("Não consegui ler esse post do Instagram. Confira se o perfil é público ou use o link da imagem.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Confere se quem chamou é da equipe
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quem } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const email = quem?.user?.email?.toLowerCase();
  if (!email) return resposta(401, { erro: "Entre na Oficina para importar fotos." });
  const { data: equipe } = await admin.from("equipe").select("email").ilike("email", email).maybeSingle();
  if (!equipe) return resposta(403, { erro: "Só a equipe pode importar fotos." });

  let corpo: { url?: string };
  try { corpo = await req.json(); } catch { return resposta(400, { erro: "corpo inválido" }); }
  const entrada = String(corpo.url || "").trim();
  if (!/^https:\/\/\S+$/i.test(entrada)) return resposta(400, { erro: "Mande um link começando com https://" });

  let urlImagem = entrada;
  const post = entrada.match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  try {
    if (post) urlImagem = await imagemDoPost(post[1]);
  } catch (e) {
    return resposta(422, { erro: (e as Error).message });
  }

  let r: Response;
  try {
    r = await fetch(urlImagem, { headers: { "User-Agent": NAVEGADOR, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" }, redirect: "follow" });
  } catch {
    return resposta(502, { erro: "Não consegui baixar a imagem." });
  }
  const tipo = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (r.status === 403 || r.status === 410 || /URL signature expired/i.test(r.statusText)) {
    return resposta(410, { erro: "Esse link de imagem já expirou. Use o link do post do Instagram ou envie a foto do celular." });
  }
  if (!r.ok || !tipo.startsWith("image/")) {
    return resposta(422, { erro: r.ok ? "Esse link não é de uma imagem." : `A imagem não abriu (erro ${r.status}). O link pode ter expirado.` });
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return resposta(413, { erro: "Imagem grande demais (máximo 12 MB)." });

  const ext = tipo.includes("png") ? "png" : tipo.includes("webp") ? "webp" : tipo.includes("avif") ? "avif" : "jpg";
  const caminho = `pecas/importadas/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await admin.storage.from("fotos").upload(caminho, bytes, { contentType: tipo, upsert: false, cacheControl: "31536000" });
  if (error) return resposta(500, { erro: "Não consegui guardar a imagem: " + error.message });
  const { data } = admin.storage.from("fotos").getPublicUrl(caminho);
  return resposta(200, { url: data.publicUrl, origem: urlImagem });
});
