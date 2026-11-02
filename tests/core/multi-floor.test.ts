import {expect,it} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import {validateConfig} from '../../src/core/config';
import {TowerEngine} from '../../src/core/engine';
import {defaultPlaytestSetup} from '../../src/core/playtest';
import {createSimulationReport,simulatePair,simulationTotal,simulationJob,reportFloors,summarizeFloors,trialSave,type SimulationReport} from '../../src/core/simulation';
const config=validateConfig(raw),setup={...defaultPlaytestSetup(),party:['hero','princess','skeleton_guard','water_elemental','reedwing','sproutling','boar','earth_elemental','mimic'],level:10,rank:3,seed:0xffffffff,skillPolicy:'strict' as const},options={count:2,policy:'adaptive' as const,reinforce:true};
let cached:SimulationReport|undefined;
function completed(){
 if(!cached){cached=createSimulationReport(config,config,setup,options,'A',[30,10,20]);for(let i=0;i<simulationTotal(cached);i++)cached.pairs.push(simulatePair(cached,i));cached.status='complete';}
 return structuredClone(cached);
}
it('10/20/30关按同种子逐关运行，每关独立开局，逐场复现使用实际关卡与种子',()=>{
 const normal=new TowerEngine(config),before=normal.serialize(),r=completed();expect(r.schemaVersion).toBe(4);expect(r.floors).toEqual([10,20,30]);expect(simulationTotal(r)).toBe(6);
 expect(r.pairs.map(p=>[p.floor,p.a.seed])).toEqual([[10,0xffffffff],[20,0xffffffff],[30,0xffffffff],[10,1],[20,1],[30,1]]);
 for(let i=0;i<r.pairs.length;i++){
  const p=r.pairs[i]!,single=createSimulationReport(config,config,{...setup,floor:p.floor!,seed:p.a.seed},{...options,count:1});expect(simulatePair(single,0).a).toEqual(p.a);expect(p.b).toEqual(p.a);
  const e=TowerEngine.restorePlaytest(JSON.stringify(trialSave(r,'b',i))),s=e.getSnapshot();expect(s.floor).toBe(p.floor);expect(s.seed).toBe(p.b.seed);expect(s.battle!.tick).toBe(p.b.ticks);expect(s.battle!.result).toBe(p.b.result);expect(s.records).toEqual([]);expect(s.gold).toBe(0);
 }
 expect(normal.serialize()).toBe(before);
},60000);
it('取消或部分结果逐关使用真实分母，未运行的关卡胜率为空且不补造样本',()=>{
 const r=completed();r.status='cancelled';r.pairs=r.pairs.slice(0,4);
 const summaries=summarizeFloors(r);expect(summaries.map(s=>s.completed)).toEqual([2,1,1]);expect(summaries.map(s=>s.requested)).toEqual([2,2,2]);expect(summaries.reduce((n,s)=>n+s.completed,0)).toBe(r.pairs.length);
 for(const s of summaries)expect(s.a.winRate).toBe(r.pairs.filter(p=>p.floor===s.floor&&p.a.result==='victory').length/s.completed);
 r.pairs=r.pairs.slice(0,1);const untouched=summarizeFloors(r).find(s=>s.floor===20)!;expect(untouched.a.winRate).toBeNull();expect(untouched.a.seconds).toBeNull();expect(untouched.completed).toBe(0);
});
it('选关范围、去重、最大任务数和序号边界严格检查',()=>{
 for(const floors of [[],[1,1],[0],[31],[1.5]])expect(()=>createSimulationReport(config,config,setup,options,'A',floors)).toThrow();
 const r=createSimulationReport(config,config,setup,{...options,count:100},'A',Array.from({length:30},(_,i)=>i+1));expect(simulationTotal(r)).toBe(3000);expect(simulationJob(r,2999)).toEqual({floor:30,seed:99});expect(()=>simulationJob(r,3000)).toThrow();expect(()=>simulationJob(r,-1)).toThrow();expect(()=>simulationJob(r,.5)).toThrow();
 expect(()=>reportFloors({...r,floors:undefined})).toThrow();
});
it('开始前验证所有选关，只检查本次选中关卡，停用警告按关保留',()=>{
 const unrelated=structuredClone(config);unrelated.Encounters[0]!.Enemies[0]!.ProfileOverride={...unrelated.Rules.Profiles.slime_dusk!,Ultimate:'guard'};
 expect(()=>createSimulationReport(unrelated,unrelated,{...setup,floor:1},options,'A',[10,20,30])).not.toThrow();
 const bad=structuredClone(config);bad.Encounters[29]!.Enemies[0]!.ProfileOverride={...bad.Rules.Profiles.wind_elemental!,Ultimate:'guard'};
 expect(()=>createSimulationReport(config,bad,setup,options,'A',[10,20,30])).toThrow(/B 第30关/);
 const partial=createSimulationReport(config,bad,{...setup,skillPolicy:'supported-only'},options,'A',[10,20,30]);expect(partial.floorWarnings?.find(f=>f.floor===10)?.b).toEqual([]);expect(partial.floorWarnings?.find(f=>f.floor===30)?.b.join(' ')).toContain('guard');expect(partial.b.warnings.join(' ')).toContain('第30关');
});
it('开始时冻结选关、配置和设置；错位样本不能错误地复现到当前关卡',()=>{
 const source=structuredClone(config),floors=[30,10],input={...setup},prefs={...options};const r=createSimulationReport(source,source,input,prefs,'A',floors);
 source.Rules.Combatants.hero!.Base.Attack=999999;floors.push(20);input.level=1;prefs.count=100;
 expect(r.floors).toEqual([10,30]);expect(r.setup.level).toBe(10);expect(r.options.count).toBe(2);expect(r.a.config.Rules.Combatants.hero!.Base.Attack).not.toBe(999999);
 const copy=completed();copy.pairs[1]!.floor=10;expect(()=>trialSave(copy,'b',1)).toThrow(/关卡或种子/);
 const seed=completed();seed.pairs[1]!.b.seed=123;expect(()=>trialSave(seed,'b',1)).toThrow(/关卡或种子/);
});
it('旧单关报告v1仍按20Hz模拟、统计和重放，不要求补写多关字段',()=>{
 const r=createSimulationReport(config,config,{...defaultPlaytestSetup(),floor:2},{...options,count:1});r.schemaVersion=1;r.engineVersion="tower30-ts-workbench-v5";r.policyVersion="tower30-policy-v1";delete r.floors;delete r.a.strategy;delete r.b.strategy;
 r.pairs.push(simulatePair(r,0));expect(r.pairs[0]!.floor).toBeUndefined();expect(reportFloors(r)).toEqual([2]);expect(summarizeFloors(r)[0]!.completed).toBe(1);const e=TowerEngine.restorePlaytest(JSON.stringify(trialSave(r,'a',0)));expect(e.logicHz).toBe(20);expect(e.getBattleSnapshot()!.result).toBe(r.pairs[0]!.a.result);
});
