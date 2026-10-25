#!/bin/bash
# Solves the PLO postflop library on this Mac, resuming where it stopped. Keep the
# window open; closing it stops the run, and running it again resumes.
# Needs the PLO solver (tools/local-solver/install-mac.sh) and the chart library.
cd "$(dirname "$0")/../.."
charts="${CHARTS:-$HOME/Desktop/Poker_Solver/preflop-library-v3.json.gz}"
out="${OUT:-$HOME/Desktop/Poker_Solver/plo-work}"
[ -f "$charts" ] || { echo "Chart file $charts not found (set CHARTS)."; exit 1; }
caffeinate -i node tools/postflop/plo-library.cjs solve --charts "$charts" --out "$out" \
  --spots "${SPOTS:-plo-btn-bb,plo-hu-srp,plo-btn-bb-3bet,plo-co-bb,plo-sb-bb}" --flops "${FLOPS:-40}" --combos "${COMBOS:-500}" --accuracy 1 --iterations 150
node tools/postflop/plo-library.cjs bundle --out "$out"
