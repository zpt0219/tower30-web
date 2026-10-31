import {it,expect} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import {validateConfig} from '../../src/core/config';
import {TowerEngine} from '../../src/core/engine';
import {clone} from '../../src/core/math';
import {defaultPlaytestSetup} from '../../src/core/playtest';
function arena(skill:string,hero='hero',rank=1){
 const c=validateConfig(raw);
 c.Encounters[0]!.Enemies=[{...c.Encounters[0]!.Enemies[0]!,Species:'boar',Health:20,AttackScale:.01,Rank:1}];
 for(const [id,d] of Object.entries(c.Rules.Combatants)) {d.MoveSpeed=.1;d.AttackRange=.1;d.Base.CritRate=0;d.Base.DodgeRate=0;c.Rules.Profiles[id]!.Interval=5;c.Rules.Profiles[id]!.Cooldown=30;}
 c.Rules.Profiles[hero]!.Ultimate=skill;c.Rules.Profiles[hero]!.Auto='';
 c.Rules.Actions[skill]!.Range=30;c.Rules.Actions[skill]!.Windup=0;c.Rules.Actions[skill]!.Backswing=3;
 return {c,start:()=>{const e=TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party:[hero],rank,energy:1000,hpPercent:50,startingGear:false,skillPolicy:'strict'});e.dispatch({type:'begin'});e.dispatch({type:'start'});e.advance(8);return e;}};
}
it('火雨真实领域定时结算，周期伤害不暴击、不吸血、不凭空回能；中途恢复一致',()=>{
 const {c,start}=arena('fire_rain','fire_imp');c.Rules.Combatants.fire_imp!.Base.Lifesteal=.6;c.Rules.Combatants.fire_imp!.Base.CritRate=.75;
 const e=start();expect(e.dispatch({type:'ultimate',id:'fire_imp'}).ok).toBe(true);e.advance(1);
 const initial=e.getSnapshot().battle!,actor=initial.units[0]!;expect(initial.zones).toHaveLength(1);
 const restored=TowerEngine.restorePlaytest(e.serialize());
 e.advance(20);restored.advance(20);
 const b=e.getSnapshot().battle!;expect(b.units[1]!.hp).toBeLessThan(initial.units[1]!.hp);
 expect(b.units[0]!.hp).toBe(actor.hp);expect(b.units[0]!.attackEnergy).toBe(0);expect(b.random).toBe(initial.random);
 expect(restored.getSnapshot()).toEqual(e.getSnapshot());
});
it('壳阵施加护盾与减伤，持续时间覆盖到期',()=>{
 const {c,start}=arena('shellwall','crab',3);c.Rules.Actions.shellwall!.Duration=.5;
 const e=start();expect(e.dispatch({type:'ultimate',id:'crab'}).ok).toBe(true);e.advance(1);
 const u=e.getSnapshot().battle!.units[0]!;expect(u.barrier).toBeGreaterThan(0);expect(u.shield).toBe(.5);
 e.advance(11);expect(e.getSnapshot().battle!.units[0]!.shield).toBe(0);
});
it('技能倍率、射程和前摇编辑实际改变同一核心；未修改测试保持冻结',()=>{
 const {c,start}=arena('steady');
 const first=start(),before=first.serialize();const changed=clone(c);changed.Rules.Actions.steady!.Ratios=[8];
 const second=TowerEngine.createPlaytest(changed,{...defaultPlaytestSetup(),party:['hero'],energy:1000,startingGear:false,skillPolicy:'strict'});
 second.dispatch({type:'begin'});second.dispatch({type:'start'});second.advance(8);
 first.dispatch({type:'ultimate',id:'hero'});second.dispatch({type:'ultimate',id:'hero'});first.advance(1);second.advance(1);
 expect(second.getSnapshot().battle!.units[0]!.damage).toBeGreaterThan(first.getSnapshot().battle!.units[0]!.damage);
 const third=TowerEngine.restorePlaytest(before);expect(third.getConfigSnapshot().Rules.Actions.steady!.Ratios).toEqual(c.Rules.Actions.steady!.Ratios);
 changed.Rules.Actions.steady!.Range=1;
 const near=TowerEngine.createPlaytest(changed,{...defaultPlaytestSetup(),party:['hero'],energy:1000,startingGear:false});near.dispatch({type:'begin'});near.dispatch({type:'start'});near.advance(8);expect(near.dispatch({type:'ultimate',id:'hero'}).ok).toBe(false);
});
it('前10层所有首发敌群与可获得伙伴可完整测试，stage0/1装备全部可用',()=>{
 const c=validateConfig(raw),e=new TowerEngine(c);
 for(let floor=1;floor<=10;floor++)expect(()=>TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),floor,skillPolicy:'strict'})).not.toThrow();
 for(const o of c.Economy.Offers.filter(o=>o.Stage<=1)){
  const g=c.Rules.Equipment.find(g=>g.Id===o.Item);if(g)expect(e.gearSupported(g),g.Id).toBe(true);
 }
});
it('救急装备仅在存活受伤后触发一次，致死命中不触发',()=>{
 const run=(attack:number)=>{
  const c=validateConfig(raw);c.Rules.Equipment.find(g=>g.Id==='traveler_sword')!.Effect='emergency';
  c.Encounters[0]!.Enemies[0]!.Species='boar';
  c.Rules.Combatants.boar!.Base.Attack=attack;c.Rules.Combatants.boar!.Base.CritRate=0;c.Rules.Combatants.boar!.AttackRange=10;
  c.Rules.Profiles.boar!.Auto='';c.Rules.Profiles.hero!.Auto='';c.Rules.Profiles.hero!.Interval=5;
  const e=TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party:['hero'],hpPercent:29,skillPolicy:'strict'});e.dispatch({type:'begin'});e.dispatch({type:'start'});return e;
 };
 const e=run(100);for(let i=0;i<100&&!e.getSnapshot().battle!.units[0]!.emergencyUsed;i++)e.advance(1);
 const first=e.getSnapshot().battle!.units[0]!;expect(first.emergencyUsed).toBe(true);expect(first.barrier).toBe(first.attributes.MaxHp*.18);
 e.advance(40);const after=e.getSnapshot().battle!.units[0]!;expect(after.barrier).toBeLessThan(first.barrier);expect(after.emergencyUsed).toBe(true);
 const lethal=run(1000000);lethal.advance(100);expect(lethal.getSnapshot().battle!.units[0]).toMatchObject({hp:0,barrier:0,emergencyUsed:false});
});
it('援护光环仅给后备入场，多个佩戴者不叠加；溢出治疗按上限转盾',()=>{
 const c=validateConfig(raw);for(const id of ['traveler_sword','healer_staff'])c.Rules.Equipment.find(g=>g.Id===id)!.Effect='arrival';
 const e=TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party:['hero','princess','slime_dusk','sproutling','forest_sprite','crab'],skillPolicy:'strict'});
 e.dispatch({type:'begin'});e.dispatch({type:'start'});e.advance(8);expect(e.getSnapshot().battle!.units[0]!.barrier).toBe(0);expect(e.dispatch({type:'reinforce',id:'crab'}).ok).toBe(true);
 const crab=e.getSnapshot().battle!.units.find(u=>u.id==='crab')!;expect(crab.barrier).toBe(crab.attributes.MaxHp*.12);
 const h=validateConfig(raw);h.Rules.Equipment.find(g=>g.Id==='healer_staff')!.Effect='overheal';h.Rules.Actions.heal!.Range=30;h.Rules.Actions.heal!.Ratios=[10];h.Rules.Actions.heal!.Windup=0;
 const healer=TowerEngine.createPlaytest(h,{...defaultPlaytestSetup(),party:['princess'],hpPercent:95,skillPolicy:'strict'});healer.dispatch({type:'begin'});healer.dispatch({type:'start'});healer.advance(42);
 const u=healer.getSnapshot().battle!.units[0]!;expect(u.hp).toBe(u.attributes.MaxHp);expect(u.barrier).toBe(u.attributes.MaxHp*.25);
});
