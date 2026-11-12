#!/usr/bin/env node
'use strict';
// Checks the kept 3-way street tree (studio/local-solver.js mwStreetTree / treeAnswer) with a stand-in mw_solver
// output: a later decision on the solved flop reads the tree, an off-tree size or another board does not, the other
// players' ranges are narrowed by their actions, and a small budget keeps the first nodes only. A pot that goes
// heads-up on the solved street (one of the three folds) is still answered from the kept tree, its two ranges carry
// to the next street, and without a kept tree the two players left get a TexasSolver spec with the folded player's
// chips as dead money. Flop leads: the
// spec gives the two players who are not the preflop raiser their own bet size, and the tree answers the leader,
// the player facing a lead and the raiser behind one (the all-in marked allIn, as CLAUDE.md asks).
//   node tools/local-solver/check-tree-mw.cjs
const L=require('../../studio/local-solver.js'),G=require('../../studio/game.js'),C=G.Core;
let fail=0;const ok=(c,m)=>{if(!c)fail++;console.log((c?'ok   ':'FAIL ')+m);},near=(a,b)=>Math.abs(a-b)<.01;
const config=G.normalize({variant:'NLH',seats:3,stacks:[100,100,100]});
// Button opens, both blinds call: postflop the small blind (1) acts first, then the big blind (2), then the button (0).
const hand=(...line)=>{const h=new G.Hand(config,{holes:{0:C.cards('AhAd'),1:C.cards('AsKd'),2:C.cards('7c6c')},runout:C.cards('QsJh2h3c4d'),rng:G.rng(1)});h.act({kind:'raise',target:250});h.act({kind:'call'});h.act({kind:'call'});for(const a of line)h.act(a);return h;};
const data=h=>({config,actor:h.actor,heroCards:h.holes[h.actor],board:h.board,actions:h.actionLog});
const end={end:'next street'},act=(player,actions,strategy,children)=>({player,alive:[1,1,1],actions,strategy,children:children||actions.map(()=>end)});
const raw={combos:[['AsKd','QcQd'],['7c6c','JdTd'],['AhAd','9s9c']],weights:[[1,.5],[1,1],[1,1]],tree:
 act(0,[{kind:'check',to:0},{kind:'bet',to:250},{kind:'bet',to:9750,allin:true}],[[.6,.3,.1],[.2,.8,0]],[
  act(1,[{kind:'check',to:0},{kind:'bet',to:250}],[[.5,.5],[1,0]],[
   act(2,[{kind:'check',to:0},{kind:'bet',to:250},{kind:'bet',to:9750,allin:true}],[[.1,.7,.2],[.8,.2,0]]),
   end]),
  act(1,[{kind:'fold',to:0},{kind:'call',to:250},{kind:'raise',to:1000},{kind:'raise',to:9750,allin:true}],[[.2,.5,.2,.1],[0,1,0,0]],[
   end,
   act(2,[{kind:'fold',to:0},{kind:'call',to:250},{kind:'raise',to:1250},{kind:'raise',to:9750,allin:true}],[[0,.3,.6,.1],[.9,.1,0,0]]),
   end,end]),
  end])};
const spec={board:['Qs','Jh','2h'],pot:750,stack:9750,seats:[1,2,0]};
const tree=L.mwStreetTree(raw,spec),result={supported:true,units:'bb',solve:{version:1,method:'local-multiway',iterations:100,exploitability:.4,seconds:120,tree,actionTree:{betSizes:[1/3],raiseSizes:[],jam:true},rangeAssumptions:[]}};
ok(tree&&tree.game==='NLH3'&&tree.nodes.length===5,'the tree keeps every action node of the street ('+(tree&&tree.nodes.length)+')');
let h=hand({kind:'check'},{kind:'check'}),a=L.treeAnswer(result,data(h),h);
ok(h.actor===0&&a&&a.actions.length===3&&near(a.reference[0],.1)&&near(a.reference[1],.7)&&near(a.reference[2],.2),'the button after two checks: check/bet/all-in '+(a?a.reference.map(x=>x.toFixed(2)).join('/'):'none'));
ok(a&&a.solve.method==='local-multiway'&&a.solve.fromTree.line==='0/0'&&a.actions[1].target===250,'the bet maps to 2.5 bb on the right line');
const sb=a&&a.solve.rangeAssumptions.find(r=>r.seat===1),bb=a&&a.solve.rangeAssumptions.find(r=>r.seat===2);
ok(sb&&/AsKd(,|$)/.test(sb.range)&&near(+sb.range.split('QcQd:')[1],(.5*.2)/.6),'the small blind\'s range is narrowed by their check: '+(sb&&sb.range));
ok(bb&&/JdTd(,|$)/.test(bb.range)&&near(parseFloat(bb.range.split('7c6c:')[1]),.5),'the big blind\'s range is narrowed by their check: '+(bb&&bb.range));
ok(a&&a.handMix&&a.handMix.classes['99']&&near(a.handMix.classes['99'][0],.8),'the range grid shows the hero range\'s mix at this node');
h=hand({kind:'check'},{kind:'bet',target:250});ok(!L.treeAnswer(result,data(h),h),'a line past what was kept is not answered');
// Leads. The small blind (first to act, not the raiser) gets its own answer; the big blind facing the lead and the
// button behind a lead and a call get theirs, with the leader's range narrowed to the hands that lead.
h=hand();a=L.treeAnswer(result,data(h),h);
ok(h.actor===1&&a&&a.actions.map(x=>x.kind).join()==='check,bet,bet'&&near(a.reference[0],.6)&&near(a.reference[1],.3)&&near(a.reference[2],.1)&&a.solve.fromTree.line==='','the leader (small blind, first to act): check/lead/all-in '+(a?a.reference.map(x=>x.toFixed(2)).join('/'):'none'));
ok(a&&a.actions[1].target===250&&!a.actions[1].allIn&&a.actions[2].allIn===true&&a.actions[2].target===h.legal().allInTo&&/all-in/.test(a.actions[2].label),'the lead is 2.5 bb and the jam is marked allIn at this hand\'s all-in ('+(a&&a.actions[2].target)+')');
h=hand({kind:'bet',target:250});a=L.treeAnswer(result,data(h),h);
ok(h.actor===2&&a&&a.actions.map(x=>x.kind).join()==='fold,call,raise,raise'&&near(a.reference[0],.2)&&near(a.reference[1],.5)&&near(a.reference[2],.2)&&near(a.reference[3],.1)&&a.solve.fromTree.line==='1'&&a.actions[2].target===1000&&a.actions[3].allIn===true,'facing the lead (big blind): fold/call/raise/all-in '+(a?a.reference.map(x=>x.toFixed(2)).join('/'):'none'));
const led=a&&a.solve.rangeAssumptions.find(r=>r.seat===1);ok(led&&/QcQd(,|$)/.test(led.range)&&Math.abs(parseFloat(led.range.split('AsKd:')[1])-.3/.4)<.02,'the leader\'s range is narrowed to the hands that lead: '+(led&&led.range));
h=hand({kind:'bet',target:250},{kind:'call'});a=L.treeAnswer(result,data(h),h);
ok(h.actor===0&&a&&a.solve.fromTree.line==='1/1'&&near(a.reference[1],.3)&&near(a.reference[2],.6)&&a.actions[2].target===1250,'the raiser behind a lead and a call: fold/call/raise/all-in '+(a?a.reference.map(x=>x.toFixed(2)).join('/'):'none'));
h=hand({kind:'bet',target:400});ok(!L.treeAnswer(result,data(h),h),'a lead of a size the tree does not have is not answered (the app solves that line itself)');
// The spec the app sends for this flop: the button raised, so the blinds get the lead size as their own flop bet.
const rows={1:['AsKd','QcQd'],2:['7c6c','JdTd'],0:['AhAd','9s9c']},ranges={rows:seat=>rows[seat].map(c=>({cards:C.cards(c),prob:1}))};
h=hand();let s=L.spec(data(h),ranges,{}),text=L.input(s,{output:'r.json'});
ok(s.game==='NLH3'&&s.seats.join()==='1,2,0'&&s.lead.flop.join()==='false,false,true'&&s.leadSizes.flop.length===1&&near(s.leadSizes.flop[0],1/3)&&s.path.length===0&&s.heroIndex===0,'the flop spec lets the two callers lead with '+JSON.stringify(s.leadSizes.flop)+' of the pot');
ok(/^bet flop 0 0.3333\nlead flop 0 1\nbet flop 1 0.3333\nlead flop 1 1\nlead flop 2 1$/m.test(text)&&/^bet flop all 0.3333,0.6667,1.5$/m.test(text),'the solver input gives players 0 and 1 the lead size and leaves the raiser every size');
h=hand({kind:'bet',target:300});s=L.spec(data(h),ranges,{});text=L.input(s,{output:'r.json'});
ok(s.heroIndex===1&&s.path.length===1&&s.path[0].to===300&&/^path to:300$/m.test(text)&&/^bet flop 0 0.3333$/m.test(text),'a real lead of another size (3 bb) goes in as the line, next to the tree\'s lead size');
h=hand();s=L.spec(data(h),ranges,{mwLeads:false});text=L.input(s,{output:'r.json'});
ok(!s.leadSizes.flop&&/^lead flop 0 0\nlead flop 1 0\nlead flop 2 1$/m.test(text)&&!/^bet flop [012]/m.test(text),'mwLeads:false keeps the old tree (only the raiser bets first)');
// Leads are on by default only where they matter (L.mwFlopLeads): a caller hero, or a real lead in the line.
h=hand({kind:'check'},{kind:'check'});s=L.spec(data(h),ranges,{});text=L.input(s,{output:'r.json'});
ok(h.actor===0&&s.heroIndex===2&&!s.leadSizes.flop&&/^lead flop 0 0\nlead flop 1 0\nlead flop 2 1$/m.test(text)&&!/^bet flop [012]/m.test(text)&&!L.mwFlopLeads(h.actionLog,s.seats,h.actor),'a raiser hero whom nobody led into builds the tree without leads');
s=L.spec(data(h),ranges,{mwLeads:true});ok(s.leadSizes.flop?.length===1&&/^bet flop 0 0.3333\nlead flop 0 1$/m.test(L.input(s,{output:'r.json'})),'mwLeads:true gives a raiser hero the leads tree');
h=hand({kind:'bet',target:250},{kind:'call'});s=L.spec(data(h),ranges,{});
ok(h.actor===0&&s.leadSizes.flop?.length===1&&L.mwFlopLeads(h.actionLog,s.seats,h.actor),'a raiser hero facing a real lead builds the leads tree');
h=hand({kind:'check'});s=L.spec(data(h),ranges,{});ok(h.actor===2&&s.heroIndex===1&&s.leadSizes.flop?.length===1&&L.mwFlopLeads(h.actionLog,s.seats,h.actor)&&!L.mwFlopLeads(h.actionLog,s.seats,h.actor,{mwLeads:false}),'a caller hero builds the leads tree');
h=hand({kind:'check'},{kind:'check'},{kind:'check'});s=L.spec(data(h),ranges,{});
ok(s.board.length===4&&!s.lead.turn&&!s.leadSizes.turn&&!/^lead /m.test(L.input(s,{output:'r.json'})),'turn solves are unchanged: anyone may bet every size');
h=hand({kind:'check'},{kind:'bet',target:400});ok(!L.treeAnswer(result,data(h),h),'an off-tree size is not answered');
const other={...result,solve:{...result.solve,tree:{...tree,board:['Qs','Jh','3h']}}};h=hand({kind:'check'},{kind:'check'});ok(!L.treeAnswer(other,data(h),h),'another flop is not answered');
ok(!L.treeCarry(result,data(hand({kind:'check'},{kind:'check'},{kind:'check'})),null),'a street all three finished doesn\'t carry ranges to the next street');
const small=L.mwStreetTree(raw,spec,JSON.stringify(tree.combos).length+JSON.stringify(tree.weights).length+140);ok(small&&small.nodes.length===1,'a small budget keeps the first node only');
// When everything does not fit, the lines played most often are the ones kept: with a rare lead, the checked-through line comes before it.
const rare=JSON.parse(JSON.stringify(raw));rare.tree.strategy=[[.9,.05,.05],[.9,.1,0]];const order=L.mwStreetTree(rare,spec).nodes.map(n=>n.line||'root').join(' ');
ok(order==='root 0 0/0 1 1/1','nodes are kept most likely first: '+order);
// Three-way to heads-up on the solved street. The solver's tree plays on between the two left after a fold, so the
// kept tree answers them: the small blind leads, the big blind folds, the button raises, the small blind decides.
const raw2=JSON.parse(JSON.stringify(raw));raw2.tree.children[1].children[0]={player:2,alive:[1,0,1],actions:[{kind:'fold',to:0},{kind:'call',to:250},{kind:'raise',to:1000}],strategy:[[.25,.5,.25],[1,0,0]],children:[end,end,{player:0,alive:[1,0,1],actions:[{kind:'fold',to:0},{kind:'call',to:1000}],strategy:[[.4,.6],[.1,.9]],children:[end,end]}]};
const tree2=L.mwStreetTree(raw2,spec),result2={...result,solve:{...result.solve,tree:tree2}};
h=hand({kind:'bet',target:250},{kind:'fold'});a=L.treeAnswer(result2,data(h),h);
ok(h.actor===0&&h.living().length===2&&a&&a.solve.method==='local-multiway'&&a.solve.fromTree.line==='1/0'&&a.actions.map(x=>x.kind).join()==='fold,call,raise'&&near(a.reference[0],.25)&&near(a.reference[1],.5)&&near(a.reference[2],.25)&&a.actions[2].target===1000,'heads-up after the big blind folds to the lead: the kept 3-way tree answers the button, fold/call/raise '+(a?a.reference.map(x=>x.toFixed(2)).join('/'):'none'));
ok(a&&a.solve.rangeAssumptions.length===2&&!a.solve.rangeAssumptions.some(r=>r.seat===2)&&Math.abs(parseFloat((a.solve.rangeAssumptions.find(r=>r.seat===1)||{range:''}).range.split('AsKd:')[1])-.75)<.02,'only the two players left have a range there, the leader\'s narrowed by the lead');
h=hand({kind:'bet',target:250},{kind:'fold'},{kind:'raise',target:1000});a=L.treeAnswer(result2,data(h),h);
ok(h.actor===1&&a&&a.solve.fromTree.line==='1/0/2'&&a.actions.map(x=>x.kind).join()==='fold,call'&&near(a.reference[0],.4)&&near(a.reference[1],.6),'and the leader facing the raise heads-up: fold/call '+(a?a.reference.map(x=>x.toFixed(2)).join('/'):'none'));
ok(!L.treeAnswer(result,data(hand({kind:'bet',target:250},{kind:'fold'})),hand({kind:'bet',target:250},{kind:'fold'})),'a heads-up line the tree did not keep is not answered');
// The two ranges that reach the turn are narrowed by the flop line, the folded player has none.
h=hand({kind:'bet',target:250},{kind:'fold'},{kind:'call'});let carried=L.treeCarry(result2,data(h),{seat:h.actor,cards:h.holes[h.actor]});
ok(h.street===2&&h.actor===1&&carried&&carried[2]===''&&carried[0]==='AhAd'&&Math.abs(parseFloat(carried[1].split('AsKd:')[1])-.75)<.02,'the flop tree carries the two players\' ranges to a heads-up turn: '+JSON.stringify(carried));
// Without a kept tree the two players left go to TexasSolver: the street as they played it between themselves, and
// the chips the third player put in on it added to the pot.
const tex=(...line)=>{const x=hand(...line),sp=L.spec(data(x),ranges,{}),sl=L.streetLine(data(x),x.street);L.input(sp,{output:'r.json'});return{h:x,s:sp,same:!!sl&&JSON.stringify(sl.path)===JSON.stringify(sp.path),line:sp.path.map(p=>p.kind+(p.amount?' '+p.amount:'')).join(', ')};};
let t=tex({kind:'check'},{kind:'check'},{kind:'bet',target:250},{kind:'fold'});
ok(!t.s.game&&t.s.pot===750&&t.line==='check, bet 250'&&!t.s.heroIsIp&&t.same,'check, check, bet, the first player folds: a heads-up spec for the big blind, pot 7.5 bb ('+t.line+')');
t=tex({kind:'bet',target:250},{kind:'call'},{kind:'raise',target:1000},{kind:'fold'});
ok(!t.s.game&&t.s.pot===1000&&t.line==='bet 250, raise 1000'&&!t.s.heroIsIp&&t.same,'the bettor folds to a raise: their 2.5 bb is dead money (pot 10 bb) and the caller is the one who bet ('+t.line+')');
t=tex({kind:'check'},{kind:'bet',target:250},{kind:'call'},{kind:'raise',target:1000},{kind:'fold'});
ok(!t.s.game&&t.s.pot===1000&&t.line==='check, bet 250, raise 1000'&&t.s.heroIsIp&&t.h.actor===0&&t.same,'check, bet, call, check-raise, the bettor folds: the caller faces the raise heads-up ('+t.line+')');
t=tex({kind:'check'},{kind:'check'},{kind:'bet',target:250},{kind:'call'},{kind:'raise',target:1000},{kind:'fold'});
ok(!t.s.game&&t.s.pot===1000&&t.line==='bet 250, raise 1000'&&t.h.actor===1&&t.same,'two checks before the folded player\'s bet are left out, so the heads-up line stays a legal one ('+t.line+')');
if(fail){console.log(fail+' failed');process.exit(1);}console.log('3-way tree checks passed');
