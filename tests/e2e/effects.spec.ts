import {test,expect,type Page} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {artifactDirectory} from '../../scripts/artifacts';
import {readZip} from '../../src/editor/zip';
import {scene as sceneFromConfig} from '../helpers/status-scene';
const raw:unknown=JSON.parse(readFileSync('data/tower/thirty-floor-trial.json','utf8'));
const scene=(auto:string,enemyAuto='')=>sceneFromConfig(raw,auto,enemyAuto);
import {defaultPlaytestSetup} from '../../src/core/playtest';
import {TowerEngine} from '../../src/core/engine';
import {validateConfig,fingerprint} from '../../src/core/config';
import {simulatePair,type SimulationReport} from '../../src/core/simulation';
const artifacts=artifactDirectory();
async function importScene(page:Page,source:ReturnType<typeof scene>,file:string){
 writeFileSync(file,JSON.stringify({format:'tower30-editor-project',schemaVersion:1,source,setup:{...defaultPlaytestSetup(),party:['hero'],hpPercent:50,skillPolicy:'strict'}}));
 await page.goto('./');await page.getByRole('button',{name:'编辑属性与关卡 ▶ Play',exact:true}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入',exact:true}).click();await(await chooser).setFiles(file);
 await expect(page.getByText('已导入草稿，点击 Play 测试。',{exact:true})).toBeVisible();
 await expect(page.locator('#wb-validation')).toContainText('配置校验通过');
 await page.clock.runFor(4100); // Let the import notice clear before inspecting the editor layout.
}
async function skill(page:Page,id:string){await page.getByRole('button',{name:'技能 · 73',exact:true}).click();await page.locator(`[data-wb="skill"][data-id="${id}"]`).first().click();}
async function exportFile(page:Page,button:string,file:string){const pending=page.waitForEvent('download');await page.getByRole('button',{name:button,exact:true}).click();await(await pending).saveAs(file);return readFileSync(file,'utf8');}
async function runAndExport(page:Page,file:string){
 await page.getByRole('button',{name:'▶ Play 第1关',exact:true}).click();await expect(page.getByRole('heading',{name:'独立 Play · 第1关',exact:true})).toBeVisible();await page.clock.runFor(2800);await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'撤回',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认撤回战斗',exact:true}).click();await expect(page.getByRole('heading',{name:'测试已撤回',exact:true})).toBeVisible();
 return TowerEngine.restorePlaytest(await exportFile(page,'导出测试记录',file));
}
test('网页改毒伤和共用效果后Play实际生效，冻结记录与A/B批测保留参数，正式资源独立',async({page},info)=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-31T12:00:00Z')});
 const c=scene('poison','mossheal');c.Rules.Actions.poison!.Bases=[3000];c.Rules.Actions.poison!.Duration=7;c.Rules.Combatants.boar!.Base.Magic=1000;c.Rules.Actions.mossheal!.Windup=.6;
 await importScene(page,c,`${artifacts}/${info.project.name}-effects-project-input.json`);
 await skill(page,'poison');await page.getByLabel('持续伤害属性比例 %',{exact:true}).fill('50');await page.locator('#wb-Rules-Actions-poison-DotRatio').scrollIntoViewIfNeeded();await page.screenshot({path:`${artifacts}/${info.project.name}-poison-effect-editor.png`});
 await skill(page,'effects');await page.getByLabel('中毒时治疗保留 %',{exact:true}).fill('20');await page.getByLabel('反伤比例 %',{exact:true}).fill('50');await page.getByLabel('急速增益 %',{exact:true}).fill('75');await expect(page.locator('#wb-save-status')).toHaveText('草稿已保存到浏览器');await page.locator('.wb-inspector').evaluate(el=>el.scrollTop=0);if(info.project.name==='mobile-landscape')await page.getByLabel('中毒时治疗保留 %',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${artifacts}/${info.project.name}-shared-effects-editor.png`});
 await page.clock.pauseAt(new Date('2026-10-31T13:00:00Z'));
 const first=await runAndExport(page,`${artifacts}/${info.project.name}-effects-play-a.json`),a=first.getBattleSnapshot()!.units[1]!;expect(a.dotPower).toBe(50);expect(a.healing).toBe(200);expect(first.getConfigSnapshot().Rules.Effects).toMatchObject({ReflectionRatio:.5,HasteBonus:.75,HealingReceived:.2});await page.getByRole('button',{name:'返回编辑',exact:true}).click();
 await page.getByRole('button',{name:'批量对比',exact:true}).click();await page.getByRole('button',{name:'将当前草稿保存为A',exact:true}).click();await expect(page.locator('.sim-message')).toHaveText('A配置已保存到此浏览器。');
 await skill(page,'poison');await page.getByLabel('持续伤害属性比例 %',{exact:true}).fill('0');await skill(page,'effects');await page.getByLabel('中毒时治疗保留 %',{exact:true}).fill('100');
 const second=await runAndExport(page,`${artifacts}/${info.project.name}-effects-play-b.json`),b=second.getBattleSnapshot()!.units[1]!;expect(b.dotTime).toBe(0);expect(b.healing).toBe(1000);expect(first.getBattleSnapshot()!.units[1]!.dotPower).toBe(50);await page.getByRole('button',{name:'返回编辑',exact:true}).click();await page.clock.resume();
 await page.getByRole('button',{name:'批量对比',exact:true}).click();await page.getByLabel('每份配置运行次数',{exact:true}).fill('1');await page.getByRole('button',{name:'运行A / B配对模拟',exact:true}).click();await expect(page.getByRole('heading',{name:'已完成 · 1 / 1 对',exact:true})).toBeVisible({timeout:30000});
 const report=JSON.parse(await exportFile(page,'导出对比报告',`${artifacts}/${info.project.name}-effects-comparison.json`)) as SimulationReport;expect(report.a.config.Rules.Actions.poison!.DotRatio).toBe(.5);expect(report.b.config.Rules.Actions.poison!.DotRatio).toBe(0);expect(report.a.config.Rules.Effects!.HealingReceived).toBe(.2);expect(report.b.config.Rules.Effects!.HealingReceived).toBe(1);expect(report.pairs[0]!.a.damage).not.toBe(report.pairs[0]!.b.damage);expect(simulatePair(report,0)).toEqual(report.pairs[0]);
 await page.getByRole('button',{name:'‹ 返回正式试跑',exact:true}).click();await expect(page.locator('#gold-counter')).toHaveText('240');await expect(page.locator('#floor-counter')).toHaveText('01');expect(errors).toEqual([]);
});
test('网页逐级改护盾生效，空白继承、草稿恢复、参数范围与默认恢复可核对',async({page},info)=>{
 test.setTimeout(90000);await page.clock.install({time:new Date('2026-10-31T12:00:00Z')});const c=scene('leafward');await importScene(page,c,`${artifacts}/${info.project.name}-shield-project-input.json`);
 await skill(page,'leafward');await expect(page.getByLabel('Lv.1 护盾倍率',{exact:true})).toHaveValue('');await page.getByLabel('Lv.1 护盾倍率',{exact:true}).fill('21');await expect(page.locator('#wb-validation')).toContainText('配置有误');await expect(page.getByRole('button',{name:'▶ Play 第1关',exact:true})).toBeDisabled();
 await page.getByLabel('Lv.1 护盾倍率',{exact:true}).fill('2');await page.getByLabel('Lv.3 护盾倍率',{exact:true}).fill('0');await expect(page.locator('#wb-validation')).toContainText('配置校验通过');await page.locator('#wb-Rules-Actions-leafward-ShieldRatios-0').scrollIntoViewIfNeeded();await page.screenshot({path:`${artifacts}/${info.project.name}-shield-effect-editor.png`});
 await expect(page.locator('#wb-save-status')).toHaveText('草稿已保存到浏览器');await page.reload();await page.getByRole('button',{name:'编辑属性与关卡 ▶ Play',exact:true}).click();await skill(page,'leafward');await expect(page.getByLabel('Lv.1 护盾倍率',{exact:true})).toHaveValue('2');await expect(page.getByLabel('Lv.2 护盾倍率',{exact:true})).toHaveValue('');await expect(page.getByLabel('Lv.3 护盾倍率',{exact:true})).toHaveValue('0');
 await page.clock.pauseAt(new Date('2026-10-31T13:00:00Z'));const e=await runAndExport(page,`${artifacts}/${info.project.name}-shield-play.json`);expect(e.getBattleSnapshot()!.units[0]!.barrier).toBe(200);expect(e.getConfigSnapshot().Rules.Actions.leafward!.ShieldRatios).toEqual([2,null,0]);await page.getByRole('button',{name:'返回编辑',exact:true}).click();await page.clock.resume();
 await skill(page,'leafward');await page.getByLabel('Lv.1 护盾倍率',{exact:true}).fill('');await page.getByLabel('Lv.3 护盾倍率',{exact:true}).fill('');
 await skill(page,'effects');await page.getByLabel('反伤比例 %',{exact:true}).fill('201');await expect(page.locator('#wb-validation')).toContainText('配置有误');await page.getByLabel('反伤比例 %',{exact:true}).fill('50');await page.getByLabel('急速增益 %',{exact:true}).fill('75');await expect(page.locator('#wb-validation')).toContainText('配置校验通过');await page.locator('.wb-section-title').getByRole('button',{name:'恢复共用效果默认',exact:true}).click();await expect(page.getByLabel('反伤比例 %',{exact:true})).toHaveValue('');await expect(page.getByLabel('急速增益 %',{exact:true})).toHaveValue('');
 await exportFile(page,'导出工程 (ZIP)',`${artifacts}/${info.project.name}-effects-restored-bundle.zip`);
 const source=JSON.parse(new TextDecoder().decode(readZip(new Uint8Array(readFileSync(`${artifacts}/${info.project.name}-effects-restored-bundle.zip`))).get('thirty-floor-trial-draft.json')!));
 expect(source.Rules.Effects).toBeUndefined();expect(source.Rules.Actions.leafward.ShieldRatios).toBeUndefined();expect(fingerprint(validateConfig(source))).toBe(fingerprint(validateConfig(c)));
});
