// Three-player no-limit hold'em postflop solver for Citrus Poker.
// Discounted CFR (alpha 3, beta 0, gamma 4) with alternating updates, in vector
// form over explicit weighted two-card combos, from the flop, turn or river.
//   c++ -O3 -std=c++17 -pthread -o mw_solver mw_solver.cpp
//   mw_solver input.txt        solve; the input format is in tools/multiway-solver/README.md
//   mw_solver --eval           read "hole board" lines on stdin, print hold'em hand ranks
// Players: 0 acts first on every street, then 1, then 2 (the button side). All three
// start with the same stack behind. Chips are the caller's units. Every value is a
// player's net result from the solve's start: chips won from the pot minus chips put
// in since then, so the three players' values sum to the starting pot.
//
// Card removal. Each player's cards are removed exactly against the board and against
// each opponent's range. The two opponents' ranges are treated as independent of each
// other given the player's own hand (their overlap is not removed), which turns every
// three-way showdown into products of two one-opponent sweeps. Exploitability is a best
// response for each player under that same model.
//
// Chance. Every turn and river card is enumerated, with exact suit isomorphism when the
// board and all three ranges are symmetric. When the full tree would not fit the memory
// limit, the solver keeps the bet tree and deals a fixed, evenly spread subset of turn
// and river cards instead, each hand's values rescaled by the share of cards it sees.
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
  vector<pair<array<int, 2>, double>> range[3];
  vector<double> bet[3][3], raise[3][3]; int cap[3] = {1, 1, 1}; bool lead[3][3], allin[3] = {true, true, true};
  vector<Step> path; int threads = 4, maxIt = 300, every = 10, turnCards = 0, riverCards = 0, runouts = 0; double acc = .5, timeLimit = 1e9, memMB = 1e9; string out = "result.json"; bool iso = true, autoSample = true; double alpha = 3, beta = 0, gamma = 4; bool current = false;
};
static vector<double> nums(const string& s) { vector<double> v; string t; stringstream ss(s); while (getline(ss, t, ',')) if (!t.empty()) { char* e; double x = strtod(t.c_str(), &e); if (*e || !isfinite(x) || x <= 0 || x > 100) fail("Invalid size list: " + s); v.push_back(x); } return v; }
static int streetIdx(const string& s) { if (s == "flop") return 0; if (s == "turn") return 1; if (s == "river") return 2; fail("Invalid street: " + s); }
static vector<int> whoIdx(const string& s) { if (s == "all") return {0, 1, 2}; if (s == "0" || s == "1" || s == "2") return {s[0] - '0'}; fail("Invalid player: " + s); }
// Ranges are exact combos ("AsKs") or hand classes ("AKs", "TT", "AJo"), each with an optional weight.
static void addRange(Cfg& c, int p, const string& text, double (*num)(const string&, double, double)) {
  stringstream rs(text); string tok;
  while (getline(rs, tok, ',')) {
    if (tok.empty()) continue;
    size_t col = tok.find(':'); double w = col == string::npos ? 1 : num(tok.substr(col + 1), 0, 1); string key = tok.substr(0, col);
    if (w <= 0) continue;
    vector<array<int, 2>> cs;
    if (key.size() == 4) { auto v = parseCards(key); cs.push_back({min(v[0], v[1]), max(v[0], v[1])}); }
    else if (key.size() == 2 || key.size() == 3) {
      const char *x = strchr(RANKS, toupper(key[0])), *y = strchr(RANKS, toupper(key[1]));
      if (!x || !y || !*x || !*y) fail("Invalid hand class: " + key);
      int a = x - RANKS, b = y - RANKS; char sfx = key.size() == 3 ? tolower(key[2]) : 0;
      if ((a == b) != (sfx == 0) || (sfx && sfx != 's' && sfx != 'o')) fail("Invalid hand class: " + key);
      for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
        if (a == b ? i >= j : (sfx == 's') != (i == j)) continue;
        int u = 4 * a + i, v = 4 * b + j; cs.push_back({min(u, v), max(u, v)});
      }
    } else fail("Invalid range entry: " + tok);
    for (auto& x : cs) c.range[p].push_back({x, w});
  }
}
static double numIn(const string& s, double lo, double hi) { char* e; double x = strtod(s.c_str(), &e); if (s.empty() || *e || !isfinite(x) || x < lo || x > hi) fail("Invalid number: " + s); return x; }
static Cfg readCfg(const char* file) {
  ifstream f(file); if (!f) fail(string("Cannot read ") + file);
  Cfg c; string line; bool sized = false;
  for (auto& s : c.lead) for (bool& x : s) x = true;
  while (getline(f, line)) {
    stringstream ss(line); string k; if (!(ss >> k) || k[0] == '#') continue;
    vector<string> a; string t; while (ss >> t) a.push_back(t);
    auto need = [&](size_t n) { if (a.size() != n) fail("Bad line: " + line.substr(0, 80)); };
    if (k == "game") { need(1); if (a[0] != "NLH3") fail("Only NLH3 is supported."); }
    else if (k == "board") { need(1); c.board = parseCards(a[0]); if (c.board.size() < 3 || c.board.size() > 5) fail("The board needs 3 to 5 cards."); }
    else if (k == "pot") { need(1); c.pot = numIn(a[0], 1e-6, 1e9); }
    else if (k == "stack") { need(1); c.stack = numIn(a[0], 0, 1e10); }
    else if (k == "min_bet") { need(1); c.minBet = numIn(a[0], 1e-6, 1e9); }
    else if (k == "allin_threshold") { need(1); c.thr = numIn(a[0], .05, 1); }
    else if (k == "range0" || k == "range1" || k == "range2") { if (a.size() > 1) fail("Bad range line."); if (a.size()) addRange(c, k[5] - '0', a[0], numIn); }
    else if (k == "bet" || k == "raise") { need(3); for (int p : whoIdx(a[1])) { auto& v = (k == "bet" ? c.bet : c.raise)[streetIdx(a[0])][p]; v = a[2] == "none" ? vector<double>() : nums(a[2]); if (v.size() > 6) fail("At most 6 sizes."); } sized = true; }
    else if (k == "cap") { need(2); c.cap[streetIdx(a[0])] = (int)numIn(a[1], 0, 6); }
    else if (k == "lead") { need(3); for (int p : whoIdx(a[1])) c.lead[streetIdx(a[0])][p] = a[2] != "0"; }
    else if (k == "allin") { need(2); c.allin[streetIdx(a[0])] = a[1] != "0"; }
    else if (k == "path") { for (auto& s : a) { stringstream ps(s); string st; while (getline(ps, st, ',')) { if (st == "check") c.path.push_back({1, 0}); else if (st == "call") c.path.push_back({2, 0}); else if (!st.compare(0, 3, "to:")) c.path.push_back({3, numIn(st.substr(3), 1e-6, 1e10)}); else if (!st.empty()) fail("Invalid path step: " + st); } } if (c.path.size() > 16) fail("Path too long."); }
    else if (k == "threads") { need(1); c.threads = (int)numIn(a[0], 1, 256); }
    else if (k == "accuracy") { need(1); c.acc = numIn(a[0], 0, 100); }
    else if (k == "max_iterations") { need(1); c.maxIt = (int)numIn(a[0], 0, 100000); }
    else if (k == "print_interval") { need(1); c.every = (int)numIn(a[0], 1, 100000); }
    else if (k == "time_limit") { need(1); c.timeLimit = numIn(a[0], 1, 1e7); }
    else if (k == "memory_limit_mb") { need(1); c.memMB = numIn(a[0], 1, 1e8); }
    else if (k == "isomorphism") { need(1); c.iso = a[0] != "0"; }
    else if (k == "turn_cards") { need(1); c.turnCards = (int)numIn(a[0], 0, 49); }
    else if (k == "river_cards") { need(1); c.riverCards = (int)numIn(a[0], 0, 48); }
    else if (k == "runouts") { need(1); c.runouts = (int)numIn(a[0], 0, 2352); }
    else if (k == "auto_sample") { need(1); c.autoSample = a[0] != "0"; }
    else if (k == "current") { need(1); c.current = a[0] != "0"; }
    else if (k == "dcfr") { need(3); c.alpha = numIn(a[0], 0, 100); c.beta = numIn(a[1], -100, 100); c.gamma = numIn(a[2], 0, 100); }
    else if (k == "output") { need(1); c.out = a[0]; }
    else fail("Unknown input line: " + k);
  }
  if (c.board.size() < 3) fail("Missing board.");
  if (c.pot <= 0) fail("Missing pot.");
  if (!sized) for (int s = 0; s < 3; s++) for (int p = 0; p < 3; p++) { c.bet[s][p] = {s == 0 ? .33 : .66}; c.raise[s][p] = {.66}; }
  return c;
}

// ---------- combos with exact card removal against one opponent at a time
struct Cb { uint8_t c[2]; u64 m; int32_t same[3]; };
static int N[3]; static vector<Cb> CB[3];
static vector<float> W[3];
static int NMAX = 0;
// Weight of an opponent's combos that share no card with h: total minus each card's
// sum; the identical combo is subtracted twice, so it is added back by the caller.
struct Acc {
  double a0 = 0, a1[52];
  Acc() { memset(a1, 0, sizeof a1); }
  inline void add(const Cb& o, double w) { a0 += w; a1[o.c[0]] += w; a1[o.c[1]] += w; }
  inline void clear(const Cb& o) { a1[o.c[0]] = 0; a1[o.c[1]] = 0; }
  inline double q(const Cb& h) const { return a0 - a1[h.c[0]] - a1[h.c[1]]; }
};

// ---------- thread pool: fork-join, so chance nodes can split their cards at every level.
// A thread waiting for its own cards only takes cards of that same node, so each thread's
// scratch holds one path of the tree at a time; idle threads take the newest open node's.
static thread_local int TID = 0;
struct Group { const function<void(int)>* f; int k, next = 0; atomic<int> done{0}; };
struct Pool {
  int n = 1; vector<thread> th; mutex mu; condition_variable cv; vector<Group*> open; bool quit = false;
  // Under mu: the next card of `only`, or of the newest open group.
  bool claim(Group*& g, int& i, Group* only) {
    if (only) { if (only->next >= only->k) return false; g = only; } else { if (open.empty()) return false; g = open.back(); }
    i = g->next++; if (g->next >= g->k) open.erase(find(open.begin(), open.end(), g));
    return true;
  }
  void start(int k) {
    n = k;
    for (int t = 1; t < k; t++) th.emplace_back([this, t] {
      TID = t;
      for (;;) {
        Group* g = nullptr; int i = 0;
        { unique_lock<mutex> l(mu); cv.wait(l, [&] { return quit || !open.empty(); }); if (quit) return; if (!claim(g, i, nullptr)) continue; }
        (*g->f)(i); g->done.fetch_add(1, memory_order_release);
      }
    });
  }
  void run(int k, const function<void(int)>& f) {
    if (n <= 1 || k <= 1) { for (int i = 0; i < k; i++) f(i); return; }
    Group g; g.f = &f; g.k = k;
    { lock_guard<mutex> l(mu); open.push_back(&g); }
    cv.notify_all();
    for (;;) { Group* x; int i; { lock_guard<mutex> l(mu); if (!claim(x, i, &g)) break; } f(i); g.done.fetch_add(1, memory_order_release); }
    while (g.done.load(memory_order_acquire) < k) this_thread::yield();
  }
  ~Pool() { { lock_guard<mutex> l(mu); quit = true; } cv.notify_all(); for (auto& t : th) t.join(); }
} pool;

// ---------- tree
enum { ACT, CHANCE, FOLD, SHOW };
struct Node { uint8_t type, actor, nA, cur, alive; int32_t kid, aux; float x[3]; int64_t off; int32_t last; };
struct Act { uint8_t kind, allin; float to; };  // kind 0 fold 1 check 2 call 3 bet 4 raise
struct Deal { uint8_t card, slot, sig; };
struct Chance { vector<uint8_t> slots; vector<Deal> deals; int avail; bool sampled; u64 mask; };
static vector<Node> T; static vector<int32_t> KID; static vector<Act> ACTS; static vector<Chance> CH;
static map<u64, int> BOARDID; static vector<u64> BOARDS;
static int64_t STORE = 0; static int DEPTH = 0, MAXA = 0;
static Cfg cfg; static int ROOT_STREET; static u64 ROOT_MASK;
static vector<array<int, 4>> SIG;           // suit permutations that keep the board and ranges unchanged
static vector<vector<int32_t>> PERM[3];      // combo index of sigma(h), per sigma
static int TURNS = 0, RIVERS = 0;            // cards dealt per chance node (0 = all)
static long STAT[3][4];

static inline int mapCard(int c, const array<int, 4>& s) { return (c & ~3) | s[c & 3]; }
static u64 mapMask(u64 m, const array<int, 4>& s) { u64 r = 0; for (int c = 0; c < 52; c++) if (m >> c & 1) r |= 1ull << mapCard(c, s); return r; }

struct St { int street; double c[3], s[3], X[3], maxBet, lastInc; uint8_t folded, acted; int toAct, raises, pathK; bool onPath; u64 board; };
static int build(const St& st, int depth);
static inline uint8_t aliveOf(const St& st) { return ~st.folded & 7; }
static int leaf(int type, const St& st, int depth) {
  Node n{}; n.type = type; n.alive = aliveOf(st); for (int i = 0; i < 3; i++) n.x[i] = st.X[i]; n.cur = st.street == ROOT_STREET;
  if (type == SHOW) { auto it = BOARDID.find(st.board); if (it == BOARDID.end()) { it = BOARDID.emplace(st.board, (int)BOARDS.size()).first; BOARDS.push_back(st.board); } n.aux = it->second; }
  STAT[st.street][type]++; DEPTH = max(DEPTH, depth); T.push_back(n); return T.size() - 1;
}
static int withChips(const St& st) { int k = 0; for (int i = 0; i < 3; i++) k += !(st.folded >> i & 1) && st.s[i] > 0; return k; }
// An evenly spread subset of the cards left: ranks high to low with suits interleaved,
// so every rank and suit keeps about its share. The offset varies it between turns.
static vector<int> spread(u64 board, int k, double offset) {
  vector<int> cand; for (int r = 12; r >= 0; r--) for (int s = 0; s < 4; s++) { int c = 4 * r + (s + r) % 4; if (!(board >> c & 1)) cand.push_back(c); }
  if (k <= 0 || k >= (int)cand.size()) return cand;
  vector<int> out; for (int i = 0; i < k; i++) out.push_back(cand[(int)((i + offset) * cand.size() / k) % cand.size()]);
  sort(out.begin(), out.end()); out.erase(unique(out.begin(), out.end()), out.end()); return out;
}
// Street over: showdown on the river, otherwise deal the next card (with no betting
// left when fewer than two players have chips).
static int streetEnd(St st, int depth) {
  if (st.street == 2) return leaf(SHOW, st, depth);
  Chance ch; ch.avail = 52 - __builtin_popcountll(st.board); ch.mask = 0;
  int want = st.street == 0 ? TURNS : RIVERS; ch.sampled = want > 0 && want < ch.avail;
  vector<int> slotOf(52, -1);
  if (ch.sampled) {
    int prev = 0; for (int c = 0; c < 52; c++) if ((st.board & ~ROOT_MASK) >> c & 1) prev = c;
    for (int c : spread(st.board, want, st.street == 0 ? .5 : fmod(.5 + prev * .618034, 1.))) { ch.slots.push_back(c); ch.deals.push_back({(uint8_t)c, (uint8_t)(ch.slots.size() - 1), 0}); ch.mask |= 1ull << c; }
  } else {
    vector<int> group; for (int g = 0; g < (int)SIG.size(); g++) if (mapMask(st.board, SIG[g]) == st.board) group.push_back(g);
    for (int c = 0; c < 52; c++) {
      if (st.board >> c & 1) continue;
      int rep = c, sg = 0;
      for (int g : group) { int m = mapCard(c, SIG[g]); if (m < rep) rep = m, sg = g; }
      if (slotOf[rep] < 0) { slotOf[rep] = ch.slots.size(); ch.slots.push_back(rep); }
      ch.deals.push_back({(uint8_t)c, (uint8_t)slotOf[rep], (uint8_t)sg});
    }
  }
  STAT[st.street][CHANCE]++; Node n{}; n.type = CHANCE; n.alive = aliveOf(st); for (int i = 0; i < 3; i++) n.x[i] = st.X[i]; n.aux = CH.size(); CH.push_back(ch);
  T.push_back(n); int id = T.size() - 1; int k0 = KID.size(); T[id].kid = k0;
  auto slots = CH[n.aux].slots;
  for (size_t k = 0; k < slots.size(); k++) { KID.push_back(-1); ACTS.push_back({}); }
  bool betting = withChips(st) >= 2;
  for (size_t k = 0; k < slots.size(); k++) {
    St nx = st; nx.board |= 1ull << slots[k]; nx.street++; nx.c[0] = nx.c[1] = nx.c[2] = 0; nx.maxBet = 0; nx.lastInc = 0; nx.raises = 0; nx.acted = 0; nx.onPath = false;
    nx.toAct = -1; for (int i = 0; i < 3; i++) if (!(nx.folded >> i & 1) && nx.s[i] > 0) { nx.toAct = i; break; }
    int child = betting ? build(nx, depth + 1) : streetEnd(nx, depth + 1);
    KID[k0 + k] = child;
  }
  return id;
}
// After player p's action: a lone survivor wins, the next player who still owes an
// action acts, or the street ends.
static int afterAction(St nx, int p, int depth) {
  if (__builtin_popcount(aliveOf(nx)) == 1) return leaf(FOLD, nx, depth);
  for (int k = 1; k <= 3; k++) {
    int q = (p + k) % 3; if (nx.folded >> q & 1 || nx.s[q] <= 0) continue;
    if (!(nx.acted >> q & 1) || nx.c[q] < nx.maxBet - 1e-9) { nx.toAct = q; return build(nx, depth); }
  }
  return streetEnd(nx, depth);
}
static int build(const St& st, int depth) {
  int p = st.toAct; double facing = st.maxBet - st.c[p];
  const Step* step = st.onPath && st.pathK < (int)cfg.path.size() ? &cfg.path[st.pathK] : nullptr;
  vector<Act> acts;
  if (facing > 0) { acts.push_back({0, 0, 0}); acts.push_back({2, (uint8_t)(st.s[p] <= facing), (float)(st.c[p] + min(facing, st.s[p]))}); }
  else acts.push_back({1, 0, (float)st.c[p]});
  if (step && step->kind == 1 && facing > 0) fail("The action path checks facing a bet.");
  if (step && step->kind == 2 && facing <= 0) fail("The action path calls with no bet to call.");
  bool others = false; for (int q = 0; q < 3; q++) others |= q != p && !(st.folded >> q & 1) && st.s[q] > 0;
  if (st.s[p] > facing && others) {
    double potNow = cfg.pot + st.X[0] + st.X[1] + st.X[2], allinTo = st.c[p] + st.s[p], lo = facing > 0 ? st.maxBet + max(st.lastInc, cfg.minBet) : cfg.minBet;
    vector<double> to;
    auto put = [&](double t) {
      if (t > allinTo) t = allinTo;
      if (t < lo) t = lo > allinTo ? allinTo : lo;
      if (st.X[p] + t - st.c[p] > cfg.thr * cfg.stack) t = allinTo;  // commits most of the stack: all-in
      t = t >= allinTo - 1e-9 ? allinTo : round(t); if (t <= st.maxBet) return;
      for (double u : to) if (fabs(u - t) < .5) return;
      to.push_back(t);
    };
    bool may = facing > 0 ? st.raises < cfg.cap[st.street] : cfg.lead[st.street][p];
    if (may) {
      for (double f : (facing > 0 ? cfg.raise : cfg.bet)[st.street][p]) put(facing > 0 ? st.maxBet + f * (potNow + facing) : f * potNow);
      if (cfg.allin[st.street]) put(allinTo);
    }
    if (step && step->kind == 3) {
      double t = step->to; if (t <= st.maxBet) fail("The action path has a raise below the current bet.");
      t = t >= allinTo - 1e-9 ? allinTo : t; bool have = false; for (double u : to) have |= fabs(u - t) < .5; if (!have) to.push_back(t);
    }
    sort(to.begin(), to.end());
    for (double t : to) acts.push_back({(uint8_t)(facing > 0 ? 4 : 3), (uint8_t)(t >= allinTo), (float)t});
  } else if (step && step->kind == 3) fail("The action path raises when no raise is possible.");
  int A = acts.size(); MAXA = max(MAXA, A); STAT[st.street][ACT]++;
  Node n{}; n.type = ACT; n.actor = p; n.nA = A; n.alive = aliveOf(st); for (int i = 0; i < 3; i++) n.x[i] = st.X[i]; n.cur = st.street == ROOT_STREET; n.off = STORE; STORE += 2LL * A * N[p];
  T.push_back(n); int id = T.size() - 1; int k0 = KID.size(); T[id].kid = k0; DEPTH = max(DEPTH, depth);
  for (int a = 0; a < A; a++) { KID.push_back(-1); ACTS.push_back(acts[a]); }
  for (int a = 0; a < A; a++) {
    const Act& x = acts[a]; St nx = st;
    bool match = step && ((step->kind == 1 && x.kind == 1) || (step->kind == 2 && x.kind == 2) || (step->kind == 3 && x.kind >= 3 && fabs(x.to - (step->to >= st.c[p] + st.s[p] - 1e-9 ? st.c[p] + st.s[p] : step->to)) < .5));
    nx.onPath = match; nx.pathK = st.pathK + (match ? 1 : 0);
    if (x.kind == 0) nx.folded |= 1 << p;
    else if (x.kind == 1) nx.acted |= 1 << p;
    else if (x.kind == 2) { double pay = x.to - st.c[p]; nx.c[p] = x.to; nx.s[p] -= pay; nx.X[p] += pay; nx.acted |= 1 << p; }
    else { double pay = x.to - st.c[p]; nx.lastInc = max(st.lastInc, x.to - st.maxBet); nx.maxBet = x.to; nx.c[p] = x.to; nx.s[p] -= pay; nx.X[p] += pay; nx.raises += facing > 0; nx.acted = 1 << p; }
    KID[k0 + a] = afterAction(nx, p, depth + 1);
  }
  return id;
}

// ---------- showdown data per river board: combos sorted by hand rank
struct Board { vector<uint16_t> idx[3], rk[3]; };
static vector<Board> BD;
static void prepBoards() {
  BD.assign(BOARDS.size(), Board());
  pool.run(BOARDS.size(), [&](int b) {
    int bc[5], k = 0; for (int c = 0; c < 52; c++) if (BOARDS[b] >> c & 1) bc[k++] = c;
    for (int p = 0; p < 3; p++) {
      vector<pair<uint16_t, uint16_t>> v; v.reserve(N[p]);
      for (int h = 0; h < N[p]; h++) if (!(CB[p][h].m & BOARDS[b])) v.push_back({holdem(CB[p][h].c[0], CB[p][h].c[1], bc), (uint16_t)h});
      sort(v.begin(), v.end());
      for (auto& x : v) { BD[b].rk[p].push_back(x.first); BD[b].idx[p].push_back(x.second); }
    }
  });
}

// ---------- per-thread scratch
struct Scratch { Acc acc; vector<float> buf; size_t top = 0; float* get(size_t n) { n = (n + 7) & ~7ull; if (top + n > buf.size()) fail("Internal scratch overflow."); float* r = buf.data() + top; top += n; return r; } double* getd(size_t n) { return (double*)get(2 * n); } };
static vector<Scratch*> SCR; static size_t SCRATCH_FLOATS;
static Scratch& scr() { return *SCR[TID]; }
struct Frame { Scratch& s; size_t t; Frame() : s(scr()), t(s.top) {} ~Frame() { s.top = t; } };

static vector<float> MEM;  // regrets then strategy sums, per action node
enum Mode { CFR, BR, EV };
struct Ctx { int p; Mode m; int it; bool record; };
struct Rec { vector<float> v, norm; };
static map<int, Rec> REC;
typedef const float* Reach[3];

// Opponent o's weight compatible with each of p's combos: out[h] = sum of ro over combos sharing no card with h.
static void compat(int p, int o, const float* ro, double* out) {
  Acc& A = scr().acc;
  for (int k = 0; k < N[o]; k++) if (ro[k] > 0) A.add(CB[o][k], ro[k]);
  for (int h = 0; h < N[p]; h++) { const Cb& c = CB[p][h]; out[h] = max(0., A.q(c) + (c.same[o] >= 0 ? ro[c.same[o]] : 0)); }
  for (int k = 0; k < N[o]; k++) if (ro[k] > 0) A.clear(CB[o][k]);
  A.a0 = 0;
}
// Opponent o's weight that p's combos beat (L), beat or tie (LT) and that is compatible
// at all (All) on a river board: one sweep in rank order.
static void stats(int board, int p, int o, const float* ro, double* L, double* LT, double* All) {
  const Board& b = BD[board]; Acc& A = scr().acc;
  const auto &ip = b.idx[p], &rp = b.rk[p], &iq = b.idx[o], &rq = b.rk[o];
  size_t np = ip.size(), nq = iq.size(), j = 0, i = 0;
  memset(L, 0, sizeof(double) * N[p]); memset(LT, 0, sizeof(double) * N[p]); memset(All, 0, sizeof(double) * N[p]);
  while (i < np) {
    uint16_t r = rp[i]; size_t e = i; while (e < np && rp[e] == r) e++;
    for (; j < nq && rq[j] < r; j++) { int k = iq[j]; if (ro[k] > 0) A.add(CB[o][k], ro[k]); }
    for (size_t k = i; k < e; k++) L[ip[k]] = A.q(CB[p][ip[k]]);
    bool ties = false; for (; j < nq && rq[j] == r; j++) { int k = iq[j]; if (ro[k] > 0) A.add(CB[o][k], ro[k]), ties = true; }
    if (ties) for (size_t k = i; k < e; k++) { const Cb& c = CB[p][ip[k]]; LT[ip[k]] = A.q(c) + (c.same[o] >= 0 ? ro[c.same[o]] : 0); }
    else for (size_t k = i; k < e; k++) LT[ip[k]] = L[ip[k]];
    i = e;
  }
  for (; j < nq; j++) { int k = iq[j]; if (ro[k] > 0) A.add(CB[o][k], ro[k]); }
  for (size_t k = 0; k < np; k++) { int h = ip[k]; const Cb& c = CB[p][h]; double l = max(0., L[h]), lt = max(l, LT[h]); L[h] = l; LT[h] = lt; All[h] = max(lt, A.q(c) + (c.same[o] >= 0 ? ro[c.same[o]] : 0)); }
  for (size_t k = 0; k < nq; k++) { int q = iq[k]; if (ro[q] > 0) A.clear(CB[o][q]); }
  A.a0 = 0;
}
// Each opponent's sums for p's combos, kept while that opponent's reach is unchanged: every
// leaf child of p's own node shares both; leaf children of an opponent's node share the
// third player's.
struct Sums {
  double *L[3] = {}, *LT[3] = {}, *All[3] = {}; int have[3] = {-2, -2, -2};  // -2 none, -1 All only, else the board
  void drop(int o) { have[o] = -2; }
  void need(Frame& f, int p, Reach R, int o, int brd) {
    if (!All[o]) All[o] = f.s.getd(N[p]);
    if (brd >= 0) { if (have[o] == brd) return; if (!L[o]) { L[o] = f.s.getd(N[p]); LT[o] = f.s.getd(N[p]); } stats(brd, p, o, R[o], L[o], LT[o], All[o]); have[o] = brd; }
    else if (have[o] == -2) { compat(p, o, R[o], All[o]); have[o] = -1; }
  }
};
static inline bool leafFor(const Node& n, int p) { return n.type == FOLD || n.type == SHOW || !(n.alive >> p & 1); }
// Value of a leaf for p, or of any node after p folded (p loses what it put in).
static void leafValue(const Node& n, int p, Reach R, Sums& S, Frame& f, float* out) {
  int a = (p + 1) % 3, b = (p + 2) % 3, H = N[p]; double pot = cfg.pot + n.x[0] + n.x[1] + n.x[2], xp = n.x[p];
  bool show = n.type == SHOW && n.alive >> p & 1, ia = n.alive >> a & 1, ib = n.alive >> b & 1;
  S.need(f, p, R, a, show && ia ? n.aux : -1); S.need(f, p, R, b, show && ib ? n.aux : -1);
  const double *Aa = S.All[a], *Ab = S.All[b];
  if (!(n.alive >> p & 1)) { for (int h = 0; h < H; h++) out[h] = -xp * Aa[h] * Ab[h]; return; }
  if (n.type == FOLD) { for (int h = 0; h < H; h++) out[h] = (pot - xp) * Aa[h] * Ab[h]; return; }
  if (ia && ib) {
    const double *La = S.L[a], *Ta = S.LT[a], *Lb = S.L[b], *Tb = S.LT[b];
    for (int h = 0; h < H; h++) { double ea = Ta[h] - La[h], eb = Tb[h] - Lb[h]; out[h] = pot * (La[h] * Lb[h] + .5 * (ea * Lb[h] + La[h] * eb) + ea * eb / 3) - xp * Aa[h] * Ab[h]; }
    return;
  }
  int o = ia ? a : b, z = ia ? b : a; const double *Lo = S.L[o], *To = S.LT[o], *Az = S.All[z];
  for (int h = 0; h < H; h++) out[h] = pot * (Lo[h] + .5 * (To[h] - Lo[h])) * Az[h] - xp * Aa[h] * Ab[h];
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
static void walk(int ni, const Ctx& X, Reach R, float* out) {
  const Node& n = T[ni]; int p = X.p, Np = N[p];
  if (leafFor(n, p)) { Frame f; Sums S; leafValue(n, p, R, S, f, out); return; }
  if (n.type == CHANCE) {
    const Chance& ch = CH[n.aux]; int S = ch.slots.size();
    memset(out, 0, sizeof(float) * Np);
    // Exact: each card has probability 1/(cards left - 6) given all three hands. Sampled:
    // a hand's cards-left-to-it, spread over the sampled cards it does not hold.
    Frame fs; float* scale = fs.s.get(Np);
    for (int h = 0; h < Np; h++) { double seen = ch.sampled ? S - __builtin_popcountll(ch.mask & CB[p][h].m) : ch.avail - 2; scale[h] = seen > 0 ? (ch.avail - 2) / ((ch.avail - 6) * seen) : 0; }
    size_t per = 0; for (int i = 0; i < 3; i++) per += N[i]; per += Np;
    auto one = [&](int k, float* buf) {
      u64 m = 1ull << ch.slots[k]; Reach R2; float* v = buf; float* w = buf + Np;
      for (int i = 0; i < 3; i++) { if (!R[i]) { R2[i] = nullptr; continue; } for (int h = 0; h < N[i]; h++) w[h] = CB[i][h].m & m ? 0 : R[i][h]; R2[i] = w; w += N[i]; }
      walk(KID[n.kid + k], X, R2, v);
      for (int h = 0; h < Np; h++) if (CB[p][h].m & m) v[h] = 0;
    };
    auto gather = [&](int k, const float* v) {
      for (const Deal& d : ch.deals) if (d.slot == k) {
        if (SIG.empty() || d.card == ch.slots[k]) { for (int h = 0; h < Np; h++) out[h] += v[h] * scale[h]; }
        else { const int32_t* pm = PERM[p][d.sig].data(); for (int h = 0; h < Np; h++) out[h] += v[pm[h]] * scale[h]; }
      }
    };
    if (pool.n > 1 && S > 1) {
      vector<float> buf((size_t)S * per);
      pool.run(S, [&](int k) { one(k, buf.data() + (size_t)k * per); });
      for (int k = 0; k < S; k++) gather(k, buf.data() + (size_t)k * per);
    } else {
      Frame f; float* b = f.s.get(per);
      for (int k = 0; k < S; k++) { one(k, b); gather(k, b); }
    }
    return;
  }
  int A = n.nA; Frame f;
  if (n.actor == p) {
    float *sg = f.s.get((size_t)A * Np), *vals = f.s.get((size_t)A * Np), *crp = X.m == CFR ? f.s.get(Np) : nullptr;
    strategy(n, X.m != CFR && !cfg.current, sg);
    Sums S;
    for (int a = 0; a < A; a++) {
      const Node& c = T[KID[n.kid + a]];
      if (leafFor(c, p)) { leafValue(c, p, R, S, f, vals + (size_t)a * Np); continue; }
      Reach R2 = {R[0], R[1], R[2]};
      if (crp) { for (int h = 0; h < Np; h++) crp[h] = R[p][h] * sg[a * Np + h]; R2[p] = crp; }
      walk(KID[n.kid + a], X, R2, vals + (size_t)a * Np);
    }
    if (X.m == BR) { for (int h = 0; h < Np; h++) { float b = vals[h]; for (int a = 1; a < A; a++) b = max(b, vals[a * Np + h]); out[h] = b; } return; }
    for (int h = 0; h < Np; h++) { double s = 0; for (int a = 0; a < A; a++) s += sg[a * Np + h] * vals[a * Np + h]; out[h] = s; }
    if (X.m == EV) {
      if (X.record && n.cur) {
        Rec& r = REC[ni]; r.v.assign(vals, vals + (size_t)A * Np);
        vector<double> ca(Np), cb(Np); compat(p, (p + 1) % 3, R[(p + 1) % 3], ca.data()); compat(p, (p + 2) % 3, R[(p + 2) % 3], cb.data());
        r.norm.resize(Np); for (int h = 0; h < Np; h++) r.norm[h] = ca[h] * cb[h];
      }
      return;
    }
    // Discounted CFR, applied lazily for the iterations since this node's last update.
    Node& m = T[ni]; int t = X.it, lt = m.last; double dp = 1, dn = 1, th = lt ? pow((double)lt / t, cfg.gamma) : 0;
    for (int k = lt; k >= 1 && k < t; k++) { double x = pow((double)k, cfg.alpha), y = pow((double)k, cfg.beta); dp *= x / (x + 1); dn *= y / (y + 1); }
    float *Rg = MEM.data() + n.off, *Sm = Rg + (size_t)A * Np;
    for (int a = 0; a < A; a++) for (int h = 0; h < Np; h++) {
      size_t k = (size_t)a * Np + h; float r = Rg[k]; Rg[k] = r * (r > 0 ? dp : dn) + vals[k] - out[h];
      Sm[k] = Sm[k] * th + R[p][h] * sg[k];
    }
    m.last = t;
    return;
  }
  int q = n.actor, Nq = N[q];
  float *sg = f.s.get((size_t)A * Nq), *cro = f.s.get(Nq), *tmp = f.s.get(Np);
  strategy(n, X.m != CFR && !cfg.current, sg); memset(out, 0, sizeof(float) * Np);
  Sums S;
  for (int a = 0; a < A; a++) {
    bool any = false; for (int o = 0; o < Nq; o++) { cro[o] = R[q][o] * sg[a * Nq + o]; any |= cro[o] > 0; }
    if (!any && !(X.m == EV && X.record && n.cur)) continue;  // nobody reaches this branch: it is worth nothing to p
    Reach R2 = {R[0], R[1], R[2]}; R2[q] = cro;
    const Node& c = T[KID[n.kid + a]];
    if (leafFor(c, p)) { S.drop(q); leafValue(c, p, R2, S, f, tmp); }
    else walk(KID[n.kid + a], X, R2, tmp);
    for (int h = 0; h < Np; h++) out[h] += tmp[h];
  }
}

// ---------- setup
static void setupCombos() {
  ROOT_MASK = 0; for (int c : cfg.board) ROOT_MASK |= 1ull << c;
  unordered_map<u64, int> look[3];
  for (int p = 0; p < 3; p++) {
    map<array<int, 2>, double> m; for (auto& x : cfg.range[p]) { u64 mk = 1ull << x.first[0] | 1ull << x.first[1]; if (mk & ROOT_MASK) continue; m[x.first] = max(m[x.first], x.second); }
    if (m.empty()) fail("Player " + to_string(p) + "'s range is empty on this board.");
    CB[p].clear(); W[p].clear();
    for (auto& x : m) { Cb c{}; c.c[0] = x.first[0]; c.c[1] = x.first[1]; c.m = 1ull << c.c[0] | 1ull << c.c[1]; CB[p].push_back(c); W[p].push_back(x.second); }
    N[p] = CB[p].size(); NMAX = max(NMAX, N[p]);
    for (int h = 0; h < N[p]; h++) look[p][CB[p][h].m] = h;
  }
  for (int p = 0; p < 3; p++) for (int h = 0; h < N[p]; h++) for (int o = 0; o < 3; o++) { auto it = look[o].find(CB[p][h].m); CB[p][h].same[o] = o == p || it == look[o].end() ? -1 : it->second; }
  // Suit permutations under which the board and all three weighted ranges are unchanged.
  SIG.clear(); for (auto& v : PERM) v.clear();
  array<int, 4> s = {0, 1, 2, 3};
  do {
    bool ok = mapMask(ROOT_MASK, s) == ROOT_MASK; vector<int32_t> pm[3];
    for (int p = 0; p < 3 && ok; p++) { pm[p].resize(N[p]); for (int h = 0; h < N[p] && ok; h++) { auto it = look[p].find(mapMask(CB[p][h].m, s)); ok = it != look[p].end() && fabs(W[p][it->second] - W[p][h]) < 1e-6; if (ok) pm[p][h] = it->second; } }
    if (ok) { SIG.push_back(s); for (int p = 0; p < 3; p++) PERM[p].push_back(pm[p]); }
  } while (next_permutation(s.begin(), s.end()));
  if (!cfg.iso || SIG.size() <= 1) { SIG.clear(); for (auto& v : PERM) v.clear(); }
}
static double estimateMB() {
  double nodes = T.size() * (double)sizeof(Node) + KID.size() * 4. + ACTS.size() * sizeof(Act), store = STORE * 4.;
  double boards = BOARDS.size() * 4. * (N[0] + N[1] + N[2]);
  double chance = 0; for (auto& c : CH) chance += c.deals.size() * sizeof(Deal) + c.slots.size() + sizeof(Chance);
  double scratch = cfg.threads * (SCRATCH_FLOATS * 4. + 200000.) + 49. * 5 * NMAX * 4;
  double perms = PERM[0].size() * 4. * (N[0] + N[1] + N[2]);
  return (nodes + store + boards + chance + scratch + perms + BN[52][5] * 2.) / 1048576 + 30;
}
static void buildOnce() {
  memset(STAT, 0, sizeof STAT); T.clear(); KID.clear(); ACTS.clear(); CH.clear(); BOARDID.clear(); BOARDS.clear(); STORE = 0; DEPTH = 0; MAXA = 0;
  St st{}; st.street = ROOT_STREET; for (int i = 0; i < 3; i++) st.s[i] = cfg.stack; st.onPath = true; st.board = ROOT_MASK;
  if (cfg.stack <= 0) streetEnd(st, 0); else { st.toAct = 0; build(st, 0); }
  SCRATCH_FLOATS = (size_t)(DEPTH + 6) * (2 * MAXA + 24) * NMAX + 4096;
}
// The requested runout counts, or (auto_sample) fewer dealt cards until the tree fits the
// memory limit and the runout budget (runouts: turn x river cards per flop line, a time
// budget): rivers first, then turns, never below 8 turns and 6 rivers.
static void buildTree() {
  TURNS = cfg.turnCards; RIVERS = cfg.riverCards;
  vector<pair<int, int>> plan = {{TURNS, RIVERS}};
  if (cfg.autoSample) for (auto tr : vector<pair<int, int>>{{0, 24}, {0, 16}, {0, 12}, {24, 12}, {24, 8}, {16, 8}, {12, 8}, {12, 6}, {10, 6}, {8, 6}}) {
    auto cnt = [&](int k, int avail) { return k <= 0 || k >= avail ? avail : k; };
    int now = cnt(plan.back().first, 49) * cnt(plan.back().second, 48), next = cnt(tr.first, 49) * cnt(tr.second, 48);
    if (next < now) plan.push_back(tr);
  }
  for (size_t i = 0; i < plan.size(); i++) {
    TURNS = ROOT_STREET == 0 ? plan[i].first : 0; RIVERS = ROOT_STREET <= 1 ? plan[i].second : 0;
    if (ROOT_STREET == 1 && i && plan[i].second == plan[i - 1].second) continue;
    auto cnt = [&](int k, int avail) { return k <= 0 || k >= avail ? avail : k; };
    int runs = ROOT_STREET == 0 ? cnt(TURNS, 49) * cnt(RIVERS, 48) : ROOT_STREET == 1 ? cnt(RIVERS, 48) : 1;
    if (cfg.runouts > 0 && runs > cfg.runouts && i + 1 < plan.size() && ROOT_STREET < 2) continue;
    buildOnce();
    double mb = estimateMB();
    if (mb <= cfg.memMB) return;
    if (i + 1 == plan.size() || ROOT_STREET == 2) { char b[256]; snprintf(b, sizeof b, "This spot needs about %.0f MB, over the %.0f MB memory limit. Use narrower ranges or fewer bet sizes.", mb, cfg.memMB); fail(b); }
  }
}

static double seconds(chrono::steady_clock::time_point t0) { return chrono::duration<double>(chrono::steady_clock::now() - t0).count(); }
static void walkRoot(const Ctx& X, float* out) { Reach R = {W[0].data(), W[1].data(), W[2].data()}; if (X.m != CFR) R[X.p] = nullptr; walk(0, X, R, out); }
static double Z[3];  // each player's weight of compatible deals, under its own removal model
static double total(int p, const float* v) { double s = 0; for (int h = 0; h < N[p]; h++) s += W[p][h] * v[h]; return s / Z[p]; }
// Each player's gain from a best response against the others' average strategies; the
// reported exploitability is their mean, in percent of the starting pot.
static double exploitability(double* br, double* ev) {
  for (int p = 0; p < 3; p++) {
    vector<float> v(N[p]); walkRoot({p, BR, 0, false}, v.data()); br[p] = total(p, v.data());
    walkRoot({p, EV, 0, false}, v.data()); ev[p] = total(p, v.data());
  }
  double g = 0; for (int p = 0; p < 3; p++) g += max(0., br[p] - ev[p]);
  return g / 3 / cfg.pot * 100;
}

// ---------- output
static string comboName(const Cb& c) { return cardName(c.c[1]) + cardName(c.c[0]); }
// Strategy rows are the average strategy, except where it is unsettled for a combo: if its
// own strategy almost never brings it to the node (reach under 0.5%), or the mix loses
// over 1% of the pot against the best action, the row ("adjusted") shows the best-EV action.
static void writeNode(FILE* f, int ni, vector<float> reach[3]) {
  const Node& n = T[ni];
  if (n.type == FOLD) { fprintf(f, "{\"end\":\"fold\"}"); return; }
  if (n.type == SHOW) { fprintf(f, "{\"end\":\"showdown\"}"); return; }
  if (n.type == CHANCE) { fprintf(f, "{\"end\":\"%s\"}", T[KID[n.kid]].type == ACT ? "next street" : "all-in runout"); return; }
  if (!n.cur) { fprintf(f, "{\"end\":\"next street\"}"); return; }
  int p = n.actor, A = n.nA, H = N[p]; static const char* K[] = {"fold", "check", "call", "bet", "raise"};
  fprintf(f, "{\"player\":%d,\"alive\":[%d,%d,%d],\"actions\":[", p, n.alive & 1, n.alive >> 1 & 1, n.alive >> 2 & 1);
  for (int a = 0; a < A; a++) { const Act& x = ACTS[n.kid + a]; fprintf(f, "%s{\"kind\":\"%s\",\"to\":%.6g,\"allin\":%s}", a ? "," : "", K[x.kind], x.to, x.allin ? "true" : "false"); }
  vector<float> sg((size_t)A * H), out; strategy(n, true, sg.data()); out = sg; vector<int> adjusted;
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
    vector<float> next[3] = {reach[0], reach[1], reach[2]}; for (int h = 0; h < H; h++) next[p][h] *= sg[a * H + h];
    writeNode(f, KID[n.kid + a], next);
  }
  fprintf(f, "]}");
}

static int evalMode() {
  char hb[64], bb[64]; while (scanf("%63s %63s", hb, bb) == 2) { auto h = parseCards(hb), b = parseCards(bb); if (h.size() != 2 || b.size() != 5) fail("Need 2 hole and 5 board cards."); printf("%d\n", holdem(h[0], h[1], b.data())); }
  return 0;
}

int main(int argc, char** argv) {
  try {
    initEval();
    if (argc == 2 && !strcmp(argv[1], "--eval")) return evalMode();
    if (argc != 2) { fprintf(stderr, "usage: mw_solver input.txt | --eval\n"); return 1; }
    auto t0 = chrono::steady_clock::now();
    cfg = readCfg(argv[1]); ROOT_STREET = cfg.board.size() - 3;
    if (cfg.path.size() && cfg.stack <= 0) fail("No chips behind, so no actions are possible.");
    setupCombos();
    buildTree();
    double mb = estimateMB();
    printf("Combos: %d, %d, %d; tree: %zu nodes, %zu river boards, %zu suit symmetries; dealt cards: turn %s, river %s\n", N[0], N[1], N[2], T.size(), BOARDS.size(), max((size_t)1, SIG.size()), TURNS ? to_string(TURNS).c_str() : "all", RIVERS ? to_string(RIVERS).c_str() : "all");
    for (int k = ROOT_STREET; k < 3; k++) printf("Street %d: %ld decisions, %ld chance, %ld folds, %ld showdowns\n", k, STAT[k][0], STAT[k][1], STAT[k][2], STAT[k][3]);
    printf("Memory estimate: %.0f MB\nTree built: %.1f s\n", mb, seconds(t0)); fflush(stdout);
    if (getenv("MW_DRY")) return 0;
    MEM.assign(STORE, 0.f);
    for (int t = 0; t < cfg.threads; t++) { auto* s = new Scratch(); s->buf.assign(SCRATCH_FLOATS, 0.f); SCR.push_back(s); }
    pool.start(cfg.threads);
    prepBoards(); printf("Boards ready: %.1f s\n", seconds(t0)); fflush(stdout);
    for (int p = 0; p < 3; p++) {
      vector<double> ca(N[p]), cb(N[p]); int a = (p + 1) % 3, b = (p + 2) % 3;
      compat(p, a, W[a].data(), ca.data()); compat(p, b, W[b].data(), cb.data());
      Z[p] = 0; for (int h = 0; h < N[p]; h++) Z[p] += W[p][h] * ca[h] * cb[h];
      if (Z[p] <= 0) fail("The three ranges have no compatible combos.");
    }
    double br[3] = {0, 0, 0}, ev[3] = {0, 0, 0}, ex = -1; int it = 0;
    for (it = 1; it <= cfg.maxIt; it++) {
      for (int p = 0; p < 3; p++) { vector<float> v(N[p]); walkRoot({p, CFR, it, false}, v.data()); }
      if (getenv("MW_TRACE")) { printf("iteration %d: %.2f s\n", it, seconds(t0)); fflush(stdout); }
      bool last = it == cfg.maxIt || seconds(t0) >= cfg.timeLimit;
      if (it % cfg.every == 0 || last) { ex = exploitability(br, ev); printf("Iter: %d\nTotal exploitability %.4f precent\nTime: %.1f s\n", it, ex, seconds(t0)); fflush(stdout); if (ex <= cfg.acc) break; }
      if (last) break;
    }
    if (it > cfg.maxIt) it = cfg.maxIt;
    if (!cfg.maxIt) ex = exploitability(br, ev);
    for (int p = 0; p < 3; p++) { vector<float> v(N[p]); walkRoot({p, EV, 0, true}, v.data()); ev[p] = total(p, v.data()); }
    struct rusage ru; getrusage(RUSAGE_SELF, &ru);
#ifdef __APPLE__
    double rss = ru.ru_maxrss / 1048576.;
#else
    double rss = ru.ru_maxrss / 1024.;
#endif
    FILE* f = fopen(cfg.out.c_str(), "w"); if (!f) fail("Cannot write " + cfg.out);
    string bs; for (int c : cfg.board) bs += cardName(c);
    char chance[160]; if (!TURNS && !RIVERS) snprintf(chance, sizeof chance, "every turn and river card"); else snprintf(chance, sizeof chance, "%s turn cards and %s river cards per turn", TURNS ? to_string(TURNS).c_str() : "all", RIVERS ? to_string(RIVERS).c_str() : "all");
    fprintf(f, "{\"version\":1,\"game\":\"NLH3\",\"board\":\"%s\",\"pot\":%.6g,\"stack\":%.6g,\"iterations\":%d,\"seconds\":%.2f,\"exploitability\":%.4f,\"bestResponse\":[%.4f,%.4f,%.4f],\"ev\":[%.4f,%.4f,%.4f],\"memoryEstimateMB\":%.0f,\"peakRssMB\":%.0f,\"threads\":%d,\"turnCards\":%d,\"riverCards\":%d,\"sampledRunouts\":%s,\"suitSymmetries\":%zu,\"chance\":\"%s\",\"nodes\":%zu,\"riverBoards\":%zu,",
      bs.c_str(), cfg.pot, cfg.stack, it, seconds(t0), ex, br[0], br[1], br[2], ev[0], ev[1], ev[2], mb, rss, cfg.threads, TURNS, RIVERS, TURNS || RIVERS ? "true" : "false", max((size_t)1, SIG.size()), chance, T.size(), BOARDS.size());
    fprintf(f, "\"combos\":[");
    for (int p = 0; p < 3; p++) { fprintf(f, "%s[", p ? "," : ""); for (int h = 0; h < N[p]; h++) fprintf(f, "%s\"%s\"", h ? "," : "", comboName(CB[p][h]).c_str()); fprintf(f, "]"); }
    fprintf(f, "],\"weights\":[");
    for (int p = 0; p < 3; p++) { fprintf(f, "%s[", p ? "," : ""); for (int h = 0; h < N[p]; h++) fprintf(f, "%s%.4g", h ? "," : "", W[p][h]); fprintf(f, "]"); }
    vector<float> reach[3] = {vector<float>(N[0], 1.f), vector<float>(N[1], 1.f), vector<float>(N[2], 1.f)};
    fprintf(f, "],\"tree\":"); writeNode(f, 0, reach); fprintf(f, "}\n"); fclose(f);
    printf("Done: %d iterations, %.4f%% exploitability, %.1f s, peak RSS %.0f MB\n", it, ex, seconds(t0), rss);
    return 0;
  } catch (exception& e) { fprintf(stderr, "Error: %s\n", e.what()); return 2; }
}
