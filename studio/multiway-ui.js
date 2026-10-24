'use strict';
function multiwayStudyQuestion(filters=null){
 if(filters&&(!['any','NLH'].includes(filters.quizVariant)||!['any','cash'].includes(filters.quizFormat)||!['any','9'].includes(filters.quizSeats)||!quizStackMatches(20,filters.quizStack)||filters.quizStart==='full'||!['any','3'].includes(filters.quizStreet)||!['any','betcheck'].includes(filters.quizTopic)||!['any','BB'].includes(filters.quizPosition)))return null;
 // Seat 9 holds two made hands and two missed draws, so the overpairs face
 // real value-bet and bluff-catch choices instead of always checking.
 const config=G.normalize({variant:'NLH',seats:9,stacks:Array(9).fill(20),mode:'cash'}),ranges=Array(9).fill('all');ranges[0]='AsAh,KsKh,QcQh,AcKc';ranges[2]='AdAc,KdKc,QdQs,AhKh';ranges[8]='JcJs,Ts8s,6d5d,4h3h';
 const holes=Array(9).fill(null),used=new Set(C.cards('2c7dJh9s3c'));for(const seat of [0,2,8]){const combos=ranges[seat].split(',').map(C.cards).filter(cs=>cs.every(c=>!used.has(c))),combo=combos[Math.floor(Math.random()*combos.length)];holes[seat]=combo;combo.forEach(c=>used.add(c));}
 const hand=new G.Hand(config,{holes,runout:'2c7dJh9s3c'});for(let i=0;i<5;i++)hand.act({kind:'fold'});hand.act({kind:'raise',target:250});hand.act({kind:'call'});hand.act({kind:'fold'});hand.act({kind:'call'});for(let i=0;i<6;i++)hand.act({kind:'check'});
 const abstraction={...state.abstraction,maxAggressions:1,...state.spotSizing},model=new T.Model(config,abstraction),solveOptions=PokerSpot.options({ranges,iterations:50000,milliseconds:45000,maxInfos:150000,abstraction});
 return{hand,hero:2,answered:false,model,snapshot:model.snapshot(),sourceName:'Nine-seat table, three-player river study · narrow specified current ranges',filters:filters||quizFilters(),solveOptions,rangeAnchor:hand.actionLog.length};
}
function useMultiwayStudy(){
 if(state.busy)return;const auto=state.autoAnalyze;state.autoAnalyze=false;
 try{const question=multiwayStudyQuestion();stopTableMotion();writeForm(question.hand.config,question.model.abstraction);state.hero=question.hero;$('hero').value=String(question.hero);$('heroCards').value='';markDirty();applySetup(false,false);state.hand=question.hand;state.config=question.hand.config;state.abstraction=question.model.abstraction;setModel(question.snapshot);state.handSaved=false;state.currentGrades=[];state.hero=question.hero;saveLiveSession();renderAll();for(let i=0;i<question.hand.n;i++){const el=$('spotRange-'+i);el.value=question.solveOptions.ranges[i];spotUI.rangeValues[i]=el.value;}switchTab('play');analyzeSpot(state.hand,{kind:'inspect'});}finally{state.autoAnalyze=auto;}
}
function initMultiwayStudies(){
 $('tryMultiwayStudy').onclick=useMultiwayStudy;
 $('quizMultiwayStudy').onclick=()=>{if(state.busy)return;stopTableMotion();cancelQuizGeneration();clearQuizQuestion();for(const [id,value]of Object.entries({quizStart:'spot',quizEvidence:'matched',quizVariant:'NLH',quizFormat:'cash',quizSeats:'9',quizStack:'short',quizPosition:'BB',quizStreet:'3',quizTopic:'betcheck'}))$(id).value=value;saveQuizFilters();syncQuizFilters();state.quiz=multiwayStudyQuestion(quizFilters());prepareQuizSpot(state.quiz);};
}
