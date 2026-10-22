// PLO4 preflop equity sampler for the bucketed hand model (plo-model.cjs).
//   g++ -O3 -march=native -pthread -o plo-equity plo-equity.cpp
//   plo-equity classes <reps.txt> <samples> <threads>        equity of each class vs a random hand
//   plo-equity matrix <buckets.bin> <K> <samples> <threads>  bucket-vs-bucket compatibility and equity
// Cards are 0..51 with rank = c>>2 (0 = deuce) and suit = c&3, as in studio/game.js.
// Combos are indexed in colex order of their sorted cards: C(a,1)+C(b,2)+C(c,3)+C(d,4).
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>
#include <vector>
using namespace std;

static uint32_t binom[53][6];
static vector<uint16_t> rank5;  // hand value of every 5-card set, colex index; higher is better

static uint32_t eval5slow(const int* c) {
  int r[5], s[5], cnt[13] = {0};
  for (int i = 0; i < 5; i++) r[i] = c[i] >> 2, s[i] = c[i] & 3, cnt[r[i]]++;
  bool flush = s[0] == s[1] && s[1] == s[2] && s[2] == s[3] && s[3] == s[4];
  int straightHi = -1;
  for (int hi = 12; hi >= 3; hi--) {
    bool ok = true;
    for (int k = 0; k < 5; k++) { int rr = hi - k; if (rr < 0) rr = 12; if (!cnt[rr]) { ok = false; break; } }
    if (ok) { straightHi = hi; break; }
  }
  // Ranks ordered by (count, rank) descending give the kickers.
  int order[5], n = 0;
  for (int k = 4; k >= 1; k--) for (int rr = 12; rr >= 0; rr--) if (cnt[rr] == k) order[n++] = rr;
  uint32_t kick = 0;
  for (int i = 0; i < n; i++) kick = kick * 13 + order[i];
  for (int i = n; i < 5; i++) kick *= 13;
  int cat;
  if (straightHi >= 0 && flush) cat = 8;
  else if (cnt[order[0]] == 4) cat = 7;
  else if (cnt[order[0]] == 3 && n == 2) cat = 6;
  else if (flush) cat = 5;
  else if (straightHi >= 0) cat = 4;
  else if (cnt[order[0]] == 3) cat = 3;
  else if (cnt[order[0]] == 2 && cnt[order[1]] == 2) cat = 2;
  else if (cnt[order[0]] == 2) cat = 1;
  else cat = 0;
  if (cat == 8 || cat == 4) kick = straightHi;
  return cat * 371293u + kick;
}

static void init() {
  for (int n = 0; n <= 52; n++) { binom[n][0] = 1; for (int k = 1; k <= 5; k++) binom[n][k] = n == 0 ? 0 : binom[n - 1][k - 1] + binom[n - 1][k]; }
  // Compress raw values to dense ranks so they fit in 16 bits.
  vector<uint32_t> raw(binom[52][5]);
  int c[5];
  for (c[4] = 4; c[4] < 52; c[4]++) for (c[3] = 3; c[3] < c[4]; c[3]++) for (c[2] = 2; c[2] < c[3]; c[2]++)
    for (c[1] = 1; c[1] < c[2]; c[1]++) for (c[0] = 0; c[0] < c[1]; c[0]++)
      raw[binom[c[0]][1] + binom[c[1]][2] + binom[c[2]][3] + binom[c[3]][4] + binom[c[4]][5]] = eval5slow(c);
  vector<uint32_t> values(raw);
  sort(values.begin(), values.end());
  values.erase(unique(values.begin(), values.end()), values.end());
  rank5.resize(raw.size());
  for (size_t i = 0; i < raw.size(); i++) rank5[i] = lower_bound(values.begin(), values.end(), raw[i]) - values.begin();
}

static inline uint32_t idx5(int a, int b, int c, int d, int e) {
  // Sort five small ints.
  int v[5] = {a, b, c, d, e};
  for (int i = 1; i < 5; i++) { int x = v[i], j = i - 1; while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; } v[j + 1] = x; }
  return binom[v[0]][1] + binom[v[1]][2] + binom[v[2]][3] + binom[v[3]][4] + binom[v[4]][5];
}

// Omaha value: exactly two hole cards and three board cards.
static inline int omaha(const int* h, const int* b) {
  static const int P[6][2] = {{0, 1}, {0, 2}, {0, 3}, {1, 2}, {1, 3}, {2, 3}};
  static const int T[10][3] = {{0, 1, 2}, {0, 1, 3}, {0, 1, 4}, {0, 2, 3}, {0, 2, 4}, {0, 3, 4}, {1, 2, 3}, {1, 2, 4}, {1, 3, 4}, {2, 3, 4}};
  int best = 0;
  for (auto& p : P) for (auto& t : T) { int v = rank5[idx5(h[p[0]], h[p[1]], b[t[0]], b[t[1]], b[t[2]])]; if (v > best) best = v; }
  return best;
}

struct Rng { uint64_t s; uint64_t next() { s += 0x9e3779b97f4a7c15ull; uint64_t z = s; z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull; z = (z ^ (z >> 27)) * 0x94d049bb133111ebull; return z ^ (z >> 31); } int below(int n) { return (int)((next() >> 33) % n); } };

// Draws `count` distinct cards not in `used` (a 64-bit mask), adding them to it.
static inline void draw(Rng& r, uint64_t& used, int* out, int count) {
  for (int i = 0; i < count;) { int c = r.below(52); if (used >> c & 1) continue; used |= 1ull << c; out[i++] = c; }
}

static vector<array<int, 4>> combos;
static void enumerate() {
  combos.reserve(binom[52][4]);
  for (int d = 3; d < 52; d++) for (int c = 2; c < d; c++) for (int b = 1; b < c; b++) for (int a = 0; a < b; a++) combos.push_back({a, b, c, d});
}

static void classes(const char* file, int samples, int threads) {
  vector<array<int, 4>> reps;
  FILE* f = fopen(file, "r");
  array<int, 4> h;
  while (fscanf(f, "%d %d %d %d", &h[0], &h[1], &h[2], &h[3]) == 4) reps.push_back(h);
  fclose(f);
  vector<double> eq(reps.size());
  vector<thread> pool;
  for (int t = 0; t < threads; t++) pool.emplace_back([&, t] {
    Rng r{0x1234567ull + t * 7919ull};
    for (size_t i = t; i < reps.size(); i += threads) {
      double won = 0;
      for (int s = 0; s < samples; s++) {
        uint64_t used = 0; for (int c : reps[i]) used |= 1ull << c;
        int v[4], b[5]; draw(r, used, v, 4); draw(r, used, b, 5);
        int x = omaha(reps[i].data(), b), y = omaha(v, b);
        won += x > y ? 1 : x == y ? .5 : 0;
      }
      eq[i] = won / samples;
    }
  });
  for (auto& p : pool) p.join();
  for (double e : eq) printf("%.5f\n", e);
}

static void matrix(const char* file, int K, int samples, int threads) {
  vector<uint16_t> bucket(combos.size());
  FILE* f = fopen(file, "rb");
  if (fread(bucket.data(), 2, bucket.size(), f) != bucket.size()) { fprintf(stderr, "short bucket file\n"); exit(1); }
  fclose(f);
  vector<vector<int>> members(K);
  for (size_t i = 0; i < combos.size(); i++) members[bucket[i]].push_back(i);
  // Exact compatibility: average over a bucket's combos of the share of all
  // 194,580 opposing combos that are both disjoint and in bucket j, by inclusion-exclusion.
  vector<double> compat((size_t)K * K, 0);
  {
    vector<int> c1(52 * K, 0), c2(1326 * K, 0), c3(22100 * K, 0), size(K, 0);
    auto i2 = [](int a, int b) { return binom[a][1] + binom[b][2]; };
    auto i3 = [](int a, int b, int c) { return binom[a][1] + binom[b][2] + binom[c][3]; };
    for (size_t i = 0; i < combos.size(); i++) {
      auto& h = combos[i]; int k = bucket[i]; size[k]++;
      for (int a = 0; a < 4; a++) { c1[h[a] * K + k]++; for (int b = a + 1; b < 4; b++) { c2[i2(h[a], h[b]) * K + k]++; for (int c = b + 1; c < 4; c++) c3[i3(h[a], h[b], h[c]) * K + k]++; } }
    }
    vector<thread> pool;
    vector<vector<double>> part(threads, vector<double>((size_t)K * K, 0));
    for (int t = 0; t < threads; t++) pool.emplace_back([&, t] {
      vector<int> d(K);
      for (size_t i = t; i < combos.size(); i += threads) {
        auto& h = combos[i]; int k = bucket[i];
        for (int j = 0; j < K; j++) d[j] = size[j] + (j == k);  // the -1 for combos sharing all four cards
        for (int a = 0; a < 4; a++) {
          const int* p1 = &c1[h[a] * K]; for (int j = 0; j < K; j++) d[j] -= p1[j];
          for (int b = a + 1; b < 4; b++) {
            const int* p2 = &c2[i2(h[a], h[b]) * K]; for (int j = 0; j < K; j++) d[j] += p2[j];
            for (int c = b + 1; c < 4; c++) { const int* p3 = &c3[i3(h[a], h[b], h[c]) * K]; for (int j = 0; j < K; j++) d[j] -= p3[j]; }
          }
        }
        auto& out = part[t];
        for (int j = 0; j < K; j++) out[(size_t)k * K + j] += d[j];
      }
    });
    for (auto& p : pool) p.join();
    for (int k = 0; k < K; k++) for (int j = 0; j < K; j++) {
      double s = 0; for (int t = 0; t < threads; t++) s += part[t][(size_t)k * K + j];
      compat[(size_t)k * K + j] = s / size[k] / 194580.0;
    }
  }
  // Equity by sampling: for each ordered bucket pair, disjoint member pairs and a random board.
  vector<double> eq((size_t)K * K, .5);
  vector<thread> pool;
  for (int t = 0; t < threads; t++) pool.emplace_back([&, t] {
    Rng r{0xabcdefull + t * 104729ull};
    for (int i = t; i < K; i += threads) for (int j = i; j < K; j++) {
      if (compat[(size_t)i * K + j] <= 0) continue;
      double won = 0; int n = 0;
      for (int s = 0; s < samples;) {
        auto& a = combos[members[i][r.below(members[i].size())]];
        auto& b = combos[members[j][r.below(members[j].size())]];
        uint64_t used = 0, ub = 0; for (int c : a) used |= 1ull << c; for (int c : b) ub |= 1ull << c;
        if (used & ub) continue;
        used |= ub; int bd[5]; draw(r, used, bd, 5);
        int x = omaha(a.data(), bd), y = omaha(b.data(), bd);
        won += x > y ? 1 : x == y ? .5 : 0; n++; s++;
      }
      eq[(size_t)i * K + j] = won / n; eq[(size_t)j * K + i] = 1 - won / n;
    }
  });
  for (auto& p : pool) p.join();
  for (int i = 0; i < K; i++) { for (int j = 0; j < K; j++) printf("%s%.6g", j ? " " : "", compat[(size_t)i * K + j]); printf("\n"); }
  for (int i = 0; i < K; i++) { for (int j = 0; j < K; j++) printf("%s%.4f", j ? " " : "", eq[(size_t)i * K + j]); printf("\n"); }
}

int main(int argc, char** argv) {
  init(); enumerate();
  if (argc >= 5 && !strcmp(argv[1], "classes")) classes(argv[2], atoi(argv[3]), atoi(argv[4]));
  else if (argc >= 6 && !strcmp(argv[1], "matrix")) matrix(argv[2], atoi(argv[3]), atoi(argv[4]), atoi(argv[5]));
  else { fprintf(stderr, "usage: see header\n"); return 1; }
}
