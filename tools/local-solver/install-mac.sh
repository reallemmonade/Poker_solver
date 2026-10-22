#!/bin/bash
# Builds TexasSolver's command-line solver for the local bridge.
# macOS needs the Xcode command-line tools and Homebrew (for cmake and libomp).
# TexasSolver is AGPL-3.0 and free for personal use; it is downloaded from its
# author's repository and built on this computer, never redistributed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/TexasSolver"
commit=6dfb65b4d7ed081da509e8d8c3d82138c4708267

omp=""
if [ "$(uname)" = Darwin ]; then
  xcode-select -p >/dev/null 2>&1 || { echo "Install the Xcode command-line tools first: xcode-select --install"; exit 1; }
  # An Intel Homebrew in /usr/local on Apple silicon runs under Rosetta and
  # installs x86_64 libraries the arm64 build cannot link, so only use a
  # Homebrew that matches this machine.
  native_brew=false
  if command -v brew >/dev/null; then
    if [ "$(uname -m)" = x86_64 ] || [ "$(brew --prefix)" != /usr/local ]; then native_brew=true; fi
  fi
  if ! command -v cmake >/dev/null; then
    if $native_brew; then brew list cmake >/dev/null 2>&1 || brew install cmake; fi
  fi
  if ! command -v cmake >/dev/null; then
    command -v python3 >/dev/null || { echo "Install Homebrew (https://brew.sh) or Python 3 to get cmake"; exit 1; }
    # setuptools supplies the distutils module TexasSolver's old pybind11 still imports.
    [ -x "$here/.cmake-venv/bin/cmake" ] || { python3 -m venv "$here/.cmake-venv" && "$here/.cmake-venv/bin/pip" install --quiet cmake setuptools; }
    export PATH="$here/.cmake-venv/bin:$PATH"
  fi
  # libomp: $LIBOMP_PREFIX, else a native Homebrew, else a conda install.
  if [ -n "${LIBOMP_PREFIX:-}" ]; then omp="$LIBOMP_PREFIX"
  elif $native_brew; then brew list libomp >/dev/null 2>&1 || brew install libomp; omp="$(brew --prefix libomp)"
  else
    for p in "${CONDA_PREFIX:-}" /opt/anaconda3 /opt/miniconda3 "$HOME/anaconda3" "$HOME/miniconda3" "$HOME/miniforge3" /opt/homebrew/opt/libomp; do
      if [ -n "$p" ] && [ -f "$p/include/omp.h" ] && lipo -archs "$p/lib/libomp.dylib" 2>/dev/null | grep -qw "$(uname -m)"; then omp="$p"; break; fi
    done
  fi
  [ -n "$omp" ] || { echo "No $(uname -m) libomp found. Install a native Homebrew (https://brew.sh) or run: conda install llvm-openmp"; exit 1; }
fi
command -v node >/dev/null || echo "Note: the bridge needs Node.js 18 or later (brew install node)."

if [ ! -d "$src/.git" ]; then
  git clone --branch console https://github.com/bupticybee/TexasSolver.git "$src"
fi
git -C "$src" fetch --quiet origin console || true
git -C "$src" checkout --quiet "$commit"
git -C "$src" submodule update --init --recursive --quiet

# Apple's compiler rejects a bare -fopenmp, and the upstream build pins an old
# macOS target. Link OpenMP through CMake's imported target instead.
cd "$src"
git checkout --quiet -- CMakeLists.txt
sed -i.bak -e 's/ *-fopenmp//g' -e '/CMAKE_OSX_DEPLOYMENT_TARGET/d' CMakeLists.txt
echo 'target_link_libraries(TexasSolver OpenMP::OpenMP_CXX)' >> CMakeLists.txt

flags=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5)
if [ "$(uname)" = Darwin ]; then
  flags+=(-DCMAKE_BUILD_RPATH="$omp/lib" -DOpenMP_C_FLAGS="-Xpreprocessor -fopenmp -I$omp/include" -DOpenMP_C_LIB_NAMES=omp
          -DOpenMP_CXX_FLAGS="-Xpreprocessor -fopenmp -I$omp/include" -DOpenMP_CXX_LIB_NAMES=omp
          -DOpenMP_omp_LIBRARY="$omp/lib/libomp.dylib")
fi
mkdir -p build install
cmake -S . -B build "${flags[@]}"
cmake --build build --target console_solver -j "$( (sysctl -n hw.ncpu 2>/dev/null || nproc) )"
cp build/console_solver install/
rm -rf install/resources && cp -R resources install/resources

echo "Testing the solver on a small river spot..."
cat > build/smoke.txt <<'EOF'
set_pot 100
set_effective_stack 100
set_board Qs,Jh,2h,7c,3d
set_range_ip AA,KK,QQ,AK,QJs
set_range_oop JJ,TT,AQ,KQs,98s
set_bet_sizes oop,river,bet,50
set_bet_sizes ip,river,bet,50
set_bet_sizes oop,river,allin
set_bet_sizes ip,river,allin
build_tree
set_thread_num 2
set_accuracy 1
set_max_iteration 50
start_solve
set_dump_rounds 1
dump_result smoke.json
EOF
(cd build && ../install/console_solver -i smoke.txt --resource_dir ../install/resources >/dev/null)
test -s build/smoke.json && echo "TexasSolver is ready: $src/install/console_solver"
