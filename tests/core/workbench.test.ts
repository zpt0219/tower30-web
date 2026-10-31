import { describe, it, expect } from "vitest";
import raw from "../../data/tower/thirty-floor-trial.json";
import { validateConfig, fingerprint } from "../../src/core/config";
import { TowerEngine } from "../../src/core/engine";
import {
  defaultPlaytestSetup,
  playtestWarnings,
  supportedSkills,
} from "../../src/core/playtest";
import {
  newProject,
  setPath,
  readPath,
  importProject,
  restoreProject,
  validateProject,
} from "../../src/editor/project";
import { combatantAttributes } from "../../src/core/projections";
const config = validateConfig(raw);
function testEngine(floor = 1) {
  const e = TowerEngine.createPlaytest(config, {
    ...defaultPlaytestSetup(),
    floor,
  });
  expect(e.dispatch({ type: "begin" }).ok).toBe(true);
  expect(e.dispatch({ type: "start" }).ok).toBe(true);
  return e;
}
describe("网页工作台草稿与测试", () => {
  it("草稿保留原始全部字段，编辑导出导入不修改基线", () => {
    const original = JSON.stringify(raw),
      draft = newProject(raw);
    setPath(
      draft.source,
      ["Rules", "Combatants", "hero", "Base", "Attack"],
      888,
    );
    expect(readPath(draft.source, ["Rules", "SoulMultipliers"])).toEqual(
      raw.Rules.SoulMultipliers,
    );
    const result = importProject(JSON.stringify(draft));
    expect(
      validateProject(result).config!.Rules.Combatants.hero!.Base.Attack,
    ).toBe(888);
    expect(JSON.stringify(raw)).toBe(original);
    expect(fingerprint(validateConfig(raw))).toBe(fingerprint(config));
  });
  it("42个角色的基础和成长均由同一个核心生效", () => {
    for (const id of Object.keys(config.Rules.Combatants)) {
      const draft = newProject(raw);
      setPath(draft.source, ["Rules", "Combatants", id, "Base", "Attack"], 777);
      setPath(
        draft.source,
        ["Rules", "Combatants", id, "Growth", "Attack"],
        13,
      );
      const c = validateProject(draft).config!;
      const e = TowerEngine.createPlaytest(c, {
        ...defaultPlaytestSetup(),
        party: [id],
        level: 3,
        startingGear: false,
      });
      expect(e.getSnapshot().members[0]!.attributes.Attack).toBe(803);
      expect(e.getSnapshot().members[0]!.level).toBe(3);
    }
  });
  it("全部30关可以独立进入数值测试，正式资源不变且测试奖励隔离", () => {
    const formal = new TowerEngine(config),
      before = formal.serialize();
    for (let floor = 1; floor <= 30; floor++) {
      const e = testEngine(floor);
      e.advance(3);
      expect(e.getSnapshot().floor).toBe(floor);
      expect(e.getSnapshot().mode).toBe("playtest");
      expect(e.getSnapshot().gold).toBe(0);
      expect(e.getSnapshot().records).toEqual([]);
      expect(e.getSnapshot().battle!.units.length).toBeGreaterThan(1);
    }
    expect(formal.serialize()).toBe(before);
  });
  it("改关卡的种类数量、等级和倍率实际影响敌人；测试胜利不发正式奖励", () => {
    const draft = newProject(raw);
    setPath(
      draft.source,
      ["Rules", "Combatants", "hero", "Base", "Attack"],
      1000000,
    );
    setPath(
      draft.source,
      ["Encounters", 29, "Enemies"],
      [
        {
          Species: "slime_dusk",
          Count: 2,
          Level: 2,
          Rank: 1,
          Health: 0.5,
          AttackScale: 0.5,
          DefenseScale: 0,
          Souls: 1,
          Potions: 99,
        },
      ],
    );
    setPath(draft.source, ["Encounters", 29, "Gold"], 9999);
    draft.setup = {
      ...defaultPlaytestSetup(),
      floor: 30,
      party: ["hero"],
      startingGear: false,
    };
    const c = validateProject(draft).config!;
    const e = TowerEngine.createPlaytest(c, draft.setup);
    e.dispatch({ type: "begin" });
    e.dispatch({ type: "start" });
    const s = e.getSnapshot();
    expect(s.battle!.enemies).toHaveLength(2);
    expect(s.battle!.enemies[0]!.hp).toBe(
      Math.ceil(combatantAttributes(c, "slime_dusk", 2).MaxHp * 0.5),
    );
    expect(s.battle!.enemies[0]!.attributes.Defense).toBe(0);
    e.advance(6001);
    expect(e.getSnapshot().battle!.result).toBe("victory");
    expect(e.getSnapshot().items).toEqual({});
    expect(e.getSnapshot().gold).toBe(0);
    expect(e.getSnapshot().floor).toBe(30);
    expect(e.dispatch({ type: "finish" }).ok).toBe(false);
    expect(e.getSnapshot().members).toHaveLength(1);
  });
  it("配置快照、固定种子、命令和战中重载稳定；测试不能导入成正式存档", () => {
    const c = validateConfig(raw),
      setup = { ...defaultPlaytestSetup(), floor: 2 },
      e = TowerEngine.createPlaytest(c, setup);
    e.dispatch({ type: "begin" });
    e.dispatch({ type: "start" });
    const stored = e.getConfigSnapshot().Rules.Combatants.hero!.Base.Attack;
    c.Rules.Combatants.hero!.Base.Attack = 1;
    expect(e.getConfigSnapshot().Rules.Combatants.hero!.Base.Attack).toBe(
      stored,
    );
    e.advance(80);
    const oldRules = JSON.parse(e.serialize()) as { engineVersion: string };
    oldRules.engineVersion = "tower30-ts-workbench-v2";
    expect(() => TowerEngine.restorePlaytest(JSON.stringify(oldRules))).toThrow();
    const loaded = TowerEngine.restorePlaytest(e.serialize());
    e.advance(30);
    loaded.advance(30);
    expect(e.getSnapshot()).toEqual(loaded.getSnapshot());
    expect(() => TowerEngine.restore(config, e.serialize())).toThrow();
    expect(() =>
      TowerEngine.restorePlaytest(new TowerEngine(config).serialize()),
    ).toThrow();
  });
  it("未迁移技能严格模式拒绝，数值模式明确停用而非替换成通用攻击技能", () => {
    const setup = {
      ...defaultPlaytestSetup(),
      floor: 30,
      party: ["ember_dragon"],
      rank: 5,
    };
    expect(playtestWarnings(config, setup).length).toBeGreaterThan(0);
    expect(() =>
      TowerEngine.createPlaytest(config, { ...setup, skillPolicy: "strict" }),
    ).toThrow("未迁移");
    const e = TowerEngine.createPlaytest(config, setup);
    e.dispatch({ type: "begin" });
    e.dispatch({ type: "start" });
    for (let i = 0; i < 100; i++) {
      e.advance(1);
      for (const u of e.getSnapshot().battle!.units) {
        expect(u.passiveLevel).toBe(0);
        if (u.action)
          expect(u.action.skill === "attack" || supportedSkills.has(u.action.skill)).toBe(true);
      }
    }
    expect(e.getSnapshot().skippedFeatures.length).toBeGreaterThan(0);
  });
  it("非法草稿阻止Play，错误字段可保存在浏览器草稿中，导入失败不替换现有工程", () => {
    const draft = newProject(raw);
    setPath(draft.source, ["Rules", "Combatants", "hero", "Base", "MaxHp"], 0);
    expect(validateProject(draft).errors.length).toBeGreaterThan(0);
    expect(restoreProject(JSON.stringify(draft)).source).toEqual(draft.source);
    expect(() => importProject(JSON.stringify(draft))).toThrow();
    expect(() =>
      setPath(draft.source, ["__proto__", "polluted"], true),
    ).toThrow();
  });
  it("吸血按实际扣血恢复，配置预览与战斗使用一致的属性", () => {
    const c = validateConfig(raw);
    c.Rules.Combatants.hero!.Base.Lifesteal = 0.6;
    const setup = {
      ...defaultPlaytestSetup(),
      party: ["hero"],
      hpPercent: 20,
      startingGear: false,
    };
    const yes = TowerEngine.createPlaytest(c, setup);
    c.Rules.Combatants.hero!.Base.Lifesteal = 0;
    const no = TowerEngine.createPlaytest(c, setup);
    for (const e of [yes, no]) {
      e.dispatch({ type: "begin" });
      e.dispatch({ type: "start" });
    }
    for (let i = 0; i < 400; i++) {
      yes.advance(1);
      no.advance(1);
      const a = yes.getSnapshot().battle!.units[0]!,
        b = no.getSnapshot().battle!.units[0]!;
      if (a.damage > 0) {
        expect(a.hp - b.hp).toBe(Math.floor(a.damage * 0.6 + 0.5));
        return;
      }
    }
    throw new Error("未发生有效命中");
  });
});
it("测试参数填错后刷新仍保留全部草稿，修复后可以继续Play", () => {
  const p = newProject(raw);
  setPath(p.source, ["Rules", "Combatants", "hero", "Base", "Attack"], 987);
  p.setup.level = 0;
  const loaded = restoreProject(JSON.stringify(p));
  expect(
    readPath(loaded.source, ["Rules", "Combatants", "hero", "Base", "Attack"]),
  ).toBe(987);
  expect(loaded.setup.level).toBe(0);
  expect(validateProject(loaded).errors.length).toBeGreaterThan(0);
  loaded.setup.level = 2;
  expect(validateProject(loaded).errors).toEqual([]);
});
it("无法容纳的碰撞半径在开战时原子拒绝，不留下半队单位", () => {
  const c = validateConfig(raw);
  for (const d of Object.values(c.Rules.Combatants)) d.Radius = 3;
  const e = TowerEngine.createPlaytest(c, {
    ...defaultPlaytestSetup(),
    party: ["hero", "princess", "slime_dusk", "sproutling", "boar"],
  });
  expect(e.dispatch({ type: "begin" }).ok).toBe(true);
  const before = e.getSnapshot();
  const r = e.dispatch({ type: "start" });
  expect(r.ok).toBe(false);
  expect(r.message).toContain("入场");
  expect(e.getSnapshot()).toEqual(before);
});
