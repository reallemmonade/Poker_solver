// Table action bar shared by Play and Play with friends. On your turn it shows bet-size presets that fill the amount box,
// a slider over the legal range and three big buttons; while you wait it shows pre-action checkboxes that fire when the
// turn reaches you. Amounts are in bb. Bets and raises are street totals ("raise to").
const ActionBar=(()=>{
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=x=>String(+(+x).toFixed(2)),bbText=x=>num(x)+' BB';
  let turnState={key:null,amount:null},pre={key:null,choice:null,toCall:0};
  // Rounds to a step that grows with the size (0.01, 0.1, then 0.5 bb), then clamps to the legal range (the all-in total is always reachable).
  function snap(x,r){const step=x>=25?.5:x>=5?.1:.01;let v=Math.round(x/step)*step;v=+v.toFixed(2);return Math.max(r.min,Math.min(r.max,v));}
  function presets(r){
    // The sizes the solver has an answer for at this decision, when the caller knows them; the slider covers the rest.
    // Labels name the size, not the amount (shown already in the box and the raise button): preflop a multiple of the
    // big blind or of the bet you face (7.5 vs 2.5 is 3x), postflop a share of the pot.
    if(Array.isArray(r.solved))return [...new Set(r.solved.map(t=>Math.max(r.min,Math.min(r.max,+(+t).toFixed(2)))))].sort((a,b)=>a-b).map(t=>({label:t>=r.allIn-1e-9?'All-in':r.preflop?num(t/(r.currentBet<=r.bb?r.bb:r.currentBet))+'x':Math.round(100*(t-r.currentBet)/(r.pot+r.toCall))+'%',target:t}));
    // Preflop before anyone raises, sizes are big-blind multiples; otherwise fractions of the pot after calling.
    if(r.preflop&&r.currentBet<=r.bb)return[[2,'2x'],[2.5,'2.5x'],[3,'3x'],[4,'4x']].map(([m,label])=>({label,target:snap(m*r.bb,r)}));
    return[.25,.4,.66,.88].map(p=>({label:Math.round(p*100)+'%',target:snap(r.currentBet+p*(r.pot+r.toCall),r)}));
  }
  function betLabel(r,amount){return(amount>=r.allIn-1e-9?'All-in':r.kind==='raise'?'Raise to':'Bet')+' <span>'+bbText(amount)+'</span>';}
  // o: {key, fold, check, toCall, callAllIn, raise:{kind,min,max,allIn,pot,currentBet,toCall,preflop,bb}|null, disabled, note,
  //     onFold, onCheck, onCall, onBet(target)}
  function turn(box,o){
    const r=o.raise;if(turnState.key!==o.key)turnState={key:o.key,amount:r?(presets(r).find(p=>p.target<r.allIn-1e-9)||presets(r)[0])?.target??r.min:null};
    if(r)turnState.amount=snap(turnState.amount??r.min,r);
    const sig=JSON.stringify(['turn',o.key,o.fold,o.check,o.toCall,o.callAllIn,r,o.note||'']);
    if(box.dataset.abSig!==sig){
      box.dataset.abSig=sig;box.classList.add('ab-bar');box.classList.remove('ab-waiting');
      const left=o.fold?'Fold':'Check / Fold',middle=o.check?'Check':(o.callAllIn?'All-in':'Call')+' <span>'+bbText(o.toCall)+'</span>';
      box.innerHTML=(r?`<div class="ab-sizing">${presets(r).length?`<div class="ab-presets">${presets(r).map((p,i)=>`<button type="button" class="ab-preset" data-ab-preset="${i}" aria-label="${p.label} · ${num(p.target)} bb">${p.label}</button>`).join('')}</div>`:''}<input class="ab-amount" type="text" inputmode="decimal" autocomplete="off" aria-label="${r.kind==='raise'?'Raise to':'Bet'} amount in bb"><input class="ab-slider" type="range" min="0" max="1000" step="1" aria-label="${r.kind==='raise'?'Raise':'Bet'} size slider"></div>`:'')+
        `<div class="ab-main${r?'':' two'}"><button type="button" class="btn ab-big" data-ab="fold">${left}</button><button type="button" class="btn ab-big" data-ab="call">${middle}</button>${r?'<button type="button" class="btn ab-big ab-bet" data-ab="bet"></button>':''}</div>`+(o.note?`<div class="small muted ab-note">${esc(o.note)}</div>`:'');
      box.querySelector('[data-ab="fold"]').onclick=()=>o.fold?o.onFold():o.onCheck();
      box.querySelector('[data-ab="call"]').onclick=()=>o.check?o.onCheck():o.onCall();
      if(r){
        const amount=box.querySelector('.ab-amount'),slider=box.querySelector('.ab-slider'),list=presets(r);
        const show=(v,typing)=>{turnState.amount=v;if(!typing)amount.value=num(v);slider.value=r.max>r.min?Math.round((v-r.min)/(r.max-r.min)*1000):1000;slider.style.setProperty('--fill',slider.value/10+'%');box.querySelector('[data-ab="bet"]').innerHTML=betLabel(r,v);box.querySelectorAll('[data-ab-preset]').forEach(b=>b.classList.toggle('on',Math.abs(list[+b.dataset.abPreset].target-v)<.005));};
        box.querySelectorAll('[data-ab-preset]').forEach(b=>b.onclick=()=>show(list[+b.dataset.abPreset].target));
        slider.oninput=()=>{const p=+slider.value;show(p>=1000?r.max:p<=0?r.min:snap(r.min+(r.max-r.min)*p/1000,r));};
        amount.onfocus=()=>amount.select();
        amount.oninput=()=>{const v=Number(amount.value);if(amount.value.trim()&&Number.isFinite(v))show(Math.max(r.min,Math.min(r.max,v)),true);};
        amount.onblur=()=>show(turnState.amount);
        amount.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();amount.blur();box.querySelector('[data-ab="bet"]').click();}};
        box.querySelector('[data-ab="bet"]').onclick=()=>o.onBet(turnState.amount);
        show(turnState.amount);
      }
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
  function clear(box){delete box.dataset.abSig;box.classList.remove('ab-bar','ab-waiting');box.innerHTML='';}
  return{turn,waiting,take,clear};
})();
if(typeof module!=='undefined')module.exports=ActionBar;
