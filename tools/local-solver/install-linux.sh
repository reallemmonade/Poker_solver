#!/bin/bash
# Builds the solvers on Ubuntu/Debian (tested on 24.04): installs the compiler, cmake, gcc's
# OpenMP and the Python headers TexasSolver's bundled pybind11 configures against, then runs
# install-mac.sh, which builds the PLO solver and the EV-patched TexasSolver the same way on Linux.
#   bash tools/local-solver/install-linux.sh [--plo-only]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sudo=""; [ "$(id -u)" = 0 ] || sudo=sudo
$sudo apt-get update -q
DEBIAN_FRONTEND=noninteractive $sudo apt-get install -yq build-essential cmake git python3 python3-dev python3-setuptools libgomp1
exec bash "$here/install-mac.sh" "$@"
