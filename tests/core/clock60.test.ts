import {expect,it} from "vitest";
import raw from "../../data/tower/trial.json";
import {TowerEngine} from "../../src/core/engine";
import {validateConfig} from "../../src/core/config";
import {defaultPlaytestSetup} from "../../src/core/playtest";
import {defaultStrategy,advancePlaytest} from "../../src/core/strategy";
import {STEP} from "../../src/core/math";
import {FixedClock} from "../../src/app/fixed-clock";
const config=validateConfig(raw,{allowUnknownEnemySpecies:true});
function battle(){const e=TowerEngine.createPlaytest(config,{...defaultPlaytestSetup(),autoPlay:true,strategy:defaultStrategy()});e.dispatch({type:"begin"});e.dispatch({type:"start"});return e;}
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
it("60Hz超时仍为300秒，回票仍为8秒，秒数不依赖渲染和历史tick含义",()=>{
 const slow=validateConfig(raw,{allowUnknownEnemySpecies:true});slow.Encounters[0]!.Enemies[0]!.Health=20;
 const e=TowerEngine.createPlaytest(slow,{...defaultPlaytestSetup(),autoPlay:true,strategy:defaultStrategy()});e.dispatch({type:"begin"});e.dispatch({type:"start"});
 e.advance(480);expect(e.getBattleSnapshot()!.tickets).toBe(2);expect(e.getBattleSnapshot()!.seconds).toBe(8);
 const c=validateConfig(raw,{allowUnknownEnemySpecies:true});for(const id of ['hero','princess','slime'])c.Rules.Combatants[id]!.Base.MaxHp=1000000;
 const trial=TowerEngine.createPlaytest(c,defaultPlaytestSetup());trial.dispatch({type:"begin"});trial.dispatch({type:"start"});trial.advance(17999);expect(trial.getBattleSnapshot()!.result).toBe("");trial.advance(1);expect(trial.getBattleSnapshot()).toMatchObject({result:"flee",tick:18000,seconds:300});
},20000);
