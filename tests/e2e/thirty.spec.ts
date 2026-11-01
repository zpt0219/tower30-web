import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {artifactDirectory} from '../../scripts/artifacts';
const trace=JSON.parse(readFileSync("tests/fixtures/csharp-thirty-floors.json","utf8")) as {floor:number;tick:number;setupCommands:unknown[]|null;commands:string[];reinforcements:string[]}[];
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
   if(floor===30)return e.serialize();
   e.dispatch({type:'begin'});e.dispatch({type:'start'});
  }
  e.advance(s.tick-tick);tick=s.tick;
  for(const id of s.commands)e.dispatch({type:'ultimate',id});
  for(const id of s.reinforcements)e.dispatch({type:'reinforce',id});
 }
 throw new Error('缺少Boss前检查点');
}
test('正常资源存档继续挑战30层Boss，结算幂等与阶段3商店解锁',async({page},info)=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 // Drive browser time explicitly so UI commands land on fixed battle ticks, independent of host scheduling.
 await page.clock.install({time:new Date('2026-10-31T12:00:00Z')});
 const file=`${artifacts}/${info.project.name}-boss30-checkpoint.json`;writeFileSync(file,checkpoint());
 await page.goto('./');
 await page.getByRole('navigation').getByRole('button',{name:/存档/}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入存档',exact:true}).click();await(await chooser).setFiles(file);
 await page.getByRole('dialog').getByRole('button',{name:'确认导入存档',exact:true}).click();
 await expect(page.getByRole('heading',{name:'风暴祭司',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'准备挑战 →',exact:true}).click();
 const selected=page.locator('.opening-options button.selected:not([disabled])');while(await selected.count())await selected.first().click();
 for(const label of ['重装骷髅','水元素','风翅虫'])await page.getByRole('button',{name:label+' 加入',exact:true}).click();
 await page.clock.pauseAt(new Date('2026-10-31T13:00:00Z'));
 await page.clock.runFor(16);
 await page.getByRole('button',{name:'开始交战 →',exact:true}).click();
 const actions=trace.filter(s=>s.floor===30&&(s.commands.length||s.reinforcements.length));
 await page.evaluate(schedule=>{
  let index=0;
  const act=()=>{
   if(document.querySelector('.result-overlay'))return;
   const tick=Math.round(parseFloat(document.querySelector('#battle-time')!.textContent!)*20);
   while(index<schedule.length&&schedule[index]!.tick<=tick){
    const s=schedule[index++]!;
    if(s.tick!==tick)throw new Error(`UI command missed tick ${s.tick}, got ${tick}`);
    for(const id of s.commands){const b=document.querySelector<HTMLButtonElement>(`button[data-unit="${id}"]`);if(!b||b.disabled)throw new Error(`Ultimate unavailable: ${id} at ${tick}`);b.click();}
    for(const id of s.reinforcements){const b=document.querySelector<HTMLButtonElement>(`button[data-reserve="${id}"]`);if(!b||b.disabled)throw new Error(`Reinforcement unavailable: ${id} at ${tick}`);b.click();}
   }
   requestAnimationFrame(act);
  };
  act();
 },actions);
 await page.clock.runFor(8000);await page.screenshot({path:`${artifacts}/${info.project.name}-boss30-battle.png`});
 await page.clock.runFor(25000);
 await page.clock.resume();
 await expect(page.getByRole('heading',{name:'风暴祭司已击败',exact:true})).toBeVisible({timeout:60000});
 const action=page.getByRole('button',{name:'确认通关 · 查看记录',exact:true});const bounds=await action.boundingBox();const card=await page.locator('.result-card').boundingBox();expect(bounds!.height).toBeGreaterThanOrEqual(48);const table=await page.locator('.result-card .table-scroll').boundingBox();expect(table!.height).toBeGreaterThan(90);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(card!.y+card!.height+1);
 await page.screenshot({path:`${artifacts}/${info.project.name}-boss30-win.png`});
 const hpAfterWin=await page.locator('[data-unit]').evaluateAll(buttons=>buttons.map(b=>({id:b.getAttribute('data-unit'),hp:Number(b.querySelector('[id^=unit-hp-]')?.textContent?.split('/')[0])})));
 await page.getByRole('button',{name:'确认通关 · 查看记录',exact:true}).click();
 await expect(page.getByRole('heading',{name:'30层试炼已完成',exact:true})).toBeVisible();
 await expect(page.locator('#floor-counter')).toHaveText('30');
 await page.screenshot({path:`${artifacts}/${info.project.name}-completed.png`});
 const completionViewport=(await page.locator('.page-scroll').boundingBox())!;
 const metricsButtons=page.locator('.completion-layout .button-row button');for(const b of await metricsButtons.all()){const r=(await b.boundingBox())!;expect(r.height).toBeGreaterThanOrEqual(48);expect(r.y+r.height).toBeLessThanOrEqual(completionViewport.y+completionViewport.height);}
 await page.getByRole('button',{name:'查看30层战报',exact:true}).click();await expect(page.getByRole('button',{name:'查看行动明细',exact:true})).toHaveCount(30);await page.getByRole('button',{name:'查看行动明细',exact:true}).nth(29).click();await expect(page.getByRole('dialog').getByRole('columnheader',{name:'出手回能',exact:true})).toBeVisible();await page.screenshot({path:`${artifacts}/${info.project.name}-record-details.png`});await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'试炼',exact:true}).click();await page.getByRole('button',{name:'回顾关卡',exact:true}).click();await expect(page.getByRole('button',{name:'已通过本层',exact:true})).toBeDisabled();await page.getByRole('button',{name:'返回通关页',exact:true}).click();await expect(page.getByRole('heading',{name:'30层试炼已完成',exact:true})).toBeVisible();
 await expect(page.locator('#save-status')).toHaveText('已保存到本机');
 const gold=await page.locator('#gold-counter').textContent();
 await page.reload();await expect(page.locator('#floor-counter')).toHaveText('30');await expect(page.locator('#gold-counter')).toHaveText(gold!);
 await page.getByRole('navigation').getByRole('button',{name:'商店',exact:true}).click();
 await expect(page.locator('.section-intro')).toContainText('当前阶段 3');
 const row=page.locator('.shop-row').filter({has:page.getByRole('heading',{name:'叶幕杖·大师',exact:true})});
 await row.getByRole('button',{name:'购买',exact:true}).click();await page.getByRole('button',{name:'确认购买',exact:true}).click();
 await expect(page.locator('#gold-counter')).toHaveText(String(Number(gold)-300));
 await page.screenshot({path:`${artifacts}/${info.project.name}-boss30-shop-unlocked.png`});
 await page.getByRole('navigation').getByRole('button',{name:/存档/}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出存档 JSON',exact:true}).click();
 const exported=`${artifacts}/${info.project.name}-boss30-normal-save.json`;await(await download).saveAs(exported);
 const final=TowerEngine.restore(validateConfig(raw),readFileSync(exported,'utf8')).getSnapshot();expect(final.floor).toBe(31);expect(final.records).toHaveLength(30);expect(final.equipment).toContain('ward_staff_3');expect(final.mode).toBe('run');expect(final.completed).toBe(true);for(const before of hpAfterWin)expect(final.members.find(m=>m.id===before.id)!.hp).toBe(before.hp);expect(errors).toEqual([]);
});
