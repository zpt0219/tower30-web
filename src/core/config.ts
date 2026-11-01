import { z } from "zod";
const n = z.number().finite().nonnegative();
const integer = n.int().max(1_000_000);
const id = z.string().min(1).max(100);
export const attributesSchema = z.object({
  MaxHp: integer.default(0),
  Attack: integer.default(0),
  Defense: integer.default(0),
  Magic: integer.default(0),
  Resistance: integer.default(0),
  CritRate: n.max(100000).default(0),
  Penetration: n.max(100000).default(0),
  Haste: n.max(100000).default(0),
  DodgeRate: n.max(100000).default(0),
  Lifesteal: n.max(100000).default(0),
  Tenacity: n.max(100000).default(0),
  EnergyRegen: n.max(100000).default(0),
});
export type Attributes = z.infer<typeof attributesSchema>;
const profileSchema = z.object({
  Role: z.enum(["melee", "tank", "ranged", "healer"]),
  Auto: z.string(),
  Ultimate: id,
  Passive: z.string().default(""),
  PassiveEffect: z.string().default(""),
  AutoDescription: z.string().default(""),
  UltimateDescription: z.string().default(""),
  PassiveDescription: z.string().default(""),
  Cooldown: n.min(1).max(30),
  Interval: n.min(0.4).max(5),
});
const enemySchema = z.object({
  Species: id,
  Count: integer.min(1).max(12),
  Level: integer.min(1).max(30),
  Rank: integer.min(1).max(5),
  Health: n.min(0.01).max(30),
  AttackScale: n.positive().max(30),
  DefenseScale: n.max(30).default(1),
  Experience: integer.default(0),
  Souls: integer.min(1).max(12),
  Potions: integer.default(0),
  PotionsM: integer.default(0),
  PotionsL: integer.default(0),
  ProfileOverride: profileSchema.optional(),
});
const actionSchema = z.object({
  DamageType: z.enum(["physical", "magical", "heal", "buff"]),
  ScalingStat: z.enum(["atk", "mag"]),
  Ratios: z.array(n.max(20)).max(3).default([]),
  Bases: z.array(integer).max(3).default([]),
  Delivery: z.enum(["instant", "projectile"]),
  Family: z.string(),
  Windup: n.max(2),
  Backswing: n.max(3),
  ProjectileSpeed: n.min(1).max(100),
  Lifetime: n.positive().max(4),
  Area: z.boolean(),
  Interruptible: z.boolean(),
  Range: n.max(30).optional(),
  Radius: n.max(30).optional(),
  Duration: n.max(30).optional(),
});
const gearSchema = z.object({
  Id: id,
  Name: id,
  Slot: z.enum(["weapon", "armor", "accessory"]),
  Wearer: z.string(),
  Effect: z.string(),
  Auto: z.string(),
  Ultimate: z.string(),
  Role: z.enum(["", "melee", "tank", "ranged", "healer"]),
  AutoLevel: integer.min(1).max(3),
  UltimateLevel: integer.min(1).max(3),
  Attributes: attributesSchema,
  ModernDescription: z.string(),
});
export const configSchema = z.object({
  Species: z
    .array(
      z.object({
        Id: id,
        Name: id,
        Sprite: id,
        FrameSize: z.union([z.literal(16), z.literal(32), z.literal(64)]),
        VisualScale: n.positive(),
      }),
    )
    .length(40),
  Rules: z.object({
    CombatVersion: z.literal(2),
    PersistentEnergy: z.literal(true),
    EquipmentSkills: z.literal(true),
    MonsterBattleExperience: z.literal(false),
    PotionValue: z.literal(25),
    LevelCosts: z.array(integer.positive()).length(29),
    RankCosts: z.array(integer.positive()).length(4),
    Profiles: z.record(id, profileSchema),
    Combatants: z.record(
      id,
      z.object({
        Base: attributesSchema,
        Growth: attributesSchema,
        BasicDamageType: z.enum(["physical", "magical"]),
        ProjectileFamily: z.string(),
        WindupRatio: n.min(0.1).max(0.8),
        Radius: n.positive().max(3).optional(),
        AttackRange: n.positive().max(10).optional(),
        MoveSpeed: n.positive().max(20).optional(),
      }),
    ),
    Species: z.record(
      id,
      z.object({
        Tier: id,
        PrimaryRole: id,
        SecondaryRoles: z.array(id),
        Specialty: z.string(),
        Radius: n.positive().max(3),
        AttackRange: n.positive().max(10),
        MoveSpeed: n.positive().max(20),
        LevelCosts: z.array(integer.positive()).length(29),
      }),
    ),
    Actions: z.record(id, actionSchema),
    Equipment: z.array(gearSchema),
  }),
  HumanXpThresholds: z.array(integer.positive()).length(29),
  StartingEquipment: z.array(id),
  Encounters: z
    .array(
      z.object({
        Id: id,
        Title: id,
        Background: z.enum(["forest", "coast", "dragon", "castle"]),
        Hint: z.string(),
        Difficulty: id,
        Boss: z.boolean(),
        Gold: integer.positive().max(10000),
        Enemies: z.array(enemySchema).min(1),
      }),
    )
    .length(30),
  Floors: z
    .array(
      z.object({
        Number: integer.min(1).max(30),
        Encounter: id,
        Theme: id,
        Recover: z.literal(false),
        Equipment: z.array(id),
      }),
    )
    .length(30),
  Economy: z.object({
    Enabled: z.literal(true),
    StartingGold: integer.max(10000),
    InnBase: integer.positive(),
    InnStep: integer,
    Offers: z.array(
      z.object({
        Id: id,
        Item: id,
        Stage: integer.max(3),
        Price: integer.positive().max(10000),
        Amount: integer.positive().max(1000),
        Stock: z.union([z.literal(-1), integer.positive()]),
      }),
    ),
    SellPrices: z.record(id, integer.positive().max(10000)),
  }),
});
export type Config = z.infer<typeof configSchema>;
export type Profile = Config["Rules"]["Profiles"][string];
export type Gear = Config["Rules"]["Equipment"][number];
export type ActionRule = Config["Rules"]["Actions"][string];
export function validateConfig(input: unknown): Config {
  const c = configSchema.parse(input);
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) throw new Error(`${label} ID重复`);
  };
  unique(
    c.Species.map((s) => s.Id),
    "物种",
  );
  unique(
    c.Encounters.map((s) => s.Id),
    "敌群",
  );
  unique(
    c.Floors.map((s) => s.Encounter),
    "楼层",
  );
  unique(
    c.Rules.Equipment.map((s) => s.Id),
    "装备",
  );
  unique(
    c.Economy.Offers.map((s) => s.Id),
    "商品",
  );
  const check = (ok: boolean, label: string) => {
    if (!ok) throw new Error(`配表引用或范围错误：${label}`);
  };
  const species = new Set(c.Species.map((s) => s.Id)),
    gear = new Set(c.Rules.Equipment.map((g) => g.Id));
  const items = new Set([
    "herb",
    "revive",
    "shell",
    "xp_potion",
    "xp_potion_m",
    "xp_potion_l",
  ]);
  check(
    Object.keys(c.Rules.Combatants).length === 42 &&
      Object.keys(c.Rules.Species).length === 40 &&
      Object.keys(c.Rules.Profiles).length === 42,
    "40物种与2人类",
  );
  for (const s of [...species, "hero", "princess"]) {
    const p = c.Rules.Profiles[s],
      a = c.Rules.Combatants[s];
    check(
      !!p && !!a && !!(s === "hero" || s === "princess" || c.Rules.Species[s]),
      s,
    );
    if (p)
      check(
        !!c.Rules.Actions[p.Ultimate] && (!p.Auto || !!c.Rules.Actions[p.Auto]),
        s + "技能",
      );
    check(!!a && a.Base.MaxHp > 0, s + "生命");
  }
  c.Floors.forEach((f, i) => {
    const e = c.Encounters.find((e) => e.Id === f.Encounter);
    check(
      f.Number === i + 1 && !!e && e.Boss === ((i + 1) % 10 === 0),
      "楼层/Boss",
    );
    for (const g of f.Equipment) check(gear.has(g), g);
  });
  c.Encounters.forEach((e) => {
    check(e.Enemies.reduce((s, v) => s + v.Count, 0) <= 16, e.Id);
    e.Enemies.forEach((v) => {
      check(species.has(v.Species), v.Species);
      if (v.ProfileOverride)
        check(
          !!c.Rules.Actions[v.ProfileOverride.Ultimate] &&
            (!v.ProfileOverride.Auto ||
              !!c.Rules.Actions[v.ProfileOverride.Auto]),
          e.Id + "覆盖技能",
        );
    });
  });
  c.Rules.Equipment.forEach((g) => {
    check(!g.Auto || !!c.Rules.Actions[g.Auto], g.Id);
    check(!g.Ultimate || !!c.Rules.Actions[g.Ultimate], g.Id);
    check(
      ["hero", "princess", "human", "all", ""].includes(g.Wearer),
      g.Id + "穿戴者",
    );
  });
  for (const g of c.StartingEquipment) check(gear.has(g), g);
  unique(
    [...c.StartingEquipment, ...c.Floors.flatMap((f) => f.Equipment)],
    "奖励装备",
  );
  c.Economy.Offers.forEach((o) => {
    check(gear.has(o.Item) || items.has(o.Item), o.Id);
    check(
      (c.Economy.SellPrices[o.Item] ?? 0) * o.Amount < o.Price,
      o.Id + "套利",
    );
    if (gear.has(o.Item)) check(o.Amount === 1 && o.Stock === 1, o.Id + "库存");
  });
  for (const s of Object.keys(c.Economy.SellPrices))
    check(gear.has(s) || items.has(s), s);
  check(
    c.HumanXpThresholds.every(
      (n, i) => i === 0 || n > c.HumanXpThresholds[i - 1]!,
    ),
    "人类经验",
  );
  return c;
}
// Portable content fingerprint, not a cryptographic signature.
export function fingerprint(value: unknown): string {
  let h = 2166136261;
  for (const ch of JSON.stringify(value)) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  return "fnv1a-" + h.toString(16).padStart(8, "0");
}
