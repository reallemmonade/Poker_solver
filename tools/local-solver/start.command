#!/bin/bash
# Double-click on a Mac to start the local solver bridge. Keep this window open
# while you study; close it to stop.
cd "$(dirname "$0")/../.."
exec node tools/local-solver/server.cjs "$@"
