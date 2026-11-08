import {z} from 'zod';
import {validateConfig,fingerprint} from './config';
import {clone} from './math';
import {playtestSetupSchema,playtestWarnings} from './playtest';
import {TowerEngine} from './engine';

export const editorProjectSchema=z.object({
 format:z.literal('tower30-editor-project'),schemaVersion:z.literal(1),source:z.unknown(),setup:playtestSetupSchema,
 // Uploaded monster sprite sheets (PNG data URLs keyed by species ID). Presentation-only: never read by the combat core.
 sprites:z.record(z.string().regex(/^[A-Za-z0-9_]{1,100}$/),z.string().max(300_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)).optional(),
}).strict();
export type EditorProject=z.infer<typeof editorProjectSchema>;
export const MAX_PROJECT_TEXT=2_000_000;
function utf8Size(text:string){let size=0;for(const ch of text){const cp=ch.codePointAt(0)!;size+=cp<128?1:cp<2048?2:cp<65536?3:4;}return size;}
// Host-independent project boundary: same validation, frozen setup and identifiers on both sides.
export function inspectProject(input:unknown){
 const project=editorProjectSchema.parse(input);
 if(utf8Size(JSON.stringify(project,null,2))>MAX_PROJECT_TEXT)throw new Error('工程文件不能超过2MB');
 const config=validateConfig(project.source),setup=project.setup;
 const warnings=playtestWarnings(config,setup);
 if(setup.skillPolicy==='strict'&&warnings.length)throw new Error('存在未迁移功能：'+warnings.join('；'));
 const configHash=fingerprint(config),launchHash=fingerprint({configHash,setup});
 return {project:clone(project),config,info:{configHash,launchHash,setup:clone(setup),warnings,title:config.Encounters.find(e=>e.Id===config.Floors[setup.floor-1]!.Encounter)!.Title}};
}
export function parseProjectText(text:string){
 if(utf8Size(text)>MAX_PROJECT_TEXT)throw new Error('工程文件不能超过2MB');
 return inspectProject(JSON.parse(text));
}
export function createProjectTrial(input:unknown){
 const inspected=inspectProject(input),engine=TowerEngine.createPlaytest(inspected.config,inspected.project.setup);
 for(const type of ['begin','start'] as const){const result=engine.dispatch({type});if(!result.ok)throw new Error(result.message);}
 return {...inspected,engine};
}
