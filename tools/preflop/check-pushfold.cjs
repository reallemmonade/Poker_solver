'use strict';
// Validation: solve heads-up 10bb push/fold with the same code path as the full
// game and report its exploitability and SB shove rate (the exact equilibrium of
// this equity table shoves 58.4% of hands and is worth about -0.045 bb to the SB).
const {Solver}=require('./solve.cjs');
const s=new Solver({seats:2,stack:10,pushFold:true});s.iterate(2000);
const e=s.exploitability(),shove=s.frequency(s.tree.root,'raise'),call=s.frequency(s.tree.root.children[1],'call');
console.log(`NashConv ${e.nashConv.toExponential(2)} bb, SB value ${e.values[0].toFixed(4)} bb, SB shoves ${(100*shove).toFixed(1)}%, BB calls ${(100*call).toFixed(1)}%`);
if(e.nashConv>1e-3||Math.abs(shove-.584)>.01)process.exitCode=1;
// Heads-up 100bb: the button acts last after the flop, so it is in position in every flop
// pot and opens most hands (raise-only solutions open about 80%), and the BB folds some.
const h=new Solver({seats:2,stack:100});h.iterate(1000);
const flops=[];(function walk(n){if(n.type==='decision')n.children.forEach(walk);else if(n.type!=='fold')flops.push(n);})(h.tree.root);
const open=h.frequency(h.tree.root,'raise'),fold=h.frequency(h.tree.root.children[h.tree.root.actions.findIndex(a=>a.kind==='raise')],'fold');
console.log(`Heads-up 100bb: button opens ${(100*open).toFixed(1)}%, BB folds ${(100*fold).toFixed(1)}% to the open, button in position in ${flops.filter(n=>n.players[0]===0).length}/${flops.length} flop pots`);
if(open<.7||fold<.05||flops.some(n=>n.players[0]!==0))process.exitCode=1;
