import {expect,it} from "vitest";
import raw from "../../data/tower/thirty-floor-trial.json";
import {validateConfig} from "../../src/core/config";
import {TowerEngine} from "../../src/core/engine";
import {defaultPlaytestSetup,playtestSetupSchema,type PlaytestSetup} from "../../src/core/playtest";
import {applyStrategy,advancePlaytest,defaultStrategy,strategySchema} from "../../src/core/strategy";
import {createSimulationReport,simulatePair,trialSave,effectiveStrategy} from "../../src/core/simulation";
import {scene} from "../helpers/status-scene";
import {newProject,restoreProject,importProject} from "../../src/editor/project";

function healingScene(){
  const c=scene(raw,"");
  c.Rules.Profiles.hero!.Ultimate="renew";
  c.Rules.Profiles.princess!.Ultimate="renew";
  const r=c.Rules.Actions.renew!;r.Range=30;r.Windup=.2;
  return c;
}
function start(c=healingScene(),extra:Partial<PlaytestSetup>={}){
  const e=TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party:["hero"],energy:1000,hpPercent:50,startingGear:false,...extra});
  for(const type of ["begin","start"] as const)expect(e.dispatch({type}).ok).toBe(true);
  e.advance(8);return e;
}
const commands=(e:TowerEngine)=>JSON.parse(e.serialize()).journal.filter((r:{command:{type:string}})=>r.command.type==="ultimate"||r.command.type==="reinforce");
it("治疗阈值严格低于时触发；立即、禁用和全局大招开关执行真实命令",()=>{
  const s=defaultStrategy(),e=start();s.healingHpPercent=50;applyStrategy(e,s);expect(commands(e)).toHaveLength(0);
  s.healingHpPercent=50.1;applyStrategy(e,s);expect(commands(e).map((r:{command:{id:string}})=>r.command.id)).toEqual(["hero"]);
  for(const disabled of [{...s,healing:"disabled" as const},{...s,ultimates:false},{...s,healingHpPercent:0}]){const off=start();applyStrategy(off,disabled);expect(commands(off)).toHaveLength(0);}
  const full=start(healingScene(),{hpPercent:99});applyStrategy(full,{...s,healing:"immediate"});expect(commands(full)).toHaveLength(1);
});
it("大招优先级改变同tick命令顺序；禁用打断与等待吟唱不凭空出招",()=>{
  const e=start(healingScene(),{party:["hero","princess"]});applyStrategy(e,{...defaultStrategy(),ultimateOrder:["princess","hero"]});
  expect(commands(e).map((r:{command:{id:string}})=>r.command.id)).toEqual(["princess","hero"]);
  const c=healingScene();c.Rules.Profiles.hero!.Ultimate="interrupt";c.Rules.Actions.interrupt!.Range=30;
  for(const mode of ["charging","disabled"] as const){const wait=start(c);applyStrategy(wait,{...defaultStrategy(),interrupt:mode});expect(commands(wait)).toHaveLength(0);}
  const immediate=start(c);applyStrategy(immediate,{...defaultStrategy(),interrupt:"immediate"});expect(commands(immediate)).toHaveLength(1);
});
it("补人顺序改变实际入场成员，遵守补人票与已上场限制",()=>{
  const c=validateConfig(raw),party=["hero","princess","slime_dusk","sproutling","reedwing","boar","skeleton_guard"];
  const a=start(c,{party}),b=start(c,{party});
  expect(applyStrategy(a,{...defaultStrategy(),ultimates:false,reinforcementOrder:["skeleton_guard","boar"]})).toBe(1);
  expect(applyStrategy(b,{...defaultStrategy(),ultimates:false,reinforcementOrder:["boar","skeleton_guard"]})).toBe(1);
  expect(a.getBattleSnapshot()!.units.some(u=>u.id==="skeleton_guard")).toBe(true);expect(b.getBattleSnapshot()!.units.some(u=>u.id==="boar")).toBe(true);
  expect(a.getBattleSnapshot()!.tickets).toBe(0);expect(applyStrategy(a,defaultStrategy())).toBe(0);
  const off=start(c,{party});expect(applyStrategy(off,{...defaultStrategy(),reinforce:false,ultimates:false})).toBe(0);expect(off.getBattleSnapshot()!.tickets).toBe(1);
});
it("Play单tick和批量推进一致，保存中途恢复不重复决策；旧手动Play仍不自动出招",()=>{
  const setup={strategy:{...defaultStrategy(),healing:"immediate" as const},autoPlay:true};
  const a=start(healingScene(),setup),b=start(healingScene(),setup);
  advancePlaytest(a,50);for(let i=0;i<50;i++)advancePlaytest(b,1);expect(a.getSnapshot()).toEqual(b.getSnapshot());
  expect(commands(a)).toHaveLength(1);expect(JSON.parse(a.serialize()).engineVersion).toBe("tower30-ts-workbench-v6");
  const resumed=TowerEngine.restorePlaytest(a.serialize());expect(resumed.getSnapshot()).toEqual(a.getSnapshot());
  advancePlaytest(a,70);advancePlaytest(resumed,70);expect(resumed.serialize()).toBe(a.serialize());
  const manual=start();advancePlaytest(manual,50);expect(commands(manual)).toHaveLength(0);expect(JSON.parse(manual.serialize()).engineVersion).toBe("tower30-ts-workbench-v5");
  expect(()=>advancePlaytest(a,-1)).toThrow();
});
it("同属性A/B使用独立冻结策略，批测与策略Play终局/命令完全一致，旧报告仍可重放",()=>{
  const c=healingScene(),setup={...defaultPlaytestSetup(),party:["hero"],energy:1000,hpPercent:50,startingGear:false};
  const a={...defaultStrategy(),ultimates:false},b={...defaultStrategy(),healing:"immediate" as const};
  const report=createSimulationReport(c,c,setup,{count:1,policy:"adaptive",reinforce:true},"A",[1],{a,b});
  b.ultimates=false;expect(report.schemaVersion).toBe(3);expect(report.policyVersion).toBe("tower30-policy-v2");
  expect(report.a.hash).toBe(report.b.hash);report.pairs.push(simulatePair(report,0));expect(report.pairs[0]!.a.ultimates).toBe(0);expect(report.pairs[0]!.b.ultimates).toBeGreaterThan(0);
  const record=trialSave(report,"b",0),play=TowerEngine.createPlaytest(c,record.setup);play.dispatch({type:"begin"});play.dispatch({type:"start"});advancePlaytest(play,6000);
  expect(JSON.parse(play.serialize()).journal).toEqual(record.journal);expect(TowerEngine.restorePlaytest(JSON.stringify(record)).getSnapshot()).toEqual(play.getSnapshot());
  report.options.policy="no-ultimates";report.options.reinforce=false;expect(effectiveStrategy(report,"b")).toMatchObject({ultimates:false,reinforce:false});
},15000);
it("非法阈值、重复顺序与阵容外引用被拒绝；草稿可保留越界值供修复，旧工程缺省策略",()=>{
  expect(()=>strategySchema.parse({...defaultStrategy(),healingHpPercent:101})).toThrow();expect(()=>strategySchema.parse({...defaultStrategy(),ultimateOrder:["hero","hero"]})).toThrow();
  const setup={...defaultPlaytestSetup(),strategy:{...defaultStrategy(),ultimateOrder:["boar"]}};expect(()=>playtestSetupSchema.parse(setup)).toThrow(/当前阵容/);
  const project=newProject(raw);project.setup.strategy={...defaultStrategy(),healingHpPercent:101};expect(restoreProject(JSON.stringify(project)).setup.strategy!.healingHpPercent).toBe(101);expect(()=>importProject(JSON.stringify(project))).toThrow();
  expect(importProject(JSON.stringify(newProject(raw))).setup.strategy).toBeUndefined();
});

it("自定义治疗类技能作为大招时也遵守阈值；旧v1策略保留原四技能分类",()=>{
  const c=healingScene();c.Rules.Profiles.hero!.Ultimate="heal";c.Rules.Actions.heal!.Range=30;
  const s={...defaultStrategy(),healingHpPercent:0},newPolicy=start(c),legacy=start(c);
  applyStrategy(newPolicy,s);expect(commands(newPolicy)).toHaveLength(0);
  applyStrategy(legacy,s,true);expect(commands(legacy)).toHaveLength(1);
});
