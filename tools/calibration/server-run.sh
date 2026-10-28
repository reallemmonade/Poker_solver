#!/bin/bash
# Runs tools/calibration/smart-calibration.sh on a rented Linux server (Ubuntu 24.04, root over SSH).
#   bash tools/calibration/server-run.sh setup  <ip>   copy the repo and inputs, install, build TexasSolver-ev
#   bash tools/calibration/server-run.sh bench  <ip> [threads]   time a 100bb, a 200bb and a 100bb-with-turn flop: seconds, peak memory
#   bash tools/calibration/server-run.sh start  <ip> [jobs threads]   start (or resume) the job in tmux
#        (DEPTH_FLOPS, TABLE_FLOPS and TURN=1 in the environment pass through to the job)
#   bash tools/calibration/server-run.sh status <ip>   progress, recent solves, load and memory
#   bash tools/calibration/server-run.sh pull   <ip>   copy the results to $LOCAL/server-results
# LOCAL (default ~/Desktop/Poker_Solver) holds preflop-library-v4.json.gz and, optionally,
# cal-work/ev1 with pass-1 100bb flops to reuse. Nothing in LOCAL is overwritten.
set -euo pipefail
cmd=${1:-}; ip=${2:-}; [ -n "$cmd" ] && [ -n "$ip" ] || { sed -n 2,10p "$0"; exit 1; }
here="$(cd "$(dirname "$0")/../.." && pwd)"; LOCAL=${LOCAL:-$HOME/Desktop/Poker_Solver}
host=root@$ip; ssh=(ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 $host)
repo=/root/poker_solver; work=/root/cal

sync_inputs(){
  "${ssh[@]}" "mkdir -p $work/ev1"
  rsync -a "$LOCAL/preflop-library-v4.json.gz" $host:$work/
  # Pass-1 100bb flops solved on this computer (same charts, flops, tree and iterations).
  [ -d "$LOCAL/cal-work/ev1" ] && rsync -a --exclude '*.tmp' "$LOCAL/cal-work/ev1/" $host:$work/ev1/ || true
}
case $cmd in
setup)
  "${ssh[@]}" "export DEBIAN_FRONTEND=noninteractive; apt-get update -q && apt-get install -yq rsync tmux nodejs wget time >/dev/null && node -v
    [ -x /usr/bin/google-chrome ] || { wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -yq /tmp/chrome.deb >/dev/null; }; mkdir -p $repo"
  git -C "$here" ls-files -z | rsync -a0 --files-from=- "$here/" $host:$repo/
  sync_inputs
  "${ssh[@]}" "bash $repo/tools/local-solver/install-linux.sh 2>&1 | tail -3" ;;
bench)
  t=${3:-4}
  for run in "btn-bb 0" "hu-srp-200bb 0" "btn-bb 1"; do set -- $run
    "${ssh[@]}" "cd $repo && rm -rf /tmp/bench && /usr/bin/time -f '$1 (turn $2): %e s, peak %M KB' node tools/postflop/library.cjs solve --charts $work/preflop-library-v4.json.gz --out /tmp/bench --spots $1 --flops 24 --iterations 150 --accuracy 1 --threads $t --limit 1 --turn $2 --solver $repo/tools/local-solver/TexasSolver/install/console_solver 2>&1 | tail -2; ls -la /tmp/bench/$1/*.turn.json 2>/dev/null | awk '{print \"turn file \" \$5/1e6 \" MB\"}'"
  done ;;
start)
  jobs=${3:-12}; threads=${4:-4}
  git -C "$here" ls-files -z | rsync -a0 --files-from=- "$here/" $host:$repo/
  sync_inputs
  "${ssh[@]}" "tmux has-session -t cal 2>/dev/null && { echo 'Already running'; exit 0; }
    tmux new -d -s cal \"CAL_WORK=$work JOBS=$jobs THREADS=$threads DEPTH_FLOPS=${DEPTH_FLOPS:-100} TABLE_FLOPS=${TABLE_FLOPS:-100} TURN=${TURN:-0} bash $repo/tools/calibration/smart-calibration.sh 2>&1 | tee -a $work/smart.log\" && echo Started: $jobs solves at once, $threads threads each" ;;
status)
  "${ssh[@]}" "cd $work; for d in ev1 ev2 flop-v6; do [ -d \$d ] && echo \"\$d: \$(ls \$d/*/ 2>/dev/null | grep -cE '^([2-9TJQKA][cdhs]){3}\.json$') flops in \$(ls -d \$d/*/ | wc -l) spots\"; done
    grep -E '^[0-9-]+ [0-9:]+ |FAILED|failed|Problems|passed|Error' smart.log | tail -8; echo; tail -4 smart.log
    echo; uptime; free -g | head -2; echo \"solvers: \$(pgrep -c console_solver), RSS GB each: \$(ps -C console_solver -o rss= | awk '{printf \"%.1f \", \$1/1048576}')\"
    tmux has-session -t cal 2>/dev/null && echo 'job: running' || echo 'job: not running'" ;;
pull)
  dest="$LOCAL/server-results"; mkdir -p "$dest"
  rsync -a --include 'preflop-library-v6-calibrated.json.gz' --include 'set1.json' --include 'set2.json' --include 'smart.log' --include 'flop-v6/' --include 'flop-v6/postflop-library.json.gz' --include 'flop-v6/turn-*.ctl' --exclude '*' $host:$work/ "$dest/"
  ls -la "$dest" ;;
*) sed -n 2,10p "$0"; exit 1 ;;
esac
