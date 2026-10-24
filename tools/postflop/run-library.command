#!/bin/bash
# Solves the postflop library on this Mac, resuming where it stopped. Keep the
# window open; closing it stops the run, and running it again resumes.
# Needs TexasSolver (tools/local-solver/install-mac.sh) and the chart library.
cd "$(dirname "$0")/../.."
charts="${CHARTS:-tools/postflop/charts-100bb.json.gz}"
out="${OUT:-$HOME/Desktop/Poker_Solver/postflop-work}"
[ -f "$charts" ] || { echo "Chart file $charts not found (set CHARTS)."; exit 1; }
caffeinate -i node tools/postflop/library.cjs solve --charts "$charts" --out "$out" \
  --spots "${SPOTS:-btn-bb,co-bb,sb-bb,btn-bb-3bet,hu-srp,utg-bb}" --flops "${FLOPS:-100}" --accuracy 1 --iterations 150
node tools/postflop/library.cjs bundle --out "$out"
