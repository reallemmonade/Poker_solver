'use strict';
// Checks leak ranking and spaced repetition in drill-plan.js: node studio/verify-drills.cjs
const assert=require('node:assert/strict'),D=require('./drill-plan.js');
const DAY=864e5,now=Date.UTC(2026,9,28);
const dec=(o)=>({variant:'NLH',mode:'cash',seats:6,pos:'BB',street:1,topic:'vsbet',depth:100,mistake:false,cost:null,at:now,...o});
// Ranking: measured cost wins over chart counts; chart mistakes are charged CHART_COST; untrusted spots are listed but held out of drills.
const decisions=[dec({mistake:true,cost:3}),dec({}),dec({pos:'BTN',street:0,topic:'firstin',mistake:true}),dec({pos:'BTN',street:0,topic:'firstin',mistake:true}),dec({pos:'CO',street:0,topic:'vsopen',mistake:true,cost:9}),dec({pos:'SB',street:2,topic:'vsraise'})];
const all=D.leaks(decisions),list=all.filter(l=>!l.held);
assert.equal(all[0].label,'CO · Vs open · 6-max · 100bb');assert.ok(all[0].held);
assert.deepEqual(list.map(l=>l.label),['BB · Vs bet · Flop · 6-max · 100bb','BTN · Open · 6-max · 100bb']);
assert.equal(list[0].mistakes,1);assert.equal(list[0].decisions,2);assert.ok(Math.abs(list[1].cost-2*D.CHART_COST)<.01);
assert.ok(list[0].hit>.49&&list[0].hit<.51);
// Older decisions fade: the same mistake 600 decisions back costs a quarter.
const old=D.leaks([...Array(600)].map(()=>dec({pos:'UTG',topic:'firstin',street:0})).concat(dec({mistake:true,cost:4})));
assert.ok(Math.abs(old[0].cost-1)<.02);
// Depth classes keep 20bb and 100bb spots apart.
assert.equal(D.leaks([dec({mistake:true,depth:20}),dec({mistake:true,depth:100})]).length,2);
// A 100bb game stays one leak when stacks drift either side of 100bb.
assert.equal(D.leaks([dec({mistake:true,depth:99.5}),dec({mistake:true,depth:104}),dec({mistake:true,depth:117})]).length,1);
// Spaced repetition: three right in a row promotes; a miss drops to the start and is due again now.
const deck=D.sync({},list,now),card=deck.cards[list[0].key];assert.equal(card.box,0);assert.ok(D.isDue(card,now));
for(let i=0;i<3;i++)D.answer(card,true,now);assert.equal(card.box,1);assert.equal(card.due,now+DAY);assert.ok(!D.isDue(card,now));
for(let i=0;i<3;i++)D.answer(card,true,now+DAY);assert.equal(card.box,2);assert.equal(card.due,now+DAY+3*DAY);
// Answers before the card is due again record a result but never promote it.
for(let i=0;i<6;i++)D.answer(card,true,now+DAY+60e3);assert.equal(card.box,2);
D.answer(card,false,now+2*DAY);assert.equal(card.box,0);assert.ok(D.isDue(card,now+2*DAY));
assert.equal(D.drillHit(card),12/13);
// A promoted leak returns to the start when table play shows the mistake again.
for(let i=0;i<3;i++)D.answer(card,true,now+3*DAY);assert.equal(card.box,1);
D.sync(deck,[{...list[0],lastMistakeAt:now+4*DAY}],now+4*DAY);assert.equal(card.box,0);
// Picking: due leaks first, never the same leak twice in a row when another is due, and something even when none is due.
const two=D.sync({},list,now);D.answer(two.cards[list[0].key],true,now);
assert.equal(D.pick(list,two,now,list[0].key,()=>0).key,list[1].key);
for(const c of Object.values(two.cards)){c.box=1;c.due=now+DAY;}
assert.ok(D.pick(list,two,now,null,()=>0));
// Backup validation.
assert.ok(D.validDeck(deck));assert.ok(!D.validDeck({cards:{x:{box:9,due:0,boxAt:0,results:[]}}}));assert.ok(!D.validDeck({cards:[]}));
console.log('drill plan checks passed');
