'use strict';
// Validation: solve heads-up 10bb push/fold with the same code path as the full
// game and report its exploitability and SB shove rate (the exact equilibrium of
// this equity table shoves 58.4% of hands and is worth about -0.045 bb to the SB).
const {Solver}=require('./solve.cjs');
const s=new Solver({seats:2,stack:10,pushFold:true});s.iterate(2000);
const e=s.exploitability(),shove=s.frequency(s.tree.root,'raise'),call=s.frequency(s.tree.root.children[1],'call');
console.log(`NashConv ${e.nashConv.toExponential(2)} bb, SB value ${e.values[0].toFixed(4)} bb, SB shoves ${(100*shove).toFixed(1)}%, BB calls ${(100*call).toFixed(1)}%`);
if(e.nashConv>1e-3||Math.abs(shove-.584)>.01)process.exitCode=1;
