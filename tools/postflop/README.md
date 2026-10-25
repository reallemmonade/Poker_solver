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
| `co-btn` | CO opens, BTN calls |
| `hj-btn` | HJ opens, BTN calls |
| `utg-btn` | UTG opens, BTN calls |
| `co-bb-3bet` | CO opens, BB 3-bets, CO calls |
| `btn-sb-3bet` | BTN opens, SB 3-bets, BTN calls |
| `sb-bb-3bet` | SB opens, BB 3-bets, SB calls |
| `hu-3bet` | Heads-up: the button opens, BB 3-bets, the button calls |

The line uses the chart's own sizes (the smallest raise at each step). Ranges are the chart's frequencies for each action on the line, per hand class. A seat the chart has no decision for (in the chart model, players behind a 3-bet fold) folds.

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
- The flop is the same up to suits. Otherwise the nearest solved flop with the same suit pattern and pairing stands in: the closest one by card ranks and the gaps between them, with your cards moved onto it (a board rank becomes the stand-in's rank, any other rank keeps its place between the board ranks). The answer says it is a stand-in and names the flop. The library always holds a flop of each suit pattern and pairing, so every flop gets an answer, if a rougher one.
- The stack-to-pot ratio is within a factor of 1.5. Chip amounts scale to the hand's pot.
- Each flop bet or raise is within a factor of 1.5 of a solved size. The answer says when a nearest size stands in.
- Your hand is in the solved range.
- Both players' chart ranges still match the ranges the library was solved for. A chart re-solved under the same name gets no library answers until the library is rebuilt from it.

Otherwise the app solves the spot as before: in the browser, or with TexasSolver on your computer, using ranges from the same chart. TexasSolver reports no action EVs, so library answers show frequencies and are not graded.

**Flop reports** (under the import controls) average each flop's strategy over the acting player's range. For example, they show how often BB checks, or how often BTN c-bets after a check, on each solved flop.

## PLO

`plo-library.cjs` does the same for pot-limit Omaha with this project's PLO solver (`tools/plo-solver`). It uses the app's PLO tree: one bet size per street and pot-sized raises. On a Mac, double-click `tools/postflop/run-plo-library.command`. It writes to `~/Desktop/Poker_Solver/plo-work`, and the bundle is `plo-postflop-library.json.gz`, imported like the NLH one.

```
node tools/postflop/plo-library.cjs list
node tools/postflop/plo-library.cjs solve --charts preflop-library.json.gz --spots plo-btn-bb --flops 40 --combos 500 --out plo-work
node tools/postflop/plo-library.cjs bundle --out plo-work
```

| Id | Line (PLO cash 100bb, 6-max unless noted) |
| --- | --- |
| `plo-btn-bb` | BTN opens, BB calls |
| `plo-co-bb` | CO opens, BB calls |
| `plo-sb-bb` | SB opens, BB calls |
| `plo-btn-bb-3bet` | BTN opens, BB 3-bets, BTN calls |
| `plo-hu-srp` | Heads-up: the button opens, BB calls |

A PLO range has hundreds of thousands of combos, so each flop is solved for a systematic sample of each range (`--combos`, default 500 a side), the same sampling the app uses for live PLO solves. The flop stores those combos and their weights. The app answers a stored combo from its own row. Any other hand gets the stored combo closest in made-hand strength (its share of the stored combos) and in the number of turn cards that improve its hand category, and the answer says so. Unsolved flops get a stand-in flop as for NLH, and ranges must still match the chart's hand-group weights. On the 4-core container, 120 combos a side took about 50 s a flop for 20 iterations. Expect a few minutes a flop on a Mac at 500 combos.

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
