import { z } from "zod";
import { validateConfig, type Config } from "./config";
import { TowerEngine } from "./engine";
import { clone, STEP } from "./math";
import type { State } from "./model";
import { playtestSetupSchema, playtestWarnings, type PlaytestSetup } from "./playtest";

export const simulationOptionsSchema = z.object({
  count: z.number().int().min(1).max(100),
  policy: z.enum(["adaptive", "no-ultimates"]),
  reinforce: z.boolean(),
}).strict();
export type SimulationOptions = z.infer<typeof simulationOptionsSchema>;
export const simulationFloorsSchema=z.array(z.number().int().min(1).max(30)).min(1).max(30)
  .refine(floors=>new Set(floors).size===floors.length,"测试关卡不可重复");
export const SIMULATION_POLICY_VERSION = "tower30-policy-v1";
export interface SimulationTrial {
  seed: number;
  result: "victory" | "loss" | "flee";
  ticks: number;
  fallen: number;
  hpRemaining: number;
  hpInitial: number;
  reinforcements: number;
  ultimates: number;
  energySpent: number;
  energyGained: number;
  damage: number;
  healing: number;
  absorbed: number;
  replay: { tick: number; journal: State["journal"] };
}
export interface SimulationPair { a: SimulationTrial; b: SimulationTrial; floor?:number }
export interface SimulationReport {
  format: "tower30-comparison";
  schemaVersion: 1 | 2;
  floors?:number[];
  floorWarnings?:{floor:number;a:string[];b:string[]}[];
  engineVersion: "tower30-ts-workbench-v4" | "tower30-ts-workbench-v5";
  policyVersion: typeof SIMULATION_POLICY_VERSION;
  setup: PlaytestSetup;
  options: SimulationOptions;
  a: { config: Config; hash: string; label: string; warnings: string[] };
  b: { config: Config; hash: string; label: string; warnings: string[] };
  pairs: SimulationPair[];
  status: "running" | "complete" | "cancelled" | "error";
}

export function simulationSeed(first: number, index: number) {
  if (!Number.isInteger(first) || first < 1 || first > 0xffffffff || !Number.isInteger(index) || index < 0 || index >= 100)
    throw new Error("批量种子范围无效");
  return ((first - 1 + index) % 0xffffffff) + 1;
}
export function createSimulationReport(a: unknown, b: unknown, setup: PlaytestSetup, options: SimulationOptions, label = "保存的配置", floors?:readonly number[]) : SimulationReport {
  const checkedSetup = playtestSetupSchema.parse(setup), checkedOptions = simulationOptionsSchema.parse(options);
  const selected=floors===undefined?[checkedSetup.floor]:simulationFloorsSchema.parse(floors).sort((a,b)=>a-b);
  const floorWarnings=selected.map(floor=>({floor,a:[] as string[],b:[] as string[]}));
  const candidate = (source: unknown, name: string,variant:"a"|"b") => {
    const config = validateConfig(source);
    let hash="";
    const warnings:string[]=[];
    // Validate every selected floor before any trial; never validate an unrelated current Play floor.
    for(const entry of floorWarnings){
      const input={...checkedSetup,floor:entry.floor};
      try{
        const engine=TowerEngine.createPlaytest(config,input);hash=engine.configHash;
        for(const type of ["begin","start"] as const){const result=engine.dispatch({type});if(!result.ok)throw new Error(result.message);}
      }
      catch(e){throw new Error(`${variant.toUpperCase()} 第${entry.floor}关：${e instanceof Error?e.message:"配置无效"}`);}
      entry[variant]=playtestWarnings(config,input);
      warnings.push(...entry[variant].map(w=>selected.length>1?`第${entry.floor}关：${w}`:w));
    }
    return { config, hash, label: name, warnings };
  };
  const report:SimulationReport={ format: "tower30-comparison", schemaVersion: floors===undefined?1:2, engineVersion: "tower30-ts-workbench-v5", policyVersion: SIMULATION_POLICY_VERSION,
    setup: clone(checkedSetup), options: checkedOptions, a: candidate(a,label,"a"), b: candidate(b,"当前草稿","b"), pairs: [], status: "running" };
  if(floors!==undefined){report.floors=selected;report.floorWarnings=floorWarnings;}
  return report;
}
export function reportFloors(report:SimulationReport):number[]{
  if(report.schemaVersion===1)return [report.setup.floor];
  if(report.schemaVersion!==2)throw new Error("不支持的批测报告版本");
  return simulationFloorsSchema.parse(report.floors);
}
export const simulationTotal=(report:SimulationReport)=>reportFloors(report).length*report.options.count;
export function simulationJob(report:SimulationReport,index:number){
  const floors=reportFloors(report);
  if(!Number.isInteger(index)||index<0||index>=simulationTotal(report))throw new Error("模拟序号超出范围");
  // Round-robin floors for each seed keeps partial/cancelled runs balanced across floors.
  return {floor:floors[index%floors.length]!,seed:simulationSeed(report.setup.seed,Math.floor(index/floors.length))};
}

// A command controller, not a second combat implementation. Every decision is submitted to TowerEngine.
// Healing ultimates wait for a living ally below 65%; interrupts wait for an enemy charge.
const healingUltimates = new Set(["renew", "forest_rest", "holy_prayer", "forest_sanctuary"]);
export function simulateBattle(config: Config, input: PlaytestSetup, options: SimulationOptions): SimulationTrial {
  const policy = simulationOptionsSchema.parse(options), engine = TowerEngine.createPlaytest(config,input);
  const initial = engine.getSnapshot();
  const checked = (type: "begin" | "start") => { const r = engine.dispatch({type}); if(!r.ok)throw new Error(r.message); };
  checked("begin"); checked("start");
  let reinforcements = 0;
  for (let tick = 0; tick < 6000; tick++) {
    const battle = engine.getBattleSnapshot()!;
    if(battle.result)break;
    if(policy.policy === "adaptive") {
      for(const u of battle.units.filter(u=>!u.enemy && u.hp>0 && u.entry<=0 && u.energy>=1000)) {
        if(healingUltimates.has(u.profile.Ultimate) && !battle.units.some(v=>!v.enemy && v.hp>0 && v.hp < v.attributes.MaxHp*.65))continue;
        if(u.profile.Ultimate==="interrupt" && !battle.units.some(v=>v.enemy && v.hp>0 && v.charge>0))continue;
        engine.dispatch({type:"ultimate",id:u.id});
      }
    }
    if(policy.reinforce && battle.tickets>0 && battle.units.filter(u=>!u.enemy && u.hp>0).length<10) {
      for(const m of initial.members.filter(m=>!["hero","princess"].includes(m.id) && !battle.units.some(u=>u.id===m.id))) {
        if(engine.dispatch({type:"reinforce",id:m.id}).ok){reinforcements++;break;}
      }
    }
    engine.advance(1);
  }
  const final = engine.getSnapshot(), battle = final.battle!;
  if(!battle.result)throw new Error("模拟未得到终局");
  const units = battle.units.filter(u=>!u.enemy);
  const sum = (key: "ultimates" | "damage" | "healing" | "absorbed" | "attackEnergy" | "hurtEnergy" | "killEnergy") => units.reduce((s,u)=>s+u[key],0);
  const record = JSON.parse(engine.serialize()) as { tick: number; journal: State["journal"] };
  return { seed: input.seed, result: battle.result, ticks: battle.tick, fallen: units.filter(u=>u.hp<=0).length,
    hpInitial: initial.members.reduce((s,m)=>s+m.hp,0),
    // Include unused reserves at their real initial health; no reward or healing is applied.
    hpRemaining: initial.members.reduce((s,m)=>s+(units.find(u=>u.id===m.id)?.hp??m.hp),0),
    reinforcements, ultimates:sum("ultimates"), energySpent:sum("ultimates")*1000,
    energyGained:sum("attackEnergy")+sum("hurtEnergy")+sum("killEnergy"), damage:sum("damage"),healing:sum("healing"),absorbed:sum("absorbed"),
    replay:{tick:record.tick,journal:record.journal} };
}
export function simulatePair(report: SimulationReport, index: number): SimulationPair {
  const job=simulationJob(report,index),setup={...report.setup,...job};
  const pair:SimulationPair={a:simulateBattle(report.a.config,setup,report.options),b:simulateBattle(report.b.config,setup,report.options)};
  if(report.schemaVersion===2)pair.floor=job.floor;
  return pair;
}
export function summarizeTrials(rows: readonly SimulationTrial[]) {
  const n=rows.length, wins=rows.filter(r=>r.result==="victory"), total=(key:"ticks"|"fallen"|"reinforcements"|"energySpent"|"energyGained"|"hpRemaining"|"hpInitial"|"damage"|"healing"|"absorbed")=>rows.reduce((s,r)=>s+r[key],0);
  return {count:n,wins:wins.length,losses:rows.filter(r=>r.result==="loss").length,timeouts:rows.filter(r=>r.result==="flee").length,
    winRate:n?wins.length/n:null,seconds:n?total("ticks")*STEP/n:null,
    victorySeconds:wins.length?wins.reduce((s,r)=>s+r.ticks,0)*STEP/wins.length:null,
    fallen:n?total("fallen")/n:null,reinforcements:n?total("reinforcements")/n:null,
    energySpent:n?total("energySpent")/n:null,energyGained:n?total("energyGained")/n:null,
    hpRemaining:total("hpInitial")?total("hpRemaining")/total("hpInitial"):null,
    damage:n?total("damage")/n:null,healing:n?total("healing")/n:null,absorbed:n?total("absorbed")/n:null};
}
export function summarizePairs(pairs: readonly SimulationPair[]) {
  return {aOnly:pairs.filter(p=>p.a.result==="victory" && p.b.result!=="victory").length,
    bOnly:pairs.filter(p=>p.b.result==="victory" && p.a.result!=="victory").length,
    both:pairs.filter(p=>p.a.result==="victory" && p.b.result==="victory").length,
    neither:pairs.filter(p=>p.a.result!=="victory" && p.b.result!=="victory").length};
}
export function trialSave(report: SimulationReport, variant: "a"|"b", index: number) {
  const trial=report.pairs[index]?.[variant];if(!trial)throw new Error("模拟样本不存在");
  const job=simulationJob(report,index);
  if(trial.seed!==job.seed||report.schemaVersion===2&&report.pairs[index]!.floor!==job.floor)throw new Error("样本关卡或种子与任务不符");
  return {format:"tower30-playtest",schemaVersion:1,engineVersion:report.engineVersion,config:report[variant].config,
    configHash:report[variant].hash,setup:{...report.setup,...job},...trial.replay};
}
export function summarizeFloors(report:SimulationReport){
  return reportFloors(report).map(floor=>{
    const pairs=report.pairs.filter(p=>(p.floor??report.setup.floor)===floor);
    return {floor,completed:pairs.length,requested:report.options.count,a:summarizeTrials(pairs.map(p=>p.a)),b:summarizeTrials(pairs.map(p=>p.b)),paired:summarizePairs(pairs)};
  });
}
