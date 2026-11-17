import { z } from "zod";
import {MAX_TICKS} from "./math";
import type { ActionRule, Attributes, Profile } from "./config";
const memberId = z.string().min(1).max(100),
  quantity = z.number().int().min(1).max(100),
  sellQuantity = z.number().int().min(1).max(9999);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin") }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("opening"), id: memberId }),
  z.object({ type: z.literal("ultimate"), id: memberId }),
  z.object({ type: z.literal("reinforce"), id: memberId }),
  z.object({ type: z.literal("retry") }),
  z.object({ type: z.literal("withdraw") }),
  z.object({ type: z.literal("finish") }),
  z.object({ type: z.literal("buy"), id: memberId, quantity }),
  z.object({ type: z.literal("sell"), id: memberId, quantity: sellQuantity }),
  z.object({ type: z.literal("rest") }),
  z.object({
    type: z.literal("item"),
    id: memberId,
    item: z.enum(["herb", "revive"]),
  }),
  z.object({ type: z.literal("equip"), id: memberId, gear: memberId }),
  z.object({
    type: z.literal("unequip"),
    id: memberId,
    slot: z.enum(["weapon", "armor", "accessory"]),
  }),
  z.object({ type: z.literal("train"), id: memberId }),
  z.object({ type: z.literal("refund"), id: memberId }),
  z.object({ type: z.literal("rank"), id: memberId }),
]);
export type Command = z.infer<typeof commandSchema>;
export interface Member {
  id: string;
  hp: number;
  energy: number;
  rank: number;
  potionXp: number;
  equipment: Partial<Record<"weapon" | "armor" | "accessory", string>>;
}
export interface Contribution {
  damage: number;
  healing: number;
  absorbed: number;
  attackEnergy: number;
  hurtEnergy: number;
  killEnergy: number;
  ultimates: number;
  criticals: number;
  dodges: number;
  interrupts: number;
  staggers: number;
}
export interface Unit extends Contribution {
  id: string;
  kind: string;
  enemy: boolean;
  hp: number;
  energy: number;
  attributes: Attributes;
  profile: Profile;
  rank: number;
  slot: number;
  x: number;
  z: number;
  radius: number;
  range: number;
  moveSpeed: number;
  autoLevel: number;
  ultimateLevel: number;
  passiveLevel: number;
  cooldown: number;
  special: number;
  entry: number;
  slow: number;
  stun: number;
  barrier: number;
  shield: number;
  dotTime: number;
  dotTick: number;
  dotPower: number;
  dotOwner: string;
  healBlock: number;
  reflectCooldown: number;
  haste: number;
  counterReady: boolean;
  weaken: number;
  root: number;
  physicalGuard: number;
  spellGuard: number;
  comboHits: number;
  comboTarget: string;
  charge: number;
  armorBreak: number;
  silence: number;
  taunt: number;
  taunter: string;
  controlGuard: number;
  leech: number;
  focusTime: number;
  focus: string;
  emergencyUsed: boolean;
  regeneration: number;
  regenTick: number;
  regenOwner: string;
  hitStun: number;
  hitGuard: number;
  blockedFor: number;
  basicCount: number;
  skillCursor: number;
  resBreak: number;
  resBreakAmount: number;
  armorBreakAmount: number;
  vuln: number;
  vulnAmount: number;
  blind: number;
  blindRate: number;
  disarm: number;
  energyLock: number;
  stealth: number;
  undying: number;
  reviveUsed: boolean;
  petrify: number;
  petrifyDamage: number;
  atkBuff: number;
  atkBuffAmount: number;
  defBuff: number;
  defBuffAmount: number;
  critBuff: number;
  critBuffAmount: number;
  critDmgBuff: number;
  critDmgBuffAmount: number;
  dodgeBuff: number;
  dodgeBuffAmount: number;
  lifestealBuff: number;
  lifestealBuffAmount: number;
  hasteBuffAmount: number;
  dmgReduction: number;
  dmgReductionAmount: number;
  thornsTime: number;
  thornsRatio: number;
  damageCapTime: number;
  damageCapRatio: number;
  transformTime: number;
  transformKind: string;
  stacks: Record<string, { count: number; power: number; owner: string; time: number; tick: number }>;
  shackleIds: string[];
  shackleTime: number;
  shackleRatio: number;
  shieldShareTo: string;
  shieldShareTime: number;
  shieldShareRatio: number;
  hitsTaken: number;
  damageTakenBucket: number;
  chainUltUsed: number;
  summoned?: boolean;
  summonTime?: number;
  summonOwner?: string;
  explodeOnDeath?: number;
  action: null | {
    id: number;
    kind: "basic" | "auto" | "ultimate";
    skill: string;
    target: string;
    work: number;
  };
  recovery: number;
}
export interface Projectile {
  id: number;
  actionId: number;
  owner: string;
  target: string;
  kind: "basic" | "auto" | "ultimate";
  skill: string;
  rule: ActionRule;
  source: Attributes;
  hpRatio: number;
  power: number;
  leech: number;
  x: number;
  weaken: number;
  z: number;
  speed: number;
  life: number;
}
export interface Battle {
  started: boolean;
  result: "" | "victory" | "loss" | "flee";
  tick: number;
  random: number;
  opening: string[];
  units: Unit[];
  enemies: {
    id: string;
    kind: string;
    hp: number;
    attributes: Attributes;
    profile: Profile;
    rank: number;
  }[];
  projectiles: Projectile[];
  zones: {
    owner: string;
    enemy: boolean;
    x: number;
    z: number;
    remaining: number;
    tick: number;
    power: number;
    radius: number;
    kind: string;
    allyHealRatio?: number;
    allyEnergy?: number;
    allyGuard?: number;
    enemyStunTick?: number;
    enemySlow?: number;
    enemyWeaken?: number;
    enemyResBreak?: number;
    enemyEnergyDrain?: number;
  }[];
  actionId: number;
  projectileId: number;
  tickets: number;
  enemyTickets: number;
  recovery: number;
  enemyRecovery: number;
  wipe: number;
}
export interface Event {
  id: number;
  tick: number;
  kind: string;
  actor: string;
  target: string;
  amount: number;
  critical: boolean;
  actionId: number;
  projectileId: number;
}
export interface RecordEntry {
  floor: number;
  ticks: number;
  seconds?:number;
  result: "victory";
  gold: number;
  contributions: ({ id: string } & Contribution)[];
}
export interface Run {
  floor: number;
  xp: number;
  members: Member[];
  items: Record<string, number>;
  souls: Record<string, number>;
  equipment: string[];
  gold: number;
  purchased: Record<string, number>;
  records: RecordEntry[];
}
export interface State extends Run {
  tick: number;
  sequence: number;
  seed: number;
  battle: Battle | null;
  checkpoint: Run | null;
  events: Event[];
  eventId: number;
  journal: { tick: number; command: Command }[];
}
export interface Result {
  ok: boolean;
  message: string;
}
export const saveSchema = z
  .object({
    format: z.literal("tower30-web-command-save"),
    schemaVersion: z.literal(1),
    engineVersion: z.literal("tower30-ts-m3-v2"),
    configHash: memberId,
    seed: z.number().int().min(1).max(0xffffffff),
    tick: z.number().int().min(0).max(MAX_TICKS),
    journal: z
      .array(
        z.object({
          tick: z.number().int().min(0).max(MAX_TICKS),
          command: commandSchema,
        }),
      )
      .max(5000),
  })
  .strict();
