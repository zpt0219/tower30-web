import {validateConfig,attributesSchema} from "../../src/core/config";
import {LegacyEngine as TowerEngine} from "./legacy-engine";
import {defaultPlaytestSetup} from "../../src/core/playtest";
export function scene(raw:unknown,auto:string,enemyAuto=''){
 const c=validateConfig(raw);
 for(const id of ['hero','boar']){const d=c.Rules.Combatants[id]!;d.Base={...attributesSchema.parse({}),MaxHp:100000,Attack:100,Magic:100};d.Growth=attributesSchema.parse({});d.MoveSpeed=.1;d.AttackRange=.1;d.WindupRatio=.8;c.Rules.Profiles[id]!.Auto=id==='hero'?auto:enemyAuto;c.Rules.Profiles[id]!.Cooldown=30;c.Rules.Profiles[id]!.Interval=5;}
 const w=c.Rules.Equipment.find(g=>g.Id==='traveler_sword')!;w.Auto=auto;w.Attributes=attributesSchema.parse({});
 c.Encounters[0]!.Enemies=[{...c.Encounters[0]!.Enemies[0]!,Species:'boar',Health:1,Rank:1}];
 for(const id of [auto,enemyAuto].filter(Boolean)){const r=c.Rules.Actions[id]!;r.Range=30;r.Windup=0;r.Ratios=[1];r.Bases=[0];r.Delivery='instant';}
 return c;
}
export function start(c:ReturnType<typeof scene>,party=['hero'],rank=1,energy=0,hpPercent=50){const e=TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party,rank,energy,hpPercent,skillPolicy:'strict'});e.dispatch({type:'begin'});e.dispatch({type:'start'});e.advance(8);return e;}
