## Telescope preview

This repo is previewed on a phone through Telescope, which syncs the newest `claude/telescope/*` branch into a live preview.

- In cloud sessions, work on a branch named `claude/telescope/<short-task-name>`, cut from the branch you were asked to work on (usually `main`).
- End every turn that changed code with `git commit` and `git push` to that branch, so the preview can sync it.

**The preview uses the production database.** Its accounts point at the same Turso database as the live Render service, so signing up, syncing, deleting an account or changing schema code in a `claude/telescope/*` branch affects real users. The server's startup schema setup (`CREATE TABLE IF NOT EXISTS`, adding columns) also runs against production when the preview starts. Don't add destructive schema changes or test data on these branches without asking. Email keys are not set in the preview, so it sends no emails (password reset won't deliver there).

## All-in labels

Any bet or raise that puts a player all-in reads **"All-in"** everywhere in the app (Analysis rows, Why? reasons, range legends, the action bar, History, grading and hand reports), never a pot share like "Bet 828%" or a bb size. Solver answers that jam at a shallower stack than the real hand (the 3-way solver plays everyone at the shortest stack, libraries are solved at fixed depths) still count as the all-in. Labels go through `isAllInAction` / `toneLabel` in `studio/references-ui.js`; new label code must use them, and new solver mappers should mark their jam with `allIn: true` and target the effective all-in, as the action bar's All-in does.

## Bet size labels

Postflop bets and raises read as a whole percent of the pot everywhere in the app: **33%, 67%, 150%** (and 50%, 75%, 100% and so on), never 1/3, 2/3, 1.5x or "Pot". That covers Analysis rows, Why? reasons, range legends, the action bar presets, the hand builder, flop libraries and Mac or cloud solves. Sizes within a few percent of a standard one snap to it, so a library's 33% and a solve's 34% read the same. Labels go through `potShareLabel` in `studio/references-ui.js` (the action bar keeps the same rule in `share` in `studio/action-bar.js`). Preflop sizes stay as multiples (2.5x, 3x) and history amounts stay in bb.

## Debugging a solve or grading bug: read the hand trace

Every hand the app plays keeps an invisible trace (`studio/hand-trace.js`): which answer each decision used and where it came from (chart, flop/turn library, saved solve, street tree, this device, Mac, server or cloud), why each solve started, every solve job's status change and cancellation (with the reason), finished solves that were not shown (with the reason), and what each decision was graded against. Traces sync with the account as `meta` rows `trace-<device>-<slot>` (a ring of the last 80 hands on each device), so nothing new is shown on screen.

When a bug is reported from a screenshot, read the trace before guessing:

```
node tools/hand-trace.cjs --user <username> --last 5     # newest hands first; match one by cards, board and time
node tools/hand-trace.cjs --user <username> --hand h…    # one hand
```

It only reads (SELECT) and needs `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Cloud sessions don't have them, and the linked-device shell is a sandbox with no network, so start a Remote Control session on Maxam's Mac and run it in `~/Desktop/Poker_Solver/poker_solver` (`git pull && node tools/hand-trace.cjs …`), where `.env.telescope.local` holds them. It needs no npm install. The output flags a spot solved more than once and a finished solve that was never shown or used to grade. In a browser console, `HandTrace.recent()` returns that tab's latest traces, and `--file <json>` formats one.

When you add a new solve route, answer source or grading path, log it with `HandTrace.log(hand, type, {...})` so the trace stays complete.

## Testing the solve flow end to end

`node tools/solve-flow/run.cjs --hands 10 --tables hu,3way` plays real hands in the real app (headless Chromium via Playwright) against local copies of everything a solve passes through: the account server in memory, the real Mac bridge linked to it (with a stand-in TexasSolver, `tools/solve-flow/fake-texassolver.cjs`, and the real 3-way solver), and the cloud played by the bridge in `--once` mode. It never touches production. At the 3-way table another seat opens with a raise in half of the hands (the hero then sees flops as a caller: leading into the raiser, or facing a lead, and pots that go heads-up when one of the three folds mid-street; `--no-opens` keeps every hand a limped pot). It reads each hand's trace and fails on a decision solved twice, a finished solve never shown or used to grade, a solve stuck after the hand, or a page error; traces and a report land in `solve-flow-report/`. `--seed` replays a run. Run it after changing anything in the solve, sync, bridge or grading flow. To hunt for bugs, vary the players: `--tables hu,3way,6max,9max --stacks 4,20,40,100,200,mixed --mode mix --style mix` (follow, aggro, passive or random heroes, cash and ICM), `--out <dir>` for parallel runs, and `--solver tools/local-solver/TexasSolver/install/console_solver` for real TexasSolver answers instead of the stand-in (`bash tools/local-solver/install-linux.sh` builds it in a few minutes, free).

## Funky spots: problems caught without anyone reporting them

`studio/funky-spots.js` checks every hand trace for things that look wrong: a decision solved twice, a finished solve never shown or used to grade, a solve stuck or failed, a Mac or cloud solve that fell through to the app's own exact engine, a decision that never got its grade, two answers for the same decision that disagree a lot, AA/KK folded preflop, frequencies that don't add up, a decision you played that got no grade without the trace saying why (every ungraded decision logs `not graded (<why>)`). The same checks run in the app at the end of each hand, in `tools/solve-flow/run.cjs`, in `tools/hand-trace.cjs`, and on the server.

To review real hands from every account (last 24 h by default, each with its whole trace, grouped by kind):

```
FUNKY_REVIEW_TOKEN=<key> node tools/funky-spots.cjs [--hours 72] [--kind duplicate-solve] [--json]
```

The server (`GET /api/funky-spots`) answers only to the review key. In project threads it is in `/mnt/project-files/funky-spots/review-key` (`FUNKY_REVIEW_TOKEN=$(cat /mnt/project-files/funky-spots/review-key)`); the server holds only its SHA-256 (`REVIEW_KEY_SHA256` in `accounts.cjs`). `FUNKY_REVIEW_TOKEN` on Render or `--print-key` on the Mac also work. Triage each kind from its traces, fix the cause, and when a new kind of bug turns up, add a detector for it in `studio/funky-spots.js` so it is caught automatically next time.

## Every grade says why

Every graded result in Analysis (the "You: …" card after a guess, in Play, Train and Hand replay) shows one short line under the verdict saying why the solver picks its play, and the same line leads the Why? pill when no guess card shows it. Facing a bet or raise it is pot odds against their range: "Call needs 36% · K5s has 35% vs SB’s range · position makes up the rest" (plus "x% of their range dominates it" when that is 15% or more, and a blocker note on raises). First in preflop it is how wide the seat plays and where the hand ranks ("BTN plays 46% here · K5s is top 29% · raises"); postflop without a bet it is the hand line of the Why? pill. Ungraded results keep their "Not graded · <why>" text. The line comes from `decisionWhy(hand, result)` (wording in `SpotWhy.decisionLine`) in `studio/spot-why.js`; new grading or reveal surfaces must show it, and keep it to one line (no-clutter rule).
