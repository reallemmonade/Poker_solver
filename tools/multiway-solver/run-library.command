#!/bin/bash
# Solves the 3-way flop library on this computer, resuming where it stopped. Keep the
# window open; closing it stops the run, and running it again resumes.
# Needs mw_solver (tools/local-solver/install-mac.sh --plo-only builds it).
cd "$(dirname "$0")/../.."
out="${OUT:-$HOME/Desktop/Poker_Solver/multiway-work}"
[ -x tools/multiway-solver/mw_solver ] || bash tools/local-solver/install-mac.sh --plo-only
keep=""; command -v caffeinate >/dev/null && keep="caffeinate -i"
$keep node tools/multiway-solver/library.cjs solve --out "$out" \
  --spots "${SPOTS:-btn-sb-bb,co-btn-bb,co-btn-sb-squeeze,co-btn-bb-squeeze,hj-co-bb,utg-btn-bb}" --flops "${FLOPS:-100}" --accuracy "${ACCURACY:-1}" --iterations "${ITERATIONS:-300}" --runouts "${RUNOUTS:-96}"
node tools/multiway-solver/library.cjs bundle --out "$out"
