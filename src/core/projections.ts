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
