## Telescope preview

This repo is previewed on a phone through Telescope, which syncs the newest `claude/telescope/*` branch into a live preview.

- In cloud sessions, work on a branch named `claude/telescope/<short-task-name>`, cut from the branch you were asked to work on (usually `main`).
- End every turn that changed code with `git commit` and `git push` to that branch, so the preview can sync it.

**The preview uses the production database.** Its accounts point at the same Turso database as the live Render service, so signing up, syncing, deleting an account or changing schema code in a `claude/telescope/*` branch affects real users. The server's startup schema setup (`CREATE TABLE IF NOT EXISTS`, adding columns) also runs against production when the preview starts. Don't add destructive schema changes or test data on these branches without asking. Email keys are not set in the preview, so it sends no emails (password reset won't deliver there).

## All-in labels

Any bet or raise that puts a player all-in reads **"All-in"** everywhere in the app (Analysis rows, Why? reasons, range legends, the action bar, History, grading and hand reports), never a pot share like "Bet 828%" or a bb size. Solver answers that jam at a shallower stack than the real hand (the 3-way solver plays everyone at the shortest stack, libraries are solved at fixed depths) still count as the all-in. Labels go through `isAllInAction` / `toneLabel` in `studio/references-ui.js`; new label code must use them, and new solver mappers should mark their jam with `allIn: true` and target the effective all-in, as the action bar's All-in does.
