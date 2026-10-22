#!/bin/bash
# Builds TexasSolver's command-line solver for the local bridge.
# macOS needs the Xcode command-line tools and Homebrew (for cmake and libomp).
# TexasSolver is AGPL-3.0 and free for personal use; it is downloaded from its
# author's repository and built on this computer, never redistributed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/TexasSolver"
commit=6dfb65b4d7ed081da509e8d8c3d82138c4708267

if [ "$(uname)" = Darwin ]; then
  xcode-select -p >/dev/null 2>&1 || { echo "Install the Xcode command-line tools first: xcode-select --install"; exit 1; }
  command -v brew >/dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
  brew list cmake >/dev/null 2>&1 || brew install cmake
  brew list libomp >/dev/null 2>&1 || brew install libomp
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

flags=(-DCMAKE_BUILD_TYPE=Release)
if [ "$(uname)" = Darwin ]; then
  omp="$(brew --prefix libomp)"
  flags+=(-DOpenMP_C_FLAGS="-Xpreprocessor -fopenmp -I$omp/include" -DOpenMP_C_LIB_NAMES=omp
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
