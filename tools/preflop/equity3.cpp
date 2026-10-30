// Three-way all-in equity of every ordered triple of the 169 hold'em hand classes, for the
// preflop spot solver (tools/preflop/spot.cjs), which pays three-way flop pots from it.
//   c++ -O3 -std=c++17 -pthread -o equity3 equity3.cpp
//   equity3 classes.txt samples out.bin [threads]
// classes.txt holds the class labels in the order of equity-table.json, one per line. Each
// unordered triple is sampled `samples` times (random combos of each class that share no
// card, then a random board), ties split. out.bin is K*K*K little-endian uint16, entry
// (i*K+j)*K+k the equity of class i against j and k, times 65535.
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
using namespace std;
typedef uint64_t u64;
[[noreturn]] static void fail(const string& m) { throw runtime_error(m); }
// ---------- evaluator: dense rank of every 5-card set, then the best of 21 in 7 cards
static uint32_t BN[53][6];
static vector<uint16_t> R5;
static uint32_t eval5slow(const int* c) {
  int cnt[13] = {0}; bool flush = true;
  for (int i = 0; i < 5; i++) { cnt[c[i] >> 2]++; if ((c[i] & 3) != (c[0] & 3)) flush = false; }
  int sh = -1;
  for (int hi = 12; hi >= 3 && sh < 0; hi--) { bool ok = true; for (int k = 0; k < 5 && ok; k++) { int r = hi - k; if (r < 0) r = 12; ok = cnt[r] > 0; } if (ok) sh = hi; }
  int ord[5], n = 0;
  for (int k = 4; k >= 1; k--) for (int r = 12; r >= 0; r--) if (cnt[r] == k) ord[n++] = r;
  uint32_t kick = 0; for (int i = 0; i < 5; i++) kick = kick * 13 + (i < n ? ord[i] : 0);
  int cat = sh >= 0 && flush ? 8 : cnt[ord[0]] == 4 ? 7 : cnt[ord[0]] == 3 && n == 2 ? 6 : flush ? 5 : sh >= 0 ? 4 : cnt[ord[0]] == 3 ? 3 : cnt[ord[0]] == 2 && cnt[ord[1]] == 2 ? 2 : cnt[ord[0]] == 2 ? 1 : 0;
  if (cat == 8 || cat == 4) kick = sh;
  return cat * 371293u + kick;
}
static int SUB7[21][5];
static void initEval() {
  for (int n = 0; n <= 52; n++) { BN[n][0] = 1; for (int k = 1; k <= 5; k++) BN[n][k] = n == 0 ? 0 : BN[n - 1][k - 1] + BN[n - 1][k]; }
  vector<uint32_t> raw(BN[52][5]); int c[5];
  for (c[4] = 4; c[4] < 52; c[4]++) for (c[3] = 3; c[3] < c[4]; c[3]++) for (c[2] = 2; c[2] < c[3]; c[2]++) for (c[1] = 1; c[1] < c[2]; c[1]++) for (c[0] = 0; c[0] < c[1]; c[0]++)
    raw[BN[c[0]][1] + BN[c[1]][2] + BN[c[2]][3] + BN[c[3]][4] + BN[c[4]][5]] = eval5slow(c);
  vector<uint32_t> v(raw); sort(v.begin(), v.end()); v.erase(unique(v.begin(), v.end()), v.end());
  R5.resize(raw.size());
  for (size_t i = 0; i < raw.size(); i++) R5[i] = lower_bound(v.begin(), v.end(), raw[i]) - v.begin() + 1;
  int k = 0; for (int a = 0; a < 7; a++) for (int b = a + 1; b < 7; b++) { int z = 0; for (int i = 0; i < 7; i++) if (i != a && i != b) SUB7[k][z++] = i; k++; }
}
// Best five of seven cards; the cards must be sorted ascending.
static inline uint16_t eval7(const int* s) {
  uint16_t best = 0;
  for (auto& q : SUB7) { uint16_t r = R5[BN[s[q[0]]][1] + BN[s[q[1]]][2] + BN[s[q[2]]][3] + BN[s[q[3]]][4] + BN[s[q[4]]][5]]; if (r > best) best = r; }
  return best;
}
static inline uint16_t holdem(int a, int b, const int* board) {
  int s[7] = {a, b, board[0], board[1], board[2], board[3], board[4]};
  sort(s, s + 7); return eval7(s);
}

static const char* RANKS = "23456789TJQKA";
static vector<array<int, 2>> combosOf(const string& c) {
  int a = strchr(RANKS, c[0]) - RANKS, b = strchr(RANKS, c[1]) - RANKS; vector<array<int, 2>> out;
  for (int s = 0; s < 4; s++) for (int t = 0; t < 4; t++) {
    if (a == b ? t <= s : c.size() == 3 && (c[2] == 's' ? s != t : s == t)) continue;
    out.push_back({4 * a + s, 4 * b + t});
  }
  return out;
}
struct Rng { u64 s; u64 next() { s ^= s << 13; s ^= s >> 7; s ^= s << 17; return s; } int below(int n) { return (int)(next() % (u64)n); } };
int main(int argc, char** argv) {
  try {
    if (argc < 4) { fprintf(stderr, "usage: equity3 classes.txt samples out.bin [threads]\n"); return 1; }
    initEval();
    vector<string> cls; { ifstream f(argv[1]); string s; while (f >> s) cls.push_back(s); }
    const int K = cls.size(), S = atoi(argv[2]), T = argc > 4 ? max(1, atoi(argv[4])) : max(1u, thread::hardware_concurrency());
    if (K != 169 || S < 1) fail("Need 169 classes and at least one sample.");
    vector<vector<array<int, 2>>> cb(K); for (int i = 0; i < K; i++) { cb[i] = combosOf(cls[i]); if (cb[i].empty()) fail("Bad class " + cls[i]); }
    vector<uint16_t> out((size_t)K * K * K);
    atomic<int> nextI(0);
    auto work = [&]() {
      for (int i; (i = nextI++) < K;) {
        Rng rng{0x9E3779B97F4A7C15ull ^ (u64)(i + 1) * 0x100000001B3ull};
        for (int j = i; j < K; j++) for (int k = j; k < K; k++) {
          double eq[3] = {0, 0, 0}; int n = 0;
          for (int t = 0; t < S * 4 && n < S; t++) {
            auto x = cb[i][rng.below(cb[i].size())], y = cb[j][rng.below(cb[j].size())], z = cb[k][rng.below(cb[k].size())];
            u64 used = 1ull << x[0] | 1ull << x[1];
            if (used >> y[0] & 1 || used >> y[1] & 1) continue; used |= 1ull << y[0] | 1ull << y[1];
            if (used >> z[0] & 1 || used >> z[1] & 1) continue; used |= 1ull << z[0] | 1ull << z[1];
            int deck[46], m = 0; for (int c = 0; c < 52; c++) if (!(used >> c & 1)) deck[m++] = c;
            int board[5]; for (int b = 0; b < 5; b++) { int r = b + rng.below(m - b); swap(deck[b], deck[r]); board[b] = deck[b]; }
            int v[3] = {holdem(x[0], x[1], board), holdem(y[0], y[1], board), holdem(z[0], z[1], board)}, best = max(v[0], max(v[1], v[2])), w = (v[0] == best) + (v[1] == best) + (v[2] == best);
            for (int p = 0; p < 3; p++) if (v[p] == best) eq[p] += 1. / w;
            n++;
          }
          // Triples that can't be dealt together (AA three times) never reach a pot; they get a third each.
          for (int p = 0; p < 3; p++) eq[p] = n ? eq[p] / n : 1. / 3;
          int id[3] = {i, j, k};
          for (int a = 0; a < 3; a++) for (int b = 0; b < 3; b++) for (int c = 0; c < 3; c++) if (a != b && b != c && a != c)
            out[((size_t)id[a] * K + id[b]) * K + id[c]] = (uint16_t)lround(eq[a] * 65535);
        }
      }
    };
    vector<thread> th; for (int t = 0; t < T; t++) th.emplace_back(work); for (auto& t : th) t.join();
    FILE* f = fopen(argv[3], "wb"); if (!f) fail("Cannot write the output.");
    fwrite(out.data(), 2, out.size(), f); fclose(f);
    printf("Wrote %d^3 three-way equities (%d samples per triple).\n", K, S);
    return 0;
  } catch (exception& e) { fprintf(stderr, "Error: %s\n", e.what()); return 2; }
}
