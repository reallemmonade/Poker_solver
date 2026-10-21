# Preflop CFR+ model

Builds preflop chart packs (`range-lab-preflop-reference-v1`) that the app imports from Charts. Node 18+, no dependencies.

```
node tools/preflop/check-pushfold.cjs                     # validation, about 1 second
node tools/preflop/export.cjs --seats 9 --stack 200 --iterations 2000 --out 9max-200bb.json
```

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
