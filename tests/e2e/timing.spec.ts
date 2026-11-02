import {test,expect,type Page} from "@playwright/test";
import {readFileSync,writeFileSync} from "node:fs";
import {artifactDirectory} from "../../scripts/artifacts";
import {TowerEngine} from "../../src/core/engine";
import {validateConfig} from "../../src/core/config";
import {defaultPlaytestSetup} from "../../src/core/playtest";
import {defaultStrategy} from "../../src/core/strategy";
const artifacts=artifactDirectory(),raw:unknown=JSON.parse(readFileSync("data/tower/thirty-floor-trial.json","utf8"));
async function saved(page:Page,mode:"saves"|"workbench"){
 return page.evaluate(async mode=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("tower30-web-v1");r.onsuccess=()=>resolve(r.result);});const raw=await new Promise<string>(resolve=>{const tx=db.transaction(mode,"readonly"),r=tx.objectStore(mode).get(mode==="saves"?"current":"session");tx.oncomplete=()=>resolve(r.result as string);});db.close();return mode==="saves"?raw:JSON.parse(raw).serialized as string;},mode);
}
test("20名存活单位下实测60Hz逻辑与独立画面刷新，暂停/单步和后台恢复不突跳",async({page,browser},info)=>{
 test.setTimeout(120000);await page.clock.install({time:new Date("2026-11-01T12:00:00Z")});
 const source=validateConfig(raw);for(const v of Object.values(source.Rules.Combatants)){v.Base.MaxHp=1000000;v.Growth.MaxHp=0;}
 source.Encounters[0]!.Enemies[0]!.Count=12;
 const setup={...defaultPlaytestSetup(),party:["hero","princess","slime_dusk","sproutling","reedwing","boar","skeleton_guard","crab","water_elemental","earth_elemental"],autoPlay:true,strategy:{...defaultStrategy(),ultimates:false}};
 const path=`${artifacts}/${info.project.name}-60hz-stress-project.json`;writeFileSync(path,JSON.stringify({format:"tower30-editor-project",schemaVersion:1,source,setup}));
 await page.goto("./");await page.getByRole("button",{name:"编辑属性与关卡 ▶ Play",exact:true}).click();const choose=page.waitForEvent("filechooser");await page.getByRole("button",{name:"导入",exact:true}).click();await(await choose).setFiles(path);await expect(page.getByText("已导入草稿，点击 Play 测试。",{exact:true})).toBeVisible();
 await page.clock.pauseAt(new Date("2026-11-01T13:00:00Z"));await page.getByRole("button",{name:"▶ Play 第1关",exact:true}).click();await page.clock.runFor(33500);await page.getByRole("button",{name:"暂停",exact:true}).click();await expect(page.locator("[data-unit]")).toHaveCount(10);
 await page.getByText("调试 · 固定步长 / 战斗事件",{exact:true}).click();await expect(page.locator("#frame-metrics")).toContainText("逻辑 60Hz");
 const state=await page.context().storageState({indexedDB:true}),url=page.url();
 const real=await browser.newContext({storageState:state,viewport:info.project.use.viewport,hasTouch:info.project.name==="mobile-landscape",isMobile:info.project.name==="mobile-landscape"});
 try {page=await real.newPage();await page.goto(url);await expect(page.getByRole("button",{name:"继续",exact:true})).toBeVisible();
 await page.getByText("调试 · 固定步长 / 战斗事件",{exact:true}).click();await page.getByRole("button",{name:"继续",exact:true}).click();await page.waitForTimeout(300);
 const start=await page.evaluate(()=>({time:performance.now(),tick:Number(document.querySelector("#debug-tick")!.textContent)}));await page.waitForTimeout(3500);const end=await page.evaluate(()=>({time:performance.now(),tick:Number(document.querySelector("#debug-tick")!.textContent),metrics:document.querySelector("#frame-metrics")!.textContent}));
 await page.getByRole("button",{name:"暂停",exact:true}).click();const hz=(end.tick-start.tick)/((end.time-start.time)/1000);expect(hz).toBeGreaterThan(55);expect(hz).toBeLessThan(65);
 await expect.poll(async()=>TowerEngine.restorePlaytest(await saved(page,"workbench")).getSnapshot().tick).toBeGreaterThanOrEqual(end.tick);
 const s=TowerEngine.restorePlaytest(await saved(page,"workbench")).getSnapshot(),units=s.battle!.units.filter(u=>u.hp>0);expect(units.filter(u=>!u.enemy)).toHaveLength(10);expect(units.filter(u=>u.enemy)).toHaveLength(10);
 writeFileSync(`${artifacts}/${info.project.name}-60hz-performance.json`,JSON.stringify({logicalHz:hz,elapsedMs:end.time-start.time,ticks:end.tick-start.tick,metrics:end.metrics,livingAllies:10,livingEnemies:10,note:"Chromium on this host; viewport/touch simulation, not a physical phone"},null,2));await page.screenshot({path:`${artifacts}/${info.project.name}-60hz-diagnostics.png`});
 const before=Number(await page.locator("#debug-tick").textContent());await page.getByRole("button",{name:"单步 1/60秒",exact:true}).click();await expect(page.locator("#debug-tick")).toHaveText(String(before+1));await page.waitForTimeout(300);await expect(page.locator("#debug-tick")).toHaveText(String(before+1));
 }finally{await real.close();}
});
test("网页导入旧20Hz正式存档后切60Hz，单步16.67ms，刷新保留迁移点与过去状态",async({page},info)=>{
 const old=new TowerEngine(validateConfig(raw),2463534242,20);old.dispatch({type:"begin"});old.dispatch({type:"start"});old.advance(40);const path=`${artifacts}/${info.project.name}-20hz-migration-input.json`;writeFileSync(path,old.serialize());
 await page.goto("./");await page.getByRole("navigation").getByRole("button",{name:/存档/}).click();const choose=page.waitForEvent("filechooser");await page.getByRole("button",{name:"导入存档",exact:true}).click();await(await choose).setFiles(path);await page.getByRole("dialog").getByRole("button",{name:"确认导入存档",exact:true}).click();
 await page.getByText("调试 · 固定步长 / 战斗事件",{exact:true}).click();await expect(page.locator("#debug-tick")).toHaveText("40");await expect(page.locator("#frame-metrics")).toContainText("逻辑 60Hz");await expect(page.locator("#battle-time")).toHaveText("2.000s");
 await expect.poll(async()=>JSON.parse(await saved(page,"saves")).legacy20ThroughTick).toBe(40);const before=TowerEngine.restore(validateConfig(raw),await saved(page,"saves"));expect(before.getBattleSnapshot()!.units).toEqual(old.getBattleSnapshot()!.units);
 await page.getByRole("button",{name:"单步 1/60秒",exact:true}).click();await expect(page.locator("#debug-tick")).toHaveText("41");await expect(page.locator("#battle-time")).toHaveText("2.017s");await expect.poll(async()=>JSON.parse(await saved(page,"saves")).tick).toBe(41);
 const stored=await saved(page,"saves");writeFileSync(`${artifacts}/${info.project.name}-60hz-migrated-save.json`,stored);expect(JSON.parse(stored).engineVersion).toBe("tower30-ts-m3-v2");await page.reload();await expect(page.getByRole("button",{name:"继续",exact:true})).toBeVisible();await expect(page.locator("#battle-time")).toHaveText("2.017s");await page.waitForTimeout(500);expect(await saved(page,"saves")).toBe(stored);
});
