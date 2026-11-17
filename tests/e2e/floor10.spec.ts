import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { artifactDirectory } from "../../scripts/artifacts";
import { validateConfig } from "../../src/core/config";
import { TowerEngine, isHuman } from "../../src/core/engine";
import { combatantAttributes } from "../../src/core/projections";

const raw: unknown = JSON.parse(
  readFileSync("data/tower/trial.json", "utf8"),
);
const artifacts = artifactDirectory();

function checkpoint(targetFloor: number) {
  const cfg = validateConfig(raw, { allowUnknownEnemySpecies: false });
  const e = new TowerEngine(cfg);
  const score = (
    m: ReturnType<TowerEngine["getSnapshot"]>["members"][number],
    lv: number,
  ) => {
    const prof = cfg.Rules.Profiles[m.id];
    const tier = cfg.Rules.Species[m.id]?.Tier;
    const a = combatantAttributes(cfg, m.id, lv);
    const roleBonus =
      prof?.Role === "healer" ? 220 : prof?.Role === "tank" ? -120 : 120;
    const rareBonus = tier === "传说" ? 360 : tier === "精英" ? 180 : 0;
    return (
      a.MaxHp * 0.1 +
      (a.Attack + a.Magic) * 2.6 +
      a.Defense * 0.8 +
      m.rank * 75 +
      roleBonus +
      rareBonus
    );
  };
  const isGear = (item: string) =>
    cfg.Rules.Equipment.some((g) => g.Id === item);
  const gScore = (mId: string, gId: string) => {
    const g = cfg.Rules.Equipment.find((x) => x.Id === gId);
    if (!g) return -1;
    const a = g.Attributes;
    const atkW = mId === "princess" ? 0.2 : 2.2;
    const magW = mId === "princess" ? 2.4 : 0.2;
    return (
      (a.MaxHp ?? 0) * 0.08 +
      (a.Attack ?? 0) * atkW +
      (a.Magic ?? 0) * magW +
      (a.Defense ?? 0) * 1.5 +
      (a.Haste ?? 0) * 30 +
      (g.Effect ? 20 : 0)
    );
  };

  for (let f = 1; f <= targetFloor; f++) {
    for (const m of e.getSnapshot().members) {
      if (!isHuman(m.id)) while (e.dispatch({ type: "rank", id: m.id }).ok) {}
    }
    const estLv = Math.max(4, Math.min(32, Math.floor(f * 0.4 + 4)));
    const active = [...e.getSnapshot().members]
      .filter((m) => !isHuman(m.id))
      .sort(
        (a, b) =>
          score(b, Math.max(b.level, estLv)) -
          score(a, Math.max(a.level, estLv)),
      )
      .slice(0, 6);
    const activeSet = new Set(active.map((m) => m.id));
    const top3Set = new Set(active.slice(0, 3).map((m) => m.id));

    for (const offer of [...cfg.Economy.Offers].sort(
      (a, b) => b.Stage - a.Stage || b.Price - a.Price,
    )) {
      if (isGear(offer.Item) && offer.Stage <= e.getSnapshot().shopStage) {
        const owned =
          e.getSnapshot().equipment.includes(offer.Item) ||
          e
            .getSnapshot()
            .members.some((m) =>
              Object.values(m.equipment).includes(offer.Item),
            );
        if (
          !owned &&
          e.getSnapshot().gold >= offer.Price + e.getSnapshot().innPrice
        ) {
          e.dispatch({ type: "buy", id: offer.Id, quantity: 1 });
        }
      }
    }

    let trained = true;
    while (trained) {
      trained = false;
      const candidates = e
        .getSnapshot()
        .members.filter((m) => !isHuman(m.id) && activeSet.has(m.id))
        .sort(
          (a, b) =>
            a.level +
            (top3Set.has(a.id) ? 0 : 2) -
            (b.level + (top3Set.has(b.id) ? 0 : 2)),
        );
      for (const c of candidates) {
        if (e.dispatch({ type: "train", id: c.id }).ok) {
          trained = true;
          break;
        }
      }
    }

    for (const mId of ["hero", "princess"]) {
      const candidates = [...e.getSnapshot().equipment].sort(
        (a, b) => gScore(mId, b) - gScore(mId, a),
      );
      for (const gId of candidates) {
        const g = cfg.Rules.Equipment.find((x) => x.Id === gId);
        if (!g) continue;
        const liveM = e.getSnapshot().members.find((x) => x.id === mId)!;
        const cur = liveM.equipment[g.Slot];
        if (!cur || gScore(mId, gId) > gScore(mId, cur)) {
          e.dispatch({ type: "equip", id: mId, gear: gId });
        }
      }
    }

    if (
      e
        .getSnapshot()
        .members.some(
          (m) =>
            (isHuman(m.id) || activeSet.has(m.id)) &&
            (m.hp <= 0 || m.hp < m.attributes.MaxHp * 0.95),
        )
    ) {
      e.dispatch({ type: "rest" });
    }

    if (f === targetFloor) return e.serialize();

    const openingTop = [...e.getSnapshot().members]
      .filter((m) => !isHuman(m.id) && activeSet.has(m.id) && m.hp > 0)
      .sort((a, b) => score(b, b.level) - score(a, a.level))
      .slice(0, 3)
      .map((m) => m.id);
    const wanted = ["hero", "princess", ...openingTop];

    e.dispatch({ type: "begin" });
    for (const id of [...e.getBattleSnapshot()!.opening]) {
      if (id !== "hero" && !wanted.includes(id)) {
        e.dispatch({ type: "opening", id });
      }
    }
    for (const id of wanted) {
      if (id !== "hero" && !e.getBattleSnapshot()!.opening.includes(id)) {
        e.dispatch({ type: "opening", id });
      }
    }
    e.dispatch({ type: "start" });
    for (let t = 0; t < 18000; t++) {
      const b = e.getBattleSnapshot()!;
      if (b.result) break;
      for (const u of b.units) {
        if (!u.enemy && u.hp > 0 && u.energy >= 1000) {
          e.dispatch({ type: "ultimate", id: u.id });
        }
      }
      if (b.tickets > 0 && b.units.filter((u) => !u.enemy && u.hp > 0).length < 5) {
        const next = e
          .getSnapshot()
          .members.find(
            (m) => m.hp > 0 && !b.units.some((u) => u.id === m.id),
          );
        if (next) e.dispatch({ type: "reinforce", id: next.id });
      }
      e.advance(6);
    }
    expect(e.getBattleSnapshot()!.result).toBe("victory");
    expect(e.dispatch({ type: "finish" }).ok).toBe(true);
  }
  throw new Error("缺少Boss前检查点");
}

test("正常资源存档继续挑战10层Boss，结算幂等与阶段1商店解锁", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const file = `${artifacts}/${info.project.name}-boss-checkpoint.json`;
  writeFileSync(file, checkpoint(10));
  await page.goto("./");
  await page.getByRole("navigation").getByRole("button", { name: /存档/ }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入存档", exact: true }).click();
  await (await chooser).setFiles(file);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认导入存档", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "林心守卫 · 荆棘古树", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "准备挑战 →", exact: true }).click();
  await page.getByRole("button", { name: "开始交战 →", exact: true }).click();
  await page.getByRole("button", { name: "1× 速度", exact: true }).click();
  await page.evaluate(() => {
    const handle = setInterval(() => {
      if (document.querySelector(".result-overlay")) {
        clearInterval(handle);
        return;
      }
      for (const b of document.querySelectorAll<HTMLButtonElement>(
        ".battle-unit:not(.reserve):not([disabled])",
      )) {
        b.click();
      }
      for (const b of document.querySelectorAll<HTMLButtonElement>(
        ".battle-unit.reserve:not([disabled])",
      ))
        b.click();
    }, 70);
  });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: `${artifacts}/${info.project.name}-boss-battle.png`,
  });
  await expect(
    page.getByRole("heading", { name: "赢下这一战。", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const action = page.getByRole("button", {
    name: "确认战果 · 返回整备",
    exact: true,
  });
  const bounds = await action.boundingBox();
  const card = await page.locator(".result-card").boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(48);
  const table = await page.locator(".result-card .table-scroll").boundingBox();
  expect(table!.height).toBeGreaterThan(90);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    card!.y + card!.height + 1,
  );
  await page.screenshot({
    path: `${artifacts}/${info.project.name}-boss-win.png`,
  });
  await page
    .getByRole("button", { name: "确认战果 · 返回整备", exact: true })
    .click();
  await expect(page.locator("#floor-counter")).toHaveText("11");
  const gold = await page.locator("#gold-counter").textContent();
  await page.reload();
  await expect(page.locator("#floor-counter")).toHaveText("11");
  await expect(page.locator("#gold-counter")).toHaveText(gold!);
  await page.getByRole("navigation").getByRole("button", { name: "商店", exact: true }).click();
  await expect(page.locator(".section-intro")).toContainText("当前阶段 1");
  const row = page
    .locator(".shop-row")
    .filter({ has: page.getByRole("heading", { name: "铁甲", exact: true }) });
  await row.getByRole("button", { name: "购买", exact: true }).click();
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(page.locator("#gold-counter")).toHaveText(
    String(Number(gold) - 130),
  );
  await page.screenshot({
    path: `${artifacts}/${info.project.name}-boss-shop-unlocked.png`,
  });
  await page.getByRole("navigation").getByRole("button", { name: /存档/ }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出存档 JSON", exact: true })
    .click();
  const exported = `${artifacts}/${info.project.name}-boss-normal-save.json`;
  await (await download).saveAs(exported);
  const final = TowerEngine.restore(
    validateConfig(raw),
    readFileSync(exported, "utf8"),
  ).getSnapshot();
  expect(final.floor).toBe(11);
  expect(final.records).toHaveLength(10);
  expect(final.equipment).toContain("iron_armor");
  expect(final.mode).toBe("run");
  expect(errors).toEqual([]);
});
