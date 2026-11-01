import {test,expect,type Page} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {artifactDirectory} from '../../scripts/artifacts';
import {TowerEngine} from '../../src/core/engine';
import {simulatePair,type SimulationReport,trialSave,summarizeTrials} from '../../src/core/simulation';
const artifacts=artifactDirectory();
async function edit(page:Page,id:string,key:string,value:string){
 await page.getByRole('button',{name:'角色 · 42',exact:true}).click();
 await page.locator(`button[data-wb="character"][data-id="${id}"]`).click();
 await page.locator(`#wb-Rules-Combatants-${id}-Base-${key}`).fill(value);
}
async function downloadReport(page:Page,file:string){
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出对比报告',exact:true}).click();await(await pending).saveAs(file);
 return JSON.parse(readFileSync(file,'utf8')) as SimulationReport;
}
test('网页保存A、编辑B，后台配对模拟、统计和导出可重放，刷新保留A且正式存档不变',async({page},info)=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('./');await page.getByRole('button',{name:'编辑属性与关卡 ▶ Play',exact:true}).click();
 await edit(page,'hero','MaxHp','1');await edit(page,'princess','MaxHp','1');
 await page.getByRole('button',{name:'批量对比',exact:true}).click();
 await page.getByRole('button',{name:'将当前草稿保存为A',exact:true}).click();await expect(page.locator('.sim-message')).toHaveText('A配置已保存到此浏览器。');
 await edit(page,'hero','MaxHp','50000');await edit(page,'hero','Attack','50000');await edit(page,'princess','MaxHp','50000');
 await expect(page.locator('#wb-save-status')).toHaveText('草稿已保存到浏览器');
 await page.getByRole('button',{name:'批量对比',exact:true}).click();await page.getByLabel('每份配置运行次数',{exact:true}).fill('3');
 await page.getByRole('button',{name:'运行A / B配对模拟',exact:true}).click();await expect(page.getByRole('heading',{name:'已完成 · 3 / 3 对',exact:true})).toBeVisible({timeout:30000});
 await expect(page.locator('.sim-table tbody tr')).toHaveCount(3);for(const row of await page.locator('.sim-table tbody tr').all()){await expect(row.locator('td').nth(0)).toContainText('失败');await expect(row.locator('td').nth(1)).toContainText('胜利');}
 await expect(page.locator('.sim-paired')).toContainText('仅B胜 3');
 await page.locator('.sim-controls').evaluate(el=>el.scrollTop=0);await page.locator('.sim-results').evaluate(el=>el.scrollTop=0);
 await page.screenshot({path:`${artifacts}/${info.project.name}-batch-comparison.png`});
 if(info.project.name==='mobile-landscape'){
  const box=(await page.locator('.sim-results').boundingBox())!,cdp=await page.context().newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height-22;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*16}]});await page.waitForTimeout(25);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  expect(await page.locator('.sim-results').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 }
 await page.locator('.sim-results').evaluate(el=>el.scrollTop=380);await page.screenshot({path:`${artifacts}/${info.project.name}-batch-resources.png`});
 await page.locator('.sim-controls').evaluate(el=>el.scrollTop=el.scrollHeight);await page.screenshot({path:`${artifacts}/${info.project.name}-batch-controls.png`});
 const report=await downloadReport(page,`${artifacts}/${info.project.name}-comparison.json`);
 expect(report.status).toBe('complete');expect(report.pairs).toHaveLength(3);expect(report.a.hash).not.toBe(report.b.hash);
 expect(simulatePair(report,0)).toEqual(report.pairs[0]);
 await edit(page,'hero','Attack','60000');await page.getByRole('button',{name:'批量对比',exact:true}).click();await expect(page.locator('.sim-warning')).toContainText('下方保留上次结果');
 const file=trialSave(report,'b',0),restored=TowerEngine.restorePlaytest(JSON.stringify(file)).getSnapshot();
 expect(restored.battle!.result).toBe('victory');expect(restored.battle!.tick).toBe(report.pairs[0]!.b.ticks);expect(restored.records).toEqual([]);
 const recordDownload=page.waitForEvent('download');await page.locator('[data-sim-action="replay"][data-id="b:0"]').click();const recordPath=`${artifacts}/${info.project.name}-batch-replay.json`;await(await recordDownload).saveAs(recordPath);expect(JSON.parse(readFileSync(recordPath,'utf8'))).toEqual(file);
 await page.locator('[data-sim-action="review"][data-id="b:0"]').click();await expect(page.getByRole('heading',{name:'测试胜利',exact:true})).toBeVisible();const frozenDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出测试记录',exact:true}).click();const frozenPath=`${artifacts}/${info.project.name}-reviewed-test.json`;await(await frozenDownload).saveAs(frozenPath);expect(JSON.parse(readFileSync(frozenPath,'utf8'))).toEqual(file);await page.getByRole('button',{name:'返回编辑',exact:true}).click();
 await page.locator('[data-sim-action="play"][data-id="b:0"]').click();await expect(page.getByRole('heading',{name:'独立 Play · 第1关',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回编辑',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'编辑属性与关卡 ▶ Play',exact:true}).click();await page.getByRole('button',{name:'批量对比',exact:true}).click();await expect(page.locator('.sim-variants')).toContainText('保存的配置');
 await page.getByLabel('每份配置运行次数',{exact:true}).fill('1');await page.getByRole('button',{name:'运行A / B配对模拟',exact:true}).click();await expect(page.getByRole('heading',{name:'已完成 · 1 / 1 对',exact:true})).toBeVisible({timeout:30000});await expect(page.locator('.sim-paired')).toContainText('仅B胜 1');
 await page.getByRole('button',{name:'‹ 返回正式试跑',exact:true}).click();await expect(page.locator('#floor-counter')).toHaveText('01');await expect(page.locator('#gold-counter')).toHaveText('240');
 expect(errors).toEqual([]);
});
test('批量模拟可取消、无样本不伪造胜率，非法设置被阻止，事件筛选只改变显示',async({page},info)=>{
 test.setTimeout(60000);await page.goto('./');await page.getByRole('button',{name:'编辑属性与关卡 ▶ Play',exact:true}).click();await page.getByRole('button',{name:'批量对比',exact:true}).click();
 await page.getByLabel('每份配置运行次数',{exact:true}).fill('0');await page.getByRole('button',{name:'运行A / B配对模拟',exact:true}).click();await expect(page.locator('.sim-progress')).toContainText('等待运行');await expect(page.getByText('请修正配置与测试设置；运行次数须为1—100的整数。',{exact:true})).toBeVisible();
 await page.getByLabel('每份配置运行次数',{exact:true}).fill('100');await page.getByRole('button',{name:'运行A / B配对模拟',exact:true}).click();await expect(page.getByRole('button',{name:'取消模拟',exact:true})).toBeEnabled();await page.getByRole('button',{name:'取消模拟',exact:true}).click();await expect(page.locator('.sim-progress')).toContainText('已取消');
 const report=await downloadReport(page,`${artifacts}/${info.project.name}-cancelled-comparison.json`);expect(report.status).toBe('cancelled');expect(report.pairs.length).toBeLessThan(100);expect(summarizeTrials(report.pairs.map(p=>p.a)).count).toBe(report.pairs.length);
 if(!report.pairs.length){await expect(page.locator('.sim-summary')).toContainText('—');expect(summarizeTrials([]).winRate).toBeNull();}
 await page.getByRole('button',{name:'▶ Play 第1关',exact:true}).click();await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByText('调试 · 固定步长 / 战斗事件',{exact:true}).click();
 for(let i=0;i<160;i++){if((await page.locator('#debug-events').textContent())?.includes('hit hero'))break;await page.getByRole('button',{name:'单步 0.05秒',exact:true}).click();}
 const tick=await page.locator('#debug-tick').textContent();await page.getByLabel('事件类型',{exact:true}).selectOption('hit');await page.getByLabel('事件角色或目标',{exact:true}).fill('hero');
 const text=await page.locator('#debug-events').textContent();expect(text).toContain('hit');expect(text).toContain('hero');expect(text!.split('\n').filter(Boolean).every(line=>line.includes('hit')&&line.includes('hero'))).toBe(true);
 await page.getByLabel('事件角色或目标',{exact:true}).fill('not-an-actor');await expect(page.locator('#debug-events')).toHaveText('');await expect(page.locator('#debug-tick')).toHaveText(tick!);
 const toolbar=(await page.locator('#pause-button').boundingBox())!,arena=(await page.locator('.battle-page').boundingBox())!;expect(toolbar.y).toBeGreaterThanOrEqual(arena.y);expect(toolbar.y+toolbar.height).toBeLessThanOrEqual(arena.y+arena.height);
 await page.getByLabel('事件角色或目标',{exact:true}).fill('hero');await page.screenshot({path:`${artifacts}/${info.project.name}-event-filter.png`});
 writeFileSync(`${artifacts}/${info.project.name}-event-filter-check.json`,JSON.stringify({tick,matching:text},null,2));
});
