import {scene as sceneFromConfig,start} from '../helpers/status-scene';
import raw from '../../data/tower/trial.json';
const scene=(auto:string,enemyAuto='')=>sceneFromConfig(raw,auto,enemyAuto);
import {it,expect} from 'vitest';
import {TowerEngine} from '../../src/core/engine';
import {nextRandom} from '../../src/core/math';
it('毒伤按周期推进且抑制实际治疗，中途恢复保留毒源和计时',()=>{
 const c=scene('poison','mossheal');c.Rules.Actions.poison!.Bases=[3000];c.Rules.Actions.poison!.Duration=7;c.Rules.Combatants.mudguard!.Base.Magic=1000;c.Rules.Actions.mossheal!.Windup=.6;
 const e=start(c);e.advance(135);const u=e.getSnapshot().battle!.units[1]!;
 expect(u.healing).toBe(600);expect(u.dotPower).toBe(16);expect(u.dotOwner).toBe('hero');expect(u.dotTime).toBeGreaterThan(0);expect(u.healBlock).toBeGreaterThan(0);
 const restored=TowerEngine.restorePlaytest(e.serialize());e.advance(90);restored.advance(90);expect(e.getSnapshot()).toEqual(restored.getSnapshot());
});
it('净化帷幕清除持续伤害与治疗抑制，护盾取较强者且不叠加',()=>{
 const c=scene('','poison');c.Rules.Combatants.ice_ghost={...c.Rules.Combatants.hero!,Base:{...c.Rules.Combatants.hero!.Base}};delete c.Rules.Profiles.ice_ghost!.AutoSkills;c.Rules.Profiles.ice_ghost!.Auto='';c.Rules.Profiles.ice_ghost!.Ultimate='purify_veil';c.Rules.Profiles.ice_ghost!.PassiveEffect='cleanse_ward';c.Rules.Actions.purify_veil!.Windup=0;
 const e=start(c,['ice_ghost'],3,1000);for(let i=0;i<240&&e.getSnapshot().battle!.units[0]!.dotTime===0;i++)e.advance(1);expect(e.getSnapshot().battle!.units[0]!.dotTime).toBeGreaterThan(0);
 expect(e.dispatch({type:'ultimate',id:'ice_ghost'}).ok).toBe(true);e.advance(1);const u=e.getSnapshot().battle!.units[0]!;expect(u.dotTime).toBe(0);expect(u.healBlock).toBe(0);expect(u.barrier).toBe(80);expect(u.healing).toBe(0);e.advance(60);expect(e.getSnapshot().battle!.units[0]!.hp).toBe(u.hp);
});
it('反伤不判闪避/暴击、不触发吸血或再次反伤，反击者无击杀回能',()=>{
 const c=scene('swift');c.Rules.Profiles.mudguard!.PassiveEffect='thorns';c.Encounters[0]!.Enemies[0]!.Rank=3;c.Rules.Combatants.mudguard!.Base.CritRate=.75;c.Rules.Combatants.hero!.Base.DodgeRate=.4;c.Rules.Combatants.hero!.Base.Lifesteal=.6;
 const e=start(c);e.advance(120);const b=e.getSnapshot().battle!;
 expect(b.units[0]!.damage).toBe(100);expect(b.units[0]!.healing).toBe(60);expect(b.units[0]!.dodges).toBe(0);expect(b.units[1]!.damage).toBe(15);expect(b.random).toBe(nextRandom(nextRandom(2463534242)));
 c.Rules.Combatants.hero!.Base.MaxHp=1000;const lethal=start(c,['hero'],1,0,1);lethal.advance(120);expect(lethal.getSnapshot().battle!.units[0]!.hp).toBe(0);expect(lethal.getSnapshot().battle!.units[1]!.killEnergy).toBe(0);expect(lethal.getSnapshot().battle!.units[0]!.healing).toBe(0);
});
it('反击蓄势在下一次普攻执行后消耗，攻击力先放大再结算',()=>{
 const c=scene('swift');c.Rules.Profiles.mudguard!.PassiveEffect='counter';c.Encounters[0]!.Enemies[0]!.Rank=3;c.Rules.Combatants.mudguard!.MoveSpeed=20;c.Rules.Combatants.mudguard!.AttackRange=10;
 const e=start(c);for(let i=0;i<450&&!e.getSnapshot().events.some(e=>e.kind==='hit'&&e.actor.startsWith('EN-'));i++)e.advance(1);
 const hit=e.getSnapshot().events.find(e=>e.kind==='hit'&&e.actor.startsWith('EN-'))!;expect(hit.amount).toBe(-130);expect(e.getSnapshot().battle!.units[1]!.counterReady).toBe(false);
});
it('顺风按模拟时间加快动作，不永久修改属性；白银/根守韧性叠加仍受上限约束',()=>{
 const c=scene('tailwind'),e=start(c);for(let i=0;i<240&&e.getSnapshot().battle!.units[0]!.haste===0;i++)e.advance(1);
 expect(e.getSnapshot().battle!.units[0]!.recovery).toBe(.3);e.advance(1);expect(e.getSnapshot().battle!.units[0]!.recovery).toBeCloseTo(0.3-(1/60)*1.25);expect(e.getSnapshot().battle!.units[0]!.attributes.Haste).toBe(0);e.advance(195);expect(e.getSnapshot().battle!.units[0]!.haste).toBe(0);
 c.Rules.Combatants.mudguard!.Base.Tenacity=.5;c.Rules.Profiles.mudguard!.PassiveEffect='silver';c.Encounters[0]!.Enemies[0]!.Rank=3;expect(start(c).getSnapshot().battle!.units[1]!.attributes.Tenacity).toBe(.6);
});
