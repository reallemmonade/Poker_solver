# Local postflop solver (TexasSolver)

Heads-up postflop spots that are too large for the in-browser exact solver can be solved by [TexasSolver](https://github.com/bupticybee/TexasSolver) on your own computer. In the app, set **Analysis settings → Big heads-up postflop spots** to **TexasSolver on this computer**.

## Setup (Mac)

1. Install the Xcode command-line tools (`xcode-select --install`), [Homebrew](https://brew.sh) and Node (`brew install node`).
2. Build the solver: `bash tools/local-solver/install-mac.sh`.
   - The script downloads TexasSolver's console branch at a pinned commit, plus `cmake` and `libomp` from Homebrew.
   - It builds the solver and runs a small test solve. If Homebrew is missing or is an Intel copy on Apple silicon, it gets cmake from a private Python venv and libomp from `$LIBOMP_PREFIX` or a conda install (`conda install llvm-openmp`).
3. Start the bridge: double-click `tools/local-solver/start.command`, or run `node tools/local-solver/server.cjs`. Keep the window open while you study.

The bridge listens on `127.0.0.1:8787` only. It accepts requests from `https://range-lab-poker-studio.onrender.com` and from `localhost` pages. To allow other origins, set `RANGE_LAB_ORIGINS` (comma-separated).

Options:

| Option | Default |
| --- | --- |
| `--threads N` | all cores but one |
| `--port` | 8787 |
| `--timeout` | 1800 seconds per solve |
| `--solver` | path to `console_solver` |

## What it solves

- **Spot:** the current street onward, for the two players left in the hand. Ranges are the app's ranges, averaged per hand class so TexasSolver can use suit isomorphism.
- **Bet tree:** one bet size per street (flop 33%, turn 66%, river 75% of pot), one raise (66%) and all-in. Any bet committing more than two thirds of the stack becomes all-in. The sizes actually used on the current street are added so the real line exists in the tree.
- **Stopping rule:** the solve stops at 1% exploitability (in percent of the pot) or 200 iterations.
- **Not reported:** TexasSolver doesn't report action EVs, so these results show frequencies and are never used for grades.

## Speed and memory

These are measured on a 4-core Linux machine:

| Spot | Memory | Time per iteration | Total time |
| --- | --- | --- | --- |
| 100bb single-raised flop, typical ranges | about 5 GB | about 9 s | — |
| Turn spot, full ranges | — | — | 20–30 s |

On the flop, expect several minutes on a laptop.

## Licence

TexasSolver is AGPL-3.0. Its author allows free personal use, and requires a commercial licence to provide it as a service over the internet. The install script builds it on your own computer from the author's repository, and this project does not redistribute it.
