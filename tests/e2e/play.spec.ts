import { expect, test, type Page } from "@playwright/test";
import { artifactDirectory } from "../../scripts/artifacts";
const artifactDir = artifactDirectory();
async function nav(page: Page, label: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function start(page: Page) {
  await page.getByRole("button", { name: "准备挑战 →" }).click();
  const startButton = page.getByRole("button", { name: "开始交战 →" });
  const action = await startButton.boundingBox(),
    card = await page.locator(".deployment-card").boundingBox();
  expect(action!.y).toBeGreaterThanOrEqual(card!.y);
  expect(action!.y + action!.height).toBeLessThanOrEqual(
    card!.y + card!.height,
  );
  await page.screenshot({
    path: `${artifactDir}/${test.info().project.name}-deployment.png`,
  });
  await startButton.click();
}
async function fastWin(page: Page) {
  if (await page.getByRole("button", { name: "1× 速度" }).isVisible()) {
    await page.getByRole("button", { name: "1× 速度" }).click();
    await page.getByRole("button", { name: "2× 速度" }).click();
  }
  await expect(page.getByRole("heading", { name: "赢下这一战。" })).toBeVisible(
    { timeout: 20000 },
  );
  await page.getByRole("button", { name: "确认战果 · 返回整备" }).click();
}
async function screenshot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `${artifactDir}/${project}-${name}.png` });
}
test("真实前两层、战报、收集与刷新恢复", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "史莱姆初见" })).toBeVisible();
  await screenshot(page, "tower", info.project.name);
  await start(page);
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1800);
  await screenshot(page, "battle", info.project.name);
  await fastWin(page);
  await expect(page.getByRole("heading", { name: "蘑菇精初见" })).toBeVisible();
  await expect(page.locator("#gold-counter")).toHaveText("305");
  await nav(page, "伙伴");
  await expect(page.getByRole("heading", { name: /史莱姆/ })).toBeVisible();
  await screenshot(page, "party", info.project.name);
  await nav(page, "试炼");
  await start(page);
  await fastWin(page);
  await expect(page.locator("#gold-counter")).toHaveText("370");
  await nav(page, "战报");
  await expect(page.getByRole("heading", { name: /第1层/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /第2层/ })).toBeVisible();
  await screenshot(page, "records", info.project.name);
  await expect(page.locator("#save-status")).toHaveText("已保存到本机");
  await page.reload();
  await expect(page.locator("#floor-counter")).toHaveText("03");
  await expect(page.locator("#gold-counter")).toHaveText("370");
  expect(errors).toEqual([]);
});
test("购买数量、取消不扣钱、装备预览不改变状态、触控滑动与返回", async ({
  page,
}, info) => {
  await page.goto("./");
  await nav(page, "商店");
  const herb = page
    .locator(".shop-row")
    .filter({ has: page.getByRole("heading", { name: "草药", exact: true }) });
  await herb.getByRole("button", { name: "购买", exact: true }).click();
  await page.getByLabel("购买数量").fill("2");
  await expect(page.locator("#buy-quote")).toContainText("24");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator("#gold-counter")).toHaveText("240");
  await herb.getByRole("button", { name: "购买", exact: true }).click();
  await page.getByLabel("购买数量").fill("2");
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(page.locator("#gold-counter")).toHaveText("216");
  await page
    .locator(".shop-row")
    .filter({ has: page.getByRole("heading", { name: "亚麻衣", exact: true }) })
    .getByRole("button", { name: "购买", exact: true })
    .click();
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(page.locator("#gold-counter")).toHaveText("151");
  await screenshot(page, "shop", info.project.name);
  await nav(page, "装备");
  await page.getByRole("button", { name: "主角装备", exact: true }).click();
  await screenshot(page, "equipment", info.project.name);
  await page
    .locator(".gear-slot")
    .nth(1)
    .getByRole("button", { name: "更换", exact: true })
    .click();
  await page.getByRole("button", { name: "查看换装对比" }).click();
  await expect(page.getByRole("dialog")).toContainText("亚麻衣");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".gear-slot").nth(1)).toContainText("未装备");
  await page
    .locator(".gear-slot")
    .nth(1)
    .getByRole("button", { name: "更换", exact: true })
    .click();
  await page.getByRole("button", { name: "查看换装对比" }).click();
  await page.getByRole("button", { name: "确认换装" }).click();
  await expect(page.locator(".gear-slot").nth(1)).toContainText("亚麻衣");
  await screenshot(page, "equipped", info.project.name);
  await nav(page, "图鉴");
  await expect(page.locator("#codex-list>.info-card")).toHaveCount(40);
  await page.getByLabel("查找物种").fill("史莱姆");
  await expect(page.locator("#codex-list>.info-card")).toHaveCount(2);
  await expect(page.locator("#gold-counter")).toHaveText("151");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
});
test("战中刷新保持轨迹、切后台暂停、单步不突跳", async ({
  page,
  context,
}, info) => {
  await page.goto("./");
  await start(page);
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const time = await page.locator("#battle-time").textContent();
  await expect(page.locator("#save-status")).toHaveText("已保存到本机");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "继续", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#battle-time")).toHaveText(time!);
  await page.waitForTimeout(500);
  await expect(page.locator("#battle-time")).toHaveText(time!);
  // Dispatch a browser visibility event with the hidden state to exercise the host adapter.
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "继续", exact: true }),
  ).toBeVisible();
  const hiddenTime = await page.locator("#battle-time").textContent();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#battle-time")).toHaveText(hiddenTime!);
  await page.getByText("调试 · 固定步长 / 战斗事件").click();
  await page.getByRole("button", { name: "单步 0.05秒" }).click();
  const next = Number(
    (await page.locator("#battle-time").textContent())!.slice(0, -1),
  );
  expect(next - Number(hiddenTime!.slice(0, -1))).toBeCloseTo(0.05, 5);
  await screenshot(page, "paused", info.project.name);
  await context.clearCookies();
});
test("实际触控滑动不购买，二级返回保留装备筛选", async ({
  page,
  context,
}, info) => {
  await page.goto("./");
  await nav(page, "装备");
  await page.getByRole("button", { name: "防具", exact: true }).click();
  await page.getByRole("button", { name: "主角装备", exact: true }).click();
  await page.getByRole("button", { name: "‹ 返回", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "防具", exact: true }),
  ).toHaveClass("active");
  await nav(page, "商店");
  if (info.project.name === "mobile-landscape") {
    const target = page
        .locator(".shop-row")
        .nth(2)
        .getByRole("button", { name: "购买", exact: true }),
      scroller = page.locator(".page-scroll");
    await target.scrollIntoViewIfNeeded();
    const beforeScroll = await scroller.evaluate((el) => el.scrollTop),
      rect = await target.boundingBox();
    expect(rect).not.toBeNull();
    const x = rect!.x + rect!.width / 2,
      y = rect!.y + rect!.height / 2,
      cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - step * 20 }],
      });
      await page.waitForTimeout(25);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.locator(".page-scroll").evaluate((el) => el.scrollTop),
    ).toBeGreaterThan(beforeScroll);
    await cdp.detach();
  } else {
    await page.locator(".page-scroll").hover();
    await page.mouse.wheel(0, 300);
  }
  await expect(page.locator("#gold-counter")).toHaveText("240");
});
test("损坏主存档回退备份，双损坏不静默覆盖且可导出原件", async ({ page }) => {
  // Fault injection isolates on-disk corruption from the normal unload autosave.
  await page.addInitScript(() => {
    window.addEventListener(
      "pagehide",
      (e) => e.stopImmediatePropagation(),
      true,
    );
    document.addEventListener(
      "visibilitychange",
      (e) => e.stopImmediatePropagation(),
      true,
    );
  });
  await page.goto("./");
  await nav(page, "商店");
  await page
    .locator(".shop-row")
    .filter({ has: page.getByRole("heading", { name: "草药", exact: true }) })
    .getByRole("button", { name: "购买", exact: true })
    .click();
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(page.locator("#save-status")).toHaveText("已保存到本机");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("tower30-web-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("saves", "readwrite"),
        store = tx.objectStore("saves"),
        r = store.get("current");
      r.onsuccess = () => {
        store.put(r.result, "backup");
        store.put("{broken", "current");
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.goto("./");
  await expect(page.locator("#save-status")).toHaveText("已从备份恢复");
  await expect(page.locator("#gold-counter")).toHaveText("228");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("tower30-web-v1");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put("{broken", "current");
      tx.objectStore("saves").put("{brokenBackup", "backup");
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.goto("./");
  await expect(page.locator("#save-status")).toHaveText(
    "原存档无法读取 · 未覆盖",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "⚙ 存档", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "导出故障原件" }),
  ).toBeVisible();
});
