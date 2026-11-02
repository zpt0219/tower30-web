import {expect,it} from "vitest";
import raw from "../../data/tower/thirty-floor-trial.json";
import {TowerEngine} from "../../src/core/engine";
import {validateConfig} from "../../src/core/config";
import {defaultPlaytestSetup} from "../../src/core/playtest";
import {defaultStrategy,advancePlaytest} from "../../src/core/strategy";
import {STEP} from "../../src/core/math";
import {FixedClock} from "../../src/app/fixed-clock";
const config=validateConfig(raw);
function battle(hz:20|60=60){const e=TowerEngine.createPlaytest(config,{...defaultPlaytestSetup(),autoPlay:true,strategy:defaultStrategy()},hz);e.dispatch({type:"begin"});e.dispatch({type:"start"});return e;}
it("30/60/120FPS均推进60个固定逻辑tick，4倍速只改变步数，动画调度不进入核心",()=>{
 let expected:ReturnType<TowerEngine['getSnapshot']>|undefined;
 for(const fps of [30,60,120]){
  const e=battle(),clock=new FixedClock();for(let i=0;i<fps;i++){clock.add(1/fps);advancePlaytest(e,clock.take());}
  expect(e.getSnapshot().tick).toBe(60);expect(e.getBattleSnapshot()!.seconds).toBe(1);expect(e.stepSeconds).toBe(STEP);
  if(expected)expect(e.getSnapshot()).toEqual(expected);else expected=e.getSnapshot();
 }
 const fast=battle(),clock=new FixedClock();for(let i=0;i<30;i++){clock.add(1/30,4);advancePlaytest(fast,clock.take());}expect(fast.getSnapshot().tick).toBe(240);
});
it("帧预算不足保留逻辑债务，补齐后状态一致；非法时间拒绝，暂停重置无跨后台突跳",()=>{
 const c=new FixedClock();c.add(.2,4);expect(c.take()).toBe(24);expect(c.pendingSeconds).toBeCloseTo(.4);expect(c.alpha).toBe(1);expect(c.take()).toBe(24);expect(c.pendingSeconds).toBeCloseTo(0);c.add(.1);c.reset();expect(c.take()).toBe(0);
 expect(()=>c.add(-1)).toThrow();expect(()=>c.add(Infinity)).toThrow();
});
it("旧战中存档保持20Hz原轨迹，显式切60Hz后保存切换点，重放和继续推进完全一致",()=>{
 const old=battle(20);old.advance(40);const raw=old.serialize(),e=TowerEngine.restorePlaytest(raw);
 expect(e.logicHz).toBe(20);expect(e.getSnapshot()).toEqual(old.getSnapshot());e.upgradeTo60Hz();expect(e.logicHz).toBe(60);expect(e.getBattleSnapshot()!.seconds).toBe(2);
 e.advance(60);expect(e.getBattleSnapshot()!.seconds).toBe(3);const save=JSON.parse(e.serialize());expect(save.engineVersion).toBe("tower30-ts-workbench-v7");expect(save.legacy20ThroughTick).toBe(40);
 const resumed=TowerEngine.restorePlaytest(e.serialize());expect(resumed.getSnapshot()).toEqual(e.getSnapshot());advancePlaytest(e,100);advancePlaytest(resumed,100);expect(resumed.serialize()).toBe(e.serialize());
 expect(()=>TowerEngine.restorePlaytest(JSON.stringify({...save,legacy20ThroughTick:save.tick+1}))).toThrow();expect(()=>TowerEngine.restorePlaytest(JSON.stringify({...save,legacy20ThroughTick:undefined}))).toThrow();
 const normal=new TowerEngine(config,1,20);normal.dispatch({type:"begin"});normal.dispatch({type:"start"});normal.advance(50);const migrated=TowerEngine.restore(config,normal.serialize()).upgradeTo60Hz();migrated.advance(70);expect(TowerEngine.restore(config,migrated.serialize()).getSnapshot()).toEqual(migrated.getSnapshot());
});
it("60Hz超时仍为300秒，回票仍为8秒，秒数不依赖渲染和历史tick含义",()=>{
 const e=battle();e.advance(480);expect(e.getBattleSnapshot()!.tickets).toBe(2);expect(e.getBattleSnapshot()!.seconds).toBe(8);
 const c=validateConfig(raw);for(const id of ['hero','princess','slime_dusk'])c.Rules.Combatants[id]!.Base.MaxHp=1000000;
 const trial=TowerEngine.createPlaytest(c,defaultPlaytestSetup());trial.dispatch({type:"begin"});trial.dispatch({type:"start"});trial.advance(17999);expect(trial.getBattleSnapshot()!.result).toBe("");trial.advance(1);expect(trial.getBattleSnapshot()).toMatchObject({result:"flee",tick:18000,seconds:300});
},20000);
