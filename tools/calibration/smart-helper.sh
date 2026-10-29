#!/bin/bash
# Runs on a helper server next to a smart-calibration.sh run on another computer: the same solves
# in the same work folders, but only shard K of N (library.cjs --shard K/N) and from the last flop
# back (--reverse 1), so the main run going forward meets the helpers in the middle. The main
# computer copies the results into its own folders (helpers.sh sync), where library.cjs skips them,
# and copies its solved flops, pass-1 charts and v6 charts here, so helpers skip what it has done.
#   CAL_WORK=/root/help JOBS=3 THREADS=4 DEPTH_FLOPS=50 TABLE_FLOPS=50 TURN=1 bash tools/calibration/smart-helper.sh K N
# Keep the spot lists and flop counts in step with smart-calibration.sh.
set -u
K=$1; N=$2
R=$(cd "$(dirname "$0")/../.." && pwd); W=${CAL_WORK:-$HOME/help}
TSE=${SOLVER:-$R/tools/local-solver/TexasSolver/install/console_solver}
JOBS=${JOBS:-3}; THREADS=${THREADS:-4}; DEPTH_FLOPS=${DEPTH_FLOPS:-100}; TABLE_FLOPS=${TABLE_FLOPS:-100}; TURN=${TURN:-0}; EXTRA_FLOPS=${EXTRA_FLOPS:-50}
V4=$W/preflop-library-v4.json.gz; C1=$W/charts1/preflop-library.json.gz; V6=$W/preflop-library-v6-calibrated.json.gz
cd "$R" || exit 1
say(){ echo "$(date -u '+%F %T') $*"; }
wait_for(){ say "waiting for $1"; until [ -f "$1" ]; do sleep 60; done; sleep 30; }

SINGLE=btn-bb,co-bb,utg-bb,sb-bb,co-btn,hj-btn,utg-btn,hu-srp
THREE=btn-bb-3bet,co-bb-3bet,btn-sb-3bet,sb-bb-3bet,hj-btn-3bet,co-btn-3bet,hu-3bet
SRP=$SINGLE,$THREE
LIMP=sb-bb-limp,hu-limp
EXTRA=hj-bb,btn-sb,co-sb,hj-sb,utg-sb,utg-co,hj-co,utg-hj,hj-co-3bet,co-sb-3bet,utg-hj-3bet,utg-co-3bet,hj-sb-3bet,utg-btn-3bet
T4=4max-co-bb,4max-btn-bb,4max-co-btn,4max-sb-bb,4max-btn-bb-3bet,4max-sb-bb-3bet
T9=9max-utg-bb,9max-hj-bb,9max-co-bb,9max-btn-bb,9max-utg-btn,9max-co-btn,9max-sb-bb,9max-btn-bb-3bet,9max-sb-bb-3bet
at(){ local out=() id; for id in ${1//,/ }; do
    if [ "$2" = 100 ]; then out+=($id); elif [ "$2" = 20 ] && [[ $id == *3bet ]]; then :; else out+=($id-$2bb); fi
  done; (IFS=,; echo "${out[*]}"); }
all(){ local d s=""; for d in 20 50 100 200; do s+=,$(at $1 $d); done; echo ${s#,}; }
other(){ local d s=""; for d in 20 50 200; do s+=,$(at $1 $d); done; echo ${s#,}; }
solve(){ # charts out spots flops iterations [more args]
  node tools/postflop/library.cjs solve --charts $1 --out $2 --spots $3 --flops $4 --accuracy 1 --iterations $5 --jobs $JOBS --threads $THREADS --timeout 86400 --solver $TSE --shard $K/$N --reverse 1 "${@:6}" || say "FAILED solve into $2"
}
evs(){ # the main run's order backwards
  solve $1 $2 $(all $LIMP) 24 200
  solve $1 $2 $(all $THREE) 72 150
  solve $1 $2 $(all $SINGLE) 24 150
}

say "HELPER $K/$N: pass 1"
evs $V4 $W/ev1
wait_for $C1
say "HELPER $K/$N: pass 2"
evs $C1 $W/ev2
wait_for $V6
say "HELPER $K/$N: flop library on v6"
F=$W/flop-v6; mkdir -p $F
solve $V6 $F 4max-sb-bb-limp,9max-sb-bb-limp $TABLE_FLOPS 400
solve $V6 $F $T4,$T9 $TABLE_FLOPS 150
solve $V6 $F $(other $LIMP) $DEPTH_FLOPS 400
solve $V6 $F $(other $SRP) $DEPTH_FLOPS 150
solve $V6 $F $EXTRA $EXTRA_FLOPS 150
solve $V6 $F $LIMP 100 400 --turn $TURN
solve $V6 $F $SRP 100 150 --turn $TURN
solve $V6 $F $T4,$T9 $TABLE_FLOPS 400 --redo-above 1.2
solve $V6 $F $(other $SRP) $DEPTH_FLOPS 400 --redo-above 1.2
solve $V6 $F $EXTRA $EXTRA_FLOPS 400 --redo-above 1.2
solve $V6 $F $SRP 100 400 --redo-above 1.2 --turn $TURN
say "HELPER $K/$N DONE"
