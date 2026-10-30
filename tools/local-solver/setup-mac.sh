#!/bin/bash
# One-step setup of the Citrus Poker solver on a Mac, for anyone. Paste in Terminal:
#   curl -fsSL https://raw.githubusercontent.com/reallemmonade/Poker_solver/main/tools/local-solver/setup-mac.sh | bash
# It downloads the app's solver files into ~/CitrusPokerSolver, builds the solvers (TexasSolver for NLH, about 10
# minutes the first time; the PLO solver in seconds), and starts the bridge as a background login item so it keeps
# running after Terminal closes and comes back after a restart. Running it again updates the files, rebuilds only
# what is missing and restarts the bridge. A Mac already set up by hand with ~/RangeLab-bridge is updated in place.
# Flops it learns while idle (learn.cjs) are kept in <folder>/learned and survive updates.
# Then open the app on this Mac, sign in, and set Solver settings -> Solver on your Mac to On; phones signed in to
# the same account can then send it spots.
set -euo pipefail
REPO=reallemmonade/Poker_solver BRANCH=${CITRUS_BRANCH:-main}
say(){ printf '\n\033[1m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }
[ "$(uname)" = Darwin ] || fail "This setup is for macOS. On Linux, see tools/local-solver/README.md (install-linux.sh)."

# The older hand-made setup keeps its folder and login item; everyone else gets the standard ones.
if [ -f "$HOME/Library/LaunchAgents/com.rangelab.local-solver.plist" ] && [ -d "$HOME/RangeLab-bridge" ]; then
  dir="$HOME/RangeLab-bridge" label=com.rangelab.local-solver
else
  dir="${CITRUS_SOLVER_DIR:-$HOME/CitrusPokerSolver}" label=com.citruspoker.solver
fi
plist="$HOME/Library/LaunchAgents/$label.plist" log="$HOME/Library/Logs/citrus-poker-solver.log"

say "1/4 Checking what this Mac needs"
xcode-select -p >/dev/null 2>&1 || { xcode-select --install >/dev/null 2>&1 || true; fail "Install Apple's command-line tools in the window that just opened, then paste the command again."; }
brew=""; for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && { brew="$b"; break; }; done
[ -n "$brew" ] || fail "Install Homebrew first (it fetches cmake and libomp for TexasSolver): paste the command from https://brew.sh, then paste this one again."
node="$(command -v node || true)"
if [ -z "$node" ] || [ "$("$node" -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then echo "Installing Node.js with Homebrew..."; "$brew" install node; node="$("$brew" --prefix)/bin/node"; fi
echo "Command-line tools, Homebrew and Node $("$node" -v) are ready."

say "2/4 Downloading the solver files into $dir"
mkdir -p "$dir"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$BRANCH" -o "$tmp/src.tgz"
# Only the app's code and the solver folders; built solvers already in $dir stay.
tar -xzf "$tmp/src.tgz" -C "$tmp"
src="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -1)"
for part in studio river tools/local-solver tools/plo-solver tools/multiway-solver tools/postflop tools/preflop; do mkdir -p "$dir/$part"; cp -R "$src/$part/." "$dir/$part/"; done

say "3/4 Building the solvers"
if [ -x "$dir/tools/local-solver/TexasSolver/install/console_solver" ] && [ -x "$dir/tools/plo-solver/plo_solver" ]; then
  echo "TexasSolver is already built. (Delete $dir/tools/local-solver/TexasSolver to rebuild it.) Rebuilding the PLO and 3-way solvers..."
  PATH="$(dirname "$brew"):$PATH" bash "$dir/tools/local-solver/install-mac.sh" --plo-only
else
  echo "This takes about 10 minutes the first time."
  PATH="$(dirname "$brew"):$PATH" bash "$dir/tools/local-solver/install-mac.sh"
fi

say "4/4 Starting the solver in the background"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
if [ "$label" = com.citruspoker.solver ]; then
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>$label</string>
 <key>ProgramArguments</key><array><string>$node</string><string>$dir/tools/local-solver/server.cjs</string></array>
 <key>WorkingDirectory</key><string>$dir</string>
 <key>RunAtLoad</key><true/>
 <key>KeepAlive</key><true/>
 <key>AbandonProcessGroup</key><true/>
 <key>StandardOutPath</key><string>$log</string>
 <key>StandardErrorPath</key><string>$log</string>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
else
  # Not loaded right now (unloaded by hand, or never started): load it instead.
  launchctl kickstart -k "gui/$(id -u)/$label" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$plist"
fi
health=""; for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 1; health="$(curl -fs http://127.0.0.1:8787/health || true)"; [ -n "$health" ] && break; done
[ -n "$health" ] || fail "The solver did not start. Its log is $log"
echo "$health"
say "Done. The solver runs in the background and starts with your Mac."
echo "Last step: open Citrus Poker on this Mac, sign in, and set Settings -> Solver settings -> Solver on your Mac to On."
echo "Phones signed in to the same account then send spots here. Log: $log"
