#!/bin/sh
# Marca os arquivos .js e .css das páginas com uma versão nova (?v=...),
# para o navegador não ficar usando a versão antiga guardada em cache.
# Rode antes de cada commit: sh scripts/versao.sh
V=$(date +%Y%m%d%H%M)
for f in *.html; do
  sed -i -E "s#(assets/[A-Za-z0-9_.-]+\.(js|css))(\?v=[0-9]+)?\"#\1?v=$V\"#g" "$f"
done
echo "versão $V"
