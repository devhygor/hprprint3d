// Função "frete": cota o envio no Melhor Envio sem expor o token no site.
// Segredos (Supabase > Edge Functions > Secrets):
//   MELHOR_ENVIO_TOKEN   token do Melhor Envio com a permissão "shipping-calculate"
//   MELHOR_ENVIO_EMAIL   e-mail de contato (o Melhor Envio pede no User-Agent)
//   MELHOR_ENVIO_SANDBOX "1" para usar o ambiente de testes (opcional)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const cep = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const limite = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });

  const token = Deno.env.get("MELHOR_ENVIO_TOKEN");
  if (!token) return resposta(503, { erro: "Melhor Envio não configurado" });

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return resposta(400, { erro: "corpo inválido" }); }
  const origem = cep(corpo.origem), destino = cep(corpo.destino);
  if (origem.length !== 8 || destino.length !== 8) return resposta(400, { erro: "CEP inválido" });

  // Só aceita poucos itens com medidas razoáveis (evita abuso da cota)
  const itens = (Array.isArray(corpo.produtos) ? corpo.produtos : []).slice(0, 5).map((p: Record<string, unknown>, i: number) => ({
    id: String(p.id ?? i).slice(0, 40),
    width: limite(p.width, 1, 100, 16),
    height: limite(p.height, 1, 100, 12),
    length: limite(p.length, 1, 100, 20),
    weight: limite(p.weight, 0.01, 30, 0.3),
    insurance_value: limite(p.insurance_value, 0, 3000, 20),
    quantity: Math.round(limite(p.quantity, 1, 50, 1)),
  }));
  if (!itens.length) return resposta(400, { erro: "sem produtos" });

  const base = Deno.env.get("MELHOR_ENVIO_SANDBOX") === "1" ? "https://sandbox.melhorenvio.com.br" : "https://www.melhorenvio.com.br";
  const email = Deno.env.get("MELHOR_ENVIO_EMAIL") || "contato@hprprint3d";
  let r: Response;
  try {
    r = await fetch(`${base}/api/v2/me/shipment/calculate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": `HPR Print 3D (${email})`,
      },
      body: JSON.stringify({ from: { postal_code: origem }, to: { postal_code: destino }, products: itens }),
    });
  } catch {
    return resposta(502, { erro: "Melhor Envio fora do ar" });
  }
  const dados = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(dados)) {
    const msg = r.status === 401 ? "token do Melhor Envio inválido ou vencido" : (dados?.message || `Melhor Envio respondeu ${r.status}`);
    return resposta(502, { erro: msg });
  }
  const opcoes = dados
    .filter((s: Record<string, unknown>) => !s.error && Number(s.custom_price ?? s.price) > 0)
    .map((s: any) => ({
      id: s.id,
      nome: String(s.name || "Envio"),
      empresa: String(s.company?.name || ""),
      valor: Math.round(Number(s.custom_price ?? s.price) * 100) / 100,
      prazoMin: Number(s.custom_delivery_range?.min ?? s.delivery_range?.min ?? s.custom_delivery_time ?? s.delivery_time) || null,
      prazoMax: Number(s.custom_delivery_range?.max ?? s.delivery_range?.max ?? s.custom_delivery_time ?? s.delivery_time) || null,
    }))
    .sort((a: { valor: number }, b: { valor: number }) => a.valor - b.valor)
    .slice(0, 6);
  return resposta(200, { opcoes });
});
