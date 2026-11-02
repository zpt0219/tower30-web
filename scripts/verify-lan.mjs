import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const artifacts=process.env.TOWER_ARTIFACT_DIR??readFileSync('.artifact-dir','utf8').trim();
const base='http://192.168.68.108';
const release=await(await fetch(base+'/api/check/tower30')).json();assert.equal(release.app,'tower30-web');assert.equal(release.version,JSON.parse(readFileSync('package.json','utf8')).version);
for(const [file,hash] of Object.entries(release.files)){
 const r=await fetch(base+'/tower30/'+file);assert.equal(r.status,200,file);
 const bytes=Buffer.from(await r.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,file);
 if(file.endsWith('.js'))assert.match(r.headers.get('content-type'),/javascript/,file);
}
const browser=await chromium.launch({headless:true});const results=[];
try{
 for(const [label,viewport] of [['desktop',{width:1280,height:720}],['mobile-landscape',{width:1000,height:450}]]){
  const context=await browser.newContext({viewport,hasTouch:label!=='desktop',isMobile:label!=='desktop'});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/');await page.locator('#status-tower30').filter({hasText:'在线 · v0.13.0'}).waitFor({timeout:20000});
  const card=page.locator('.card-tower30');await card.scrollIntoViewIfNeeded();assert.equal(await page.locator('#link-tower30').getAttribute('href'),'/tower30/');
  await page.screenshot({path:`${artifacts}/${label}-homepage-card.png`});
  await page.locator('#link-tower30').click();await page.waitForURL(base+'/tower30/');await page.getByRole('heading',{name:'史莱姆初见',exact:true}).waitFor();
  assert.equal(await page.locator('#gold-counter').textContent(),'240');await page.screenshot({path:`${artifacts}/${label}-lan-home.png`});
  await page.getByRole('button',{name:'准备挑战 →',exact:true}).click();await page.getByRole('button',{name:'开始交战 →',exact:true}).click();
  await page.waitForTimeout(1000);await page.screenshot({path:`${artifacts}/${label}-lan-battle.png`});
  await page.getByRole('button',{name:'1× 速度',exact:true}).click();await page.getByRole('button',{name:'2× 速度',exact:true}).click();
  await page.getByRole('heading',{name:'赢下这一战。',exact:true}).waitFor({timeout:30000});await page.getByRole('button',{name:'确认战果 · 返回整备',exact:true}).click();
  assert.equal(await page.locator('#floor-counter').textContent(),'02');assert.equal(await page.locator('#gold-counter').textContent(),'305');
  await page.reload();await page.getByRole('heading',{name:'蘑菇精初见',exact:true}).waitFor();assert.equal(await page.locator('#gold-counter').textContent(),'305');
  await page.getByRole('navigation').getByRole('button',{name:'工作台',exact:true}).click();await page.getByRole('button',{name:'导出Godot试跑',exact:true}).waitFor();
  await page.screenshot({path:`${artifacts}/${label}-lan-editor.png`});
  assert.deepEqual(errors,[]);results.push({label,viewport,cardOnline:true,cardClickUrl:base+'/tower30/',actualFloorsCleared:1,postRewardGold:305,refreshRestores:true,editorAvailable:true,pageErrors:errors});await context.close();
 }
 writeFileSync(`${artifacts}/lan-verification.json`,JSON.stringify({version:release.version,verifiedFiles:Object.keys(release.files).length,nginx:true,results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
