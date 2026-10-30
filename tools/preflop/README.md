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

**Calibration (`--calibration file.json`, NLH only):** the realization model can be fitted to real flop play. Solve flop spots with `tools/postflop/library.cjs` using a TexasSolver built with `tools/local-solver/texassolver-evs.patch` (the installer applies it), which saves each hand class's EV. `node tools/preflop/calibrate.cjs --work postflop-work --out calibration.json` then fits the sharpness, position and initiative factors and a playability multiplier per hand class so the model's pot shares match the solved ones, and `export.cjs --calibration calibration.json` builds charts with them. The fit is only as good as the spots solved: 100bb 6-max and heads-up spots calibrate those charts best.

**3-bet pots (`calibrate.cjs --split 1`):** single-raised and 3-bet pots play at very different stack-to-pot ratios, and one realization fit for both overpays small and middle pairs in 3-bet pots (it treats 55 against AK as a favourite that realizes more than its equity). With `--split 1` the 3-bet spots (`btn-bb-3bet`, `co-bb-3bet`, `btn-sb-3bet`, `sb-bb-3bet`, `hj-btn-3bet`, `co-btn-3bet`, `hu-3bet`) get their own fit, stored as `reraised` and used by `solve.cjs` for every flop pot after two raises or more. `hj-btn-3bet` and `co-btn-3bet` are the pots where the 3-bettor has position. Per-class playability is shrunk toward the shape rule by the data behind each class (`--shrink`, default 1): fits on two halves of 120 3-bet-pot flops agreed only at r=0.39 without it. `--check dir` reports the error on flops held out of the fit.

**Per spot (`calibrate.cjs --per-spot 1`):** the pooled fits average very different pots, and 3-bet-versus-flat choices hinge on about 0.05bb. With `--per-spot 1` every solved spot with at least `--spot-flops` (default 20) flops also gets a fit of its own, shrunk toward its pot type's fit, written as `spots` keyed by chart name and flop line; `export.cjs` hands a chart the lines of that chart, and `solve.cjs` pays each of those preflop lines by its own fit. `library.cjs solve --spots per-spot` solves every 6-max 100bb line (each open and call, each 3-bet the opener calls at both sizes, each small 4-bet the 3-bettor calls: 60 spots) and the heads-up ones. The spots must be solved from charts with the current tree, since a line's key carries its raise sizes.

**Level 2 (`level2.cjs`, `tools/calibration/level2.sh`):** a fitted formula is still off by about 12% of the pot per hand, which is enough to flip close 3-bet-or-flat choices. Level 2 pays a line's flop pot from what TexasSolver measured there, class by class. For each solved line, `level2.cjs extract` averages every class's pot share, (pot/2 + EV) / pot, over the flops. `level2.cjs fit` writes the last `--keep` measurements of each line into a calibration as `measured`, together with the ranges they were solved against. `solve.cjs` then scales each class's row of that line's share matrix so that the model's share against the solved opponent range equals the measured one. The factor is averaged in logs over the measurements and kept between 0.05 and 10. Shares can exceed 1, because a hand can win more than the pot it reached the flop with. Measured lines get no all-in blend, since the solve already played their stack-to-pot ratio. `library.cjs solve --floor 0.006` gives every class a seat takes to some per-spot flop line at least 0.6% weight (TexasSolver drops weights under 0.005). That way a hand the chart never 3-bets still gets a measured 3-bet-pot value, which is the value that decides whether it should. `level2.sh` runs the rounds on one or more servers. Round 0 reuses the pass-2 per-spot solves. Round 1 solves every 6-max 100bb line on the round-0 charts with the floor. Round 2 re-solves only the lines whose ranges moved more than 5% (`level2.cjs moved`). Each round rebuilds the 6-max 100bb chart and balance-checks it. `level2-sync.sh`, run on a computer that reaches every box, keeps their `l2` folders in step.

**Balance check:** `node tools/preflop/balance-check.cjs bundle.json.gz` compares the 6-max 100bb chart's responses to an open (CO and BTN against HJ, BTN against CO, SB against BTN, BB against BTN and SB) with BeyondGTO's 6-max 100bb aggregates. It also wants a suited wheel ace 3-betting at least 25% and 77-55 mostly flatting in position. It exits 2 on any failure, and a calibrated library ships only if it passes. The big blind's calls are checked on raked charts only, since the reference is raked.

**Calibration by depth:** `library.cjs` (postflop) also defines every NLH spot at 20, 50 and 200bb (`btn-bb-50bb`; the 3-bet pots are all-in at 20bb). It also defines 4-handed and 9-handed 100bb spots (`4max-co-bb`, `9max-utg-bb`). `calibrate.cjs --depths 20,50,100,200` fits each depth on the spots solved from that depth's charts and writes a calibration set. Given a set, `export.cjs` uses the fit of the nearest depth by ratio (150bb the 200bb fit, 500 and 1000bb the 200bb fit) and none below 15bb, and `library.cjs --calibration set.json` passes it to every NLH chart; `--seats`, `--formats` and `--base bundle.json.gz` (keep that bundle's other charts) build just part of a library. `tools/calibration/smart-calibration.sh` runs the whole two-pass calibration and the flop library on the result, and `tools/calibration/server-run.sh` runs it on a rented Linux server.

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

- `tree.cjs` builds a trimmed betting tree. Seats are counted from the button (0), as in chart packs. Sizes: open 2.5bb (SB 3bb); two 3-bet sizes, 3x or 4x the open in position and 3.5x or 4.5x from the blinds, plus 1x per caller; two 4-bet sizes, 2.2x or 2.7x the 3-bet; then all-in. Any raise to 40% of the stack or more becomes all-in. The second sizes (October 2026) make NLH trees about three times bigger and charts three to four times slower to solve (6-max 100bb: 12 minutes for 2,000 iterations instead of 3.7).
- Position after the flop: the button acts last, heads-up too (where it is also the small blind).
- Trims, so every flop is heads-up:
  - no open-limps;
  - at most one player flats an open;
  - after a 3-bet only the previous raiser continues;
  - a flatter continues against a squeeze only if the opener folds;
  - facing a 4-bet or more, a call that would leave too little behind is dropped (all-in or fold). For NLH the limit is 2 times the pot up to 100bb, which keeps the flat against the small 4-bet and makes the big one jam or fold; 6 times the pot from 101 to 200bb, so those charts have no 4-bet flats; and 2.5 times the pot otherwise (PLO, and NLH at 500bb and deeper). With the flat kept at 150-200bb the 3-bettor flats KK and the 4-bettor folds KK to the 5-bet jam (up to 100% on some lines), so it stays dropped there. At 100bb the flat works together with the 3-bet-pot realization (sharpness 1.6, below); before it, KK folded to the jam there too. Paying called 4-bet pots closer to all-in equity (blending up to a stack-to-pot ratio of 3) made the KK folds worse.
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
- from 101 to 200bb, facing a 4-bet, there are no flats, and at 100bb none against the big 4-bet, so Practice never grades a flat there. `checks()` still reports any line (NLH, 40-200bb) where KK folds to the 5-bet jam;
- 3-bet versus flat hand choice is not reliable. In the 6-max 100bb chart the totals match published solvers (BTN 3-bets 8.5% and flats 10% against an HJ open), but the 3-bets are linear (pairs and broadways, no suited-wheel-ace bluffs) and the SB flats too much. Most marginal hands are within about 0.05bb between flatting and 3-betting here, so small realization errors flip them between 0% and 100%. Tests in October 2026 with a 3-bet-pot fit from 192 TexasSolver flops (6 spots) moved the bluffs to T9s and 55 but not to the wheel aces, and with 4-bet flats kept the in-position flats vanished. `balance-check.cjs` fails until this is fixed; the drills leave these spots out (`PokerDrills.UNTRUSTED` in `studio/drill-plan.js`).
- PLO hand groups are coarse: a group plays one strategy, so a hand such as 9876 single-suited is folded from the CO with the weaker rundowns in its group.

The bundled `preflop-library.json.gz` in the app's chart packs was built before the current model. Its settings text has no "odds to the power" clause. Until it is rebuilt, Practice grades against the old charts: the heads-up button opens 36.7%, premiums fold to some squeezes, and so on. Rebuilding the bundled library after a model change takes several hours on four cores: `node tools/preflop/library.cjs --out preflop-library --jobs 4` (delete the folder's chart files first, since finished charts are kept).

Label the pack as a model, not a full solve.
