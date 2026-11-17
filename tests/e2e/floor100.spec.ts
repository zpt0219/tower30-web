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

function checkpointF41() {
  const cfg = validateConfig(raw, { allowUnknownEnemySpecies: false });
  const e = new TowerEngine(cfg);
  const score = (
    m: ReturnType<TowerEngine["getSnapshot"]>["members"][number],
    lv: number,
  ) => {
    const a = combatantAttributes(cfg, m.id, lv);
    return (
      a.MaxHp * 0.1 +
      (a.Attack + a.Magic) * 2.6 +
      a.Defense * 0.8 +
      m.rank * 75
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
      (a.Defense ?? 0) * 1.5
    );
  };

  for (let f = 1; f <= 41; f++) {
    if (f === 41) {
      if (
        e
          .getSnapshot()
          .members.some((m) => m.hp <= 0 || m.hp < m.attributes.MaxHp * 0.95)
      ) {
        e.dispatch({ type: "rest" });
      }
      // Refund monsters right before serializing so E2E browser UI tests funneling XP past Lv.30!
      for (const m of e.getSnapshot().members) {
        if (!isHuman(m.id) && m.level > 1) e.dispatch({ type: "refund", id: m.id });
      }
      return e.serialize();
    }
    for (const m of e.getSnapshot().members) {
      if (!isHuman(m.id)) while (e.dispatch({ type: "rank", id: m.id }).ok) {}
    }
    const estLv = Math.max(4, Math.min(32, Math.floor(f * 0.4 + 4)));
    const active = [...e.getSnapshot().members]
      .sort(
        (a, b) =>
          score(b, Math.max(b.level, estLv)) -
          score(a, Math.max(a.level, estLv)),
      )
      .slice(0, 6);
    const activeSet = new Set(active.map((m) => m.id));
    const top3Set = new Set(active.slice(0, 3).map((m) => m.id));

    for (const m of e.getSnapshot().members) {
      if (!isHuman(m.id) && !activeSet.has(m.id) && m.level > 1) {
        e.dispatch({ type: "refund", id: m.id });
      }
    }

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

    if (f >= 12) {
      for (const pid of ["potion_l", "potion_m", "potion_0"]) {
        while (e.getSnapshot().gold >= 300) {
          if (!e.dispatch({ type: "buy", id: pid, quantity: 1 }).ok) break;
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
        .members.some((m) => activeSet.has(m.id) && m.hp <= 0)
    ) {
      e.dispatch({ type: "rest" });
    }

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
          .members.filter(
            (m) => m.hp > 0 && !b.units.some((u) => u.id === m.id),
          )
          .sort(
            (a, b) =>
              (activeSet.has(b.id) ? 1 : 0) - (activeSet.has(a.id) ? 1 : 0) ||
              b.level - a.level,
          )[0];
        if (next) e.dispatch({ type: "reinforce", id: next.id });
      }
      e.advance(6);
    }
    expect(
      e.getBattleSnapshot()!.result,
      `checkpointF41 failed at floor ${f}`,
    ).toBe("victory");
    expect(e.dispatch({ type: "finish" }).ok).toBe(true);
  }
  throw new Error("缺少F41检查点");
}

test("阶段3商店解锁、无限药水突破Lv30与独立Play击败100层终焉Boss", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const file = `${artifacts}/${info.project.name}-f41-checkpoint.json`;
  writeFileSync(file, checkpointF41());

  await page.goto("./");
  await page.getByRole("navigation").getByRole("button", { name: /存档/ }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入存档", exact: true }).click();
  await (await chooser).setFiles(file);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认导入存档", exact: true })
    .click();

  await expect(page.locator("#floor-counter")).toHaveText("41");

  // 1. Check 40 floor battle records + detail dialog
  await page.getByRole("navigation").getByRole("button", { name: "战报", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看行动明细", exact: true })).toHaveCount(40);
  await page.getByRole("button", { name: "查看行动明细", exact: true }).nth(39).click();
  await expect(page.getByRole("dialog").getByRole("columnheader", { name: "出手回能", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();

  // 2. Stage 3 shop verification & purchase
  const goldBefore = Number(await page.locator("#gold-counter").textContent());
  await page.getByRole("navigation").getByRole("button", { name: "商店", exact: true }).click();
  await expect(page.locator(".section-intro")).toContainText("当前阶段 3");
  const row = page
    .locator(".shop-row")
    .filter({ has: page.getByRole("heading", { name: "叶幕杖·大师", exact: true }) });
  await row.getByRole("button", { name: "购买", exact: true }).click();
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(page.locator("#gold-counter")).toHaveText(String(goldBefore - 300));
  await page.screenshot({ path: `${artifacts}/${info.project.name}-shop-stage3.png` });

  // 3. Infinite monster training past Lv.30 (Lv.31 & Lv.32) in Party UI
  await page.getByRole("navigation").getByRole("button", { name: "伙伴", exact: true }).click();
  await page
    .locator(".member-card")
    .filter({ has: page.getByRole("heading", { name: /史莱姆/ }) })
    .getByRole("button", { name: "查看伙伴 →", exact: true })
    .click();
  for (let lv = 2; lv <= 32; lv++) {
    await page.getByRole("button", { name: "药水升级", exact: true }).click();
    await page.getByRole("button", { name: "确认药水升级", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: /史莱姆 Lv\.32/ })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/${info.project.name}-infinite-lv32.png` });

  // Reload confirms persistence of Lv.32 + F41 + purchased gear
  await page.reload();
  await expect(page.locator("#floor-counter")).toHaveText("41");
  await expect(page.locator("#gold-counter")).toHaveText(String(goldBefore - 300));

  // 4. Workbench Playtest on F100 (终焉王座 · 末日撒旦) with Lv.42 R5 endgame party (>Lv.30)
  await page.getByRole("button", { name: "编辑属性与关卡 ▶ Play", exact: true }).click();
  await page.getByRole("button", { name: "测试设置", exact: true }).click();
  await page.getByLabel("测试关卡", { exact: true }).fill("100");
  await page.getByLabel("我方等级", { exact: true }).fill("42");
  await page.getByLabel("怪兽阶数", { exact: true }).fill("5");
  await page.getByLabel("起始能量", { exact: true }).fill("600");
  await page.getByLabel("技能测试模式", { exact: true }).selectOption("strict");

  const partyIds = [
    "hero",
    "princess",
    "minotaur",
    "shaman_orc",
    "flame_warrior",
    "spirit_turtle",
    "treant",
    "medusa",
    "nightmare_dragon",
    "pharaoh_beast",
  ];
  for (let i = 0; i < partyIds.length; i++) {
    const sel = page.locator(`select[data-party="${i}"]`);
    if ((await sel.count()) === 0) {
      await page.getByRole("button", { name: "＋ 添加伙伴", exact: true }).click();
    }
    await sel.selectOption(partyIds[i]!);
  }

  await page.getByRole("button", { name: "▶ Play 第100关", exact: true }).click();
  await expect(page.getByRole("heading", { name: "独立 Play · 第100关", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1× 速度", exact: true }).click();
  await page.getByRole("button", { name: "2× 速度", exact: true }).click();
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
      )) {
        b.click();
      }
    }, 60);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${artifacts}/${info.project.name}-boss100-battle.png` });
  await expect(page.getByRole("heading", { name: "测试胜利", exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.screenshot({ path: `${artifacts}/${info.project.name}-boss100-win.png` });
  expect(errors).toEqual([]);
});
