#!/usr/bin/env node
'use strict';
// A stand-in for TexasSolver's console_solver, for the solve-flow player (run.cjs). It reads the same input file the
// bridge writes (studio/local-solver.js input) and, in well under a second, writes a dump in TexasSolver's format for
// the current street: every line of the betting tree with made-up (but repeatable) strategies for each combo in the
// acting player's range. The answer is meaningless as poker; the point is that the bridge, the account queue and the
// app handle it exactly as they handle a real solve, street tree and all.
// Like a solver built with tools/local-solver/texassolver-evs.patch, every node also carries each hand's EV for each
// action ("action_evs", chips net of half the starting pot: folding loses what the player has put in), the share of
// the other player's range that gets there ("action_evs_reach") and, at the root, their kind ("action_evs_kind").
// The EVs are made up too, but shaped like real ones: the hand's most-played action is its best, the others cost
// more the less they are played, and about one node in eight is a line the opponent almost never takes, where the
// app must fall back to frequencies. FAKE_TEXASSOLVER_NO_EVS=1 leaves them out, as a solver built before the patch
// (the strategies stay the same). Unlike the real solver it writes them even when the bridge asks for none
// (TEXASSOLVER_ACTION_EVS=off), so the checks see the bridge itself remove them for an app that did not ask.
//   fake-texassolver.cjs -i input.txt [--resource_dir …]
const fs=require('fs'),path=require('path');
const i=process.argv.indexOf('-i'),file=process.argv[i+1];
const cmds=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean);
let pot=0,stack=0,board=[],ranges={ip:'',oop:''},threshold=.67,out='output_result.json',iters=50;const sizes={ip:{},oop:{}};
for(const line of cmds){
 const [cmd,...rest]=line.split(' '),arg=rest.join(' ');
 if(cmd==='set_pot')pot=Number(arg);else if(cmd==='set_effective_stack')stack=Number(arg);else if(cmd==='set_board')board=arg.split(',');
 else if(cmd==='set_range_ip')ranges.ip=arg;else if(cmd==='set_range_oop')ranges.oop=arg;else if(cmd==='set_allin_threshold')threshold=Number(arg);
 else if(cmd==='dump_result')out=arg;else if(cmd==='set_max_iteration')iters=Math.min(50,Number(arg)||50);
 else if(cmd==='set_bet_sizes'){const [who,street,kind,...v]=arg.split(',');const s=(sizes[who][street]=sizes[who][street]||{bet:[],raise:[],donk:[],allin:false});if(kind==='allin')s.allin=true;else s[kind]=v.map(Number);}
}
const street=['','','','flop','turn','river'][board.length],RANKS='AKQJT98765432',SUITS='shdc',dead=new Set(board);
function combos(text){
 const out=[];for(const part of text.split(',').filter(Boolean)){const cls=part.split(':')[0],a=cls[0],b=cls[1],kind=cls[2]||'';
  for(const s1 of SUITS)for(const s2 of SUITS){const c1=a+s1,c2=b+s2;if(c1===c2||dead.has(c1)||dead.has(c2))continue;
   if(a===b){if(SUITS.indexOf(s1)>=SUITS.indexOf(s2))continue;}else if(kind==='s'&&s1!==s2||kind==='o'&&s1===s2)continue;
   out.push(RANKS.indexOf(a)<=RANKS.indexOf(b)?c1+c2:c2+c1);}}
 return out;
}
const hands={ip:combos(ranges.ip),oop:combos(ranges.oop)};
let seed=0;for(const ch of cmds.join('|'))seed=(seed*31+ch.charCodeAt(0))>>>0;
const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const fmt=x=>x.toFixed(6),other=w=>w==='ip'?'oop':'ip',RAISE_LIMIT=3,EVS=process.env.FAKE_TEXASSOLVER_NO_EVS!=='1',tenth=x=>Math.round(x*10)/10;
function node(who,paid,facing,raises,root=false){
 const book=sizes[who][street]||{bet:[],raise:[],donk:[],allin:true},mine=paid[who],total=pot+paid.ip+paid.oop,actions=[],kids={};
 const add=(label,child)=>{if(actions.includes(label))return;actions.push(label);if(child)kids[label]=child;};
 const allin=stack-mine;
 if(facing>mine){
  add('FOLD',null);const all=paid[other(who)]>=stack;add('CALL',all||street!=='river'?{node_type:'chance_node'}:null);
  if(!all&&raises<RAISE_LIMIT){
   for(const p of book.raise){let to=Math.round(facing+p/100*(pot+2*facing));if(pot/2+to>threshold*stack||to>=stack)to=stack;add('RAISE '+fmt(to-mine),to>=stack?node(other(who),{...paid,[who]:stack},stack,raises+1):node(other(who),{...paid,[who]:to},to,raises+1));}
   if(book.allin)add('RAISE '+fmt(allin),node(other(who),{...paid,[who]:stack},stack,raises+1));
  }
 }else{
  const ends=who==='ip';add('CHECK',ends?(street!=='river'?{node_type:'chance_node'}:null):node('ip',paid,0,raises));
  const bets=who==='oop'&&street!=='flop'&&book.donk.length?book.donk:book.bet;
  for(const p of bets){let to=mine+Math.round(p/100*total);if(pot/2+to>threshold*stack||to>=stack)to=stack;add('BET '+fmt(to-mine),node(other(who),{...paid,[who]:to},to,raises+1));}
  if(book.allin&&stack>mine)add('BET '+fmt(allin),node(other(who),{...paid,[who]:stack},stack,raises+1));
 }
 const strategy={},evs={},fold=actions.indexOf('FOLD'),lost=-(pot/2+mine);
 for(const h of hands[who]){const row=actions.map(()=>rand()+.05),sum=row.reduce((a,b)=>a+b,0);strategy[h]=row.map(x=>x/sum);
  const top=row.indexOf(Math.max(...row)),best=top===fold?lost:lost+(fold>=0?rand()*.6:.2+rand()*.8)*total;evs[h]=row.map((x,a)=>tenth(a===fold?lost:a===top?best:best-(1-x/row[top])*rand()*total*.5));}
 const rare=rand()<.125,reach=root?1:rare?.002:Math.round((.05+.95*rand())*1e5)/1e5;
 return{node_type:'action_node',player:who==='ip'?0:1,actions,strategy:{actions,strategy},childrens:kids,...EVS?{action_evs:evs,action_evs_reach:reach}:{}};
}
const tree=node('oop',{ip:0,oop:0},0,0,true);if(EVS)tree.action_evs_kind='average';
for(let n=10;n<=iters;n+=10)console.log('Iter: '+n+'\nTotal exploitability '+(5/n).toFixed(3)+' precent');
fs.writeFileSync(path.resolve(out),JSON.stringify(tree));
