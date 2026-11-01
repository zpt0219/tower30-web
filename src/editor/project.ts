import {strategySchema} from "../core/strategy";
import {effectDefinitions} from "../core/effects";
import { z } from "zod";
import { validateConfig, type Config } from "../core/config";
import { clone } from "../core/math";
import {
  defaultPlaytestSetup,
  playtestSetupSchema,
  playtestWarnings,
  type PlaytestSetup,
} from "../core/playtest";
export interface EditorProject {
  format: "tower30-editor-project";
  schemaVersion: 1;
  source: unknown;
  setup: PlaytestSetup;
}
const projectSchema = z
  .object({
    format: z.literal("tower30-editor-project"),
    schemaVersion: z.literal(1),
    source: z.unknown(),
    setup: playtestSetupSchema,
  })
  .strict();
export const newProject = (source: unknown): EditorProject => ({
  format: "tower30-editor-project",
  schemaVersion: 1,
  source: clone(source),
  setup: defaultPlaytestSetup(),
});
export const readPath = (
  source: unknown,
  path: readonly (string | number)[],
): unknown => {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[String(key)];
  }
  return current;
};
export function setPath(
  source: unknown,
  path: readonly (string | number)[],
  value: unknown,
) {
  if (
    !path.length ||
    path.some((k) =>
      ["__proto__", "constructor", "prototype"].includes(String(k)),
    )
  )
    throw new Error("编辑路径无效");
  let current = source;
  for (const key of path.slice(0, -1)) {
    if (!current || typeof current !== "object")
      throw new Error("编辑路径不存在");
    const next = (current as Record<string, unknown>)[String(key)];
    if (!next || typeof next !== "object") throw new Error("编辑路径不存在");
    current = next;
  }
  if (!current || typeof current !== "object")
    throw new Error("编辑对象不存在");
  if (value === undefined) delete (current as Record<string, unknown>)[String(path.at(-1))];
  else (current as Record<string, unknown>)[String(path.at(-1))] = clone(value);
}
export function importProject(text: string): EditorProject {
  if (text.length > 2_000_000) throw new Error("配置文件不能超过2MB");
  const input: unknown = JSON.parse(text);
  const candidate =
    typeof input === "object" && input !== null && "format" in input
      ? projectSchema.parse(input)
      : newProject(input);
  const result = validateProject(candidate);
  if (!result.config || result.errors.length)
    throw new Error(result.errors.join("；"));
  return clone(candidate);
}
const names: Record<string, string> = {
  Rules: "规则",
  Effects:"共用效果",
  DotRatio:"持续伤害比例",
  ShieldRatios:"护盾倍率",
  ...Object.fromEntries(Object.entries(effectDefinitions).map(([key,d])=>[key,d.label])),
  Combatants: "角色",
  Base: "基础",
  Growth: "成长",
  MaxHp: "生命",
  Attack: "攻击",
  Defense: "防御",
  Magic: "法术",
  Resistance: "魔抗",
  CritRate: "暴击",
  Haste: "急速",
  DodgeRate: "闪避",
  Lifesteal: "吸血",
  Tenacity: "韧性",
  EnergyRegen: "充能",
  Penetration: "穿透",
  Encounters: "敌群",
  Enemies: "敌人",
  Count: "数量",
  Species: "物种",
  Health: "生命倍率",
  AttackScale: "攻击倍率",
  Level: "等级",
  Rank: "阶数",
  setup: "测试设置",
  floor: "关卡",
  party: "我方阵容",
  strategy:"战斗策略",
  healingHpPercent:"治疗生命阈值 %",
  ultimateOrder:"大招优先级",
  reinforcementOrder:"补人顺序",
};
function describeError(e: unknown): string[] {
  if (e instanceof z.ZodError)
    return e.issues.slice(0, 6).map((i) => {
      let message = i.message;
      if (i.code === "invalid_type")
        message = i.expected === "int" ? "请输入整数" : "请输入有效数值或选项";
      if (i.code === "unrecognized_keys") message=`存在不支持的参数：${i.keys.join("、")}`;
      const effectKey=String(i.path[2]) as keyof typeof effectDefinitions;
      const percent=i.path[1]==="Effects" && Object.hasOwn(effectDefinitions,effectKey) && effectDefinitions[effectKey].percent || i.path.at(-1)==="DotRatio";
      const bound=(value:number|bigint)=>percent?`${Number((Number(value)*100).toFixed(6))}%`:String(value);
      if (i.code === "too_small") message = `不能小于 ${bound(i.minimum)}`;
      if (i.code === "too_big") message = `不能大于 ${bound(i.maximum)}`;
      return `${i.path.map((k) => names[String(k)] ?? String(k)).join(" → ")}：${message}`;
    });
  return [e instanceof Error ? e.message : "配置无效"];
}
export function validateProject(project: EditorProject): {
  config: Config | null;
  errors: string[];
  warnings: string[];
} {
  let config: Config | null = null;
  const errors: string[] = [];
  try {
    config = validateConfig(project.source);
  } catch (e) {
    errors.push(...describeError(e));
  }
  const setup = playtestSetupSchema.safeParse(project.setup);
  if (!setup.success) errors.push(...describeError(setup.error));
  let warnings: string[] = [];
  if (config && setup.success)
    try {
      warnings = playtestWarnings(config, setup.data);
    } catch (e) {
      errors.push(...describeError(e));
    }
  return { config, errors, warnings };
}

export function restoreProject(text: string): EditorProject {
  if (text.length > 2000000) throw new Error("草稿过大");
  const looseSetup = playtestSetupSchema.safeExtend({
    floor: z.number().finite(),
    seed: z.number().finite(),
    level: z.number().finite(),
    rank: z.number().finite(),
    hpPercent: z.number().finite(),
    energy: z.number().finite(),
    strategy: strategySchema.safeExtend({healingHpPercent:z.number().finite()}).optional(),
  });
  return projectSchema.extend({ setup: looseSetup }).parse(JSON.parse(text));
}

// Structural projection for an inspector: invalid numeric edits remain editable.
// This projection is never supplied to the combat engine.
export function editableEncounter(
  source: unknown,
  config: Config,
  index: number,
): Config["Encounters"][number] {
  const out = clone(config.Encounters[index]!);
  const title = readPath(source, ["Encounters", index, "Title"]);
  if (typeof title === "string") out.Title = title;
  const raw = readPath(source, ["Encounters", index, "Enemies"]);
  if (Array.isArray(raw) && raw.length) {
    out.Enemies = raw.map((entry, i) => {
      const group = clone(out.Enemies[i] ?? out.Enemies[0]!);
      const species = readPath(entry, ["Species"]);
      if (
        typeof species === "string" &&
        config.Species.some((s) => s.Id === species)
      )
        group.Species = species;
      for (const key of [
        "Count",
        "Level",
        "Rank",
        "Health",
        "AttackScale",
        "DefenseScale",
        "Experience",
        "Souls",
        "Potions",
        "PotionsM",
        "PotionsL",
      ] as const) {
        const value = readPath(entry, [key]);
        if (typeof value === "number" && Number.isFinite(value))
          group[key] = value;
        else if (value === null) group[key] = 0;
      }
      return group;
    });
  }
  return out;
}
