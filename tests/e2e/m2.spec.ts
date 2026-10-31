import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {artifactDirectory} from '../../scripts/artifacts';
const trace=JSON.parse(readFileSync("tests/fixtures/csharp-ten-floors.json","utf8")) as {floor:number;tick:number;setupCommands:unknown[]|null;commands:string[];reinforcements:string[]}[];
const raw:unknown=JSON.parse(readFileSync("data/tower/thirty-floor-trial.json","utf8"));
import {TowerEngine} from '../../src/core/engine';
import {validateConfig} from '../../src/core/config';
import {commandSchema} from '../../src/core/model';
const artifacts=artifactDirectory();
function checkpoint(){
 const e=new TowerEngine(validateConfig(raw));let floor=0,tick=0;
 for(const s of trace){
  if(floor!==s.floor){if(floor)e.dispatch({type:'finish'});floor=s.floor;tick=0;
   for(const c of s.setupCommands??[])expect(e.dispatch(commandSchema.parse(c)).ok).toBe(true);
   if(floor===10)return e.serialize();
   e.dispatch({type:'begin'});e.dispatch({type:'start'});
  }
  e.advance(s.tick-tick);tick=s.tick;
  for(const id of s.commands)e.dispatch({type:'ultimate',id});
  for(const id of s.reinforcements)e.dispatch({type:'reinforce',id});
 }
 throw new Error('缺少Boss前检查点');
}
test('正常资源存档继续挑战10层Boss，结算幂等与阶段1商店解锁',async({page},info)=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const file=`${artifacts}/${info.project.name}-boss-checkpoint.json`;writeFileSync(file,checkpoint());
 await page.goto('./');
 await page.getByRole('navigation').getByRole('button',{name:/存档/}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入存档',exact:true}).click();await(await chooser).setFiles(file);
 await page.getByRole('dialog').getByRole('button',{name:'确认导入存档',exact:true}).click();
 await expect(page.getByRole('heading',{name:'林地獠王',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'准备挑战 →',exact:true}).click();await page.getByRole('button',{name:'开始交战 →',exact:true}).click();
 await page.getByRole('button',{name:'1× 速度',exact:true}).click();
 await page.evaluate(()=>{
  const handle=setInterval(()=>{
   if(document.querySelector('.result-overlay')){clearInterval(handle);return;}
   for(const b of document.querySelectorAll<HTMLButtonElement>('.battle-unit:not(.reserve):not([disabled])')){
    if(b.dataset.unit==='reedwing'&&!document.querySelector('#debug-events')?.textContent?.includes('charge EN-010'))continue;
    b.click();
   }
   for(const b of document.querySelectorAll<HTMLButtonElement>('.battle-unit.reserve:not([disabled])'))b.click();
  },70);
 });
 await page.waitForTimeout(3000);await page.screenshot({path:`${artifacts}/${info.project.name}-boss-battle.png`});
 await expect(page.getByRole('heading',{name:'赢下这一战。',exact:true})).toBeVisible({timeout:45000});
 const action=page.getByRole('button',{name:'确认战果 · 返回整备',exact:true});const bounds=await action.boundingBox();const card=await page.locator('.result-card').boundingBox();expect(bounds!.height).toBeGreaterThanOrEqual(48);const table=await page.locator('.result-card .table-scroll').boundingBox();expect(table!.height).toBeGreaterThan(90);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(card!.y+card!.height+1);
 await page.screenshot({path:`${artifacts}/${info.project.name}-boss-win.png`});
 await page.getByRole('button',{name:'确认战果 · 返回整备',exact:true}).click();
 await expect(page.locator('#floor-counter')).toHaveText('11');
 const gold=await page.locator('#gold-counter').textContent();
 await page.reload();await expect(page.locator('#floor-counter')).toHaveText('11');await expect(page.locator('#gold-counter')).toHaveText(gold!);
 await page.getByRole('navigation').getByRole('button',{name:'商店',exact:true}).click();
 await expect(page.locator('.section-intro')).toContainText('当前阶段 1');
 const row=page.locator('.shop-row').filter({has:page.getByRole('heading',{name:'铁甲',exact:true})});
 await row.getByRole('button',{name:'购买',exact:true}).click();await page.getByRole('button',{name:'确认购买',exact:true}).click();
 await expect(page.locator('#gold-counter')).toHaveText(String(Number(gold)-130));
 await page.screenshot({path:`${artifacts}/${info.project.name}-boss-shop-unlocked.png`});
 await page.getByRole('navigation').getByRole('button',{name:/存档/}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出存档 JSON',exact:true}).click();
 const exported=`${artifacts}/${info.project.name}-boss-normal-save.json`;await(await download).saveAs(exported);
 const final=TowerEngine.restore(validateConfig(raw),readFileSync(exported,'utf8')).getSnapshot();expect(final.floor).toBe(11);expect(final.records).toHaveLength(10);expect(final.equipment).toContain('iron_armor');expect(final.mode).toBe('run');expect(errors).toEqual([]);
});
