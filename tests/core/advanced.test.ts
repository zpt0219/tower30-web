import {it,expect} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import {attributesSchema,validateConfig} from '../../src/core/config';
import {LegacyEngine as TowerEngine} from '../helpers/legacy-engine';
import {defaultPlaytestSetup} from '../../src/core/playtest';
function scene(auto='swift',enemyAuto=''){
 const c=validateConfig(raw);
 for(const id of ['hero','boar']){
  const d=c.Rules.Combatants[id]!;d.Base={...attributesSchema.parse({}),MaxHp:100000,Attack:100,Magic:100};d.Growth=attributesSchema.parse({});d.MoveSpeed=.1;d.AttackRange=.1;d.WindupRatio=.8;
  c.Rules.Profiles[id]!.Auto=id==='hero'?auto:enemyAuto;c.Rules.Profiles[id]!.Cooldown=30;c.Rules.Profiles[id]!.Interval=5;
 }
 const weapon=c.Rules.Equipment.find(g=>g.Id==='traveler_sword')!;weapon.Auto=auto;weapon.Attributes=attributesSchema.parse({});
 c.Encounters[0]!.Enemies=[{...c.Encounters[0]!.Enemies[0]!,Species:'boar',Health:1,Rank:1}];
 for(const id of [auto,enemyAuto].filter(Boolean)){const r=c.Rules.Actions[id]!;r.Range=30;r.Windup=id===auto?.6:0;r.Ratios=[1];r.Bases=[0];r.Delivery='instant';}
 return c;
}
function start(c:ReturnType<typeof scene>,party=['hero'],rank=1,energy=0){
 const e=TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party,rank,hpPercent:50,energy,skillPolicy:'strict'});
 expect(e.dispatch({type:'begin'}).ok).toBe(true);expect(e.dispatch({type:'start'}).ok).toBe(true);e.advance(8);return e;
}
it('物理/法术防护只减对应类型伤害，常驻防护与临时防护取较强者',()=>{
 for(const [attack,guard,expected] of [['swift','hard_shell',55],['firebolt','hard_shell',100],['swift','spirit_armor',100],['firebolt','spirit_armor',55]] as const){
  const c=scene(attack,guard),e=start(c);e.advance(45);expect(e.getSnapshot().battle!.units[0]!.damage,`${attack}/${guard}`).toBe(expected);
 }
 const c=scene();c.Encounters[0]!.Enemies[0]!.Rank=3;c.Rules.Profiles.boar!.PassiveEffect='physical_guard';const e=start(c);e.advance(45);expect(e.getSnapshot().battle!.units[0]!.damage).toBe(88);
});
it('弱化在发射时冻结，弹道命中前到期也保留该次减伤；实际吸血随实际伤害结算',()=>{
 const c=scene('firebolt','curse');c.Rules.Combatants.boar!.Base.Magic=1;c.Rules.Combatants.hero!.Base.Lifesteal=.6;
 const bolt=c.Rules.Actions.firebolt!;bolt.Windup=.2;bolt.Delivery='projectile';c.Rules.Actions.curse!.Duration=.4;
 const e=start(c);e.advance(40);const middle=e.getSnapshot().battle!;
 expect(middle.projectiles).toHaveLength(1);expect(middle.projectiles[0]!.weaken).toBeGreaterThan(0);expect(middle.units[0]!.weaken).toBe(0);
 const restored=TowerEngine.restorePlaytest(e.serialize());e.advance(25);restored.advance(25);
 const u=e.getSnapshot().battle!.units[0]!;expect(u.damage).toBe(75);expect(u.healing).toBe(45);expect(restored.getSnapshot()).toEqual(e.getSnapshot());
});
it('沉默取消自动技能，持续时间受韧性缩短，普攻仍可执行',()=>{
 const c=scene('','firebolt');c.Rules.Profiles.hero!.Ultimate='silence';c.Rules.Actions.silence!.Range=30;c.Rules.Actions.silence!.Windup=0;c.Rules.Actions.firebolt!.Windup=2;c.Rules.Combatants.boar!.Base.Tenacity=.4;
 const e=start(c,['hero'],1,1000);
 while(!e.getSnapshot().battle!.units[1]!.action)e.advance(1);
 expect(e.getSnapshot().battle!.units[1]!.action!.kind).toBe('auto');expect(e.dispatch({type:'ultimate',id:'hero'}).ok).toBe(true);e.advance(1);
 const u=e.getSnapshot().battle!.units[1]!;expect(u.silence).toBeCloseTo(3*.6-.05,7);expect(u.action).toBeNull();expect(u.interrupts).toBe(1);
});
it('沉默不会取消标记为不可打断的大招',()=>{
 const c=scene();c.Rules.Profiles.hero!.Ultimate='silence';c.Rules.Profiles.hero!.Auto='';c.Rules.Equipment.find(g=>g.Id==='traveler_sword')!.Auto='';c.Rules.Combatants.hero!.Base.MaxHp=1000000;
 c.Rules.Profiles.boar!.Ultimate='armor_front';c.Rules.Profiles.boar!.Interval=.4;c.Rules.Combatants.boar!.WindupRatio=.1;c.Rules.Combatants.boar!.MoveSpeed=20;c.Rules.Combatants.boar!.AttackRange=10;c.Rules.Combatants.boar!.Base.EnergyRegen=1;
 c.Rules.Actions.armor_front!.Windup=2;c.Rules.Actions.silence!.Range=30;c.Rules.Actions.silence!.Windup=0;
 const e=start(c,['hero'],1,1000);for(let i=0;i<400&&e.getSnapshot().battle!.units[1]!.action?.kind!=='ultimate';i++)e.advance(1);
 expect(e.getSnapshot().battle!.units[1]!.action!.kind).toBe('ultimate');expect(e.dispatch({type:'ultimate',id:'hero'}).ok).toBe(true);e.advance(1);
 expect(e.getSnapshot().battle!.units[1]!.silence).toBeGreaterThan(0);expect(e.getSnapshot().battle!.units[1]!.action!.kind).toBe('ultimate');e.advance(45);expect(e.getSnapshot().battle!.units[1]!.physicalGuard).toBeGreaterThan(0);
});
it('双段攻击独立判闪避/暴击，整次动作按源端状态回退规则处理护盾',()=>{
 const c=scene('doublecut','aegis');c.Rules.Combatants.boar!.Base.DodgeRate=.4;
 const e=start(c);e.advance(45);const b=e.getSnapshot().battle!,target=b.units[1]!;
 expect(target.dodges).toBe(1);expect(b.units[0]!.damage).toBe(10);expect(target.barrier).toBeCloseTo(90);expect(target.absorbed).toBe(90);
 const attacks=e.getSnapshot().events.filter(e=>e.kind==='hit'||e.kind==='dodge');expect(attacks.map(e=>e.kind)).toEqual(['dodge','hit']);expect(attacks[0]!.actionId).toBe(attacks[1]!.actionId);
});
it('连击在普攻命中同一目标后累积；自疗被动同时影响苔衣与持续回复',()=>{
 const c=scene();c.Rules.Profiles.blade_skeleton!.Auto='';c.Rules.Profiles.blade_skeleton!.Interval=.4;
 c.Rules.Combatants.blade_skeleton={...c.Rules.Combatants.hero!,Base:{...c.Rules.Combatants.hero!.Base},AttackRange:10,MoveSpeed:20,WindupRatio:.1,BasicDamageType:'physical',ProjectileFamily:''};
 const e=start(c,['blade_skeleton'],3);for(let i=0;i<300&&e.getSnapshot().battle!.units[0]!.comboHits<3;i++)e.advance(1);e.advance(12);
 expect(e.getSnapshot().events.filter(e=>e.kind==='hit'&&e.actor==='blade_skeleton').slice(0,4).map(e=>-e.amount)).toEqual([100,106,112,118]);
 const heals=[],regeneration=[];for(const rank of [1,3]){const h=scene();h.Rules.Combatants.moss_crawler={...h.Rules.Combatants.hero!,Base:{...h.Rules.Combatants.hero!.Base}};h.Rules.Actions.mossheal!.Ratios=[1,1,1];h.Rules.Actions.mossheal!.Windup=0;h.Rules.Profiles.moss_crawler!.Cooldown=30;const healer=start(h,['moss_crawler'],rank);healer.advance(35);heals.push(healer.getSnapshot().battle!.units[0]!.healing);healer.advance(20);regeneration.push(healer.getSnapshot().battle!.units[0]!.healing);}
 expect(heals).toEqual([100,115]);expect(regeneration).toEqual([125,144]);
});
it('扎根只限制移动，施法与自疗可执行，到期后恢复移动',()=>{
 const c=scene();c.Rules.Combatants.moss_crawler={...c.Rules.Combatants.hero!,Base:{...c.Rules.Combatants.hero!.Base,Tenacity:.4},MoveSpeed:20};
 c.Rules.Actions.rooted_guard!.Windup=0;c.Rules.Actions.rooted_guard!.Duration=2;c.Rules.Actions.rooted_guard!.Range=30;
 const e=start(c,['moss_crawler'],3,1000);expect(e.dispatch({type:'ultimate',id:'moss_crawler'}).ok).toBe(true);e.advance(1);
 const u=e.getSnapshot().battle!.units[0]!;expect(u.root).toBeCloseTo(1.2);expect(u.healing).toBeGreaterThan(0);e.advance(10);
 expect(e.getSnapshot().battle!.units[0]!.x).toBe(u.x);e.advance(55);expect(e.getSnapshot().battle!.units[0]!.root).toBe(0);expect(e.getSnapshot().battle!.units[0]!.x).not.toBe(u.x);
});
it('汲血与夜翼被动统一受吸血上限约束，邪眼对受控目标追加伤害',()=>{
 const c=scene('leech');c.Rules.Combatants.nightwing={...c.Rules.Combatants.hero!,Base:{...c.Rules.Combatants.hero!.Base}};c.Rules.Actions.leech!.Ratios=[1,1,1];
 const leech=start(c,['nightwing'],3);leech.advance(45);expect(leech.getSnapshot().battle!.units[0]!.attributes.Lifesteal).toBe(.05);expect(leech.getSnapshot().battle!.units[0]!.healing).toBe(60);
 const eye=scene('eye_ray');eye.Rules.Combatants.evil_eye={...eye.Rules.Combatants.hero!,Base:{...eye.Rules.Combatants.hero!.Base}};eye.Rules.Combatants.ice_spirit={...eye.Rules.Combatants.hero!,Base:{...eye.Rules.Combatants.hero!.Base}};
 eye.Rules.Actions.eye_ray!.Ratios=[1,1,1];eye.Rules.Actions.ice_domain!.Range=30;eye.Rules.Actions.ice_domain!.Windup=0;eye.Rules.Profiles.ice_spirit!.Auto='';
 const e=start(eye,['evil_eye','ice_spirit'],3,1000);while(!e.getSnapshot().battle!.units.find(u=>u.id==='evil_eye')!.action)e.advance(1);
 expect(e.dispatch({type:'ultimate',id:'ice_spirit'}).ok).toBe(true);e.advance(13);expect(e.getSnapshot().battle!.units.find(u=>u.id==='evil_eye')!.damage).toBe(112);
});
