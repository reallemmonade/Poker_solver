#!/bin/bash
# Preflop realization calibration at every depth, then the NLH flop library on the result.
#  1. Pass 1: the 17 NLH flop spots at 20, 50, 100 and 200bb (the 3-bet pots are all-in at 20bb),
#     24 flops each (72 for 3-bet pots) with per-class EVs, on the v4 charts; one realization fit
#     per depth, with 3-bet pots fitted on their own (--split 1).
#  2. Pass 2: the same spots on 6-max and heads-up cash charts rebuilt with the pass-1 fits; fit
#     again on both passes.
#  3. preflop-library-v6-calibrated.json.gz: the NLH charts at 20, 50, 100, 150 and 200bb (2-9
#     handed, cash and MTT) rebuilt with the nearest depth's fit (150bb the 200bb one); every
#     other chart (10bb push/fold, 500 and 1000bb, PLO) kept from v4 unchanged.
#  4. NLH flop libraries on the v6 ranges at 20, 50, 100 and 200bb in one bundle (spot ids carry
#     the depth, and each spot answers only its own depth's chart), then the 4- and 9-handed 100bb
#     spots, then check.cjs and verify-import.
# Every step resumes: solved flops, fits and charts already written are kept.
#   CAL_WORK=~/cal JOBS=12 THREADS=4 [DEPTH_FLOPS=100|50] bash tools/calibration/smart-calibration.sh
# EXTRA_FLOPS: flops per spot for the other 6-max 100bb lines in step 4 (default 50, which gives 56).
# DEPTH_FLOPS: flops per spot at 20, 50 and 200bb in step 4 (100 gives 104 flops, 50 gives 56);
# 100bb always gets 104. TABLE_FLOPS: the same for the 4- and 9-handed spots (default 100).
# TURN=1 also keeps the turn's first decisions for the 6-max and heads-up 100bb spots (bigger solver
# dumps; library.cjs --turn 1) and packs them per spot into flop-v6/turn-<spot>.ctl.
# $CAL_WORK must hold preflop-library-v4.json.gz; ev1/ may already hold pass-1 flops.
set -u
R=$(cd "$(dirname "$0")/../.." && pwd); W=${CAL_WORK:-$HOME/cal}
TSE=${SOLVER:-$R/tools/local-solver/TexasSolver/install/console_solver}
JOBS=${JOBS:-12}; THREADS=${THREADS:-4}; DEPTH_FLOPS=${DEPTH_FLOPS:-100}; TABLE_FLOPS=${TABLE_FLOPS:-100}; TURN=${TURN:-0}; EXTRA_FLOPS=${EXTRA_FLOPS:-50}; CHART_JOBS=${CHART_JOBS:-$(nproc)}
V4=$W/preflop-library-v4.json.gz; V6=$W/preflop-library-v6-calibrated.json.gz
export NODE_OPTIONS=--max-old-space-size=65536
cd "$R" || exit 1
[ -f "$V4" ] && [ -x "$TSE" ] || { echo "Needs $V4 and $TSE"; exit 1; }
say(){ echo "$(date -u '+%F %T') $*"; }

SINGLE=btn-bb,co-bb,utg-bb,sb-bb,co-btn,hj-btn,utg-btn,hu-srp
# 3-bet pots get their own realization fit (calibrate.cjs --split 1) and more flops: they solve
# several times faster, and a per-class fit on 24 flops a spot is mostly noise.
THREE=btn-bb-3bet,co-bb-3bet,btn-sb-3bet,sb-bb-3bet,hj-btn-3bet,co-btn-3bet,hu-3bet
SRP=$SINGLE,$THREE
LIMP=sb-bb-limp,hu-limp
# The other heads-up 6-max lines, in the 100bb flop library only (no calibration), at EXTRA_FLOPS.
EXTRA=hj-bb,btn-sb,co-sb,hj-sb,utg-sb,utg-co,hj-co,utg-hj,hj-co-3bet,co-sb-3bet,utg-hj-3bet,utg-co-3bet,hj-sb-3bet,utg-btn-3bet
at(){ # spots depth: ids at that depth (100bb ids carry no suffix)
  local out=() id; for id in ${1//,/ }; do
    if [ "$2" = 100 ]; then out+=($id); elif [ "$2" = 20 ] && [[ $id == *3bet ]]; then :; else out+=($id-$2bb); fi
  done; (IFS=,; echo "${out[*]}")
}
all(){ local d s=""; for d in 20 50 100 200; do s+=,$(at $1 $d); done; echo ${s#,}; }
solve(){ # charts out spots flops iterations [more args]
  node tools/postflop/library.cjs solve --charts $1 --out $2 --spots $3 --flops $4 --accuracy 1 --iterations $5 --jobs $JOBS --threads $THREADS --timeout 86400 --solver $TSE "${@:6}" || say "FAILED solve into $2"
}
evs(){ # charts out
  solve $1 $2 $(all $SINGLE) 24 150
  solve $1 $2 $(all $THREE) 72 150
  solve $1 $2 $(all $LIMP) 24 400
}
fit(){ # work out
  [ -f $2 ] || node tools/preflop/calibrate.cjs --work $1 --depths 20,50,100,200 --split 1 --out $2 || { say "FAILED calibrate $2"; exit 1; }
}
charts(){ # calibration dir [library.cjs args]: built charts plus every other v4 chart, bundled
  node tools/preflop/library.cjs --out $2 --games nlh --limp 1 --calibration $1 --base $V4 --jobs $CHART_JOBS "${@:3}" | grep -E "Problems|FAILED|Bundled|Kept|charts," ; [ -f $2/preflop-library.json.gz ] || { say "FAILED charts $2"; exit 1; }
}

say "PASS 1: flop solves with EVs on v4 ($JOBS solves at once, $THREADS threads each)"
evs $V4 $W/ev1
fit $W/ev1 $W/set1.json
say "PASS 1 charts"
charts $W/set1.json $W/charts1 --seats 2,6 --formats cash --depths 20,50,100,200

say "PASS 2: flop solves with EVs on the pass-1 charts"
evs $W/charts1/preflop-library.json.gz $W/ev2
fit $W/ev1,$W/ev2 $W/set2.json

say "V6: the 20-200bb NLH charts with the pass-2 fits"
charts $W/set2.json $W/charts-v6 --depths 20,50,100,150,200
[ -f $V6 ] || cp $W/charts-v6/preflop-library.json.gz $V6
node studio/build.cjs --web > /dev/null 2>&1
node studio/verify-import.cjs $V6 2>&1 | grep -E "PASS|FAIL|passed|Error" | cut -c1-300
node tools/calibration/refcheck.cjs $V4 $V6
# Gate: v6 replaces v4 in the app only if its 6-max 100bb responses to an open look like solver output.
node tools/preflop/balance-check.cjs $V6 && say "BALANCE CHECK PASSED" || say "BALANCE CHECK FAILED: do not ship v6 charts"
say "CALIBRATION DONE"

# The NLH flop libraries on the v6 ranges, as the v4 one was built: 150 iterations, then flops
# above 1.2% of the pot again at 400; limped pots at 400. 100bb first.
say "FLOP LIBRARY on v6 (20-200bb at $DEPTH_FLOPS flops, 100bb at 100)"
F=$W/flop-v6; mkdir -p $F
other(){ local d s=""; for d in 20 50 200; do s+=,$(at $1 $d); done; echo ${s#,}; }
solve $V6 $F $SRP 100 150 --turn $TURN
solve $V6 $F $LIMP 100 400 --turn $TURN
solve $V6 $F $EXTRA $EXTRA_FLOPS 150
solve $V6 $F $(other $SRP) $DEPTH_FLOPS 150
solve $V6 $F $(other $LIMP) $DEPTH_FLOPS 400
solve $V6 $F $SRP 100 400 --redo-above 1.2 --turn $TURN
solve $V6 $F $EXTRA $EXTRA_FLOPS 400 --redo-above 1.2
solve $V6 $F $(other $SRP) $DEPTH_FLOPS 400 --redo-above 1.2
# 4- and 9-handed 100bb: single-raised pots against the BB and the BTN, blind against blind, two
# 3-bet pots and the SB limp.
say "FLOP LIBRARY on v6: 4- and 9-handed 100bb at $TABLE_FLOPS flops"
T4=4max-co-bb,4max-btn-bb,4max-co-btn,4max-sb-bb,4max-btn-bb-3bet,4max-sb-bb-3bet
T9=9max-utg-bb,9max-hj-bb,9max-co-bb,9max-btn-bb,9max-utg-btn,9max-co-btn,9max-sb-bb,9max-btn-bb-3bet,9max-sb-bb-3bet
solve $V6 $F $T4,$T9 $TABLE_FLOPS 150
solve $V6 $F 4max-sb-bb-limp,9max-sb-bb-limp $TABLE_FLOPS 400
solve $V6 $F $T4,$T9 $TABLE_FLOPS 400 --redo-above 1.2
node tools/postflop/library.cjs bundle --out $F | tail -1
[ "$TURN" = 1 ] && node tools/postflop/library.cjs bundle-turn --out $F | tail -3
node tools/postflop/check.cjs --library $F/postflop-library.json.gz --charts $V6 2>&1 | grep -v "^    at" | tail -5
node studio/verify-import.cjs $V6 $F/postflop-library.json.gz 2>&1 | grep -E "PASS|FAIL|passed|Error" | cut -c1-300
say "ALL DONE"
