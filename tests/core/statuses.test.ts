import {it,expect} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import {validateConfig,attributesSchema} from '../../src/core/config';
import {TowerEngine} from '../../src/core/engine';
import {defaultPlaytestSetup} from '../../src/core/playtest';
import {nextRandom} from '../../src/core/math';
function scene(auto:string,enemyAuto=''){
 const c=validateConfig(raw);
 for(const id of ['hero','boar']){const d=c.Rules.Combatants[id]!;d.Base={...attributesSchema.parse({}),MaxHp:100000,Attack:100,Magic:100};d.Growth=attributesSchema.parse({});d.MoveSpeed=.1;d.AttackRange=.1;d.WindupRatio=.8;c.Rules.Profiles[id]!.Auto=id==='hero'?auto:enemyAuto;c.Rules.Profiles[id]!.Cooldown=30;c.Rules.Profiles[id]!.Interval=5;}
 const w=c.Rules.Equipment.find(g=>g.Id==='traveler_sword')!;w.Auto=auto;w.Attributes=attributesSchema.parse({});
 c.Encounters[0]!.Enemies=[{...c.Encounters[0]!.Enemies[0]!,Species:'boar',Health:1,Rank:1}];
 for(const id of [auto,enemyAuto].filter(Boolean)){const r=c.Rules.Actions[id]!;r.Range=30;r.Windup=0;r.Ratios=[1];r.Bases=[0];r.Delivery='instant';}
 return c;
}
function start(c:ReturnType<typeof scene>,party=['hero'],rank=1,energy=0,hpPercent=50){const e=TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party,rank,energy,hpPercent,skillPolicy:'strict'});e.dispatch({type:'begin'});e.dispatch({type:'start'});e.advance(8);return e;}
it('毒伤按周期推进且抑制实际治疗，中途恢复保留毒源和计时',()=>{
 const c=scene('poison','mossheal');c.Rules.Actions.poison!.Bases=[3000];c.Rules.Actions.poison!.Duration=7;c.Rules.Combatants.boar!.Base.Magic=1000;c.Rules.Actions.mossheal!.Windup=.6;
 const e=start(c);e.advance(45);const u=e.getSnapshot().battle!.units[1]!;
 expect(u.healing).toBe(600);expect(u.dotPower).toBe(16);expect(u.dotOwner).toBe('hero');expect(u.dotTime).toBeGreaterThan(0);expect(u.healBlock).toBeGreaterThan(0);
 const restored=TowerEngine.restorePlaytest(e.serialize());e.advance(30);restored.advance(30);expect(e.getSnapshot()).toEqual(restored.getSnapshot());
});
it('净化帷幕清除持续伤害与治疗抑制，护盾取较强者且不叠加',()=>{
 const c=scene('','poison');c.Rules.Combatants.white_ghost={...c.Rules.Combatants.hero!,Base:{...c.Rules.Combatants.hero!.Base}};c.Rules.Profiles.white_ghost!.Auto='';c.Rules.Profiles.white_ghost!.Ultimate='purify_veil';c.Rules.Profiles.white_ghost!.PassiveEffect='cleanse_ward';c.Rules.Actions.purify_veil!.Windup=0;
 const e=start(c,['white_ghost'],3,1000);for(let i=0;i<80&&e.getSnapshot().battle!.units[0]!.dotTime===0;i++)e.advance(1);expect(e.getSnapshot().battle!.units[0]!.dotTime).toBeGreaterThan(0);
 expect(e.dispatch({type:'ultimate',id:'white_ghost'}).ok).toBe(true);e.advance(1);const u=e.getSnapshot().battle!.units[0]!;expect(u.dotTime).toBe(0);expect(u.healBlock).toBe(0);expect(u.barrier).toBe(80);expect(u.healing).toBe(0);e.advance(20);expect(e.getSnapshot().battle!.units[0]!.hp).toBe(u.hp);
});
it('反伤不判闪避/暴击、不触发吸血或再次反伤，反击者无击杀回能',()=>{
 const c=scene('swift');c.Rules.Profiles.boar!.PassiveEffect='thorns';c.Encounters[0]!.Enemies[0]!.Rank=3;c.Rules.Combatants.boar!.Base.CritRate=.75;c.Rules.Combatants.hero!.Base.DodgeRate=.4;c.Rules.Combatants.hero!.Base.Lifesteal=.6;
 const e=start(c);e.advance(40);const b=e.getSnapshot().battle!;
 expect(b.units[0]!.damage).toBe(100);expect(b.units[0]!.healing).toBe(60);expect(b.units[0]!.dodges).toBe(0);expect(b.units[1]!.damage).toBe(15);expect(b.random).toBe(nextRandom(nextRandom(2463534242)));
 c.Rules.Combatants.hero!.Base.MaxHp=1000;const lethal=start(c,['hero'],1,0,1);lethal.advance(40);expect(lethal.getSnapshot().battle!.units[0]!.hp).toBe(0);expect(lethal.getSnapshot().battle!.units[1]!.killEnergy).toBe(0);expect(lethal.getSnapshot().battle!.units[0]!.healing).toBe(0);
});
it('反击蓄势在下一次普攻执行后消耗，攻击力先放大再结算',()=>{
 const c=scene('swift');c.Rules.Profiles.boar!.PassiveEffect='counter';c.Encounters[0]!.Enemies[0]!.Rank=3;c.Rules.Combatants.boar!.MoveSpeed=20;c.Rules.Combatants.boar!.AttackRange=10;
 const e=start(c);for(let i=0;i<150&&!e.getSnapshot().events.some(e=>e.kind==='hit'&&e.actor.startsWith('EN-'));i++)e.advance(1);
 const hit=e.getSnapshot().events.find(e=>e.kind==='hit'&&e.actor.startsWith('EN-'))!;expect(hit.amount).toBe(-130);expect(e.getSnapshot().battle!.units[1]!.counterReady).toBe(false);
});
it('顺风按模拟时间加快动作，不永久修改属性；白银/根守韧性叠加仍受上限约束',()=>{
 const c=scene('tailwind'),e=start(c);for(let i=0;i<80&&e.getSnapshot().battle!.units[0]!.haste===0;i++)e.advance(1);
 expect(e.getSnapshot().battle!.units[0]!.recovery).toBe(.3);e.advance(1);expect(e.getSnapshot().battle!.units[0]!.recovery).toBeCloseTo(.2375);expect(e.getSnapshot().battle!.units[0]!.attributes.Haste).toBe(0);e.advance(65);expect(e.getSnapshot().battle!.units[0]!.haste).toBe(0);
 c.Rules.Combatants.boar!.Base.Tenacity=.5;c.Rules.Profiles.boar!.PassiveEffect='silver';c.Encounters[0]!.Enemies[0]!.Rank=3;expect(start(c).getSnapshot().battle!.units[1]!.attributes.Tenacity).toBe(.6);
});
