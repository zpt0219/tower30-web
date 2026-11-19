import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import raw from "../data/tower/trial.json";
import { validateConfig } from "../src/core/config";
import { TowerEngine, isHuman } from "../src/core/engine";
import { combatantAttributes } from "../src/core/projections";
import { applyStrategy, defaultStrategy } from "../src/core/strategy";

const DEFAULT_SEEDS = [
  2463534242,
  123456,
  987654,
  135792468,
  20260401,
  314159265,
  777777777,
  1122334455,
  299792458,
  424242424,
];

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  const next = process.argv[idx + 1];
  return next && !next.startsWith("--") ? next : undefined;
}

const args = process.argv.slice(2);
const showAllFloors = args.includes("--detail");
const workerJsonMode = args.includes("--worker-json");
const seedArg = getArg("--seed");
const seed = seedArg ? Number(seedArg) : DEFAULT_SEEDS[0]!;
const seedsArg = getArg("--seeds");
const seedCount = seedsArg ? Math.max(1, Number(seedsArg)) : 0;
const jobsArg = getArg("--jobs");
const jsonOut = getArg("--json");
const exportCheckpointsMode = args.includes("--export-checkpoints");
const exportCheckpointsDir =
  getArg("--export-checkpoints") ??
  (exportCheckpointsMode ? ".tools/checkpoints" : undefined);
const checkpointFloorsArg = getArg("--checkpoint-floors");
const checkpointArchetypesArg = getArg("--checkpoint-archetypes");
const archetypesArg = getArg("--archetypes");

const config = validateConfig(raw, { allowUnknownEnemySpecies: false });

type Archetype =
  | "smart_princess"
  | "wasteful_princess"
  | "optimal_no_princess"
  | "early_no_princess"
  | "single_carry_princess";

const ARCHETYPE_SPECS: { id: Archetype; label: string; slug: string }[] = [
  { id: "smart_princess", label: "正常主力（带公主+集中养宠）", slug: "smart" },
  { id: "wasteful_princess", label: "乱配资源（均摊经验+不买装）", slug: "wasteful" },
  { id: "optimal_no_princess", label: "无公主极限（主角+4宠精调轮换）", slug: "no-princess" },
  { id: "early_no_princess", label: "无公主常规（仅前期7宠不轮换）", slug: "early-no-princess" },
  { id: "single_carry_princess", label: "单核偏科（全药水砸1只核心宠）", slug: "single-carry" },
];

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

interface SingleSeedReport {
  seed: number;
  runs: RunSummary[];
}

interface CheckpointRecord {
  file: string;
  floor: number;
  boss: boolean;
  title: string;
  archetype: Archetype;
  label: string;
  seed: number;
  configHash: string;
  gold: number;
  shopStage: number;
  heroLv: number;
  princessLv: number | null;
  maxPetLv: number;
  unlockedSpecies: number;
  rank5Species: number;
  bytes: number;
  journalCommands: number;
  restoreMs: number;
}

function buildSeedList(count: number): number[] {
  const list = [...DEFAULT_SEEDS];
  let x = 0x9e3779b9;
  while (list.length < count) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    list.push((x >>> 0) || 1);
  }
  return list.slice(0, count);
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

function runArchetype(
  archetype: Archetype,
  label: string,
  runSeed: number,
  options?: {
    stopAfterFloor?: number;
    onPreBattle?: (floor: number, engine: TowerEngine) => void;
  },
): RunSummary {
  const e = new TowerEngine(config, runSeed);
  const floors: FloorMetric[] = [];
  let totalRests = 0;
  let totalDeaths = 0;
  const maxFloor = options?.stopAfterFloor ?? 100;

  for (let f = 1; f <= maxFloor; f++) {
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

    options?.onPreBattle?.(f, e);

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
    cleared: floors.filter((x) => x.result === "victory").length,
    completed: fin.completed,
    allRank5: fin.members.filter((m) => !isHuman(m.id)).every((m) => m.rank === 5),
    totalRests,
    totalDeaths,
    finalGold: fin.gold,
    floors,
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : 0;
}

function selectedArchetypes(): typeof ARCHETYPE_SPECS {
  if (!archetypesArg) return ARCHETYPE_SPECS;
  const set = new Set(archetypesArg.split(",").map((s) => s.trim()));
  return ARCHETYPE_SPECS.filter((s) => set.has(s.id) || set.has(s.slug));
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

function runWorkerSeed(targetSeed: number): Promise<SingleSeedReport> {
  return new Promise((resolve, reject) => {
    const childArgs = [process.argv[1]!, "--seed", String(targetSeed), "--worker-json"];
    if (archetypesArg) childArgs.push("--archetypes", archetypesArg);
    const child = spawn(process.execPath, childArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `seed ${targetSeed} exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as SingleSeedReport);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function runMultiSeed(seeds: number[], concurrency: number) {
  const results: SingleSeedReport[] = new Array(seeds.length);
  let cursor = 0;
  async function worker() {
    while (cursor < seeds.length) {
      const idx = cursor++;
      results[idx] = await runWorkerSeed(seeds[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, seeds.length) }, () => worker()),
  );

  const specs = selectedArchetypes();
  console.log(
    `\n=== 翠庭试炼 100层 多种子强度体检 (${seeds.length} seeds, jobs=${Math.min(concurrency, seeds.length)}) ===`,
  );
  console.log(`Seeds: ${seeds.join(", ")}\n`);

  for (const spec of specs) {
    const list = results
      .map((r) => r.runs.find((x) => x.archetype === spec.id))
      .filter((x): x is RunSummary => !!x);
    const passed = list.filter((r) => r.completed);
    const rank5Count = passed.filter((r) => r.allRank5).length;
    const clearedList = list.map((r) => r.cleared);
    const failMap = new Map<number, number>();
    for (const r of list) {
      if (!r.completed) {
        const failFloor = r.floors[r.floors.length - 1]?.floor ?? r.cleared + 1;
        failMap.set(failFloor, (failMap.get(failFloor) ?? 0) + 1);
      }
    }
    const failDist = [...failMap.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([fl, c]) => `F${fl}×${c}`)
      .join(", ");
    const minWinHps = list
      .map((r) => {
        const wins = r.floors.filter((f) => f.result === "victory");
        return wins.length ? Math.min(...wins.map((f) => f.endHpPct)) : 0;
      });
    const avgWinHps = list.map((r) =>
      mean(r.floors.filter((f) => f.result === "victory").map((f) => f.endHpPct)),
    );
    const passPct = ((passed.length / list.length) * 100).toFixed(0);
    console.log(`[${spec.id}] ${spec.label}`);
    console.log(
      `  通关率: ${passed.length}/${list.length} (${passPct}%, 全5阶:${rank5Count}/${passed.length}) | 通关层数 min/med/max: ${Math.min(...clearedList)}/${median(clearedList).toFixed(0)}/${Math.max(...clearedList)}`,
    );
    console.log(
      `  最低胜场余血 min/med: ${Math.min(...minWinHps).toFixed(1)}% / ${median(minWinHps).toFixed(1)}% | 平均余血 med: ${median(avgWinHps).toFixed(1)}% | 阵亡 med: ${median(list.map((r) => r.totalDeaths)).toFixed(0)} | 住宿 med: ${median(list.map((r) => r.totalRests)).toFixed(0)} | 结余金币 med: ${median(list.map((r) => r.finalGold)).toFixed(0)}`,
    );
    if (failDist) {
      console.log(`  止步分布: ${failDist}`);
    }
  }

  for (const focusId of ["smart_princess", "optimal_no_princess"] as Archetype[]) {
    const spec = specs.find((s) => s.id === focusId);
    if (!spec) continue;
    const list = results
      .map((r) => r.runs.find((x) => x.archetype === focusId))
      .filter((x): x is RunSummary => !!x);
    console.log(`\n--- 多种子分章节聚合：${spec.label} ---`);
    console.log("章节        | 全通种子 | 均值血量 | 最低血量(最险关)  | 阵亡均值 | 住宿均值 | 章末金币均值");
    for (let ch = 0; ch < 5; ch++) {
      const start = ch * 20 + 1;
      const end = (ch + 1) * 20;
      const chWins = list.flatMap((r) =>
        r.floors.filter((f) => f.floor >= start && f.floor <= end && f.result === "victory"),
      );
      const chAll = list.flatMap((r) =>
        r.floors.filter((f) => f.floor >= start && f.floor <= end),
      );
      const clearedSeeds = list.filter(
        (r) => r.floors.filter((f) => f.floor >= start && f.floor <= end && f.result === "victory").length === 20,
      ).length;
      const worst = chWins.reduce<FloorMetric | null>(
        (best, x) => (!best || x.endHpPct < best.endHpPct ? x : best),
        null,
      );
      const endGolds = list
        .map((r) => r.floors.find((f) => f.floor === end)?.goldAfter)
        .filter((x): x is number => typeof x === "number");
      console.log(
        `F${String(start).padStart(2, "0")}-F${String(end).padStart(3, " ")} | ${String(clearedSeeds).padStart(3, " ")}/${String(list.length).padEnd(4, " ")} | ${`${mean(chWins.map((f) => f.endHpPct)).toFixed(1)}%`.padStart(8, " ")} | ${(worst ? `${worst.endHpPct}% (F${worst.floor})` : "-").padStart(17, " ")} | ${(chAll.reduce((s, f) => s + f.deaths, 0) / list.length).toFixed(1).padStart(8, " ")} | ${(chAll.filter((f) => f.rested).length / list.length).toFixed(1).padStart(8, " ")} | ${(endGolds.length ? mean(endGolds).toFixed(0) : "-").padStart(12, " ")}`,
      );
    }

    // Top 12 toughest floors by failure count then average remaining HP
    const byFloor = new Map<
      number,
      { boss: boolean; title: string; attempts: number; fails: number; hps: number[]; deaths: number }
    >();
    for (const r of list) {
      for (const f of r.floors) {
        const entry = byFloor.get(f.floor) ?? {
          boss: f.boss,
          title: f.title,
          attempts: 0,
          fails: 0,
          hps: [],
          deaths: 0,
        };
        entry.attempts++;
        if (f.result !== "victory") entry.fails++;
        else entry.hps.push(f.endHpPct);
        entry.deaths += f.deaths;
        byFloor.set(f.floor, entry);
      }
    }
    const toughest = [...byFloor.entries()]
      .sort((a, b) => {
        if (b[1].fails !== a[1].fails) return b[1].fails - a[1].fails;
        return mean(a[1].hps) - mean(b[1].hps);
      })
      .slice(0, 12);
    console.log(`\n--- 多种子高压榜 Top 12：${spec.label} ---`);
    console.log("层   | 败次/次 | 胜场均血 | 最低余血 | 阵亡合计 | 关卡");
    for (const [fl, st] of toughest) {
      const tag = st.boss ? "◆" : " ";
      const avg = st.hps.length ? `${mean(st.hps).toFixed(1)}%` : "-";
      const min = st.hps.length ? `${Math.min(...st.hps).toFixed(1)}%` : "-";
      console.log(
        `F${String(fl).padStart(3, "0")}${tag}| ${String(st.fails).padStart(3, " ")}/${String(st.attempts).padEnd(3, " ")} | ${avg.padStart(8, " ")} | ${min.padStart(8, " ")} | ${String(st.deaths).padStart(8, " ")} | ${st.title}`,
      );
    }
  }

  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify({ seeds, results }, null, 2));
    console.log(`\n已写入多种子 JSON 报告: ${jsonOut}`);
  }
}

function exportCheckpoints(outDir: string) {
  const targetFloors = (checkpointFloorsArg ?? "20,40,60,80,95,100")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 100)
    .sort((a, b) => a - b);
  const targetSet = new Set(targetFloors);
  const maxTarget = targetFloors[targetFloors.length - 1] ?? 100;
  const wantedSpecs = (checkpointArchetypesArg ?? "smart_princess,optimal_no_princess")
    .split(",")
    .map((s) => s.trim())
    .map((key) => ARCHETYPE_SPECS.find((s) => s.id === key || s.slug === key))
    .filter((s): s is (typeof ARCHETYPE_SPECS)[number] => !!s);

  fs.mkdirSync(outDir, { recursive: true });
  const records: CheckpointRecord[] = [];

  for (const spec of wantedSpecs) {
    runArchetype(spec.id, spec.label, seed, {
      stopAfterFloor: maxTarget,
      onPreBattle: (floor, engine) => {
        if (!targetSet.has(floor)) return;
        const json = engine.serialize();
        const t0 = performance.now();
        const restored = TowerEngine.restore(config, json);
        const restoreMs = Number((performance.now() - t0).toFixed(1));
        const snap = restored.getSnapshot();
        const parsed = JSON.parse(json) as { journal: unknown[] };
        if (snap.floor !== floor) {
          throw new Error(`Checkpoint restore floor mismatch: expected ${floor}, got ${snap.floor}`);
        }
        const fileName = `checkpoint-f${String(floor).padStart(2, "0")}-${spec.slug}.json`;
        const filePath = path.join(outDir, fileName);
        fs.writeFileSync(filePath, json, "utf8");
        const enc = config.Encounters[floor - 1]!;
        const hero = snap.members.find((m) => m.id === "hero")!;
        const princess = snap.members.find((m) => m.id === "princess");
        const pets = snap.members.filter((m) => !isHuman(m.id));
        records.push({
          file: fileName,
          floor,
          boss: enc.Boss,
          title: enc.Title,
          archetype: spec.id,
          label: spec.label,
          seed,
          configHash: snap.configHash,
          gold: snap.gold,
          shopStage: snap.shopStage,
          heroLv: hero.level,
          princessLv: princess ? princess.level : null,
          maxPetLv: Math.max(0, ...pets.map((p) => p.level)),
          unlockedSpecies: pets.length,
          rank5Species: pets.filter((p) => p.rank === 5).length,
          bytes: Buffer.byteLength(json, "utf8"),
          journalCommands: parsed.journal.length,
          restoreMs,
        });
      },
    });
  }

  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ seed, generatedAt: new Date().toISOString(), records }, null, 2),
    "utf8",
  );

  const lines = [
    "# 翠庭试炼 · 合法章节实玩存档（自动 60Hz 通关导出）",
    "",
    `- 种子: \`${seed}\``,
    `- 用法: 打开游戏「存档」页 -> 「导入存档 JSON」选择任意文件；导入后直接位于该层战前整备页，宠物经验药水支持 100% 无损退还重配。`,
    "",
    "| 文件 | 路线 | 层数与关卡 | 主角/最高宠Lv | 金币 | 商店阶段 | 已收编(5阶) | 体积 | 命令数 | 恢复耗时 |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of records) {
    lines.push(
      `| \`${r.file}\` | ${r.label} | F${r.floor}${r.boss ? "◆" : ""} ${r.title} | Lv.${r.heroLv} / Lv.${r.maxPetLv} | ${r.gold} | 阶段${r.shopStage} | ${r.unlockedSpecies} (${r.rank5Species}) | ${(r.bytes / 1024).toFixed(1)}KB | ${r.journalCommands} | ${r.restoreMs}ms |`,
    );
  }
  fs.writeFileSync(path.join(outDir, "README.md"), `${lines.join("\n")}\n`, "utf8");

  console.log(`\n=== 已导出并校验 ${records.length} 份合法章节存档 -> ${outDir} ===`);
  for (const r of records) {
    console.log(
      `  ${r.file.padEnd(34, " ")} | F${String(r.floor).padStart(3, " ")} | Lv.${String(r.heroLv).padStart(2, " ")}/${String(r.maxPetLv).padStart(2, " ")} | 金币 ${String(r.gold).padStart(5, " ")} | ${(r.bytes / 1024).toFixed(1).padStart(6, " ")}KB | ${String(r.journalCommands).padStart(4, " ")} cmds | restore ${r.restoreMs}ms | hash ${r.configHash}`,
    );
  }
}

async function main() {
  if (exportCheckpointsDir) {
    exportCheckpoints(exportCheckpointsDir);
    return;
  }

  if (seedCount > 1) {
    const seeds = buildSeedList(seedCount);
    const concurrency = jobsArg ? Math.max(1, Number(jobsArg)) : Math.min(8, seeds.length);
    await runMultiSeed(seeds, concurrency);
    return;
  }

  const runs = selectedArchetypes().map((spec) =>
    runArchetype(spec.id, spec.label, seed),
  );

  if (workerJsonMode) {
    process.stdout.write(JSON.stringify({ seed, runs }));
    return;
  }

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

  const smart = runs.find((r) => r.archetype === "smart_princess");
  const noPrincess = runs.find((r) => r.archetype === "optimal_no_princess");
  if (smart) {
    printChapterTable(smart);
    printKeyFloors(smart);
  }
  if (noPrincess) {
    printChapterTable(noPrincess);
    printKeyFloors(noPrincess);
  }

  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify({ seed, runs }, null, 2));
    console.log(`\n已写入 JSON 报告: ${jsonOut}`);
  }
}

void main();
