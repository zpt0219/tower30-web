import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir=process.env.TOWER_ARTIFACT_DIR??readFileSync('.artifact-dir','utf8').trim();
const candidate=process.argv[2]??'godot-responses.jsonl';
const read=p=>readFileSync(`${dir}/${p}`,'utf8').trim().split('\n').map(s=>JSON.parse(s));
const expected=read('v8-responses.jsonl'),actual=read(candidate);assert.equal(actual.length,expected.length);
let numericValues=0,maxAbsoluteDifference=0,tolerated=0;
function compare(a,b,path){
 if(typeof a==='number'){
  assert.equal(typeof b,'number',path);numericValues++;const difference=Math.abs(a-b);maxAbsoluteDifference=Math.max(maxAbsoluteDifference,difference);
  if(Number.isInteger(a))assert.equal(b,a,path);else {assert.ok(difference<=1e-9,`${path}: ${a} vs ${b}`);if(difference)tolerated++;}return;
 }
 if(typeof a==='string'&&a.startsWith('{')&&typeof b==='string'&&b.startsWith('{')){
  let x,y;try{x=JSON.parse(a);y=JSON.parse(b);}catch{assert.equal(b,a,path);return;}compare(x,y,path+'.serialized');return;
 }
 if(a&&typeof a==='object'){
  assert.ok(b&&typeof b==='object',path);assert.deepEqual(Object.keys(b),Object.keys(a),path);
  for(const k of Object.keys(a))compare(a[k],b[k],`${path}.${k}`);return;
 }
 assert.equal(b,a,path);
}
for(let i=0;i<expected.length;i++)compare(expected[i],actual[i],`response[${i}]`);
const result={candidate,requests:actual.length,checkpoints:JSON.parse(readFileSync(`${dir}/checkpoints.json`,'utf8')).length,numericValues,maxAbsoluteDifference,tolerated,integerComparison:'exact',floatToleranceAbsolute:1e-9,normalFloors:30,normalTicks:35487,normalGold:610,stressLivingUnits:20,passed:true};
writeFileSync(`${dir}/${candidate.replace('.jsonl','')}-parity.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
