#!/bin/bash
# Helper servers for a smart-calibration.sh run on this computer (Ubuntu 24.04, root over SSH).
# Each server runs smart-helper.sh on shard K of N; `sync` keeps copying their solved flops into
# this computer's work folders, and this computer's solved flops and charts out to them.
#   bash tools/calibration/helpers.sh setup  <ip>          copy the repo and the v4 charts, build TexasSolver-ev
#   bash tools/calibration/helpers.sh start  <ip> <K> <N> [jobs threads]   start shard K of N in tmux
#        (DEPTH_FLOPS, TABLE_FLOPS, EXTRA_FLOPS and TURN=1 in the environment pass through)
#   bash tools/calibration/helpers.sh sync   <ip>...       every 2 minutes until stopped
#   bash tools/calibration/helpers.sh status <ip>          recent solves, load and memory
# CAL_WORK (default ~/cal) is this computer's smart-calibration.sh work folder.
set -uo pipefail
cmd=${1:-}; [ -n "$cmd" ] && [ -n "${2:-}" ] || { sed -n 2,10p "$0"; exit 1; }
here="$(cd "$(dirname "$0")/../.." && pwd)"; W=${CAL_WORK:-$HOME/cal}
repo=/root/poker_solver; work=/root/help
ssh(){ command ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o BatchMode=yes root@"$@"; }
code(){ git -C "$here" ls-files -z | rsync -a0 --files-from=- "$here/" root@$1:$repo/; }
# Solved flops only: spot.json is written by each run itself, *.tmp are being written.
flops(){ rsync -a --ignore-existing --include '*/' --include '*.json' --include '*.turn.json.gz' --exclude 'spot.json' --exclude '*' "$1" "$2" 2>/dev/null; }
pull(){ local d; for d in ev1 ev2 flop-v6; do flops root@$1:$work/$d/ "$W/$d/"; done; }
# Charts go out only once this run has moved past writing them: charts1 when pass 2 has started
# (ev2/ exists), v6 once its flop library has (flop-v6/ exists).
push(){ local d
  for d in ev1 ev2 flop-v6; do [ -d "$W/$d" ] && ssh $1 "mkdir -p $work/$d" && flops "$W/$d/" root@$1:$work/$d/; done
  [ -d "$W/ev2" ] && [ -f "$W/charts1/preflop-library.json.gz" ] && rsync -a --ignore-existing "$W/charts1/preflop-library.json.gz" root@$1:$work/charts1/
  [ -d "$W/flop-v6" ] && [ -f "$W/preflop-library-v6-calibrated.json.gz" ] && rsync -a --ignore-existing "$W/preflop-library-v6-calibrated.json.gz" root@$1:$work/
  return 0; }
case $cmd in
setup) ip=$2
  ssh $ip "export DEBIAN_FRONTEND=noninteractive; apt-get update -q >/dev/null && apt-get install -yq rsync tmux nodejs >/dev/null && node -v && mkdir -p $repo $work/charts1"
  code $ip && rsync -a "$W/preflop-library-v4.json.gz" root@$ip:$work/
  ssh $ip "bash $repo/tools/local-solver/install-linux.sh 2>&1 | tail -3; ls -la $repo/tools/local-solver/TexasSolver/install/console_solver" ;;
start) ip=$2; k=$3; n=$4; jobs=${5:-4}; threads=${6:-4}
  code $ip; push $ip
  ssh $ip "tmux has-session -t help 2>/dev/null && { echo 'Already running'; exit 0; }
    tmux new -d -s help \"CAL_WORK=$work JOBS=$jobs THREADS=$threads DEPTH_FLOPS=${DEPTH_FLOPS:-100} TABLE_FLOPS=${TABLE_FLOPS:-100} EXTRA_FLOPS=${EXTRA_FLOPS:-50} TURN=${TURN:-0} bash $repo/tools/calibration/smart-helper.sh $k $n 2>&1 | tee -a $work/helper.log\" && echo Started shard $k/$n: $jobs solves at once, $threads threads each" ;;
sync) shift
  while :; do for ip in "$@"; do pull $ip; push $ip; done; sleep 120; done ;;
status) ip=$2
  ssh $ip "grep -E '^[0-9-]+ [0-9:]+ |FAILED|failed' $work/helper.log | tail -4; tail -5 $work/helper.log; uptime; free -g | head -2" ;;
*) sed -n 2,10p "$0"; exit 1 ;;
esac
