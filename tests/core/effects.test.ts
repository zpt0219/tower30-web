import {expect,it} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import old from '../fixtures/v06-effects-compatibility.json';
import {TowerEngine} from '../../src/core/engine';
import {validateConfig,fingerprint} from '../../src/core/config';
import {defaultPlaytestSetup} from '../../src/core/playtest';
import {effectDefinitions,resolveEffects,shieldDefaults,defaultShieldRatio} from '../../src/core/effects';
import {createSimulationReport,simulatePair,trialSave} from '../../src/core/simulation';
import {scene as sceneFromConfig,start} from '../helpers/status-scene';
const scene=(auto:string,enemyAuto='')=>sceneFromConfig(raw,auto,enemyAuto);
it('19bd885的真实v0.6战中记录精确恢复，默认配表指纹不变，继续并升级v5可重放',()=>{
 const e=TowerEngine.restorePlaytest(old.serialized);
 expect(e.getSnapshot()).toEqual(old.expected);
 const normalized=validateConfig(raw);expect(normalized.Rules.Effects).toBeUndefined();expect(fingerprint(normalized)).toBe('fnv1a-1713cdf4');
 e.advance(70);expect(JSON.parse(e.serialize()).engineVersion).toBe('tower30-ts-workbench-v5');
 const restored=TowerEngine.restorePlaytest(e.serialize());e.advance(40);restored.advance(40);expect(restored.getSnapshot()).toEqual(e.getSnapshot());
});
it('显式填入全部共用默认、逐技能默认护盾和毒伤，单位、随机状态及结算保持一致',()=>{
 const oldEngine=TowerEngine.restorePlaytest(old.serialized),config=oldEngine.getConfigSnapshot();
 config.Rules.Effects=resolveEffects();
 for(const key of Object.keys(shieldDefaults) as (keyof typeof shieldDefaults)[])config.Rules.Actions[key]!.ShieldRatios=[1,2,3].map(i=>defaultShieldRatio(key,i));
 config.Rules.Actions.poison!.DotRatio=1/6;config.Rules.Actions.lava_bolt!.DotRatio=1/8;
 const input=oldEngine.getSnapshot().playtest!;
 const a=TowerEngine.createPlaytest(oldEngine.getConfigSnapshot(),input),b=TowerEngine.createPlaytest(config,input);
 for(const e of [a,b]){e.dispatch({type:'begin'});e.dispatch({type:'start'});}
 for(let tick=0;tick<1000;tick+=20){for(const e of [a,b]){for(const id of input.party)e.dispatch({type:'ultimate',id});e.advance(20);}const x=a.getBattleSnapshot()!,y=b.getBattleSnapshot()!;expect(y.units).toEqual(x.units);expect(y.random).toBe(x.random);expect(y.result).toBe(x.result);expect(y.tickets).toBe(x.tickets);}
});
it('毒刺与熔弹倍率控制真实持续伤害；0关闭毒伤，减疗保留比例控制真实治疗',()=>{
 for(const skill of ['poison','lava_bolt']){
  const c=scene(skill,'mossheal');c.Rules.Actions[skill]!.DotRatio=.5;c.Rules.Actions[skill]!.Bases=[3000];c.Rules.Actions[skill]!.Duration=7;c.Rules.Combatants.boar!.Base.Magic=1000;c.Rules.Actions.mossheal!.Windup=.6;c.Rules.Effects={HealingReceived:.2};
  const e=start(c);e.advance(45);const u=e.getBattleSnapshot()!.units[1]!;expect(u.dotPower).toBe(50);expect(u.healing).toBe(skill==='poison'?200:1000);
  const replay=TowerEngine.restorePlaytest(e.serialize());e.advance(30);replay.advance(30);expect(e.getSnapshot()).toEqual(replay.getSnapshot());
  c.Rules.Actions[skill]!.DotRatio=0;const off=start(c);off.advance(45);expect(off.getBattleSnapshot()!.units[1]!.dotTime).toBe(0);
 }
});
it('反伤比例与冷却影响实际受伤；0关闭反伤且不凭空消耗随机数',()=>{
 const c=scene('swift');c.Rules.Profiles.boar!.PassiveEffect='thorns';c.Encounters[0]!.Enemies[0]!.Rank=3;c.Rules.Effects={ReflectionRatio:.5};
 const e=start(c);e.advance(40);expect(e.getBattleSnapshot()!.units[1]!.damage).toBe(50);
 c.Rules.Effects.ReflectionRatio=0;const off=start(c);off.advance(40);expect(off.getBattleSnapshot()!.units[1]!.damage).toBe(0);expect(off.getBattleSnapshot()!.random).toBe(e.getBattleSnapshot()!.random);
 c.Rules.Profiles.hero!.Cooldown=1;c.Rules.Effects={ReflectionRatio:.5,ReflectionCooldown:30};const slow=start(c);slow.advance(80);
 c.Rules.Effects.ReflectionCooldown=0;const fast=start(c);fast.advance(80);expect(slow.getBattleSnapshot()!.units[1]!.damage).toBe(50);expect(fast.getBattleSnapshot()!.units[1]!.damage).toBeGreaterThan(50);
});
it('急速强度改变动作推进，移动倍率改变真实位置，数值庇护改变真实物理承伤',()=>{
 const c=scene('tailwind');c.Rules.Effects={HasteBonus:.75,HasteMoveMultiplier:1};
 const e=start(c);for(let i=0;i<80&&e.getBattleSnapshot()!.units[0]!.haste===0;i++)e.advance(1);
 expect(e.getBattleSnapshot()!.units[0]!.recovery).toBe(.3);e.advance(1);expect(e.getBattleSnapshot()!.units[0]!.recovery).toBeCloseTo(.2125);
 const x=e.getBattleSnapshot()!.units[0]!.x;e.advance(10);const moved=e.getBattleSnapshot()!.units[0]!.x-x;
 c.Rules.Effects.HasteMoveMultiplier=2;const faster=start(c);for(let i=0;i<80&&faster.getBattleSnapshot()!.units[0]!.haste===0;i++)faster.advance(1);faster.advance(1);const x2=faster.getBattleSnapshot()!.units[0]!.x;faster.advance(10);expect(faster.getBattleSnapshot()!.units[0]!.x-x2).toBeGreaterThan(moved);
 const guard=scene('swift','hard_shell');guard.Rules.Actions.swift!.Windup=.2;guard.Rules.Effects={TypedGuard:.2};const g=start(guard);g.advance(40);expect(g.getBattleSnapshot()!.units[0]!.damage).toBe(80);
});
it('每级护盾可独立覆盖与继承，0不生成新盾，净化被动与技能护盾取较强者',()=>{
 const c=scene('leafward');c.Rules.Actions.leafward!.ShieldRatios=[null,0,2];const weapon=c.Rules.Equipment.find(g=>g.Id==='traveler_sword')!;
 for(const [level,amount] of [[1,52],[2,0],[3,200]] as const){weapon.AutoLevel=level;const e=start(c);e.advance(40);expect(e.getBattleSnapshot()!.units[0]!.barrier).toBe(amount);}
 const purified=scene('','poison');purified.Rules.Combatants.white_ghost=structuredClone(purified.Rules.Combatants.hero!);purified.Rules.Profiles.white_ghost!.Auto='';purified.Rules.Profiles.white_ghost!.Ultimate='purify_veil';purified.Rules.Profiles.white_ghost!.PassiveEffect='cleanse_ward';purified.Rules.Actions.purify_veil!.Windup=0;purified.Rules.Actions.purify_veil!.ShieldRatios=[.2];purified.Rules.Effects={CleanseShieldRatio:.9};
 const p=start(purified,['white_ghost'],3,1000);for(let i=0;i<80&&p.getBattleSnapshot()!.units[0]!.dotTime===0;i++)p.advance(1);expect(p.dispatch({type:'ultimate',id:'white_ghost'}).ok).toBe(true);p.advance(1);expect(p.getBattleSnapshot()!.units[0]!.barrier).toBe(90);
});
it('装备的溢出转盾、盾上限、应急和援护比例读取同一份配置',()=>{
 const c=scene('heal');c.Rules.Combatants.hero!.Base.MaxHp=1000;c.Rules.Equipment.find(g=>g.Id==='traveler_sword')!.Effect='overheal';c.Rules.Effects={OverhealShieldRatio:1,OverhealShieldCap:.8};const heal=start(c,['hero'],1,0,99);heal.advance(40);expect(heal.getBattleSnapshot()!.units[0]!.barrier).toBe(90);
 c.Rules.Effects.OverhealShieldCap=.01;const cap=start(c,['hero'],1,0,99);cap.advance(40);expect(cap.getBattleSnapshot()!.units[0]!.barrier).toBe(10);
 const emergency=scene('','swift');emergency.Rules.Combatants.hero!.Base.MaxHp=1000;emergency.Rules.Equipment.find(g=>g.Id==='traveler_sword')!.Effect='emergency';emergency.Rules.Effects={EmergencyShieldRatio:.5};const save=start(emergency,['hero'],1,0,20);save.advance(40);expect(save.getBattleSnapshot()!.units[0]!.barrier).toBe(500);
 const arrival=scene('');arrival.Rules.Equipment.find(g=>g.Id==='traveler_sword')!.Effect='arrival';arrival.Rules.Effects={ArrivalShieldRatio:.5};const e=start(arrival,['hero','princess','sproutling','reedwing','crab','boar']);expect(e.dispatch({type:'reinforce',id:'boar'}).ok).toBe(true);const boar=e.getBattleSnapshot()!.units.find(u=>u.id==='boar')!;expect(boar.barrier).toBe(boar.attributes.MaxHp*.5);
});
it('参数经严格验证，未知或不适用的效果不能被静默吞掉；对比和导出复现保留修改',()=>{
 for(const effects of [{ReflectionRatio:-.1},{HealingReceived:1.1},{HasteBonus:NaN},{Unknown:1}])expect(()=>validateConfig({...raw,Rules:{...raw.Rules,Effects:effects}})).toThrow();
 const c=validateConfig(raw);c.Rules.Actions.swift!.DotRatio=.1;expect(()=>validateConfig(c)).toThrow(/持续伤害/);delete c.Rules.Actions.swift!.DotRatio;c.Rules.Actions.swift!.ShieldRatios=[1];expect(()=>validateConfig(c)).toThrow(/护盾/);delete c.Rules.Actions.swift!.ShieldRatios;
 expect(Object.keys(resolveEffects())).toHaveLength(Object.keys(effectDefinitions).length);
 const a=scene('swift');a.Rules.Profiles.boar!.PassiveEffect='thorns';a.Encounters[0]!.Enemies[0]!.Rank=3;const b=structuredClone(a);b.Rules.Effects={ReflectionRatio:.5};
 const setup={...defaultPlaytestSetup(),party:['hero'],hpPercent:50,skillPolicy:'strict' as const};const r=createSimulationReport(a,b,setup,{count:1,policy:'no-ultimates',reinforce:false});r.pairs.push(simulatePair(r,0));expect(r.a.hash).not.toBe(r.b.hash);expect(r.pairs[0]!.a.hpRemaining).not.toBe(r.pairs[0]!.b.hpRemaining);const restored=TowerEngine.restorePlaytest(JSON.stringify(trialSave(r,'b',0)));expect(restored.getConfigSnapshot().Rules.Effects!.ReflectionRatio).toBe(.5);expect(restored.getBattleSnapshot()!.tick).toBe(r.pairs[0]!.b.ticks);
});
