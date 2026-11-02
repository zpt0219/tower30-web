import {expect,it} from 'vitest';
import raw from '../../data/tower/thirty-floor-trial.json';
import {createSession} from '../../src/bridge/session';
import {inspectProject,createProjectTrial,parseProjectText} from '../../src/core/project';
import {validateConfig} from '../../src/core/config';
import {newProject} from '../../src/editor/project';
import {advancePlaytest,defaultStrategy} from '../../src/core/strategy';
const request=(s:ReturnType<typeof createSession>,r:unknown)=>JSON.parse(s(JSON.stringify(r))) as {ok:boolean;value:any;error?:string};
const project=()=>{const p=newProject(raw);p.setup={...p.setup,seed:123456,autoPlay:true,strategy:defaultStrategy()};return p;};
it('project identity freezes config and setup, includes seed and strategy, ignores raw legacy unused source fields',()=>{
 const p=project(),inspected=inspectProject(p);(p.source as Record<string,unknown>).authoringNote='不影响玩法的源字段';expect(inspectProject(p).info).toEqual(inspected.info);p.setup.seed=888;expect(inspected.project.setup.seed).toBe(123456);expect(inspectProject(p).info.launchHash).not.toBe(inspected.info.launchHash);expect(inspectProject(p).info.configHash).toBe(inspected.info.configHash);
 p.setup.seed=123456;p.setup.strategy!.healingHpPercent=40;expect(inspectProject(p).info.launchHash).not.toBe(inspected.info.launchHash);
 expect(parseProjectText(JSON.stringify(inspected.project)).info).toEqual(inspected.info);
 expect(()=>parseProjectText(' '.repeat(2000001))).toThrow('2MB');
});
it('bridge imports playable editor project and uses exactly the same automatic strategy as direct core',()=>{
 const p=project(),s=createSession(),direct=createProjectTrial(p).engine;
 expect(request(s,{op:'play-project',project:p}).value.snapshot).toEqual(direct.getSnapshot());
 request(s,{op:'advance',ticks:180});advancePlaytest(direct,180);expect(request(s,{op:'snapshot'}).value).toEqual(direct.getSnapshot());
 const save=request(s,{op:'save'}).value;expect(request(s,{op:'restore-project',project:p,save}).ok).toBe(true);
 request(s,{op:'advance',ticks:60});advancePlaytest(direct,60);expect(request(s,{op:'snapshot'}).value).toEqual(direct.getSnapshot());
});
it('preview, invalid import, failed spawn and mismatched record cannot replace a live session',()=>{
 const p=project(),s=createSession();request(s,{op:'play-project',project:p});request(s,{op:'advance',ticks:20});const before=request(s,{op:'save'}).value;
 expect(request(s,{op:'inspect-project',project:p}).ok).toBe(true);expect(request(s,{op:'save'}).value).toBe(before);
 for(const invalid of [{...p,schemaVersion:2},{...p,setup:{...p.setup,seed:0}},{...p,source:{}}]){expect(request(s,{op:'play-project',project:invalid}).ok).toBe(false);expect(request(s,{op:'save'}).value).toBe(before);}
 const other=project();other.setup.seed=44;expect(request(s,{op:'restore-project',project:other,save:before}).ok).toBe(false);expect(request(s,{op:'save'}).value).toBe(before);
 // Valid attributes but impossible opening placement must fail transactionally at start.
 const giant=project();const source=validateConfig(giant.source);giant.source=source;giant.setup.party=['hero','princess','slime_dusk','sproutling','boar'];for(const id of giant.setup.party)source.Rules.Combatants[id]!.Radius=3;
 const result=request(s,{op:'play-project',project:giant});expect(result.ok).toBe(false);expect(request(s,{op:'save'}).value).toBe(before);
});
