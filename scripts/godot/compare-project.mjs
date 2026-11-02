import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const dir=process.env.TOWER_ARTIFACT_DIR??readFileSync('.artifact-dir','utf8').trim();
const context=vm.createContext({});vm.runInContext(readFileSync('integrations/godot/generated/tower30-core.js','utf8'),context);
const invoke=(op)=>{const r=JSON.parse(context.Tower30Bridge.call(JSON.stringify(op)));assert.equal(r.ok,true,r.error);return r.value;};
const project=JSON.parse(readFileSync(`${dir}/desktop-web-project-a.json`,'utf8'));
let compared=0,maxDifference=0;
function same(a,b,path='snapshot'){
 if(typeof a==='number'){assert.equal(typeof b,'number',path);const d=Math.abs(a-b);maxDifference=Math.max(maxDifference,d);if(Number.isInteger(a))assert.equal(b,a,path);else assert.ok(d<=1e-9,`${path}: ${a} vs ${b}`);compared++;return;}
 if(a&&typeof a==='object'){assert.ok(b&&typeof b==='object',path);assert.deepEqual(Object.keys(b),Object.keys(a),path);for(const k of Object.keys(a))same(a[k],b[k],`${path}.${k}`);return;}
 assert.equal(b,a,path);
}
const results=[];const prepare=process.argv.includes('--prepare');
for(const host of ['desktop','mobile-landscape']){
 const record=JSON.parse(readFileSync(`${dir}/${host}-exported-record.json`,'utf8'));
 const started=invoke({op:'play-project',project});invoke({op:'advance',ticks:record.tick});
 same(JSON.parse(invoke({op:'save'})),record,'record');const expected=invoke({op:'snapshot'});
 invoke({op:'restore-project',project,save:JSON.stringify(record)});same(expected,invoke({op:'snapshot'}));
 invoke({op:'advance',ticks:60});const continued=invoke({op:'snapshot'});
 writeFileSync(`${dir}/${host}-v8-expected-snapshot.json`,JSON.stringify(expected));writeFileSync(`${dir}/${host}-v8-continued-snapshot.json`,JSON.stringify(continued));
 const input=[{op:'restore-project',project,save:JSON.stringify(record)},{op:'snapshot'},{op:'advance',ticks:60},{op:'snapshot'}];
 const responses=input.map(op=>invoke(op));
 writeFileSync(`${dir}/${host}-continue-requests.jsonl`,input.map(r=>JSON.stringify(r)).join('\n')+'\n');writeFileSync(`${dir}/${host}-v8-continue-responses.jsonl`,responses.map(value=>JSON.stringify({version:1,ok:true,value})).join('\n')+'\n');
 let crossHostSnapshotsVerified=false;const actualFile=`${dir}/${host}-godot-continue-responses.jsonl`;if(!prepare&&existsSync(actualFile)){const actual=readFileSync(actualFile,'utf8').trim().split('\n').map(JSON.parse);same(responses.map(value=>({version:1,ok:true,value})),actual,'crossHost');crossHostSnapshotsVerified=true;}
 results.push({crossHostSnapshotsVerified,host,ticks:record.tick,configHash:started.info.configHash,launchHash:started.info.launchHash,recordMatches:true,restoreMatches:true});
}
writeFileSync(`${dir}/project-parity.json`,JSON.stringify({results,numericComparisons:compared,maxAbsoluteDifference:maxDifference,floatAbsoluteTolerance:1e-9,integerComparison:'exact',passed:!prepare&&results.every(r=>r.crossHostSnapshotsVerified)},null,2));
if(!prepare)assert.ok(results.every(r=>r.crossHostSnapshotsVerified),'Missing native cross-host snapshot comparison');
console.log(JSON.stringify({results,compared,maxDifference}));
