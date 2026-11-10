import {it,expect} from 'vitest';
import raw from '../fixtures/historical-baseline.json';
import save from '../fixtures/v04-nightwing-save.json';
import expected from '../fixtures/v04-nightwing-expected.json';
import {TowerEngine} from '../../src/core/engine';
import {validateConfig} from '../../src/core/config';
it('07ce207/v0.4真实操作存档：追击中的旧位置与随机状态保持，升级后继续存档可重放',()=>{
 const config=validateConfig(raw),e=TowerEngine.restore(config,JSON.stringify(save)),s=e.getSnapshot();
 expect(s.tick).toBe(expected.tick);expect(s.battle!.random).toBe(expected.random);
 for(const old of expected.units){const u=s.battle!.units.find(u=>u.id===old.id)!;expect(u.hp,old.id).toBe(old.hp);expect(u.energy,old.id).toBeCloseTo(old.energy,7);expect(u.x,old.id).toBeCloseTo(old.x,7);expect(u.z,old.id).toBeCloseTo(old.z,7);}
 const migrated=JSON.parse(e.serialize()) as {engineVersion:string;legacyRulesThroughTick:number};expect(migrated.engineVersion).toBe('tower30-ts-m3-v1');expect(migrated.legacyRulesThroughTick).toBe(expected.tick);
 e.advance(30);const restored=TowerEngine.restore(config,e.serialize());e.advance(20);restored.advance(20);expect(e.getSnapshot()).toEqual(restored.getSnapshot());
 expect(()=>TowerEngine.restore(config,JSON.stringify({...migrated,legacyRulesThroughTick:200000}))).toThrow();
});
