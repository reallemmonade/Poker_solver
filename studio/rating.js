(function(root){
  'use strict';
  // Citrus rating: an Elo-style number per format, earned from how close your unassisted decisions are to the
  // solver or chart rather than from chips won, so card luck doesn't move it. Each graded decision is one game
  // against the spot: preflop chart spots are rated 1200, postflop solved spots 1500. The score is 1 for a
  // decision that isn't a mistake, e^(-bb lost) for a solver-measured mistake, and 0 for a chart mistake or a
  // mistake without a bb cost (ICM). Rating settles where the expected score matches your average score.
  // A decision: {at (ms), mode ('cash'|'icm'), seats, street, mistake, cost (bb or null)} (leakDecisions in leak-drills.js).
  const START=1200,SPOT=[1200,1500,1500,1500],PROVISIONAL=30,K_NEW=40,K=16;
  const CATEGORIES=[
    {id:'overall',label:'Overall',test:()=>true},
    {id:'mtt',label:'MTT',test:d=>d.mode==='icm'},
    {id:'cash',label:'Cash',test:d=>d.mode!=='icm'},
    {id:'hu',label:'Heads-up',test:d=>d.seats===2}];
  const score=d=>!d.mistake?1:d.cost>0?Math.exp(-d.cost):0;
  const expected=(r,spot)=>1/(1+Math.pow(10,(spot-r)/400));
  function rate(decisions){
    const rows=decisions.filter(d=>Number.isFinite(d.at)).sort((a,b)=>a.at-b.at);let r=START,peak=START,total=0;const history=[];
    rows.forEach((d,i)=>{const s=score(d);total+=s;r+=(i<PROVISIONAL?K_NEW:K)*(s-expected(r,SPOT[d.street]??1500));if(i>=PROVISIONAL)peak=Math.max(peak,r);history.push([d.at,r]);});
    return{rating:rows.length?Math.round(r):null,n:rows.length,provisional:rows.length<PROVISIONAL,accuracy:rows.length?total/rows.length:null,peak:rows.length>PROVISIONAL?Math.round(peak):null,history};}
  // Rating change since a time: the latest rating less the last one before it (or the start).
  function change(history,since){if(!history.length)return null;let before=START;for(const [at,r] of history){if(at>=since)break;before=r;}return Math.round(history[history.length-1][1]-before);}
  // At most n evenly spaced points, always keeping the last one, for drawing.
  function thin(history,n=120){if(history.length<=n)return history;const out=[];for(let i=0;i<n;i++)out.push(history[Math.round(i*(history.length-1)/(n-1))]);return out;}
  const compute=decisions=>CATEGORIES.map(c=>({id:c.id,label:c.label,...rate(decisions.filter(c.test))}));
  root.PokerRating={START,SPOT,PROVISIONAL,CATEGORIES,score,expected,rate,change,thin,compute};
  if(typeof module==='object')module.exports=root.PokerRating;
})(typeof window!=='undefined'?window:globalThis);
