// Função "ia-imagem": gera a foto de vitrine de uma peça (recorte da peça + cenário no padrão da loja)
// no PC da loja, pelo mesmo túnel da função "ia". Só a equipe (logada na Oficina) pode usar.
// Usa os segredos IA_PC_URL (termina em /v1) e IA_PC_KEY já cadastrados para a função "ia".
// Não existe reserva na nuvem: imagem só sai com o PC ligado (ComfyUI + gateway).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quem } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const email = quem?.user?.email?.toLowerCase();
  if (!email) return resposta(401, { erro: "Entre na Oficina para gerar fotos." });
  const { data: equipe } = await admin.from("equipe").select("email").ilike("email", email).maybeSingle();
  if (!equipe) return resposta(403, { erro: "Só a equipe pode gerar fotos." });

  const urlPc = (Deno.env.get("IA_PC_URL") || "").replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const chavePc = Deno.env.get("IA_PC_KEY") || "";
  if (!urlPc) return resposta(503, { erro: "O PC da loja ainda não foi configurado (segredo IA_PC_URL)." });

  let c: any;
  try { c = await req.json(); } catch { return resposta(400, { erro: "corpo inválido" }); }
  const cena = ["madeira", "bandeja", "natal"].includes(c.cena) ? c.cena : "madeira";
  const corpo: Record<string, unknown> = { cena };
  if (typeof c.foto_base64 === "string" && c.foto_base64.length < 12_000_000) corpo.foto_base64 = c.foto_base64;
  else if (typeof c.foto_url === "string") corpo.foto_url = c.foto_url;
  else return resposta(400, { erro: "Falta a foto." });
  if (Number.isInteger(c.semente)) corpo.semente = c.semente;

  try {
    const r = await fetch(`${urlPc}/imagem`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chavePc}` },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(140_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.imagem) {
      return resposta(r.status === 404 ? 503 : r.status || 502, { erro: j.erro || (r.status === 404 ? "O PC da loja está desligado ou o túnel caiu." : `O PC respondeu ${r.status}.`) });
    }
    return resposta(200, { imagem: j.imagem });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError";
    return resposta(503, { erro: timeout ? "A geração demorou demais. Tente de novo." : "Não consegui falar com o PC da loja (desligado ou sem rede)." });
  }
});
