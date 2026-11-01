import {it,expect} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import {validateConfig} from '../../src/core/config';
import {TowerEngine} from '../../src/core/engine';
import {defaultPlaytestSetup,playtestWarnings} from '../../src/core/playtest';
it('42角色、40物种的正式配置均能完整Play，已有技能与被动不被数值模式停用',()=>{
 const c=validateConfig(raw);c.Encounters[0]!.Enemies=[{...c.Encounters[0]!.Enemies[0]!,Health:30,AttackScale:.01}];c.Rules.Profiles.slime_dusk!.Auto='';
 for(const id of Object.keys(c.Rules.Combatants)){
  const setup={...defaultPlaytestSetup(),party:[id],level:5,rank:5,hpPercent:50,energy:1000,skillPolicy:'strict' as const};
  expect(playtestWarnings(c,setup),id).toEqual([]);const e=TowerEngine.createPlaytest(c,setup);expect(e.dispatch({type:'begin'}).ok).toBe(true);expect(e.dispatch({type:'start'}).ok).toBe(true);
  let cast=false;for(let i=0;i<120;i++){e.advance(5);if(!cast)cast=e.dispatch({type:'ultimate',id}).ok;}
  const s=e.getSnapshot();expect(cast,id+' ultimate').toBe(true);expect(s.skippedFeatures).toEqual([]);expect(s.battle!.units[0]!.ultimates,id).toBe(1);expect(s.mode).toBe('playtest');expect(s.records).toEqual([]);
 }
},30000);
