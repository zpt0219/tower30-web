import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { readFileSync,writeFileSync } from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:4173/';
const artifacts=process.env.TOWER_ARTIFACT_DIR??readFileSync('.artifact-dir','utf8').trim();
const browser=await chromium.launch({headless:true});
const reports=[];
try{
 for(const [label,viewport] of [['desktop',{width:1280,height:720}],['mobile-landscape',{width:1000,height:450}]]){
  const context=await browser.newContext({viewport,hasTouch:label!=='desktop',isMobile:label!=='desktop'}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http')&&new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await page.goto(base);await page.getByRole('heading',{name:'史莱姆初见'}).waitFor();
  for(let floor=1;floor<=2;floor++){
   await page.getByRole('button',{name:'准备挑战 →'}).click();await page.getByRole('button',{name:'开始交战 →'}).click();
   if(floor===1){await page.getByRole('button',{name:'1× 速度'}).click();await page.getByRole('button',{name:'2× 速度'}).click();await page.waitForTimeout(1400);await page.screenshot({path:`${artifacts}/${label}-battle.png`});}
   await page.getByRole('heading',{name:'赢下这一战。'}).waitFor({timeout:20000});
   if(floor===2)await page.screenshot({path:`${artifacts}/production-${label}-victory.png`});
   await page.getByRole('button',{name:'确认战果 · 返回整备'}).click();
  }
  assert.equal(await page.locator('#gold-counter').textContent(),'370');assert.equal(await page.locator('#floor-counter').textContent(),'03');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await page.getByRole('navigation').getByRole('button',{name:/存档/}).click();const dl=page.waitForEvent('download');await page.getByRole('button',{name:'导出存档 JSON'}).click();const download=await dl;await download.saveAs(`${artifacts}/production-${label}-save.json`);
  reports.push({label,viewport,base,actualFloorsCleared:2,gold:370,pageErrors:errors,externalRequests:external,saveExported:true});await context.close();
 }
 writeFileSync(`${artifacts}/production-check.json`,JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2));
}finally{await browser.close();}
