# Three-way NLH postflop solver (mw_solver)

`mw_solver` solves no-limit Hold'em pots with exactly three players from the flop, turn or river. It runs on your Mac (or any Linux box) through the local bridge, the same way TexasSolver answers heads-up spots and `plo_solver` answers PLO. TexasSolver is heads-up only, and the app's own multiway engines (`studio/multiway-exact.js`, `studio/spot-solver.js`) don't settle on wide ranges within the bridge's 30 minutes.

```
c++ -O3 -std=c++17 -pthread -march=native -o mw_solver mw_solver.cpp   # or: bash tools/local-solver/install-mac.sh --plo-only
mw_solver input.txt
node tools/multiway-solver/test.cjs        # checks, a few minutes on 4 cores
```

## What it solves

**Players.** Three players in postflop order: player 0 acts first on every street, then 1, then 2. All three play the same stack behind (the app sends the smallest of the three). Folded players' chips from earlier streets are dead money in the pot.

**Ranges.** Exact weighted two-card combos (or hand classes such as `AKs:0.5`), up to 1,326 each.

**Algorithm.** Discounted CFR with alternating updates, in vector form over every combo, multi-threaded. The discount parameters are α = 3, β = 0, γ = 4, not the heads-up default (1.5, 0, 2): on a three-way turn the default stalls near 1.5% of the pot after 300 iterations, and these settings reach 0.35% (measured, below).

**Card removal.** Exact: a player's cards, the board and the two opponents' hands never share a card, at every fold and showdown. For a player's combo h, the weight of the opponent pairs it can face is the product of the two one-opponent sums (each opponent's weight clear of h) minus the pairs that share a card with each other. That part is an inclusion-exclusion over the shared card c: (opponent A's weight on c, clear of h) × (opponent B's weight on c, clear of h), summed over the cards outside h, minus the pairs of identical combos, which the sum counts twice. A showdown adds the opponents' combos in rank order and reads this for each of the player's combos as its rank comes up, once for the hands it beats and again around ties, so two- and three-way chops are exact too. The cost is one row of 52 per opponent combo added (O(combos × 52) per leaf, vectorized) instead of O(combos). Measured below: a flop solve takes about 1.7 times as long, a turn 1.9 times, a river 2.1 times. The three EVs sum to the pot on any ranges, and the checks compare every combo's EV with a brute-force enumeration on overlapping ranges.

`exact_removal 0` brings back the faster model that treats the two opponents' ranges as independent of each other given the player's own hand (their overlap with each other is not removed; a showdown is then a product of two one-opponent sweeps). It is exact only when the opponents' ranges share no cards. On the wide ranges below, its three EVs on a river add up to 2% more than the pot (764.8 for a pot of 750).

**Exploitability.** For each player, the gain of a best response against the other two's average strategies, in percent of the starting pot. The solver reports their mean. Three-player CFR has no convergence guarantee; this measures how far the result is from a Nash equilibrium of the tree.

**Chance.** Turn and river solves enumerate every card, with exact suit isomorphism when the board and all three ranges allow it. A flop with every turn and river card does not fit any laptop (59 GB for the slim tree below before leads, about 1.7 times that with them), so flop solves deal an evenly spread subset of turn cards and of river cards per turn. Every rank and suit keeps about its share. Each hand's values are rescaled by the cards it can see. The app's budget is 96 runouts (12 turn cards × 8 river cards) for wide ranges, scaled up for narrower ones (see below); `runouts`, `turn_cards` and `river_cards` change it. Without a budget, the solver picks the most cards that fit `memory_limit_mb`.

## Tree (what the app sends)

| Solve from | Bets (fraction of the pot) | Raises |
| --- | --- | --- |
| Flop | flop: the preflop raiser 1/3, 2/3, 1.5x, the other two 1/3 (a lead); turn and river 2/3 | flop one raise of 2/3 (of the pot after the call); turn and river all-in only |
| Turn | turn and river 1/3, 2/3, 1.5x | turn one raise of 2/3; river all-in only |
| River | 1/3, 2/3, 1.5x | one raise of 2/3 |

- **All-in:** always available as an extra bet or raise, and any bet that would commit over 2/3 of the stack becomes all-in.
- **Raise cap:** one raise per street after the bet. After that, players can only call or fold.
- **Leads:** on the flop the preflop raiser bets any of the three sizes. The other two may bet first too, with one size (1/3 of the pot) or all-in: a donk bet into the raiser, or a bet after the raiser checks. A lead can be raised like any bet. This costs about 1.7 times the memory and time of the tree without leads (measured below); the spec's `leadSizes` turns it on, and a spec without it gives the tree where only the raiser bets first. The app sends leads only when they matter for the decision being solved: the hero is not the preflop raiser (the hero can lead, or acts behind a possible lead), or the real line already has a flop bet by a caller. A raiser hero whom nobody has led into gets the tree without leads, so that solve is not slowed down. `mwLeads: true` or `false` in the app's solve options overrides this either way. The choice is one function, `mwFlopLeads` in `studio/local-solver.js`; setting `MW_LEADS_ALWAYS` there to `true` makes leads the default for every flop. With no preflop raiser among the three, and on later streets, anyone may bet every size.
- **The real line:** amounts already bet on the current street are added at their nodes, next to the tree's own sizes (a lead of half the pot joins the 1/3 lead).
- **Later decisions on the street** are answered from the first solve's tree, which the app keeps up to 160 KB a record. A wide flop with leads has more decisions than fit (79 of 97 kept on the flop measured below; all 57 without leads), so the app keeps the lines most likely to be played and solves again on the rest.

Turn and river solves get the full three sizes because they fit (a 1,600-combo turn takes 1.4 GB). On the flop, the turn and river are slimmer. When the hand reaches the turn, the app solves again from there with the full tree.

## Speed, memory and convergence

Ranges are the app's built-in 6-max 100bb estimates, which are wide: SB 450, BB 770 and BTN 600 weighted combos for BTN opens, SB and BB call.

### What leads and exact removal cost

The same solves before and after, on this repository's 4-core Linux container with **one solver thread** while a chart build held the other cores at low priority. The times are therefore pessimistic, and only the ratios carry over; a repeat of the first row took 265 s and of the last 798 s.

| Flop Ks9h4d, BTN/SB/BB (416, 700, 525), 8 × 6 runouts, 100 iterations | Memory (peak RSS) | Time, 1 thread | Exploitability |
| --- | --- | --- | --- |
| Before: only the raiser bets first, independent removal (`exact_removal 0`) | 743 MB | 262 s | 2.04% |
| Exact removal, no leads (what the app sends for a raiser hero nobody led into) | 743 MB | 445 s (1.70×) | 2.12% |
| Leads, independent removal | 1,273 MB (1.71×) | 449 s (1.72×) | 2.60% |
| Leads and exact removal (what the app sends for a caller hero, or after a lead) | 1,273 MB (1.71×) | 780 s (2.98×) | 2.26% (2.40% on the repeat) |

| Exact removal on later streets | Memory | Before | After |
| --- | --- | --- | --- |
| Turn Ks9h4d2c (415, 688, 520), full turn tree, every river card, 40 iterations | 1,369 MB | 173 s, 10.2% | 321 s (1.86×), 10.5% |
| River Ks9h4d2c7s (403, 657, 505), 200 iterations | 28 MB | 0.84 s, 1.18% | 1.79 s (2.1×), 0.42% |

- **Leads** take the flop from 57 decisions to 97 and the tree from 194,000 nodes to 338,000. In that solve the small blind leads 17% of its range, the big blind bets 7% after the small blind checks, and the button bets 43% when checked to (31% in the tree without leads, where a check from the blinds says nothing). Facing the small blind's lead, the big blind folds 59%, calls 37% and raises 4%.
- **Exact removal** costs time, not memory. Exploitability after the same number of iterations is about the same on the flop and turn, and lower on the river. The button's range-wide strategy after two checks hardly moves (check 69.4%, then 18.5 / 10.1 / 2.0% for the three sizes, against 69.3%, 18.9 / 9.6 / 2.0%), so on these ranges the old model's error was mostly in the EVs: each player's river EV was 3 to 7 chips too high in a pot of 750.
- **Sampled runouts are still not exactly zero-sum.** On the flop above the three EVs add up to 742 with exact removal (757 without) for a pot of 750, because each hand's values are rescaled by the cards it can see among the sampled ones. With every card dealt (turn and river solves) they add up to the pot.
- **Apple Silicon** was not measured. Exact removal's row updates are vector code, 8 floats at a time here (AVX2) and 4 on a Mac, so its share of the time may be larger there.

### Earlier measurements

Measured before leads and exact removal (the first row of the table above), with all 4 cores free (about twice one core's throughput). An M3 Pro with 11 cores should be about 4–5 times faster, as for the PLO solver. For what the app sends now, multiply flop times by about 1.7 without leads (a raiser hero nobody led into) or by about 3 and flop memory by 1.7 with them, turn times by about 1.9 and river times by about 2.

| Spot (combos: first, second, third to act) | Runouts | Memory (peak RSS) | 100 iterations | 200 iterations | 300 iterations |
| --- | --- | --- | --- | --- | --- |
| River Ks9h4d2c7s, BTN/SB/BB (403, 657, 505) | every card | 28 MB | 1.2%, 0.7 s | 1.2%, 1.4 s | 0.06% after 1,000, 6 s |
| Turn Ks9h4d2c, BTN/SB/BB (415, 688, 520), full turn tree | every card | 1.4 GB | 2.7%, 2.7 min | 1.0%, 5.3 min | 0.64%, 7.8 min |
| Flop Ks9h4d, BTN/SB/BB (416, 700, 525) | 12 × 8 | 1.5 GB | 2.2%, 3.3 min | 0.80%, 6.5 min | 0.38%, 9.8 min |
| Flop Ks9h4d, BTN/SB/BB | 8 × 6 | 0.75 GB | 2.0%, 1.8 min | 0.68%, 3.5 min | 0.39%, 5.1 min |
| Flop Ks9h4d, BTN/SB/BB | 16 × 10 | 2.4 GB | 2.1%, 5.4 min | 0.72%, 10.5 min | |
| Flop Jh8h3c, CO/BTN/BB (656, 366, 290) | 12 × 8 | 1.0 GB | 1.5%, 2.5 min | 0.50%, 4.9 min | 0.28%, 7.2 min |
| Flop Ks9h4d, SB squeeze vs CO and BTN (60, 84, 84) | 12 × 8 | 60 MB | 0.53%, 8 s | 0.34%, 14 s | 0.28%, 21 s |

Exploitability is in percent of the pot. Times include the best-response check every 20 iterations.

- **Mac:** at the app's flop target (1% of the pot, about 170 iterations for the widest pots) a BTN/SB/BB flop was estimated at 1.5 to 2 minutes, a turn at about 2 minutes, a river at seconds. Scaled by the ratios above that is 2.5 to 3.5 minutes for a flop without leads, 4.5 to 6 with them, and about 4 for a turn, not yet timed on a Mac. The app's estimates in `studio/spot-ui.js` follow the tree being solved: `MW3_SECONDS` (255, 225 and 20 s for a flop without leads, a turn and a river) and `MW3_LEADS_SECONDS` (450 s for a flop with leads). They start there and correct themselves after each solve.
- **How many runouts** (measured before leads)**:** on the BTN/SB/BB flop the button's strategy after two checks, summed over its range, was 64/21/12/2% (check, 1/3, 2/3, 1.5x) with 48 runouts, 68/19/12/1% with 96, and 72/16/11/2% with 160. Frequencies move a few points between budgets. Single hands' mixes differ more (about 22% between 96 and 160 runouts), mostly among hands close to indifferent. So 96 is a fair working budget for live answers, and a library run should use more where time allows (`--runouts`).
- **Narrow ranges get more runouts.** The app scales the budget with the ranges: 96 runouts for about 1,600 combos in all, proportionally more for narrower ranges, up to every card. A squeeze pot's 230 combos get about 670 runouts and still solve in a few minutes here.
- **Every card on a wide flop** needed about 59 GB before leads (88 GB with three sizes on every street), and about 1.7 times that with them, so it is out of reach of an 18 GB Mac.

## Input

One setting per line. Chips are any unit; the app uses 1/100 bb.

```
game NLH3
board Ks9h4d                 3 to 5 cards
pot 750                      pot at the start of this street
stack 9750                   stack behind, the same for all three
min_bet 100
range0 AsKs,QQ,AJo:0.5,...   player 0 (first to act), then range1, range2
bet flop all 0.33,0.66,1.5   bet sizes (fractions of the pot) for "all" or one player (0, 1, 2), or "none"
bet flop 0 0.33              a later line for one player replaces its sizes: player 0 leads with 1/3 only
raise flop all 0.66          raise sizes: fractions of the pot after calling
cap flop 1                   raises allowed after the bet
lead flop 0 1                player 0 may bet first on the flop (0: it may not)
allin flop 1                 all-in as an extra option on this street
allin_threshold 0.67
path check,to:250            actions already taken on this street ("to" = street total)
exact_removal 1              0: treat the two opponents' ranges as independent (faster, see Card removal)
runouts 96                   at most this many turn x river cards per flop line
turn_cards 12                deal exactly these counts instead (with auto_sample 0)
river_cards 8
threads 8
accuracy 0.5                 stop at this exploitability, % of pot
max_iterations 300
time_limit 1800              seconds
memory_limit_mb 12000
output result.json
```

The solver prints `Iter: N` and `Total exploitability X precent` lines, which the bridge reads for progress, and writes the current street's tree: for every decision, each combo's average strategy, its EV per action (chips from the street's start, net of what it put in, so the three EVs sum to the pot), and its reach. `rootEV` gives each combo's value from the start of the solve for each player, in the same units (the preflop spot solver fits three-way pots to it). `mw_solver --eval` ranks `hole board` lines from stdin.

## Precomputing (library)

`library.cjs` solves flops for common three-way pots and bundles them:

```
node tools/multiway-solver/library.cjs list
node tools/multiway-solver/library.cjs solve --spots btn-sb-bb,co-btn-bb --flops 100 --out multiway-work
node tools/multiway-solver/library.cjs bundle --out multiway-work      # multiway-work/multiway-library.json(.gz)
```

On a Mac, double-click `run-library.command`. Spots: BTN opens and SB and BB call; CO opens and BTN and BB call; HJ opens and CO and BB call; UTG opens and BTN and BB call; and two squeezes (CO opens, BTN calls, then the SB or the BB squeezes and both call). Ranges are the app's built-in preflop estimates, because the chart packs stop at two players to the flop. Options match `tools/postflop/library.cjs`: `--jobs`, `--shard K/N`, `--reverse 1` and `--limit`, plus `--runouts` (default 96). Each flop is saved to `<out>/<spot>/<flop>.json` as it finishes, and a stopped run resumes.

The app doesn't read `multiway-library.json` yet. Answering from it means matching a three-way hand to a spot and flop the way `studio/postflop-library.js` does for heads-up pots.

## Checks (`test.cjs`)

- The evaluator against `studio/game.js` on 200,000 hands.
- A river with every strategy uniform, compared with a brute-force enumeration of every three-hand deal through the solver's own tree: the three EVs and every combo's own EV, on ranges that share no cards (both removal models pass) and on overlapping ranges with two- and three-way ties (exact removal passes; the independence model is off by over 100 chips in a pot of 900, and the check requires that it fails).
- River and turn convergence, zero-sum EVs (on overlapping ranges too), and that nobody folds the nuts.
- Isomorphism on and off.
- The real line in the tree, and bet limits.
- Flop leads: who may bet what first, the answers to a lead, a real lead of another size, and the old tree without `leadSizes`.
- Spec validation.
- Two end-to-end three-way turn solves from the spot solver through the bridge.
