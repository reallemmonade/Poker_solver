// Heads-up pot-limit Omaha (4 cards, high only) postflop solver for Range Lab.
// Discounted CFR (alpha 1.5, beta 0, gamma 2) in vector form over explicit weighted
// combos, from the flop, turn or river. Turn and river cards are enumerated exactly;
// suit isomorphism (exact, not an approximation) is used when the board and both
// ranges are symmetric under a suit swap. Exploitability is an exact best response.
//   c++ -O3 -std=c++17 -pthread -o plo_solver plo_solver.cpp
//   plo_solver input.txt        solve; the input format is in tools/local-solver/README.md
//   plo_solver --eval           read "hole board" lines on stdin, print Omaha hand ranks
// Players: 0 = out of position (acts first on every street), 1 = in position.
// Chips are the caller's units. Every value is a player's net result from the
// current street's start: chips won from the pot minus chips put in since then,
// so both players' values sum to the starting pot.
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <map>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>
#include <sys/resource.h>
using namespace std;
typedef uint64_t u64;
[[noreturn]] static void fail(const string& m) { throw runtime_error(m); }
static const char* RANKS = "23456789TJQKA";
static const char* SUITS = "cdhs";

// ---------- evaluator: dense rank of every 5-card set, then 2 hole + 3 board
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
static void initEval() {
  for (int n = 0; n <= 52; n++) { BN[n][0] = 1; for (int k = 1; k <= 5; k++) BN[n][k] = n == 0 ? 0 : BN[n - 1][k - 1] + BN[n - 1][k]; }
  vector<uint32_t> raw(BN[52][5]); int c[5];
  for (c[4] = 4; c[4] < 52; c[4]++) for (c[3] = 3; c[3] < c[4]; c[3]++) for (c[2] = 2; c[2] < c[3]; c[2]++) for (c[1] = 1; c[1] < c[2]; c[1]++) for (c[0] = 0; c[0] < c[1]; c[0]++)
    raw[BN[c[0]][1] + BN[c[1]][2] + BN[c[2]][3] + BN[c[3]][4] + BN[c[4]][5]] = eval5slow(c);
  vector<uint32_t> v(raw); sort(v.begin(), v.end()); v.erase(unique(v.begin(), v.end()), v.end());
  R5.resize(raw.size());
  for (size_t i = 0; i < raw.size(); i++) R5[i] = lower_bound(v.begin(), v.end(), raw[i]) - v.begin() + 1;
}
static inline uint16_t omaha(const uint8_t* h, const int* b) {
  static const int P[6][2] = {{0, 1}, {0, 2}, {0, 3}, {1, 2}, {1, 3}, {2, 3}}, T[10][3] = {{0, 1, 2}, {0, 1, 3}, {0, 1, 4}, {0, 2, 3}, {0, 2, 4}, {0, 3, 4}, {1, 2, 3}, {1, 2, 4}, {1, 3, 4}, {2, 3, 4}};
  uint16_t best = 0;
  for (auto& p : P) for (auto& t : T) {
    int v[5] = {h[p[0]], h[p[1]], b[t[0]], b[t[1]], b[t[2]]};
    for (int i = 1; i < 5; i++) { int x = v[i], j = i - 1; while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; } v[j + 1] = x; }
    uint16_t r = R5[BN[v[0]][1] + BN[v[1]][2] + BN[v[2]][3] + BN[v[3]][4] + BN[v[4]][5]]; if (r > best) best = r;
  }
  return best;
}
static vector<int> parseCards(string s) {
  string t; for (char ch : s) if (!isspace((unsigned char)ch) && ch != ',') t += ch;
  if (t.size() % 2) fail("Invalid cards: " + s);
  vector<int> out; u64 seen = 0;
  for (size_t i = 0; i < t.size(); i += 2) {
    const char* r = strchr(RANKS, toupper(t[i])); const char* su = strchr(SUITS, tolower(t[i + 1]));
    if (!r || !su || !*r || !*su) fail("Invalid card: " + t.substr(i, 2));
    int c = 4 * (r - RANKS) + (su - SUITS); if (seen >> c & 1) fail("Duplicate card: " + t.substr(i, 2)); seen |= 1ull << c; out.push_back(c);
  }
  return out;
}
static string cardName(int c) { return string(1, RANKS[c >> 2]) + SUITS[c & 3]; }

// ---------- input
struct Step { int kind; double to; };  // kind 1 check, 2 call, 3 bet/raise to `to` (street total)
struct Cfg {
  vector<int> board; double pot = 0, stack = 0, minBet = 1, thr = .67;
  vector<pair<array<int, 4>, double>> range[2];
  vector<double> bet[3][2], raise[3][2]; int cap[3] = {2, 3, 3};
  vector<Step> path; int threads = 4, maxIt = 300, every = 10; double acc = .5, timeLimit = 1e9, memMB = 1e9; string out = "result.json"; bool iso = true, shrink = true;
};
static vector<double> nums(const string& s) { vector<double> v; string t; stringstream ss(s); while (getline(ss, t, ',')) if (!t.empty()) { char* e; double x = strtod(t.c_str(), &e); if (*e || !isfinite(x) || x <= 0 || x > 100) fail("Invalid size list: " + s); v.push_back(x); } return v; }
static int streetIdx(const string& s) { if (s == "flop") return 0; if (s == "turn") return 1; if (s == "river") return 2; fail("Invalid street: " + s); }
static int whoIdx(const string& s) { if (s == "oop") return 0; if (s == "ip") return 1; fail("Invalid player: " + s); }
static Cfg readCfg(const char* file) {
  ifstream f(file); if (!f) fail(string("Cannot read ") + file);
  Cfg c; string line; bool sized = false;
  auto num = [](const string& s, double lo, double hi) { char* e; double x = strtod(s.c_str(), &e); if (s.empty() || *e || !isfinite(x) || x < lo || x > hi) fail("Invalid number: " + s); return x; };
  while (getline(f, line)) {
    stringstream ss(line); string k; if (!(ss >> k) || k[0] == '#') continue;
    vector<string> a; string t; while (ss >> t) a.push_back(t);
    auto need = [&](size_t n) { if (a.size() != n) fail("Bad line: " + line); };
    if (k == "game") { need(1); if (a[0] != "PLO4") fail("Only PLO4 is supported."); }
    else if (k == "board") { need(1); c.board = parseCards(a[0]); if (c.board.size() < 3 || c.board.size() > 5) fail("The board needs 3 to 5 cards."); }
    else if (k == "pot") { need(1); c.pot = num(a[0], 1e-6, 1e9); }
    else if (k == "stack") { need(1); c.stack = num(a[0], 0, 1e10); }
    else if (k == "min_bet") { need(1); c.minBet = num(a[0], 1e-6, 1e9); }
    else if (k == "allin_threshold") { need(1); c.thr = num(a[0], .05, 1); }
    else if (k == "range_oop" || k == "range_ip") {
      need(1); int p = k == "range_ip"; stringstream rs(a[0]); string tok;
      while (getline(rs, tok, ',')) { if (tok.empty()) continue; size_t col = tok.find(':'); double w = col == string::npos ? 1 : num(tok.substr(col + 1), 0, 1); auto cs = parseCards(tok.substr(0, col)); if (cs.size() != 4) fail("A PLO combo needs 4 cards: " + tok); if (w <= 0) continue; sort(cs.begin(), cs.end()); c.range[p].push_back({{cs[0], cs[1], cs[2], cs[3]}, w}); }
    }
    else if (k == "bet" || k == "raise") { need(3); auto& v = (k == "bet" ? c.bet : c.raise)[streetIdx(a[0])][whoIdx(a[1])]; v = a[2] == "none" ? vector<double>() : nums(a[2]); if (v.size() > 6) fail("At most 6 sizes."); sized = true; }
    else if (k == "cap") { need(2); c.cap[streetIdx(a[0])] = (int)num(a[1], 0, 8); }
    else if (k == "path") { for (auto& s : a) { stringstream ps(s); string st; while (getline(ps, st, ',')) { if (st == "check") c.path.push_back({1, 0}); else if (st == "call") c.path.push_back({2, 0}); else if (!st.compare(0, 3, "to:")) c.path.push_back({3, num(st.substr(3), 1e-6, 1e10)}); else if (!st.empty()) fail("Invalid path step: " + st); } } if (c.path.size() > 16) fail("Path too long."); }
    else if (k == "threads") { need(1); c.threads = (int)num(a[0], 1, 256); }
    else if (k == "accuracy") { need(1); c.acc = num(a[0], 0, 100); }
    else if (k == "max_iterations") { need(1); c.maxIt = (int)num(a[0], 1, 100000); }
    else if (k == "print_interval") { need(1); c.every = (int)num(a[0], 1, 100000); }
    else if (k == "time_limit") { need(1); c.timeLimit = num(a[0], 1, 1e7); }
    else if (k == "memory_limit_mb") { need(1); c.memMB = num(a[0], 1, 1e8); }
    else if (k == "isomorphism") { need(1); c.iso = a[0] != "0"; }
    else if (k == "auto_shrink") { need(1); c.shrink = a[0] != "0"; }
    else if (k == "output") { need(1); c.out = a[0]; }
    else fail("Unknown input line: " + k);
  }
  if (c.board.size() < 3) fail("Missing board.");
  if (c.pot <= 0) fail("Missing pot.");
  if (!sized) for (int s = 0; s < 3; s++) for (int p = 0; p < 2; p++) { c.bet[s][p] = {s == 0 ? .33 : s == 1 ? .66 : .75}; c.raise[s][p] = {1}; }
  return c;
}

// ---------- combos with the card subsets used for exact card removal
struct Cb { uint8_t c[4]; uint16_t p2[6], t3[4]; u64 m; int same; float w; };
static int N[2]; static vector<Cb> CB[2];
static vector<float> W[2];
// Weight of opposing combos that share no card with h, by inclusion-exclusion over
// the 1-, 2-, 3- and 4-card subsets of h. The 4-card term is the identical combo.
struct Acc {
  double a0 = 0, a1[52], a2[1326]; vector<double> a3;
  Acc() : a3(22100, 0.) { memset(a1, 0, sizeof a1); memset(a2, 0, sizeof a2); }
  inline void add(const Cb& o, double w) { a0 += w; for (int k = 0; k < 4; k++) a1[o.c[k]] += w; for (int k = 0; k < 6; k++) a2[o.p2[k]] += w; for (int k = 0; k < 4; k++) a3[o.t3[k]] += w; }
  inline void clear(const Cb& o) { for (int k = 0; k < 4; k++) a1[o.c[k]] = 0; for (int k = 0; k < 6; k++) a2[o.p2[k]] = 0; for (int k = 0; k < 4; k++) a3[o.t3[k]] = 0; }
  inline double q(const Cb& h) const { double s = a0; for (int k = 0; k < 4; k++) s -= a1[h.c[k]]; for (int k = 0; k < 6; k++) s += a2[h.p2[k]]; for (int k = 0; k < 4; k++) s -= a3[h.t3[k]]; return s; }
};

// ---------- thread pool; tasks never nest
static thread_local int TID = 0; static thread_local bool INPAR = false;
struct Pool {
  int n = 1; vector<thread> th; mutex mu; condition_variable cv, cvd; function<void(int)> job; int jobs = 0, gen = 0, busy = 0; atomic<int> next{0}; bool quit = false;
  void start(int k) { n = k; for (int i = 1; i < k; i++) th.emplace_back([this, i] { TID = i; INPAR = true; int seen = 0; for (;;) { unique_lock<mutex> l(mu); cv.wait(l, [&] { return quit || gen != seen; }); if (quit) return; seen = gen; l.unlock(); work(); l.lock(); if (--busy == 0) cvd.notify_all(); } }); }
  void work() { for (int i; (i = next.fetch_add(1)) < jobs;) job(i); }
  void run(int k, const function<void(int)>& f) {
    if (n <= 1 || k <= 1 || INPAR) { for (int i = 0; i < k; i++) f(i); return; }
    { lock_guard<mutex> l(mu); job = f; jobs = k; next = 0; busy = n - 1; gen++; }
    cv.notify_all(); INPAR = true; work(); INPAR = false;
    unique_lock<mutex> l(mu); cvd.wait(l, [&] { return busy == 0; });
  }
  ~Pool() { { lock_guard<mutex> l(mu); quit = true; } cv.notify_all(); for (auto& t : th) t.join(); }
} pool;

// ---------- tree
enum { ACT, CHANCE, FOLD, SHOW };
struct Node { uint8_t type, actor, nA, cur; int32_t kid, aux; float x[2]; int64_t off; int32_t last; };
struct Act { uint8_t kind, allin; float to; };  // kind 0 fold 1 check 2 call 3 bet 4 raise
struct Deal { uint8_t card, slot, sig; };
struct Chance { vector<uint8_t> slots; vector<Deal> deals; int denom; };
static vector<Node> T; static vector<int32_t> KID; static vector<Act> ACTS; static vector<Chance> CH;
static map<u64, int> BOARDID; static vector<u64> BOARDS;
static int64_t STORE = 0; static int DEPTH = 0, MAXA = 0;
static Cfg cfg; static int ROOT_STREET; static u64 ROOT_MASK;
static vector<array<int, 4>> SIG;           // suit permutations that keep the ranges unchanged
static vector<vector<int32_t>> PERM[2];      // combo index of sigma(h), per sigma
static int cap[3]; static long STAT[3][4];

static inline int mapCard(int c, const array<int, 4>& s) { return (c & ~3) | s[c & 3]; }
static u64 mapMask(u64 m, const array<int, 4>& s) { u64 r = 0; for (int c = 0; c < 52; c++) if (m >> c & 1) r |= 1ull << mapCard(c, s); return r; }

struct St { int street; double pot, c[2], s[2], lastInc, X[2]; int toAct, raises, nAct, pathK; bool onPath; u64 board; };
static int build(const St& st, int depth);
static int leaf(int type, int actor, const St& st, int depth) {
  Node n{}; n.type = type; n.actor = actor; n.x[0] = st.X[0]; n.x[1] = st.X[1]; n.cur = st.street == ROOT_STREET;
  if (type == SHOW) { auto it = BOARDID.find(st.board); if (it == BOARDID.end()) { it = BOARDID.emplace(st.board, (int)BOARDS.size()).first; BOARDS.push_back(st.board); } n.aux = it->second; }
  STAT[st.street][type]++; DEPTH = max(DEPTH, depth); T.push_back(n); return T.size() - 1;
}
// Street over: showdown on the river, otherwise deal the next card (all of them
// with no betting left when someone is all-in).
static int streetEnd(St st, int depth) {
  if (st.street == 2) return leaf(SHOW, 0, st, depth);
  Chance ch; int cnt = __builtin_popcountll(st.board); ch.denom = 52 - cnt - 8;
  vector<int> group; for (int g = 0; g < (int)SIG.size(); g++) if (mapMask(st.board, SIG[g]) == st.board) group.push_back(g);
  vector<int> slotOf(52, -1);
  for (int c = 0; c < 52; c++) {
    if (st.board >> c & 1) continue;
    int rep = c, sg = 0;
    for (int g : group) { int m = mapCard(c, SIG[g]); if (m < rep) rep = m, sg = g; }
    if (slotOf[rep] < 0) { slotOf[rep] = ch.slots.size(); ch.slots.push_back(rep); }
    ch.deals.push_back({(uint8_t)c, (uint8_t)slotOf[rep], (uint8_t)sg});
  }
  STAT[st.street][CHANCE]++; Node n{}; n.type = CHANCE; n.x[0] = st.X[0]; n.x[1] = st.X[1]; n.aux = CH.size(); CH.push_back(ch);
  T.push_back(n); int id = T.size() - 1; int k0 = KID.size(); T[id].kid = k0;
  for (size_t k = 0; k < CH[n.aux].slots.size(); k++) { KID.push_back(-1); ACTS.push_back({}); }
  auto slots = CH[n.aux].slots;
  for (size_t k = 0; k < slots.size(); k++) {
    St nx = st; nx.board |= 1ull << slots[k]; nx.street++; nx.c[0] = nx.c[1] = 0; nx.lastInc = 0; nx.raises = 0; nx.nAct = 0; nx.toAct = 0; nx.onPath = false;
    int child = st.s[0] <= 0 || st.s[1] <= 0 ? streetEnd(nx, depth + 1) : build(nx, depth + 1);
    KID[k0 + k] = child;
  }
  return id;
}
static int build(const St& st, int depth) {
  int p = st.toAct, q = 1 - p; double facing = st.c[q] - st.c[p];
  const Step* step = st.onPath && st.pathK < (int)cfg.path.size() ? &cfg.path[st.pathK] : nullptr;
  vector<Act> acts;
  if (facing > 0) { acts.push_back({0, 0, 0}); acts.push_back({2, (uint8_t)(st.s[p] <= facing), (float)(st.c[p] + min(facing, st.s[p]))}); }
  else acts.push_back({1, 0, (float)st.c[p]});
  if (step && step->kind == 1 && facing > 0) fail("The action path checks facing a bet.");
  if (step && step->kind == 2 && facing <= 0) fail("The action path calls with no bet to call.");
  if (st.s[p] > facing && st.s[q] > 0) {
    double allinTo = st.c[p] + st.s[p], potTo = st.c[q] + st.pot + facing, hi = min(potTo, allinTo), lo = st.c[q] + max(facing > 0 ? st.lastInc : 0., cfg.minBet);
    vector<double> to;
    auto put = [&](double t) {
      if (t > hi) t = hi;
      if (t < lo) t = lo > hi ? (hi == allinTo ? hi : -1) : lo;
      if (t < 0) return;
      if (st.X[p] + t - st.c[p] > cfg.thr * cfg.stack) t = hi;  // commits most of the stack: go to the maximum
      t = t >= allinTo - 1e-9 ? allinTo : round(t); if (t <= st.c[q]) return;
      for (double u : to) { if (fabs(u - t) < .5) return; }
      to.push_back(t);
    };
    if (facing <= 0 || st.raises < cap[st.street]) for (double f : (facing > 0 ? cfg.raise : cfg.bet)[st.street][p]) put(st.c[q] + f * (st.pot + facing));
    if (step && step->kind == 3) {
      double t = step->to; if (t > hi + 1e-6) fail("The action path has a bet above the pot limit."); if (t <= st.c[q]) fail("The action path has a raise below the current bet.");
      t = t >= allinTo - 1e-9 ? allinTo : t; bool have = false; for (double u : to) have |= fabs(u - t) < .5; if (!have) to.push_back(t);
    }
    sort(to.begin(), to.end());
    for (double t : to) acts.push_back({(uint8_t)(facing > 0 ? 4 : 3), (uint8_t)(t >= allinTo), (float)t});
  } else if (step && step->kind == 3) fail("The action path raises when no raise is possible.");
  int A = acts.size(); MAXA = max(MAXA, A); STAT[st.street][ACT]++;
  Node n{}; n.type = ACT; n.actor = p; n.nA = A; n.x[0] = st.X[0]; n.x[1] = st.X[1]; n.cur = st.street == ROOT_STREET; n.off = STORE; STORE += 2LL * A * N[p];
  T.push_back(n); int id = T.size() - 1; int k0 = KID.size(); T[id].kid = k0; DEPTH = max(DEPTH, depth);
  for (int a = 0; a < A; a++) { KID.push_back(-1); ACTS.push_back(acts[a]); }
  for (int a = 0; a < A; a++) {
    const Act& x = acts[a]; St nx = st; nx.nAct++;
    bool match = step && ((step->kind == 1 && x.kind == 1) || (step->kind == 2 && x.kind == 2) || (step->kind == 3 && x.kind >= 3 && fabs(x.to - (step->to >= st.c[p] + st.s[p] - 1e-9 ? st.c[p] + st.s[p] : step->to)) < .5));
    nx.onPath = match; nx.pathK = st.pathK + (match ? 1 : 0);
    int child;
    if (x.kind == 0) child = leaf(FOLD, p, st, depth + 1);
    else if (x.kind == 1) { if (p == 0 && st.nAct == 0) { nx.toAct = 1; child = build(nx, depth + 1); } else child = streetEnd(nx, depth + 1); }
    else if (x.kind == 2) { double pay = x.to - st.c[p]; nx.c[p] += pay; nx.s[p] -= pay; nx.X[p] += pay; nx.pot += pay; child = streetEnd(nx, depth + 1); }
    else { double pay = x.to - st.c[p]; nx.lastInc = max(st.lastInc, x.to - st.c[q]); nx.c[p] = x.to; nx.s[p] -= pay; nx.X[p] += pay; nx.pot += pay; nx.raises += facing > 0; nx.toAct = q; child = build(nx, depth + 1); }
    KID[k0 + a] = child;
  }
  return id;
}

// ---------- showdown data per river board: combos sorted by Omaha rank
struct Board { vector<uint16_t> idx[2], rk[2]; };
static vector<Board> BD;
static void prepBoards() {
  BD.assign(BOARDS.size(), Board());
  pool.run(BOARDS.size(), [&](int b) {
    int bc[5], k = 0; for (int c = 0; c < 52; c++) if (BOARDS[b] >> c & 1) bc[k++] = c;
    for (int p = 0; p < 2; p++) {
      vector<pair<uint16_t, uint16_t>> v; v.reserve(N[p]);
      for (int h = 0; h < N[p]; h++) if (!(CB[p][h].m & BOARDS[b])) v.push_back({omaha(CB[p][h].c, bc), (uint16_t)h});
      sort(v.begin(), v.end());
      for (auto& x : v) { BD[b].rk[p].push_back(x.first); BD[b].idx[p].push_back(x.second); }
    }
  });
}

// ---------- per-thread scratch
struct Scratch { Acc acc; vector<float> buf; size_t top = 0; vector<double> L, LT; float* get(size_t n) { n = (n + 7) & ~7ull; if (top + n > buf.size()) fail("Internal scratch overflow."); float* r = buf.data() + top; top += n; return r; } };
static vector<Scratch*> SCR; static size_t SCRATCH_FLOATS;
static Scratch& scr() { return *SCR[TID]; }
struct Frame { Scratch& s; size_t t; Frame() : s(scr()), t(s.top) {} ~Frame() { s.top = t; } };

static vector<float> MEM;  // regrets then strategy sums, per action node
enum Mode { CFR, BR, EV };
struct Ctx { int p; Mode m; int it; };
struct Rec { vector<float> v, norm; };
static map<int, Rec> REC;

// Opposing weight compatible with each of p's combos: out[h] = sum of ro over disjoint combos.
static void compat(int p, const float* ro, double* out) {
  int q = 1 - p; Acc& A = scr().acc;
  for (int o = 0; o < N[q]; o++) if (ro[o] > 0) A.add(CB[q][o], ro[o]);
  for (int h = 0; h < N[p]; h++) { const Cb& c = CB[p][h]; out[h] = max(0., A.q(c) + (c.same >= 0 ? ro[c.same] : 0)); }
  for (int o = 0; o < N[q]; o++) if (ro[o] > 0) A.clear(CB[q][o]);
  A.a0 = 0;
}
// Opposing weight that p's combos beat (L), beat or tie (LT) and that is compatible
// at all (All) on a river board: one sweep in rank order. Shared by every terminal
// child of a node where p acts, since they all see the same opposing reach.
static void stats(int board, int p, const float* ro, double* L, double* LT, double* All) {
  if (board < 0) { compat(p, ro, All); return; }
  int q = 1 - p; const Board& b = BD[board]; Acc& A = scr().acc;
  const auto &ip = b.idx[p], &rp = b.rk[p], &iq = b.idx[q], &rq = b.rk[q];
  size_t np = ip.size(), nq = iq.size(), j = 0, i = 0;
  memset(L, 0, sizeof(double) * N[p]); memset(LT, 0, sizeof(double) * N[p]); memset(All, 0, sizeof(double) * N[p]);
  while (i < np) {
    uint16_t r = rp[i]; size_t e = i; while (e < np && rp[e] == r) e++;
    for (; j < nq && rq[j] < r; j++) { int o = iq[j]; if (ro[o] > 0) A.add(CB[q][o], ro[o]); }
    for (size_t k = i; k < e; k++) L[ip[k]] = A.q(CB[p][ip[k]]);
    bool ties = false; for (; j < nq && rq[j] == r; j++) { int o = iq[j]; if (ro[o] > 0) A.add(CB[q][o], ro[o]), ties = true; }
    if (ties) for (size_t k = i; k < e; k++) { const Cb& c = CB[p][ip[k]]; LT[ip[k]] = A.q(c) + (c.same >= 0 ? ro[c.same] : 0); }
    else for (size_t k = i; k < e; k++) LT[ip[k]] = L[ip[k]];
    i = e;
  }
  for (; j < nq; j++) { int o = iq[j]; if (ro[o] > 0) A.add(CB[q][o], ro[o]); }
  for (size_t k = 0; k < np; k++) { int h = ip[k]; const Cb& c = CB[p][h]; double l = max(0., L[h]), lt = max(l, LT[h]); L[h] = l; LT[h] = lt; All[h] = max(lt, A.q(c) + (c.same >= 0 ? ro[c.same] : 0)); }
  for (size_t k = 0; k < nq; k++) { int o = iq[k]; if (ro[o] > 0) A.clear(CB[q][o]); }
  A.a0 = 0;
}
static void leafValue(const Node& n, int p, const double* L, const double* LT, const double* All, float* out) {
  int q = 1 - p, H = N[p]; const double P = cfg.pot;
  if (n.type == FOLD) { double u = n.actor == p ? -n.x[p] : P + n.x[q]; for (int h = 0; h < H; h++) out[h] = u * All[h]; return; }
  const double win = P + n.x[q], lose = -n.x[p], tie = (P + n.x[q] - n.x[p]) / 2;
  for (int h = 0; h < H; h++) out[h] = win * L[h] + tie * (LT[h] - L[h]) + lose * (All[h] - LT[h]);
}
// Current (regret-matching) or average strategy of the node's actor, [a][h].
static void strategy(const Node& n, bool average, float* sg) {
  int A = n.nA, H = N[n.actor]; const float* R = MEM.data() + n.off; const float* S = R + (size_t)A * H;
  for (int h = 0; h < H; h++) {
    double t = 0;
    if (average) { for (int a = 0; a < A; a++) t += S[a * H + h]; if (t > 1e-12) { for (int a = 0; a < A; a++) sg[a * H + h] = S[a * H + h] / t; continue; } }
    t = 0; for (int a = 0; a < A; a++) t += max(0.f, R[a * H + h]);
    for (int a = 0; a < A; a++) sg[a * H + h] = t > 0 ? max(0.f, R[a * H + h]) / t : 1.f / A;
  }
}
static void walk(int ni, const Ctx& X, const float* rp, const float* ro, float* out) {
  const Node& n = T[ni]; int p = X.p, q = 1 - p, Np = N[p], Nq = N[q];
  if (n.type == FOLD || n.type == SHOW) {
    Frame f; double *L = (double*)f.s.get(2 * Np), *LT = (double*)f.s.get(2 * Np), *All = (double*)f.s.get(2 * Np);
    stats(n.type == SHOW ? n.aux : -1, p, ro, L, LT, All); leafValue(n, p, L, LT, All, out); return;
  }
  if (n.type == CHANCE) {
    const Chance& ch = CH[n.aux]; int S = ch.slots.size(); float inv = 1.f / ch.denom;
    memset(out, 0, sizeof(float) * Np);
    auto one = [&](int k, float* v, float* rp2, float* ro2) {
      u64 m = 1ull << ch.slots[k];
      if (rp2) for (int h = 0; h < Np; h++) rp2[h] = CB[p][h].m & m ? 0 : rp[h];
      for (int o = 0; o < Nq; o++) ro2[o] = CB[q][o].m & m ? 0 : ro[o];
      walk(KID[n.kid + k], X, rp2, ro2, v);
      for (int h = 0; h < Np; h++) if (CB[p][h].m & m) v[h] = 0;
    };
    auto gather = [&](int k, const float* v) {
      for (const Deal& d : ch.deals) if (d.slot == k) {
        if (SIG.empty() || d.card == ch.slots[k]) { for (int h = 0; h < Np; h++) out[h] += v[h] * inv; }
        else { const int32_t* pm = PERM[p][d.sig].data(); for (int h = 0; h < Np; h++) out[h] += v[pm[h]] * inv; }
      }
    };
    if (!INPAR && pool.n > 1 && S > 1) {
      vector<float> buf((size_t)S * (2 * Np + Nq));
      pool.run(S, [&](int k) { float* b = buf.data() + (size_t)k * (2 * Np + Nq); one(k, b, rp ? b + Np : nullptr, b + 2 * Np); });
      for (int k = 0; k < S; k++) gather(k, buf.data() + (size_t)k * (2 * Np + Nq));
    } else {
      Frame f; float *v = f.s.get(Np), *rp2 = rp ? f.s.get(Np) : nullptr, *ro2 = f.s.get(Nq);
      for (int k = 0; k < S; k++) { one(k, v, rp2, ro2); gather(k, v); }
    }
    return;
  }
  int A = n.nA; Frame f;
  if (n.actor == p) {
    float *sg = f.s.get((size_t)A * Np), *vals = f.s.get((size_t)A * Np), *crp = X.m == CFR ? f.s.get(Np) : nullptr;
    strategy(n, X.m != CFR, sg);
    double *L = nullptr, *LT = nullptr, *All = nullptr;
    for (int a = 0; a < A; a++) {
      const Node& c = T[KID[n.kid + a]];
      if (c.type == FOLD || c.type == SHOW) {
        if (!All || (c.type == SHOW && !L)) {
          int board = -1; for (int b = 0; b < A; b++) if (T[KID[n.kid + b]].type == SHOW) board = T[KID[n.kid + b]].aux;
          L = (double*)f.s.get(2 * Np); LT = (double*)f.s.get(2 * Np); All = (double*)f.s.get(2 * Np); stats(board, p, ro, L, LT, All);
        }
        leafValue(c, p, L, LT, All, vals + (size_t)a * Np); continue;
      }
      if (crp) for (int h = 0; h < Np; h++) crp[h] = rp[h] * sg[a * Np + h];
      walk(KID[n.kid + a], X, crp, ro, vals + (size_t)a * Np);
    }
    if (X.m == BR) { for (int h = 0; h < Np; h++) { float b = vals[h]; for (int a = 1; a < A; a++) b = max(b, vals[a * Np + h]); out[h] = b; } return; }
    for (int h = 0; h < Np; h++) { double s = 0; for (int a = 0; a < A; a++) s += sg[a * Np + h] * vals[a * Np + h]; out[h] = s; }
    if (X.m == EV) {
      if (n.cur) { Rec& r = REC[ni]; r.v.assign(vals, vals + (size_t)A * Np); vector<double> c(Np); compat(p, ro, c.data()); r.norm.assign(c.begin(), c.end()); }
      return;
    }
    // Discounted CFR, applied lazily for the iterations since this node's last update.
    Node& m = T[ni]; int t = X.it, lt = m.last; double dp = 1, dn = 1, th = lt ? pow((double)lt / t, 2) : 0;
    for (int k = lt; k >= 1 && k < t; k++) { double x = pow((double)k, 1.5); dp *= x / (x + 1); dn *= .5; }
    float *R = MEM.data() + n.off, *Sm = R + (size_t)A * Np;
    for (int a = 0; a < A; a++) for (int h = 0; h < Np; h++) {
      size_t k = (size_t)a * Np + h; float r = R[k]; R[k] = r * (r > 0 ? dp : dn) + vals[k] - out[h];
      Sm[k] = Sm[k] * th + rp[h] * sg[k];
    }
    m.last = t;
    return;
  }
  float *sg = f.s.get((size_t)A * Nq), *cro = f.s.get(Nq), *tmp = f.s.get(Np);
  strategy(n, X.m != CFR, sg); memset(out, 0, sizeof(float) * Np);
  for (int a = 0; a < A; a++) {
    bool any = false; for (int o = 0; o < Nq; o++) { cro[o] = ro[o] * sg[a * Nq + o]; any |= cro[o] > 0; }
    if (!any && !(X.m == EV && n.cur)) continue;  // no opposing reach: this branch is worth nothing to p
    walk(KID[n.kid + a], X, rp, cro, tmp);
    for (int h = 0; h < Np; h++) out[h] += tmp[h];
  }
}

// ---------- setup
static double Z;  // total weight of compatible (oop, ip) pairs
static void setupCombos() {
  ROOT_MASK = 0; for (int c : cfg.board) ROOT_MASK |= 1ull << c;
  for (int p = 0; p < 2; p++) {
    map<array<int, 4>, double> m; for (auto& x : cfg.range[p]) { u64 mk = 0; for (int c : x.first) mk |= 1ull << c; if (mk & ROOT_MASK) continue; m[x.first] = max(m[x.first], x.second); }
    if (m.empty()) fail(string("The ") + (p ? "in-position" : "out-of-position") + " range is empty on this board.");
    if (m.size() > 60000) fail("A range has more than 60000 combos.");
    CB[p].clear(); W[p].clear();
    for (auto& x : m) {
      Cb c{}; auto& v = x.first; for (int k = 0; k < 4; k++) c.c[k] = v[k], c.m |= 1ull << v[k];
      int z = 0; for (int i = 0; i < 4; i++) for (int j = i + 1; j < 4; j++) c.p2[z++] = BN[v[i]][1] + BN[v[j]][2];
      z = 0; for (int i = 0; i < 4; i++) for (int j = i + 1; j < 4; j++) for (int k = j + 1; k < 4; k++) c.t3[z++] = BN[v[i]][1] + BN[v[j]][2] + BN[v[k]][3];
      c.w = x.second; CB[p].push_back(c); W[p].push_back(x.second);
    }
    N[p] = CB[p].size();
  }
  unordered_map<u64, int> look[2]; for (int p = 0; p < 2; p++) for (int h = 0; h < N[p]; h++) look[p][CB[p][h].m] = h;
  for (int p = 0; p < 2; p++) for (int h = 0; h < N[p]; h++) { auto it = look[1 - p].find(CB[p][h].m); CB[p][h].same = it == look[1 - p].end() ? -1 : it->second; }
  // Suit permutations under which the board and both weighted ranges are unchanged.
  SIG.clear(); PERM[0].clear(); PERM[1].clear();
  array<int, 4> s = {0, 1, 2, 3};
  do {
    bool ok = mapMask(ROOT_MASK, s) == ROOT_MASK; vector<int32_t> pm[2];
    for (int p = 0; p < 2 && ok; p++) { pm[p].resize(N[p]); for (int h = 0; h < N[p] && ok; h++) { auto it = look[p].find(mapMask(CB[p][h].m, s)); ok = it != look[p].end() && fabs(W[p][it->second] - W[p][h]) < 1e-6; if (ok) pm[p][h] = it->second; } }
    if (ok) { SIG.push_back(s); PERM[0].push_back(pm[0]); PERM[1].push_back(pm[1]); }
  } while (next_permutation(s.begin(), s.end()));
  if (!cfg.iso || SIG.size() <= 1) { SIG.clear(); PERM[0].clear(); PERM[1].clear(); }
}
static double estimateMB() {
  double nodes = T.size() * (double)sizeof(Node) + KID.size() * 4. + ACTS.size() * sizeof(Act), store = STORE * 4.;
  double boards = 0; for (size_t b = 0; b < BOARDS.size(); b++) boards += 4. * (N[0] + N[1]);
  double chance = 0; for (auto& c : CH) chance += c.deals.size() * sizeof(Deal) + c.slots.size();
  double scratch = cfg.threads * (SCRATCH_FLOATS * 4. + 200000. + 16. * max(N[0], N[1])) + 49. * 3 * max(N[0], N[1]) * 4 * 2;
  double perms = (PERM[0].size()) * 4. * (N[0] + N[1]);
  return (nodes + store + boards + chance + scratch + perms + (BN[52][5] * 2.)) / 1048576 + 30;
}
static void buildTree() {
  for (;;) {
    memset(STAT, 0, sizeof STAT); T.clear(); KID.clear(); ACTS.clear(); CH.clear(); BOARDID.clear(); BOARDS.clear(); STORE = 0; DEPTH = 0; MAXA = 0;
    St st{}; st.street = ROOT_STREET; st.pot = cfg.pot; st.s[0] = st.s[1] = cfg.stack; st.onPath = true; st.board = ROOT_MASK;
    if (cfg.stack <= 0) streetEnd(st, 0); else build(st, 0);
    SCRATCH_FLOATS = (size_t)(DEPTH + 6) * (3 * MAXA + 8) * max(N[0], N[1]) * 2 + 4096;
    double mb = estimateMB();
    if (mb <= cfg.memMB) return;
    int s = -1; for (int k = 2; k >= ROOT_STREET; k--) if (cap[k] > 1 && (s < 0 || cap[k] > cap[s])) s = k;
    if (!cfg.shrink || s < 0) { char b[256]; snprintf(b, sizeof b, "This spot needs about %.0f MB, over the %.0f MB memory limit. Use narrower ranges or fewer bet sizes.", mb, cfg.memMB); fail(b); }
    cap[s]--;
  }
}

static double seconds(chrono::steady_clock::time_point t0) { return chrono::duration<double>(chrono::steady_clock::now() - t0).count(); }
static void walkRoot(const Ctx& X, float* out) { vector<float> rp(W[X.p]), ro(W[1 - X.p]); walk(0, X, X.m == CFR ? rp.data() : nullptr, ro.data(), out); }
static double total(int p, const float* v) { double s = 0; for (int h = 0; h < N[p]; h++) s += W[p][h] * v[h]; return s / Z; }
static double exploitability(double* br) {
  for (int p = 0; p < 2; p++) { vector<float> v(N[p]); walkRoot({p, BR, 0}, v.data()); br[p] = total(p, v.data()); }
  return (br[0] + br[1] - cfg.pot) / 2 / cfg.pot * 100;
}

// ---------- output
static string comboName(const Cb& c) { string s; for (int k = 3; k >= 0; k--) s += cardName(c.c[k]); return s; }
// Strategy rows are the average strategy, except where it is unsettled for a combo: if
// its own strategy almost never brings it to the node (reach under 0.5%), the average
// rests on early iterations; if the mix loses over 1% of the pot against the best action,
// the node is too rarely reached to have converged. Those rows ("adjusted") show the
// best-EV action instead.
static void writeNode(FILE* f, int ni, vector<float> reach[2]) {
  const Node& n = T[ni];
  if (n.type == FOLD) { fprintf(f, "{\"end\":\"fold\"}"); return; }
  if (n.type == SHOW) { fprintf(f, "{\"end\":\"showdown\"}"); return; }
  if (n.type == CHANCE) { fprintf(f, "{\"end\":\"%s\"}", T[KID[n.kid]].type == ACT ? "next street" : "all-in runout"); return; }
  if (!n.cur) { fprintf(f, "{\"end\":\"next street\"}"); return; }
  int p = n.actor, A = n.nA, H = N[p]; static const char* K[] = {"fold", "check", "call", "bet", "raise"};
  fprintf(f, "{\"player\":%d,\"actions\":[", p);
  for (int a = 0; a < A; a++) { const Act& x = ACTS[n.kid + a]; fprintf(f, "%s{\"kind\":\"%s\",\"to\":%.6g,\"allin\":%s}", a ? "," : "", K[x.kind], x.to, x.allin ? "true" : "false"); }
  vector<float> sg((size_t)A * H), out((size_t)A * H); strategy(n, true, sg.data()); out = sg; vector<int> adjusted;
  auto it = REC.find(ni);
  for (int h = 0; h < H; h++) {
    double z = it == REC.end() ? 0 : it->second.norm[h];
    if (z <= 1e-12) continue;
    double best = -1e300, mix = 0; for (int a = 0; a < A; a++) { best = max(best, (double)it->second.v[(size_t)a * H + h]); mix += sg[a * H + h] * it->second.v[(size_t)a * H + h]; }
    if (reach[p][h] >= .005 && (best - mix) / z <= .01 * cfg.pot) continue;
    adjusted.push_back(h);
    int k = 0; for (int a = 0; a < A; a++) k += it->second.v[(size_t)a * H + h] >= best - 1e-6 * z;
    for (int a = 0; a < A; a++) out[a * H + h] = it->second.v[(size_t)a * H + h] >= best - 1e-6 * z ? 1.f / k : 0.f;
  }
  fprintf(f, "],\"adjusted\":[");
  for (size_t k = 0; k < adjusted.size(); k++) fprintf(f, "%s%d", k ? "," : "", adjusted[k]);
  fprintf(f, "],\"reach\":[");
  for (int h = 0; h < H; h++) fprintf(f, "%s%.4g", h ? "," : "", round(reach[p][h] * 1e4) / 1e4);
  fprintf(f, "],\"strategy\":[");
  for (int h = 0; h < H; h++) { fprintf(f, "%s[", h ? "," : ""); for (int a = 0; a < A; a++) fprintf(f, "%s%.4g", a ? "," : "", round(out[a * H + h] * 1e4) / 1e4); fprintf(f, "]"); }
  fprintf(f, "],\"evs\":[");
  for (int h = 0; h < H; h++) {
    fprintf(f, "%s", h ? "," : ""); double z = it == REC.end() ? 0 : it->second.norm[h];
    if (z <= 1e-12) { fprintf(f, "null"); continue; }
    fprintf(f, "["); for (int a = 0; a < A; a++) fprintf(f, "%s%.2f", a ? "," : "", it->second.v[(size_t)a * H + h] / z); fprintf(f, "]");
  }
  fprintf(f, "],\"children\":[");
  for (int a = 0; a < A; a++) {
    if (a) fprintf(f, ",");
    vector<float> next[2] = {reach[0], reach[1]}; for (int h = 0; h < H; h++) next[p][h] *= sg[a * H + h];
    writeNode(f, KID[n.kid + a], next);
  }
  fprintf(f, "]}");
}

static int evalMode() {
  char hb[64], bb[64]; while (scanf("%63s %63s", hb, bb) == 2) { string hole = hb, board = bb; auto h = parseCards(hole), b = parseCards(board); if (h.size() != 4 || b.size() != 5) fail("Need 4 hole and 5 board cards."); uint8_t hc[4]; for (int k = 0; k < 4; k++) hc[k] = h[k]; printf("%d\n", omaha(hc, b.data())); }
  return 0;
}

int main(int argc, char** argv) {
  try {
    initEval();
    if (argc == 2 && !strcmp(argv[1], "--eval")) return evalMode();
    if (argc != 2) { fprintf(stderr, "usage: plo_solver input.txt | --eval\n"); return 1; }
    auto t0 = chrono::steady_clock::now();
    cfg = readCfg(argv[1]); ROOT_STREET = cfg.board.size() - 3; for (int k = 0; k < 3; k++) cap[k] = cfg.cap[k];
    if (cfg.path.size() && cfg.stack <= 0) fail("No chips behind, so no actions are possible.");
    setupCombos();
    buildTree();
    double mb = estimateMB();
    printf("Combos: %d oop, %d ip; tree: %zu nodes, %zu river boards, %zu suit symmetries; caps %d/%d/%d\n", N[0], N[1], T.size(), BOARDS.size(), max((size_t)1, SIG.size()), cap[0], cap[1], cap[2]);
    for (int k = ROOT_STREET; k < 3; k++) printf("Street %d: %ld decisions, %ld chance, %ld folds, %ld showdowns\n", k, STAT[k][0], STAT[k][1], STAT[k][2], STAT[k][3]);
    printf("Memory estimate: %.0f MB\nTree built: %.1f s\n", mb, seconds(t0)); fflush(stdout);
    MEM.assign(STORE, 0.f);
    for (int t = 0; t < cfg.threads; t++) { auto* s = new Scratch(); s->buf.assign(SCRATCH_FLOATS, 0.f); s->L.assign(max(N[0], N[1]) + 8, 0.); s->LT.assign(max(N[0], N[1]) + 8, 0.); SCR.push_back(s); }
    pool.start(cfg.threads);
    prepBoards(); printf("Boards ready: %.1f s\n", seconds(t0)); fflush(stdout);
    { vector<double> c(N[0]); vector<float> w1(W[1]); compat(0, w1.data(), c.data()); Z = 0; for (int h = 0; h < N[0]; h++) Z += W[0][h] * c[h]; if (Z <= 0) fail("The two ranges have no compatible combos."); }
    double br[2] = {0, 0}, ex = -1; int it = 0;
    for (it = 1; it <= cfg.maxIt; it++) {
      for (int p = 0; p < 2; p++) { vector<float> v(N[p]); walkRoot({p, CFR, it}, v.data()); }
      if (getenv("PLO_TRACE")) { printf("iteration %d: %.2f s\n", it, seconds(t0)); fflush(stdout); }
      bool last = it == cfg.maxIt || seconds(t0) >= cfg.timeLimit;
      if (it % cfg.every == 0 || last) { ex = exploitability(br); printf("Iter: %d\nTotal exploitability %.4f precent\nTime: %.1f s\n", it, ex, seconds(t0)); fflush(stdout); if (ex <= cfg.acc) break; }
      if (last) break;
    }
    if (it > cfg.maxIt) it = cfg.maxIt;
    double ev[2];
    for (int p = 0; p < 2; p++) { vector<float> v(N[p]); walkRoot({p, EV, 0}, v.data()); ev[p] = total(p, v.data()); }
    struct rusage ru; getrusage(RUSAGE_SELF, &ru);
#ifdef __APPLE__
    double rss = ru.ru_maxrss / 1048576.;
#else
    double rss = ru.ru_maxrss / 1024.;
#endif
    FILE* f = fopen(cfg.out.c_str(), "w"); if (!f) fail("Cannot write " + cfg.out);
    string bs; for (int c : cfg.board) bs += cardName(c);
    fprintf(f, "{\"version\":1,\"game\":\"PLO4\",\"board\":\"%s\",\"pot\":%.6g,\"stack\":%.6g,\"iterations\":%d,\"seconds\":%.2f,\"exploitability\":%.4f,\"bestResponse\":[%.4f,%.4f],\"ev\":[%.4f,%.4f],\"memoryEstimateMB\":%.0f,\"peakRssMB\":%.0f,\"threads\":%d,\"caps\":[%d,%d,%d],\"treeReduced\":%s,\"suitSymmetries\":%zu,\"chance\":\"exact enumeration of every turn and river card\",\"nodes\":%zu,\"riverBoards\":%zu,",
      bs.c_str(), cfg.pot, cfg.stack, it, seconds(t0), ex, br[0], br[1], ev[0], ev[1], mb, rss, cfg.threads, cap[0], cap[1], cap[2], cap[0] != cfg.cap[0] || cap[1] != cfg.cap[1] || cap[2] != cfg.cap[2] ? "true" : "false", max((size_t)1, SIG.size()), T.size(), BOARDS.size());
    fprintf(f, "\"combos\":[");
    for (int p = 0; p < 2; p++) { fprintf(f, "%s[", p ? "," : ""); for (int h = 0; h < N[p]; h++) fprintf(f, "%s\"%s\"", h ? "," : "", comboName(CB[p][h]).c_str()); fprintf(f, "]"); }
    fprintf(f, "],\"weights\":[");
    for (int p = 0; p < 2; p++) { fprintf(f, "%s[", p ? "," : ""); for (int h = 0; h < N[p]; h++) fprintf(f, "%s%.4g", h ? "," : "", W[p][h]); fprintf(f, "]"); }
    vector<float> reach[2] = {vector<float>(N[0], 1.f), vector<float>(N[1], 1.f)};
    fprintf(f, "],\"tree\":"); writeNode(f, 0, reach); fprintf(f, "}\n"); fclose(f);
    printf("Done: %d iterations, %.4f%% exploitability, %.1f s, peak RSS %.0f MB\n", it, ex, seconds(t0), rss);
    return 0;
  } catch (exception& e) { fprintf(stderr, "Error: %s\n", e.what()); return 2; }
}
