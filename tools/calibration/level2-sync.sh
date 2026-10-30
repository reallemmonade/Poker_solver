#!/bin/bash
# Keeps the level2.sh boxes' l2 folders in step: every 2 minutes, copies each box's new files
# (solved flops, the leader's charts and line lists) here, then everything here out to every box.
# Files are never overwritten; spot.json and *.tmp stay where they were written.
#   bash tools/calibration/level2-sync.sh <ip> <ip>...      (L2_LOCAL, default ~/l2-sync, holds the copy)
set -uo pipefail
[ $# -ge 1 ] || { sed -n 2,5p "$0"; exit 1; }
D=${L2_LOCAL:-$HOME/l2-sync}; work=/root/help/l2; mkdir -p "$D"
r(){ rsync -a --ignore-existing --include '*/' --include '*.json' --include '*.json.gz' --include '*.txt' --exclude 'spot.json' --exclude 'build-*/' --exclude 'cal*.json' --exclude '*' -e 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ServerAliveInterval=30' "$1" "$2" 2>/dev/null; }
while :; do
  for ip in "$@"; do r root@$ip:$work/ "$D/"; done
  for ip in "$@"; do ssh -o BatchMode=yes root@$ip "mkdir -p $work" 2>/dev/null; r "$D/" root@$ip:$work/; done
  sleep 120
done
