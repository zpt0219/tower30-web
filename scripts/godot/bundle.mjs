import {build} from 'vite';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='integrations/godot/generated';
await build({configFile:false,publicDir:false,build:{outDir:dir,emptyOutDir:true,target:'es2022',minify:false,lib:{entry:'src/bridge/session.ts',name:'Tower30Bridge',formats:['iife'],fileName:()=> 'tower30-core.js'}}});
await copyFile('data/tower/thirty-floor-trial.json',`${dir}/tower.json`);
await mkdir(`${dir}/sprites`,{recursive:true});
// All 42 sheets already present in this independent repository; no sibling reads.
const raw=JSON.parse(await readFile('data/tower/thirty-floor-trial.json','utf8'));
await copyFile('src/battle-view/sprite-layout.json',`${dir}/sprite-layout.json`);
for(const id of ['hero','princess',...raw.Species.map(s=>s.Id)])await copyFile(`public/assets/${id}.png`,`${dir}/sprites/${id}.png`);
await copyFile('public/assets/SOURCES.json',`${dir}/sprites/SOURCES.json`);
const sha=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
await writeFile(`${dir}/manifest.json`,JSON.stringify({bridgeVersion:1,logicHz:60,bundleSha256:await sha(`${dir}/tower30-core.js`),configSha256:await sha(`${dir}/tower.json`)},null,2));
