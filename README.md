# HPR Print 3D

Site da loja [@hprprint3d](https://www.instagram.com/hprprint3d/), hospedado no GitHub Pages.

- `index.html` — vitrine pública (lê `data/catalogo.json` e `data/site.json`)
- `admin.html` — oficina: cadastro de peças e precificador (custos ficam no repositório privado `hprprint3d-dados`)

## Como o preço é calculado (por peça)

- Filamento = gramas ÷ peso do rolo × preço do rolo
- Energia = horas × consumo (kW) × tarifa (R$/kWh)
- Desgaste = horas × R$/hora
- Reserva p/ falhas = % sobre filamento + energia + desgaste
- Mão de obra = preparo da impressão (dividido pelas peças) + minutos de acabamento × valor da hora
- \+ embalagem, acabamento, licença e outros
- Preço sugerido = (custo + tarifa fixa + frete) ÷ (1 − margem − impostos − comissão), respeitando as faixas de cada canal
