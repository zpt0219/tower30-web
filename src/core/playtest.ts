import { z } from "zod";
import { strategySchema } from "./strategy";
import type { Config, Profile } from "./config";
export const supportedSkills = new Set([
  "swift",
  "steady",
  "heal",
  "renew",
  "water",
  "tide",
  "leafward", "forest_rest", "aegis", "shellwall", "bait", "taunt",
  "huntbite", "pounce", "gust", "interrupt", "firebolt", "fire_rain",
  "ram", "rupture", "boss_stomp", "breakstrike", "wardheal", "flame",
  "drain", "silence", "spirit_armor", "spirit_veil", "leech", "doublecut",
  "mossheal", "rooted_guard", "curse", "ice_shard", "ice_domain", "eye_ray",
  "hard_shell", "armor_front", "boss_carapace",
  "cleanse", "cleave", "crystal_pierce", "cyclone", "dragon_claw", "dragon_sweep",
  "dragon_wall", "draw_slash", "earth_prison", "earth_stomp", "ember", "fear_strike",
  "forest_breath", "forest_sanctuary", "frenzy_cut", "frost_breath", "furious_assault",
  "gloom", "holy_light", "holy_prayer", "lava_bolt", "nightmare_strike", "parry",
  "poison", "poison_cloud", "purify_veil", "shatter_ray", "silver_guard", "silver_wall",
  "tailwind", "boss_tempest",
]);
export const supportedGearEffects = new Set(["", "emergency", "arrival", "attack_energy", "hurt_energy", "overheal", "spell_guard"]);
export const supportedPassives = new Set([
  "slow", "heal_low", "shield_heal", "shield_targets", "damage_guard",
  "energy_attack", "execute", "armor_bonus", "burn_bonus",
  "drain", "spell_guard", "attack_heal", "combo", "self_heal", "weaken",
  "controlled_bonus", "physical_guard",
  "controlled_leech", "shield_counter", "low_power", "root_guard", "poison",
  "shield_break", "slow_power", "haste", "silver", "cleanse_ward", "unshielded",
  "thorns", "flame_bonus", "shield_power", "counter",
]);
export const playtestSetupSchema = z
  .object({
    strategy: strategySchema.optional(),
    autoPlay: z.boolean().optional(),
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
  .strict().superRefine((s,ctx)=>{
    for(const key of ["ultimateOrder","reinforcementOrder"] as const)
      for(const id of s.strategy?.[key]??[])if(!s.party.includes(id))ctx.addIssue({code:"custom",path:["strategy",key],message:"策略顺序只能包含当前阵容成员："+id});
  });
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
    if (rank >= 3 && p.PassiveEffect && !supportedPassives.has(p.PassiveEffect))
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
      if (w && !supportedGearEffects.has(w.Effect)) warnings.add(`${id}：装备效果 ${w.Effect}`);
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
