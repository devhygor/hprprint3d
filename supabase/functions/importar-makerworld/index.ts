// Função "importar-makerworld": recebe o link de um modelo do MakerWorld, lê os dados públicos dele
// (nome, descrição, fotos, filamento, gramas, tempo de impressão) e guarda cópias das fotos
// no armazenamento "fotos" do Supabase. Só a equipe (logada na Oficina) pode usar.
// O MakerWorld não publica as medidas da peça: essas o cadastro continua pedindo à mão.
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
const MAX_FOTOS = 6;

const texto = (html: string) =>
  String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const tipoPorExtensao = (url: string) => {
  const e = (url.split("?")[0].match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  return e === "png" ? "image/png" : e === "webp" ? "image/webp" : e === "avif" ? "image/avif" : "image/jpeg";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quem } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const email = quem?.user?.email?.toLowerCase();
  if (!email) return resposta(401, { erro: "Entre na Oficina para importar." });
  const { data: equipe } = await admin.from("equipe").select("email").ilike("email", email).maybeSingle();
  if (!equipe) return resposta(403, { erro: "Só a equipe pode importar." });

  let corpo: { url?: string };
  try { corpo = await req.json(); } catch { return resposta(400, { erro: "corpo inválido" }); }
  const link = String(corpo.url || "").trim();
  const id = link.match(/^https:\/\/(?:www\.)?makerworld\.com\/(?:[a-z]{2}(?:-[A-Za-z]+)?\/)?models\/(\d+)/i)?.[1];
  if (!id) return resposta(400, { erro: "Cole o link de um modelo do MakerWorld (makerworld.com/.../models/123456)." });

  let d: any;
  try {
    const r = await fetch(`https://makerworld.com/api/v1/design-service/design/${id}`, {
      headers: { "User-Agent": NAVEGADOR, Accept: "application/json" },
    });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("json")) return resposta(502, { erro: "O MakerWorld bloqueou a consulta agora. Tente de novo em instantes ou preencha à mão." });
    d = await r.json();
  } catch {
    return resposta(502, { erro: "Não consegui falar com o MakerWorld." });
  }
  if (!d?.id) return resposta(404, { erro: "Modelo não encontrado no MakerWorld (ou é privado)." });

  // Perfil de impressão: o padrão do modelo, senão o primeiro
  const perfis: any[] = Array.isArray(d.instances) ? d.instances : [];
  const perfil = perfis.find((i) => i.id === d.defaultInstanceId) || perfis[0] || null;
  const filamentos = ((perfil?.instanceFilaments as any[]) || []).map((f) => ({
    tipo: String(f.type || ""), cor: String(f.color || ""), gramas: Number(f.usedG) || 0,
  }));
  const placas = perfil?.extention?.modelInfo?.plates?.length || 1;

  // Fotos: as do modelo (a capa primeiro), sem repetir
  const origens: string[] = [];
  for (const u of [d.coverUrl, ...((d.designExtension?.design_pictures as any[]) || []).map((p) => p.url)]) {
    if (u && /^https:\/\//.test(u) && !origens.includes(u)) origens.push(u);
  }
  const fotos: string[] = [];
  for (const u of origens.slice(0, MAX_FOTOS)) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": NAVEGADOR, Accept: "image/*" } });
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) continue;
      let tipo = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!tipo.startsWith("image/")) tipo = tipoPorExtensao(u);
      const ext = tipo.includes("png") ? "png" : tipo.includes("webp") ? "webp" : tipo.includes("avif") ? "avif" : "jpg";
      const caminho = `pecas/importadas/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error } = await admin.storage.from("fotos").upload(caminho, bytes, { contentType: tipo, upsert: false, cacheControl: "31536000" });
      if (!error) fotos.push(admin.storage.from("fotos").getPublicUrl(caminho).data.publicUrl);
    } catch { /* pula a foto que falhar */ }
  }

  return resposta(200, {
    id: String(d.id),
    nome: String(d.titleTranslated || d.title || "").trim(),
    descricaoOriginal: texto(d.summaryTranslated || d.summary),
    categoria: (d.categories?.[0]?.name as string) || "",
    tags: ((d.tags as string[]) || []).slice(0, 8),
    licenca: String(d.license || ""),
    autor: String(d.designCreator?.name || ""),
    perfil: perfil ? String(perfil.title || "") : "",
    gramas: Number(perfil?.weight) || filamentos.reduce((s, f) => s + f.gramas, 0) || 0,
    segundos: Number(perfil?.prediction) || 0,
    placas,
    filamentos,
    fotos,
  });
});
