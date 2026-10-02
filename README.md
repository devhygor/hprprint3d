# HPR Print 3D

Site da loja [@hprprint3d](https://www.instagram.com/hprprint3d/), hospedado no GitHub Pages.

- `index.html` — vitrine pública (lê `data/catalogo.json` e `data/site.json`)
- `admin.html` — oficina: pedidos, cadastro de peças e precificador (custos ficam no repositório privado `hprprint3d-dados`)
- Pedidos ficam no Supabase (`docs/supabase.sql` cria a tabela e as regras). `.github/workflows/manter-supabase.yml` evita que o projeto gratuito pause

## Como o preço é calculado (por peça)

- Filamento = gramas ÷ peso do rolo × preço do rolo
- Energia = horas × consumo (kW) × tarifa (R$/kWh)
- Desgaste = horas × R$/hora
- Reserva p/ falhas = % sobre filamento + energia + desgaste
- Mão de obra = preparo da impressão (dividido pelas peças) + minutos de acabamento × valor da hora
- \+ embalagem, acabamento, licença e outros
- Preço sugerido = (custo + tarifa fixa + frete) ÷ (1 − margem − impostos − comissão), respeitando as faixas de cada canal
