import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { artifactDirectory } from "../../scripts/artifacts";
const artifacts = artifactDirectory();
async function openEditor(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "工作台", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "编辑与 Play", exact: true }),
  ).toBeVisible();
}
async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `${artifacts}/${test.info().project.name}-${name}.png`,
  });
}
async function saveReady(page: Page) {
  await expect(page.locator("#wb-save-status")).toHaveText(
    "草稿已保存到浏览器",
  );
}
async function readSession(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("tower30-web-v1");
      r.onsuccess = () => resolve(r.result);
    });
    const value = await new Promise<string>((resolve) => {
      const tx = db.transaction("workbench", "readonly"),
        r = tx.objectStore("workbench").get("session");
      tx.oncomplete = () => resolve(r.result as string);
    });
    db.close();
    return value;
  });
}
test("网页改角色与关卡，Play第30关实际生效；返回继续编辑且正式金币不变", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "商店", exact: true })
    .click();
  await page
    .locator(".shop-row")
    .filter({ has: page.getByRole("heading", { name: "草药", exact: true }) })
    .getByRole("button", { name: "购买", exact: true })
    .click();
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(page.locator("#gold-counter")).toHaveText("228");
  await openEditor(page);
  await page.getByLabel("基础 · 生命", { exact: true }).fill("12000");
  await page.getByLabel("基础 · 攻击", { exact: true }).fill("9000");
  await expect(page.locator("#wb-preview")).toContainText("9006");
  await saveReady(page);
  await shot(page, "editor-character");
  await page.getByRole("button", { name: "关卡 · 30", exact: true }).click();
  await expect(page.locator('#wb-list>[data-wb="floor"]')).toHaveCount(30);
  await page.locator("#wb-list").getByRole("button", { name: /^30/ }).click();
  while ((await page.locator('[data-wb="group"]').count()) > 1)
    await page
      .getByRole("button", { name: "删除当前敌组", exact: true })
      .click();
  await page
    .getByLabel("关卡名称", { exact: true })
    .fill("第30关 · 工作台测试");
  await page.getByLabel("敌人物种", { exact: true }).selectOption("slime_dusk");
  await page.getByLabel("敌人数量", { exact: true }).fill("1");
  await page.getByLabel("敌人等级", { exact: true }).fill("1");
  await page.getByLabel("敌人阶数", { exact: true }).fill("1");
  await page.getByLabel("生命倍率", { exact: true }).fill("0.1");
  await page.getByLabel("攻击／法术倍率", { exact: true }).fill("0.1");
  await page.getByLabel("防御倍率", { exact: true }).fill("0");
  await saveReady(page);
  await shot(page, "editor-level30");
  await page
    .getByRole("button", { name: "▶ Play 第30关", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "独立 Play · 第30关", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#unit-hp-hero")).toHaveText("12000 / 12000");
  await page.getByRole("button", { name: "1× 速度" }).click();
  await page.getByRole("button", { name: "2× 速度" }).click();
  await expect(
    page.getByRole("heading", { name: "测试胜利", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await shot(page, "editor-play-result");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出测试记录", exact: true }).click();
  await (
    await download
  ).saveAs(`${artifacts}/${test.info().project.name}-playtest-record.json`);
  const saved = JSON.parse(
    readFileSync(
      `${artifacts}/${test.info().project.name}-playtest-record.json`,
      "utf8",
    ),
  );
  expect(saved.format).toBe("tower30-playtest");
  expect(saved.config.Rules.Combatants.hero.Base.Attack).toBe(9000);
  expect(saved.config.Encounters[29].Enemies[0].Health).toBe(0.1);
  expect(saved.setup.floor).toBe(30);
  await page
    .locator(".result-card")
    .getByRole("button", { name: "返回编辑", exact: true })
    .click();
  await expect(page.getByLabel("敌人数量", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("关卡名称", { exact: true })).toHaveValue(
    "第30关 · 工作台测试",
  );
  await page
    .getByRole("button", { name: "‹ 返回正式试跑", exact: true })
    .click();
  await expect(page.locator("#floor-counter")).toHaveText("01");
  await expect(page.locator("#gold-counter")).toHaveText("228");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "战报", exact: true })
    .click();
  await expect(page.getByText("0 层实际通过", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("非法属性阻止Play，草稿刷新可恢复，工程导出导入保留原字段", async ({
  page,
}) => {
  await page.goto("./");
  await openEditor(page);
  await expect(page.locator('#wb-list>[data-wb="character"]')).toHaveCount(42);
  await page.getByLabel("基础 · 生命", { exact: true }).fill("0");
  await expect(page.locator("#wb-validation")).toContainText("配置有误");
  await expect(
    page.getByRole("button", { name: "▶ Play 第1关", exact: true }),
  ).toBeDisabled();
  await saveReady(page);
  await page.reload();
  await openEditor(page);
  await expect(page.getByLabel("基础 · 生命", { exact: true })).toHaveValue(
    "0",
  );
  await page.getByLabel("基础 · 生命", { exact: true }).fill("12345");
  await page.getByRole("button", { name: "每级成长", exact: true }).click();
  await page.getByLabel("成长 · 攻击", { exact: true }).fill("21");
  await saveReady(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工程", exact: true }).click();
  const file = `${artifacts}/${test.info().project.name}-editor-project.json`;
  await (await download).saveAs(file);
  const exported = JSON.parse(readFileSync(file, "utf8"));
  expect(exported.source.Rules.Combatants.hero.Base.MaxHp).toBe(12345);
  expect(exported.source.Rules.Combatants.hero.Growth.Attack).toBe(21);
  expect(exported.source.Rules.SoulMultipliers).toEqual([1, 1.5, 2, 2.5, 3]);
  await page.getByLabel("成长 · 攻击", { exact: true }).fill("99");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByLabel("成长 · 攻击", { exact: true })).toHaveValue(
    "21",
  );
  const bad = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await (
    await bad
  ).setFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"Species":[]}'),
  });
  await expect(page.locator("#toast")).toContainText("导入失败");
  await expect(page.getByLabel("成长 · 攻击", { exact: true })).toHaveValue(
    "21",
  );
  await shot(page, "editor-growth-import");
});
test("工作台Play测试中刷新恢复同一快照，草稿修改不改变上次测试配置", async ({
  page,
}) => {
  await page.goto("./");
  await openEditor(page);
  await page.getByLabel("基础 · 生命", { exact: true }).fill("12345");
  await page
    .getByRole("button", { name: "▶ Play 第1关", exact: true })
    .click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.locator("#save-status")).toHaveText("测试已保存");
  const before = await readSession(page),
    time = await page.locator("#battle-time").textContent();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "独立 Play · 第1关", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "继续", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#battle-time")).toHaveText(time!);
  await expect(page.locator("#unit-hp-hero")).toContainText("12345");
  await page
    .locator(".battle-toolbar")
    .getByRole("button", { name: "返回编辑", exact: true })
    .click();
  await page.getByLabel("基础 · 生命", { exact: true }).fill("22345");
  await saveReady(page);
  const frozen = JSON.parse(JSON.parse(await readSession(page)).serialized);
  expect(frozen.config.Rules.Combatants.hero.Base.MaxHp).toBe(12345);
  expect(
    JSON.parse(JSON.parse(before).serialized).config.Rules.Combatants.hero.Base
      .MaxHp,
  ).toBe(12345);
  await page
    .getByRole("button", { name: "▶ Play 第1关", exact: true })
    .click();
  await expect(page.locator("#unit-hp-hero")).toHaveText("22345 / 22345");
  await shot(page, "editor-second-play");
});
test("原始第30关与高级怪兽可在数值模式测试，未迁移技能明确标出", async ({
  page,
}) => {
  await page.goto("./");
  await openEditor(page);
  await page.getByRole("button", { name: "关卡 · 30", exact: true }).click();
  await page.locator("#wb-list").getByRole("button", { name: /^30/ }).click();
  await page.getByRole("button", { name: "测试设置", exact: true }).click();
  await page
    .getByLabel("我方伙伴1", { exact: true })
    .selectOption("ember_dragon");
  await page.getByLabel("我方等级", { exact: true }).fill("20");
  await page.getByLabel("技能测试模式", { exact: true }).selectOption("strict");
  await expect(
    page.getByRole("button", { name: "▶ Play 第30关", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#wb-validation")).toContainText("未迁移");
  await page
    .getByLabel("技能测试模式", { exact: true })
    .selectOption("supported-only");
  await saveReady(page);
  await shot(page, "editor-test-setup");
  await page
    .getByRole("button", { name: "▶ Play 第30关", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "独立 Play · 第30关", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".test-warnings summary")).toContainText(
    "未迁移功能",
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.locator("#save-status")).toHaveText("测试已保存");
  const session = JSON.parse(JSON.parse(await readSession(page)).serialized);
  expect(session.setup.party).toEqual(["ember_dragon", "princess"]);
  expect(session.config.Encounters[29].Boss).toBe(true);
  await shot(page, "editor-boss30-test");
});
test("超过敌人上限的草稿仍能编辑新增敌组并删除修复", async ({ page }) => {
  await page.goto("./");
  await openEditor(page);
  await page.getByRole("button", { name: "关卡 · 30", exact: true }).click();
  await page.getByLabel("敌人数量", { exact: true }).fill("12");
  await page.getByRole("button", { name: "＋ 增加敌组", exact: true }).click();
  await page.getByLabel("敌人数量", { exact: true }).fill("5");
  await expect(page.locator("#wb-validation")).toContainText("配置有误");
  await expect(
    page.getByRole("button", { name: "▶ Play 第1关", exact: true }),
  ).toBeDisabled();
  await expect(page.locator('[data-wb="group"]')).toHaveCount(2);
  await page.getByRole("button", { name: "删除当前敌组", exact: true }).click();
  await expect(page.locator('[data-wb="group"]')).toHaveCount(1);
  await expect(page.getByLabel("敌人数量", { exact: true })).toHaveValue("12");
  await expect(
    page.getByRole("button", { name: "▶ Play 第1关", exact: true }),
  ).toBeEnabled();
});
