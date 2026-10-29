# Chart bots

Scripted bots that test the shipped chart library the way the app uses it. No LLMs and no solving: they read charts and compute values and best responses. Node 18+, no dependencies.

```
node tools/chart-bots/run-all.cjs                      # bundled library, about 10 minutes on 4 cores
node tools/chart-bots/run-all.cjs --quick              # fewer hands, depths and sizes, about 3 minutes
node tools/chart-bots/run-all.cjs --library path/to/v6/manifest.json
```

Reports go to `out/chart-bots/<library version>/` unless you pass `--out dir`. The `out/` folder is not committed. Each bot writes a `.md` report and a `.json` twin; `run-all.cjs` adds `README.md` (a summary) and `summary.json`.

## The bots

- `selfplay.cjs`: every seat plays the chart against the others. Actions come from the app's own lookup (`PokerPreflop.query`), sampled with a seeded generator, so runs repeat exactly. It reports each seat's winrate in bb/100 and checks that the seats sum to minus the rake, the button beats the first seat, later seats beat earlier ones, every seat beats folding every hand, and the sampled winrates agree with the exact model value.
- `exploit.cjs`: the one-spot exploiter. At every decision it keeps everyone else on the chart and values each hand's pure actions against the chart's mix. A hand that gains more than `--min` bb (default 0.05) by deviating is a finding. Findings are ranked by gain times how often the seat holds that hand there. It also prints full reports for known spots, such as the button against a hijack open.
- `coverage.cjs`: asks the app for an answer in every common preflop line, for 2 to 9 seats, depths from 10bb to 2000bb, cash, raked cash and tournament tables. Each spot is exact, approximate (another depth, a mapped size, a rake-free or chip-EV chart) or nothing. It also measures how much of all flops each flop library spot answers, and which heads-up flop lines have a spot at all.
- `offtree.cjs`: feeds sizes the charts were not solved for through the app's mapping code. It sweeps preflop opens from 2bb to all-in, 3-bets from 5bb to all-in, and flop bets from 5% of the pot to all-in. It flags gaps, crashes, sharp jumps between neighbouring sizes, and answers that let a bluff of any two cards profit. It also writes the whole strategy the app serves at depths with no chart (30bb, 70bb, 130bb ...) into that depth's game and measures its NashConv.

Each bot runs alone too. They share the options `--library`, `--out`, `--jobs` (worker processes, default 4) and `--quick`. Chart filters: `--games nlh,plo`, `--modes cash,mtt`, `--seats 2-9`, `--depths 100,200`, `--packs nlh-cash-6max-100bb`. `selfplay.cjs` takes `--hands` and `--seed`. `exploit.cjs` takes `--min`, `--top` and `--spot "<chart id>|<line key>"`, where the line key is the app's history key, such as `3:fold:0/4:raise:250/5:fold:0`.

## How values are computed

Postflop is not played. The bots use the payoff model the charts were solved in (`tools/preflop/solve.cjs`):

- A pot that is all-in preflop pays all-in equity from `tools/preflop/equity-table.json`.
- A pot that sees a flop pays an equity-realization share of the pot, from the two hand classes' equity, position, who raised last and hand shape.

The bots rebuild each chart's game from the settings text in the pack (tree sizes, rake, limps, realization settings) and load the chart's rows into it. A check compares the rebuilt NashConv with the one the pack claims. They match for most charts. Short-stack and heads-up 50bb charts score higher than they claim, which points at rows rounded to per-mille in rarely played lines.

The model is an approximation. A hole that only exists under this model can be false. So `exploit.cjs` values every finding again under eight perturbed models (sharper or flatter realization, more or less position and initiative edge, other playability bonuses). It calls a finding robust when it holds in the chart's own model and in all but at most one perturbed model. A finding that flips between models means the chart's choice there depends on the realization model.

Self-play pays each dealt hand its expected value under the model, given both players' hand classes, so it needs no board runouts. The exact model value comes from a walk over whole ranges. Note that the exact values do not quite sum to zero: the model removes cards only against the narrowest folded range, a known shortcut, worth about 2 to 6 bb/100 in total.

## Running on v6

A v6 library is a drop-in: the same pack and flop formats with a new manifest. Point the bots at it:

```
node tools/chart-bots/run-all.cjs --library /path/to/v6/manifest.json
```

`--library` also takes a folder holding `manifest.json`, a folder with `packs/` and `flops/`, or bundle files (`preflop-library.json.gz`, a postflop library), comma-separated. Reports go to `out/chart-bots/<v6 version>/`, so v4 and v6 reports sit side by side.

If the v6 charts are calibrated per hand class, the pack text does not hold the calibration table. Pass the same file the charts were built with, `--calibration calibration.json`, or the bots fall back to the shape rule and say so in each report.
