#!/usr/bin/env node
'use strict';
// Checks for the three-player NLH solver, its JS spec and the bridge. Node 18+, no dependencies.
//   node tools/multiway-solver/test.cjs           about 2-3 minutes on 4 cores
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync, spawn, execFileSync } = require('child_process');
const G = require('../../studio/game.js'), L = require('../../studio/local-solver.js'), S = require('../../studio/spot-solver.js');
const here = __dirname, bin = path.join(here, 'mw_solver'), threads = Math.min(4, os.cpus().length);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-test-')), R = '23456789TJQKA', SU = 'cdhs', name = c => R[c >> 2] + SU[c & 3];
const cards = t => t.match(/../g).map(x => 4 * R.indexOf(x[0]) + SU.indexOf(x[1])), sum = a => a.reduce((s, x) => s + x, 0);
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures++; };
const rng = seed => { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; };

if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(path.join(here, 'mw_solver.cpp')).mtimeMs) {
  console.log('Building mw_solver...');
  execFileSync('c++', ['-O3', '-std=c++17', '-pthread', ...(process.arch === 'x64' ? ['-march=native'] : []), '-o', bin, path.join(here, 'mw_solver.cpp')], { stdio: 'inherit' });
}
let runs = 0;
function solve(lines) {
  const id = runs++, file = path.join(tmp, id + '.txt'), out = path.join(tmp, id + '.json'), t = Date.now();
  fs.writeFileSync(file, ['game NLH3', ...lines, 'threads ' + threads, 'output ' + out].join('\n') + '\n');
  const r = spawnSync(bin, [file], { encoding: 'utf8', maxBuffer: 1e8 });
  if (r.status !== 0) throw Error('solver failed: ' + r.stderr + r.stdout.slice(-500));
  return { r: JSON.parse(fs.readFileSync(out, 'utf8')), log: r.stdout, seconds: (Date.now() - t) / 1000 };
}
// Three ranges on disjoint card sets, so the opponents' cards never overlap and the solver's
// card removal is exact: then the three players' EVs must sum to the pot.
function disjoint(board, n, seed) {
  const r = rng(seed), b = cards(board), deck = [...Array(52).keys()].filter(c => !b.includes(c)).sort(() => r() - .5), out = [[], [], []];
  for (let p = 0; p < 3; p++) {
    const own = deck.slice(p * 15, p * 15 + 15), seen = new Set();
    while (out[p].length < n) { const x = own[Math.floor(r() * 15)], y = own[Math.floor(r() * 15)]; if (x === y) continue; const k = [x, y].sort((a, c) => c - a).map(name).join(''); if (seen.has(k)) continue; seen.add(k); out[p].push(k + ':' + (Math.round((.2 + .8 * r()) * 1000) / 1000)); }
  }
  return out.map((x, p) => 'range' + p + ' ' + x.join(','));
}
const nodes = (t, f, line = []) => { if (!t.actions) return; f(t, line); t.children.forEach((c, a) => nodes(c, f, [...line, t.actions[a]])); };
const report = (label, x) => `${label}: ${x.r.iterations} iterations, ${x.r.exploitability.toFixed(3)}% pot, ${x.r.seconds}s, ~${x.r.memoryEstimateMB} MB`;
const rules = G.normalize({ variant: 'NLH', seats: 3, stacks: [100, 100, 100] }).rules;

// 1. Evaluator against studio/game.js.
{
  const r = rng(7), hands = [], lines = [], t = Date.now();
  for (let i = 0; i < 200000; i++) {
    let deck = [...Array(52).keys()];
    if (i % 2) { if (i % 4 === 1) { const ranks = new Set(); while (ranks.size < 5) ranks.add(Math.floor(r() * 13)); deck = deck.filter(c => ranks.has(c >> 2)); } else { const a = Math.floor(r() * 4); deck = deck.filter(c => (c & 3) === a || (c >> 2) % 3 === 0); } }
    const d = []; while (d.length < 7) { const c = deck[Math.floor(r() * deck.length)]; if (!d.includes(c)) d.push(c); }
    hands.push(G.evaluate(d.slice(0, 2), d.slice(2), rules).high); lines.push(d.slice(0, 2).map(name).join('') + ' ' + d.slice(2).map(name).join(''));
  }
  const out = spawnSync(bin, ['--eval'], { input: lines.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1e8 }).stdout.trim().split('\n').map(Number);
  const order = hands.map((v, i) => i).sort((a, b) => hands[a] - hands[b]); let bad = 0;
  for (let k = 1; k < order.length; k++) { const a = order[k - 1], b = order[k]; if (hands[a] === hands[b] ? out[a] !== out[b] : !(out[a] < out[b])) bad++; }
  check(out.length === hands.length && bad === 0, `evaluator matches game.js on ${hands.length} hands (${bad} order mismatches, ${((Date.now() - t) / 1000).toFixed(1)}s)`);
}

// 2. River with every strategy uniform (no iterations): each player's EV against a brute-force
// enumeration of every three-hand deal through the solver's own tree.
{
  const board = 'Ks9h4d2c7s', b = cards(board), lines = ['board ' + board, 'pot 900', 'stack 2400', 'min_bet 100', ...disjoint(board, 14, 3), 'bet river all 0.5,1', 'raise river all 1', 'cap river 1', 'max_iterations 0'];
  const x = solve(lines), r = x.r, combos = r.combos.map(l => l.map(cards)), W = r.weights, rank = combos.map(l => l.map(h => G.evaluate(h, b, rules).high));
  // Payoff of every leaf for the given hands, weighted by the uniform path probability.
  const leaves = []; (function visit(n, c, folded, prob) {
    if (n.actions) { n.actions.forEach((a, k) => { const cc = c.slice(), f = folded.slice(); if (a.kind === 'fold') f[n.player] = true; else if (a.kind !== 'check') cc[n.player] = a.to; visit(n.children[k], cc, f, prob / n.actions.length); }); return; }
    leaves.push({ c, folded, prob, show: n.end === 'showdown' });
  })(r.tree, [0, 0, 0], [false, false, false], 1);
  const ev = [0, 0, 0]; let total = 0;
  for (let i = 0; i < combos[0].length; i++) for (let j = 0; j < combos[1].length; j++) for (let k = 0; k < combos[2].length; k++) {
    const w = W[0][i] * W[1][j] * W[2][k], rk = [rank[0][i], rank[1][j], rank[2][k]]; total += w;
    for (const l of leaves) {
      const pot = r.pot + sum(l.c), live = [0, 1, 2].filter(p => !l.folded[p]), top = Math.max(...live.map(p => rk[p])), win = live.filter(p => !l.show || rk[p] === top);
      for (let p = 0; p < 3; p++) ev[p] += w * l.prob * ((win.includes(p) ? pot / win.length : 0) - l.c[p]);
    }
  }
  const diff = Math.max(...ev.map((v, p) => Math.abs(v / total - r.ev[p])));
  check(diff < 1e-3 && Math.abs(sum(r.ev) - r.pot) < 1e-3, `uniform river: solver EVs ${r.ev.map(v => v.toFixed(3)).join(', ')} match brute force over ${combos.map(c => c.length).join('x')} deals and ${leaves.length} leaves (largest difference ${diff.toExponential(1)})`);
}

// 3. River, 3-way: converges, zero-sum, nobody folds the nuts, EVs bounded.
{
  const board = 'Qh8d5c3s2h', x = solve(['board ' + board, 'pot 1200', 'stack 4000', 'min_bet 100', ...disjoint(board, 60, 9), 'bet river all 0.33,0.66,1.5', 'raise river all 0.66', 'cap river 1', 'accuracy 0.1', 'max_iterations 2000', 'print_interval 25']), r = x.r, b = cards(board);
  const rank = r.combos.map(l => l.map(c => G.evaluate(cards(c), b, rules).high)), top = Math.max(...rank.flat()); let foldedNuts = 0, bad = 0;
  nodes(r.tree, n => { const k = n.actions.findIndex(a => a.kind === 'fold'); if (k >= 0) n.strategy.forEach((s, i) => { if (rank[n.player][i] === top && s[k] > .001) foldedNuts++; }); n.evs.forEach(e => e && e.forEach(v => { if (!(v >= -r.stack - 1e-6 && v <= r.pot + 2 * r.stack + 1e-6)) bad++; })); });
  check(r.exploitability < .1, report('river 3-way, 60 combos each', x));
  check(Math.abs(sum(r.ev) - r.pot) < 1e-3 && foldedNuts === 0 && bad === 0, `river zero-sum ${r.ev.map(v => v.toFixed(2)).join(' + ')} = pot ${r.pot}; nut combos never fold (${foldedNuts}); EVs bounded (${bad} outside)`);
}

// 4. Turn: every river card dealt, zero-sum, below 1% of the pot; suit isomorphism changes nothing.
{
  const board = 'Ah7h2h9c', base = ['board ' + board, 'pot 1500', 'stack 6000', 'min_bet 100', ...disjoint(board, 40, 21), 'bet turn all 0.66', 'bet river all 0.66', 'raise turn all none', 'raise river all none', 'accuracy 0.5', 'max_iterations 400', 'print_interval 20'];
  const x = solve(base), r = x.r;
  check(r.exploitability < 1 && Math.abs(sum(r.ev) - r.pot) < 1e-3 * r.pot && !r.sampledRunouts, report('turn 3-way, 40 combos each', x) + `, zero-sum ${sum(r.ev).toFixed(2)}`);
  // Symmetric ranges (closed under the hearts-free suit swaps) for the isomorphism check.
  const sym = ['range0 AA,KQs,T8s,65o', 'range1 KK,QJs,T9o,87s', 'range2 QQ,JTs,98s,54s'], iso = [...base.filter(l => !/^range|^accuracy|^max_it/.test(l)), ...sym, 'accuracy 0', 'max_iterations 10'];
  const a = solve(iso), c = solve([...iso, 'isomorphism 0']); let d = 0;
  const cmp = (u, v) => { if (Array.isArray(u)) u.forEach((y, i) => cmp(y, v[i])); else if (typeof u === 'number') d = Math.max(d, Math.abs(u - v) / Math.max(Math.abs(u), 10)); else if (u && typeof u === 'object') for (const k of ['strategy', 'evs', 'children']) if (u[k]) cmp(u[k], v[k]); };
  cmp(a.r.tree, c.r.tree);
  check(a.r.suitSymmetries > 1 && c.r.suitSymmetries === 1 && d < 1e-3, `isomorphism (${a.r.suitSymmetries} symmetries): ${a.r.riverBoards} vs ${c.r.riverBoards} river boards, largest relative difference ${d.toExponential(1)}`);
}

// 5. The real line (a lead, a raise and a call to come) is in the tree, every bet within the
// stack, raises at least the minimum; a flop solve with sampled runouts finishes.
{
  const board = 'Td9d4s', x = solve(['board ' + board, 'pot 800', 'stack 9700', 'min_bet 100', ...disjoint(board, 25, 41), 'lead flop 0 0', 'lead flop 1 0', 'path to:300,to:1200', 'turn_cards 6', 'river_cards 4', 'auto_sample 0', 'accuracy 1', 'max_iterations 60']), r = x.r; let bad = 0;
  const walk = (n, c, last) => { if (!n.actions) return; const top = Math.max(...c); n.actions.forEach((a, k) => { const cc = c.slice(); let nl = last; if (a.kind === 'call') cc[n.player] = a.to; if (a.kind === 'bet' || a.kind === 'raise') { if (a.to > r.stack + 1e-6 || (!a.allin && a.to - top < Math.max(last, 100) - 1e-6)) bad++; cc[n.player] = a.to; nl = Math.max(last, a.to - top); } walk(n.children[k], cc, nl); }); };
  walk(r.tree, [0, 0, 0], 0);
  const node = L.followMW(r.tree, [{ kind: 'bet', to: 300 }, { kind: 'raise', to: 1200 }]);
  check(bad === 0 && node.player === 2 && node.actions[0].kind === 'fold' && r.tree.actions.length === 2 && r.sampledRunouts && r.turnCards === 6, `tree: player 0's lead to 300 (leads otherwise off) and player 1's raise to 1200 found; ${bad} bets over the stack or under the minimum; ${report('sampled flop', x)}`);
}

// 6. Strict spec checks: nothing but validated values reaches the solver input.
{
  const good = { version: 1, game: 'NLH3', board: ['Ks', '9h', '4d'], pot: 750, stack: 9750, minBet: 100, sizes: { flop: { bet: [.33, .66], raise: [.66] }, turn: { bet: [.66], raise: [] }, river: { bet: [.66], raise: [] } }, caps: { flop: 1, turn: 1, river: 1 }, lead: { flop: [false, false, true] }, allin: true, allinThreshold: .67, ranges: [{ AsAh: 1 }, { '8c8d': .5 }, { QcJc: 1 }], path: [{ kind: 'check' }], hero: 'AsAh', heroIndex: 0, seats: [1, 2, 0], accuracy: .5, maxIterations: 300 };
  const bad = [s => s.ranges[1] = { '8c8d\nthreads 999': 1 }, s => s.ranges[0].KsAh = 1, s => s.path = [{ kind: 'bet', to: '5\noutput /etc/x' }], s => s.board = ['Ks', 'Ks', '4d'], s => s.sizes.flop.bet = [20], s => s.caps.flop = 9, s => s.hero = '8c8d', s => s.ranges[2].AdAc = 1.5, s => s.ranges = [s.ranges[0], s.ranges[1]], s => s.lead.flop = [1, 0]];
  let rejected = 0; for (const f of bad) { const s = JSON.parse(JSON.stringify(good)); f(s); try { L.input(s, { output: 'x.json' }); } catch { rejected++; } }
  const text = L.input(good, { threads: 4, output: 'r.json', memoryMB: 4000, timeLimit: 600 });
  check(rejected === bad.length && /^path check$/m.test(text) && /^range1 8c8d:0.5$/m.test(text) && /^lead flop 0 0$/m.test(text), `spec validation rejects ${rejected}/${bad.length} malformed specs and writes the input`);
}

// 7. End to end: a 6-max NLH pot three-way on the turn goes from the spot solver through the
// bridge to mw_solver, and comes back as legal app actions with EVs in bb.
(async () => {
  const port = 18000 + Math.floor(Math.random() * 2000), server = spawn(process.execPath, [path.join(here, '..', 'local-solver', 'server.cjs'), '--port', String(port), '--mw-solver', bin, '--threads', String(threads), '--timeout', '600'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, fail) => { server.stdout.on('data', d => /listening/.test(d) && ok()); server.on('exit', () => fail(Error('bridge exited'))); });
  try {
    for (const facing of [false, true]) {
      const config = { variant: 'NLH', seats: 6, stacks: [100, 100, 100, 100, 100, 100], button: 0 }, h = new G.Hand(config, { rng: G.rng(facing ? 12 : 11) });
      for (const a of [{ kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' }, { kind: 'raise', target: 250 }, { kind: 'call' }, { kind: 'call' }, { kind: 'check' }, { kind: 'check' }, { kind: 'bet', target: 250 }, { kind: 'call' }, { kind: 'call' }]) h.act(a);
      if (facing) h.act({ kind: 'bet', target: 1000 });
      const hero = h.actor, ranges = Array(6).fill('');
      for (const seat of h.living()) ranges[seat] = 'TT+,AJs+,KQs,QJs,JTs,T9s,98s,AQo+,KQo,A5s-A2s,' + h.holes[seat].slice().sort((x, y) => y - x).map(name).join('') + ':1';
      const data = { config, actor: hero, heroCards: h.holes[hero], board: h.board, actions: h.actionLog.map(a => ({ seat: a.seat, street: a.street, kind: a.kind, target: a.target })) };
      const solver = new S.Solver(null, data, { ranges, localSolver: 'http://127.0.0.1:' + port, forceLocal: true, localAccuracy: 1 }), t = Date.now();
      while (!solver.complete) { solver.step(); await new Promise(ok => setTimeout(ok, 100)); }
      const r = solver.result(), legal = h.legal();
      const fine = r.supported && r.solve.method === 'local-multiway' && Math.abs(sum(r.reference) - 1) < 1e-6 && r.actions.every(a => a.kind === 'fold' ? legal.toCall > 0 : a.kind === 'check' ? legal.check : a.kind === 'call' ? legal.toCall > 0 : a.target <= legal.maxRaiseTo && (a.target >= legal.minRaiseTo || a.target === legal.allInTo)) && r.mean.every(v => Number.isFinite(v) && Math.abs(v) <= 200) && r.handMix && Object.keys(r.handMix.classes).length > 5;
      check(fine, `6-max NLH 3-way turn via the bridge (${facing ? 'facing a bet' : 'checked to'}): ${r.supported ? r.actions.map((a, i) => a.label + ' ' + (100 * r.reference[i]).toFixed(0) + '% EV ' + r.mean[i].toFixed(2)).join(', ') + `; ${r.solve.iterations} iterations, ${r.solve.exploitability}% pot, ${((Date.now() - t) / 1000).toFixed(1)}s` : r.message}`);
    }
  } finally { server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(failures ? failures + ' check(s) failed.' : 'All checks passed.');
  process.exitCode = failures ? 1 : 0;
})();
