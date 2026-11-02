import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {artifactDirectory} from '../../scripts/artifacts';
import {validateConfig} from '../../src/core/config';
import {defaultPlaytestSetup} from '../../src/core/playtest';
import {defaultStrategy} from '../../src/core/strategy';
import {inspectProject} from '../../src/core/project';
import {TowerEngine} from '../../src/core/engine';
const artifacts=artifactDirectory();
test('网页编辑角色关卡技能策略，导出同格式Godot工程，Play保留冻结快照与正式进度',async({page},info)=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>{errors.push(e.message);writeFileSync(`${artifacts}/${info.project.name}-page-errors.json`,JSON.stringify(errors));});
 const raw:unknown=JSON.parse(readFileSync('data/tower/thirty-floor-trial.json','utf8')),source=validateConfig(raw);
 for(const id of ['hero','princess','slime_dusk','fire_imp']){source.Rules.Combatants[id]!.Base.MaxHp=30000;source.Rules.Combatants[id]!.Growth.MaxHp=0;}
 source.Rules.Combatants.fire_imp!.Base.Magic=300;source.Encounters[2]!.Enemies=[{...source.Encounters[2]!.Enemies[0]!,Count:1}];
 const setup={...defaultPlaytestSetup(),floor:3,party:['hero','princess','slime_dusk','fire_imp'],level:3,rank:3,energy:1000,autoPlay:true,strategy:defaultStrategy()};
 const initial={format:'tower30-editor-project',schemaVersion:1,source:{...source,AuthoringNote:'保留网页源字段'},setup};
 const input=`${artifacts}/${info.project.name}-input-project.json`;writeFileSync(input,JSON.stringify(initial));
 await page.clock.install({time:new Date('2026-11-01T12:00:00Z')});await page.goto('./');await page.getByRole('button',{name:'编辑属性与关卡 ▶ Play',exact:true}).click();
 const choose=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入',exact:true}).click();await(await choose).setFiles(input);
 await expect(page.getByText('已导入草稿，点击 Play 测试。',{exact:true})).toBeVisible();
 await page.getByLabel('基础 · 攻击',{exact:true}).fill('411');await page.locator('[data-wb="character"][data-id="slime_dusk"]').click();await page.getByLabel('基础 · 生命',{exact:true}).fill('23456');
 await page.getByRole('button',{name:'关卡 · 30',exact:true}).click();await page.getByLabel('关卡名称',{exact:true}).fill('网页→Godot联调第3关');await page.getByLabel('敌人物种',{exact:true}).selectOption('slime_dusk');await page.getByLabel('敌人数量',{exact:true}).fill('3');await page.getByLabel('生命倍率',{exact:true}).fill('8');
 await page.getByRole('button',{name:'技能 · 73',exact:true}).click();await page.locator('[data-wb="skill"][data-id="firebolt"]').click();
 for(const [index,value] of ['3.25','3.5','3.75'].entries())await page.locator(`#wb-Rules-Actions-firebolt-Ratios-${index}`).fill(value);
 await page.getByRole('button',{name:'测试设置',exact:true}).click();await page.locator('[data-setting="seed"]').fill('123456');
 await page.getByRole('button',{name:'战斗策略',exact:true}).click();await page.getByLabel('治疗生命阈值 %',{exact:true}).fill('40');
 await expect(page.locator('#wb-save-status')).toHaveText('草稿已保存到浏览器');
 async function exportProject(suffix:string){await expect(page.getByRole('button',{name:'导出Godot试跑',exact:true})).toBeEnabled();await page.screenshot({path:`${artifacts}/${info.project.name}-before-export-${suffix}.png`});const dl=page.waitForEvent('download',{timeout:10000});await page.getByRole('button',{name:'导出Godot试跑',exact:true}).click();const file=await dl;expect(file.suggestedFilename()).toContain('tower30-godot-F3-fnv1a-');const path=`${artifacts}/${info.project.name}-web-project-${suffix}.json`;await file.saveAs(path);return JSON.parse(readFileSync(path,'utf8'));}
 const a=await exportProject('a'),check=inspectProject(a);expect(check.info.setup.seed).toBe(123456);expect(check.config.Rules.Combatants.hero!.Base.Attack).toBe(411);expect(check.config.Rules.Combatants.slime_dusk!.Base.MaxHp).toBe(23456);expect(check.config.Encounters[2]!.Enemies[0]!.Count).toBe(3);expect(check.config.Rules.Actions.firebolt!.Ratios).toEqual([3.25,3.5,3.75]);expect(check.info.setup.strategy!.healingHpPercent).toBe(40);expect(a.source.AuthoringNote).toBe('保留网页源字段');
 const exportButton=await page.getByRole('button',{name:'导出Godot试跑',exact:true}).boundingBox();expect(exportButton!.height).toBeGreaterThanOrEqual(48);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);expect(overflow).toBe(false);await page.screenshot({path:`${artifacts}/${info.project.name}-godot-export.png`});
 await page.clock.pauseAt(new Date('2026-11-01T13:00:00Z'));await page.getByRole('button',{name:'▶ Play 第3关',exact:true}).click();await page.clock.runFor(3000);await page.getByRole('button',{name:'暂停',exact:true}).click();
 const saved=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('tower30-web-v1');r.onsuccess=()=>resolve(r.result);});const value=await new Promise<string>(resolve=>{const tx=db.transaction('workbench','readonly'),r=tx.objectStore('workbench').get('session');tx.oncomplete=()=>resolve(r.result as string);});db.close();return JSON.parse(value).serialized as string;});
 expect(TowerEngine.restorePlaytest(saved).configHash).toBe(check.info.configHash);writeFileSync(`${artifacts}/${info.project.name}-web-record.json`,saved);
 await page.getByRole('button',{name:'返回编辑',exact:true}).click();await page.getByRole('button',{name:'测试设置',exact:true}).click();await page.locator('[data-setting="seed"]').fill('654321');const b=await exportProject('b');expect(inspectProject(b).info.launchHash).not.toBe(check.info.launchHash);expect(TowerEngine.restorePlaytest(saved).getPlaytestSetup()!.seed).toBe(123456);
 await page.getByRole('button',{name:'战斗策略',exact:true}).click();await page.getByLabel('治疗生命阈值 %',{exact:true}).fill('101');await expect(page.getByRole('button',{name:'导出Godot试跑',exact:true})).toBeDisabled();await page.getByLabel('治疗生命阈值 %',{exact:true}).fill('40');
 await page.getByRole('button',{name:'‹ 返回正式试跑',exact:true}).click();await expect(page.locator('#gold-counter')).toHaveText('240');expect(errors).toEqual([]);
});
