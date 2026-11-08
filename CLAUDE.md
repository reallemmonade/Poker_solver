## Telescope preview

This repo is previewed on a phone through Telescope, which syncs the newest `claude/telescope/*` branch into a live preview.

- In cloud sessions, work on a branch named `claude/telescope/<short-task-name>`, cut from the branch you were asked to work on (usually `main`).
- End every turn that changed code with `git commit` and `git push` to that branch, so the preview can sync it.

**The preview uses the production database.** Its accounts point at the same Turso database as the live Render service, so signing up, syncing, deleting an account or changing schema code in a `claude/telescope/*` branch affects real users. The server's startup schema setup (`CREATE TABLE IF NOT EXISTS`, adding columns) also runs against production when the preview starts. Don't add destructive schema changes or test data on these branches without asking. Email keys are not set in the preview, so it sends no emails (password reset won't deliver there).

## All-in labels

Any bet or raise that puts a player all-in reads **"All-in"** everywhere in the app (Analysis rows, Why? reasons, range legends, the action bar, History, grading and hand reports), never a pot share like "Bet 828%" or a bb size. Solver answers that jam at a shallower stack than the real hand (the 3-way solver plays everyone at the shortest stack, libraries are solved at fixed depths) still count as the all-in. Labels go through `isAllInAction` / `toneLabel` in `studio/references-ui.js`; new label code must use them, and new solver mappers should mark their jam with `allIn: true` and target the effective all-in, as the action bar's All-in does.

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

`node tools/solve-flow/run.cjs --hands 10 --tables hu,3way` plays real hands in the real app (headless Chromium via Playwright) against local copies of everything a solve passes through: the account server in memory, the real Mac bridge linked to it (with a stand-in TexasSolver, `tools/solve-flow/fake-texassolver.cjs`, and the real 3-way solver), and the cloud played by the bridge in `--once` mode. It never touches production. It reads each hand's trace and fails on a decision solved twice, a finished solve never shown or used to grade, a solve stuck after the hand, or a page error; traces and a report land in `solve-flow-report/`. `--seed` replays a run. Run it after changing anything in the solve, sync, bridge or grading flow.
