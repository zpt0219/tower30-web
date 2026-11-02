import {expect,it} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import {createSession} from '../../src/bridge/session';
import {TowerEngine} from '../../src/core/engine';
import {validateConfig} from '../../src/core/config';
const call=(session:ReturnType<typeof createSession>,request:unknown)=>JSON.parse(session(JSON.stringify(request))) as {ok:boolean;value:any;error?:string};
it('JSON bridge matches direct-core commands, snapshots and battle restore/continuation',()=>{
 const session=createSession(),engine=new TowerEngine(validateConfig(raw));
 expect(call(session,{op:'create',config:raw}).value).toEqual(engine.getSnapshot());
 for(const command of [{type:'begin'},{type:'start'}] as const)expect(call(session,{op:'command',command}).value).toEqual(engine.dispatch(command));
 call(session,{op:'advance',ticks:180});engine.advance(180);
 expect(call(session,{op:'snapshot'}).value).toEqual(engine.getSnapshot());
 const save=call(session,{op:'save'}).value;
 call(session,{op:'advance',ticks:60});
 call(session,{op:'restore',config:raw,save});
 call(session,{op:'advance',ticks:120});engine.advance(120);
 expect(call(session,{op:'snapshot'}).value).toEqual(engine.getSnapshot());
 expect(call(session,{op:'events'}).value).toEqual(engine.takeEvents());
});
it('invalid creation, restore and tick requests leave live state unchanged',()=>{
 const session=createSession();call(session,{op:'create',config:raw});
 const before=call(session,{op:'snapshot'});
 for(const request of [{op:'create',config:{}},{op:'restore',save:'{}',config:raw},{op:'advance',ticks:1.5},{op:'advance',ticks:600001},{op:'advance',ticks:1,delta:1}]){
  expect(call(session,request).ok).toBe(false);expect(call(session,{op:'snapshot'})).toEqual(before);
 }
});
it('host sessions are isolated; disposal rejects further gameplay until explicit create',()=>{
 const a=createSession(),b=createSession();call(a,{op:'create',config:raw,seed:1});call(b,{op:'create',config:raw,seed:2});
 call(a,{op:'command',command:{type:'begin'}});expect(call(b,{op:'snapshot'}).value.battle).toBeNull();
 call(a,{op:'dispose'});expect(call(a,{op:'snapshot'}).ok).toBe(false);expect(call(b,{op:'snapshot'}).ok).toBe(true);
});
it('read-only preparation/shop view projects authoritative enemy attributes and purchase quotes without mutation',()=>{
 const session=createSession();call(session,{op:'create',config:raw});const before=call(session,{op:'save'}).value;
 const view=call(session,{op:'view'}).value;
 expect(view.snapshot.gold).toBe(240);expect(view.floor.number).toBe(1);expect(view.floor.gold).toBe(65);
 expect(view.shop.find((o:{id:string})=>o.id==='gear_break_sword').quote.total).toBe(100);
 expect(call(session,{op:'save'}).value).toBe(before);
 call(session,{op:'command',command:{type:'begin'}});
 const prepared=call(session,{op:'snapshot'}).value;
 expect(prepared.battle.enemies[0].attributes).toEqual(view.floor.enemies[0].attributes);
});
