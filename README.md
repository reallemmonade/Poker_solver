# Range Lab Poker Studio

This repository contains the browser app and the source needed to build it. Render serves the app as a static site; it does not run the solver or store training data on a server.

## Deploy on Render

Connect this GitHub repository to Render as a Blueprint. The included `render.yaml` builds a small site at `studio/render-site` without bundling the large training collection or saved training checkpoints.

The app runs in the visitor's browser. Models, hand histories, and practice results are saved in that browser's IndexedDB. They do not sync to Render or to another computer. To move them, use the app's export and import controls.

## Run and train locally

Install Node.js, then run `node studio/build.cjs` from this repository's root directory (`work` in the current workspace). Open `outputs/poker-studio.html` in a browser. The normal local build includes the local training collection when `studio/training-pack.json` is present. Browser training and saved models remain on that computer unless exported.

To produce the no-training-data Render build locally, run `node studio/build.cjs --web`; the output is `studio/render-site/index.html`.

## Local-only data

Training collections, generated starter snapshots, raw checkpoints, browser profiles, Mac bundles, and generated outputs are excluded from Git. Keep private or large training data on the machine that trains it, and transfer it separately when needed.
