#!/usr/bin/env node
'use strict';
// Precomputes three-way flop strategies with mw_solver for common 3-way pots. Each solved
// flop is saved as its own file, so runs can stop and resume; `bundle` merges them into
// one range-lab-multiway-library-v1 file.
//   node tools/multiway-solver/library.cjs solve --spots btn-sb-bb --flops 100 --out multiway-work
//   node tools/multiway-solver/library.cjs bundle --out multiway-work
//   node tools/multiway-solver/library.cjs list
// Options: --threads (default: all cores), --accuracy (% of pot, default 0.5), --iterations (default
// 300), --memory MB (default 70% of this computer's), --jobs N (flops at once), --limit N (stop after
// N flops), --shard K/N (every Nth flop from the Kth) and --reverse 1, as in tools/postflop/library.cjs.
// --runouts N caps turn x river cards dealt per flop line (default auto, as in the app: 96 for wide
// ranges, more for narrow ones; more is closer to every card, and slower in proportion); --turn-cards T --river-cards R fix them instead.
// Ranges are the app's built-in preflop estimates (studio/spot-solver.js heuristicPreflop), the
// ranges the app itself uses for these lines when no chart covers them. The preflop chart packs
// stop at two players to the flop, so they have no three-way lines.
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), { spawn } = require('child_process');
const G = require('../../studio/game.js'), L = require('../../studio/local-solver.js'), S = require('../../studio/spot-solver.js'), Lib = require('../../studio/postflop-library.js'), F = require('../postflop/flops.cjs'), C = G.Core;

// Preflop lines on a 6-max 100bb table with the button on seat 0 (UTG 3, HJ 4, CO 5, BTN 0, SB 1, BB 2).
const SIX = { seats: 6, stacks: [100, 100, 100, 100, 100, 100], button: 0 }, f = { kind: 'fold' }, call = { kind: 'call' }, open = { kind: 'raise', target: 250 };
const SPOTS = {
  'btn-sb-bb': { label: '6-max 100bb · BTN opens, SB and BB call', steps: [f, f, f, open, call, call] },
  'co-btn-bb': { label: '6-max 100bb · CO opens, BTN and BB call', steps: [f, f, open, call, f, call] },
  'hj-co-bb': { label: '6-max 100bb · HJ opens, CO and BB call', steps: [f, open, call, f, f, call] },
  'utg-btn-bb': { label: '6-max 100bb · UTG opens, BTN and BB call', steps: [open, f, f, call, f, call] },
  'co-btn-sb-squeeze': { label: '6-max 100bb · CO opens, BTN calls, SB squeezes to 11, CO and BTN call', steps: [f, f, open, call, { kind: 'raise', target: 1100 }, f, call, call] },
  'co-btn-bb-squeeze': { label: '6-max 100bb · CO opens, BTN calls, BB squeezes to 12, CO and BTN call', steps: [f, f, open, call, f, { kind: 'raise', target: 1200 }, call, call] },
};

const args = { cmd: process.argv[2] || 'help', spots: 'btn-sb-bb', flops: '100', out: 'multiway-work', threads: String(os.cpus().length), accuracy: '0.5', iterations: '300', runouts: 'auto', memory: String(Math.round(os.totalmem() / 1048576 * .7)), solver: path.join(__dirname, 'mw_solver'), timeout: '7200', jobs: '1', name: 'Citrus Poker 3-way flop library' };
for (let i = 3; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

// Replays the line; the flop's pot, stack, the three players in postflop order and their
// preflop range estimates (hand class weights).
function prepare(id) {
  const def = SPOTS[id]; if (!def) throw Error('Unknown spot ' + id + '. Known: ' + Object.keys(SPOTS).join(', '));
  const config = G.normalize({ variant: 'NLH', ...SIX }), h = new G.Hand(config, { rng: G.rng(5) });
  for (const a of def.steps) h.act(a);
  if (h.street !== 1 || h.living().length !== 3) throw Error(id + ' does not reach a three-way flop.');
  const actions = h.actionLog.map(a => ({ seat: a.seat, street: a.street, kind: a.kind, target: a.target })), after = i => (i - h.button + h.n) % h.n || h.n, seats = h.living().sort((a, b) => after(a) - after(b));
  const classes = seats.map(seat => { const share = S.heuristicPreflop(config, actions, seat), o = {}; for (const c of new Set(G.combinations([...Array(52).keys()], 2).map(cs => C.handClass(cs)))) { const w = share ? share(c) : 1; if (w >= .005) o[c] = Math.round(w * 1000) / 1000; } return o; });
  const raiser = [...actions].reverse().find(a => a.kind === 'raise')?.seat;
  return { id, label: def.label, pot: h.pot, stack: Math.min(...seats.map(i => h.stacks[i])), seats, raiser, classes, actions };
}
// The app's flop tree (studio/local-solver.js MW_TREE) with the spot's ranges as exact combos off this flop.
function spec(spot, board) {
  const dead = new Set(board.map(c => C.cards(c)[0])), name = cs => cs.slice().sort((a, b) => b - a).map(C.cardName).join('');
  const ranges = spot.classes.map(cl => { const o = {}; for (const cs of G.combinations([...Array(52).keys()].filter(c => !dead.has(c)), 2)) { const w = cl[C.handClass(cs)]; if (w > 0) o[name(cs)] = w; } return o; });
  const t = L.MW_TREE.flop, sizes = {}, caps = {}; for (const [k, v] of Object.entries(t)) { sizes[k] = { bet: v.bet.map(x => Math.round(x * 1e4) / 1e4), raise: v.raise.map(x => Math.round(x * 1e4) / 1e4) }; caps[k] = L.MW_TREE.cap; }
  const hero = Object.keys(ranges[0])[0];
  return L.validate({ version: 1, game: 'NLH3', board, pot: spot.pot, stack: spot.stack, minBet: 100, sizes, caps, lead: { flop: spot.seats.map(i => i === spot.raiser) }, allin: true, allinThreshold: L.MW_TREE.allinThreshold, runouts: args.runouts === 'auto' ? L.mwRunouts(ranges) : Number(args.runouts), ranges, seats: spot.seats, path: [], hero, heroIndex: 0, accuracy: Number(args.accuracy), maxIterations: Number(args.iterations) });
}
function run(input, dir) {
  return new Promise((resolve, reject) => {
    const file = path.join(dir, 'input.txt'); fs.writeFileSync(file, input); let iterations = 0, exploitability = null, tail = ''; const started = Date.now();
    const child = spawn(args.solver, [file], { cwd: dir }), timer = setTimeout(() => child.kill('SIGKILL'), Number(args.timeout) * 1000);
    child.stdout.on('data', d => { for (const l of String(d).split(/[\r\n]+/)) { let m = l.match(/^Iter: (\d+)/); if (m) iterations = +m[1]; m = l.match(/Total exploitability (-?[\d.]+)/); if (m) exploitability = +m[1]; } });
    child.stderr.on('data', d => { tail = (tail + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ iterations, exploitability, seconds: (Date.now() - started) / 1000 }) : reject(Error('mw_solver exit ' + code + ' ' + tail.slice(-300))); });
  });
}
// Flop decisions of a solve as library nodes: path labels like the heads-up library's
// ("CHECK/BET 250/CALL"), the acting player by postflop order (0 acts first), and each
// combo's average strategy.
function nodes(result) {
  const out = [];
  (function visit(node, p) {
    if (!node || !node.actions) return;
    const labels = node.actions.map(a => a.kind.toUpperCase() + (a.kind === 'bet' || a.kind === 'raise' ? ' ' + Math.round(a.to) : ''));
    const rows = result.combos[node.player].map((c, i) => [Lib.comboIndex(C.cards(c)), node.strategy[i]]);
    out.push({ path: p, player: node.player, actions: labels, table: Lib.encode(rows, labels.length) });
    node.children.forEach((c, i) => visit(c, (p ? p + '/' : '') + labels[i]));
  })(result.tree, '');
  return out;
}
// Root EVs per hand class for each player (chips from the flop's start, net), averaged over the class's combos.
function classEvs(result) {
  const root = result.tree, out = [];
  for (let p = 0; p < 3; p++) {
    if (p !== root.player) { out.push(null); continue; }
    const sum = {}, n = {}; result.combos[p].forEach((c, i) => { const e = root.evs[i]; if (!e) return; const v = e.reduce((s, x, a) => s + x * root.strategy[i][a], 0), k = C.handClass(C.cards(c)); sum[k] = (sum[k] || 0) + v; n[k] = (n[k] || 0) + 1; });
    out.push(Object.fromEntries(Object.keys(sum).map(k => [k, Math.round(sum[k] / n[k] * 100) / 100])));
  }
  return out;
}

async function solve() {
  const ids = args.spots.split(','), flops = args.flops === 'all' ? F.all() : F.subset(Number(args.flops)), tasks = [];
  for (const id of ids) {
    const spot = prepare(id), dir = path.join(args.out, id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spot.json'), JSON.stringify({ id, label: spot.label, game: 'NLH3', seats: spot.seats, actions: spot.actions, pot: spot.pot, stack: spot.stack, tree: L.MW_TREE.flop, ranges: spot.classes }, null, 1));
    console.log(spot.label + ': pot ' + G.bb(spot.pot) + ' bb, stack ' + G.bb(spot.stack) + ' bb, ' + flops.length + ' flops');
    for (const fl of flops) { const file = path.join(dir, fl.key + '.json'); if (!fs.existsSync(file)) tasks.push({ id, spot, f: fl, file, index: ids.indexOf(id) * flops.length + flops.indexOf(fl) }); }
  }
  const one = async ({ id, spot, f: fl, file }) => {
    if (fs.existsSync(file)) return;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'range-lab-mw-')), out = path.join(work, 'out.json');
    try {
      let input = L.input(spec(spot, fl.cards.map(C.cardName)), { threads: Number(args.threads), output: 'out.json', memoryMB: Number(args.memory), timeLimit: Number(args.timeout) * .95 });
      if (args['turn-cards']) input += 'auto_sample 0\nturn_cards ' + Number(args['turn-cards']) + '\nriver_cards ' + Number(args['river-cards'] || 0) + '\n';
      const stats = await run(input, work), r = JSON.parse(fs.readFileSync(out, 'utf8'));
      const result = { key: fl.key, weight: fl.weight || fl.count, ...stats, peakRssMB: r.peakRssMB, chance: r.chance, bestResponse: r.bestResponse, ev: r.ev, nodes: nodes(r), evs: classEvs(r) };
      fs.writeFileSync(file + '.tmp', JSON.stringify(result)); fs.renameSync(file + '.tmp', file);
      console.log(new Date().toISOString().slice(11, 19) + ' ' + id + ' ' + fl.key + ': ' + stats.iterations + ' iterations, ' + stats.exploitability + '% pot, ' + Math.round(stats.seconds) + ' s, ' + r.peakRssMB + ' MB, ' + r.chance);
    } catch (error) { console.log(id + ' ' + fl.key + ' failed: ' + error.message); }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
  };
  if (args.shard) { const [k, n] = args.shard.split('/').map(Number); for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].index % n !== k - 1) tasks.splice(i, 1); }
  if (args.reverse === '1') tasks.reverse();
  if (Number(args.limit) > 0) tasks.splice(Number(args.limit));
  const worker = async () => { while (tasks.length) await one(tasks.shift()); };
  await Promise.all(Array.from({ length: Math.max(1, Number(args.jobs) | 0) }, worker));
}

function bundle() {
  const spots = [];
  for (const id of fs.readdirSync(args.out)) {
    const dir = path.join(args.out, id), meta = path.join(dir, 'spot.json'); if (!fs.existsSync(meta)) continue;
    const spot = JSON.parse(fs.readFileSync(meta, 'utf8')); spot.flops = {};
    for (const x of fs.readdirSync(dir).filter(x => /^([2-9TJQKA][cdhs]){3}\.json$/.test(x))) { const r = JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')); spot.flops[r.key] = { weight: r.weight, iterations: r.iterations, exploitability: r.exploitability, chance: r.chance, nodes: r.nodes }; }
    if (Object.keys(spot.flops).length) spots.push(spot);
  }
  const lib = { format: 'range-lab-multiway-library-v1', name: args.name, createdAt: new Date().toISOString(), source: { solver: 'mw_solver (three-player DCFR) via tools/multiway-solver/library.cjs', ranges: 'Citrus Poker built-in preflop range estimates' }, spots };
  const file = path.join(args.out, 'multiway-library.json'); fs.writeFileSync(file, JSON.stringify(lib)); fs.writeFileSync(file + '.gz', zlib.gzipSync(fs.readFileSync(file), { level: 9 }));
  console.log(spots.map(s => s.id + ': ' + Object.keys(s.flops).length + ' flops').join('\n') + '\nWrote ' + file + ' and ' + file + '.gz');
}

if (require.main === module) {
  if (args.cmd === 'solve') solve().catch(e => { console.error(e.message); process.exit(1); });
  else if (args.cmd === 'bundle') bundle();
  else if (args.cmd === 'list') for (const [id, s] of Object.entries(SPOTS)) console.log(id.padEnd(20) + s.label);
  else console.log('Usage: library.cjs solve|bundle|list [--spots a,b] [--flops N|all] [--out dir] [--threads N] [--accuracy pct] [--iterations N] [--memory MB] [--jobs N] [--limit N] [--shard K/N] [--reverse 1] [--turn-cards T --river-cards R]');
}
module.exports = { SPOTS, prepare, spec, nodes };
