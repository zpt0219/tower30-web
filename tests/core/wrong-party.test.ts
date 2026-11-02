import {it,expect} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import prefix from '../fixtures/csharp-thirty-floors.json';
import bad from '../fixtures/csharp-thirty-wrong-party.json';
import {LegacyEngine as TowerEngine} from '../helpers/legacy-engine';
import {validateConfig} from '../../src/core/config';
import {commandSchema} from '../../src/core/model';
it('旧阵容满血仍输30层：正常账本、真实失败、重试只恢复该次战前检查点',()=>{
 const e=new TowerEngine(validateConfig(raw));let floor=0,tick=0;
 const command=(c:unknown)=>expect(e.dispatch(commandSchema.parse(c)).ok).toBe(true);
 for(const s of prefix){if(s.floor===30)break;if(s.floor!==floor){if(floor)command({type:'finish'});floor=s.floor;tick=0;for(const c of s.setupCommands??[])command(c);command({type:'begin'});command({type:'start'});}e.advance(s.tick-tick);tick=s.tick;for(const id of s.commands)command({type:'ultimate',id});for(const id of s.reinforcements)command({type:'reinforce',id});}
 command({type:'finish'});for(const c of bad[0]!.setupCommands??[])command(c);const before=e.getSnapshot();expect(before.members.every(m=>m.hp===m.attributes.MaxHp)).toBe(true);
 command({type:'begin'});command({type:'start'});tick=0;
 for(const s of bad){e.advance(s.tick-tick);tick=s.tick;for(const id of s.commands)command({type:'ultimate',id});for(const id of s.reinforcements)command({type:'reinforce',id});expect(e.getSnapshot().battle!.random).toBe(s.random);}
 expect(e.getSnapshot().battle!.result).toBe('loss');expect(e.getSnapshot().records).toHaveLength(29);expect(e.getSnapshot().completed).toBe(false);expect(e.getSnapshot().gold).toBe(before.gold);expect(e.dispatch({type:'finish'}).ok).toBe(false);
 command({type:'retry'});expect(e.getSnapshot().members).toEqual(before.members);expect(e.getSnapshot().items).toEqual(before.items);expect(e.getSnapshot().gold).toBe(before.gold);
},30000);
