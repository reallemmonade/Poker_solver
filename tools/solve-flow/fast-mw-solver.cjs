#!/usr/bin/env node
'use strict';
// The real 3-way solver (tools/multiway-solver/mw_solver), cut to a few iterations and runouts so the solve-flow player
// (run.cjs) gets a real answer in seconds: the bridge passes its input file, this rewrites the effort lines and runs it.
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const file=process.argv[2],bin=process.env.FLOW_MW_SOLVER||path.join(__dirname,'../multiway-solver/mw_solver');
let lines=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=>!/^(max_iterations|runouts|turn_cards|river_cards|time_limit|accuracy) /.test(l));
const flop=lines.some(l=>/^board \S{6}$/.test(l));
lines.push('max_iterations 12','accuracy 50','time_limit 30',...flop?['turn_cards 3','river_cards 2']:[]);
fs.writeFileSync(file,lines.join('\n')+'\n');
const r=spawnSync(bin,[file],{stdio:'inherit'});process.exit(r.status??1);
