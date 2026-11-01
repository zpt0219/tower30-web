import {expect,it} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import {validateConfig} from '../../src/core/config';
import {TowerEngine} from '../../src/core/engine';
import {defaultPlaytestSetup} from '../../src/core/playtest';
import {createSimulationReport,simulatePair,simulateBattle,simulationSeed,summarizeTrials,summarizePairs,trialSave} from '../../src/core/simulation';
const config=validateConfig(raw), setup={...defaultPlaytestSetup(),skillPolicy:'strict' as const},options={count:2,policy:'adaptive' as const,reinforce:true};
it('同配置同种子配对一致，导出操作记录可用现行核心精确重放，正式资源不变',()=>{
 const normal=new TowerEngine(config),before=normal.serialize();
 const report=createSimulationReport(config,config,setup,options);
 for(let i=0;i<2;i++)report.pairs.push(simulatePair(report,i));
 expect(report.pairs[0]!.a).toEqual(report.pairs[0]!.b);
 expect(report.pairs[1]!.a).toEqual(report.pairs[1]!.b);
 expect(report.pairs[1]!.a.seed).toBe(setup.seed+1);
 const row=report.pairs[0]!.a;
 const restored=TowerEngine.restorePlaytest(JSON.stringify(trialSave(report,'a',0))).getSnapshot();
 expect(restored.battle!.result).toBe(row.result);expect(restored.battle!.tick).toBe(row.ticks);
 expect(restored.battle!.units.filter(u=>!u.enemy).reduce((s,u)=>s+u.damage,0)).toBe(row.damage);
 expect(restored.gold).toBe(0);expect(restored.records).toEqual([]);expect(normal.serialize()).toBe(before);
 const snap=normal.getBattleSnapshot();expect(snap).toBeNull();
});
it('配置与设置在批量开始时冻结，不使用大招策略保持1000初始能量亦不释放',()=>{
 const a=structuredClone(raw),report=createSimulationReport(a,a,{...setup,energy:1000}, {...options,policy:'no-ultimates'});
 a.Rules.Combatants.hero.Base.Attack=999999;
 expect(report.a.config.Rules.Combatants.hero!.Base.Attack).not.toBe(999999);
 const trial=simulatePair(report,0).a;expect(trial.ultimates).toBe(0);expect(trial.energySpent).toBe(0);
 const normal=TowerEngine.createPlaytest(config,setup);normal.dispatch({type:'begin'});normal.dispatch({type:'start'});
 const snapshot=normal.getBattleSnapshot()!;snapshot.units[0]!.hp=1;expect(normal.getBattleSnapshot()!.units[0]!.hp).not.toBe(1);
});
it('弱化配置真实失败、强化配置真实获胜，按完成配对统计且空样本没有伪造0%胜率',()=>{
 const weak=structuredClone(raw),strong=structuredClone(raw);
 for(const id of ['hero','princess'] as const){weak.Rules.Combatants[id].Base.MaxHp=1;weak.Rules.Combatants[id].Growth.MaxHp=0;strong.Rules.Combatants[id].Base.Attack=100000;strong.Rules.Combatants[id].Base.Magic=100000;}
 const r=createSimulationReport(weak,strong,setup,{...options,count:1});r.pairs.push(simulatePair(r,0));
 expect(r.pairs[0]!.a.result).toBe('loss');expect(r.pairs[0]!.b.result).toBe('victory');
 expect(summarizePairs(r.pairs)).toEqual({aOnly:0,bOnly:1,both:0,neither:0});
 expect(summarizeTrials([]).winRate).toBeNull();expect(summarizeTrials([r.pairs[0]!.a])).toMatchObject({wins:0,losses:1,winRate:0,victorySeconds:null});
 expect(summarizeTrials([r.pairs[0]!.b])).toMatchObject({wins:1,winRate:1});
});
it('补人策略遵循真实票数；超时与严格校验有明确结果，零种子不混入批次',()=>{
 expect(simulationSeed(0xffffffff,1)).toBe(1);expect(()=>simulationSeed(0,0)).toThrow();
 expect(()=>createSimulationReport(config,config,setup,{...options,count:101})).toThrow();
 const unsupported=structuredClone(raw);unsupported.Rules.Profiles.hero.Auto='guard';
 expect(()=>createSimulationReport(config,unsupported,{...setup,startingGear:false},options)).not.toThrow(); // Unequipped humans have no auto action.
 unsupported.Rules.Profiles.hero.Ultimate='guard';expect(()=>createSimulationReport(config,unsupported,setup,options)).toThrow(/未迁移/);
 const party={...setup,party:['hero','princess','slime_dusk','sproutling','reedwing','boar'],energy:1000};
 const withReserve=simulateBattle(config,party,options),withoutReserve=simulateBattle(config,party,{...options,reinforce:false});
 expect(withReserve.reinforcements).toBe(1);expect(withoutReserve.reinforcements).toBe(0);
 const durable=structuredClone(raw);for(const id of ['hero','princess','slime_dusk'] as const)durable.Rules.Combatants[id].Base.MaxHp=1000000;
 expect(simulateBattle(validateConfig(durable),setup,{...options,policy:'no-ultimates'})).toMatchObject({result:'flee',ticks:6000});
 const record=TowerEngine.restorePlaytest(JSON.stringify({...trialSave({...createSimulationReport(config,config,party,options),pairs:[{a:withReserve,b:withReserve}]},'a',0)})).getSnapshot();
 expect(record.battle!.units.some(u=>u.id==='boar')).toBe(true);
});
