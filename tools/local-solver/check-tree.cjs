#!/usr/bin/env node
'use strict';
// Checks the kept street tree (studio/local-solver.js streetTree) with a stand-in TexasSolver dump: a later decision
// on the solved flop reads the tree, an off-tree bet size does not, the next street's ranges are narrowed by the
// flop line, and a small budget keeps the first nodes only.
//   node tools/local-solver/check-tree.cjs
const L=require('../../studio/local-solver.js'),G=require('../../studio/game.js'),C=G.Core;
let fail=0;const ok=(c,m)=>{if(!c)fail++;console.log((c?'ok   ':'FAIL ')+m);},near=(a,b)=>Math.abs(a-b)<.01;
const config=G.normalize({variant:'NLH',seats:2,stacks:[100,100]});
const hand=(...line)=>{const h=new G.Hand(config,{holes:{0:C.cards('AhAd'),1:C.cards('AsKd')},runout:C.cards('QsJh2h3c4d'),rng:G.rng(1)});h.act({kind:'raise',target:250});h.act({kind:'call'});for(const a of line)h.act(a);return h;};
const data=h=>({config,actor:h.actor,heroCards:h.holes[h.actor],board:h.board,actions:h.actionLog});
// TexasSolver numbers the out-of-position player at the root (here 1, the big blind).
const chance={node_type:'chance_node'};
const dump={node_type:'action_node',player:1,actions:['CHECK','BET 166.000000'],strategy:{strategy:{AsKd:[.7,.3],QcQd:[.2,.8],AcKh:[.5,.5]}},childrens:{
 CHECK:{node_type:'action_node',player:0,actions:['CHECK','BET 166.000000'],strategy:{strategy:{AhAd:[.1,.9],'7c6c':[.6,.4]}},childrens:{
  CHECK:chance,
  'BET 166.000000':{node_type:'action_node',player:1,actions:['FOLD','CALL','RAISE 500.000000'],strategy:{strategy:{AsKd:[.1,.6,.3],QcQd:[0,.2,.8],AcKh:[.4,.6,0]}},childrens:{CALL:chance}}}},
 'BET 166.000000':{node_type:'action_node',player:0,actions:['FOLD','CALL'],strategy:{strategy:{AhAd:[0,1],'7c6c':[.5,.5]}},childrens:{CALL:chance}}}};
const spec={board:['Qs','Jh','2h'],pot:500,stack:9750,rangeIp:{AA:1,'76s':1},rangeOop:{AKo:1,QQ:1},heroIsIp:false};
const tree=L.streetTree(dump,spec),result={supported:true,units:'bb',solve:{version:1,method:'local-texassolver',iterations:100,exploitability:.4,seconds:120,tree,actionTree:{betSizes:[.33],raiseSizes:[],maxAggressions:4,jam:true},rangeAssumptions:[{seat:0,range:'AA,76s',combinations:10,source:'Chart'},{seat:1,range:'AKo,QQ',combinations:18,source:'Chart'}],warning:'Solved by TexasSolver.'}};
ok(tree&&tree.nodes.length===4&&JSON.stringify(tree).length<4000,'the tree keeps every action node of the street ('+(tree&&tree.nodes.length)+')');
// Check, the opponent bets a third of the pot: the hero's reply comes from the tree.
let h=hand({kind:'check'},{kind:'bet',target:166}),a=L.treeAnswer(result,data(h),h);
ok(a&&a.actions.length===3&&near(a.reference[0],.1)&&near(a.reference[1],.6)&&near(a.reference[2],.3),'facing the bet: fold/call/raise '+(a?a.reference.map(x=>x.toFixed(2)).join('/'):'none'));
ok(a&&a.actions[2].kind==='raise'&&a.actions[2].target===500&&a.solve.fromTree.line==='CHECK/BET 166.000000','the raise maps to raise to 5 bb on the right line');
// Weights are kept in 255ths, so they land within a percent.
const opp=a&&a.solve.rangeAssumptions.find(r=>r.seat===0);
ok(opp&&/AhAd(,|$)/.test(opp.range)&&near(+opp.range.split('7c6c:')[1],.444),'the opponent\'s range is narrowed by their bet: '+(opp&&opp.range));
ok(a&&a.handMix&&a.handMix.classes.QQ&&near(a.handMix.classes.QQ[2],.8),'the range grid shows the hero range\'s mix at this node');
// An off-tree size is not answered.
h=hand({kind:'check'},{kind:'bet',target:300});ok(L.treeAnswer(result,data(h),h)===null,'an off-tree bet size solves again');
// The first decision answers from the tree too.
h=hand();a=L.treeAnswer(result,data(h),h);ok(a&&near(a.reference[0],.7),'the first decision reads the same tree');
// Turn: both ranges narrowed by check, bet, call.
h=hand({kind:'check'},{kind:'bet',target:166},{kind:'call'});const carry=L.treeCarry(result,data(h),{seat:h.actor,cards:h.holes[h.actor]});
ok(carry&&/^AsKd,QcQd:0\.09\d,AcKh:0\.7[01]\d$/.test(carry[1])&&/^AhAd,7c6c:0\.44\d$/.test(carry[0]),'the turn starts from narrowed ranges: '+JSON.stringify(carry));
// On the turn, the flop's tree answers nothing.
ok(h.street===2&&L.treeAnswer(result,data(h),h)===null,'a turn decision is not read from the flop tree');
// A small budget keeps the first nodes only.
const small=L.streetTree(dump,spec,140);ok(small&&small.nodes.length>=1&&small.nodes.length<4,'a small budget keeps '+(small&&small.nodes.length)+' node(s)');
h=hand({kind:'check'},{kind:'bet',target:166});ok(L.treeAnswer({...result,solve:{...result.solve,tree:small}},data(h),h)===null,'a line past the kept nodes solves again');
// Action EVs, as a solver built with texassolver-evs.patch dumps them: chips net of half the 5 bb pot for each action,
// so folding to the bet is -250. The kept tree holds the hero hand's row at the hero's nodes, and a decision read from
// it carries EVs in bb from the decision (fold 0) and grades on EV lost.
const T=require('../../studio/trainer.js'),evDump=JSON.parse(JSON.stringify(dump)),facing=evDump.childrens.CHECK.childrens['BET 166.000000'];
evDump.action_evs_kind='average';evDump.action_evs_reach=1;evDump.action_evs={AsKd:[-100,-103],QcQd:[40,90],AcKh:[-100,-101]};
facing.action_evs_reach=.4;facing.action_evs={AsKd:[-250,-190,-420],QcQd:[-250,80,150],AcKh:[-250,-240,-500]};
const evSpec={...spec,hero:'KdAs',accuracy:1},evTree=L.streetTree(evDump,evSpec),evResult={...result,solve:{...result.solve,tree:evTree}};
ok(evTree&&evTree.evKind==='average'&&evTree.nodes.filter(n=>n.ev).length===2&&!evTree.nodes.some(n=>n.player==='ip'&&n.ev),'the tree keeps the hero hand\'s action EVs at the hero\'s two decisions');
ok(!result.solve.tree.evKind&&!result.solve.tree.nodes.some(n=>n.ev)&&!T.assessmentEvidence(a).usable,'a dump without action EVs (an older solver) keeps none and grades on frequency');
h=hand({kind:'check'},{kind:'bet',target:166});a=L.treeAnswer(evResult,data(h),h);
ok(a&&near(a.mean[0],0)&&near(a.mean[1],.6)&&near(a.mean[2],-1.7)&&a.best===1,'facing the bet: EVs from the decision are fold 0, call +0.6, raise -1.7 bb ('+(a?a.mean.join('/'):'none')+')');
ok(a&&near(a.loss[0],.6)&&a.loss[1]===0&&near(a.loss[2],2.3)&&near(a.reference[1],.6),'folding costs 0.6 bb and raising 2.3 bb; the frequencies are unchanged');
ok(a&&a.solve.evAvailable===true&&a.solve.evKind==='average'&&near(a.solve.evReach,.4)&&T.assessmentEvidence(a).usable,'that answer grades on EV');
// A mixed action within the solve's accuracy (1% of the 5 bb pot) costs nothing: check 70%, bet 30%, 0.03 bb apart.
h=hand();a=L.treeAnswer(evResult,data(h),h);
ok(a&&near(a.mean[0],1.5)&&near(a.mean[1],1.47)&&a.loss[0]===0&&a.loss[1]===0&&near(a.solve.evTolerance,.05),'the first decision: check +1.5, bet +1.47 bb, both in the mix and free');
// EVs are set aside, with the reason, on a line the opponent almost never takes and when the solve did not converge.
const rare=JSON.parse(JSON.stringify(evDump));rare.childrens.CHECK.childrens['BET 166.000000'].action_evs_reach=.004;
h=hand({kind:'check'},{kind:'bet',target:166});a=L.treeAnswer({...result,solve:{...result.solve,tree:L.streetTree(rare,evSpec)}},data(h),h);
ok(a&&a.mean.every(x=>x===0)&&a.loss.every(x=>x===0)&&/under 1%/.test(a.solve.evSkipped)&&!T.assessmentEvidence(a).usable&&near(a.reference[1],.6),'a line the opponent takes 0.4% of the time grades on frequency: '+(a&&a.solve.evSkipped));
a=L.treeAnswer({...evResult,solve:{...evResult.solve,exploitability:1.6}},data(h),h);
ok(a&&a.mean.every(x=>x===0)&&/accuracy target/.test(a.solve.evSkipped)&&!T.assessmentEvidence(a).usable,'a solve that stopped at 1.6% (target 1%) grades on frequency: '+(a&&a.solve.evSkipped));
// The other player's cards never read the hero's EVs.
const swapped={...evTree,evHero:'QcQd'};a=L.treeAnswer({...evResult,solve:{...evResult.solve,tree:swapped}},data(h),h);
ok(a&&a.mean.every(x=>x===0)&&!a.solve.evAvailable,'EVs kept for another hand are not used');
console.log(fail?fail+' check(s) failed.':'All tree checks passed.');process.exit(fail?1:0);
