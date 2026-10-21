(function(root){'use strict';const G=root.PokerGame,T=root.PokerTraining;
 class PolicyModel{
  constructor(pack){if(pack?.format!=='range-lab-policy-v1'||!Array.isArray(pack.table))throw Error('Invalid study policy pack.');this.pack=pack;this.config=G.normalize(pack.config);this.family=G.familyId(this.config);this.abstraction=T.normalizeAbstraction(pack.abstraction);this.episodes=pack.episodes;this.name=pack.name;this.entries=new Map(pack.table.map(row=>[row[0],row]));}
  actions(hand){return G.modelActions(hand,this.abstraction)}
  query(hand){const actions=this.actions(hand),key=G.information(hand),r=hand.family===this.family?this.entries.get(key):null,match=r&&r[1].join(',')===actions.map(a=>a.id).join(',');return{key,actions,probs:match?T.matching(r[2]):actions.map(()=>1/actions.length),trained:!!match,visits:match?r[3]:0,updates:match?r[4]:0,sourceName:this.name};}
  snapshot(){return this.pack;}
  summary(){return{...this.pack,table:undefined,infos:this.entries.size,method:'Read-only sampled average policy; no GTO certificate.'};}
 }
 function load(snapshot){return snapshot?.format==='range-lab-policy-v1'?new PolicyModel(snapshot):T.Model.load(snapshot);}
 root.PokerPolicies={PolicyModel,load};
})(typeof globalThis!=='undefined'?globalThis:this);
