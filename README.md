# HPR Print 3D

Site da loja [@hprprint3d](https://www.instagram.com/hprprint3d/), hospedado no GitHub Pages.

- `index.html` — vitrine pública (lê peças e dados da loja do Supabase)
- `admin.html` — oficina: pedidos, peças, precificador, custos e dados da loja. Login por e-mail e senha do Supabase
- Todos os dados ficam no Supabase. `docs/supabase.sql` cria tabelas, regras de segurança (RLS) e o armazenamento de fotos
- `data/*.json` são só reserva caso o Supabase não responda
- `.github/workflows/manter-supabase.yml` evita que o projeto gratuito pause

## Como o preço é calculado (por peça)

- Filamento = gramas ÷ peso do rolo × preço do rolo
- Energia = horas × consumo (kW) × tarifa (R$/kWh)
- Desgaste = horas × R$/hora
- Reserva p/ falhas = % sobre filamento + energia + desgaste
- Mão de obra = preparo da impressão (dividido pelas peças) + minutos de acabamento × valor da hora
- \+ embalagem, acabamento, licença e outros
- Preço sugerido = (custo + tarifa fixa + frete) ÷ (1 − margem − impostos − comissão), respeitando as faixas de cada canal
