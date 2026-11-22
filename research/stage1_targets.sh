#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data/raw/repos results/callsites
for name in $(python3 -c "import json;print(' '.join(json.load(open('targets.json'))['repos']))"); do
  url=$(python3 -c "import json;print(json.load(open('targets.json'))['repos']['$name']['url'])")
  sha=$(python3 -c "import json;print(json.load(open('targets.json'))['repos']['$name']['sha'])")
  scan=$(python3 -c "import json;print(json.load(open('targets.json'))['repos']['$name']['scan'])")
  dir=data/raw/repos/$name
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir" && git -C "$dir" remote add origin "$url"
    git -C "$dir" fetch -q --depth 1 origin "$sha" && git -C "$dir" checkout -q FETCH_HEAD
  fi
  test "$(git -C "$dir" rev-parse HEAD)" = "$sha"
  mkdir -p data/raw/scan/$name && rm -rf data/raw/scan/$name/*
  for s in $scan; do mkdir -p "data/raw/scan/$name/$(dirname "$s")" && cp -R "$dir/$s" "data/raw/scan/$name/$s"; done
  ../node_modules/.bin/jiti callsites/extract.ts "data/raw/scan/$name" "results/callsites/$name.json" "$name@${sha:0:7}"
done
