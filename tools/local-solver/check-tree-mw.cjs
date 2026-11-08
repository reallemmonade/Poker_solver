#!/usr/bin/env node
'use strict';
// Checks the kept 3-way street tree (studio/local-solver.js mwStreetTree / treeAnswer) with a stand-in mw_solver
// output: a later decision on the solved flop reads the tree, an off-tree size or another board does not, the other
// players' ranges are narrowed by their actions, and a small budget keeps the first nodes only.
//   node tools/local-solver/check-tree-mw.cjs
const L=require('../../studio/local-solver.js'),G=require('../../studio/game.js'),C=G.Core;
let fail=0;const ok=(c,m)=>{if(!c)fail++;console.log((c?'ok   ':'FAIL ')+m);},near=(a,b)=>Math.abs(a-b)<.01;
const config=G.normalize({variant:'NLH',seats:3,stacks:[100,100,100]});
// Button opens, both blinds call: postflop the small blind (1) acts first, then the big blind (2), then the button (0).
const hand=(...line)=>{const h=new G.Hand(config,{holes:{0:C.cards('AhAd'),1:C.cards('AsKd'),2:C.cards('7c6c')},runout:C.cards('QsJh2h3c4d'),rng:G.rng(1)});h.act({kind:'raise',target:250});h.act({kind:'call'});h.act({kind:'call'});for(const a of line)h.act(a);return h;};
const data=h=>({config,actor:h.actor,heroCards:h.holes[h.actor],board:h.board,actions:h.actionLog});
const end={end:'next street'},act=(player,actions,strategy,children)=>({player,alive:[1,1,1],actions,strategy,children:children||actions.map(()=>end)});
const raw={combos:[['AsKd','QcQd'],['7c6c','JdTd'],['AhAd','9s9c']],weights:[[1,.5],[1,1],[1,1]],tree:
 act(0,[{kind:'check',to:0},{kind:'bet',to:250}],[[.6,.4],[.2,.8]],[
  act(1,[{kind:'check',to:0},{kind:'bet',to:250}],[[.5,.5],[1,0]],[
   act(2,[{kind:'check',to:0},{kind:'bet',to:250},{kind:'bet',to:9750,allin:true}],[[.1,.7,.2],[.8,.2,0]]),
   end]),
  end])};
const spec={board:['Qs','Jh','2h'],pot:750,stack:9750,seats:[1,2,0]};
const tree=L.mwStreetTree(raw,spec),result={supported:true,units:'bb',solve:{version:1,method:'local-multiway',iterations:100,exploitability:.4,seconds:120,tree,actionTree:{betSizes:[1/3],raiseSizes:[],jam:true},rangeAssumptions:[]}};
ok(tree&&tree.game==='NLH3'&&tree.nodes.length===3,'the tree keeps every action node of the street ('+(tree&&tree.nodes.length)+')');
let h=hand({kind:'check'},{kind:'check'}),a=L.treeAnswer(result,data(h),h);
ok(h.actor===0&&a&&a.actions.length===3&&near(a.reference[0],.1)&&near(a.reference[1],.7)&&near(a.reference[2],.2),'the button after two checks: check/bet/all-in '+(a?a.reference.map(x=>x.toFixed(2)).join('/'):'none'));
ok(a&&a.solve.method==='local-multiway'&&a.solve.fromTree.line==='0/0'&&a.actions[1].target===250,'the bet maps to 2.5 bb on the right line');
const sb=a&&a.solve.rangeAssumptions.find(r=>r.seat===1),bb=a&&a.solve.rangeAssumptions.find(r=>r.seat===2);
ok(sb&&/AsKd(,|$)/.test(sb.range)&&near(+sb.range.split('QcQd:')[1],(.5*.2)/.6),'the small blind\'s range is narrowed by their check: '+(sb&&sb.range));
ok(bb&&/JdTd(,|$)/.test(bb.range)&&near(parseFloat(bb.range.split('7c6c:')[1]),.5),'the big blind\'s range is narrowed by their check: '+(bb&&bb.range));
ok(a&&a.handMix&&a.handMix.classes['99']&&near(a.handMix.classes['99'][0],.8),'the range grid shows the hero range\'s mix at this node');
h=hand({kind:'bet',target:250});ok(!L.treeAnswer(result,data(h),h),'a line past what was kept is not answered');
h=hand({kind:'check'},{kind:'bet',target:400});ok(!L.treeAnswer(result,data(h),h),'an off-tree size is not answered');
const other={...result,solve:{...result.solve,tree:{...tree,board:['Qs','Jh','3h']}}};h=hand({kind:'check'},{kind:'check'});ok(!L.treeAnswer(other,data(h),h),'another flop is not answered');
ok(!L.treeCarry(result,data(hand({kind:'check'},{kind:'check'},{kind:'check'})),null),'3-way trees don\'t carry ranges to the next street');
const small=L.mwStreetTree(raw,spec,JSON.stringify(tree.combos).length+JSON.stringify(tree.weights).length+100);ok(small&&small.nodes.length===1,'a small budget keeps the first node only');
if(fail){console.log(fail+' failed');process.exit(1);}console.log('3-way tree checks passed');
