import { attributesSchema, type Config, type Attributes } from "./config";
import { capped } from "./math";
export function combatantAttributes(
  config: Config,
  id: string,
  level: number,
  gear: string[] = [],
  rank = 1,
): Attributes {
  const d = config.Rules.Combatants[id];
  if (!d) throw new Error("角色不存在：" + id);
  const a = attributesSchema.parse({});
  for (const k of Object.keys(a) as (keyof Attributes)[])
    a[k] = d.Base[k] + d.Growth[k] * (level - 1);
  for (const id of gear) {
    const g = config.Rules.Equipment.find((g) => g.Id === id);
    if (!g) throw new Error("装备不存在：" + id);
    for (const k of Object.keys(a) as (keyof Attributes)[])
      a[k] += g.Attributes[k];
  }
  if (rank >= 3 && config.Rules.Profiles[id]?.PassiveEffect === "energy_attack")
    a.EnergyRegen += 0.1 * (rank >= 5 ? 2 : 1);
  if (rank >= 3 && config.Rules.Profiles[id]?.PassiveEffect === "attack_heal")
    a.Lifesteal += 0.05 * (rank >= 5 ? 2 : 1);
  if (rank >= 3 && ["root_guard","silver"].includes(config.Rules.Profiles[id]?.PassiveEffect ?? ""))
    a.Tenacity += 0.2;
  return capped(a);
}
export function enemyAttributes(
  config: Config,
  group: Config["Encounters"][number]["Enemies"][number],
): Attributes {
  const a = combatantAttributes(config, group.Species, group.Level);
  if (group.Rank >= 3 && (group.ProfileOverride ?? config.Rules.Profiles[group.Species])?.PassiveEffect === "energy_attack")
    a.EnergyRegen = Math.min(1, a.EnergyRegen + 0.1 * (group.Rank >= 5 ? 2 : 1));
  if (group.Rank >= 3 && (group.ProfileOverride ?? config.Rules.Profiles[group.Species])?.PassiveEffect === "attack_heal")
    a.Lifesteal = Math.min(0.6, a.Lifesteal + 0.05 * (group.Rank >= 5 ? 2 : 1));
  if (group.Rank >= 3 && ["root_guard","silver"].includes((group.ProfileOverride ?? config.Rules.Profiles[group.Species])?.PassiveEffect ?? ""))
    a.Tenacity = Math.min(0.6, a.Tenacity + 0.2);
  a.MaxHp = Math.ceil(a.MaxHp * group.Health);
  a.Attack = Math.ceil(a.Attack * group.AttackScale);
  a.Magic = Math.ceil(a.Magic * group.AttackScale);
  a.Defense = Math.ceil(a.Defense * group.DefenseScale);
  return a;
}

const LEVEL_XP_SCALE_AFTER_30 = 1.18;

/** Returns cumulative hero/princess XP required to reach the given level (1+). */
export function humanXpForLevel(thresholds: number[], level: number): number {
  if (level <= 1) return 0;
  const idx = level - 2;
  if (idx < thresholds.length) return thresholds[idx]!;
  if (thresholds.length === 0) return 0;
  let total = thresholds[thresholds.length - 1]!;
  let prevStep =
    thresholds.length >= 2
      ? thresholds[thresholds.length - 1]! - thresholds[thresholds.length - 2]!
      : thresholds[0]!;
  for (let lv = thresholds.length + 2; lv <= level; lv++) {
    prevStep = Math.max(1, Math.round(prevStep * LEVEL_XP_SCALE_AFTER_30));
    total += prevStep;
  }
  return total;
}

/** Returns unlimited human level from cumulative XP (linear stat growth, escalating XP thresholds). */
export function humanLevelFromXp(thresholds: number[], xp: number): number {
  let level = 1;
  let total = 0;
  for (const threshold of thresholds) {
    if (xp < threshold) return level;
    total = threshold;
    level++;
  }
  if (thresholds.length === 0) return 1;
  let prevStep =
    thresholds.length >= 2
      ? thresholds[thresholds.length - 1]! - thresholds[thresholds.length - 2]!
      : thresholds[0]!;
  while (true) {
    prevStep = Math.max(1, Math.round(prevStep * LEVEL_XP_SCALE_AFTER_30));
    total += prevStep;
    if (xp < total) return level;
    level++;
  }
}

/** Returns monster XP cost to advance from `level` to `level + 1`. */
export function monsterCostForLevel(costs: number[], level: number): number {
  if (level < 1) return 0;
  if (level - 1 < costs.length) return costs[level - 1]!;
  if (costs.length === 0) return 25;
  let cost = costs[costs.length - 1]!;
  for (let lv = costs.length + 1; lv <= level; lv++) {
    cost = Math.ceil((cost * LEVEL_XP_SCALE_AFTER_30) / 25) * 25;
  }
  return cost;
}

/** Returns cumulative monster potion XP required to reach `level`. */
export function monsterTotalXpForLevel(costs: number[], level: number): number {
  let total = 0;
  for (let lv = 1; lv < level; lv++) {
    total += monsterCostForLevel(costs, lv);
  }
  return total;
}

/** Returns unlimited monster level from invested potion XP. */
export function monsterLevelFromXp(costs: number[], potionXp: number): number {
  let xp = potionXp;
  let level = 1;
  for (const cost of costs) {
    if (xp < cost) return level;
    xp -= cost;
    level++;
  }
  if (costs.length === 0) return 1;
  let cost = costs[costs.length - 1]!;
  while (true) {
    cost = Math.ceil((cost * LEVEL_XP_SCALE_AFTER_30) / 25) * 25;
    if (xp < cost) return level;
    xp -= cost;
    level++;
  }
}

/** Returns Princess's post-battle human HP recovery percentage (0 when passive inactive). */
export function postBattleHumanHealRatio(
  config: Config,
  princessGear: string[],
): number {
  const profile = config.Rules.Profiles.princess;
  if (!profile || profile.PassiveEffect !== "post_battle_human_heal") return 0;
  let ratio = profile.PostBattleHealBase ?? 0.12;
  for (const gearId of princessGear) {
    const g = config.Rules.Equipment.find((item) => item.Id === gearId);
    if (g?.PostBattleHealBonus) ratio += g.PostBattleHealBonus;
  }
  return Math.min(1, ratio);
}
