# Preflop CFR+ model

Builds preflop chart packs (`range-lab-preflop-reference-v1`) that the app imports from Charts. Node 18+, no dependencies.

```
node tools/preflop/check-pushfold.cjs                     # validation, about 1 second
node tools/preflop/export.cjs --seats 9 --stack 200 --format cash --iterations 2000 --out 9max-200bb.json
node tools/preflop/library.cjs --out preflop-library --jobs 4   # every chart, bundled into one file
```

`library.cjs` solves NLH and PLO cash and MTT charts for heads-up and 3- to 9-handed tables at 10, 20, 50, 100, 150, 200, 500 and 1000bb. It then writes `preflop-library.json` and `preflop-library.json.gz`, a `range-lab-preflop-bundle-v1` file that the Library imports in one go (either copy). Bundled rows are compact: a pure action index or per-mille frequencies per class.

**MTT charts:**
- They use a 1bb big-blind ante and chip EV, with no ICM.
- They are marked `chipEV`, so they match tournament tables whatever the payouts.

**Short and deep stacks:**
- Below 40bb, opens are 2bb.
- At 25bb or less, all-in is offered at every raise.
- From 300bb, a sized 5-bet comes before the all-in.

**Depth matching:** the app uses the nearest depth within a factor of 1.5 and labels the substitution.

## PLO

PLO charts use the same solver over hand groups instead of the 169 NLH classes:

```
g++ -O3 -march=native -pthread -o plo-equity tools/preflop/plo-equity.cpp
node tools/preflop/plo-model.cjs --bin ./plo-equity     # rebuilds plo-model.json, a few minutes
node tools/preflop/export.cjs --game plo --seats 6 --stack 100 --format cash --out plo-6max-100bb.json
```

- **Hand groups:** the 270,725 four-card hands fall into 16,432 suit-isomorphic classes. `plo-model.cjs` groups them by shape (suits, pairing, connectedness, suited ace) and then by equity against a random hand, with no band wider than about 5 points of equity (256 groups). Everything in a group plays the same strategy.
- **Equity tables:** compatibility between groups is exact (inclusion-exclusion over shared cards). Group-vs-group all-in equity is sampled, 3,000 runouts per pair.
- **Pot limit:** every raise is pot-sized, and all-in comes once a pot raise reaches the stack.
- **Realization:** the in-position edge is x1.05, against x1.12 in NLH. PLO equities run closer together, and this value reproduces published 6-max 100bb opening ranges (about 18% UTG to 49% BTN).
- **Playability by shape:**
  - up: double-suited +10%, single-suited +4%, suited ace +4%, connected +6%;
  - down: rainbow -6%, three or more of a suit -8%, disconnected -4%, trips -12%.

The packs carry `handGroups` (group names, plus two base-36 digits per class in the app's class order). They are labelled approximate.

## How it works

- `tree.cjs` builds a trimmed betting tree. Seats are counted from the button (0), as in chart packs. Sizes: open 2.5bb (SB 3bb), 3-bet 3x in position or 4x from the blinds plus 1x per caller, 4-bet 2.3x, then all-in. Any raise to 40% of the stack or more becomes all-in.
- Trims, so every flop is heads-up:
  - no open-limps;
  - at most one player flats an open;
  - after a 3-bet only the previous raiser continues;
  - a flatter continues against a squeeze only if the opener folds.
- `solve.cjs` runs CFR+ (alternating updates, linear averaging) over the 169 hand classes.
  - All-in pots pay all-in equity from `equity-table.json`: a Monte Carlo table, at least 20,000 runouts per class pair, with card removal between the two players.
  - Flop pots are not played out. They pay an equity-realization share: equity is scaled x1.12 in position and x0.88 out of position, and by a playability factor (pairs, suited and connected hands up, disconnected offsuit hands down).
  - Folded players' ranges are treated as independent; card removal is applied against the narrowest one.
- `exploitability()` reports NashConv: the total each player could gain by best-responding to the averaged strategy. It is measured within this model.

## Validation

`check-pushfold.cjs` solves heads-up 10bb push/fold through the same code. It reaches NashConv about 1e-6 bb, SB value -0.0455 bb and a 58.3% shove rate. The independent fictitious-play solution of the same table has NashConv 0.0013 bb and shoves 58.4%. Measured on this solver's game, that solution's NashConv is 0.0013 bb, so the two compute the same game. Their per-hand differences are confined to near-indifferent hands.

## Limits

The 9-handed charts are only as good as the realization model. Compared with full postflop solvers, expect these differences:

- tighter early-position opens;
- fewer small pairs and suited connectors, because implied odds at 200bb are only partly captured;
- no limping;
- simplified multiway play.

Label the pack as a model, not a full solve.
