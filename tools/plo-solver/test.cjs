#!/usr/bin/env node
'use strict';
// Checks for the PLO solver, its JS spec and the bridge. Node 18+, no dependencies.
//   node tools/plo-solver/test.cjs           about 1-2 minutes on 4 cores
//   node tools/plo-solver/test.cjs --full    adds a 300-combo flop solved to 0.5% (several minutes)
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync, spawn, execFileSync } = require('child_process');
const G = require('../../studio/game.js'), L = require('../../studio/local-solver.js'), S = require('../../studio/spot-solver.js');
const here = __dirname, bin = path.join(here, 'plo_solver'), full = process.argv.includes('--full'), threads = Math.min(4, os.cpus().length);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-test-')), R = '23456789TJQKA', SU = 'cdhs', name = c => R[c >> 2] + SU[c & 3];
const cards = t => t.match(/../g).map(x => 4 * R.indexOf(x[0]) + SU.indexOf(x[1])), sum = a => a.reduce((s, x) => s + x, 0);
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures++; };
const rng = seed => { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; };

if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(path.join(here, 'plo_solver.cpp')).mtimeMs) {
  console.log('Building plo_solver...');
  execFileSync('c++', ['-O3', '-std=c++17', '-pthread', ...(process.arch === 'x64' ? ['-march=native'] : []), '-o', bin, path.join(here, 'plo_solver.cpp')], { stdio: 'inherit' });
}
let runs = 0;
function solve(lines) {
  const id = runs++, file = path.join(tmp, id + '.txt'), out = path.join(tmp, id + '.json'), t = Date.now();
  fs.writeFileSync(file, [...lines, 'threads ' + threads, 'output ' + out].join('\n') + '\n');
  const r = spawnSync(bin, [file], { encoding: 'utf8', maxBuffer: 1e8 });
  if (r.status !== 0) throw Error('solver failed: ' + r.stderr + r.stdout.slice(-500));
  return { r: JSON.parse(fs.readFileSync(out, 'utf8')), log: r.stdout, seconds: (Date.now() - t) / 1000 };
}
// Random weighted combos off the board; with sym, closed under the suit swaps that fix the board.
function range(board, n, seed, sym) {
  const r = rng(seed), b = cards(board), deck = [...Array(52).keys()].filter(c => !b.includes(c)), m = new Map(), perms = [];
  (function p(a, rest) { if (!rest.length) return perms.push(a); rest.forEach((v, i) => p(a.concat(v), rest.filter((_, j) => j !== i))); })([], [0, 1, 2, 3]);
  const key = cs => cs.slice().sort((x, y) => x - y).join(), fix = perms.filter(p => key(b.map(c => (c & ~3) | p[c & 3])) === key(b));
  while (m.size < n) {
    const cs = []; while (cs.length < 4) { const c = deck[Math.floor(r() * deck.length)]; if (!cs.includes(c)) cs.push(c); }
    const w = Math.round((.2 + .8 * r()) * 1000) / 1000;
    for (const p of sym ? fix : [[0, 1, 2, 3]]) m.set(cs.map(c => (c & ~3) | p[c & 3]).sort((x, y) => y - x).map(name).join(''), w);
  }
  return [...m].map(([k, w]) => k + ':' + w).join(',');
}
const spot = (board, pot, stack, n, seed, extra = [], sym = false) => ['game PLO4', 'board ' + board, 'pot ' + pot, 'stack ' + stack, 'min_bet 100', 'range_oop ' + range(board, n, seed, sym), 'range_ip ' + range(board, n, seed + 1, sym), ...extra];
const nodes = (t, f, line = []) => { if (!t.actions) return; f(t, line); t.children.forEach((c, a) => nodes(c, f, [...line, t.actions[a]])); };
const evBounds = (r, ok) => nodes(r.tree, n => n.evs.forEach(e => e && e.forEach(v => { if (!(v >= -r.stack - 1e-6 && v <= r.pot + r.stack + 1e-6)) ok.bad++; })));
const report = (label, x) => `${label}: ${x.r.iterations} iterations, ${x.r.exploitability.toFixed(3)}% pot, ${x.r.seconds}s, ~${x.r.memoryEstimateMB} MB`;

// 1. Evaluator against studio/game.js (Omaha: exactly two hole and three board cards).
{
  const rules = G.normalize({ variant: 'PLO4', seats: 2, stacks: [100, 100] }).rules, r = rng(7), hands = [], lines = [], t = Date.now();
  for (let i = 0; i < 200000; i++) {
    // Half uniform; half from a narrow deck (few ranks, or two suits) for many flushes, straights and boats.
    let deck = [...Array(52).keys()];
    if (i % 2) { if (i % 4 === 1) { const ranks = new Set(); while (ranks.size < 6) ranks.add(Math.floor(r() * 13)); deck = deck.filter(c => ranks.has(c >> 2)); } else { const a = Math.floor(r() * 4), b = (a + 1 + Math.floor(r() * 3)) % 4; deck = deck.filter(c => (c & 3) === a || (c & 3) === b); } }
    const d = []; while (d.length < 9) { const c = deck[Math.floor(r() * deck.length)]; if (!d.includes(c)) d.push(c); }
    hands.push(G.evaluate(d.slice(0, 4), d.slice(4), rules).high); lines.push(d.slice(0, 4).map(name).join('') + ' ' + d.slice(4).map(name).join(''));
  }
  const out = spawnSync(bin, ['--eval'], { input: lines.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1e8 }).stdout.trim().split('\n').map(Number);
  const order = hands.map((v, i) => i).sort((a, b) => hands[a] - hands[b]);let bad = 0;
  for (let k = 1; k < order.length; k++) { const a = order[k - 1], b = order[k]; if (hands[a] === hands[b] ? out[a] !== out[b] : !(out[a] < out[b])) bad++; }
  const cats = new Set(hands.map(v => Math.floor(v / 15 ** 5)));
  check(out.length === hands.length && bad === 0, `evaluator matches game.js on ${hands.length} hands (${cats.size} categories, ${bad} order mismatches, ${((Date.now() - t) / 1000).toFixed(1)}s)`);
}

// 2. Polarized river toy game: IP has nut kings full of nothing beats... (sets of kings) or air; OOP only
// bluff-catchers (a pair of queens). No straights or flushes are possible on this board, and the
// two ranges share no cards. Theory for a bet b into pot p: bluffs:value = b/(p+b), call = p/(p+b).
for (const b of [.75, 1]) {
  const value = ['KcKh3c5c', 'KcKd3h5d', 'KhKd3s5s'], air = ['6c6d8c8d', '6h6s8h8s', '8s8c6d3s', '8d8h6c3c', '6s6h5s3h', '8c6h5c3c'];
  const x = solve(['game PLO4', 'board KsQd7h4c2s', 'pot 100', 'stack 1000', 'range_oop QcJcTd9d,QhJhTc9c,QsJsTh9h,QcJdTs9s,QhJsTd9c', 'range_ip ' + [...value, ...air].join(','), 'bet river oop none', 'bet river ip ' + b, 'raise river oop none', 'raise river ip none', 'accuracy 0.002', 'max_iterations 5000', 'print_interval 50']), r = x.r;
  const ipNode = r.tree.children[0], callNode = ipNode.children[1], ip = r.combos[1], bet = i => ipNode.strategy[i][1];
  const bluffs = sum(ip.map((c, i) => air.some(a => sum(cards(a)) === sum(cards(c)) && cards(a).sort().join() === cards(c).sort().join()) ? bet(i) : 0)), values = sum(ip.map((c, i) => c.startsWith('K') ? bet(i) : 0));
  const call = sum(callNode.strategy.map(s => s[1])) / callNode.strategy.length, wantRatio = b / (1 + b), wantCall = 1 / (1 + b);
  check(Math.abs(values - 3) < .01 && Math.abs(bluffs / values - wantRatio) < .01 && Math.abs(call - wantCall) < .01, `toy river, bet ${b} pot: value bets ${values.toFixed(3)}/3, bluff:value ${(bluffs / values).toFixed(4)} (theory ${wantRatio.toFixed(4)}), call ${call.toFixed(4)} (theory ${wantCall.toFixed(4)})`);
  check(Math.abs(r.ev[0] + r.ev[1] - 100) < .01, `toy river, bet ${b} pot: EVs ${r.ev.map(v => v.toFixed(3)).join(' + ')} = pot 100`);
}

// 3. River with 400 combos a side: convergence, zero-sum, EV bounds, nobody folds the nuts.
{
  const x = solve(spot('9h8h3c2dKs', 1000, 4000, 400, 11, ['accuracy 0.2', 'max_iterations 1000'])), r = x.r, rules = G.normalize({ variant: 'PLO4', seats: 2, stacks: [1, 1] }).rules, board = cards(r.board);
  const rank = r.combos.map(list => list.map(c => G.evaluate(cards(c), board, rules).high)), top = Math.max(...rank[0], ...rank[1]);let foldedNuts = 0, ok = { bad: 0 };
  nodes(r.tree, n => { const k = n.actions.findIndex(a => a.kind === 'fold'); if (k >= 0) n.strategy.forEach((s, i) => { if (rank[n.player][i] === top && s[k] > .001) foldedNuts++; }); });
  evBounds(r, ok);
  check(r.exploitability < .2, report('river 400 combos', x));
  check(Math.abs(r.ev[0] + r.ev[1] - r.pot) < .01 * r.pot / 100, `river zero-sum: ${r.ev[0].toFixed(2)} + ${r.ev[1].toFixed(2)} = ${(r.ev[0] + r.ev[1]).toFixed(2)} (pot ${r.pot})`);
  check(foldedNuts === 0 && ok.bad === 0, `river: nut combos never fold (${foldedNuts}), every EV within [-stack, pot+stack] (${ok.bad} outside)`);
}

// 4. Turn, 300 combos a side, to below 0.5% of the pot.
{
  const x = solve(spot('AsKd7h2c', 2000, 8000, 300, 21, ['accuracy 0.5', 'max_iterations 400'])), r = x.r, ok = { bad: 0 };evBounds(r, ok);
  check(r.exploitability < .5, report('turn 300 combos', x));
  check(Math.abs(r.ev[0] + r.ev[1] - r.pot) < 1e-4 * r.pot && ok.bad === 0, `turn zero-sum: ${r.ev[0].toFixed(2)} + ${r.ev[1].toFixed(2)} = pot ${r.pot}; EVs bounded`);
}

// 5. Suit isomorphism changes nothing but speed: same EVs and strategies with it on and off
// (after 10 iterations; longer runs drift apart through float summation order only).
{
  const base = spot('Ah7h2h9c', 1000, 3000, 150, 31, ['accuracy 0', 'max_iterations 10', 'print_interval 10'], true), a = solve(base), b = solve([...base, 'isomorphism 0']);let d = 0;
  const cmp = (x, y) => { if (Array.isArray(x)) x.forEach((v, i) => cmp(v, y[i])); else if (typeof x === 'number') d = Math.max(d, Math.abs(x - y) / (Math.abs(x) > 1 ? Math.abs(x) : 1)); else if (x && typeof x === 'object') for (const k of ['strategy', 'evs', 'children']) if (x[k]) cmp(x[k], y[k]); };
  cmp(a.r.tree, b.r.tree);
  check(a.r.suitSymmetries === 2 && b.r.suitSymmetries === 1 && d < 1e-3 && Math.abs(a.r.exploitability - b.r.exploitability) < 1e-3, `isomorphism: ${a.r.riverBoards} vs ${b.r.riverBoards} river boards, largest relative difference ${d.toExponential(1)}, exploitability ${a.r.exploitability} vs ${b.r.exploitability}`);
}

// 6. Pot-limit tree: the actual line (a 40% donk and a non-standard raise) is in the tree, every
// bet is within the pot limit and the stack, and raises are at least the minimum.
{
  const x = solve(spot('Td9d4s3c', 1200, 3000, 120, 41, ['accuracy 2', 'max_iterations 50', 'path to:480,to:1500'])), r = x.r;let bad = 0;
  const walk = (n, c, pot, last) => { if (!n.actions) return; const p = n.player, q = 1 - p, facing = c[q] - c[p]; n.actions.forEach((a, k) => { const cc = c.slice(); let np = pot, nl = last; if (a.kind === 'call') { np += a.to - c[p]; cc[p] = a.to; } if (a.kind === 'bet' || a.kind === 'raise') { if (a.to > c[q] + pot + facing + 1e-6 || a.to > c[p] + r.stack + 1e-6 || (!a.allin && a.to - c[q] < Math.max(last, 100) - 1e-6)) bad++; np += a.to - c[p]; cc[p] = a.to; nl = Math.max(last, a.to - c[q]); } walk(n.children[k], cc, np, nl); }); };
  walk(r.tree, [0, 0], r.pot, 0);
  const node = L.followPLO(r.tree, [{ kind: 'bet', to: 480 }, { kind: 'raise', to: 1500 }]);
  check(bad === 0 && node.player === 0 && node.actions[0].kind === 'fold', `pot-limit tree: real line bet 480, raise to 1500 found; ${bad} actions over the pot limit, stack or under the minimum`);
}

// 7. Flop. Default: a small flop to 1%; --full: 300 combos a side to 0.5% (minutes on 4 cores).
{
  const n = full ? 300 : 40, x = solve(spot('Ks9h4d', 650, 9650, n, 51, ['accuracy ' + (full ? .5 : 1), 'max_iterations 300', 'memory_limit_mb 12000'])), r = x.r, ok = { bad: 0 };evBounds(r, ok);
  check(r.exploitability < (full ? .5 : 1) && Math.abs(r.ev[0] + r.ev[1] - r.pot) < 1e-3 * r.pot && ok.bad === 0, report(`flop ${n} combos`, x) + `, peak RSS ${r.peakRssMB} MB, zero-sum ${(r.ev[0] + r.ev[1]).toFixed(2)}`);
}

// 8. Strict spec checks: nothing but validated values reaches the solver input.
{
  const good = { version: 1, game: 'PLO4', board: ['Ks', '9h', '4d'], pot: 650, stack: 9650, minBet: 100, sizes: { flop: { oop: { bet: [.33], raise: [1] }, ip: { bet: [.33], raise: [1] } } }, caps: { flop: 2 }, allinThreshold: .67, rangeOop: { AsAhQcJc: 1 }, rangeIp: { '8c8d7c6d': .5 }, path: [{ kind: 'check' }], hero: 'AsAhQcJc', heroSeat: 2, heroIsIp: false, accuracy: .5, maxIterations: 300 };
  const bad = [s => s.rangeIp = { '8c8d7c6d\nthreads 999': 1 }, s => s.rangeOop.KsAhQcJc = 1, s => s.path = [{ kind: 'bet', to: '5\noutput /etc/x' }], s => s.board = ['Ks', 'Ks', '4d'], s => s.sizes.flop.ip.bet = [2], s => s.caps.flop = 9, s => s.hero = '8c8d7c6d', s => s.rangeIp.AsAh2c2d = 1.5];
  let rejected = 0;for (const f of bad) { const s = JSON.parse(JSON.stringify(good)); f(s); try { L.input(s, { output: 'x.json' }); } catch { rejected++; } }
  const text = L.input(good, { threads: 4, output: 'r.json', memoryMB: 4000, timeLimit: 600 });
  check(rejected === bad.length && /^path check$/m.test(text) && /^range_ip 8c8d7c6d:0.5$/m.test(text), `spec validation rejects ${rejected}/${bad.length} malformed specs and writes the input`);
}

// 9. NLH specs and solver input are unchanged from the committed version.
try {
  const old = path.join(tmp, 'old-local-solver.js');fs.writeFileSync(old, execFileSync('git', ['show', 'f3d00c6:studio/local-solver.js'], { cwd: here, encoding: 'utf8' }));
  const keep = globalThis.PokerLocalSolver, O = require(old); globalThis.PokerLocalSolver = keep; const config = { variant: 'NLH', seats: 6, stacks: [100, 100, 100, 100, 100, 100], button: 0 }, h = new G.Hand(config, { rng: G.rng(3) });
  for (const a of [{ kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' }, { kind: 'raise', target: 250 }, { kind: 'fold' }, { kind: 'call' }, { kind: 'check' }, { kind: 'bet', target: 180 }]) h.act(a);
  const ranges = { rows: () => G.combinations([...Array(52).keys()].filter(c => !h.board.includes(c)), 2).map((cards, i) => ({ cards, prob: (i % 7 + 1) / 7 })) }, data = { config, actor: h.actor, heroCards: h.holes[h.actor], board: h.board, actions: h.actionLog.map(a => ({ seat: a.seat, street: a.street, kind: a.kind, target: a.target })) };
  const a = L.spec(data, ranges), b = O.spec(data, ranges);
  check(JSON.stringify(a) === JSON.stringify(b) && L.input(a, { threads: 3, output: 'o.json' }) === O.input(b, { threads: 3, output: 'o.json' }), 'NLH spec and TexasSolver input are byte-for-byte unchanged');
} catch (error) { console.log('skip NLH comparison: ' + error.message.split('\n')[0]); }

// 10. End to end: a 6-max PLO pot that is heads-up on the turn goes from the spot solver through
// the bridge to plo_solver, and comes back as legal app actions with EVs in bb.
(async () => {
  const port = 18000 + Math.floor(Math.random() * 2000), server = spawn(process.execPath, [path.join(here, '..', 'local-solver', 'server.cjs'), '--port', String(port), '--plo-solver', bin, '--threads', String(threads), '--timeout', '600'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, fail) => { server.stdout.on('data', d => /listening/.test(d) && ok()); server.on('exit', () => fail(Error('bridge exited'))); });
  try {
    for (const facing of [false, true]) {
      const config = { variant: 'PLO4', seats: 6, stacks: [100, 100, 100, 100, 100, 100], button: 0 }, h = new G.Hand(config, { rng: G.rng(facing ? 12 : 11) });
      h.act({ kind: 'fold' }); h.act({ kind: 'fold' }); h.act({ kind: 'fold' }); h.act({ kind: 'raise', target: h.legal().maxRaiseTo }); h.act({ kind: 'fold' }); h.act({ kind: 'call' });
      h.act({ kind: 'check' }); h.act({ kind: 'bet', target: Math.round(h.pot / 3) }); h.act({ kind: 'call' }); h.act({ kind: 'check' });
      if (facing) h.act({ kind: 'bet', target: Math.round(h.pot * .6) });
      const hero = h.actor, board = h.board.map(name).join(''), ranges = Array(6).fill('');
      for (const seat of [0, 2]) ranges[seat] = range(board, 150, 60 + seat) + ',' + h.holes[seat].slice().sort((x, y) => y - x).map(name).join('') + ':1';
      const data = { config, actor: hero, heroCards: h.holes[hero], board: h.board, actions: h.actionLog.map(a => ({ seat: a.seat, street: a.street, kind: a.kind, target: a.target })) };
      const solver = new S.Solver(null, data, { ranges, localSolver: 'http://127.0.0.1:' + port, localAccuracy: .5 }), t = Date.now();
      while (!solver.complete) { solver.step(); await new Promise(ok => setTimeout(ok, 100)); }
      const r = solver.result(), legal = h.legal();
      const fine = r.supported && r.solve.method === 'local-plo' && Math.abs(sum(r.reference) - 1) < 1e-6 && r.actions.every(a => a.kind === 'fold' ? legal.fold : a.kind === 'check' ? legal.check : a.kind === 'call' ? legal.toCall > 0 : a.target <= legal.maxRaiseTo && (a.target >= legal.minRaiseTo || a.target === legal.allInTo)) && r.mean.every(v => Number.isFinite(v) && Math.abs(v) <= 200);
      check(fine, `6-max PLO turn via the bridge (${facing ? 'facing a 60% bet' : 'checked to'}): ${r.supported ? r.actions.map((a, i) => a.label + ' ' + (100 * r.reference[i]).toFixed(0) + '% EV ' + r.mean[i].toFixed(2)).join(', ') + `; ${r.solve.iterations} iterations, ${r.solve.exploitability}% pot, ${((Date.now() - t) / 1000).toFixed(1)}s` : r.message}`);
    }
  } finally { server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(failures ? failures + ' check(s) failed.' : 'All checks passed.');
  process.exitCode = failures ? 1 : 0;
})();
