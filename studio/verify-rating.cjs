'use strict';
// Checks the Citrus rating in rating.js: node studio/verify-rating.cjs
const assert=require('node:assert/strict'),R=require('./rating.js');
const day=864e5,at=i=>Date.UTC(2026,9,1)+i*day/10;
const run=(n,f)=>Array.from({length:n},(_,i)=>({at:at(i),mode:'cash',seats:6,street:0,mistake:false,cost:null,...f(i)}));
assert.equal(R.rate([]).rating,null);
// Steady accuracy settles where the expected score matches it: 90% on preflop spots ≈ 1200 + 400·log10(9) ≈ 1582.
const ninety=R.rate(run(3000,i=>({mistake:i%10===0})));assert.ok(Math.abs(ninety.rating-1582)<40,'90% preflop accuracy rated '+ninety.rating);
assert.ok(R.rate(run(3000,i=>({mistake:i%20===0}))).rating>ninety.rating,'fewer mistakes rate higher');
// Postflop spots are harder, so the same accuracy rates higher there.
assert.ok(R.rate(run(3000,i=>({street:2,mistake:i%10===0,cost:i%10===0?40:null}))).rating>ninety.rating+250);
// Small solver mistakes cost less than punts.
assert.ok(R.score({mistake:true,cost:.1})>.9&&R.score({mistake:true,cost:5})<.01&&R.score({mistake:true,cost:null})===0&&R.score({mistake:false})===1);
// Order is by time, not input order, and the first 30 decisions are provisional.
const some=run(40,i=>({mistake:i<5}));assert.equal(R.rate(some.slice().reverse()).rating,R.rate(some).rating);assert.equal(R.rate(some.slice(0,20)).provisional,true);assert.equal(R.rate(some).provisional,false);
// Categories: MTT is tournament play, Cash is cash games, Heads-up is two-handed tables of either kind.
const mixed=[...run(10,()=>({mode:'icm',seats:2})),...run(10,()=>({mode:'cash',seats:6}))],c=Object.fromEntries(R.compute(mixed).map(x=>[x.id,x.n]));
assert.deepEqual(c,{overall:20,mtt:10,cash:10,hu:10});
// Change over a window, and thinning keeps the last point.
const h=R.rate(run(50,()=>({}))).history;assert.equal(R.change(h,at(0)),Math.round(h[49][1]-R.START));assert.equal(R.change(h,at(60)),0);assert.deepEqual(R.thin(h,10).at(-1),h.at(-1));assert.equal(R.thin(h,10).length,10);
console.log('rating checks passed');
