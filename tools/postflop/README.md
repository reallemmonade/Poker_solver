# Postflop library

Precomputes heads-up flop strategies with TexasSolver for common preflop lines. The ranges come from the preflop chart library (`tools/preflop/library.cjs`). The app imports the result from **Library → Preflop solver references → Import reference file**, the same button as the charts.

```
bash tools/local-solver/install-mac.sh             # builds TexasSolver once
node tools/postflop/library.cjs list               # known spots
node tools/postflop/library.cjs solve --spots btn-bb,co-bb --flops 100 --out postflop-work
node tools/postflop/library.cjs bundle --out postflop-work   # writes postflop-work/postflop-library.json(.gz)
```

On a Mac, double-click `tools/postflop/run-library.command`. It writes to `~/Desktop/Poker_Solver/postflop-work`, keeps the Mac awake while it runs, and bundles at the end. Set `CHARTS`, `OUT`, `SPOTS` or `FLOPS` to change these.

Each solved flop is written to `<out>/<spot>/<flop>.json` as soon as it finishes. A stopped run resumes where it left off. Options: `--threads` (default: all cores), `--accuracy` (stop at this exploitability, % of pot, default 1), `--iterations` (default 200), `--flops N` or `--flops all` (all 1,755), `--redo-above pct` (re-solve flops saved above this exploitability, for example `--redo-above 1.05 --iterations 400`).

## Spots

The two charts the spots use (NLH cash 6-handed and 2-handed 100bb, copied unchanged from the preflop chart library) ship as `charts-100bb.json.gz`, so the library runs without the 22 MB chart bundle. In the app, import the full chart library too: answers need the matching chart loaded.


| Id | Line (6-max unless noted, 100bb cash) |
| --- | --- |
| `btn-bb` | BTN opens, BB calls |
| `co-bb` | CO opens, BB calls |
| `utg-bb` | UTG opens, BB calls |
| `sb-bb` | SB opens, BB calls |
| `btn-bb-3bet` | BTN opens, BB 3-bets, BTN calls |
| `hu-srp` | Heads-up: the button opens, BB calls |

The line uses the chart's own sizes (the smallest raise at each step). Ranges are the chart's frequencies for each action on the line, per hand class.

## Flops

`flops.cjs` lists the 1,755 flops that are distinct up to suits. `--flops N` takes a spread of about N of them. The flops are grouped by suit pattern, pairing and high card, and each group gets flops in proportion to how often it is dealt. The most common textures come first.

## Tree

The tree is smaller than the live local solver's, so a 100bb flop fits in about 3 GB and each iteration is about three times faster:

- **Flop:** a 33% pot bet, one 66% raise, and all-in.
- **Turn:** a 66% bet and all-in.
- **River:** a 75% bet and all-in.
- No donk bets. Any bet committing more than two thirds of the stack becomes all-in.

## In the app

A flop decision is answered from the library only when all of these hold:

- The hand's preflop line maps to the spot's chart line in the same chart. The chart is chosen by the nearest depth, and raises map to the nearest chart size.
- The flop is the same up to suits.
- The stack-to-pot ratio is within a factor of 1.5. Chip amounts scale to the hand's pot.
- Each flop bet or raise is within a factor of 1.5 of a solved size. The answer says when a nearest size stands in.
- Your hand is in the solved range.
- Both players' chart ranges still match the ranges the library was solved for. A chart re-solved under the same name gets no library answers until the library is rebuilt from it.

Otherwise the app solves the spot as before: in the browser, or with TexasSolver on your computer, using ranges from the same chart. TexasSolver reports no action EVs, so library answers show frequencies and are not graded.

**Flop reports** (under the import controls) average each flop's strategy over the acting player's range. For example, they show how often BB checks, or how often BTN c-bets after a check, on each solved flop.

## Format

`range-lab-postflop-library-v1`:

```
{format, name, createdAt, source,
 spots: [{id, label, chart: {name, key}, pot, stack, tree, rangeIp, rangeOop,
          flops: {"AsKd7c": {weight, iterations, exploitability,
                             nodes: [{path: "CHECK/BET 182", player: "ip"|"oop", actions: [...], table: base64}]}}}]}
```

- **Flop keys:** each flop is keyed by its canonical suit labelling (`PokerPostflopLibrary.canonical`).
- **`chart.key`:** the preflop chart's history key for the line.
- **`table`:** one byte per combo and action, for the 1,326 combos in colex order. Each row sums to about 255, and a combo outside the range is all zeros.
- **Chips:** amounts are in the app's chips, 100 per big blind.

## Speed and memory

Measured on a 4-core Linux machine (6-max BTN vs BB, chart ranges of about 590 and 920 combos):

| Tree | Memory | Time per iteration |
| --- | --- | --- |
| Live local-solver tree (donks, raises on every street) | 7.5 GB | 14 s |
| Library tree | 3.2 GB | 5 s |
