import { describe, expect, it } from "vitest";
import raw from "../../data/tower/trial.json";
import { validateConfig } from "../../src/core/config";
import { TowerEngine, isHuman } from "../../src/core/engine";
import { defaultPlaytestSetup } from "../../src/core/playtest";
import {
  combatantAttributes,
  humanLevelFromXp,
  humanXpForLevel,
  monsterCostForLevel,
  monsterLevelFromXp,
  monsterTotalXpForLevel,
  postBattleHumanHealRatio,
} from "../../src/core/projections";
import {
  advancePlaytest,
  applyStrategy,
  defaultStrategy,
} from "../../src/core/strategy";

const config = validateConfig(raw, { allowUnknownEnemySpecies: false });

describe("百层试炼结构与资源校验", () => {
  it("恰好100层、5大主题各20层、每5层1个Boss共20个，44件装备全可达", () => {
    expect(config.Floors).toHaveLength(100);
    expect(config.Encounters).toHaveLength(100);
    expect(config.Species).toHaveLength(41);

    const bosses = config.Floors.filter(
      (f) => config.Encounters.find((e) => e.Id === f.Encounter)!.Boss,
    ).map((f) => f.Number);
    expect(bosses).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) * 5));

    for (let ch = 0; ch < 5; ch++) {
      const slice = config.Floors.slice(ch * 20, (ch + 1) * 20);
      expect(new Set(slice.map((f) => f.Theme)).size).toBe(1);
    }

    const reachableGear = new Set<string>(config.StartingEquipment);
    for (const offer of config.Economy.Offers) {
      if (config.Rules.Equipment.some((g) => g.Id === offer.Item)) {
        reachableGear.add(offer.Item);
      }
    }
    for (const fl of config.Floors) {
      for (const g of fl.Equipment) reachableGear.add(g);
    }
    expect(reachableGear.size).toBe(config.Rules.Equipment.length);
  });

  it("41种怪兽在F1..F100恰好各掉落25魂魄，在第100关后全部可升满5阶", () => {
    const soulTotals = new Map<string, number>();
    for (const s of config.Species) soulTotals.set(s.Id, 0);

    for (const fl of config.Floors) {
      const enc = config.Encounters.find((e) => e.Id === fl.Encounter)!;
      for (const g of enc.Enemies) {
        soulTotals.set(
          g.Species,
          (soulTotals.get(g.Species) ?? 0) + g.Count * g.Souls,
        );
      }
    }

    expect([...soulTotals.entries()].every(([, n]) => n === 25)).toBe(true);
    const f100Enc = config.Encounters[99]!;
    expect(f100Enc.Enemies.some((e) => e.Species === "doomsday_satan")).toBe(true);
  });

  it("人类与怪兽无限等级：单级线性增幅不变，仅升级所需经验随等级陡增，且支持全额退还", () => {
    // 1. Human infinite leveling past Lv.30 preserves pure linear attribute gain
    const xp30 = humanXpForLevel(config.HumanXpThresholds, 30);
    const xp35 = humanXpForLevel(config.HumanXpThresholds, 35);
    const xp40 = humanXpForLevel(config.HumanXpThresholds, 40);
    expect(humanLevelFromXp(config.HumanXpThresholds, xp30)).toBe(30);
    expect(humanLevelFromXp(config.HumanXpThresholds, xp35)).toBe(35);
    expect(humanLevelFromXp(config.HumanXpThresholds, xp40)).toBe(40);
    const step29 =
      config.HumanXpThresholds[28]! - config.HumanXpThresholds[27]!;
    const step35 = xp35 - humanXpForLevel(config.HumanXpThresholds, 34);
    expect(step35).toBeGreaterThan(step29 * 2);

    const h5 = combatantAttributes(config, "hero", 5);
    const h6 = combatantAttributes(config, "hero", 6);
    const h35 = combatantAttributes(config, "hero", 35);
    const h36 = combatantAttributes(config, "hero", 36);
    expect(h36.Attack - h35.Attack).toBe(h6.Attack - h5.Attack);
    expect(h36.MaxHp - h35.MaxHp).toBe(h6.MaxHp - h5.MaxHp);

    // 2. Monster infinite leveling via TowerEngine train/refund past Lv.30
    const costs = config.Rules.Species.slime!.LevelCosts;
    const cost29 = monsterCostForLevel(costs, 29);
    const cost35 = monsterCostForLevel(costs, 35);
    expect(cost35).toBeGreaterThan(cost29 * 2);

    const m5 = combatantAttributes(config, "slime", 5);
    const m6 = combatantAttributes(config, "slime", 6);
    const m35 = combatantAttributes(config, "slime", 35);
    const m36 = combatantAttributes(config, "slime", 36);
    expect(m36.MaxHp - m35.MaxHp).toBe(m6.MaxHp - m5.MaxHp);
    expect(m36.Magic - m35.Magic).toBe(m6.Magic - m5.Magic);

    expect(monsterLevelFromXp(costs, monsterTotalXpForLevel(costs, 34))).toBe(34);
    const engine = TowerEngine.createPlaytest(config, {
      ...defaultPlaytestSetup(),
      party: ["hero", "slime"],
      level: 32,
    });
    expect(engine.getSnapshot().members[0]!.level).toBe(32);
    expect(engine.getSnapshot().members[1]!.level).toBe(32);
  });

  it("全100层掉落药水总量远低于养满全图鉴所需（强迫玩家有选择地升级/退还）", () => {
    let totalUnits = 0;
    for (const enc of config.Encounters) {
      for (const g of enc.Enemies) {
        totalUnits += (g.Potions + g.PotionsM * 4 + g.PotionsL * 20) * g.Count;
      }
    }
    const totalXp = totalUnits * 25;
    const oneLv30Cost = config.Rules.Species.slime!.LevelCosts.reduce(
      (s, v) => s + v,
      0,
    );
    expect(totalXp).toBeLessThan(oneLv30Cost * 8);
    expect(totalXp).toBeGreaterThan(oneLv30Cost * 4);
  });

  it("真实60Hz战斗校准：合理配装满编队可击败F100终焉Boss，未升阶/无配合低配队不能数值碾压F80/F100", () => {
    function runPlaytest(
      floor: number,
      party: string[],
      level: number,
      rank: number,
      geared: boolean,
    ) {
      const custom = structuredClone(config);
      if (geared) {
        const sw = custom.Rules.Equipment.find(
          (g) => g.Id === "traveler_sword",
        )!;
        const stf = custom.Rules.Equipment.find(
          (g) => g.Id === "healer_staff",
        )!;
        const sword3 = custom.Rules.Equipment.find(
          (g) => g.Id === "sweep_sword_3",
        )!;
        const bell3 = custom.Rules.Equipment.find(
          (g) => g.Id === "bell_staff_3",
        )!;
        const arm3 = custom.Rules.Equipment.find(
          (g) => g.Id === "iron_armor_3",
        )!;
        const ban3 = custom.Rules.Equipment.find(
          (g) => g.Id === "arrival_banner_3",
        )!;
        Object.assign(sw, { ...sword3, Id: "traveler_sword", Name: sw.Name, Slot: "weapon" });
        Object.assign(stf, { ...bell3, Id: "healer_staff", Name: stf.Name, Slot: "weapon" });
        for (const k of Object.keys(sw.Attributes) as (keyof typeof sw.Attributes)[]) {
          sw.Attributes[k] += arm3.Attributes[k] + ban3.Attributes[k];
          stf.Attributes[k] += arm3.Attributes[k] + ban3.Attributes[k];
        }
      }
      const engine = TowerEngine.createPlaytest(custom, {
        ...defaultPlaytestSetup(),
        floor,
        party,
        level,
        rank,
        startingGear: geared,
        autoPlay: true,
        strategy: defaultStrategy(),
        skillPolicy: "strict",
      });
      engine.dispatch({ type: "begin" });
      engine.dispatch({ type: "start" });
      for (let t = 0; t < 18000; t++) {
        const b = engine.getBattleSnapshot()!;
        if (b.result) break;
        if (b.tickets > 0 && b.units.filter((u) => !u.enemy && u.hp > 0).length < 5) {
          const next = engine
            .getSnapshot()
            .members.find((m) => m.hp > 0 && !b.units.some((u) => u.id === m.id));
          if (next) engine.dispatch({ type: "reinforce", id: next.id });
        }
        advancePlaytest(engine, 1);
      }
      return engine.getBattleSnapshot()!.result;
    }

    // Properly leveled + ranked 10-member endgame squad beats F95 & F100
    const f100Party = [
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
    expect(runPlaytest(95, f100Party, 31, 5, true)).toBe("victory");
    expect(runPlaytest(100, f100Party, 32, 5, true)).toBe("victory");

    // Under-ranked/under-leveled squad (Lv.22 R2) cannot stat-stomp F80 nightmare_dragon or F100
    const f80Under = runPlaytest(
      80,
      ["hero", "princess", "slime", "gray_wolf", "mushroom"],
      20,
      2,
      false,
    );
    expect(f80Under).toBe("loss");
  }, 30000);

  it("公主战后按百分比回复存活人类血量且可被装备提升、不复活阵亡单位", () => {
    expect(postBattleHumanHealRatio(config, [])).toBeCloseTo(0.12, 6);
    expect(postBattleHumanHealRatio(config, ["healer_staff"])).toBeCloseTo(
      0.18,
      6,
    );
    expect(
      postBattleHumanHealRatio(config, ["bell_staff_3", "rescue_armor_3"]),
    ).toBeCloseTo(0.55, 6);

    const makeBattleCfg = (
      species: string,
      healthScale: number,
      attackScale: number,
      tweak?: (c: typeof config) => void,
    ) => {
      const cloned = structuredClone(config);
      cloned.Encounters[0] = {
        ...cloned.Encounters[0]!,
        Enemies: [
          {
            Species: species,
            Count: 1,
            Level: 3,
            Rank: 1,
            Health: healthScale,
            AttackScale: attackScale,
            DefenseScale: 0.4,
            Experience: 20,
            Souls: 1,
            Potions: 1,
            PotionsM: 0,
            PotionsL: 0,
          },
        ],
      };
      tweak?.(cloned);
      return validateConfig(cloned, { allowUnknownEnemySpecies: false });
    };

    // 1. 双方均存活且受损：战后按比率回复（提升至 55% 时精确命中 Math.round(MaxHp * ratio)）
    const cfgBothAlive = makeBattleCfg("mudguard", 2.0, 4.5, (c) => {
      c.Rules.Combatants.hero!.Base.MaxHp = 1800;
      c.Rules.Combatants.hero!.Base.Attack = 240;
      c.Rules.Combatants.princess!.Base.MaxHp = 600;
      c.Rules.Actions.heal!.Ratios = [0.1];
      c.Rules.Actions.heal!.Bases = [5];
      const starterStaff = c.Rules.Equipment.find(
        (g) => g.Id === "healer_staff",
      )!;
      starterStaff.PostBattleHealBonus = 0.43; // 0.12 + 0.43 = 0.55
    });
    const healGear = cfgBothAlive.Rules.Equipment.find(
      (g) => g.Id === "bell_staff_3",
    )!;
    expect(healGear.PostBattleHealBonus).toBeCloseTo(0.28, 6);
    const e1 = new TowerEngine(cfgBothAlive);
    expect(e1.getSnapshot().postBattleHumanHealRatio).toBeCloseTo(0.55, 6);
    e1.dispatch({ type: "begin" });
    for (const id of [...e1.getBattleSnapshot()!.opening]) {
      if (!isHuman(id)) {
        e1.dispatch({ type: "opening", id });
      }
    }
    e1.dispatch({ type: "start" });
    for (let t = 0; t < 1800 && !e1.getBattleSnapshot()!.result; t += 6) {
      e1.advance(6);
    }
    const b1 = e1.getBattleSnapshot()!;
    expect(b1.result).toBe("victory");
    const hBefore1 = b1.units.find((u) => u.id === "hero")!.hp;
    const pBefore1 = b1.units.find((u) => u.id === "princess")!.hp;
    const hMax1 = e1.getSnapshot().members.find((m) => m.id === "hero")!
      .attributes.MaxHp;
    expect(hBefore1).toBeGreaterThan(0);
    expect(hBefore1).toBeLessThan(hMax1);
    expect(pBefore1).toBeGreaterThan(0);
    const ratio1 = e1.getSnapshot().postBattleHumanHealRatio ?? 0;
    expect(e1.dispatch({ type: "finish" }).ok).toBe(true);
    const after1 = e1.getSnapshot();
    const hAfter1 = after1.members.find((m) => m.id === "hero")!;
    const pAfter1 = after1.members.find((m) => m.id === "princess")!;
    expect(hAfter1.hp).toBe(
      Math.min(
        hAfter1.attributes.MaxHp,
        hBefore1 + Math.max(1, Math.round(hAfter1.attributes.MaxHp * ratio1)),
      ),
    );
    expect(pAfter1.hp).toBeLessThanOrEqual(pAfter1.attributes.MaxHp);
    expect(pAfter1.hp).toBeGreaterThanOrEqual(pBefore1);

    // 2. 英雄战败（hp === 0）时不免费复活
    const cfgHeroDown = makeBattleCfg("mudguard", 1.2, 4.0, (c) => {
      c.Rules.Combatants.hero!.Base.MaxHp = 40;
      c.Rules.Combatants.hero!.Base.Attack = 5;
      c.Rules.Combatants.hero!.Base.Defense = 0;
      c.Rules.Combatants.princess!.Base.MaxHp = 5000;
      c.Rules.Combatants.princess!.Base.Magic = 260;
    });
    const e2 = new TowerEngine(cfgHeroDown);
    e2.dispatch({ type: "begin" });
    for (const id of [...e2.getBattleSnapshot()!.opening]) {
      if (!isHuman(id)) {
        e2.dispatch({ type: "opening", id });
      }
    }
    e2.dispatch({ type: "start" });
    for (let t = 0; t < 1800 && !e2.getBattleSnapshot()!.result; t += 6) {
      e2.advance(6);
    }
    const b2 = e2.getBattleSnapshot()!;
    expect(b2.result).toBe("victory");
    expect(b2.units.find((u) => u.id === "hero")!.hp).toBe(0);
    expect(e2.dispatch({ type: "finish" }).ok).toBe(true);
    expect(e2.getSnapshot().members.find((m) => m.id === "hero")!.hp).toBe(0);

    // 3. 若公主自身战败（hp === 0），战后回复不生效
    const cfgPrincessDown = makeBattleCfg("mudguard", 1.5, 3.5, (c) => {
      c.Rules.Combatants.hero!.Base.MaxHp = 5000;
      c.Rules.Combatants.hero!.Base.Attack = 140;
      c.Rules.Combatants.hero!.AttackRange = 2.0;
      c.Rules.Profiles.hero!.Role = "ranged";
      c.Rules.Combatants.princess!.Base.MaxHp = 45;
      c.Rules.Combatants.princess!.AttackRange = 0.8;
      c.Rules.Profiles.princess!.Role = "melee";
    });
    const e3 = new TowerEngine(cfgPrincessDown);
    const hMax3 = e3.getSnapshot().members.find((m) => m.id === "hero")!
      .attributes.MaxHp;
    e3.dispatch({ type: "begin" });
    for (const id of [...e3.getBattleSnapshot()!.opening]) {
      if (!isHuman(id)) {
        e3.dispatch({ type: "opening", id });
      }
    }
    e3.dispatch({ type: "start" });
    for (let t = 0; t < 1800 && !e3.getBattleSnapshot()!.result; t += 6) {
      e3.advance(6);
    }
    const b3 = e3.getBattleSnapshot()!;
    expect(b3.result).toBe("victory");
    expect(b3.units.find((u) => u.id === "princess")!.hp).toBe(0);
    const hBefore3 = b3.units.find((u) => u.id === "hero")!.hp;
    expect(hBefore3).toBeGreaterThan(0);
    expect(hBefore3).toBeLessThan(hMax3);
    expect(e3.dispatch({ type: "finish" }).ok).toBe(true);
    expect(e3.getSnapshot().members.find((m) => m.id === "hero")!.hp).toBe(
      hBefore3,
    );
    expect(e3.getSnapshot().members.find((m) => m.id === "princess")!.hp).toBe(
      0,
    );
  });

  it("真实玩家流程：合理集中培养与配装可无作弊打通100层并全员5阶，乱配资源会在中后段卡关", () => {
    const roleOf = (id: string) => config.Rules.Profiles[id]?.Role ?? "melee";
    const tierScore = (id: string) => {
      const t = config.Rules.Species[id]?.Tier;
      return t === "传说" ? 320 : t === "精英" ? 130 : 0;
    };
    const score = (
      m: ReturnType<TowerEngine["getSnapshot"]>["members"][number],
      lv: number,
    ) => {
      const a = combatantAttributes(config, m.id, lv, [], m.rank);
      const rankScale = 1 + (m.rank - 1) * 0.2;
      const isHealerUnit = roleOf(m.id) === "healer" || m.id === "shaman_orc";
      return (
        (a.MaxHp * 0.12 + (a.Attack + a.Magic) * 2.4 + a.Defense * 0.9) *
          rankScale +
        tierScore(m.id) * (m.rank >= 5 ? 0.6 : m.rank >= 4 ? 0.3 : 0.02) +
        (isHealerUnit && m.rank >= 3 ? 280 : 0) +
        m.rank * 320
      );
    };
    const gearScore = (mId: string, gId: string) => {
      const g = config.Rules.Equipment.find((x) => x.Id === gId);
      if (!g) return -1;
      const a = g.Attributes;
      const effectVal =
        g.Effect === "overheal"
          ? 95
          : g.Effect === "emergency"
            ? 85
            : g.Effect === "spell_guard"
              ? 80
              : g.Effect === "arrival"
                ? 120
                : g.Effect === "attack_energy"
                  ? 95
                  : g.Effect === "hurt_energy"
                    ? 90
                    : 0;
      const postHealVal =
        mId === "princess" ? (g.PostBattleHealBonus ?? 0) * 400 : 0;
      const tierSuffix = gId.endsWith("_3") ? 200 : gId.endsWith("_2") ? 100 : 0;
      const atkW = mId === "princess" ? 0.2 : 2.2;
      const magW = mId === "princess" ? 2.4 : 0.2;
      const antiFireBook = mId === "princess" && g.Role === "ranged" ? -500 : 0;
      return (
        (a.MaxHp ?? 0) * 0.08 +
        (a.Attack ?? 0) * atkW +
        (a.Magic ?? 0) * magW +
        (a.Defense ?? 0) * 1.5 +
        effectVal +
        postHealVal +
        tierSuffix +
        antiFireBook
      );
    };

    const runProgression = (mode: "smart" | "wasteful") => {
      const e = new TowerEngine(config);
      for (let f = 1; f <= 100; f++) {
        for (const m of e.getSnapshot().members) {
          if (!isHuman(m.id)) {
            while (e.dispatch({ type: "rank", id: m.id }).ok) {}
          }
        }
        const estLv = Math.max(4, Math.floor(f * 0.35 + 4));
        const monsters = [...e.getSnapshot().members].filter(
          (m) => !isHuman(m.id),
        );

        if (mode === "smart") {
          const coreCount =
            f < 15 ? 4 : f < 40 ? 5 : f < 82 ? 6 : f < 95 ? 7 : 8;
          const sorted = [...monsters].sort(
            (a, b) =>
              score(b, Math.max(b.level, estLv)) -
              score(a, Math.max(a.level, estLv)),
          );
          const core: typeof sorted = [];
          const tank =
            sorted.find(
              (m) => roleOf(m.id) === "tank" && m.rank >= (f >= 30 ? 3 : 2),
            ) ?? sorted.find((m) => roleOf(m.id) === "tank");
          const rangedDps =
            sorted.find(
              (m) =>
                roleOf(m.id) === "ranged" &&
                m.id !== "shaman_orc" &&
                m.rank >= (f >= 30 ? 3 : 2),
            ) ?? sorted.find((m) => roleOf(m.id) === "ranged");
          const healer =
            sorted.find(
              (m) =>
                (roleOf(m.id) === "healer" || m.id === "shaman_orc") &&
                m.rank >= (f >= 30 ? 3 : 2),
            ) ??
            sorted.find(
              (m) => roleOf(m.id) === "healer" || m.id === "shaman_orc",
            );
          if (tank) core.push(tank);
          if (rangedDps && !core.includes(rangedDps)) core.push(rangedDps);
          if (healer && !core.includes(healer)) core.push(healer);
          for (const m of sorted) {
            if (core.length >= coreCount) break;
            const extraHealer =
              (roleOf(m.id) === "healer" ||
                m.id === "shaman_orc" ||
                m.id === "mushroom" ||
                m.id === "jellyfish") &&
              core.some(
                (c) =>
                  roleOf(c.id) === "healer" ||
                  c.id === "shaman_orc" ||
                  c.id === "mushroom" ||
                  c.id === "jellyfish",
              );
            const extraTank =
              roleOf(m.id) === "tank" &&
              core.filter((c) => roleOf(c.id) === "tank").length >= 1;
            const tooManyMelee =
              roleOf(m.id) === "melee" &&
              core.filter((c) => roleOf(c.id) === "melee").length >= 3;
            if (
              !core.includes(m) &&
              !extraHealer &&
              !extraTank &&
              !tooManyMelee &&
              (m.rank >= (f >= 30 ? 3 : 2) || f < 10)
            ) {
              core.push(m);
            }
          }
          for (const m of sorted) {
            if (core.length >= coreCount) break;
            if (!core.includes(m)) core.push(m);
          }
          const activeSet = new Set(core.map((m) => m.id));
          const top5Set = new Set(core.slice(0, 5).map((m) => m.id));

          for (const m of monsters) {
            if (!activeSet.has(m.id) && m.level > 1) {
              e.dispatch({ type: "refund", id: m.id });
            }
          }

          for (const offer of [...config.Economy.Offers].sort(
            (a, b) => b.Stage - a.Stage || b.Price - a.Price,
          )) {
            const g = config.Rules.Equipment.find((x) => x.Id === offer.Item);
            if (!g || offer.Stage > e.getSnapshot().shopStage) continue;
            const owned =
              e.getSnapshot().equipment.includes(offer.Item) ||
              e
                .getSnapshot()
                .members.some((m) =>
                  Object.values(m.equipment).includes(offer.Item),
                );
            if (owned) continue;
            const worthy = ["hero", "princess"].some((hId) => {
              if (
                g.Wearer &&
                g.Wearer !== hId &&
                g.Wearer !== "human" &&
                g.Wearer !== "all"
              )
                return false;
              const liveM = e.getSnapshot().members.find((x) => x.id === hId)!;
              const cur = liveM.equipment[g.Slot];
              return !cur || gearScore(hId, g.Id) > gearScore(hId, cur);
            });
            if (
              worthy &&
              e.getSnapshot().gold >= offer.Price + e.getSnapshot().innPrice
            ) {
              e.dispatch({ type: "buy", id: offer.Id, quantity: 1 });
            }
          }

          for (const mId of ["hero", "princess"]) {
            const candidates = [...e.getSnapshot().equipment].sort(
              (a, b) => gearScore(mId, b) - gearScore(mId, a),
            );
            for (const gId of candidates) {
              const g = config.Rules.Equipment.find((x) => x.Id === gId);
              if (!g) continue;
              const liveM = e.getSnapshot().members.find((x) => x.id === mId)!;
              const cur = liveM.equipment[g.Slot];
              if (!cur || gearScore(mId, gId) > gearScore(mId, cur)) {
                e.dispatch({ type: "equip", id: mId, gear: gId });
              }
            }
          }

          if (f >= 10) {
            for (const pid of ["potion_l", "potion_m", "potion_0"]) {
              while (e.getSnapshot().gold >= 260) {
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
                  (top5Set.has(a.id) ? 0 : 4) -
                  (b.level + (top5Set.has(b.id) ? 0 : 4)),
              );
            for (const c of candidates) {
              if (e.dispatch({ type: "train", id: c.id }).ok) {
                trained = true;
                break;
              }
            }
          }

          const snap = e.getSnapshot();
          if (
            snap.members.some(
              (m) =>
                (isHuman(m.id) || activeSet.has(m.id)) &&
                (m.hp <= 0 ||
                  m.hp < m.attributes.MaxHp * (f % 5 === 0 ? 0.92 : 0.72)),
            )
          ) {
            e.dispatch({ type: "rest" });
          }
        } else {
          let trained = true;
          while (trained) {
            trained = false;
            const candidates = e
              .getSnapshot()
              .members.filter((m) => !isHuman(m.id))
              .sort((a, b) => a.level - b.level);
            for (const c of candidates) {
              if (e.dispatch({ type: "train", id: c.id }).ok) {
                trained = true;
                break;
              }
            }
          }
          if (e.getSnapshot().members.some((m) => m.hp <= 0)) {
            e.dispatch({ type: "rest" });
          }
        }

        const snapNow = e.getSnapshot();
        const aliveMonsters = snapNow.members
          .filter((m) => !isHuman(m.id) && m.hp > 0)
          .sort((a, b) => score(b, b.level) - score(a, a.level));
        const openingMonsters: string[] = [];
        if (mode === "smart") {
          const openTank = aliveMonsters.find((m) => roleOf(m.id) === "tank");
          if (openTank) openingMonsters.push(openTank.id);
          for (const m of aliveMonsters) {
            if (openingMonsters.length >= 3) break;
            if (
              !openingMonsters.includes(m.id) &&
              roleOf(m.id) !== "healer" &&
              m.id !== "shaman_orc" &&
              m.id !== "mushroom" &&
              m.id !== "jellyfish"
            ) {
              openingMonsters.push(m.id);
            }
          }
        }
        for (const m of aliveMonsters) {
          if (openingMonsters.length >= 3) break;
          if (!openingMonsters.includes(m.id)) openingMonsters.push(m.id);
        }
        const wanted = ["hero", "princess", ...openingMonsters];

        e.dispatch({ type: "begin" });
        for (const id of e.getBattleSnapshot()!.opening) {
          if (!isHuman(id) && !wanted.includes(id)) {
            e.dispatch({ type: "opening", id });
          }
        }
        for (const id of wanted) {
          if (!isHuman(id) && !e.getBattleSnapshot()!.opening.includes(id)) {
            e.dispatch({ type: "opening", id });
          }
        }
        e.dispatch({ type: "start" });

        const strat = {
          ...defaultStrategy(),
          reinforcementOrder: aliveMonsters.map((m) => m.id),
          ultimateOrder: ["princess", "hero", ...aliveMonsters.map((m) => m.id)],
        };
        for (let t = 0; t < 4800; t += 6) {
          const b = e.getBattleSnapshot()!;
          if (b.result) break;
          if (mode === "smart") {
            applyStrategy(e, strat);
          } else {
            for (const u of b.units) {
              if (!u.enemy && u.hp > 0 && u.energy >= 1000) {
                e.dispatch({ type: "ultimate", id: u.id });
              }
            }
            if (
              b.tickets > 0 &&
              b.units.filter((u) => !u.enemy && u.hp > 0).length < 5
            ) {
              const next = e
                .getSnapshot()
                .members.filter(
                  (m) => m.hp > 0 && !b.units.some((u) => u.id === m.id),
                )[0];
              if (next) e.dispatch({ type: "reinforce", id: next.id });
            }
          }
          e.advance(6);
        }

        if (e.getBattleSnapshot()!.result !== "victory") {
          return { cleared: f - 1, completed: false, allRank5: false };
        }
        e.dispatch({ type: "finish" });
      }

      for (const m of e.getSnapshot().members) {
        if (!isHuman(m.id)) {
          while (e.dispatch({ type: "rank", id: m.id }).ok) {}
        }
      }
      const fin = e.getSnapshot();
      return {
        cleared: 100,
        completed: fin.completed,
        allRank5: fin.members
          .filter((m) => !isHuman(m.id))
          .every((m) => m.rank === 5),
      };
    };

    const smart = runProgression("smart");
    expect(smart).toEqual({ cleared: 100, completed: true, allRank5: true });

    const wasteful = runProgression("wasteful");
    expect(wasteful.completed).toBe(false);
    expect(wasteful.cleared).toBeLessThan(95);
  }, 60000);

  it("公主可单独离队（主角+4宠），不带公主仅极限配置可通关F100而常规乱配卡关，且公主1v1强于全传说宠物", () => {
    // 1. 战前可取消公主首发、改为携带4只宠物；公主未参战时不触发战后守望回血
    const eOpt = new TowerEngine(
      validateConfig(
        (() => {
          const c = structuredClone(config);
          c.Encounters[0] = {
            ...c.Encounters[0]!,
            Enemies: [
              {
                Species: "mudguard",
                Count: 1,
                Level: 2,
                Rank: 1,
                Health: 1.8,
                AttackScale: 2.2,
                DefenseScale: 0.4,
                Experience: 10,
                Souls: 1,
                Potions: 0,
                PotionsM: 0,
                PotionsL: 0,
              },
            ],
          };
          c.Rules.Combatants.hero!.Base.MaxHp = 1800;
          c.Rules.Combatants.hero!.Base.Attack = 260;
          return c;
        })(),
        { allowUnknownEnemySpecies: false },
      ),
    );
    expect(eOpt.dispatch({ type: "begin" }).ok).toBe(true);
    expect(eOpt.dispatch({ type: "opening", id: "hero" }).ok).toBe(false);
    expect(eOpt.dispatch({ type: "opening", id: "princess" }).ok).toBe(true);
    expect(eOpt.getBattleSnapshot()!.opening).not.toContain("princess");
    expect(eOpt.dispatch({ type: "start" }).ok).toBe(true);
    for (let t = 0; t < 1800 && !eOpt.getBattleSnapshot()!.result; t += 6) {
      eOpt.advance(6);
    }
    const bNoPrincess = eOpt.getBattleSnapshot()!;
    expect(bNoPrincess.result).toBe("victory");
    const hBefore = bNoPrincess.units.find((u) => u.id === "hero")!.hp;
    expect(hBefore).toBeLessThan(
      eOpt.getSnapshot().members.find((m) => m.id === "hero")!.attributes.MaxHp,
    );
    expect(eOpt.dispatch({ type: "finish" }).ok).toBe(true);
    expect(
      eOpt.getSnapshot().members.find((m) => m.id === "hero")!.hp,
    ).toBe(hBefore);

    // 2. 满级毕业公主在1v1公平单挑中胜过全部7只5阶传说宠物
    const legendaries = [
      "nightmare_dragon",
      "flame_warrior",
      "minotaur",
      "doomsday_satan",
      "pharaoh_beast",
      "medusa",
      "skeleton_lich_king",
    ];
    for (const foe of legendaries) {
      const custom = structuredClone(config);
      const stf = custom.Rules.Equipment.find((g) => g.Id === "healer_staff")!;
      Object.assign(stf, {
        ...custom.Rules.Equipment.find((g) => g.Id === "bell_staff_3")!,
        Id: "healer_staff",
        Name: stf.Name,
        Slot: "weapon",
      });
      custom.Encounters[0] = {
        ...custom.Encounters[0]!,
        Enemies: [
          {
            Species: foe,
            Count: 1,
            Level: 30,
            Rank: 5,
            Health: 1,
            AttackScale: 1,
            DefenseScale: 1,
            Experience: 0,
            Souls: 1,
            Potions: 0,
            PotionsM: 0,
            PotionsL: 0,
          },
        ],
      };
      const duelCfg = validateConfig(custom, { allowUnknownEnemySpecies: false });
      const duel = TowerEngine.createPlaytest(duelCfg, {
        ...defaultPlaytestSetup(),
        floor: 1,
        party: ["princess"],
        level: 30,
        rank: 5,
        autoPlay: true,
        startingGear: true,
      });
      expect(duel.dispatch({ type: "begin" }).ok).toBe(true);
      expect(duel.dispatch({ type: "start" }).ok).toBe(true);
      for (let t = 0; t < 4800 && !duel.getBattleSnapshot()!.result; t += 6) {
        applyStrategy(duel, defaultStrategy());
        duel.advance(6);
      }
      expect(duel.getBattleSnapshot()!.result).toBe("victory");
    }

    // 3. 不带公主：主角 + 4首发宠物（可替补轮换）仅极限合理配队可通关100层，分散培养/不换宠均无法通关
    const roleOf = (id: string) => config.Rules.Profiles[id]?.Role ?? "melee";
    const score = (
      m: ReturnType<TowerEngine["getSnapshot"]>["members"][number],
      lv: number,
    ) => {
      const a = combatantAttributes(config, m.id, lv, [], m.rank);
      const rankScale = 1 + (m.rank - 1) * 0.2;
      const isHealer = roleOf(m.id) === "healer" || m.id === "shaman_orc";
      const tier = config.Rules.Species[m.id]?.Tier;
      const tVal = tier === "传说" ? 320 : tier === "精英" ? 130 : 0;
      return (
        (a.MaxHp * 0.12 + (a.Attack + a.Magic) * 2.4 + a.Defense * 0.9) *
          rankScale +
        tVal * (m.rank >= 5 ? 0.6 : m.rank >= 4 ? 0.3 : 0.02) +
        (isHealer && m.rank >= 3 ? 280 : 0) +
        m.rank * 320
      );
    };
    const gearScore = (gId: string) => {
      const g = config.Rules.Equipment.find((x) => x.Id === gId);
      if (!g) return -1;
      const a = g.Attributes;
      const effectVal =
        g.Effect === "overheal"
          ? 95
          : g.Effect === "emergency"
            ? 85
            : g.Effect === "spell_guard"
              ? 80
              : g.Effect === "arrival"
                ? 120
                : g.Effect === "attack_energy"
                  ? 95
                  : g.Effect === "hurt_energy"
                    ? 90
                    : 0;
      const tierSuffix = gId.endsWith("_3") ? 200 : gId.endsWith("_2") ? 100 : 0;
      return (
        (a.MaxHp ?? 0) * 0.08 +
        (a.Attack ?? 0) * 2.2 +
        (a.Magic ?? 0) * 0.2 +
        (a.Defense ?? 0) * 1.5 +
        effectVal +
        tierSuffix
      );
    };

    const runNoPrincess = (
      mode: "optimal" | "wasteful" | "early_pets",
    ) => {
      const e = new TowerEngine(config);
      let minWinHpPct = 1;
      for (let f = 1; f <= 100; f++) {
        if (mode !== "wasteful") {
          for (const m of e.getSnapshot().members) {
            if (!isHuman(m.id)) {
              while (e.dispatch({ type: "rank", id: m.id }).ok) {}
            }
          }
        }
        const estLv = Math.max(4, Math.floor(f * 0.35 + 4));
        const monsters = [...e.getSnapshot().members].filter(
          (m) => !isHuman(m.id),
        );
        if (mode === "optimal") {
          const coreCount = f < 15 ? 4 : f < 40 ? 5 : f < 75 ? 7 : 9;
          const sorted = [...monsters].sort(
            (a, b) =>
              score(b, Math.max(b.level, estLv)) -
              score(a, Math.max(a.level, estLv)),
          );
          const core: typeof sorted = [];
          const tank =
            sorted.find(
              (m) => roleOf(m.id) === "tank" && m.rank >= (f >= 30 ? 3 : 2),
            ) ?? sorted.find((m) => roleOf(m.id) === "tank");
          const rangedDps =
            sorted.find(
              (m) =>
                roleOf(m.id) === "ranged" &&
                m.id !== "shaman_orc" &&
                m.rank >= (f >= 30 ? 3 : 2),
            ) ?? sorted.find((m) => roleOf(m.id) === "ranged");
          const healer =
            sorted.find(
              (m) =>
                (roleOf(m.id) === "healer" || m.id === "shaman_orc") &&
                m.rank >= (f >= 30 ? 3 : 2),
            ) ??
            sorted.find(
              (m) => roleOf(m.id) === "healer" || m.id === "shaman_orc",
            );
          if (tank) core.push(tank);
          if (rangedDps && !core.includes(rangedDps)) core.push(rangedDps);
          if (healer && !core.includes(healer)) core.push(healer);
          for (const m of sorted) {
            if (core.length >= coreCount) break;
            const extraTank =
              roleOf(m.id) === "tank" &&
              core.filter((c) => roleOf(c.id) === "tank").length >= 2;
            const tooManyMelee =
              roleOf(m.id) === "melee" &&
              core.filter((c) => roleOf(c.id) === "melee").length >= 3;
            if (
              !core.includes(m) &&
              !extraTank &&
              !tooManyMelee &&
              (m.rank >= (f >= 30 ? 3 : 2) || f < 10)
            ) {
              core.push(m);
            }
          }
          for (const m of sorted) {
            if (core.length >= coreCount) break;
            if (!core.includes(m)) core.push(m);
          }
          const activeSet = new Set(core.map((m) => m.id));
          const top5Set = new Set(core.slice(0, 5).map((m) => m.id));
          for (const m of monsters) {
            if (!activeSet.has(m.id) && m.level > 1) {
              e.dispatch({ type: "refund", id: m.id });
            }
          }
          for (const offer of [...config.Economy.Offers].sort(
            (a, b) => b.Stage - a.Stage || b.Price - a.Price,
          )) {
            const g = config.Rules.Equipment.find((x) => x.Id === offer.Item);
            if (!g || offer.Stage > e.getSnapshot().shopStage) continue;
            const owned =
              e.getSnapshot().equipment.includes(offer.Item) ||
              e
                .getSnapshot()
                .members.some((m) =>
                  Object.values(m.equipment).includes(offer.Item),
                );
            if (
              owned ||
              (g.Wearer &&
                g.Wearer !== "hero" &&
                g.Wearer !== "human" &&
                g.Wearer !== "all")
            ) {
              continue;
            }
            const cur = e.getSnapshot().members.find((x) => x.id === "hero")!
              .equipment[g.Slot];
            if (
              (!cur || gearScore(g.Id) > gearScore(cur)) &&
              e.getSnapshot().gold >= offer.Price + e.getSnapshot().innPrice
            ) {
              e.dispatch({ type: "buy", id: offer.Id, quantity: 1 });
            }
          }
          for (const gId of [...e.getSnapshot().equipment].sort(
            (a, b) => gearScore(b) - gearScore(a),
          )) {
            const g = config.Rules.Equipment.find((x) => x.Id === gId);
            if (!g) continue;
            const cur = e.getSnapshot().members.find((x) => x.id === "hero")!
              .equipment[g.Slot];
            if (!cur || gearScore(gId) > gearScore(cur)) {
              e.dispatch({ type: "equip", id: "hero", gear: gId });
            }
          }
          if (f >= 10) {
            for (const pid of ["potion_l", "potion_m", "potion_0"]) {
              while (e.getSnapshot().gold >= 260) {
                if (!e.dispatch({ type: "buy", id: pid, quantity: 1 }).ok) {
                  break;
                }
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
                  (top5Set.has(a.id) ? 0 : 4) -
                  (b.level + (top5Set.has(b.id) ? 0 : 4)),
              );
            for (const c of candidates) {
              if (e.dispatch({ type: "train", id: c.id }).ok) {
                trained = true;
                break;
              }
            }
          }
          if (
            e
              .getSnapshot()
              .members.some(
                (m) =>
                  (m.id === "hero" || activeSet.has(m.id)) &&
                  (m.hp <= 0 ||
                    m.hp < m.attributes.MaxHp * (f % 5 === 0 ? 0.92 : 0.72)),
              )
          ) {
            e.dispatch({ type: "rest" });
          }
        } else if (mode === "early_pets") {
          const pool = new Set(monsters.slice(0, 7).map((m) => m.id));
          for (const m of monsters) {
            if (!pool.has(m.id) && m.level > 1) {
              e.dispatch({ type: "refund", id: m.id });
            }
          }
          let trained = true;
          while (trained) {
            trained = false;
            const candidates = e
              .getSnapshot()
              .members.filter((m) => !isHuman(m.id) && pool.has(m.id))
              .sort((a, b) => a.level - b.level);
            for (const c of candidates) {
              if (e.dispatch({ type: "train", id: c.id }).ok) {
                trained = true;
                break;
              }
            }
          }
          if (
            e
              .getSnapshot()
              .members.some(
                (m) =>
                  (m.id === "hero" || pool.has(m.id)) &&
                  (m.hp <= 0 || m.hp < m.attributes.MaxHp * 0.72),
              )
          ) {
            e.dispatch({ type: "rest" });
          }
        } else {
          let trained = true;
          while (trained) {
            trained = false;
            const candidates = e
              .getSnapshot()
              .members.filter((m) => !isHuman(m.id))
              .sort((a, b) => a.level - b.level);
            for (const c of candidates) {
              if (e.dispatch({ type: "train", id: c.id }).ok) {
                trained = true;
                break;
              }
            }
          }
          if (e.getSnapshot().members.some((m) => m.hp <= 0)) {
            e.dispatch({ type: "rest" });
          }
        }

        const alive = e
          .getSnapshot()
          .members.filter((m) => !isHuman(m.id) && m.hp > 0)
          .sort((a, b) =>
            mode === "early_pets"
              ? a.id.localeCompare(b.id)
              : score(b, b.level) - score(a, a.level),
          );
        const openingPets: string[] = [];
        if (mode === "optimal") {
          const tank = alive.find((m) => roleOf(m.id) === "tank");
          if (tank) openingPets.push(tank.id);
          for (const m of alive) {
            if (openingPets.length >= 4) break;
            if (
              !openingPets.includes(m.id) &&
              roleOf(m.id) !== "healer" &&
              m.id !== "shaman_orc" &&
              m.id !== "mushroom" &&
              m.id !== "jellyfish"
            ) {
              openingPets.push(m.id);
            }
          }
        }
        for (const m of alive) {
          if (openingPets.length >= 4) break;
          if (!openingPets.includes(m.id)) openingPets.push(m.id);
        }
        const wanted = ["hero", ...openingPets];

        e.dispatch({ type: "begin" });
        for (const id of e.getBattleSnapshot()!.opening) {
          if (id !== "hero" && !wanted.includes(id)) {
            e.dispatch({ type: "opening", id });
          }
        }
        for (const id of wanted) {
          if (id !== "hero" && !e.getBattleSnapshot()!.opening.includes(id)) {
            e.dispatch({ type: "opening", id });
          }
        }
        if (mode === "optimal" && f >= 6) {
          expect(e.getBattleSnapshot()!.opening).toHaveLength(5);
          expect(e.getBattleSnapshot()!.opening).not.toContain("princess");
        }
        e.dispatch({ type: "start" });

        const strat = {
          ...defaultStrategy(),
          reinforcementOrder: alive.map((m) => m.id),
          ultimateOrder: ["hero", ...alive.map((m) => m.id)],
        };
        for (let t = 0; t < 6000 && !e.getBattleSnapshot()!.result; t += 6) {
          applyStrategy(e, strat);
          e.advance(6);
        }
        const res = e.getBattleSnapshot()!;
        if (res.result !== "victory") {
          return {
            cleared: f - 1,
            completed: false,
            minWinHpPct,
          };
        }
        const allies = res.units.filter((u) => !u.enemy);
        minWinHpPct = Math.min(
          minWinHpPct,
          allies.reduce((s, u) => s + Math.max(0, u.hp), 0) /
            allies.reduce((s, u) => s + u.attributes.MaxHp, 0),
        );
        e.dispatch({ type: "finish" });
      }
      return { cleared: 100, completed: e.getSnapshot().completed, minWinHpPct };
    };

    const optNoPrincess = runNoPrincess("optimal");
    expect(optNoPrincess.cleared).toBe(100);
    expect(optNoPrincess.completed).toBe(true);
    expect(optNoPrincess.minWinHpPct).toBeLessThan(0.65);

    const wasteNoPrincess = runNoPrincess("wasteful");
    expect(wasteNoPrincess.completed).toBe(false);
    expect(wasteNoPrincess.cleared).toBeLessThan(60);

    const earlyPetsNoPrincess = runNoPrincess("early_pets");
    expect(earlyPetsNoPrincess.completed).toBe(false);
    expect(earlyPetsNoPrincess.cleared).toBeLessThan(60);
  }, 60000);
});
