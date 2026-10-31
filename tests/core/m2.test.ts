import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import trace from '../fixtures/csharp-ten-floors.json';
import raw from '../../data/tower/thirty-floor-trial.json';
import {validateConfig} from '../../src/core/config';
import {TowerEngine} from '../../src/core/engine';
import {commandSchema} from '../../src/core/model';
it('C#对照：正常预算购买、培养、住宿、补人与手动大招连续通过10层Boss',()=>{
 const e=new TowerEngine(validateConfig(raw));let floor=0,tick=0;
 for(const sample of (process.env.M2_DENSE ? JSON.parse(readFileSync(process.env.M2_DENSE,"utf8")) as typeof trace : trace)){
  if(floor!==sample.floor){if(floor)expect(e.dispatch({type:'finish'}).ok).toBe(true);floor=sample.floor;tick=0;
   for(const c of sample.setupCommands??[])expect(e.dispatch(commandSchema.parse(c)),`F${floor} ${JSON.stringify(c)}`).toMatchObject({ok:true});
   if(floor===10){
    const before=e.getSnapshot();e.dispatch({type:'begin'});e.dispatch({type:'start'});e.advance(60);e.dispatch({type:'withdraw'});expect(e.dispatch({type:'retry'}).ok).toBe(true);
    const after=e.getSnapshot();expect(after.members).toEqual(before.members);expect(after.gold).toBe(before.gold);expect(after.items).toEqual(before.items);expect(after.souls).toEqual(before.souls);expect(after.records).toHaveLength(9);
   }
   expect(e.dispatch({type:'begin'}).ok).toBe(true);expect(e.dispatch({type:'start'}).ok).toBe(true);
  }
  e.advance(sample.tick-tick);tick=sample.tick;
  for(const id of sample.commands)expect(e.dispatch({type:'ultimate',id}),`F${floor} T${tick} ultimate ${id}`).toMatchObject({ok:true});
  for(const id of sample.reinforcements)expect(e.dispatch({type:'reinforce',id}),`F${floor} T${tick} reinforce ${id}`).toMatchObject({ok:true});
  const s=e.getSnapshot(),b=s.battle!;
  expect(b.result,`F${floor} T${tick} result`).toBe(sample.result);

  expect(b.random,`F${floor} T${tick} rng`).toBe(sample.random);
  expect(s.gold).toBe(sample.gold);expect(b.projectiles).toHaveLength(sample.projectiles);
  for(const v of sample.units){const u=b.units.find(u=>u.id===v.Id)!;
   const fields={X:u.x,Z:u.z,Hp:u.hp,Energy:u.energy,DamageDone:u.damage,HealingDone:u.healing,AttackEnergy:u.attackEnergy,HurtEnergy:u.hurtEnergy,KillEnergy:u.killEnergy,ActionWork:u.action?.work??0,RecoveryWork:u.recovery,Cooldown:u.cooldown,Special:u.special,Barrier:u.barrier,Shield:u.shield,Stun:u.stun,ControlGuard:u.controlGuard,ArmorBreak:u.armorBreak,Slow:u.slow,Taunt:u.taunt,Regeneration:u.regeneration,FocusTime:u.focusTime,Leech:u.leech};
   for(const [k,value] of Object.entries(fields))expect(value,`F${floor} T${tick} ${v.Id} ${k}`).toBeCloseTo(v[k as keyof typeof fields],7);
   expect(u.action?.kind??'',`F${floor} T${tick} ${v.Id} action`).toBe(v.ActionKind);
  }
 }
 expect(e.getSnapshot().battle!.result).toBe('victory');expect(e.dispatch({type:'finish'}).ok).toBe(true);
 expect(e.getSnapshot()).toMatchObject({floor:11,shopStage:1,innPrice:50});
 expect(e.getSnapshot().records).toHaveLength(10);
 expect(e.getSnapshot().playableFloors).toBe(20);
 const gold=e.getSnapshot().gold;expect(e.dispatch({type:'finish'}).ok).toBe(false);expect(e.getSnapshot().gold).toBe(gold);
 expect(e.dispatch({type:'buy',id:'gear_iron_armor',quantity:1}).ok).toBe(true);expect(e.getSnapshot().gold).toBe(gold-130);expect(e.dispatch({type:'buy',id:'gear_iron_armor',quantity:1}).ok).toBe(false);
 const restored=TowerEngine.restore(validateConfig(raw),e.serialize());expect(restored.getSnapshot()).toEqual(e.getSnapshot());
},30000);
