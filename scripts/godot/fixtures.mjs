import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const artifacts=process.env.TOWER_ARTIFACT_DIR??readFileSync('.artifact-dir','utf8').trim();
const context=vm.createContext({});
vm.runInContext(readFileSync('integrations/godot/generated/tower30-core.js','utf8'),context);
const call=context.Tower30Bridge.call;
const config=JSON.parse(readFileSync('data/tower/thirty-floor-trial.json','utf8'));
const requests=[],responses=[],checks=[];
const send=r=>{const s=call(JSON.stringify(r));requests.push(JSON.stringify(r));responses.push(s);const parsed=JSON.parse(s);if(!parsed.ok)throw new Error(parsed.error);return parsed.value;};
const command=c=>assert.equal(send({op:'command',command:c}).ok,true,JSON.stringify(c));
const snapshot=label=>{const value=send({op:'snapshot'});checks.push({label,index:responses.length-1,tick:value.tick,result:value.battle?.result,seed:value.seed,gold:value.gold});return value;};
// Replay the real, normal-budget 60Hz 30-floor acceptance journal, no debug state.
send({op:'create',config,seed:2463534242});
const trace=JSON.parse(readFileSync('tests/fixtures/ts60-thirty-floors.json','utf8'));
for(let floor=1;floor<=30;floor++){
 const rows=trace.filter(r=>r.floor===floor),first=rows[0];
 for(const c of first.setupCommands)command(c);
 command({type:'begin'});for(const id of first.openingCommands)command({type:'opening',id});command({type:'start'});
 let tick=0;
 for(const row of rows){
  if(floor===1&&row.tick>180&&tick===0){
   send({op:'advance',ticks:180});const mid=send({op:'save'});
   send({op:'advance',ticks:60});const branch=snapshot('normal-mid-battle-continued');
   send({op:'restore',save:mid,config});send({op:'advance',ticks:60});assert.deepEqual(snapshot('normal-mid-battle-restored-continued'),branch);
   send({op:'restore',save:mid,config});tick=180;
  }
  if(row.tick>tick)send({op:'advance',ticks:row.tick-tick});tick=row.tick;
  for(const id of row.commands)command({type:'ultimate',id});
  for(const id of row.reinforcements)command({type:'reinforce',id});
 }
 const s=snapshot(`normal-floor-${floor}`);assert.equal(s.battle.result,'victory');
 if([10,20,30].includes(floor)){const core=send({op:'save'});writeFileSync(`${artifacts}/native-boss-${floor}-unclaimed.json`,JSON.stringify({format:'tower30-godot-session',version:1,core,stage:'report'}));}
 if(floor===1){const save=send({op:'save'});send({op:'restore',save,config});assert.deepEqual(snapshot('cross-host-restore-floor-1'),s);}
 command({type:'finish'});
}
const completion=snapshot('normal-30-completed');assert.equal(completion.completed,true);assert.equal(completion.gold,610);assert.equal(completion.tick,35487);
const setup={floor:1,seed:2463534242,party:['hero','princess','slime_dusk','sproutling','reedwing','boar','skeleton_guard','crab','water_elemental','earth_elemental'],level:1,rank:1,hpPercent:100,energy:0,startingGear:true,skillPolicy:'supported-only',autoPlay:true,strategy:{ultimates:false,healing:'threshold',healingHpPercent:65,interrupt:'charging',ultimateOrder:[],reinforce:true,reinforcementOrder:[]}};
const stress=structuredClone(config);for(const v of Object.values(stress.Rules.Combatants)){v.Base.MaxHp=1000000;v.Growth.MaxHp=0;}stress.Encounters[0].Enemies[0].Count=12;
const create={op:'create',config:stress,setup};writeFileSync(`${artifacts}/stress-create.json`,JSON.stringify(create));
send(create);command({type:'begin'});command({type:'start'});send({op:'advance',ticks:2010});
const full=snapshot('20-living-units');assert.equal(full.battle.units.filter(u=>u.hp>0).length,20);
const save=send({op:'save'});writeFileSync(`${artifacts}/stress-save.json`,save);
send({op:'advance',ticks:120});const continued=snapshot('stress-continued');
send({op:'restore',save});send({op:'advance',ticks:120});assert.deepEqual(snapshot('stress-restored-continued'),continued);
// Invalid commands/requests must not mutate a live session.
command({type:'withdraw'});const before=snapshot('before-invalid');
for(const r of [{op:'advance',ticks:1.5},{op:'create',config:{}},{op:'restore',save:'{}'}]){
 const response=call(JSON.stringify(r));assert.equal(JSON.parse(response).ok,false);requests.push(JSON.stringify(r));responses.push(response);
}
assert.deepEqual(snapshot('after-invalid'),before);
send({op:'dispose'});
writeFileSync(`${artifacts}/requests.jsonl`,requests.join('\n')+'\n');writeFileSync(`${artifacts}/v8-responses.jsonl`,responses.join('\n')+'\n');writeFileSync(`${artifacts}/checkpoints.json`,JSON.stringify(checks,null,2));
console.log(JSON.stringify({requests:requests.length,checkpoints:checks.length,normalTicks:completion.tick,normalGold:completion.gold,stressLiving:20,artifacts}));
