import fs from "node:fs";
import path from "node:path";
import raw from "../data/tower/trial.json";
import { validateConfig } from "../src/core/config";
import { TowerEngine, isHuman } from "../src/core/engine";
import { combatantAttributes } from "../src/core/projections";
import { applyStrategy, defaultStrategy } from "../src/core/strategy";

const args = process.argv.slice(2);
const showAllFloors = args.includes("--detail");
const seedIdx = args.indexOf("--seed");
const seed = seedIdx >= 0 && args[seedIdx + 1] ? Number(args[seedIdx + 1]) : 2463534242;
const jsonIdx = args.indexOf("--json");
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;

const config = validateConfig(raw, { allowUnknownEnemySpecies: false });

type Archetype =
  | "smart_princess"
  | "wasteful_princess"
  | "optimal_no_princess"
  | "early_no_princess"
  | "single_carry_princess";

interface FloorMetric {
  floor: number;
  boss: boolean;
  title: string;
  result: "victory" | "loss" | "flee";
  seconds: number;
  endHpPct: number;
  deaths: number;
  reinforcements: number;
  rested: boolean;
  boughtGear: string[];
  boughtPotionUnits: number;
  goldAfter: number;
  heroLv: number;
  maxPetLv: number;
}

interface RunSummary {
  archetype: Archetype;
  label: string;
  cleared: number;
  completed: boolean;
  allRank5: boolean;
  totalRests: number;
  totalDeaths: number;
  finalGold: number;
  floors: FloorMetric[];
}

const roleOf = (id: string) => config.Rules.Profiles[id]?.Role ?? "melee";

function memberScore(
  m: ReturnType<TowerEngine["getSnapshot"]>["members"][number],
  lv: number,
) {
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
}

function gearScore(mId: string, gId: string) {
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
}

function selectSmartCore(
  monsters: ReturnType<TowerEngine["getSnapshot"]>["members"],
  floor: number,
  coreCount: number,
  maxTanks: number,
  allowExtraHealer: boolean,
) {
  const estLv = Math.max(4, Math.floor(floor * 0.35 + 4));
  const sorted = [...monsters].sort(
    (a, b) =>
      memberScore(b, Math.max(b.level, estLv)) -
      memberScore(a, Math.max(a.level, estLv)),
  );
  const core: typeof sorted = [];
  const tank =
    sorted.find(
      (m) => roleOf(m.id) === "tank" && m.rank >= (floor >= 30 ? 3 : 2),
    ) ?? sorted.find((m) => roleOf(m.id) === "tank");
  const rangedDps =
    sorted.find(
      (m) =>
        roleOf(m.id) === "ranged" &&
        m.id !== "shaman_orc" &&
        m.rank >= (floor >= 30 ? 3 : 2),
    ) ?? sorted.find((m) => roleOf(m.id) === "ranged");
  const healer =
    sorted.find(
      (m) =>
        (roleOf(m.id) === "healer" || m.id === "shaman_orc") &&
        m.rank >= (floor >= 30 ? 3 : 2),
    ) ??
    sorted.find((m) => roleOf(m.id) === "healer" || m.id === "shaman_orc");
  if (tank) core.push(tank);
  if (rangedDps && !core.includes(rangedDps)) core.push(rangedDps);
  if (healer && !core.includes(healer)) core.push(healer);
  for (const m of sorted) {
    if (core.length >= coreCount) break;
    const isHealerLike =
      roleOf(m.id) === "healer" ||
      m.id === "shaman_orc" ||
      m.id === "mushroom" ||
      m.id === "jellyfish";
    const extraHealer =
      !allowExtraHealer &&
      isHealerLike &&
      core.some(
        (c) =>
          roleOf(c.id) === "healer" ||
          c.id === "shaman_orc" ||
          c.id === "mushroom" ||
          c.id === "jellyfish",
      );
    const extraTank =
      roleOf(m.id) === "tank" &&
      core.filter((c) => roleOf(c.id) === "tank").length >= maxTanks;
    const tooManyMelee =
      roleOf(m.id) === "melee" &&
      core.filter((c) => roleOf(c.id) === "melee").length >= 3;
    if (
      !core.includes(m) &&
      !extraHealer &&
      !extraTank &&
      !tooManyMelee &&
      (m.rank >= (floor >= 30 ? 3 : 2) || floor < 10)
    ) {
      core.push(m);
    }
  }
  for (const m of sorted) {
    if (core.length >= coreCount) break;
    if (!core.includes(m)) core.push(m);
  }
  return core;
}

function buyAndEquip(
  e: TowerEngine,
  humans: ("hero" | "princess")[],
  floor: number,
  buyPotions: boolean,
) {
  const boughtGear: string[] = [];
  for (const offer of [...config.Economy.Offers].sort(
    (a, b) => b.Stage - a.Stage || b.Price - a.Price,
  )) {
    const g = config.Rules.Equipment.find((x) => x.Id === offer.Item);
    if (!g || offer.Stage > e.getSnapshot().shopStage) continue;
    const snap = e.getSnapshot();
    const owned =
      snap.equipment.includes(offer.Item) ||
      snap.members.some((m) => Object.values(m.equipment).includes(offer.Item));
    if (owned) continue;
    const worthy = humans.some((hId) => {
      if (
        g.Wearer &&
        g.Wearer !== hId &&
        g.Wearer !== "human" &&
        g.Wearer !== "all"
      )
        return false;
      const cur = snap.members.find((x) => x.id === hId)!.equipment[g.Slot];
      return !cur || gearScore(hId, g.Id) > gearScore(hId, cur);
    });
    if (worthy && snap.gold >= offer.Price + snap.innPrice) {
      if (e.dispatch({ type: "buy", id: offer.Id, quantity: 1 }).ok) {
        boughtGear.push(g.Name);
      }
    }
  }
  for (const mId of humans) {
    const candidates = [...e.getSnapshot().equipment].sort(
      (a, b) => gearScore(mId, b) - gearScore(mId, a),
    );
    for (const gId of candidates) {
      const g = config.Rules.Equipment.find((x) => x.Id === gId);
      if (!g) continue;
      const cur = e.getSnapshot().members.find((x) => x.id === mId)!.equipment[
        g.Slot
      ];
      if (!cur || gearScore(mId, gId) > gearScore(mId, cur)) {
        e.dispatch({ type: "equip", id: mId, gear: gId });
      }
    }
  }
  let boughtPotionUnits = 0;
  if (buyPotions && floor >= 10) {
    for (const [pid, units] of [
      ["potion_l", 20],
      ["potion_m", 4],
      ["potion_0", 1],
    ] as const) {
      while (e.getSnapshot().gold >= 260) {
        if (!e.dispatch({ type: "buy", id: pid, quantity: 1 }).ok) break;
        boughtPotionUnits += units;
      }
    }
  }
  return { boughtGear, boughtPotionUnits };
}

function runArchetype(archetype: Archetype, label: string): RunSummary {
  const e = new TowerEngine(config, seed);
  const floors: FloorMetric[] = [];
  let totalRests = 0;
  let totalDeaths = 0;

  for (let f = 1; f <= 100; f++) {
    const enc = config.Encounters[f - 1]!;
    if (archetype !== "wasteful_princess") {
      for (const m of e.getSnapshot().members) {
        if (!isHuman(m.id)) {
          while (e.dispatch({ type: "rank", id: m.id }).ok) {}
        }
      }
    }

    const monsters = [...e.getSnapshot().members].filter((m) => !isHuman(m.id));
    let activeSet = new Set<string>(monsters.map((m) => m.id));
    let topSet = new Set<string>();
    let boughtGear: string[] = [];
    let boughtPotionUnits = 0;
    let rested = false;

    if (archetype === "smart_princess") {
      const coreCount = f < 15 ? 4 : f < 40 ? 5 : f < 82 ? 6 : f < 95 ? 7 : 8;
      const core = selectSmartCore(monsters, f, coreCount, 1, false);
      activeSet = new Set(core.map((m) => m.id));
      topSet = new Set(core.slice(0, 5).map((m) => m.id));
      for (const m of monsters) {
        if (!activeSet.has(m.id) && m.level > 1) e.dispatch({ type: "refund", id: m.id });
      }
      ({ boughtGear, boughtPotionUnits } = buyAndEquip(e, ["hero", "princess"], f, true));
      let trained = true;
      while (trained) {
        trained = false;
        const candidates = e
          .getSnapshot()
          .members.filter((m) => !isHuman(m.id) && activeSet.has(m.id))
          .sort(
            (a, b) =>
              a.level + (topSet.has(a.id) ? 0 : 4) - (b.level + (topSet.has(b.id) ? 0 : 4)),
          );
        for (const c of candidates) {
          if (e.dispatch({ type: "train", id: c.id }).ok) {
            trained = true;
            break;
          }
        }
      }
      if (
        e.getSnapshot().members.some(
          (m) =>
            (isHuman(m.id) || activeSet.has(m.id)) &&
            (m.hp <= 0 || m.hp < m.attributes.MaxHp * (f % 5 === 0 ? 0.92 : 0.72)),
        )
      ) {
        rested = e.dispatch({ type: "rest" }).ok;
      }
    } else if (archetype === "optimal_no_princess") {
      const coreCount = f < 15 ? 4 : f < 40 ? 5 : f < 75 ? 7 : 9;
      const core = selectSmartCore(monsters, f, coreCount, 2, true);
      activeSet = new Set(core.map((m) => m.id));
      topSet = new Set(core.slice(0, 5).map((m) => m.id));
      for (const m of monsters) {
        if (!activeSet.has(m.id) && m.level > 1) e.dispatch({ type: "refund", id: m.id });
      }
      ({ boughtGear, boughtPotionUnits } = buyAndEquip(e, ["hero"], f, true));
      let trained = true;
      while (trained) {
        trained = false;
        const candidates = e
          .getSnapshot()
          .members.filter((m) => !isHuman(m.id) && activeSet.has(m.id))
          .sort(
            (a, b) =>
              a.level + (topSet.has(a.id) ? 0 : 4) - (b.level + (topSet.has(b.id) ? 0 : 4)),
          );
        for (const c of candidates) {
          if (e.dispatch({ type: "train", id: c.id }).ok) {
            trained = true;
            break;
          }
        }
      }
      if (
        e.getSnapshot().members.some(
          (m) =>
            (m.id === "hero" || activeSet.has(m.id)) &&
            (m.hp <= 0 || m.hp < m.attributes.MaxHp * (f % 5 === 0 ? 0.92 : 0.72)),
        )
      ) {
        rested = e.dispatch({ type: "rest" }).ok;
      }
    } else if (archetype === "early_no_princess") {
      const pool = new Set(monsters.slice(0, 7).map((m) => m.id));
      activeSet = pool;
      for (const m of monsters) {
        if (!pool.has(m.id) && m.level > 1) e.dispatch({ type: "refund", id: m.id });
      }
      let trained = true;
      while (trained) {
        trained = false;
        for (const c of e
          .getSnapshot()
          .members.filter((m) => !isHuman(m.id) && pool.has(m.id))
          .sort((a, b) => a.level - b.level)) {
          if (e.dispatch({ type: "train", id: c.id }).ok) {
            trained = true;
            break;
          }
        }
      }
      if (
        e.getSnapshot().members.some(
          (m) =>
            (m.id === "hero" || pool.has(m.id)) &&
            (m.hp <= 0 || m.hp < m.attributes.MaxHp * 0.72),
        )
      ) {
        rested = e.dispatch({ type: "rest" }).ok;
      }
    } else if (archetype === "single_carry_princess") {
      // Funnel almost all XP into highest-tier single monster carry + 2 uninvested filler
      ({ boughtGear, boughtPotionUnits } = buyAndEquip(e, ["hero", "princess"], f, true));
      const carry =
        [...monsters].sort((a, b) => memberScore(b, 25) - memberScore(a, 25))[0];
      if (carry) {
        activeSet = new Set([carry.id, ...monsters.slice(0, 2).map((m) => m.id)]);
        for (const m of monsters) {
          if (m.id !== carry.id && m.level > 1) e.dispatch({ type: "refund", id: m.id });
        }
        while (e.dispatch({ type: "train", id: carry.id }).ok) {}
      }
      if (
        e.getSnapshot().members.some(
          (m) =>
            (isHuman(m.id) || activeSet.has(m.id)) &&
            (m.hp <= 0 || m.hp < m.attributes.MaxHp * 0.75),
        )
      ) {
        rested = e.dispatch({ type: "rest" }).ok;
      }
    } else {
      // wasteful_princess
      let trained = true;
      while (trained) {
        trained = false;
        for (const c of e
          .getSnapshot()
          .members.filter((m) => !isHuman(m.id))
          .sort((a, b) => a.level - b.level)) {
          if (e.dispatch({ type: "train", id: c.id }).ok) {
            trained = true;
            break;
          }
        }
      }
      if (e.getSnapshot().members.some((m) => m.hp <= 0)) {
        rested = e.dispatch({ type: "rest" }).ok;
      }
    }
    if (rested) totalRests++;

    const includePrincess =
      archetype === "smart_princess" ||
      archetype === "wasteful_princess" ||
      archetype === "single_carry_princess";
    const aliveMonsters = e
      .getSnapshot()
      .members.filter((m) => !isHuman(m.id) && m.hp > 0)
      .sort((a, b) =>
        archetype === "early_no_princess"
          ? a.id.localeCompare(b.id)
          : memberScore(b, b.level) - memberScore(a, a.level),
      );

    const openingMonsters: string[] = [];
    const needPets = includePrincess ? 3 : 4;
    if (archetype === "smart_princess" || archetype === "optimal_no_princess") {
      const tank = aliveMonsters.find((m) => roleOf(m.id) === "tank");
      if (tank) openingMonsters.push(tank.id);
      for (const m of aliveMonsters) {
        if (openingMonsters.length >= needPets) break;
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
      if (openingMonsters.length >= needPets) break;
      if (!openingMonsters.includes(m.id)) openingMonsters.push(m.id);
    }

    const wanted = [
      "hero",
      ...(includePrincess ? ["princess"] : []),
      ...openingMonsters,
    ];
    e.dispatch({ type: "begin" });
    for (const id of e.getBattleSnapshot()!.opening) {
      if (id !== "hero" && !wanted.includes(id)) e.dispatch({ type: "opening", id });
    }
    for (const id of wanted) {
      if (id !== "hero" && !e.getBattleSnapshot()!.opening.includes(id)) {
        e.dispatch({ type: "opening", id });
      }
    }
    e.dispatch({ type: "start" });

    const strat = {
      ...defaultStrategy(),
      reinforcementOrder: aliveMonsters.map((m) => m.id),
      ultimateOrder: [
        ...(includePrincess ? ["princess"] : []),
        "hero",
        ...aliveMonsters.map((m) => m.id),
      ],
    };

    for (let t = 0; t < 18000 && !e.getBattleSnapshot()!.result; t += 6) {
      if (archetype === "wasteful_princess") {
        const b = e.getBattleSnapshot()!;
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
            .members.filter((m) => m.hp > 0 && !b.units.some((u) => u.id === m.id))[0];
          if (next) e.dispatch({ type: "reinforce", id: next.id });
        }
      } else {
        applyStrategy(e, strat);
      }
      e.advance(6);
    }

    const b = e.getBattleSnapshot()!;
    const allies = b.units.filter((u) => !u.enemy);
    const maxHpSum = allies.reduce((s, u) => s + u.attributes.MaxHp, 0) || 1;
    const hpSum = allies.reduce((s, u) => s + Math.max(0, u.hp), 0);
    const endHpPct = (hpSum / maxHpSum) * 100;
    const deaths = allies.filter((u) => u.hp <= 0).length;
    const reinforcements = Math.max(0, allies.length - b.opening.length);
    totalDeaths += deaths;

    const result = (b.result || "flee") as "victory" | "loss" | "flee";
    if (result !== "victory") {
      const snapFail = e.getSnapshot();
      floors.push({
        floor: f,
        boss: enc.Boss,
        title: enc.Title,
        result,
        seconds: Number(b.seconds.toFixed(1)),
        endHpPct: Number(endHpPct.toFixed(1)),
        deaths,
        reinforcements,
        rested,
        boughtGear,
        boughtPotionUnits,
        goldAfter: snapFail.gold,
        heroLv: snapFail.members.find((m) => m.id === "hero")!.level,
        maxPetLv: Math.max(0, ...snapFail.members.filter((m) => !isHuman(m.id)).map((m) => m.level)),
      });
      return {
        archetype,
        label,
        cleared: f - 1,
        completed: false,
        allRank5: false,
        totalRests,
        totalDeaths,
        finalGold: snapFail.gold,
        floors,
      };
    }

    e.dispatch({ type: "finish" });
    const after = e.getSnapshot();
    floors.push({
      floor: f,
      boss: enc.Boss,
      title: enc.Title,
      result,
      seconds: Number(b.seconds.toFixed(1)),
      endHpPct: Number(endHpPct.toFixed(1)),
      deaths,
      reinforcements,
      rested,
      boughtGear,
      boughtPotionUnits,
      goldAfter: after.gold,
      heroLv: after.members.find((m) => m.id === "hero")!.level,
      maxPetLv: Math.max(0, ...after.members.filter((m) => !isHuman(m.id)).map((m) => m.level)),
    });
  }

  for (const m of e.getSnapshot().members) {
    if (!isHuman(m.id)) while (e.dispatch({ type: "rank", id: m.id }).ok) {}
  }
  const fin = e.getSnapshot();
  return {
    archetype,
    label,
    cleared: 100,
    completed: fin.completed,
    allRank5: fin.members.filter((m) => !isHuman(m.id)).every((m) => m.rank === 5),
    totalRests,
    totalDeaths,
    finalGold: fin.gold,
    floors,
  };
}

const runs: RunSummary[] = [
  runArchetype("smart_princess", "正常主力（带公主+集中养宠）"),
  runArchetype("wasteful_princess", "乱配资源（均摊经验+不买装）"),
  runArchetype("optimal_no_princess", "无公主极限（主角+4宠精调轮换）"),
  runArchetype("early_no_princess", "无公主常规（仅前期7宠不轮换）"),
  runArchetype("single_carry_princess", "单核偏科（全药水砸1只核心宠）"),
];

console.log(`\n=== 翠庭试炼 100层 强度曲线体检 (seed=${seed}) ===\n`);
for (const r of runs) {
  const wins = r.floors.filter((f) => f.result === "victory");
  const minHp = wins.length ? Math.min(...wins.map((f) => f.endHpPct)) : 0;
  const minFloor = wins.find((f) => f.endHpPct === minHp)?.floor ?? "-";
  const avgHp = wins.length
    ? (wins.reduce((s, f) => s + f.endHpPct, 0) / wins.length).toFixed(1)
    : "-";
  const maxSec = wins.length ? Math.max(...wins.map((f) => f.seconds)) : 0;
  const maxSecFloor = wins.find((f) => f.seconds === maxSec)?.floor ?? "-";
  const last = r.floors[r.floors.length - 1];
  const status = r.completed
    ? `通关 100/100 (全5阶:${r.allRank5 ? "是" : "否"})`
    : `止步 F${last?.floor} (${last?.result === "flee" ? "超时" : "败北"})`;
  console.log(
    `[${r.archetype}] ${r.label}\n  结果: ${status} | 住宿 ${r.totalRests} 次 | 阵亡 ${r.totalDeaths} 人次 | 最低胜场余血 ${minHp}% (F${minFloor}) | 平均余血 ${avgHp}% | 最久 ${maxSec}s (F${maxSecFloor}) | 结余金币 ${r.finalGold}`,
  );
}

function printChapterTable(run: RunSummary) {
  console.log(`\n--- 分章节统计：${run.label} ---`);
  console.log("章节        | 过关 | 均值血量 | 最低血量(关)  | 均值耗时 | 最久(关)    | 阵亡 | 住宿 | 章末金币");
  for (let ch = 0; ch < 5; ch++) {
    const start = ch * 20 + 1;
    const end = (ch + 1) * 20;
    const slice = run.floors.filter((f) => f.floor >= start && f.floor <= end);
    const wins = slice.filter((f) => f.result === "victory");
    if (!slice.length) continue;
    const avgHp = wins.length
      ? `${(wins.reduce((s, f) => s + f.endHpPct, 0) / wins.length).toFixed(1)}%`
      : "-";
    const minRow = wins.reduce<FloorMetric | null>(
      (best, x) => (!best || x.endHpPct < best.endHpPct ? x : best),
      null,
    );
    const maxSecRow = wins.reduce<FloorMetric | null>(
      (best, x) => (!best || x.seconds > best.seconds ? x : best),
      null,
    );
    const avgSec = wins.length
      ? `${(wins.reduce((s, f) => s + f.seconds, 0) / wins.length).toFixed(1)}s`
      : "-";
    const deaths = slice.reduce((s, f) => s + f.deaths, 0);
    const rests = slice.filter((f) => f.rested).length;
    const endGold = slice[slice.length - 1]!.goldAfter;
    console.log(
      `F${String(start).padStart(2, "0")}-F${String(end).padStart(3, " ")} | ${String(wins.length).padStart(2, " ")}/20 | ${avgHp.padStart(8, " ")} | ${(minRow ? `${minRow.endHpPct}% (F${minRow.floor})` : "-").padStart(13, " ")} | ${avgSec.padStart(8, " ")} | ${(maxSecRow ? `${maxSecRow.seconds}s (F${maxSecRow.floor})` : "-").padStart(11, " ")} | ${String(deaths).padStart(4, " ")} | ${String(rests).padStart(4, " ")} | ${String(endGold).padStart(8, " ")}`,
    );
  }
}

function printKeyFloors(run: RunSummary) {
  const rows = showAllFloors
    ? run.floors
    : run.floors.filter(
        (f) =>
          f.boss ||
          f.result !== "victory" ||
          f.endHpPct < 65 ||
          f.deaths > 0 ||
          f.seconds > 40,
      );
  console.log(
    `\n--- ${showAllFloors ? "全100层逐层明细" : "关键波动关卡（Boss / 余血<65% / 有阵亡 / 耗时>40s / 失败）"}：${run.label} ---`,
  );
  console.log("层   | 结果 | 耗时  | 余血   | 死/补 | 宿 | Lv(主/宠) | 金币  | 关卡");
  for (const r of rows) {
    const tag = r.boss ? "◆" : " ";
    console.log(
      `F${String(r.floor).padStart(3, "0")}${tag}| ${r.result === "victory" ? "胜  " : r.result === "flee" ? "超  " : "败  "} | ${String(r.seconds).padStart(5, " ")} | ${`${r.endHpPct}%`.padStart(6, " ")} |  ${r.deaths}/${r.reinforcements}  | ${r.rested ? "宿" : "  "} | ${String(r.heroLv).padStart(2, " ")}/${String(r.maxPetLv).padStart(2, " ")}    | ${String(r.goldAfter).padStart(5, " ")} | ${r.title}`,
    );
  }
}

printChapterTable(runs[0]!);
printKeyFloors(runs[0]!);
printChapterTable(runs[2]!);
printKeyFloors(runs[2]!);

if (jsonOut) {
  fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify({ seed, runs }, null, 2));
  console.log(`\n已写入 JSON 报告: ${jsonOut}`);
}
