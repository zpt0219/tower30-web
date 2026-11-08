import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { artifactDirectory } from "../../scripts/artifacts";
import { readZip } from "../../src/editor/zip";
import { createMonster } from "../../src/editor/roster";
import { newProject } from "../../src/editor/project";
import { validateConfig } from "../../src/core/config";
const artifacts = artifactDirectory();
const raw: unknown = JSON.parse(readFileSync("data/tower/thirty-floor-trial.json","utf8"));
const sheet = readFileSync("public/assets/moonbat.png");
declare global { interface Window { __uploadedDraws: {width:number;height:number;arguments:number}[] } }
async function editor(page:Page) {
  await page.getByRole("button",{name:"编辑属性与关卡 ▶ Play",exact:true}).click();
}
async function draft(page:Page,key="draft") {
  return page.evaluate(async key=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("tower30-web-v1");r.onsuccess=()=>resolve(r.result);});
    try{return await new Promise<string>(resolve=>{const tx=db.transaction("workbench","readonly"),r=tx.objectStore("workbench").get(key);tx.oncomplete=()=>resolve(r.result as string);});}finally{db.close();}
  },key);
}
async function saved(page:Page) {await expect(page.locator("#wb-save-status")).toHaveText("草稿已保存到浏览器");}
async function openCreation(page:Page) {
  await page.getByRole("button",{name:"＋ 新增怪兽",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"制作新怪兽",exact:true});
  await expect(dialog).toBeVisible();return dialog;
}
async function screenshot(page:Page,name:string) {
  await page.screenshot({path:`${artifacts}/${test.info().project.name}-${name}.png`});
}
async function canvasProbe(page:Page) {
  await page.addInitScript(()=>{
    window.__uploadedDraws=[];
    const original=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<typeof original>){
      const img=args[0];
      if(img instanceof HTMLImageElement && img.src.startsWith("data:image/png")) {
        window.__uploadedDraws.push({width:img.naturalWidth,height:img.naturalHeight,arguments:args.length});
        if(window.__uploadedDraws.length>30)window.__uploadedDraws.shift();
      }
      return original.apply(this,args);
    } as typeof original;
  });
}
async function playCustom(page:Page,id:string) {
  await page.getByRole("button",{name:"测试设置",exact:true}).click();
  await page.getByLabel("我方伙伴1",{exact:true}).selectOption(id);await saved(page);
  await page.getByRole("button",{name:"▶ Play 第1关",exact:true}).click();
  await page.getByRole("button",{name:"暂停",exact:true}).click();
  await expect(page.locator("#save-status")).toHaveText("测试已保存");
}
test("完整制作单张PNG怪兽：模板复制、草稿刷新、Canvas、战中恢复与ZIP往返",async({page},info)=>{
  test.setTimeout(90000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await canvasProbe(page);
  await page.goto("./");await editor(page);
  await page.locator('[data-wb="character"][data-id="fire_imp"]').click();
  await page.getByLabel("基础 · 法术",{exact:true}).fill("333");await saved(page);
  const dialog=await openCreation(page);
  const url=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=64;c.height=64;const x=c.getContext("2d")!;x.fillStyle="#c042c9";x.fillRect(8,12,48,44);x.fillStyle="#61a145";x.fillRect(4,4,16,16);x.fillRect(44,4,16,16);x.fillStyle="#fff5c9";x.fillRect(18,25,8,8);x.fillRect(38,25,8,8);return c.toDataURL("image/png");});
  const png=Buffer.from(url.split(",")[1]!,"base64");
  await dialog.getByLabel("新怪兽名字",{exact:true}).fill("幻晶灵猫");
  await dialog.getByLabel("怪兽模板",{exact:true}).selectOption("fire_imp");
  await dialog.getByLabel("上传怪兽PNG",{exact:true}).setInputFiles({name:"crystal-cat.png",mimeType:"image/png",buffer:png});
  await expect(dialog.locator(".monster-image-info")).toContainText("单张角色图");
  await expect(dialog.locator(".monster-template-preview")).toContainText("333");
  for(const button of await dialog.getByRole("button").all()){
    const box=(await button.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(48);expect(box.y+box.height).toBeLessThanOrEqual(info.project.use.viewport!.height);
  }
  await screenshot(page,"monster-create-single-dialog");
  await dialog.getByRole("button",{name:"创建怪兽",exact:true}).click();
  await expect(dialog).toHaveCount(0);await saved(page);
  await expect(page.getByRole("button",{name:"角色 · 43",exact:true})).toBeVisible();
  let project=JSON.parse(await draft(page));const id="custom_01";
  expect(project.sprites[id]).toBe(url);expect(project.source.Rules.Combatants[id].Base.Magic).toBe(333);
  expect(project.source.Rules.Profiles[id]).toEqual(project.source.Rules.Profiles.fire_imp);
  expect(project.source.Species.find((s:{Id:string})=>s.Id===id)).toMatchObject({Name:"幻晶灵猫",SpriteLayout:"single"});
  await page.reload();await editor(page);await page.locator(`[data-wb="character"][data-id="${id}"]`).click();
  await expect(page.getByLabel("怪物名称",{exact:true})).toHaveValue("幻晶灵猫");
  await expect(page.locator(`[data-id="${id}"] .wb-avatar`)).toHaveCSS("background-image",/data:image\/png;base64/);
  await playCustom(page,id);
  await expect(page.locator(`[data-unit="${id}"] .portrait`)).toHaveCSS("background-image",/data:image\/png;base64/);
  await expect.poll(()=>page.evaluate(()=>window.__uploadedDraws.some(d=>d.width===64 && d.height===64 && d.arguments===5))).toBe(true);
  await screenshot(page,"monster-single-in-battle");
  await page.reload();await expect(page.getByRole("button",{name:"继续",exact:true})).toBeVisible();
  await expect(page.locator(`[data-unit="${id}"] .portrait`)).toHaveCSS("background-image",/data:image\/png;base64/);
  expect(JSON.parse(await draft(page,"session")).sprites[id]).toBe(url);
  await expect.poll(()=>page.evaluate(()=>window.__uploadedDraws.some(d=>d.arguments===5))).toBe(true);
  await page.locator(".battle-toolbar").getByRole("button",{name:"返回编辑",exact:true}).click();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出工程 (ZIP)",exact:true}).click();
  const path=`${artifacts}/${info.project.name}-custom-monster.zip`;await(await download).saveAs(path);
  const zip=readZip(new Uint8Array(readFileSync(path)));expect(Buffer.from(zip.get(`sprites/${id}.png`)!)).toEqual(png);
  const chooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:"导入",exact:true}).click();await(await chooser).setFiles(path);
  await expect(page.locator("#toast")).toContainText("已从 ZIP 导入");
  await page.locator(`[data-wb="character"][data-id="${id}"]`).click();await saved(page);
  project=JSON.parse(await draft(page));expect(project.sprites[id]).toBe(url);
  await screenshot(page,"monster-imported-editor");
  await playCustom(page,id);await expect(page.locator(`[data-unit="${id}"] .portrait`)).toHaveCSS("background-image",/data:image\/png;base64/);
  await page.locator(".battle-toolbar").getByRole("button",{name:"返回编辑",exact:true}).click();
  await page.getByRole("button",{name:"‹ 返回正式试跑",exact:true}).click();await expect(page.locator("#gold-counter")).toHaveText("240");
  expect(errors).toEqual([]);
});

test("行走图怪兽使用上传切片，改ID后仍可战斗，删除清理图片",async({page})=>{
  test.setTimeout(60000);await canvasProbe(page);await page.goto("./");await editor(page);
  const dialog=await openCreation(page);
  await dialog.getByLabel("新怪兽名字",{exact:true}).fill("晶翼蝠");await dialog.getByLabel("怪兽模板",{exact:true}).selectOption("nightwing");
  await dialog.getByLabel("上传怪兽PNG",{exact:true}).setInputFiles({name:"new-bat.png",mimeType:"image/png",buffer:sheet});
  await expect(dialog.locator(".monster-image-info")).toContainText("行走图，16px/帧");
  await screenshot(page,"monster-create-sheet-dialog");await dialog.getByRole("button",{name:"创建怪兽",exact:true}).click();await saved(page);
  expect(JSON.parse(await draft(page)).source.Rules.Profiles.custom_01.LeechMoveMultiplier).toBe(1.4);
  page.once("dialog",d=>d.accept("crystal_bat"));await page.getByRole("button",{name:"修改 ID",exact:true}).click();await saved(page);
  const stored=JSON.parse(await draft(page));expect(stored.sprites.crystal_bat).toContain("data:image/png;base64,");expect(stored.sprites.custom_01).toBeUndefined();
  await playCustom(page,"crystal_bat");
  await expect.poll(()=>page.evaluate(()=>window.__uploadedDraws.some(d=>d.arguments===9 && d.width===48 && d.height===64))).toBe(true);
  await screenshot(page,"monster-sheet-in-battle");
  await page.locator(".battle-toolbar").getByRole("button",{name:"返回编辑",exact:true}).click();
  await page.getByRole("button",{name:"角色 · 43",exact:true}).click();
  page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"删除此怪兽",exact:true}).click();await saved(page);
  expect(JSON.parse(await draft(page)).sprites?.crystal_bat).toBeUndefined();
  await expect(page.getByRole("button",{name:"角色 · 42",exact:true})).toBeVisible();
});

test("制作取消不改草稿，错误PNG、过大文件与错误导入不会覆盖当前内容",async({page})=>{
  await page.goto("./");await editor(page);
  let dialog=await openCreation(page);await expect(dialog.getByRole("button",{name:"创建怪兽",exact:true})).toBeDisabled();
  await dialog.getByLabel("新怪兽名字",{exact:true}).fill("取消的怪兽");await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);await expect(page.getByRole("button",{name:"＋ 新增怪兽",exact:true})).toBeFocused();
  await expect(page.getByRole("button",{name:"角色 · 42",exact:true})).toBeVisible();
  dialog=await openCreation(page);await dialog.getByLabel("新怪兽名字",{exact:true}).fill("错误图片测试");
  await dialog.getByLabel("上传怪兽PNG",{exact:true}).setInputFiles({name:"fake.png",mimeType:"image/png",buffer:Buffer.from("not a PNG")});
  await expect(dialog.locator(".monster-create-error")).toContainText("有效PNG");
  await expect(dialog.getByRole("button",{name:"创建怪兽",exact:true})).toBeDisabled();await screenshot(page,"monster-create-invalid-png");
  await dialog.getByLabel("上传怪兽PNG",{exact:true}).setInputFiles({name:"too-large.png",mimeType:"image/png",buffer:Buffer.alloc(230000)});
  await expect(dialog.locator(".monster-create-error")).toContainText("220KB");
  await dialog.getByLabel("上传怪兽PNG",{exact:true}).setInputFiles({name:"bat.png",mimeType:"image/png",buffer:sheet});
  await expect(dialog.getByRole("button",{name:"创建怪兽",exact:true})).toBeEnabled();
  await dialog.getByRole("button",{name:"取消",exact:true}).click();await expect(page.getByRole("button",{name:"角色 · 42",exact:true})).toBeVisible();
  const before=await page.getByLabel("基础 · 攻击",{exact:true}).inputValue();
  const bad=newProject(raw);const id=createMonster(bad,validateConfig(raw),{name:"损坏的导入",templateId:"moonbat",spriteDataUrl:`data:image/png;base64,${sheet.toString("base64")}`,frameSize:16});bad.sprites![id]="data:image/png;base64,SGVsbG8=";
  const chooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:"导入",exact:true}).click();await(await chooser).setFiles({name:"bad-project.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(bad))});
  await expect(page.locator("#toast")).toContainText("导入失败");await expect(page.getByLabel("基础 · 攻击",{exact:true})).toHaveValue(before);
});
