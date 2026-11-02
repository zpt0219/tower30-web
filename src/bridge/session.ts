import { z } from 'zod';
import { validateConfig } from '../core/config';
import { TowerEngine } from '../core/engine';
import { commandSchema } from '../core/model';
import { playtestSetupSchema } from '../core/playtest';
import { advancePlaytest } from '../core/strategy';
import {inspectProject,createProjectTrial,MAX_PROJECT_TEXT} from '../core/project';
import { MAX_TICKS } from '../core/math';

export const BRIDGE_VERSION = 1;
const requestSchema = z.discriminatedUnion('op', [
  z.object({op:z.literal('create'), config:z.unknown(), seed:z.number().int().min(1).max(0xffffffff).optional(), setup:playtestSetupSchema.optional()}).strict(),
  z.object({op:z.literal('restore'), save:z.string(), config:z.unknown().optional()}).strict(),
  z.object({op:z.literal('inspect-project'),project:z.unknown()}).strict(),
  z.object({op:z.literal('play-project'),project:z.unknown()}).strict(),
  z.object({op:z.literal('restore-project'),project:z.unknown(),save:z.string()}).strict(),
  z.object({op:z.literal('command'), command:commandSchema}).strict(),
  z.object({op:z.literal('advance'), ticks:z.number().int().min(0).max(MAX_TICKS)}).strict(),
  ...(['snapshot','view','config','frame','save','events','dispose'] as const).map(op=>z.object({op:z.literal(op)}).strict()),
]);
// A synchronous, JSON-only boundary. Each host owns one isolated session.
// There are no host globals or alternative combat calculations here.
export function createSession() {
  let engine:TowerEngine|null=null;
  const current=()=>{if(!engine)throw new Error('No active session');return engine;};
  const frame=()=>({logicHz:current().logicHz,battle:current().getBattleSnapshot(),events:current().takeEvents()});
  return (json:string):string=>{
    try {
      if(json.length>MAX_PROJECT_TEXT*3)throw new Error('请求过大');
      const r=requestSchema.parse(JSON.parse(json));
      let value:unknown;
      switch(r.op){
        case 'create': {
          const config=validateConfig(r.config);
          const next=r.setup?TowerEngine.createPlaytest(config,r.setup):new TowerEngine(config,r.seed);
          engine=next;value=engine.getSnapshot();break;
        }
        case 'restore': {
          const header:unknown=JSON.parse(r.save);
          const isPlay=z.object({format:z.string()}).parse(header).format==='tower30-playtest';
          const next=isPlay?TowerEngine.restorePlaytest(r.save):TowerEngine.restore(validateConfig(r.config),r.save);
          engine=next.upgradeTo60Hz();value=engine.getSnapshot();break;
        }
        case 'inspect-project': {const p=inspectProject(r.project);value={project:p.project,info:p.info};break;}
        case 'play-project': {const p=createProjectTrial(r.project);engine=p.engine;value={project:p.project,info:p.info,snapshot:engine.getSnapshot()};break;}
        case 'restore-project': {
          const p=inspectProject(r.project),next=TowerEngine.restorePlaytest(r.save).upgradeTo60Hz();
          if(next.configHash!==p.info.configHash||JSON.stringify(next.getConfigSnapshot())!==JSON.stringify(p.config)||JSON.stringify(next.getPlaytestSetup())!==JSON.stringify(p.info.setup))throw new Error('测试记录与冻结工程不匹配');
          engine=next;value={project:p.project,info:p.info,snapshot:engine.getSnapshot()};break;
        }
        case 'config':value=current().getConfigSnapshot();break;
        case 'command':value=current().dispatch(r.command);break;
        case 'advance':advancePlaytest(current(),r.ticks);value=frame();break;
        case 'snapshot':value=current().getSnapshot();break;
        case 'view':value={snapshot:current().getSnapshot(),floor:current().getFloorSnapshot(),shop:current().getShopSnapshot()};break;
        case 'frame':value=frame();break;
        case 'save':value=current().serialize();break;
        case 'events':value=current().takeEvents();break;
        case 'dispose':engine=null;value=null;break;
      }
      return JSON.stringify({version:BRIDGE_VERSION,ok:true,value});
    } catch(error){return JSON.stringify({version:BRIDGE_VERSION,ok:false,error:error instanceof Error?error.message:String(error)});}
  };
}
export const call=createSession();
