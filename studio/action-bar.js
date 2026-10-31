// Table action bar shared by Play and Play with friends. On your turn it shows bet-size presets that fill the amount box,
// a slider over the legal range and three big buttons; while you wait it shows pre-action checkboxes that fire when the
// turn reaches you. Amounts are in bb. Bets and raises are street totals ("raise to").
const ActionBar=(()=>{
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=x=>String(+(+x).toFixed(2)),bbText=x=>num(x)+' BB';
  let turnState={key:null,amount:null},pre={key:null,choice:null,toCall:0};const keys=new WeakMap();
  // Rounds to a step that grows with the size (0.01, 0.1, then 0.5 bb), then clamps to the legal range (the all-in total is always reachable).
  function snap(x,r){const step=x>=25?.5:x>=5?.1:.01;let v=Math.round(x/step)*step;v=+v.toFixed(2);return Math.max(r.min,Math.min(r.max,v));}
  const clamp=(x,r)=>Math.max(r.min,Math.min(r.max,+(+x).toFixed(2)));
  // The most anyone can lose here: your stack or the biggest stack still in against you, whichever is smaller.
  const cover=r=>Math.min(r.allIn,r.effective>0?r.effective:r.allIn);
  const solvedList=r=>[...new Set((Array.isArray(r.solved)?r.solved:[]).map(t=>clamp(t,r)))].sort((a,b)=>a-b);
  // Postflop sizes as a share of the pot after calling; the solver tree's sizes (1/3, 2/3, 1.5x) read as the tree names them.
  const share=f=>{const pc=Math.round(f*100);return pc===33?'1/3':pc===66||pc===67?'2/3':pc===150?'1.5x':pc+'%';};
  function presets(r){
    // The sizes the solver has an answer for at this decision, when it has two or more; the slider covers the rest.
    // Labels name the size, not the amount (shown already in the box and the raise button): preflop a multiple of the
    // big blind or of the bet you face (7.5 vs 2.5 is 3x), postflop a share of the pot.
    const base=r.currentBet<=r.bb?r.bb:r.currentBet,s=solvedList(r);
    // Sizes that share a label (two at or above the effective stack, or two that round to the same share) show once, the smaller kept.
    const sl=s.map(t=>({label:t>=cover(r)-1e-9?'All-in':r.preflop?num(t/base)+'x':share((t-r.currentBet)/(r.pot+r.toCall)),target:t})).filter((p,i,a)=>a.findIndex(q=>q.label===p.label)===i);
    if(sl.length>1)return sl;
    // Otherwise standard sizes (preflop multiples, postflop the solver tree's 1/3, 2/3 and 1.5x pot), and All-in. A size below the
    // minimum bet (1/3 of a small limped pot) shows at the minimum rather than dropping out; sizes at or above the all-in fold into it.
    // (Pot when a pot limit caps the bet below the all-in).
    const std=(r.preflop?[[2,'2x'],[2.5,'2.5x'],[3,'3x'],[4,'4x']].map(([m,label])=>[m*base,label]):[.33,.66,1.5].map(p=>[r.currentBet+p*(r.pot+r.toCall),share(p)])).map(([t,label])=>[Math.max(t,r.min),label]).filter(([t])=>snap(t,r)<Math.min(r.max,cover(r)-1e-9)).map(([t,label])=>({label,target:snap(t,r)}));
    return [...std.filter((p,i)=>std.findIndex(q=>q.target===p.target)===i),...(r.max>=cover(r)-1e-9?[{label:'All-in',target:clamp(cover(r),r)}]:[{label:'Pot',target:r.max}])];
  }
  function betLabel(r,amount){return(amount>=r.allIn-1e-9?'All-in':r.kind==='raise'?'Raise to':'Bet')+' <span>'+bbText(amount)+'</span>';}
  // o: {key, fold, check, toCall, callAllIn, raise:{kind,min,max,allIn,effective,pot,currentBet,toCall,preflop,bb}|null, disabled, note,
  //     onFold, onCheck, onCall, onBet(target)}
  function turn(box,o){
    const r=o.raise,s0=r?solvedList(r):[],def=r?s0.find(t=>t<cover(r)-1e-9)??s0[0]??(!r.preflop?presets(r)[0].target:r.standard>0?snap(Math.min(r.standard,cover(r)),r):r.min):null;
    // The amount starts at the first solved size (postflop with none, the first preset); solved sizes that arrive later move it until you pick a size yourself.
    if(turnState.key!==o.key||!turnState.touched&&turnState.def!==def)turnState={key:o.key,amount:def,def,touched:false};
    // Re-renders keep a typed amount as it is (any 0.01 bb is legal); only the slider snaps to steps.
    if(r)turnState.amount=clamp(turnState.amount??r.min,r);
    const sig=JSON.stringify(['turn',o.key,o.fold,o.check,o.toCall,o.callAllIn,r,o.note||'']);
    if(box.dataset.abSig!==sig){
      // A rebuild (new solved sizes, a note) keeps focus on the same control, and what is being typed in the amount box.
      const had=box.contains(document.activeElement)?document.activeElement:null,refocus=had?.classList.contains('ab-amount')?'.ab-amount':had?.classList.contains('ab-slider')?'.ab-slider':had?.dataset.ab?`[data-ab="${had.dataset.ab}"]`:null,typed=refocus==='.ab-amount'?had.value:null;
      box.dataset.abSig=sig;box.classList.add('ab-bar');box.classList.remove('ab-waiting');
      // With a free check there is no Fold button: Check and Bet only.
      const middle=o.check?'Check':(o.callAllIn?'All-in':'Call')+' <span>'+bbText(o.toCall)+'</span>',count=(o.fold?1:0)+1+(r?1:0);
      box.innerHTML=(r?`<div class="ab-sizing">${presets(r).length>1?`<div class="ab-presets">${presets(r).map((p,i)=>`<button type="button" class="ab-preset" data-ab-preset="${i}" aria-label="${p.label} · ${num(p.target)} bb">${p.label}</button>`).join('')}</div>`:''}<input class="ab-amount" type="text" inputmode="decimal" autocomplete="off" aria-label="${r.kind==='raise'?'Raise to':'Bet'} amount in bb"><input class="ab-slider" type="range" min="0" max="1000" step="1" aria-label="${r.kind==='raise'?'Raise':'Bet'} size slider"></div>`:'')+
        `<div class="ab-main${count===3?'':count===2?' two':' one'}">${o.fold?'<button type="button" class="btn ab-big" data-ab="fold">Fold</button>':''}<button type="button" class="btn ab-big" data-ab="call">${middle}</button>${r?'<button type="button" class="btn ab-big ab-bet" data-ab="bet"></button>':''}</div>`+(o.note?`<div class="small muted ab-note">${esc(o.note)}</div>`:'');
      if(o.fold)box.querySelector('[data-ab="fold"]').onclick=()=>o.onFold();
      box.querySelector('[data-ab="call"]').onclick=()=>o.check?o.onCheck():o.onCall();
      if(r){
        const amount=box.querySelector('.ab-amount'),slider=box.querySelector('.ab-slider'),list=presets(r);
        const show=(v,typing)=>{turnState.amount=v;if(!typing)amount.value=num(v);slider.value=r.max>r.min?Math.round((v-r.min)/(r.max-r.min)*1000):1000;slider.style.setProperty('--fill',slider.value/10+'%');const bet=box.querySelector('[data-ab="bet"]'),html=betLabel(r,v);if(bet.innerHTML!==html)bet.innerHTML=html;box.querySelectorAll('[data-ab-preset]').forEach(b=>b.classList.toggle('on',Math.abs(list[+b.dataset.abPreset].target-v)<.005));};
        box.querySelectorAll('[data-ab-preset]').forEach(b=>b.onclick=()=>{turnState.touched=true;show(list[+b.dataset.abPreset].target);});
        slider.oninput=()=>{turnState.touched=true;const p=+slider.value;show(p>=1000?r.max:p<=0?r.min:snap(r.min+(r.max-r.min)*p/1000,r));};
        amount.onfocus=()=>amount.select();
        amount.oninput=()=>{const v=Number(amount.value.trim().replace(',','.'));if(amount.value.trim()&&Number.isFinite(v)){turnState.touched=true;show(Math.max(r.min,Math.min(r.max,v)),true);}};
        amount.onblur=()=>show(turnState.amount);
        amount.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();amount.blur();box.querySelector('[data-ab="bet"]').click();}};
        box.querySelector('[data-ab="bet"]').onclick=()=>o.onBet(turnState.amount);
        show(turnState.amount);
      }
      const q=s=>box.querySelector(s),bet=q('[data-ab="bet"]'),shove=r&&r.max>=r.allIn-1e-9;
      keys.set(box,{f:q('[data-ab="fold"]')||q('[data-ab="call"]'),c:q('[data-ab="call"]'),r:bet,a:shove?bet:o.callAllIn?q('[data-ab="call"]'):null,allIn:shove?()=>o.onBet(r.max):null});
      if(refocus){const el=q(refocus);if(el){el.focus({preventScroll:true});if(typed!==null){el.value=typed;el.oninput();}}}
    }
    box.querySelectorAll('button,input').forEach(el=>el.disabled=!!o.disabled);
  }
  // Pre-actions while another player acts. key names the hand and street; choices reset when either changes, and
  // "Check" or "Call X" drop when the price changes (as at GGPoker); "Check / Fold" becomes "Fold".
  function waiting(box,o){
    if(pre.key!==o.key)pre={key:o.key,choice:null,toCall:o.toCall};
    if(pre.toCall!==o.toCall){if(pre.choice==='check'||pre.choice==='call')pre.choice=null;pre.toCall=o.toCall;}
    const options=o.toCall>0?[['fold','Fold'],['call','Call '+bbText(o.toCall)],['any','Call any']]:[['fold','Check / Fold'],['check','Check'],['any','Call any']];
    const sig=JSON.stringify(['wait',o.key,o.toCall,pre.choice]);if(box.dataset.abSig===sig)return;
    box.dataset.abSig=sig;box.classList.add('ab-bar','ab-waiting');
    box.innerHTML=`<div class="ab-pre" role="group" aria-label="Pre-select your action">${options.map(([id,label])=>`<button type="button" class="ab-check${pre.choice===id?' on':''}" role="checkbox" aria-checked="${pre.choice===id}" data-ab-pre="${id}"><i aria-hidden="true"></i>${esc(label)}</button>`).join('')}</div>`;
    keys.set(box,{f:box.querySelector('[data-ab-pre="fold"]'),c:box.querySelector('[data-ab-pre="check"],[data-ab-pre="call"]')});
    box.querySelectorAll('[data-ab-pre]').forEach(b=>b.onclick=()=>{const id=b.dataset.abPre;pre.choice=pre.choice===id?null:id;delete box.dataset.abSig;waiting(box,o);box.querySelector(`[data-ab-pre="${id}"]`)?.focus({preventScroll:true});});
  }
  // On your turn: the kind of action the pre-selection asks for ('fold' | 'check' | 'call'), or null. It is used once.
  function take(key,o){
    if(pre.key!==key||!pre.choice)return null;const c=pre.choice,same=pre.toCall===o.toCall;pre.choice=null;
    if(c==='fold')return o.check?'check':'fold';
    if(c==='check')return o.check?'check':null;
    if(c==='call')return o.check?'check':same?'call':null;
    return o.check?'check':'call';
  }
  // Keyboard shortcuts on the bar: the control each of F, C, R and A acts on (F checks when there is nothing to fold;
  // while waiting, F and C tick the fold and check/call pre-actions). press() runs one; A shoves at once.
  function shortcuts(box){return box.classList.contains('ab-bar')?keys.get(box)||{}:null;}
  function press(box,k){const m=shortcuts(box),el=m?.[k];if(!el||el.disabled)return false;if(k==='a'&&m.allIn)m.allIn();else el.click();return true;}
  function clear(box){delete box.dataset.abSig;keys.delete(box);box.classList.remove('ab-bar','ab-waiting');box.innerHTML='';}
  return{turn,waiting,take,clear,shortcuts,press,presets};
})();
if(typeof module!=='undefined')module.exports=ActionBar;
