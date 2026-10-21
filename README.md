# Range Lab Poker Studio

This repository contains the browser app and the source needed to build it. Render serves the app as a static site; it does not run the solver or store training data on a server.

## Deploy on Render

Connect this GitHub repository to Render as a Blueprint. The included `render.yaml` builds a small site at `studio/render-site` without bundling the large training collection or saved training checkpoints.

The app runs in the visitor's browser. Models, hand histories, and practice results are saved in that browser's IndexedDB. They do not sync to Render or to another computer. To move them, use the app's export and import controls.

## Run and train locally

Install Node.js, then run `node studio/build.cjs --web` from this repository's root directory (`work` in the current workspace). Open `studio/render-site/index.html` in a browser. The same command builds the Render site. It starts without bundled training data; import your study backup or train a model in the browser.

## Study on a laptop and iPhone with iCloud Drive

Open **iCloud / Files** in the app. Choose **Study file** to transfer solved spots, hands and assessments without the larger model checkpoints, or **Complete backup** to include saved models and the active model snapshot. Prepare the backup, then share it to Files and choose iCloud Drive, or download it and move it there. The app cannot verify where the operating system saves a file.

On the second device, open the same site, choose **iCloud / Files → Open backup / analysis from Files**, and select the JSON from iCloud Drive. Imports merge records atomically and retain existing device settings. Model policies are whole snapshots, with the more-trained snapshot retained for a matching model; training updates from two devices are not mathematically combined. Repeated imports do not duplicate decisions.

Use **Saved spots** to practice a stored decision with the original frequencies, ranges and values. The app reconstructs its public action history and hides the answer until you act. No solver needs to run on the phone. Only results that pass the existing assessment checks receive a grade. A saved result covers its recorded decision, not every continuation of the hand. Older outputs that cannot be replayed are retained as archives in the backup.

These are manual file transfers, not automatic iCloud synchronization. Export another snapshot after studying to transfer new progress back to the other device. Automatic Apple account sync would require a provisioned CloudKit container and authentication, which are not configured in this app. Solver output and saved model checkpoints are transferable; the temporary calculation tree and unfinished solver state are not persisted.

## Mobile layout and checks

On narrow screens, table setup is collapsed behind a button, navigation scrolls to the selected tab, touch controls are larger, and inputs use 16px text to avoid Safari focus zoom. Safe-area padding accommodates the iPhone screen edges.

Run `node studio/build.cjs --web`, then `node studio/verify-transfer.cjs` to check transfer and mobile behavior. The check uses installed Chrome and isolated browser profiles. It covers real saved-solve restoration, invalid-file rejection, duplicate merges, phone-to-laptop progress, persistence and widths from 320 to 430 pixels. Platform sharing is mocked and native iCloud/Safari behavior still requires an actual-device check.

## Local-only data

Training collections, generated starter snapshots, raw checkpoints, browser profiles, Mac bundles, and generated outputs are excluded from Git. Keep private or large training data on the machine that trains it, and transfer it separately when needed.
