# Three-way NLH postflop solver (mw_solver)

`mw_solver` solves no-limit Hold'em pots with exactly three players from the flop, turn or river. It runs on your Mac (or any Linux box) through the local bridge, the same way TexasSolver answers heads-up spots and `plo_solver` answers PLO. TexasSolver is heads-up only, and the app's own multiway engines (`studio/multiway-exact.js`, `studio/spot-solver.js`) don't settle on wide ranges within the bridge's 30 minutes.

```
c++ -O3 -std=c++17 -pthread -march=native -o mw_solver mw_solver.cpp   # or: bash tools/local-solver/install-mac.sh --plo-only
mw_solver input.txt
node tools/multiway-solver/test.cjs        # checks, about 2 minutes on 4 cores
```

## What it solves

**Players.** Three players in postflop order: player 0 acts first on every street, then 1, then 2. All three play the same stack behind (the app sends the smallest of the three). Folded players' chips from earlier streets are dead money in the pot.

**Ranges.** Exact weighted two-card combos (or hand classes such as `AKs:0.5`), up to 1,326 each.

**Algorithm.** Discounted CFR with alternating updates, in vector form over every combo, multi-threaded. The discount parameters are α = 3, β = 0, γ = 4, not the heads-up default (1.5, 0, 2): on a three-way turn the default stalls near 1.5% of the pot after 300 iterations, and these settings reach 0.35% (measured, below).

**Card removal.** Each player's cards are removed exactly against the board and against each opponent's range. The two opponents' ranges are treated as independent of each other given the player's own hand: their overlap with each other is not removed. That is what turns a three-way showdown into a product of two one-opponent sweeps, so a leaf costs O(combos) instead of O(combos × 52). When the opponents' ranges share no cards, the model is exact, and the checks confirm the three EVs sum to the pot.

**Exploitability.** For each player, the gain of a best response against the other two's average strategies, in percent of the starting pot. The solver reports their mean. Three-player CFR has no convergence guarantee; this measures how far the result is from a Nash equilibrium of the tree.

**Chance.** Turn and river solves enumerate every card, with exact suit isomorphism when the board and all three ranges allow it. A flop with every turn and river card does not fit any laptop (59 GB for the slim tree below, 88 GB with three flop sizes), so flop solves deal an evenly spread subset of turn cards and of river cards per turn. Every rank and suit keeps about its share. Each hand's values are rescaled by the cards it can see. The app's budget is 96 runouts (12 turn cards × 8 river cards); `runouts`, `turn_cards` and `river_cards` change it. Without a budget, the solver picks the most cards that fit `memory_limit_mb`.

## Tree (what the app sends)

| Solve from | Bets (fraction of the pot) | Raises |
| --- | --- | --- |
| Flop | flop 1/3, 2/3, 1.5x; turn and river 2/3 | flop one raise of 2/3 (of the pot after the call); turn and river all-in only |
| Turn | turn and river 1/3, 2/3, 1.5x | turn one raise of 2/3; river all-in only |
| River | 1/3, 2/3, 1.5x | one raise of 2/3 |

- **All-in:** always available as an extra bet or raise, and any bet that would commit over 2/3 of the stack becomes all-in.
- **Raise cap:** one raise per street after the bet. After that, players can only call or fold.
- **Leads:** on the flop only the preflop raiser may bet first, so there are no donk bets into the raiser. On later streets anyone may bet.
- **The real line:** amounts already bet on the current street are added at their nodes, including a lead the tree leaves out.

Turn and river solves get the full three sizes because they fit (a 1,600-combo turn takes 1.4 GB). On the flop, the turn and river are slimmer. When the hand reaches the turn, the app solves again from there with the full tree.

## Speed, memory and convergence

Measured on this repository's 4-core Linux container (about twice one core's throughput). An M3 Pro with 11 cores should be about 4–5 times faster, as for the PLO solver. Ranges are the app's built-in 6-max 100bb estimates, which are wide: SB 450, BB 770 and BTN 600 weighted combos for BTN opens, SB and BB call.

MEASUREMENTS

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
raise flop all 0.66          raise sizes: fractions of the pot after calling
cap flop 1                   raises allowed after the bet
lead flop 0 0                player 0 may not bet first on the flop
allin flop 1                 all-in as an extra option on this street
allin_threshold 0.67
path check,to:250            actions already taken on this street ("to" = street total)
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

The solver prints `Iter: N` and `Total exploitability X precent` lines, which the bridge reads for progress, and writes the current street's tree: for every decision, each combo's average strategy, its EV per action (chips from the street's start, net of what it put in, so the three EVs sum to the pot), and its reach. `mw_solver --eval` ranks `hole board` lines from stdin.

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
- A river with every strategy uniform, compared with a brute-force enumeration of every three-hand deal through the solver's own tree.
- River and turn convergence, zero-sum EVs, and that nobody folds the nuts.
- Isomorphism on and off.
- The real line in the tree, and bet limits.
- Spec validation.
- Two end-to-end three-way turn solves from the spot solver through the bridge.
