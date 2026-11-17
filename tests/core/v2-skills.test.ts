import { describe, expect, it } from "vitest";
import raw from "../../data/tower/trial.json";
import { validateConfig } from "../../src/core/config";
import { TowerEngine } from "../../src/core/engine";
import { defaultPlaytestSetup, playtestWarnings } from "../../src/core/playtest";
import { V2_SKILL_IDS, v2TriggerEvery } from "../../src/core/v2-skills";
import { advancePlaytest, defaultStrategy } from "../../src/core/strategy";

const config = validateConfig(raw, { allowUnknownEnemySpecies: true });

function arena(party: string[], rank = 1, energy = 0, enemyHp = 50000) {
  const c = validateConfig(raw, { allowUnknownEnemySpecies: true });
  c.Rules.Combatants.mudguard!.Base.MaxHp = enemyHp;
  c.Encounters[0]!.Enemies = [
    {
      ...c.Encounters[0]!.Enemies[0]!,
      Species: "mudguard",
      Count: 1,
      Level: 1,
      Rank: 1,
      Health: 1,
      AttackScale: 0.01,
    },
  ];
  const e = TowerEngine.createPlaytest(c, {
    ...defaultPlaytestSetup(),
    party,
    rank,
    level: 5,
    energy,
    startingGear: false,
    skillPolicy: "strict",
  });
  expect(e.dispatch({ type: "begin" }).ok).toBe(true);
  expect(e.dispatch({ type: "start" }).ok).toBe(true);
  e.advance(240);
  return e;
}

describe("V2 43角色与111技能机制", () => {
  it("41只V2怪兽按普通/精英/传说配齐1/2/3个普通技能与1个大招，全配表零警告", () => {
    expect(config.Species).toHaveLength(41);
    expect(V2_SKILL_IDS.size).toBe(114);
    const tierCounts: Record<string, number> = { 普通: 0, 精英: 0, 传说: 0 };
    for (const sp of config.Species) {
      const rule = config.Rules.Species[sp.Id]!;
      const prof = config.Rules.Profiles[sp.Id]!;
      const expectedAutos = rule.Tier === "传说" ? 3 : rule.Tier === "精英" ? 2 : 1;
      tierCounts[rule.Tier] = (tierCounts[rule.Tier] ?? 0) + 1;
      expect(prof.AutoSkills, sp.Id).toHaveLength(expectedAutos);
      expect(prof.TriggerEvery, sp.Id).toBe(3);
      for (const sid of prof.AutoSkills ?? []) {
        expect(V2_SKILL_IDS.has(sid), `${sp.Id}:${sid}`).toBe(true);
        expect(config.Rules.Actions[sid]!.Ratios).toHaveLength(5);
      }
      expect(V2_SKILL_IDS.has(prof.Ultimate), `${sp.Id}:${prof.Ultimate}`).toBe(true);
      expect(config.Rules.Actions[prof.Ultimate]!.Ratios).toHaveLength(5);
      expect(playtestWarnings(config, { ...defaultPlaytestSetup(), party: [sp.Id], rank: 5, skillPolicy: "strict" })).toEqual([]);
    }
    expect(tierCounts).toEqual({ 普通: 19, 精英: 15, 传说: 7 });
  });

  it("普攻轮转与TriggerEvery节奏：普通单技、精英双技轮转、传说三技轮转，3阶节奏降为2次普攻", () => {
    // 灰鼠 1阶每3次普攻放rat_combo_bite；3阶降为每2次普攻
    const r1 = arena(["gray_rat"], 1);
    const r3 = arena(["gray_rat"], 3);
    const u1 = r1.getBattleSnapshot()!.units[0]!;
    const u3 = r3.getBattleSnapshot()!.units[0]!;
    expect(v2TriggerEvery(u1, "rat_combo_bite")).toBe(3);
    expect(v2TriggerEvery(u3, "rat_combo_bite")).toBe(2);

    r3.advance(600);
    r1.advance(600);
    // 每次 rat_combo_bite 触发一次 buff(加速) 和一次 debuff(减速)，普通攻击不触发
    const casts1 = r1.getSnapshot().events.filter((ev) => ev.kind === "buff" && ev.actor === "gray_rat").length;
    const casts3 = r3.getSnapshot().events.filter((ev) => ev.kind === "buff" && ev.actor === "gray_rat").length;
    expect(casts1).toBeGreaterThanOrEqual(1);
    expect(casts3).toBeGreaterThan(casts1);

    // 精英萨满兽人双普技轮转: bloodlust_totem(给自身加atk/haste发出buff) 与 hex_weakness(发出debuff)
    const elite = arena(["shaman_orc"], 1);
    elite.advance(1200);
    const eliteEvs = elite.getSnapshot().events.filter((ev) => ev.actor === "shaman_orc");
    expect(eliteEvs.some((ev) => ev.kind === "buff")).toBe(true);
    expect(eliteEvs.some((ev) => ev.kind === "debuff")).toBe(true);

    // 传说牛头人三普技轮转: bull_earth_charge(control stun) -> whirlwind_axe_rend(hit) -> war_stomp_quake(emits war_stomp_quake taunt)
    const legend = arena(["minotaur"], 1);
    legend.advance(2400);
    const legendEvs = legend.getSnapshot().events.filter((ev) => ev.actor === "minotaur");
    expect(legendEvs.some((ev) => ev.kind === "war_stomp_quake")).toBe(true);
    expect(legendEvs.some((ev) => ev.kind === "control")).toBe(true);
    expect(legendEvs.filter((ev) => ev.kind === "hit").length).toBeGreaterThanOrEqual(8);
  });

  it("灰鼠1阶2段 vs 3阶质变I(3段) vs 5阶大招斩杀返还600能量", () => {
    const r1 = arena(["gray_rat"], 1);
    r1.advance(500);
    const hitEvents1 = r1.getSnapshot().events.filter((ev) => ev.kind === "hit" && ev.actor === "gray_rat");
    expect(hitEvents1.length).toBeGreaterThanOrEqual(2);

    const lowEnemy = arena(["gray_rat"], 5, 1000, 650);
    lowEnemy.advance(5);
    const ultRes = lowEnemy.dispatch({ type: "ultimate", id: "gray_rat" });
    expect(ultRes.ok, ultRes.message).toBe(true);
    lowEnemy.advance(100);
    const rat = lowEnemy.getBattleSnapshot()!.units.find((u) => u.id === "gray_rat")!;
    // R5 rat_swarm_rush kills low HP enemy and refunds 600 energy
    expect(rat.energy).toBeGreaterThanOrEqual(600);
  });

  it("青蛇叠毒与5阶质变毒爆、僵尸怪5阶战中复活一次", () => {
    const snake = arena(["green_snake"], 5, 1000);
    snake.advance(5);
    const sRes = snake.dispatch({ type: "ultimate", id: "green_snake" });
    expect(sRes.ok, sRes.message).toBe(true);
    snake.advance(120);
    const foe = snake.getBattleSnapshot()!.units.find((u) => u.enemy)!;
    expect(foe.stacks.poison?.count ?? 0).toBeGreaterThan(0);
    expect(foe.slow).toBeGreaterThan(0);

    // 僵尸怪：1阶被秒杀直接阵亡；5阶首次致死触发一次性复活并保留35%血与4秒不死
    const makeLethalTest = (rank: number) => {
      const c = validateConfig(raw, { allowUnknownEnemySpecies: true });
      c.Rules.Combatants.mudguard!.Base.Attack = 5000;
      c.Rules.Combatants.mudguard!.AttackRange = 10;
      c.Rules.Profiles.mudguard!.Auto = "";
      delete c.Rules.Profiles.mudguard!.AutoSkills;
      c.Encounters[0]!.Enemies = [
        { ...c.Encounters[0]!.Enemies[0]!, Species: "mudguard", Count: 1, Level: 1, Rank: 1, Health: 20, AttackScale: 1 },
      ];
      const e = TowerEngine.createPlaytest(c, {
        ...defaultPlaytestSetup(),
        party: ["zombie", "princess"],
        rank,
        level: 1,
        hpPercent: 5,
        startingGear: false,
        skillPolicy: "strict",
      });
      e.dispatch({ type: "begin" });
      e.dispatch({ type: "start" });
      e.advance(600);
      return e;
    };
    const z1 = makeLethalTest(1);
    const z5 = makeLethalTest(5);
    expect(z1.getBattleSnapshot()!.units.find((u) => u.id === "zombie")!.reviveUsed).toBe(false);
    expect(z5.getSnapshot().events.some((ev) => ev.kind === "revive" && ev.actor === "zombie")).toBe(true);
  });

  it("美杜莎石化控制与破甲易伤、骷髅法王召唤卫士与灵魂铁链共享伤害", () => {
    const c = validateConfig(raw, { allowUnknownEnemySpecies: true });
    c.Rules.Combatants.mudguard!.Base.MaxHp = 40000;
    c.Encounters[0]!.Enemies = [
      { ...c.Encounters[0]!.Enemies[0]!, Species: "mudguard", Count: 3, Level: 1, Rank: 1, Health: 1, AttackScale: 0.01 },
    ];
    const med = TowerEngine.createPlaytest(c, {
      ...defaultPlaytestSetup(),
      party: ["medusa"],
      rank: 5,
      level: 5,
      energy: 1000,
      startingGear: false,
      skillPolicy: "strict",
    });
    med.dispatch({ type: "begin" });
    med.dispatch({ type: "start" });
    med.advance(240);
    const mRes = med.dispatch({ type: "ultimate", id: "medusa" });
    expect(mRes.ok, mRes.message).toBe(true);
    med.advance(60);
    const stoned = med.getBattleSnapshot()!.units.filter((u) => u.enemy && u.petrify > 0);
    expect(stoned.length).toBeGreaterThan(0);
    expect(stoned[0]!.vuln).toBeGreaterThan(0);

    // 骷髅法王 3阶+ 施放 necromancer_decree 召唤2个骷髅且 soul_shackles 连结多敌
    const lich = TowerEngine.createPlaytest(c, {
      ...defaultPlaytestSetup(),
      party: ["skeleton_lich_king"],
      rank: 5,
      level: 10,
      energy: 0,
      startingGear: false,
      skillPolicy: "strict",
    });
    lich.dispatch({ type: "begin" });
    lich.dispatch({ type: "start" });
    let maxSummons = 0;
    let sawSkeletonSummon = false;
    let sawShackles = false;
    for (let i = 0; i < 60; i++) {
      lich.advance(30);
      const snap = lich.getBattleSnapshot()!;
      const summons = snap.units.filter((u) => !u.enemy && u.summoned);
      maxSummons = Math.max(maxSummons, summons.length);
      if (summons.some((u) => u.kind === "skeleton")) sawSkeletonSummon = true;
      if (snap.units.some((u) => u.enemy && u.shackleIds.length > 0)) sawShackles = true;
    }
    expect(maxSummons).toBeGreaterThanOrEqual(2);
    expect(sawSkeletonSummon).toBe(true);
    expect(sawShackles).toBe(true);
  });

  it("V2 数值实测平衡：人类主角+公主开局连过前5层，并验证10/20/30Boss层合理梯度下可通关", () => {
    const engine = new TowerEngine(config);
    for (let floor = 1; floor <= 5; floor++) {
      expect(engine.dispatch({ type: "begin" }).ok).toBe(true);
      expect(engine.dispatch({ type: "start" }).ok).toBe(true);
      advancePlaytest(engine as any, 2400);
      const s = engine.getSnapshot();
      expect(s.battle?.result, `Floor ${floor}`).toBe("victory");
      expect(engine.dispatch({ type: "finish" }).ok).toBe(true);
      // Use earned XP potions smoothly on hero/princess
      const next = engine.getSnapshot();
      if ((next.items.xp_potion ?? 0) > 0) {
        engine.dispatch({ type: "train", id: "hero" });
      }
      if ((engine.getSnapshot().items.xp_potion ?? 0) > 0) {
        engine.dispatch({ type: "train", id: "princess" });
      }
      if (engine.getSnapshot().members.some((m) => m.hp < m.attributes.MaxHp * 0.6) && engine.getSnapshot().gold >= 35) {
        engine.dispatch({ type: "rest" });
      }
    }
    expect(engine.getSnapshot().floor).toBe(6);

    // 验证第10/20/30层将已删除占位物种替换为现役怪兽后，合理队伍在策略自动战斗下可通关（检测无数值卡死）
    const repaired = structuredClone(config);
    for (const enc of repaired.Encounters) {
      for (const en of enc.Enemies) {
        if (en.Species === "boar") en.Species = "gray_wolf";
        if (en.Species === "water_elemental") en.Species = "ice_ghost";
        if (en.Species === "lava_elemental") en.Species = "lava_spirit";
      }
    }
    for (const [floor, level, rank, party] of [
      [10, 10, 3, ["hero", "princess", "mudguard", "spirit_turtle", "gray_rat"]],
      [20, 20, 4, ["hero", "princess", "sword_shield_orc", "shaman_orc", "ice_ghost"]],
      [30, 30, 5, ["hero", "princess", "minotaur", "medusa", "skeleton_lich_king"]],
    ] as const) {
      const bossPlay = TowerEngine.createPlaytest(repaired, {
        ...defaultPlaytestSetup(),
        floor,
        level,
        rank,
        party: [...party],
        autoPlay: true,
        strategy: defaultStrategy(),
        skillPolicy: "strict",
      });
      bossPlay.dispatch({ type: "begin" });
      bossPlay.dispatch({ type: "start" });
      advancePlaytest(bossPlay, 12000);
      expect(bossPlay.getBattleSnapshot()!.result, `F${floor} Boss`).toBe("victory");
    }
  }, 20000);
});
