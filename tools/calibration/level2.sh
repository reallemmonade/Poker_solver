#!/bin/bash
# Level 2 pilot (tools/preflop/level2.cjs) for the 6-max 100bb cash chart, on one or more servers.
#   CAL_WORK=/root/help JOBS=3 THREADS=4 bash tools/calibration/level2.sh K N
# Box K of N (K=1 leads). Every box solves its shard of each round's flops, then helps with what is
# left; the leader alone fits and builds each round's charts. Boxes share $CAL_WORK/l2 through
# level2-sync.sh, run on one computer that reaches them all (rsync over SSH, files never overwritten).
# $CAL_WORK on the leader must hold preflop-library-v6-calibrated.json.gz, set2.json and either
# ev2/ (pass-2 flops) or l2/m0.json.gz (level2.cjs extract of them); followers need nothing.
#  Round 0: the pass-2 per-spot solves (60 flops a line on the pass-1 charts), no new solves.
#  Round 1: every 6-max 100bb flop line on the round-0 charts, FLOPS flops with --floor, so hands the
#           chart never plays a way still get a measured value there.
#  Round 2: only the lines whose ranges moved more than MOVED (level2.cjs moved); the rest keep round 1.
# Each round's charts: the last KEEP measurements per line in set2.json, the 6-max 100bb chart
# rebuilt at ITERATIONS, every other chart from v6. Final: l2/charts-final.json.gz, balance-checked
# and order-checked (order-check.cjs, the 6-max 100bb chart only).
# SET2 (default $CAL_WORK/set2.json) is the calibration the measurements go into.
# Everything resumes: solved flops, fits and charts already written are kept. LINES, FLOPS, ROUNDS,
# ITERATIONS and SOLVE_ITERATIONS shrink it for a test.
set -u
K=${1:-1}; N=${2:-1}
R=$(cd "$(dirname "$0")/../.." && pwd); W=${CAL_WORK:-$HOME/help}; L=$W/l2
TSE=${SOLVER:-$R/tools/local-solver/TexasSolver/install/console_solver}
JOBS=${JOBS:-3}; THREADS=${THREADS:-4}; FLOPS=${FLOPS:-60}; FLOOR=${FLOOR:-0.006}; KEEP=${KEEP:-2}; MOVED=${MOVED:-0.05}; ITERATIONS=${ITERATIONS:-2000}; ROUNDS=${ROUNDS:-2}; LINES=${LINES:-per-spot-6max}; SOLVE_ITERATIONS=${SOLVE_ITERATIONS:-150}
V6=${V6:-$W/preflop-library-v6-calibrated.json.gz}; SET2=${SET2:-$W/set2.json}; CHART='NLH cash 6-handed 100bb'
export NODE_OPTIONS=--max-old-space-size=16384
cd "$R" || exit 1; mkdir -p $L
say(){ echo "$(date -u '+%F %T') [$K/$N] $*"; }
wait_for(){ say "waiting for $1"; until [ -f "$1" ]; do sleep 60; done; }
solve(){ # charts out spots [more args]
  node tools/postflop/library.cjs solve --charts $1 --out $2 --spots $3 --flops $FLOPS --floor $FLOOR --accuracy 1 --iterations $SOLVE_ITERATIONS --jobs $JOBS --threads $THREADS --timeout 86400 --solver $TSE "${@:4}" || say "FAILED solve into $2"
}
# Solved flops in a round folder, and how many there should be (lines x flops).
count(){ ls $1/*/ 2>/dev/null | grep -cE '^([2-9TJQKA][cdhs]){3}\.json$'; }
want(){ echo $(( $(ls -d $1/*/ 2>/dev/null | wc -l) * $(node tools/postflop/flops.cjs $FLOPS | head -1 | cut -d' ' -f1) )); }
# Leader: wait until every flop of the round is in (synced from the other boxes), solving any that
# no box finished after an hour without progress.
complete(){ local last=-1 idle=0 c
  while c=$(count $1); [ "$c" -lt "$(want $1)" ]; do
    if [ "$c" = "$last" ]; then idle=$((idle+1)); else idle=0; last=$c; fi
    [ $idle -ge 60 ] && { say "no progress in an hour at $c/$(want $1): solving the rest here"; solve $2 $1 $3; idle=0; }
    sleep 60
  done; say "$1 complete: $c flops"; }
charts(){ # calibration out: the 6-max 100bb chart rebuilt, every other v6 chart kept
  [ -f $2 ] && return
  rm -rf $L/build-$(basename $2 .json.gz)
  node tools/preflop/library.cjs --out $L/build-$(basename $2 .json.gz) --games nlh --limp 1 --seats 6 --formats cash --depths 100 --calibration $1 --base $V6 --iterations $ITERATIONS --jobs 1 | grep -E "Problems|FAILED|Bundled|Kept|min"
  cp $L/build-$(basename $2 .json.gz)/preflop-library.json.gz $2.tmp && mv $2.tmp $2
  node tools/preflop/balance-check.cjs $2 | sed 's/^/  /'
  node tools/preflop/order-check.cjs $2 | grep "$CHART" | sed 's/^/  order: /'; }
spots(){ # round: the lines to solve
  if [ $1 = 1 ]; then echo $LINES; else node tools/preflop/level2.cjs moved --old $L/charts$(($1-2)).json.gz --new $L/charts$(($1-1)).json.gz --spots $LINES --threshold $MOVED 2>/dev/null; fi; }

if [ $K = 1 ]; then
  [ -f $L/m0.json.gz ] || node tools/preflop/level2.cjs extract --work $W/ev2 --chart "$CHART" --out $L/m0.json.gz
  node tools/preflop/level2.cjs fit --measure $L/m0.json.gz --base $SET2 --keep $KEEP --out $L/cal0.json
  charts $L/cal0.json $L/charts0.json.gz
fi
for r in $(seq 1 $ROUNDS); do
  wait_for $L/charts$((r-1)).json.gz
  if [ $K = 1 ]; then s=$(spots $r); echo "$s" > $L/spots$r.txt.tmp && mv $L/spots$r.txt.tmp $L/spots$r.txt; else wait_for $L/spots$r.txt; s=$(cat $L/spots$r.txt); fi
  [ -z "$s" ] && { say "round $r: no line moved"; [ $K = 1 ] && cp $L/charts$((r-1)).json.gz $L/charts$r.json.gz; continue; }
  say "ROUND $r: $s"
  solve $L/charts$((r-1)).json.gz $L/r$r $s --shard $K/$N
  solve $L/charts$((r-1)).json.gz $L/r$r $s --reverse 1
  if [ $K = 1 ]; then
    complete $L/r$r $L/charts$((r-1)).json.gz $s
    # Lines not re-solved this round keep their earlier measurements (fit takes the last KEEP).
    m=$L/m0.json.gz; for q in $(seq 1 $r); do m=$m,$L/r$q; done
    node tools/preflop/level2.cjs fit --measure $m --base $SET2 --keep $KEEP --out $L/cal$r.json
    charts $L/cal$r.json $L/charts$r.json.gz
  fi
done
[ $K = 1 ] && { cp $L/charts$ROUNDS.json.gz $L/charts-final.json.gz; node tools/preflop/balance-check.cjs $L/charts-final.json.gz && say "BALANCE CHECK PASSED" || say "BALANCE CHECK FAILED"
  node tools/preflop/order-check.cjs $L/charts-final.json.gz | grep -q "^ok   $CHART" && say "ORDER CHECK PASSED" || say "ORDER CHECK FAILED"; }
say "LEVEL 2 DONE"
