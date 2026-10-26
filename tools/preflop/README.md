# Preflop CFR+ model

Builds preflop chart packs (`range-lab-preflop-reference-v1`) that the app imports from Charts. Node 18+, no dependencies.

```
node tools/preflop/check-pushfold.cjs                     # validation, a few seconds
node tools/preflop/export.cjs --seats 9 --stack 200 --format cash --iterations 2000 --out 9max-200bb.json
node tools/preflop/library.cjs --out preflop-library --jobs 4   # every chart, bundled into one file
```

`export.cjs` rejects unknown options and out-of-range values (seats 2-9, a stack above 1bb, format cash or mtt, game nlh or plo, at least one iteration). It measures NashConv every `--every` iterations and keeps the averaged strategy from the checkpoint with the lowest NashConv; `library.cjs` passes `--every 500` by default.

`library.cjs` solves NLH and PLO cash and MTT charts for heads-up and 3- to 9-handed tables at 10, 20, 50, 100, 150, 200, 500 and 1000bb. It then writes `preflop-library.json` and `preflop-library.json.gz`, a `range-lab-preflop-bundle-v1` file that the Library imports in one go (either copy). Bundled rows are compact: a pure action index or per-mille frequencies per class.

**MTT charts:**
- They use a 1bb big-blind ante and chip EV, with no ICM.
- They are marked `chipEV`, so they match tournament tables whatever the payouts.

**Raked cash charts:** `library.cjs --rake 5 --rakeCap 3 --games nlh` builds NLH cash charts with 5% rake capped at 3bb, no flop no drop, at 50, 100, 150 and 200bb (`--depths` to change), into files ending `-rake5-cap3.json` and a bundle of their own. Import that bundle as well as the main one. `export.cjs` takes the same `--rake` and `--rakeCap`. Pots that end preflop pay no rake. All-in pots pay rake on the pot as it stands. A flop pot is raked as if it doubled by the river (`rakeGrowth`), because postflop play is not modelled. In 6-max 100bb, rake mainly cuts the big blind's flats against a button open, from 51% to 35% of hands, and tightens the button and small-blind opens by about 2 points.

A table matches a raked chart only with the same rake and cap. Any other raked table gets the rake-free chart, and the answer says the rake is not modelled.

**Limps (`--limp 1`, off by default):** the small blind may complete when everyone else has folded, and heads-up the button may limp. The big blind then checks or raises to 3.5bb (`isoRaise`); in PLO charts the raise is pot-sized, to 3bb. A limped pot is paid by the same realization model as a raised one, with the usual postflop positions (heads-up the button is in position, otherwise the big blind). In tests at 100bb, the heads-up button limps 20% and raises 68%, the 6-max small blind limps 8% and raises 43%, and the big blind raises about half its hands against a limp. That raise rate is likely high, because the realization model rewards initiative. Turning limps on changes the blind and heads-up ranges, so the flop libraries built on these charts must be rebuilt as well.

**Short and deep stacks:**
- Below 40bb, opens are 2bb.
- At 25bb or less, all-in is offered at every raise.
- From 300bb, a sized 5-bet comes before the all-in.

**Depth matching:** the app uses the nearest depth within a factor of 1.6 (so 20-50bb and 200-500bb have no gap) and labels the substitution. All-ins and the largest pot-limit raise in the line map to the chart's largest raise, and the chart's sizes are kept within the table's legal range. A chip-EV chart used for a table with real payouts is labelled as such.

**Untrained rows:** packs carry no reach, so the app rebuilds it from the rows. It does not serve a node that the other players reach with zero chart probability, or a hand class that reaches the node under 0.1% of the time; those rows are left at the solver's uniform start or an early iterate.

## PLO

PLO charts use the same solver over hand groups instead of the 169 NLH classes:

```
g++ -O3 -march=native -pthread -o plo-equity tools/preflop/plo-equity.cpp
node tools/preflop/plo-model.cjs --bin ./plo-equity     # rebuilds plo-model.json, a few minutes
node tools/preflop/export.cjs --game plo --seats 6 --stack 100 --format cash --out plo-6max-100bb.json
```

- **Hand groups:** the 270,725 four-card hands fall into 16,432 suit-isomorphic classes. `plo-model.cjs` groups them by shape (suits, pairing, connectedness, suited ace) and then by equity against a random hand, with no band wider than about 5 points of equity (256 groups). Everything in a group plays the same strategy.
- **Equity tables:** compatibility between groups is exact (inclusion-exclusion over shared cards). Group-vs-group all-in equity is sampled, 3,000 runouts per pair.
- **Zero-sum folds:** folded PLO hands are treated as independent of the rest (`foldRemoval: false`), so every player sees the same joint probabilities and the game stays zero-sum. NLH keeps card removal against the narrowest folded range.
- **Pot limit:** every raise is pot-sized, and all-in comes once a pot raise reaches the stack.
- **Realization:** the in-position edge is x1.10 and sharpness 1.5 (NLH: x1.12 and 1.2), with no extra edge for the last raiser. PLO equities run closer together, so hands that are behind need the sharper penalty. These values reproduce published 6-max 100bb opening ranges (about 17% UTG to 50% BTN), have the BB fold about two thirds of hands to an UTG pot raise and a third to a BTN one, and let the BTN flat about 10% against a CO open.
- **Playability by shape:**
  - up: double-suited +10%, single-suited +4%, suited ace +4%, connected +6%;
  - down: rainbow -6%, three or more of a suit -8%, disconnected -4%, trips -12%.

The packs carry `handGroups` (group names, plus two base-36 digits per class in the app's class order). They are labelled approximate.

## How it works

- `tree.cjs` builds a trimmed betting tree. Seats are counted from the button (0), as in chart packs. Sizes: open 2.5bb (SB 3bb), 3-bet 3x in position or 4x from the blinds plus 1x per caller, 4-bet 2.3x, then all-in. Any raise to 40% of the stack or more becomes all-in.
- Position after the flop: the button acts last, heads-up too (where it is also the small blind).
- Trims, so every flop is heads-up:
  - no open-limps;
  - at most one player flats an open;
  - after a 3-bet only the previous raiser continues;
  - a flatter continues against a squeeze only if the opener folds;
  - facing a 4-bet or more, a call that would leave too little behind is dropped (all-in or fold). The limit is 6 times the pot for NLH up to 200bb and 2.5 times the pot otherwise (PLO, and NLH at 500bb and deeper). So NLH charts from 100bb to 200bb have no 4-bet flats: every sized 4-bet is answered by a fold or a jam. At 500bb and deeper every 4-bet flat stays. If a user flats a 4-bet where it was dropped, Practice has no frequency for that action and gives no grade. The trim is a deliberate trade-off. With the flats kept (the old 2.5x limit), the 3-bettor flatted KK, QQ and AK against a 4-bet because the realization model pays a called 4-bet pot generously, so the 5-bet jam range shrank to AA plus a few suited-ace bluffs and KK folded to it in 15 lines at 6-max 200bb cash and in 24 charts overall. Paying called 4-bet pots more like an all-in (all-in equity up to a stack-to-pot ratio of 5, or at least half all-in equity) did not fix it; dropping the flats does (6-max 150bb and 200bb cash, 6-max 100bb MTT and 9-max 200bb MTT then pass the KK check).
- `solve.cjs` runs CFR+ (alternating updates, linear averaging) over the 169 hand classes.
  - All-in pots pay all-in equity from `equity-table.json`: a Monte Carlo table, at least 20,000 runouts per class pair, with card removal between the two players.
  - Flop pots are not played out. They pay an equity-realization share of the pot, from the odds e/(1-e) raised to the power 1.2 (so a hand that is behind realizes less than its raw equity, and trash out of position far less), scaled x1.12 in position and x0.88 out of position, x1.06 for the last preflop raiser, and by a playability factor (pairs, suited and connected hands up, disconnected offsuit hands down; offsuit connectors below 65 get no bonus).
  - A flop pot with little behind is close to all-in: below a stack-to-pot ratio of 0.5 it pays all-in equity, and up to 1.5 a blend of all-in equity and the realization share. This matters most for pot-limit lines that leave a few big blinds behind.
  - Folded players' ranges are treated as independent; card removal is applied against the narrowest one.
- The average strategy is weighted by each player's own reach.
- Lines an opponent (almost) never takes are still solved: CFR passes send a token share (1e-5) of the opponent's continuing range down every action, and regrets are added per unit of opponent reach. Without this, a line dropped early (an in-position flat, a squeeze after it) kept the strategy regret matching held in the first iterations, such as folding aces.
- Packs give each node's `reach`: how often the averaged strategies arrive there (0-1). `studio/preflop.js` query() returns it as `chartReach`, plus `offPath` for nodes under 0.0001. Nothing in the app shows these yet: the Practice result in `studio/references-ui.js` should label off-path answers or hold them back.
- `exploitability()` reports NashConv: the total each player could gain by best-responding to the averaged strategy. It is measured within this model.

## Validation

`check-pushfold.cjs` solves heads-up 10bb push/fold through the same code, then heads-up 100bb, where the button must be in position in every flop pot, open at least 70% and see the BB fold some hands (about 82% and 24%). It reaches NashConv about 1e-6 bb, SB value -0.0455 bb and a 58.3% shove rate. The independent fictitious-play solution of the same table has NashConv 0.0013 bb and shoves 58.4%. Measured on this solver's game, that solution's NashConv is 0.0013 bb, so the two compute the same game. Their per-hand differences are confined to near-indifferent hands.

## Limits

The 9-handed charts are only as good as the realization model. Compared with full postflop solvers, expect these differences:

- fewer suited connectors (the SB folds 54s and 76s first in), because implied odds are only partly captured;
- no limping unless built with `--limp 1`;
- simplified multiway play, so in-position flats stay rarer than in full solves;
- with the 1bb big-blind ante (MTT charts) the BB still defends almost every hand against late-position opens, and openers rarely fold to a 3-bet;
- up to 200bb, facing a 4-bet, there are no flats when the call would leave under 6x the pot behind, so Practice never grades a flat there. `checks()` still reports any line (NLH, 40-200bb) where KK folds to the 5-bet jam;
- PLO hand groups are coarse: a group plays one strategy, so a hand such as 9876 single-suited is folded from the CO with the weaker rundowns in its group.

The bundled `preflop-library.json.gz` in the app's chart packs was built before the current model. Its settings text has no "odds to the power" clause. Until it is rebuilt, Practice grades against the old charts: the heads-up button opens 36.7%, premiums fold to some squeezes, and so on. Rebuilding the bundled library after a model change takes several hours on four cores: `node tools/preflop/library.cjs --out preflop-library --jobs 4` (delete the folder's chart files first, since finished charts are kept).

Label the pack as a model, not a full solve.
