# Local postflop solvers (TexasSolver for NLH, mw_solver for 3-way NLH, plo_solver for PLO)

Heads-up postflop spots that are too large for the in-browser exact solver can be solved on your own computer:

- **No-limit Hold'em** goes to [TexasSolver](https://github.com/bupticybee/TexasSolver).
- **Three-way no-limit Hold'em** goes to this project's own 3-way solver, `tools/multiway-solver/mw_solver` ([README](../multiway-solver/README.md)).
- **Pot-limit Omaha** (4 cards, high only) goes to this project's own solver, `tools/plo-solver/plo_solver`.

In the app, set **Analysis inputs & accuracy → Solver on your Mac** to **On**. That one setting turns on both solvers through the same bridge. The app remembers the setting and says under it whether the bridge is running. While it is not running, the app offers no solve for flops and turns; it is checked again when you come back to the app.

## Setup (Mac)

**One step:** paste this in Terminal. It checks for Apple's command-line tools, Homebrew and Node (and installs Node), downloads the solver files into `~/CitrusPokerSolver`, builds both solvers, and starts the bridge as a login item that keeps running in the background. Running it again updates everything.

```
curl -fsSL https://raw.githubusercontent.com/reallemmonade/Poker_solver/main/tools/local-solver/setup-mac.sh | bash
```

Then open the app on that Mac, sign in, and set **Solver settings → Solver on your Mac** to **On**. The app shows the same steps under that setting. The manual steps are below.


1. Install the Xcode command-line tools (`xcode-select --install`), [Homebrew](https://brew.sh) and Node (`brew install node`).
2. Build the solvers: `bash tools/local-solver/install-mac.sh`.
   - It first compiles the PLO solver and the 3-way solver with the system `c++` (`-O3 -std=c++17 -pthread`, plus `-mcpu=native` or `-march=native` when the compiler supports it) and runs a small test solve.
     - It needs no Homebrew packages.
     - In a terminal running under Rosetta on Apple silicon, it builds for arm64 anyway.
     - `--plo-only` stops after this step (both solvers), and that also works on Linux.
   - It then downloads TexasSolver's console branch at a pinned commit, plus `cmake` and `libomp` from Homebrew.
   - It builds TexasSolver and runs a small test solve. If Homebrew is missing or is an Intel copy on Apple silicon, it gets cmake from a private Python venv and libomp from `$LIBOMP_PREFIX` or a conda install (`conda install llvm-openmp`).
3. Start the bridge: double-click `tools/local-solver/start.command`, or run `node tools/local-solver/server.cjs`. Keep the window open while you study.

The bridge listens on `127.0.0.1:8787` only. It accepts requests from `https://range-lab-poker-studio.onrender.com` and from `localhost` pages. To allow other origins, set `RANGE_LAB_ORIGINS` (comma-separated). A copy of the app opened from a file sends the origin `null`. Sandboxed frames on any website send it too, so it is not allowed unless you list `null` there. It runs one solve at a time, for either game.

Options:

| Option | Default |
| --- | --- |
| `--threads N` | all cores but one |
| `--port` | 8787 |
| `--timeout` | 1800 seconds per solve |
| `--memory MB` | 70% of this computer's memory (PLO and 3-way solver limit) |
| `--solver` | path to TexasSolver's `console_solver` |
| `--plo-solver` | `tools/plo-solver/plo_solver` |
| `--mw-solver` | `tools/multiway-solver/mw_solver` |

## NLH: what TexasSolver solves

- **Spot:** the current street onward, for the two players left in the hand. Ranges are the app's ranges, averaged per hand class so TexasSolver can use suit isomorphism.
- **Bet tree:** one bet size per street (flop 33%, turn 66%, river 75% of pot) and all-in, plus a 66% raise on the flop. Turn and river raises are all-in only, and there are no donk bets. Any bet committing more than two thirds of the stack becomes all-in. The sizes actually used on the current street are added so the real line exists in the tree.
- **Stopping rule:** the solve stops at 1% exploitability (in percent of the pot) or 200 iterations.
- **Not reported:** TexasSolver doesn't report action EVs, so these results show frequencies and are never used for grades.

## PLO: what plo_solver solves

**Spot.** The current street onward (flop, turn or river) for the two players left in the hand, at any table size. Folded players' cards are ignored, as in the NLH path. The app sends heads-up PLO spots here when both players have explicit ranges, for example combos sampled from an imported preflop chart. River spots on a two-seat table with at most 300 combos a side still solve in the browser.

**Ranges.** These are exact weighted 4-card combos, scaled so the largest weight is 1. Your own combo is always included, at weight 0.005 if the range left it out.

**Bet tree** (pot limit):
- **Bets:** one size per street, a fraction of the pot: flop 33%, turn 66%, river 75%.
- **Raises:** pot-sized raises only; a raise size of 1 means "raise pot".
- **Raise caps:** at most 2 raises on the flop and 3 on the turn and river.
- **Large bets:** a bet or raise that would commit more than 67% of the stack becomes the largest legal amount. That is all-in when all-in fits under the pot limit, and a pot-sized bet otherwise.
- **Limits:** the pot limit and the 1bb minimum are enforced.
- **The real line:** the exact amounts already bet on the current street are added at their nodes, so the real line is always in the tree.
- **Memory:** if the tree would not fit the memory limit, the solver lowers the raise caps (river first) and says so. On deep flops this saves little, because pot raises reach all-in quickly (see below).

**Chance.** Every turn and river card is enumerated exactly; nothing is sampled. Suit isomorphism is used when a suit swap leaves the board and both weighted ranges unchanged, and it is exact.
- On a monotone or two-tone board, about two thirds of the turn branches are mirrored.
- Systematic samples from a chart are usually not suit-symmetric, so expect no isomorphism unless whole suit-orbits are sampled together.
- The output reports the number of symmetries used (`suitSymmetries`).

**Algorithm.** Discounted CFR (α 1.5, β 0, γ 2) with alternating updates, in vector form over all combos.
- **Showdown:** each river leaf sorts combos by Omaha rank (exactly two hole cards and three board cards). It then makes one sweep with exact card removal, by inclusion-exclusion over the 1-, 2- and 3-card subsets two hands can share, plus the identical combo.
- **Shared sweeps:** every terminal child of a node shares one sweep.
- **Exploitability:** an exact best response for each player against the averaged strategy, every 10 iterations, in percent of the starting pot.

**Stopping rule.** The solve stops at 0.5% of the pot, after 300 iterations, or at 95% of the bridge timeout, whichever comes first. It still writes its result when it stops early.

**Output.** For every decision on the current street, the solver returns:
- each combo's average strategy;
- its EV for each action, given the other player's strategy;
- its own reach probability.

The EVs are chips won from the pot minus chips put in since the street began, so the two players' EVs sum to the pot. No rake is taken. The app shows them in bb from the current decision. It does not grade these decisions; grades still come only from the in-browser exact solvers. If a combo reaches a node less than 0.5% of the time in its own strategy, its average there rests on early iterations, so its row shows the best-EV action instead.

### PLO speed and memory

Measured on this repository's 4-core Linux container. Its four vCPUs give about twice the throughput of one core, so an M3 Pro with 11 cores should be about 4–6 times faster. The ranges are a 6-max 100bb BTN pot-open called by the BB: pot 7.5bb, 96.5bb behind, combos sampled from the bundled PLO chart.

| Spot (combos a side) | Memory (peak RSS) | Time per iteration | To 0.5% of the pot |
| --- | --- | --- | --- |
| Flop Ks9h4d, 300 | 1.8 GB | 2.7 s | 110 iterations, 4.9 min |
| Flop Ks9h4d, 600 | 3.5 GB | 4.9 s | 120 iterations, 9.8 min |
| Flop Ks9h4d, 1000 | 5.7 GB | 7.7 s | 110 iterations, 14 min |
| Turn Ks9h4d2c, 1000 (pot 12.5bb) | 42 MB | 0.05 s | 60 iterations, 2.7 s |
| River Ks9h4d2c7s, 1000 | 28 MB | under 0.01 s | 40 iterations, 0.1 s |

Time per iteration includes the best-response check every 10 iterations.

Memory grows linearly with the number of combos: about 5.8 MB per combo a side on a 100bb single-raised flop, and well under 0.1 MB on the turn. With the bridge's default limit of 70% of 18 GB, a flop fits about 2,000 combos a side. Turn and river spots fit any range the app sends (up to 20,000 combos).

### Running it directly

`plo_solver input.txt` reads one setting per line. Chips are any unit; the app uses 1/100 bb.

```
game PLO4
board Ks9h4d                 3 to 5 cards
pot 750                      pot at the start of this street
stack 9650                   effective stack behind
min_bet 100
range_oop AsKsQhJh:1,AdKc7h6h:0.5,...
range_ip  ...
bet flop oop 0.33            bet sizes, fractions of the pot (or "none")
raise flop oop 1             raise sizes, fractions of a pot raise (or "none")
cap flop 2                   raises allowed after the bet
allin_threshold 0.67
path check,to:250            actions already taken on this street ("to" = street total)
threads 8
accuracy 0.5                 stop at this exploitability, % of pot
max_iterations 300
time_limit 1800              seconds
memory_limit_mb 12000
isomorphism 1
auto_shrink 1
output result.json
```

The solver prints `Iter: N` and `Total exploitability X precent` lines while it runs, which the bridge reads for progress. `plo_solver --eval` ranks `hole board` lines from stdin. `node tools/plo-solver/test.cjs` runs its checks (`--full` adds a 300-combo flop):
- the evaluator against `studio/game.js`;
- a polarized river toy game against its analytic equilibrium;
- convergence and zero-sum checks;
- isomorphism on and off;
- the pot-limit tree;
- spec validation;
- an end-to-end solve through the bridge.

## Three-way NLH: what mw_solver solves

A pot with exactly three players left from the flop on goes to `mw_solver` when **Solver on your Mac** is on, from the app on the Mac or through the solve queue from another device. Other multiway pots (four or more players, PLO, or a fourth player who put chips in on this street and then folded) still run the app's own engines on the bridge (`POST /spot-async`). The tree, the card-removal model, speed and memory are in [tools/multiway-solver/README.md](../multiway-solver/README.md).

## Solves sent from your phone

A phone can't reach this bridge, so when you tap **Solve this spot** on a spot only the Mac can solve, the phone queues it in your account instead. The bridge collects queued spots, solves them one at a time and syncs each answer back, so it appears on the phone a few seconds after the solve ends.

- **Linking:** open the app on this computer once while signed in, with **Solver on your Mac** on. The app hands the bridge your account (`POST /link`). The bridge keeps it in `~/.citrus-poker-bridge.json` (readable only by you; `CITRUS_BRIDGE_LINK` picks another file), and `/health` shows `linkedUser`.
- **Queue:** every 20 seconds the bridge pulls your account's changes and runs the oldest queued `solvejob-…` row through its own endpoints (`queue.cjs`, `queue-worker.cjs`). It marks each job running, then done or failed, and writes a done job's answer as a saved spot.
- **Heartbeat:** every 3 minutes the bridge posts a `macsolver` row with the time, its threads and the computer's load. The phone uses it to tell you whether the Mac is online or busy, and adjusts the time estimate to match.
- **Progress:** while a queued solve runs, the bridge pushes its progress every 10 seconds. Progress is how far exploitability has fallen toward the target, or elapsed time against the estimate for multiway solves, along with the time left. The phone shows it as a bar.
- **Cancel:** a job cancelled on the phone, by hand or because you acted before the answer came, is skipped if it hasn't started. If it's running, it stops at the next progress check.
- A solve started from the app on this computer always goes first. A queued job that finds the solver busy waits for the next round.
- After updating the bridge files, restart the bridge. It reads the saved link and picks up where it left off.

## Flops your Mac learns

The flop library holds about 100 of the 1,755 distinct flops for each preflop line, and any other flop is answered with the nearest solved flop of the same texture (a stand-in). When a heads-up flop like that comes up, the app adds it to a wanted list in your account (a `flopwant-…` row). When the bridge has no queued solves and the computer is otherwise idle (load under half its cores, so a long calibration run keeps it waiting), it solves the newest wanted flop with the library's own tree, ranges, pot and stack (`learn.cjs`). The new flop then matches the rest of the library exactly.

- A solve from the app or the queue always comes first. It stops the flop being learned, and that flop is tried again later.
- Learned flops are saved in `learned/<spot>/` next to `studio/` (`CITRUS_LEARNED_DIR` picks another folder), in the library's work-folder layout. A spot whose chart has been re-solved since then starts a fresh folder.
- The app on this computer loads them from `GET /learned`, so they answer like any library flop. A phone that sends one of these flops to the Mac gets its answer from the learned flop straight away, without a solve, within the sync time.
- To add them to the site's library for everyone, run `node tools/postflop/library.cjs bundle --out learned` in the bridge folder, then `tools/split-libraries.cjs` as usual.

## Licence

TexasSolver is AGPL-3.0. Its author allows free personal use, and requires a commercial licence to provide it as a service over the internet. The install script builds it on your own computer from the author's repository, and this project does not redistribute it. The PLO and 3-way solvers are part of this project.

Check the bridge without a solver: `node tools/local-solver/check-bridge.cjs`.
