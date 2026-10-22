# Range Lab Poker Studio

This repository contains the browser app and the source needed to build it. Render serves the study app as a static site and runs a small Node service for private multiplayer rooms. Solver work and training data stay in the browser; multiplayer room state lives in memory on the room service while the table is active.

## Deploy on Render

Connect this GitHub repository to Render as a Blueprint. It keeps the existing `range-lab-poker-studio` static site and adds a `range-lab-live-rooms` Node web service. The multiplayer page calls that room API while staying on the static app's origin, so your existing browser saved data remains on its current site. The room service supports CORS from the configured static origin in `ALLOWED_ORIGINS`.

The Blueprint points the front end to `https://range-lab-live-rooms.onrender.com`. If Render assigns a different service URL, update `MULTIPLAYER_API_ORIGIN` on the static site and `ALLOWED_ORIGINS` on the room service, then redeploy both. Render free web services can sleep while idle; the first request may wait for the service to wake. Open tables use in-memory room state, so redeploys or service restarts close active tables. This is intended for casual friend games, not a persistent poker server.

The study app runs in each visitor's browser. For friend games, Node runs on Render; neither you nor your friends need to install Node on your devices. Models, hand histories, and practice results are saved in that browser's IndexedDB. They do not sync to Render or to another computer. To move them, use the app's export and import controls.

## Run and train locally

Install Node.js, then run `node studio/build.cjs --web` from this repository's root directory (`work` in the current workspace). Open `studio/render-site/index.html` in a browser. The same command builds the Render site. It starts without bundled training data; import your study backup or train a model in the browser.

## Study on a laptop and iPhone with iCloud Drive

Open **iCloud / Files** in the app. Choose **Study file** to transfer solved spots, hands and assessments without the larger model checkpoints, or **Complete backup** to include saved models and the active model snapshot. Prepare the backup, then share it to Files and choose iCloud Drive, or download it and move it there. The app cannot verify where the operating system saves a file.

On the second device, open the same site, choose **iCloud / Files → Open backup / analysis from Files**, and select the JSON from iCloud Drive. Imports merge records atomically and retain existing device settings. Model policies are whole snapshots, with the more-trained snapshot retained for a matching model; training updates from two devices are not mathematically combined. Repeated imports do not duplicate decisions.

Use **Saved spots** to practice a stored decision with the original frequencies, ranges and values. The app reconstructs its public action history and hides the answer until you act. No solver needs to run on the phone. Only results that pass the existing assessment checks receive a grade. A saved result covers its recorded decision, not every continuation of the hand. Older outputs that cannot be replayed are retained as archives in the backup.

These are manual file transfers, not automatic iCloud synchronization. Export another snapshot after studying to transfer new progress back to the other device. Automatic Apple account sync would require a provisioned CloudKit container and authentication, which are not configured in this app. Solver output and saved model checkpoints are transferable; the temporary calculation tree and unfinished solver state are not persisted.

## Mobile layout and checks

On narrow screens, table setup is collapsed behind a button, navigation scrolls to the selected tab, touch controls are larger, and inputs use 16px text to avoid Safari focus zoom. Safe-area padding accommodates the iPhone screen edges.

## Play with friends

Open **Play with friends** from the app, create a private room, and share its link or eight-character room code. Friends open the link, enter a name, and join an open seat from their phones. The game is no-limit Hold'em with a half-big-blind small blind, configurable seat count, starting stack and ante. Each player sees only their own private cards; other live hands are revealed at showdown. The server checks turn order, legal actions, card dealing, pot awards and chips. The host deals each next hand. Tables are temporary and close if the room service restarts or is redeployed.

To run it locally, build the site and multiplayer page, then start the room service with `node server.cjs`. Open `http://localhost:10000` on your computer. For friends on different networks, deploy the Render Blueprint; they cannot connect to a server running only on your computer unless you separately expose it to the internet.

Run `node studio/build.cjs --web`, then `node studio/verify-transfer.cjs` to check transfer and mobile behavior. The check uses installed Chrome and isolated browser profiles. It covers real saved-solve restoration, invalid-file rejection, duplicate merges, phone-to-laptop progress, persistence and widths from 320 to 430 pixels. Platform sharing is mocked and native iCloud/Safari behavior still requires an actual-device check.

## Local-only data

Training collections, generated starter snapshots, raw checkpoints, browser profiles, Mac bundles, and generated outputs are excluded from Git. Keep private or large training data on the machine that trains it, and transfer it separately when needed.
