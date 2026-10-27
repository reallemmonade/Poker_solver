# Citrus Poker

This repository contains the browser app and the source needed to build it. Render serves the study app as a static site and runs a small Node service for private multiplayer rooms. Solver work and training data stay in the browser; multiplayer room state lives in memory on the room service while the table is active.

## Deploy on Render

Connect this GitHub repository to Render as a Blueprint. It keeps the existing `range-lab-poker-studio` static site and adds a `range-lab-live-rooms` Node web service. The multiplayer page calls that room API while staying on the static app's origin, so your existing browser saved data remains on its current site. The room service supports CORS from the configured static origin in `ALLOWED_ORIGINS`.

The Blueprint points the front end to `https://range-lab-live-rooms.onrender.com`. If Render assigns a different service URL, update `MULTIPLAYER_API_ORIGIN` on the static site and `ALLOWED_ORIGINS` on the room service, then redeploy both. Render free web services can sleep while idle; the first request may wait for the service to wake. Open tables use in-memory room state, so redeploys or service restarts close active tables. This is intended for casual friend games, not a persistent poker server.

The study app runs in each visitor's browser. For friend games, Node runs on Render; neither you nor your friends need to install Node on your devices. Models, hand histories, and practice results are saved in that browser's IndexedDB. They do not sync to Render or to another computer. To move them, use the app's export and import controls.

## Find your way around

The main activities are **Play** (bots or friends), **Practice** (full hands, saved drills and progress), and **Study** (the shared decision table, ranges and hand replay). **Library** holds saved spots, hands, reference sources, models and backups. Opening a saved item launches its appropriate activity.

**Settings → Card display & theme** has the looks from Off My Plate (Marigold, the default, Lavender Aurora, Ember Aurora, Aurora, Night Shift and Rosewater) plus the original Classic green, each in light or dark or following the device. Text colours in every look are checked to at least 4.5:1; the table felt stays green in all of them. The chip-slice logo is drawn inline (`CITRUS_MARK` in `studio/interface.js`), and the build copies `studio/apple-touch-icon.png` for phone home screens. Saved data, chart-pack formats and the Render service names still use the old `range-lab` identifiers so nothing already saved or deployed breaks.

Use **Edit game** for seats, shared or individual stacks, positions, bet sizes, antes, rake and tournament details. The same bet-size defaults supply the live action buttons and current-spot solves. Existing saved models retain their original training trees. Advanced model training, resource controls and coverage information are in **Settings**. Practice topics collapse after selection; answers remain hidden during a hand, and full histories remain available. Phones use bottom navigation and a focused layout during practice.

Build with `node studio/build.cjs --web` and run `node studio/verify-interface.cjs` to check navigation, the shared editor, hidden answers, saved analysis replay, backup merging and phone layouts. The check runs on Windows, macOS or Linux with Chrome or Chromium installed; set `CHROME_PATH` if it is somewhere unusual.

## Run and train locally

Install Node.js, then run `node studio/build.cjs --web` from this repository's root directory (`work` in the current workspace). Open `studio/render-site/index.html` in a browser. The same command builds the Render site. It starts without bundled training data; import your study backup or train a model in the browser.

## Study on a laptop and iPhone with iCloud Drive

Open **Library → Backups & Files** in the app. Choose **Study file** to transfer solved spots, hands and assessments without the larger model checkpoints, or **Complete backup** to include saved models and the active model snapshot. Prepare the backup, then share it to Files and choose iCloud Drive, or download it and move it there. The app cannot verify where the operating system saves a file.

On the second device, open the same site, choose **iCloud / Files → Open backup / analysis from Files**, and select the JSON from iCloud Drive. Imports merge records atomically and retain existing device settings. Model policies are whole snapshots, with the more-trained snapshot retained for a matching model; training updates from two devices are not mathematically combined. Repeated imports do not duplicate decisions.

Use **Saved spots** to practice a stored decision with the original frequencies, ranges and values. The app reconstructs its public action history and hides the answer until you act. No solver needs to run on the phone. Only results that pass the existing assessment checks receive a grade. A saved result covers its recorded decision, not every continuation of the hand. Older outputs that cannot be replayed are retained as archives in the backup.

These are manual file transfers, not automatic iCloud synchronization. Export another snapshot after studying to transfer new progress back to the other device. Automatic Apple account sync would require a provisioned CloudKit container and authentication, which are not configured in this app. Solver output and saved model checkpoints are transferable; the temporary calculation tree and unfinished solver state are not persisted.

## Mobile layout and checks

On narrow screens, table setup is collapsed behind a button, navigation scrolls to the selected tab, touch controls are larger, and inputs use 16px text to avoid Safari focus zoom. Safe-area padding accommodates the iPhone screen edges.

## Play with friends

Open **Play with friends** from the app, create a private room, and share its link or twelve-character room code. Friends open the link, enter a name, and join an open seat from their phones. The game is no-limit Hold'em with a half-big-blind small blind, configurable seat count, starting stack and ante. Each player sees only their own private cards; other live hands are revealed at showdown. The server checks turn order, legal actions, card dealing, pot awards and chips. The host deals each next hand; if the host leaves or goes offline, another connected player becomes host. A player who does not act in time (45 seconds, or 15 once their device stops responding) checks or folds and sits out until they tap **Sit back in**. **Leave table** checks or folds your hand and gives up your seat; to get it back, join again with the room code and the same name, and the host lets you in. Tables are temporary and close if the room service restarts or is redeployed.

To run it locally, build the site and multiplayer page, then start the room service with `node server.cjs`. Open `http://localhost:10000` on your computer. For friends on different networks, deploy the Render Blueprint; they cannot connect to a server running only on your computer unless you separately expose it to the internet.

Run `node studio/build.cjs --web`, then `node studio/verify-transfer.cjs` to check transfer and mobile behavior. The check uses installed Chrome and isolated browser profiles. It covers real saved-solve restoration, invalid-file rejection, duplicate merges, phone-to-laptop progress, persistence and widths from 320 to 430 pixels. Platform sharing is mocked and native iCloud/Safari behavior still requires an actual-device check.

## Local-only data

Training collections, generated starter snapshots, raw checkpoints, browser profiles, Mac bundles, and generated outputs are excluded from Git. Keep private or large training data on the machine that trains it, and transfer it separately when needed.
