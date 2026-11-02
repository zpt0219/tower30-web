import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {artifactDirectory} from '../../scripts/artifacts';
import {TowerEngine} from '../../src/core/engine';
test('Godot实际导出的测试记录回到网页回放，单步继续且不替换编辑草稿或正式进度',async({page},info)=>{
 const artifacts=artifactDirectory(),record=readFileSync(`${artifacts}/${info.project.name}-exported-record.json`,'utf8');
 const expected=TowerEngine.restorePlaytest(record).getSnapshot();
 await page.clock.install({time:new Date('2026-11-01T12:00:00Z')});await page.goto('./');await page.getByRole('button',{name:'编辑属性与关卡 ▶ Play',exact:true}).click();
 const draft=await page.getByLabel('基础 · 攻击',{exact:true}).inputValue();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入测试记录',exact:true}).click();await(await chooser).setFiles(`${artifacts}/${info.project.name}-exported-record.json`);
 await expect(page.getByRole('heading',{name:'独立 Play · 第3关',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'继续',exact:true})).toBeVisible();
 await expect(page.locator('#debug-tick')).toHaveText(String(expected.tick));await page.clock.runFor(1000);await expect(page.locator('#debug-tick')).toHaveText(String(expected.tick));
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'导出测试记录',exact:true}).click();const exported=`${artifacts}/${info.project.name}-web-imported-native-record.json`;await(await dl).saveAs(exported);expect(JSON.parse(readFileSync(exported,'utf8'))).toEqual(JSON.parse(record));
 await page.getByText('调试 · 固定步长 / 战斗事件',{exact:true}).click();await page.getByRole('button',{name:'单步 1/60秒',exact:true}).click();await expect(page.locator('#debug-tick')).toHaveText(String(expected.tick+1));
 await page.screenshot({path:`${artifacts}/${info.project.name}-native-record-in-web.png`});
 await page.getByRole('button',{name:'返回编辑',exact:true}).click();await expect(page.getByLabel('基础 · 攻击',{exact:true})).toHaveValue(draft);
 await page.getByRole('button',{name:'‹ 返回正式试跑',exact:true}).click();await expect(page.locator('#gold-counter')).toHaveText('240');
});
