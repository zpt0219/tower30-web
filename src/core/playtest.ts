import { z } from "zod";
import type { Config, Profile } from "./config";
export const supportedSkills = new Set([
  "swift",
  "steady",
  "heal",
  "renew",
  "water",
  "tide",
]);
export const playtestSetupSchema = z
  .object({
    floor: z.number().int().min(1).max(30),
    seed: z.number().int().min(1).max(0xffffffff),
    party: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(10)
      .refine((a) => new Set(a).size === a.length, "测试阵容不可重复"),
    level: z.number().int().min(1).max(30),
    rank: z.number().int().min(1).max(5),
    hpPercent: z.number().min(1).max(100),
    energy: z.number().min(0).max(1000),
    startingGear: z.boolean(),
    skillPolicy: z.enum(["strict", "supported-only"]),
  })
  .strict();
export type PlaytestSetup = z.infer<typeof playtestSetupSchema>;
export const defaultPlaytestSetup = (): PlaytestSetup => ({
  floor: 1,
  seed: 2463534242,
  party: ["hero", "princess"],
  level: 1,
  rank: 1,
  hpPercent: 100,
  energy: 0,
  startingGear: true,
  skillPolicy: "supported-only",
});
export function playtestWarnings(
  config: Config,
  setup: PlaytestSetup,
): string[] {
  const warnings = new Set<string>();
  const check = (id: string, p: Profile, rank: number) => {
    if (p.Auto && !supportedSkills.has(p.Auto))
      warnings.add(`${id}：自动技能 ${p.Auto}`);
    if (p.Ultimate && !supportedSkills.has(p.Ultimate))
      warnings.add(`${id}：大招 ${p.Ultimate}`);
    if (rank >= 3 && p.PassiveEffect)
      warnings.add(`${id}：三阶被动 ${p.PassiveEffect}`);
  };
  for (const id of setup.party) {
    if (!Object.hasOwn(config.Rules.Combatants, id))
      throw new Error("测试角色不存在：" + id);
    const p = { ...config.Rules.Profiles[id]! };
    if (setup.startingGear && ["hero", "princess"].includes(id)) {
      const w = config.Rules.Equipment.find(
        (g) => g.Id === (id === "hero" ? "traveler_sword" : "healer_staff"),
      );
      if (w?.Auto) p.Auto = w.Auto;
      if (w?.Ultimate) p.Ultimate = w.Ultimate;
    } else if (["hero", "princess"].includes(id)) p.Auto = "";
    check(id, p, ["hero", "princess"].includes(id) ? 1 : setup.rank);
  }
  const encounter = config.Encounters.find(
    (e) => e.Id === config.Floors[setup.floor - 1]!.Encounter,
  )!;
  for (const e of encounter.Enemies)
    check(
      e.Species,
      e.ProfileOverride ?? config.Rules.Profiles[e.Species]!,
      e.Rank,
    );
  return [...warnings];
}
