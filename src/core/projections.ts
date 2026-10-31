import { attributesSchema, type Config, type Attributes } from "./config";
import { capped } from "./math";
export function combatantAttributes(
  config: Config,
  id: string,
  level: number,
  gear: string[] = [],
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
  return capped(a);
}
export function enemyAttributes(
  config: Config,
  group: Config["Encounters"][number]["Enemies"][number],
): Attributes {
  const a = combatantAttributes(config, group.Species, group.Level);
  a.MaxHp = Math.ceil(a.MaxHp * group.Health);
  a.Attack = Math.ceil(a.Attack * group.AttackScale);
  a.Magic = Math.ceil(a.Magic * group.AttackScale);
  a.Defense = Math.ceil(a.Defense * group.DefenseScale);
  return a;
}
