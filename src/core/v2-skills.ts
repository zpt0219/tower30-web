import type { ActionRule, Attributes } from "./config";
import { distance, gap } from "./movement";
import type { Battle, Unit } from "./model";

export const V2_SKILL_IDS = new Set([
  // Normal (19 * 2 = 38)
  "rat_combo_bite", "rat_swarm_rush",
  "blood_fang", "night_blood_feast",
  "throat_pounce", "lone_wolf_hunt",
  "bone_cleave", "undead_whirlwind",
  "acid_bolt", "giant_acid_bubble",
  "gaze_ray", "ruin_focus",
  "paralysis_shock", "abyss_thundercloud",
  "emerald_fang", "serpent_miasma",
  "tailwind_flap", "gale_barrier",
  "stinger_combo", "fatal_stinger",
  "twin_peck", "dawn_war_song",
  "spore_spit", "hallucinogen_carpet",
  "vine_lash", "wild_devour",
  "corpse_claw", "undead_detonation",
  "ooze_wrap", "bog_regeneration",
  "pincer_clamp", "iron_shell_charge",
  "root_entangle", "forest_aegis",
  "rock_hammer", "earth_bulwark",
  "aqua_breath", "turtle_fortress",
  // Elite (15 * 3 = 45)
  "shadow_step", "twin_cross_slash", "night_finale",
  "curse_blade", "soul_serpent_bite", "serpent_tempest",
  "shield_shatter", "war_axe_cleave", "warlord_roar",
  "bone_fire_slash", "hellfire_ribcage", "inferno_meteor",
  "spectral_sonic", "soul_bat_swarm", "eternal_bat_storm",
  "nether_wisp", "frost_soul_burst", "abyss_ice_meteor",
  "magma_orbs", "core_eruption", "volcano_cataclysm",
  "drake_venom_orb", "toxic_gale_wing", "emerald_plague_breath",
  "frost_chains", "glacier_shield", "absolute_zero_blizzard",
  "bloodlust_totem", "hex_weakness", "ancestral_frenzy",
  "frog_leap_slash", "water_mirror_counter", "spirit_frog_blitz",
  "gale_roar", "cyclone_ward", "sky_hurricane_wall",
  "thunder_stomp", "lightning_scales", "heavenly_thunder_doom",
  "boulder_ram", "earth_stone_skin", "seismic_avalanche",
  "fluffy_body_slam", "mana_wool_barrier", "bouncy_ball_crash",
  // Legendary (7 * 4 = 28)
  "nightmare_claw", "nether_dragon_breath", "void_wing_slash", "eternal_dragon_descent",
  "sunflame_greatsword", "molten_sacred_shield", "fire_whirlwind", "solar_judgment",
  "bull_earth_charge", "whirlwind_axe_rend", "war_stomp_quake", "heaven_split_axe",
  "obsidian_saber", "abyss_dark_blast", "demon_edict", "doomsday_purgatory",
  "royal_scepter_smite", "pyramid_immortal_shield", "pharaoh_curse_wave", "sun_sandstorm_domain",
  "split_venom_arrows", "arcane_serpent_pack", "gorgon_glare_wave", "petrifying_gaze",
  "wither_doom_orb", "necromancer_decree", "soul_shackles", "undead_calamity",
  // 公主专属王庭技
  "princess_radiant_grace", "princess_sanctuary_edict", "princess_starlight_judgment",
]);

const RANK3_CADENCE_2 = new Set([
  "rat_combo_bite",
  "throat_pounce",
  "emerald_fang",
  "stinger_combo",
]);

const RANK5_CADENCE_2 = new Set([
  "acid_bolt",
  "tailwind_flap",
  "twin_peck",
  "vine_lash",
  "ooze_wrap",
  "aqua_breath",
  "curse_blade",
  "bone_fire_slash",
  "nether_wisp",
  "drake_venom_orb",
  "bloodlust_totem",
  "frog_leap_slash",
  "thunder_stomp",
  "fluffy_body_slam",
]);

export function v2TriggerEvery(u: Unit, skill: string): number {
  if (u.transformTime > 0 && u.transformKind === "nightmare_dragon") return 1;
  const rank = u.rank;
  if (rank >= 3 && RANK3_CADENCE_2.has(skill)) return 2;
  if (rank >= 5 && RANK5_CADENCE_2.has(skill)) return 2;
  if (rank >= 5 && skill === "earth_stone_skin" && u.hp < u.attributes.MaxHp * 0.5) return 2;
  return u.profile.TriggerEvery ?? 3;
}

export function v2IgnoresSilence(u: Unit, skill: string): boolean {
  return skill === "corpse_claw" && u.rank >= 3;
}

export function v2SelectTarget(u: Unit, skill: string, foes: Unit[]): Unit | undefined {
  if (!foes.length) return undefined;
  const visible = foes.filter((v) => v.stealth <= 0);
  const pool = visible.length ? visible : foes;
  if (skill === "rat_swarm_rush" || skill === "demon_edict") {
    return [...pool].sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp)[0];
  }
  if (
    (skill === "lone_wolf_hunt" && u.rank >= 3) ||
    skill === "hex_weakness"
  ) {
    return [...pool].sort(
      (a, b) =>
        Math.max(b.attributes.Attack, b.attributes.Magic) -
        Math.max(a.attributes.Attack, a.attributes.Magic),
    )[0];
  }
  if (
    (skill === "shadow_step" && u.rank >= 3) ||
    (skill === "void_wing_slash" && u.rank >= 3)
  ) {
    return [...pool].sort(
      (a, b) =>
        a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp ||
        Math.abs(b.x) - Math.abs(a.x),
    )[0];
  }
  if (skill === "vine_lash" && u.rank >= 3) {
    return [...pool].sort((a, b) => gap(u, b) - gap(u, a))[0];
  }
  return pool[0];
}

export type StackKind = "poison" | "burn" | "chill" | "mark" | "wither";

export interface StrikeOptions {
  damageType?: "physical" | "magical";
  forceCrit?: boolean;
  ignoreDefRatio?: number;
  bonusCritDmg?: number;
  lifestealOverride?: number;
  trueDamage?: number;
  powerScale?: number;
}

export interface V2Context {
  readonly rank: number;
  readonly unit: Unit;
  readonly target: Unit | undefined;
  readonly kind: "basic" | "auto" | "ultimate";
  readonly skill: string;
  readonly rule: ActionRule;
  readonly stat: number;
  readonly raw: number;
  readonly actionId: number;
  readonly projectileId: number;
  readonly source: Attributes;
  readonly battle: Battle;
  allies(reach?: number): Unit[];
  foes(reach?: number): Unit[];
  strike(v: Unit, dmgRaw?: number, options?: StrikeOptions): { hit: boolean; loss: number; critical: boolean };
  heal(v: Unit, amount: number): void;
  dot(v: Unit, power: number, seconds: number): void;
  addStack(v: Unit, kind: StackKind, count: number, power: number, seconds: number, maxStacks?: number): void;
  clearStacks(v: Unit, kind: string): number;
  detonatePoison(v: Unit, perStackRatio: number, keepHalf?: boolean, ignoreResRatio?: number): number;
  control(v: Unit, seconds: number, mode?: "stun" | "root" | "petrify"): void;
  silence(v: Unit, seconds: number): void;
  taunt(v: Unit, seconds: number): void;
  cleanse(v: Unit): number;
  dispelEnemy(v: Unit): void;
  addBarrier(v: Unit, amount: number): void;
  gainEnergy(v: Unit, amount: number): void;
  drainEnergy(v: Unit, amount: number): number;
  pullOrPush(v: Unit, towards: { x: number; z: number }, dist: number): void;
  blinkNear(v: Unit): void;
  spawnZone(zone: Omit<Battle["zones"][number], "owner" | "enemy" | "tick">): void;
  spawnSummon(
    label: string,
    ratio: number,
    duration: number,
    options?: { explodeRatio?: number; tauntAll?: boolean; kind?: string; radius?: number },
  ): void;
  applyBuff(
    v: Unit,
    kind:
      | "atk"
      | "def"
      | "haste"
      | "crit"
      | "critDmg"
      | "dodge"
      | "lifesteal"
      | "dmgReduction"
      | "thorns"
      | "physGuard"
      | "spellGuard"
      | "controlGuard"
      | "undying"
      | "stealth"
      | "transform",
    duration: number,
    amount: number,
    tag?: string,
  ): void;
  applyDebuff(
    v: Unit,
    kind: "slow" | "weaken" | "armorBreak" | "resBreak" | "vuln" | "healBlock" | "blind" | "disarm" | "energyLock",
    duration: number,
    amount?: number,
  ): void;
  triggerSkillNow(u: Unit, skill: string, target?: Unit): void;
  triggerAllyBasic(ally: Unit, target: Unit): void;
  emit(kind: string, targetId?: string, amount?: number): void;
  roll(chance: number): boolean;
}

type SkillHandler = (ctx: V2Context) => void;

const byRank = <T>(rank: number, values: readonly [T, T, T, T, T]): T =>
  values[Math.min(4, Math.max(0, rank - 1))]!;

const handlers: Record<string, SkillHandler> = {
  // === 1. 灰鼠 gray_rat ===
  rat_combo_bite(c) {
    const t = c.target;
    if (!t) return;
    const hits = c.rank >= 3 ? 3 : 2;
    const perHit = c.raw / hits;
    const steal = byRank(c.rank, [0.1, 0.15, 0.15, 0.2, 0.2]);
    for (let i = 0; i < hits; i++) {
      if (t.hp <= 0) break;
      const isThird = c.rank >= 5 && i === hits - 1;
      c.strike(t, perHit, {
        forceCrit: isThird,
        ignoreDefRatio: isThird ? 0.35 : 0,
      });
    }
    c.applyDebuff(t, "slow", 3, steal);
    c.applyBuff(c.unit, "haste", 3, steal);
  },
  rat_swarm_rush(c) {
    const t = c.target ?? c.foes(8)[0];
    if (!t) return;
    c.blinkNear(t);
    const hits = c.rank >= 5 ? 5 : 3;
    const mult = c.rank >= 3 && t.hp < t.attributes.MaxHp * 0.5 ? 1.4 : 1;
    const perHit = (c.raw * mult) / hits;
    if (c.rank >= 3) c.applyBuff(c.unit, "dodge", c.rank >= 4 ? 4 : 3, 0.35);
    for (let i = 0; i < hits && t.hp > 0; i++) c.strike(t, perHit);
    if (c.rank >= 5 && t.hp === 0) {
      c.gainEnergy(c.unit, 600);
      const next = c.foes(8)[0];
      if (next) c.triggerSkillNow(c.unit, "rat_combo_bite", next);
    }
  },

  // === 2. 灰蝙蝠 gray_bat ===
  blood_fang(c) {
    const t = c.target;
    if (!t) return;
    const wasPoisoned = (t.stacks.poison?.count ?? 0) > 0;
    const leech = byRank(c.rank, [0.3, 0.4, 0.4, 0.5, 0.55]);
    const res = c.strike(t, c.raw, { lifestealOverride: leech });
    const layers = c.rank >= 3 ? 2 : 1;
    c.addStack(t, "poison", layers, Math.max(2, Math.round(c.source.Attack * 0.16)), 5);
    if (c.rank >= 3) c.applyDebuff(t, "healBlock", 4, 0.5);
    if (c.rank >= 5) {
      const healAmt = Math.round(res.loss * leech);
      const overflow = Math.max(0, c.unit.hp + healAmt - c.unit.attributes.MaxHp);
      if (overflow > 0) c.addBarrier(c.unit, Math.min(c.unit.attributes.MaxHp * 0.3, overflow));
      if (wasPoisoned && t.hp > 0) c.strike(t, c.raw * 0.55, { lifestealOverride: leech });
    }
  },
  night_blood_feast(c) {
    const center = c.target ?? c.foes(6)[0];
    if (!center) return;
    const list = c.foes(6).filter((v) => distance(v, center) <= 2.6);
    const leech = c.rank >= 5 ? 0.45 : 0.35;
    let totalHeal = 0;
    for (const v of list) {
      const r = c.strike(v, c.raw, { lifestealOverride: leech });
      totalHeal += Math.round(r.loss * leech * 0.5);
      if (c.rank >= 3) c.applyDebuff(v, "blind", 4, 0.25);
      if (c.rank >= 5) c.detonatePoison(v, 0.45, false);
    }
    if (c.rank >= 3 && totalHeal > 0) {
      for (const a of [...c.allies(8)].sort((x, y) => x.hp / x.attributes.MaxHp - y.hp / y.attributes.MaxHp).slice(0, 2)) {
        c.heal(a, totalHeal);
      }
    }
    if (c.rank >= 5) {
      for (const a of c.allies(10)) c.applyBuff(a, "lifesteal", 6, 0.25);
    }
  },

  // === 3. 灰狼 gray_wolf ===
  throat_pounce(c) {
    const t = c.target;
    if (!t) return;
    const critAdd = byRank(c.rank, [0.2, 0.25, 0.25, 0.35, 0.4]);
    const forceCrit = c.roll(Math.min(1, c.source.CritRate + critAdd));
    const r = c.strike(t, c.raw, { forceCrit });
    if (c.rank >= 3) c.applyDebuff(t, "armorBreak", 4, 0.25);
    if (c.rank >= 5 && (r.critical || forceCrit)) {
      c.gainEnergy(c.unit, 120);
      for (const v of c.foes(2.2).filter((x) => x !== t)) c.strike(v, c.raw * 0.55);
    }
  },
  lone_wolf_hunt(c) {
    const t = c.target ?? c.foes(8)[0];
    if (!t) return;
    if (c.rank >= 3) {
      c.blinkNear(t);
      c.control(t, 1.5, "stun");
      c.applyBuff(c.unit, "haste", 5, 0.35);
    }
    const exec = c.rank >= 5 && t.hp < t.attributes.MaxHp * 0.3;
    c.strike(t, c.raw, { forceCrit: exec, bonusCritDmg: exec ? 1.0 : 0 });
    if (c.rank >= 5 && t.hp === 0) c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.4));
  },

  // === 4. 骷髅怪 skeleton ===
  bone_cleave(c) {
    const t = c.target;
    if (!t) return;
    const shred = byRank(c.rank, [0.15, 0.2, 0.2, 0.28, 0.32]);
    const list = c.rank >= 3 ? c.foes(2.5).slice(0, 3) : [t];
    for (const v of list) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "armorBreak", 4, shred);
    }
    if (c.rank >= 3) c.addBarrier(c.unit, c.unit.attributes.MaxHp * 0.12);
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "atk", 5, Math.min(0.4, list.length * 0.08));
      c.applyBuff(c.unit, "controlGuard", 4, 1);
    }
  },
  undead_whirlwind(c) {
    const list = c.foes(2.8);
    for (const v of list) {
      c.strike(v, c.raw);
      if (c.rank >= 3) {
        c.pullOrPush(v, c.unit, -0.5);
        c.applyDebuff(v, "slow", 3, 0.35);
        c.heal(c.unit, Math.round((c.unit.attributes.MaxHp - c.unit.hp) * 0.1));
      }
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "undying", 4, 1);
      c.applyBuff(c.unit, "haste", 4, 0.5);
      c.applyBuff(c.unit, "lifesteal", 4, 0.3);
    }
  },

  // === 5. 史莱姆 slime ===
  acid_bolt(c) {
    const t = c.target;
    if (!t) return;
    const slow = byRank(c.rank, [0.2, 0.25, 0.25, 0.35, 0.4]);
    const list = c.rank >= 3 ? c.foes(7).filter((v) => distance(v, t) <= 2.1) : [t];
    for (const v of list) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "slow", 3, slow);
      if (c.rank >= 3) {
        c.applyDebuff(v, "armorBreak", 4, 0.2);
        c.applyDebuff(v, "resBreak", 4, 0.2);
      }
    }
    if (c.rank >= 5) {
      c.spawnZone({ x: t.x, z: t.z, remaining: 3, power: Math.round(c.stat * 0.45), radius: 2.0, kind: "acid_pool" });
    }
  },
  giant_acid_bubble(c) {
    const center = c.target ?? c.foes(7)[0];
    if (!center) return;
    const list = c.foes(7).filter((v) => distance(v, center) <= 2.8);
    for (const v of list) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "slow", 4, 0.3);
      if (c.rank >= 3) {
        if (distance(v, center) <= 1.6) c.control(v, 1.5, "root");
        c.applyDebuff(v, "vuln", 5, 0.2);
      }
      if (c.rank >= 5) {
        c.strike(v, c.stat * 1.2);
        c.dispelEnemy(v);
      }
    }
  },

  // === 6. 大眼虫 eyeball ===
  gaze_ray(c) {
    const t = c.target;
    if (!t) return;
    const ignoreMr = byRank(c.rank, [0.15, 0.22, 0.22, 0.3, 0.5]);
    const list = c.rank >= 3 ? c.foes(8).slice(0, 4) : [t];
    for (const v of list) {
      const distBonus = c.rank >= 3 ? 1 + Math.min(0.3, gap(c.unit, v) * 0.05) : 1;
      c.strike(v, c.raw * distBonus, { ignoreDefRatio: ignoreMr });
      if (c.rank >= 5) c.applyDebuff(v, "energyLock", 2, 1);
    }
  },
  ruin_focus(c) {
    const t = c.target ?? c.foes(8)[0];
    if (!t) return;
    const trueDmg = c.rank >= 3 ? Math.min(c.stat * 3, Math.round(t.attributes.MaxHp * 0.12)) : 0;
    c.strike(t, c.raw, { trueDamage: trueDmg });
    if (c.rank >= 3) c.applyDebuff(t, "blind", 2, 0.75);
    if (c.rank >= 5) {
      const next = [...c.foes(10)].filter((v) => v !== t).sort((a, b) => a.hp - b.hp)[0];
      if (next && t.hp === 0) c.strike(next, c.raw * 0.7, { trueDamage: Math.round(trueDmg * 0.7) });
    }
  },

  // === 7. 邪恶水母 jellyfish ===
  paralysis_shock(c) {
    const t = c.target;
    if (!t) return;
    const maxHit = c.rank >= 5 ? 5 : c.rank >= 3 ? 3 : 1;
    const slowAmt = byRank(c.rank, [0.15, 0.2, 0.2, 0.28, 0.32]);
    const targets = [t, ...c.foes(8).filter((v) => v !== t && distance(v, t) <= 4.2)].slice(0, maxHit);
    for (const v of targets) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "slow", 3, slowAmt);
      if (c.rank >= 3 && c.roll(0.35)) c.control(v, 0.8, "stun");
      if (c.rank >= 5) c.drainEnergy(v, 80);
    }
  },
  abyss_thundercloud(c) {
    const center = c.target ?? c.foes(8)[0];
    if (!center) return;
    const list = c.foes(8).filter((v) => distance(v, center) <= 3.0);
    for (const v of list) {
      c.strike(v, c.raw);
      if (c.rank >= 3) {
        c.control(v, 1.5, "stun");
        c.applyDebuff(v, "vuln", 5, 0.2);
      }
    }
    if (c.rank >= 5) {
      c.spawnZone({
        x: center.x,
        z: center.z,
        remaining: 4,
        power: Math.round(c.stat * 1.1),
        radius: 3.0,
        kind: "thundercloud",
        enemyStunTick: 0.4,
      });
    }
  },

  // === 8. 青蛇 green_snake ===
  emerald_fang(c) {
    const t = c.target;
    if (!t) return;
    c.strike(t, c.raw);
    const poisonPow = Math.max(2, Math.round(c.stat * byRank(c.rank, [0.16, 0.22, 0.22, 0.29, 0.35])));
    const layers = c.rank >= 3 ? 2 : 1;
    c.addStack(t, "poison", layers, poisonPow, 6, c.rank >= 5 ? 20 : 8);
    if (c.rank >= 3) c.applyDebuff(t, "resBreak", 4, 0.2);
    if (c.rank >= 5 && (t.stacks.poison?.count ?? 0) >= 5) {
      c.strike(t, c.stat * 1.5);
    }
  },
  serpent_miasma(c) {
    const layers = c.rank >= 2 ? 3 : 2;
    const poisonPow = Math.max(2, Math.round(c.stat * 0.22));
    for (const v of c.foes(7)) {
      c.strike(v, c.raw);
      c.addStack(v, "poison", layers, poisonPow, 6, 20);
      if (c.rank >= 3) {
        c.applyDebuff(v, "slow", 4, 0.35);
        c.applyDebuff(v, "weaken", 4, 0.2);
      }
      if (c.rank >= 5) c.detonatePoison(v, 0.95, true);
    }
  },

  // === 9. 风翅虫 wind_bug ===
  tailwind_flap(c) {
    if (c.target) c.strike(c.target, c.raw);
    const count = c.rank >= 3 ? 3 : 2;
    const haste = byRank(c.rank, [0.15, 0.2, 0.2, 0.28, 0.32]);
    const allies = [...c.allies(10)].sort((a, b) => a.profile.Interval - b.profile.Interval).slice(0, count);
    for (const a of allies) {
      c.applyBuff(a, "haste", 4, haste);
      if (c.rank >= 3) c.gainEnergy(a, c.rank >= 4 ? 100 : 80);
      if (c.rank >= 5) {
        const foe = c.foes(10)[0];
        if (foe) c.strike(foe, c.stat * 0.35);
      }
    }
  },
  gale_barrier(c) {
    const dur = c.rank >= 5 ? 8 : 5;
    const haste = byRank(c.rank, [0.2, 0.28, 0.28, 0.36, 0.45]);
    const dodge = byRank(c.rank, [0.15, 0.2, 0.2, 0.25, 0.3]);
    for (const a of c.allies(12)) {
      if (c.rank >= 3) {
        c.cleanse(a);
        c.gainEnergy(a, c.rank >= 4 ? 220 : 180);
      }
      c.applyBuff(a, "haste", dur, haste);
      c.applyBuff(a, "dodge", dur, dodge);
      if (c.rank >= 5) c.applyBuff(a, "controlGuard", dur, 1);
    }
    if (c.rank >= 3) {
      for (const v of c.foes(3.0)) c.pullOrPush(v, c.unit, 1.0);
    }
  },

  // === 10. 毒蝎 scorpion ===
  stinger_combo(c) {
    const t = c.target;
    if (!t) return;
    if (c.unit.comboTarget !== t.id) {
      c.unit.comboHits = 0;
      c.unit.comboTarget = t.id;
    }
    c.unit.comboHits = Math.min(5, c.unit.comboHits + 1);
    const perStack = byRank(c.rank, [0.1, 0.15, 0.15, 0.22, 0.25]);
    const mult = 1 + (c.unit.comboHits - 1) * perStack;
    const execBonus = c.rank >= 5 && c.unit.comboHits >= 3 ? Math.round((t.attributes.MaxHp - t.hp) * 0.1) : 0;
    c.strike(t, c.raw * mult, {
      forceCrit: c.rank >= 5 && c.unit.comboHits >= 3,
      trueDamage: execBonus,
    });
    c.addStack(t, "poison", 1, Math.max(2, Math.round(c.source.Attack * 0.14)), 5);
    if (c.rank >= 3) c.applyDebuff(t, "armorBreak", 5, Math.min(0.4, c.unit.comboHits * 0.1));
  },
  fatal_stinger(c) {
    const t = c.target ?? c.foes(6)[0];
    if (!t) return;
    const stacks = (t.stacks.poison?.count ?? 0) + (c.unit.comboTarget === t.id ? c.unit.comboHits : 0);
    const mult = c.rank >= 3 ? 1 + stacks * 0.18 : 1;
    c.strike(t, c.raw * mult, { ignoreDefRatio: c.rank >= 5 ? 0.5 : 0 });
    c.addStack(t, "poison", 3, Math.max(3, Math.round(c.source.Attack * 0.18)), 6);
    if (c.rank >= 3) c.control(t, 2.0, "stun");
    if (c.rank >= 5 && t.hp === 0) {
      c.applyBuff(c.unit, "atk", 15, 0.25);
      c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.5));
    }
  },

  // === 11. 双头鸡 twin_rooster ===
  twin_peck(c) {
    const t = c.target;
    if (!t) return;
    const hits = c.rank >= 3 ? 3 : 2;
    for (let i = 0; i < hits && t.hp > 0; i++) c.strike(t, c.raw / hits);
    const atkBoost = byRank(c.rank, [0.1, 0.14, 0.14, 0.18, 0.22]);
    for (const a of c.allies(4.5)) {
      c.applyBuff(a, "atk", 4, atkBoost);
      if (c.rank >= 3) c.applyBuff(a, "crit", 4, 0.15);
    }
    if (c.rank >= 3) {
      const neg = c.allies(5).find((a) => a.slow > 0 || a.weaken > 0 || a.dotTime > 0);
      if (neg) c.cleanse(neg);
    }
    if (c.rank >= 5) {
      const topAlly = [...c.allies(10)].filter((a) => a !== c.unit).sort((a, b) => b.attributes.Attack - a.attributes.Attack)[0];
      if (topAlly && t.hp > 0) c.triggerAllyBasic(topAlly, t);
    }
  },
  dawn_war_song(c) {
    const atk = byRank(c.rank, [0.2, 0.26, 0.26, 0.34, 0.42]);
    const crit = byRank(c.rank, [0.15, 0.2, 0.2, 0.25, 0.3]);
    const critDmg = c.rank >= 5 ? 0.5 : c.rank >= 4 ? 0.35 : c.rank >= 3 ? 0.25 : 0;
    for (const a of c.allies(12)) {
      c.applyBuff(a, "atk", 6, atk);
      c.applyBuff(a, "crit", 6, crit);
      if (critDmg > 0) c.applyBuff(a, "critDmg", 6, critDmg);
      if (c.rank >= 5) c.applyBuff(a, "controlGuard", 6, 1);
    }
    if (c.rank >= 3) {
      for (const v of c.foes(5)) {
        c.applyDebuff(v, "weaken", 4, 0.2);
        if (v.action?.kind !== "ultimate") v.action = null;
      }
    }
  },

  // === 12. 蘑菇怪 mushroom ===
  spore_spit(c) {
    const t = c.target;
    if (!t) return;
    const list = c.rank >= 3 ? c.foes(2.5) : [t];
    for (const v of list) {
      c.strike(v, c.raw);
      if (c.rank >= 3) c.applyDebuff(v, "weaken", 4, 0.2);
    }
    const healPct = byRank(c.rank, [0.08, 0.11, 0.11, 0.14, 0.16]);
    const healAmt = Math.round(c.unit.attributes.MaxHp * healPct);
    c.heal(c.unit, healAmt);
    if (c.rank >= 5) {
      const low = [...c.allies(6)].filter((a) => a !== c.unit).sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp)[0];
      if (low) c.heal(low, healAmt);
    }
  },
  hallucinogen_carpet(c) {
    for (const v of c.foes(3.2)) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "slow", 4, 0.3);
      if (c.rank >= 3) c.control(v, 1.8, "stun");
    }
    if (c.rank >= 3) c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.2));
    if (c.rank >= 5) {
      c.spawnZone({
        x: c.unit.x,
        z: c.unit.z,
        remaining: 5,
        power: 0,
        radius: 3.4,
        kind: "spore_carpet",
        allyHealRatio: 0.06,
        allyGuard: 0.25,
        enemyStunTick: 0.6,
      });
    }
  },

  // === 13. 食人花 man_eating_flower ===
  vine_lash(c) {
    const t = c.target;
    if (!t) return;
    if (c.rank >= 3) {
      c.pullOrPush(t, c.unit, -Math.max(0, gap(c.unit, t) - 0.5));
      c.control(t, 1.2, "root");
      c.applyDebuff(t, "armorBreak", 4, 0.2);
      c.applyDebuff(t, "resBreak", 4, 0.2);
      c.applyBuff(c.unit, "def", 4, 0.2);
    }
    const leech = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    const mult = c.rank >= 5 && (t.stun > 0 || t.root > 0 || t.slow > 0) ? 2 : 1;
    c.strike(t, c.raw * mult, { lifestealOverride: leech });
  },
  wild_devour(c) {
    const t = c.target ?? c.foes(5)[0];
    if (!t) return;
    const list = c.foes(4).filter((v) => distance(v, t) <= 2.2);
    for (const v of list) c.strike(v, c.raw);
    const lostRatio = byRank(c.rank, [0.3, 0.4, 0.4, 0.5, 0.55]);
    c.heal(c.unit, Math.round((c.unit.attributes.MaxHp - c.unit.hp) * lostRatio));
    if (c.rank >= 3) {
      c.control(t, 2.0, "stun");
      c.applyBuff(c.unit, "def", 4, 0.4);
    }
    if (c.rank >= 5 && t.hp === 0) {
      c.unit.attributes.MaxHp = Math.round(c.unit.attributes.MaxHp * 1.3);
      c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.25));
      c.applyBuff(c.unit, "atk", 30, 0.3);
      c.gainEnergy(c.unit, 500);
    }
  },

  // === 14. 僵尸怪 zombie ===
  corpse_claw(c) {
    const t = c.target;
    if (!t) return;
    const bonusHp = c.rank >= 5 ? 0.12 : c.rank >= 3 ? 0.08 : 0;
    const missingScale = c.rank >= 5 ? 1 + Math.floor((1 - c.unit.hp / c.unit.attributes.MaxHp) * 10) * 0.08 : 1;
    c.strike(t, (c.raw + c.unit.attributes.MaxHp * bonusHp) * missingScale);
    c.applyDebuff(t, "healBlock", 4, byRank(c.rank, [0.25, 0.35, 0.35, 0.5, 0.55]));
    if (c.rank >= 5) c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.1));
  },
  undead_detonation(c) {
    for (const v of c.foes(3.2)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) {
        c.taunt(v, 2.0);
        c.applyDebuff(v, "slow", 4, 0.3);
        c.addStack(v, "poison", 1, Math.round(c.unit.attributes.Attack * 0.25), 5);
      }
    }
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]));
  },

  // === 15. 绿泥怪 green_ooze ===
  ooze_wrap(c) {
    const list = c.rank >= 3 ? c.foes(2.8).slice(0, 3) : c.target ? [c.target] : [];
    for (const v of list) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "slow", 3, c.rank >= 3 ? 0.3 : 0.2);
    }
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * byRank(c.rank, [0.12, 0.16, 0.16, 0.22, 0.25]));
    if (c.rank >= 3) c.cleanse(c.unit);
  },
  bog_regeneration(c) {
    const dur = 4;
    const healPct = byRank(c.rank, [0.35, 0.45, 0.45, 0.58, 0.75]);
    const dmgRed = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    c.applyBuff(c.unit, "dmgReduction", dur, dmgRed);
    c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * healPct * 0.45));
    c.unit.regeneration = dur;
    c.unit.regenTick = 1;
    c.unit.regenOwner = c.unit.id;
    if (c.rank >= 3) {
      c.applyBuff(c.unit, "thorns", dur, 0.3);
      for (const v of c.foes(3.5)) c.taunt(v, 2.0);
    }
    if (c.rank >= 5) {
      for (const v of c.foes(3.2)) c.strike(v, c.stat * 1.4);
      c.spawnSummon("green_ooze", 0.4, 8);
      c.spawnSummon("green_ooze", 0.4, 8);
    }
  },

  // === 16. 红蟹 red_crab ===
  pincer_clamp(c) {
    const t = c.target;
    if (!t) return;
    const defBonus = c.rank >= 5 ? c.unit.attributes.Defense * 1.8 : 0;
    c.strike(t, c.raw + defBonus);
    c.applyDebuff(t, "weaken", 4, byRank(c.rank, [0.18, 0.24, 0.24, 0.3, 0.32]));
    c.applyBuff(c.unit, "def", 4, byRank(c.rank, [0.15, 0.2, 0.2, 0.25, 0.3]));
    if (c.rank >= 3) {
      c.control(t, 1.2, "stun");
      c.addBarrier(c.unit, c.unit.attributes.Defense * (c.rank >= 4 ? 3.2 : 2.5));
    }
    if (c.rank >= 5) c.taunt(t, 3);
  },
  iron_shell_charge(c) {
    for (const v of c.foes(3.2)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) {
        c.pullOrPush(v, c.unit, 0.6);
        c.control(v, 1.5, "stun");
      }
    }
    c.applyBuff(c.unit, "def", 6, byRank(c.rank, [0.45, 0.6, 0.6, 0.8, 0.85]));
    if (c.rank >= 3) c.applyBuff(c.unit, "spellGuard", 6, 0.35);
    if (c.rank >= 5) {
      for (const a of c.allies(6).filter((x) => x.profile.Role !== "ranged" && x.profile.Role !== "healer")) {
        c.applyBuff(a, "physGuard", 6, 0.3);
      }
      c.applyBuff(c.unit, "thorns", 6, 0.5);
    }
  },

  // === 17. 树妖 treant ===
  root_entangle(c) {
    const list = c.rank >= 3 ? c.foes(3.2).slice(0, 3) : c.target ? [c.target] : [];
    const rootSec = byRank(c.rank, [1.0, 1.3, 1.3, 1.6, 1.8]);
    for (const v of list) {
      c.strike(v, c.raw);
      c.control(v, rootSec, "root");
      if (c.rank >= 5) {
        const drain = Math.round(v.attributes.MaxHp * 0.04);
        c.strike(v, drain, { trueDamage: drain });
        c.heal(c.unit, drain);
      }
    }
    const healPct = byRank(c.rank, [0.08, 0.11, 0.11, 0.14, 0.16]);
    c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * healPct));
    if (c.rank >= 3) {
      c.addBarrier(c.unit, c.unit.attributes.MaxHp * 0.12);
      const low = [...c.allies(6)].filter((a) => a !== c.unit).sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp)[0];
      if (low) c.addBarrier(low, c.unit.attributes.MaxHp * 0.12);
    }
  },
  forest_aegis(c) {
    const shieldPct = byRank(c.rank, [0.18, 0.24, 0.24, 0.3, 0.38]);
    for (const a of c.allies(12)) {
      c.addBarrier(a, c.unit.attributes.MaxHp * shieldPct);
      a.regeneration = 5;
      a.regenTick = 1;
      a.regenOwner = c.unit.id;
      if (c.rank >= 3) c.applyBuff(a, "def", 5, 0.25);
      if (c.rank >= 5 && a !== c.unit) {
        a.shieldShareTo = c.unit.id;
        a.shieldShareTime = 5;
        a.shieldShareRatio = 0.35;
      }
    }
    if (c.rank >= 3) {
      for (const v of c.foes(3.8)) c.control(v, 1.8, "root");
    }
  },

  // === 18. 土壳守卫 mudguard ===
  rock_hammer(c) {
    for (const v of c.foes(2.8)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) {
        c.control(v, 1.0, "stun");
        c.applyDebuff(v, "slow", 3, 0.25);
      }
    }
    const shield = c.unit.attributes.MaxHp * byRank(c.rank, [0.14, 0.18, 0.18, 0.24, 0.28]);
    c.unit.barrier = Math.min(c.unit.attributes.MaxHp * 1.5, c.unit.barrier + shield);
    if (c.rank >= 3) c.applyBuff(c.unit, "controlGuard", 4, 1);
    if (c.rank >= 5) {
      c.unit.damageCapTime = 6;
      c.unit.damageCapRatio = 0.12;
    }
  },
  earth_bulwark(c) {
    const shieldPct = byRank(c.rank, [0.32, 0.42, 0.42, 0.54, 0.7]);
    const dmgRed = byRank(c.rank, [0.3, 0.38, 0.38, 0.46, 0.55]);
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * shieldPct);
    c.applyBuff(c.unit, "dmgReduction", 5, dmgRed);
    for (const v of c.foes(4)) c.taunt(v, 3);
    if (c.rank >= 3) {
      for (const a of c.allies(12).filter((x) => x.profile.Role === "ranged" || x.profile.Role === "healer")) {
        c.addBarrier(a, c.unit.attributes.MaxHp * 0.2);
      }
      for (const v of c.foes(3.2)) c.pullOrPush(v, c.unit, 0.8);
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "controlGuard", 5, 1);
      for (const v of c.foes(3.0)) {
        c.strike(v, c.unit.barrier * 0.6);
        c.control(v, 1.5, "stun");
      }
    }
  },

  // === 19. 灵龟 spirit_turtle ===
  aqua_breath(c) {
    if (c.target) c.strike(c.target, c.raw);
    const shieldPct = byRank(c.rank, [0.12, 0.16, 0.16, 0.21, 0.25]);
    const low = [...c.allies(10)].sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp)[0];
    for (const a of new Set([c.unit, low].filter(Boolean) as Unit[])) {
      c.addBarrier(a, c.unit.attributes.MaxHp * shieldPct);
      if (c.rank >= 3) c.cleanse(a);
      if (c.rank >= 5) {
        c.applyBuff(a, "dmgReduction", 4, 0.25);
        c.applyBuff(a, "controlGuard", 4, 1);
      }
    }
  },
  turtle_fortress(c) {
    const dur = c.rank >= 5 ? 4 : 5;
    const physRed = byRank(c.rank, [0.5, 0.62, 0.62, 0.75, 0.85]);
    c.applyBuff(c.unit, "physGuard", dur, physRed);
    c.unit.regeneration = dur;
    c.unit.regenTick = 1;
    c.unit.regenOwner = c.unit.id;
    for (const v of c.foes(5)) c.taunt(v, 3);
    if (c.rank >= 3) {
      c.applyBuff(c.unit, "spellGuard", dur, c.rank >= 5 ? 0.85 : c.rank >= 4 ? 0.55 : 0.4);
      for (const a of c.allies(6)) c.applyBuff(a, "dmgReduction", dur, 0.35);
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "dmgReduction", dur, 0.85);
      c.applyBuff(c.unit, "controlGuard", dur, 1);
      c.applyBuff(c.unit, "thorns", dur, 0.5);
    }
  },

  // === ELITE (20-34) ===
  // 20. 暗黑小子 dark_kid
  shadow_step(c) {
    const t = c.target;
    if (!t) return;
    c.blinkNear(t);
    c.strike(t, c.raw);
    c.addStack(t, "mark", 1, Math.round(byRank(c.rank, [0.15, 0.2, 0.2, 0.28, 0.35]) * 100), 4);
    if (c.rank >= 3) c.silence(t, 1.2);
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "stealth", 2.5, 1);
      c.applyBuff(c.unit, "dodge", 2.5, 0.5);
    }
  },
  twin_cross_slash(c) {
    const t = c.target;
    if (!t) return;
    const hits = c.rank >= 3 ? 3 : 2;
    const marked = (t.stacks.mark?.count ?? 0) > 0;
    const mult = marked ? 1.3 : 1;
    for (let i = 0; i < hits && t.hp > 0; i++) {
      const r = c.strike(t, (c.raw * mult) / hits, {
        forceCrit: c.rank >= 5 && marked,
        ignoreDefRatio: c.rank >= 5 && marked ? 0.45 : 0,
      });
      if (c.rank >= 3 && r.critical) c.gainEnergy(c.unit, 80);
    }
  },
  night_finale(c) {
    const t = c.target ?? c.foes(8)[0];
    if (!t) return;
    if (c.rank >= 3) c.applyBuff(c.unit, "stealth", 1.5, 1);
    const mult = c.rank >= 3 && t.hp < t.attributes.MaxHp * 0.4 ? 1.45 : 1;
    for (let i = 0; i < 4 && t.hp > 0; i++) c.strike(t, (c.raw * mult) / 4);
    if (c.rank >= 5 && t.hp === 0 && c.unit.chainUltUsed < 2) {
      c.unit.chainUltUsed++;
      const next = c.foes(10)[0];
      if (next) c.triggerSkillNow(c.unit, "night_finale", next);
    }
  },

  // 21. 蛇妖 snake_demon
  curse_blade(c) {
    const list = c.rank >= 3 ? c.foes(3).slice(0, 3) : c.target ? [c.target] : [];
    const steal = byRank(c.rank, [0.15, 0.2, 0.2, 0.26, 0.3]);
    for (const v of list) {
      c.strike(v, c.raw * 0.5, { damageType: "physical" });
      c.strike(v, (c.unit.attributes.Magic * (c.raw / Math.max(1, c.unit.attributes.Attack))) * 0.5, { damageType: "magical" });
      c.applyDebuff(v, "armorBreak", 4, steal);
      c.applyDebuff(v, "resBreak", 4, steal);
      c.addStack(v, "mark", 1, Math.round(steal * 100), 4, 2);
      c.applyBuff(c.unit, "def", 4, steal);
    }
  },
  soul_serpent_bite(c) {
    const list = c.rank >= 5 ? c.foes(4).slice(0, 2) : c.target ? [c.target] : [];
    const leech = byRank(c.rank, [0.35, 0.45, 0.45, 0.55, 0.6]);
    for (const v of list) {
      const r = c.strike(v, c.raw, { lifestealOverride: leech });
      if (c.rank >= 3 && (v.stacks.mark?.count ?? 0) > 0) c.control(v, 1.2, "petrify");
      if (c.rank >= 5) {
        const overflow = Math.max(0, Math.round(r.loss * leech) - (c.unit.attributes.MaxHp - c.unit.hp));
        if (overflow > 0) c.addBarrier(c.unit, Math.min(c.unit.attributes.MaxHp * 0.35, overflow));
      }
    }
  },
  serpent_tempest(c) {
    const center = c.target ?? c.foes(5)[0];
    if (!center) return;
    for (const v of c.foes(5).filter((x) => distance(x, center) <= 3.5)) {
      c.strike(v, c.raw * 0.5, { damageType: "physical" });
      c.strike(v, c.unit.attributes.Magic * 2.1, { damageType: "magical" });
      if (c.rank >= 3) {
        c.pullOrPush(v, center, -0.8);
        c.control(v, 1.8, "petrify");
        c.applyDebuff(v, "vuln", 4, 0.2);
      }
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "transform", 8, 1, "snake_demon");
      c.applyBuff(c.unit, "haste", 8, 0.4);
    }
  },

  // 22. 剑盾兽人 sword_shield_orc
  shield_shatter(c) {
    const t = c.target;
    if (!t) return;
    c.strike(t, c.raw);
    c.control(t, c.rank >= 3 ? 1.4 : 0.8, "stun");
    c.applyDebuff(t, "armorBreak", 4, byRank(c.rank, [0.2, 0.26, 0.26, 0.34, 0.4]));
    if (c.rank >= 3) c.addBarrier(c.unit, c.unit.attributes.MaxHp * 0.16);
  },
  war_axe_cleave(c) {
    const t = c.target;
    if (!t) return;
    const list = c.rank >= 3 ? c.foes(2.8) : [t];
    const debuffBonus = byRank(c.rank, [0.35, 0.45, 0.45, 0.6, 0.65]);
    for (const v of list) {
      const broken = v.armorBreak > 0 || v.stun > 0;
      const exec = c.rank >= 3 ? Math.round((v.attributes.MaxHp - v.hp) * 0.12) : 0;
      c.strike(v, c.raw * (broken ? 1 + debuffBonus : 1), {
        forceCrit: c.rank >= 5 && v.armorBreak > 0,
        trueDamage: exec,
      });
    }
    if (c.rank >= 5) {
      c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.15));
      c.gainEnergy(c.unit, 100);
    }
  },
  warlord_roar(c) {
    for (const v of c.foes(3.5)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) c.taunt(v, 2.5);
    }
    const atk = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    const def = byRank(c.rank, [0.3, 0.4, 0.4, 0.5, 0.55]);
    for (const a of c.allies(6)) {
      c.applyBuff(a, "atk", 6, atk);
      c.applyBuff(a, "def", 6, def);
      if (c.rank >= 3 && (a.profile.Role === "tank" || a.profile.Role === "melee")) {
        c.addBarrier(a, a.attributes.MaxHp * 0.22);
      }
      if (c.rank >= 5 && (a.profile.Role === "tank" || a.profile.Role === "melee")) {
        c.applyBuff(a, "dmgReduction", 6, 0.35);
        c.applyBuff(a, "lifesteal", 6, 0.25);
        c.applyBuff(a, "controlGuard", 6, 1);
      }
    }
  },

  // 23. 烈焰骷髅 flame_skeleton
  bone_fire_slash(c) {
    const list = c.rank >= 3 ? c.foes(3).slice(0, 3) : c.target ? [c.target] : [];
    const mrShred = byRank(c.rank, [0.15, 0.2, 0.2, 0.28, 0.32]);
    for (const v of list) {
      c.strike(v, c.raw);
      c.addStack(v, "burn", c.rank >= 3 ? 3 : 2, Math.max(2, Math.round(c.stat * 0.18)), 6);
      c.applyDebuff(v, "resBreak", 5, mrShred);
      if (c.rank >= 5) c.applyDebuff(v, "healBlock", 6, 0.6);
    }
  },
  hellfire_ribcage(c) {
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * byRank(c.rank, [0.16, 0.22, 0.22, 0.28, 0.32]));
    for (const v of c.foes(3.0)) {
      c.strike(v, c.raw);
      if (c.rank >= 3 && (v.stacks.burn?.count ?? 0) > 0) {
        const res = c.strike(v, c.stat * 1.3);
        c.heal(c.unit, res.loss);
      }
    }
    if (c.rank >= 5) c.applyBuff(c.unit, "thorns", 4, 0.25);
  },
  inferno_meteor(c) {
    for (const v of c.foes(5.5)) {
      c.strike(v, c.raw);
      c.addStack(v, "burn", 3, Math.max(3, Math.round(c.stat * 0.2)), 6);
      if (c.rank >= 3) {
        c.control(v, 1.5, "stun");
        const stacks = c.clearStacks(v, "burn");
        if (stacks > 0) c.strike(v, c.stat * 0.85 * stacks);
      }
    }
  },

  // 24. 幽魂蝙蝠 phantom_bat
  spectral_sonic(c) {
    const list = c.rank >= 3 ? c.foes(7).slice(0, 3) : c.target ? [c.target] : [];
    const mr = byRank(c.rank, [0.18, 0.24, 0.24, 0.32, 0.36]);
    for (const v of list) {
      c.strike(v, c.raw);
      c.addStack(v, "mark", 1, 1, 5);
      c.applyDebuff(v, "resBreak", 4, mr);
      c.applyDebuff(v, "blind", 4, 0.15);
      if (c.rank >= 3) c.silence(v, 1.0);
    }
  },
  soul_bat_swarm(c) {
    const targets = c.rank >= 5
      ? c.foes(8).filter((v) => (v.stacks.mark?.count ?? 0) > 0).slice(0, 3)
      : c.target ? [c.target] : [];
    const list = targets.length ? targets : c.target ? [c.target] : [];
    const drain = byRank(c.rank, [60, 80, 80, 100, 120]);
    for (const v of list) {
      const marked = (v.stacks.mark?.count ?? 0) > 0;
      c.strike(v, c.raw * (c.rank >= 3 && marked ? 1.35 : 1), { lifestealOverride: 0.35 });
      c.drainEnergy(v, drain);
      c.gainEnergy(c.unit, drain * 0.6);
      if (c.rank >= 3) c.applyDebuff(v, "weaken", 4, 0.15);
    }
  },
  eternal_bat_storm(c) {
    let healed = 0;
    for (const v of c.foes(8)) {
      const r = c.strike(v, c.raw, { lifestealOverride: 0.3 });
      healed += Math.round(r.loss * 0.15);
      if (c.rank >= 3 && (v.stacks.mark?.count ?? 0) > 0) c.control(v, 1.8, "stun");
    }
    if (c.rank >= 3 && healed > 0) {
      for (const a of c.allies(12)) c.heal(a, Math.round(healed / Math.max(1, c.allies(12).length)));
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "transform", 4, 1, "phantom_bat");
      c.applyBuff(c.unit, "physGuard", 4, 0.85);
      c.applyBuff(c.unit, "haste", 4, 0.45);
    }
  },

  // 25. 幽冥火 nether_fire
  nether_wisp(c) {
    const t = c.target;
    if (!t) return;
    const count = c.rank >= 3 ? 4 : 3;
    const list = [t, ...c.foes(7).filter((v) => v !== t)].slice(0, count);
    const slow = byRank(c.rank, [0.2, 0.26, 0.26, 0.35, 0.4]);
    for (let i = 0; i < count; i++) {
      const v = list[i % list.length]!;
      c.strike(v, c.raw / count);
      c.addStack(v, "chill", 1, 0, 4, 4);
      c.applyDebuff(v, "slow", 4, slow);
      if (c.rank >= 3 && (v.stacks.chill?.count ?? 0) >= 2) c.control(v, 1.2, "stun");
      if (c.rank >= 5) c.applyDebuff(v, "resBreak", 4, 0.3);
    }
  },
  frost_soul_burst(c) {
    const t = c.target;
    if (!t) return;
    const chilled = (t.stacks.chill?.count ?? 0) > 0 || t.stun > 0;
    const list = c.rank >= 3 && chilled ? c.foes(7).filter((v) => distance(v, t) <= 2.4) : [t];
    for (const v of list) {
      const td = c.rank >= 5 ? Math.min(c.stat * 2.5, Math.round(v.attributes.MaxHp * 0.1)) : 0;
      c.strike(v, c.raw, {
        forceCrit: c.rank >= 3 && chilled,
        trueDamage: td,
      });
    }
  },
  abyss_ice_meteor(c) {
    const center = c.target ?? c.foes(8)[0];
    if (!center) return;
    for (const v of c.foes(8).filter((x) => distance(x, center) <= 3.6)) {
      c.strike(v, c.raw);
      c.addStack(v, "chill", 2, 0, 5, 4);
      if (c.rank >= 3) {
        if (distance(v, center) <= 2.0) c.control(v, 2.0, "stun");
        c.applyDebuff(v, "vuln", 4, 0.25);
      }
      if (c.rank >= 5 && v.stun > 0 && v.hp < v.attributes.MaxHp * 0.22) {
        c.strike(v, c.raw * 1.5, { trueDamage: v.hp });
      }
    }
  },

  // 26. 熔岩精灵 lava_spirit
  magma_orbs(c) {
    const orbs = c.rank >= 5 ? 3 : c.rank >= 3 ? 2 : 1;
    const foes = c.foes(8);
    const shred = byRank(c.rank, [0.18, 0.24, 0.24, 0.32, 0.36]);
    for (let i = 0; i < orbs && foes.length; i++) {
      const v = foes[i % foes.length]!;
      c.strike(v, c.raw);
      c.addStack(v, "burn", 1, Math.max(2, Math.round(c.stat * 0.16)), 5);
      c.applyDebuff(v, "armorBreak", 4, shred);
      c.applyDebuff(v, "resBreak", 4, shred);
      if (c.rank >= 3) {
        c.spawnZone({ x: v.x, z: v.z, remaining: 3, power: Math.round(c.stat * 0.5), radius: 1.8, kind: "lava_patch" });
      }
      if (c.rank >= 5) c.applyBuff(c.unit, "atk", 8, 0.08);
    }
  },
  core_eruption(c) {
    const center = c.target;
    if (!center) return;
    const list = c.foes(8).filter((v) => distance(v, center) <= 2.4);
    for (const v of list) {
      const burned = (v.stacks.burn?.count ?? 0) > 0;
      c.strike(v, c.raw, { bonusCritDmg: c.rank >= 3 ? 0.4 : 0 });
      if (c.rank >= 3 && burned) c.control(v, 1.2, "stun");
    }
    if (c.rank >= 5) {
      for (const v of c.foes(10).filter((x) => (x.stacks.burn?.count ?? 0) > 0)) {
        c.strike(v, c.stat * 1.6);
      }
    }
  },
  volcano_cataclysm(c) {
    for (const v of c.foes(10)) {
      c.strike(v, c.raw, {
        ignoreDefRatio: c.rank >= 3 ? 0.3 : 0,
        forceCrit: c.rank >= 5,
      });
      if (c.rank >= 3) {
        c.control(v, 1.2, "stun");
        c.addStack(v, "burn", 3, Math.round(c.stat * 0.2), 6);
      }
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "haste", 6, 0.5);
      c.applyBuff(c.unit, "crit", 6, 1.0);
    }
  },

  // 27. 翠毒龙 emerald_venom_drake
  drake_venom_orb(c) {
    const t = c.target;
    if (!t) return;
    const list = c.rank >= 3 ? [t, ...c.foes(8).filter((v) => v !== t)].slice(0, 3) : [t];
    const weaken = byRank(c.rank, [0.15, 0.2, 0.2, 0.26, 0.3]);
    for (const v of list) {
      c.strike(v, c.raw);
      c.addStack(v, "poison", 2, Math.max(2, Math.round(c.stat * 0.2)), 6, 20);
      c.applyDebuff(v, "weaken", 4, weaken);
      if (c.rank >= 3) {
        c.applyDebuff(v, "resBreak", 4, 0.25);
        c.applyDebuff(v, "healBlock", 4, 0.4);
      }
      if (c.rank >= 5) c.applyDebuff(v, "vuln", 5, Math.min(0.3, (v.stacks.poison?.count ?? 1) * 0.06));
    }
  },
  toxic_gale_wing(c) {
    const t = c.target;
    if (!t) return;
    const ticks = c.rank >= 2 ? 2 : 1;
    const list = c.foes(8).filter((v) => distance(v, t) <= 2.8);
    const pCount = t.stacks.poison?.count ?? 0;
    const pPow = t.stacks.poison?.power ?? Math.round(c.stat * 0.2);
    for (const v of list) {
      c.strike(v, c.raw);
      if (c.rank >= 3 && pCount > 0 && v !== t) {
        c.addStack(v, "poison", pCount, pPow, 6, 20);
        if (c.rank >= 5) c.gainEnergy(c.unit, 90);
      }
      if (c.rank >= 5 && (v.stacks.poison?.count ?? 0) > 0) c.control(v, 1.2, "root");
    }
    if ((t.stacks.poison?.count ?? 0) > 0) c.detonatePoison(t, 0.2 * ticks, true);
    if (c.rank >= 3) {
      for (const a of c.allies(8).slice(0, 2)) c.cleanse(a);
    }
  },
  emerald_plague_breath(c) {
    for (const v of c.foes(10)) {
      c.strike(v, c.raw);
      c.addStack(v, "poison", 3, Math.round(c.stat * 0.22), 6, 30);
      if (c.rank >= 3) c.applyDebuff(v, "slow", 5, 0.4);
      if (c.rank >= 5) {
        const before = v.stacks.poison?.count ?? 0;
        c.detonatePoison(v, 1.1, false, 1);
        c.addStack(v, "poison", Math.max(3, before * 2), Math.round(c.stat * 0.22), 6, 30);
      }
    }
  },

  // 28. 冰幽灵 ice_ghost
  frost_chains(c) {
    const list = c.rank >= 3 ? c.foes(8).slice(0, 2) : c.target ? [c.target] : [];
    const slow = byRank(c.rank, [0.3, 0.38, 0.38, 0.42, 0.45]);
    for (const v of list) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "slow", 4, slow);
      if (c.rank >= 3) c.control(v, c.rank >= 4 ? 1.7 : 1.4, "root");
      if (c.rank >= 5) c.applyDebuff(v, "vuln", 4, 0.35);
    }
  },
  glacier_shield(c) {
    const count = c.rank >= 3 ? 2 : 1;
    const pctHp = byRank(c.rank, [0.16, 0.22, 0.22, 0.28, 0.32]);
    const defBoost = byRank(c.rank, [0.2, 0.28, 0.28, 0.36, 0.4]);
    const list = [...c.allies(10)].sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp).slice(0, count);
    for (const a of list) {
      c.addBarrier(a, a.attributes.MaxHp * pctHp);
      c.applyBuff(a, "def", 4, defBoost);
      if (c.rank >= 3) c.cleanse(a);
      if (c.rank >= 5) c.heal(a, Math.round(a.attributes.MaxHp * 0.15));
    }
  },
  absolute_zero_blizzard(c) {
    for (const v of c.foes(12)) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "slow", 5, 0.35);
      if (c.rank >= 3) c.control(v, 1.8, "stun");
    }
    if (c.rank >= 3) {
      const shieldPct = c.rank >= 4 ? 0.24 : 0.18;
      for (const a of c.allies(12)) c.addBarrier(a, a.attributes.MaxHp * shieldPct);
    }
    if (c.rank >= 5) {
      c.spawnZone({
        x: c.unit.x,
        z: c.unit.z,
        remaining: 6,
        power: 0,
        radius: 15,
        kind: "blizzard",
        allyEnergy: 50,
        enemyStunTick: 0.4,
      });
    }
  },

  // 29. 萨满兽人 shaman_orc
  bloodlust_totem(c) {
    const count = c.rank >= 3 ? 3 : 2;
    const atk = byRank(c.rank, [0.2, 0.26, 0.26, 0.34, 0.4]);
    const haste = byRank(c.rank, [0.18, 0.24, 0.24, 0.32, 0.38]);
    const list = [...c.allies(10)].sort((a, b) => Math.max(b.attributes.Attack, b.attributes.Magic) - Math.max(a.attributes.Attack, a.attributes.Magic)).slice(0, count);
    for (const a of list) {
      c.applyBuff(a, "atk", 4, atk);
      c.applyBuff(a, "haste", 4, haste);
      if (c.rank >= 3) {
        c.applyBuff(a, "lifesteal", 4, 0.2);
        c.gainEnergy(a, c.rank >= 4 ? 125 : 100);
      }
      if (c.rank >= 5) {
        const foe = c.foes(10)[0];
        if (foe) c.strike(foe, c.stat * 0.35);
      }
    }
  },
  hex_weakness(c) {
    const list = c.rank >= 5 ? c.foes(8).slice(0, 3) : c.target ? [c.target] : [];
    const shred = byRank(c.rank, [0.2, 0.26, 0.26, 0.32, 0.36]);
    for (const v of list) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "armorBreak", 4, shred);
      c.applyDebuff(v, "resBreak", 4, shred);
      c.applyDebuff(v, "weaken", 4, byRank(c.rank, [0.18, 0.24, 0.24, 0.3, 0.34]));
      if (c.rank >= 3 && v === list[0]) {
        c.control(v, c.rank >= 4 ? 1.8 : 1.5, "stun");
        c.dispelEnemy(v);
      }
      if (c.rank >= 5) c.applyDebuff(v, "vuln", 4, 0.28);
    }
  },
  ancestral_frenzy(c) {
    const dur = c.rank >= 5 ? 8 : 6;
    const boost = byRank(c.rank, [0.25, 0.33, 0.33, 0.42, 0.5]);
    const healPct = byRank(c.rank, [0.18, 0.24, 0.24, 0.3, 0.35]);
    for (const a of c.allies(12)) {
      c.applyBuff(a, "atk", dur, boost);
      c.applyBuff(a, "haste", dur, boost);
      c.heal(a, Math.round(a.attributes.MaxHp * healPct));
      if (c.rank >= 3) c.gainEnergy(a, 220);
      if (c.rank >= 5) {
        c.applyBuff(a, "crit", dur, 0.25);
        c.applyBuff(a, "undying", 2.5, 1);
      }
    }
    if (c.rank >= 3) {
      for (const v of c.foes(12)) {
        c.strike(v, c.stat * 2.2);
        c.control(v, 0.8, "stun");
      }
    }
  },

  // 30. 剑盾蛙 sword_shield_frog
  frog_leap_slash(c) {
    const t = c.target;
    if (!t) return;
    c.blinkNear(t);
    c.strike(t, c.raw);
    c.applyDebuff(t, "slow", 3, c.rank >= 2 ? 0.32 : 0.25);
    c.taunt(t, 2.5);
    if (c.rank >= 3) {
      for (const v of c.foes(2.4)) c.control(v, 1.2, "stun");
      c.applyDebuff(t, "disarm", 1.5, 1);
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "dodge", 3, 0.35);
      c.applyBuff(c.unit, "haste", 3, 0.3);
    }
  },
  water_mirror_counter(c) {
    const shield = c.unit.attributes.MaxHp * byRank(c.rank, [0.16, 0.22, 0.22, 0.28, 0.32]);
    const guard = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    c.addBarrier(c.unit, shield);
    c.applyBuff(c.unit, "dmgReduction", 4, guard);
    if (c.rank >= 3) {
      c.cleanse(c.unit);
      for (const v of c.foes(2.8)) c.strike(v, c.unit.attributes.Attack * 1.5);
    }
    if (c.rank >= 5) c.applyBuff(c.unit, "thorns", 4, 0.4);
  },
  spirit_frog_blitz(c) {
    const hits = c.rank >= 5 ? 5 : 3;
    const foes = c.foes(6);
    const shield = c.unit.attributes.MaxHp * byRank(c.rank, [0.3, 0.4, 0.4, 0.5, 0.6]);
    c.addBarrier(c.unit, shield);
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "dmgReduction", 3, 0.85);
      c.applyBuff(c.unit, "controlGuard", 3, 1);
      c.applyBuff(c.unit, "thorns", 5, 0.6);
    }
    for (let i = 0; i < hits; i++) {
      for (const v of foes) c.strike(v, c.raw / hits);
    }
    if (c.rank >= 3) {
      const center = foes[0];
      for (const v of foes) {
        if (center) c.pullOrPush(v, center, -0.6);
        c.control(v, 1.5, "stun");
      }
      for (const a of c.allies(12)) c.applyBuff(a, "dodge", 4, 0.2);
    }
    if (c.rank >= 5) for (const v of foes) c.taunt(v, 3);
  },

  // 31. 暴风兽 storm_beast
  gale_roar(c) {
    const debuff = c.rank >= 5 ? 0.35 : c.rank >= 2 ? 0.25 : 0.2;
    for (const v of c.foes(3.2)) {
      c.strike(v, c.raw);
      c.pullOrPush(v, c.unit, 0.6);
      c.applyDebuff(v, "slow", 4, debuff);
      c.applyDebuff(v, "weaken", 4, debuff);
      if (c.rank >= 3) {
        c.control(v, 1.2, "stun");
        v.barrier = 0;
      }
    }
  },
  cyclone_ward(c) {
    const shield = c.unit.attributes.MaxHp * byRank(c.rank, [0.18, 0.24, 0.24, 0.3, 0.35]);
    const def = byRank(c.rank, [0.2, 0.28, 0.28, 0.36, 0.42]);
    const list = c.rank >= 3 ? c.allies(5).slice(0, 3) : [c.unit];
    for (const a of list) {
      c.addBarrier(a, shield);
      c.applyBuff(a, "def", 4, def);
      if (c.rank >= 3) c.applyBuff(a, "dmgReduction", 4, 0.25);
    }
    if (c.rank >= 5) {
      c.unit.regeneration = 4;
      c.unit.regenTick = 1;
      c.unit.regenOwner = c.unit.id;
      for (const v of c.foes(2.8)) c.strike(v, c.stat * 1.2);
    }
  },
  sky_hurricane_wall(c) {
    const center = c.target ?? c.foes(5)[0];
    const shield = c.unit.attributes.MaxHp * byRank(c.rank, [0.38, 0.5, 0.5, 0.64, 0.8]);
    c.addBarrier(c.unit, shield);
    for (const v of c.foes(5.5)) {
      c.strike(v, c.raw);
      if (c.rank >= 3 && center) {
        c.pullOrPush(v, center, -0.8);
        c.control(v, 2.0, "stun");
      }
      if (c.rank >= 5) c.applyDebuff(v, "weaken", 6, 0.45);
    }
    if (c.rank >= 3) {
      for (const a of c.allies(12)) {
        c.applyBuff(a, "dmgReduction", 5, 0.3);
        if (c.rank >= 5) c.applyBuff(a, "haste", 6, 0.35);
      }
    }
  },

  // 32. 雷鸣兽 thunder_beast
  thunder_stomp(c) {
    for (const v of c.foes(3.2)) {
      c.strike(v, c.raw);
      c.addStack(v, "mark", 1, Math.round(c.stat * 0.2), 5);
      if (c.rank >= 3) {
        c.control(v, 1.2, "stun");
        c.applyDebuff(v, "resBreak", 4, 0.25);
      }
      if (c.rank >= 5) {
        const stolen = c.drainEnergy(v, 60);
        c.gainEnergy(c.unit, stolen);
      }
    }
  },
  lightning_scales(c) {
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * byRank(c.rank, [0.16, 0.22, 0.22, 0.28, 0.34]));
    c.applyBuff(c.unit, "def", 5, byRank(c.rank, [0.22, 0.3, 0.3, 0.38, 0.44]));
    c.applyBuff(c.unit, "thorns", 5, c.rank >= 3 ? 0.35 : 0.2);
    if (c.rank >= 5) c.applyBuff(c.unit, "controlGuard", 5, 1);
  },
  heavenly_thunder_doom(c) {
    for (const v of c.foes(5)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) c.control(v, 2.0, "stun");
    }
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * byRank(c.rank, [0.35, 0.45, 0.45, 0.58, 0.7]));
    if (c.rank >= 3) c.applyBuff(c.unit, "def", 6, 0.5);
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "transform", 6, 1, "thunder_beast");
      c.unit.attributes.MaxHp = Math.round(c.unit.attributes.MaxHp * 1.4);
      c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.28));
      c.spawnZone({ x: c.unit.x, z: c.unit.z, remaining: 6, power: Math.round(c.stat * 1.3), radius: 12, kind: "thunder_avatar" });
    }
  },

  // 33. 岩土兽 rock_beast
  boulder_ram(c) {
    const defMult = byRank(c.rank, [1.0, 1.4, 1.4, 1.8, 2.0]);
    const list = c.rank >= 3 ? c.foes(3.2) : c.target ? [c.target] : [];
    for (const v of list) {
      c.strike(v, c.raw + c.unit.attributes.Defense * defMult);
      c.pullOrPush(v, c.unit, 0.6);
      c.control(v, c.rank >= 3 ? 1.4 : 1.0, "stun");
      if (c.rank >= 3) c.applyDebuff(v, "armorBreak", 4, 0.3);
      if (c.rank >= 5) c.addBarrier(c.unit, c.unit.attributes.MaxHp * 0.12);
    }
    if (c.rank >= 5) c.applyBuff(c.unit, "controlGuard", 3, 1);
  },
  earth_stone_skin(c) {
    const healPct = byRank(c.rank, [0.12, 0.16, 0.16, 0.2, 0.24]);
    const shieldPct = byRank(c.rank, [0.16, 0.22, 0.22, 0.28, 0.32]);
    const defPct = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * healPct));
    if (c.rank >= 5 && c.unit.hp < c.unit.attributes.MaxHp * 0.5) {
      c.heal(c.unit, Math.round((c.unit.attributes.MaxHp - c.unit.hp) * 0.15));
    }
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * shieldPct);
    c.applyBuff(c.unit, "def", 4, defPct);
    if (c.rank >= 3) {
      c.cleanse(c.unit);
      for (const a of c.allies(3.5).filter((x) => x !== c.unit)) {
        a.shieldShareTo = c.unit.id;
        a.shieldShareTime = 4;
        a.shieldShareRatio = 0.3;
      }
    }
  },
  seismic_avalanche(c) {
    for (const v of c.foes(5.5)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) c.control(v, 2.0, "stun");
    }
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * byRank(c.rank, [0.4, 0.52, 0.52, 0.66, 0.8]));
    if (c.rank >= 3) {
      c.spawnZone({ x: c.unit.x, z: c.unit.z, remaining: 5, power: 0, radius: 5, kind: "fissure", enemySlow: 0.4 });
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "physGuard", 6, 0.75);
      c.applyBuff(c.unit, "spellGuard", 6, 0.45);
      c.applyBuff(c.unit, "controlGuard", 6, 1);
      for (const a of c.allies(12).filter((x) => x !== c.unit)) {
        a.shieldShareTo = c.unit.id;
        a.shieldShareTime = 6;
        a.shieldShareRatio = 0.35;
      }
    }
  },

  // 34. 胖跳兽 fluffy_jumper
  fluffy_body_slam(c) {
    const hpBonus = byRank(c.rank, [0.08, 0.1, 0.1, 0.12, 0.15]);
    const weaken = byRank(c.rank, [0.2, 0.26, 0.26, 0.34, 0.38]);
    for (const v of c.foes(3.2)) {
      c.strike(v, c.raw + c.unit.attributes.MaxHp * hpBonus);
      c.applyDebuff(v, "weaken", 4, weaken);
      if (c.rank >= 3) {
        c.control(v, 1.2, "stun");
        c.silence(v, 2.0);
      }
    }
    if (c.rank >= 5) {
      for (const a of c.allies(12)) c.gainEnergy(a, 80);
    }
  },
  mana_wool_barrier(c) {
    const shield = c.unit.attributes.MaxHp * byRank(c.rank, [0.18, 0.24, 0.24, 0.3, 0.36]);
    const mr = byRank(c.rank, [0.35, 0.48, 0.48, 0.65, 0.75]);
    c.addBarrier(c.unit, shield);
    c.applyBuff(c.unit, "def", 4, mr);
    c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * byRank(c.rank, [0.1, 0.13, 0.13, 0.16, 0.2])));
    if (c.rank >= 3) {
      for (const a of c.allies(12)) c.applyBuff(a, "spellGuard", 4, 0.3);
    }
    if (c.rank >= 5) c.applyBuff(c.unit, "thorns", 4, 0.4);
  },
  bouncy_ball_crash(c) {
    const shield = c.unit.attributes.MaxHp * byRank(c.rank, [0.22, 0.3, 0.3, 0.38, 0.48]);
    for (const v of c.foes(8)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) {
        c.dispelEnemy(v);
        c.silence(v, 2.0);
      }
    }
    for (const a of c.allies(12)) {
      c.addBarrier(a, a.attributes.MaxHp * (shield / Math.max(1, c.unit.attributes.MaxHp)));
      if (c.rank >= 3) c.cleanse(a);
      if (c.rank >= 5) {
        c.applyBuff(a, "spellGuard", 6, 0.6);
        c.applyBuff(a, "controlGuard", 6, 1);
      }
    }
    if (c.rank >= 5) {
      c.unit.regeneration = 6;
      c.unit.regenTick = 1;
      c.unit.regenOwner = c.unit.id;
    }
  },

  // === LEGENDARY (35-41) ===
  // 35. 梦魇魔龙 nightmare_dragon
  nightmare_claw(c) {
    const list = c.rank >= 3 ? c.foes(3.2).slice(0, 4) : c.target ? [c.target] : [];
    const shred = byRank(c.rank, [0.2, 0.26, 0.26, 0.34, 0.4]);
    for (const v of list) {
      const r1 = c.strike(v, c.raw * 0.5, { damageType: "physical", ignoreDefRatio: c.rank >= 5 ? 0.4 : 0 });
      const r2 = c.strike(v, c.unit.attributes.Magic * (c.raw / Math.max(1, c.unit.attributes.Attack)) * 0.5, { damageType: "magical", ignoreDefRatio: c.rank >= 5 ? 0.4 : 0 });
      c.addStack(v, "mark", 1, 1, 5);
      c.applyDebuff(v, "armorBreak", 5, shred);
      c.applyDebuff(v, "resBreak", 5, shred);
      if (c.rank >= 3 && v === list[0]) {
        c.applyDebuff(v, "weaken", 4, 0.15);
        c.applyBuff(c.unit, "atk", 4, 0.15);
      }
      if (c.rank >= 5 && (r1.critical || r2.critical)) c.unit.basicCount++;
    }
  },
  nether_dragon_breath(c) {
    for (const v of c.foes(4.5)) {
      c.strike(v, c.raw);
      c.applyDebuff(v, "slow", 4, 0.25);
      c.applyDebuff(v, "blind", 4, 0.25);
      if (c.rank >= 3 && (v.stacks.mark?.count ?? 0) > 0) {
        c.control(v, 1.5, "stun");
        c.applyDebuff(v, "vuln", 4, 0.25);
      }
      if (c.rank >= 5) {
        const burn = Math.round(v.attributes.MaxHp * 0.04);
        c.addStack(v, "burn", 1, burn, 4);
        c.addBarrier(c.unit, burn * 1.2);
      }
    }
  },
  void_wing_slash(c) {
    const t = c.target ?? c.foes(8)[0];
    if (!t) return;
    c.blinkNear(t);
    const leech = byRank(c.rank, [0.3, 0.4, 0.4, 0.5, 0.55]);
    const forceCrit = c.rank >= 5 && (t.stun > 0 || t.hp < t.attributes.MaxHp * 0.5);
    c.strike(t, c.raw * 0.5, { damageType: "physical", lifestealOverride: leech, forceCrit });
    c.strike(t, c.unit.attributes.Magic * 1.5, { damageType: "magical", lifestealOverride: leech, forceCrit });
    if (c.rank >= 3) {
      if (t.action?.kind !== "ultimate") t.action = null;
      c.gainEnergy(c.unit, 120);
    }
    if (c.rank >= 5 && t.hp > 0) c.triggerSkillNow(c.unit, "nightmare_claw", t);
  },
  eternal_dragon_descent(c) {
    for (const v of c.foes(12)) {
      c.strike(v, c.raw * 0.5, { damageType: "physical" });
      c.strike(v, c.unit.attributes.Magic * (c.raw / Math.max(1, c.unit.attributes.Attack)) * 0.5, { damageType: "magical" });
      if (c.rank >= 3) {
        c.control(v, 2.0, "stun");
        c.strike(v, (c.unit.attributes.Attack + c.unit.attributes.Magic) * 0.9);
      }
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "transform", 8, 1, "nightmare_dragon");
      c.applyBuff(c.unit, "atk", 8, 0.35);
      c.applyBuff(c.unit, "controlGuard", 8, 1);
    }
  },

  // 36. 火焰战士 flame_warrior
  sunflame_greatsword(c) {
    const mrShred = byRank(c.rank, [0.18, 0.24, 0.24, 0.32, 0.36]);
    const list = c.rank >= 3 ? c.foes(6).slice(0, 4) : c.foes(3.0);
    let totalStacks = 0;
    for (const v of list) {
      c.strike(v, c.raw);
      c.addStack(v, "burn", 2, Math.max(3, Math.round(c.stat * 0.18)), 6, 10);
      c.applyDebuff(v, "resBreak", 5, mrShred);
      if (c.rank >= 3) c.applyDebuff(v, "healBlock", 5, 0.5);
      totalStacks += v.stacks.burn?.count ?? 0;
    }
    if (c.rank >= 5 && totalStacks > 0) {
      const boost = Math.min(0.5, totalStacks * 0.05);
      c.applyBuff(c.unit, "atk", 5, boost);
      c.applyBuff(c.unit, "def", 5, boost);
    }
  },
  molten_sacred_shield(c) {
    c.addBarrier(c.unit, c.unit.attributes.MaxHp * byRank(c.rank, [0.22, 0.3, 0.3, 0.38, 0.45]));
    for (const v of c.foes(3.2)) c.strike(v, c.raw);
    if (c.rank >= 3) {
      c.cleanse(c.unit);
      for (const a of c.allies(6).filter((x) => x.profile.Role === "tank" || x.profile.Role === "melee")) {
        c.addBarrier(a, a.attributes.MaxHp * 0.15);
      }
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "controlGuard", 5, 1);
      c.applyBuff(c.unit, "thorns", 5, 0.45);
    }
  },
  fire_whirlwind(c) {
    const foes = c.foes(3.6);
    for (const v of foes) {
      if (c.rank >= 3) c.pullOrPush(v, c.unit, -0.7);
      for (let i = 0; i < 3 && v.hp > 0; i++) c.strike(v, c.raw / 3);
      if (c.rank >= 3) {
        const stacks = v.stacks.burn?.count ?? 0;
        if (stacks > 0) {
          c.strike(v, c.stat * 0.8 * stacks);
          if (c.rank < 5) c.clearStacks(v, "burn");
          if (c.rank >= 5) {
            c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.08));
            c.gainEnergy(c.unit, 80);
          }
        }
      }
    }
    c.heal(c.unit, Math.round((c.unit.attributes.MaxHp - c.unit.hp) * byRank(c.rank, [0.12, 0.16, 0.16, 0.22, 0.25])));
  },
  solar_judgment(c) {
    c.applyBuff(c.unit, "dmgReduction", 6, byRank(c.rank, [0.35, 0.45, 0.45, 0.55, 0.6]));
    for (const v of c.foes(12)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) {
        c.control(v, 1.8, "stun");
        c.applyDebuff(v, "armorBreak", 6, 0.3);
        c.applyDebuff(v, "resBreak", 6, 0.3);
      }
    }
    if (c.rank >= 3) {
      c.spawnZone({ x: c.unit.x, z: c.unit.z, remaining: 6, power: Math.round(c.stat * 0.8), radius: 10, kind: "solar_domain", enemyResBreak: 0.3 });
    }
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "undying", 4, 1);
      for (const a of c.allies(12)) c.applyBuff(a, "atk", 6, 0.3);
    }
  },

  // 37. 牛头人 minotaur
  bull_earth_charge(c) {
    const foes = c.rank >= 3 ? c.foes(4.5) : c.target ? [c.target] : [];
    for (const v of foes) {
      c.strike(v, c.raw);
      c.pullOrPush(v, c.unit, 1.2);
      c.control(v, c.rank >= 3 ? 1.5 : c.rank >= 2 ? 1.4 : 1.2, "stun");
      if (c.rank >= 5) c.applyDebuff(v, "armorBreak", 5, 0.4);
    }
    if (c.rank >= 3) c.addBarrier(c.unit, c.unit.attributes.MaxHp * (c.rank >= 4 ? 0.26 : 0.2));
    if (c.rank >= 5) c.applyBuff(c.unit, "controlGuard", 4, 1);
  },
  whirlwind_axe_rend(c) {
    const leech = byRank(c.rank, [0.3, 0.4, 0.4, 0.5, 0.55]);
    const foes = c.foes(3.2);
    for (const v of foes) {
      const bonus = c.rank >= 3 && (v.stun > 0 || v.slow > 0) ? 1.45 : 1;
      c.strike(v, c.raw * bonus, { lifestealOverride: leech });
      if (c.rank >= 3) c.applyDebuff(v, "slow", 4, 0.3);
    }
    if (c.rank >= 5 && foes.length > 0) {
      c.applyBuff(c.unit, "dmgReduction", 4, Math.min(0.4, foes.length * 0.1));
    }
  },
  war_stomp_quake(c) {
    const range = c.rank >= 3 ? 6.5 : 3.2;
    const stunSec = byRank(c.rank, [1.0, 1.3, 1.3, 1.6, 1.8]);
    for (const v of c.foes(range)) {
      c.strike(v, c.raw);
      c.control(v, stunSec, "stun");
      c.taunt(v, 2);
      if (c.rank >= 3) {
        v.barrier = 0;
        c.applyDebuff(v, "weaken", 4, 0.3);
      }
      if (c.rank >= 5) c.applyDebuff(v, "vuln", 4, 0.5);
    }
    if (c.rank >= 5) c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * 0.15));
  },
  heaven_split_axe(c) {
    const stunSec = byRank(c.rank, [1.8, 2.0, 2.0, 2.2, 2.5]);
    for (const v of c.foes(12)) {
      c.strike(v, c.raw);
      c.control(v, stunSec, "stun");
      if (c.rank >= 3) c.applyDebuff(v, "slow", 6, 0.5);
    }
    if (c.rank >= 3) c.applyBuff(c.unit, "def", 6, 0.6);
    if (c.rank >= 5) {
      c.applyBuff(c.unit, "transform", 6, 1, "minotaur");
      c.applyBuff(c.unit, "controlGuard", 6, 1);
      c.applyBuff(c.unit, "atk", 6, 0.45);
      for (const a of c.allies(12)) {
        c.applyBuff(a, "dmgReduction", 6, 0.3);
        c.applyBuff(a, "lifesteal", 6, 0.3);
      }
    }
  },

  // 38. 末日撒旦 doomsday_satan
  obsidian_saber(c) {
    const list = c.rank >= 3 ? c.foes(4.5) : c.target ? [c.target] : [];
    const shred = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    for (const v of list) {
      const hpBonus = c.rank >= 5 ? v.hp * 0.12 : 0;
      c.strike(v, c.raw + hpBonus, { forceCrit: c.rank >= 5 && v.hp > v.attributes.MaxHp * 0.5 });
      c.applyDebuff(v, "armorBreak", 5, shred);
      c.applyDebuff(v, "weaken", 5, 0.15);
    }
    c.applyBuff(c.unit, "atk", 5, 0.15);
    if (c.rank >= 3) c.addBarrier(c.unit, c.unit.attributes.MaxHp * 0.18);
  },
  abyss_dark_blast(c) {
    const center = c.target ?? c.foes(6)[0];
    if (!center) return;
    let totalHeal = 0;
    for (const v of c.foes(7).filter((x) => distance(x, center) <= (c.rank >= 5 ? 4.5 : 3.0))) {
      const r = c.strike(v, c.raw);
      totalHeal += Math.round(r.loss * 0.35);
      c.addStack(v, "wither", 1, Math.round(c.stat * 0.18), 5);
      c.applyDebuff(v, "resBreak", 5, 0.25);
      if (c.rank >= 3) {
        c.pullOrPush(v, center, -0.7);
        c.control(v, 1.4, "root");
        c.applyDebuff(v, "energyLock", 2, 1);
      }
    }
    if (c.rank >= 5 && totalHeal > 0) {
      const allies = c.allies(12);
      for (const a of allies) c.heal(a, Math.round(totalHeal / Math.max(1, allies.length)));
    }
  },
  demon_edict(c) {
    const amp = byRank(c.rank, [0.2, 0.28, 0.28, 0.35, 0.4]);
    for (const a of c.allies(12)) {
      c.applyBuff(a, "atk", 4, amp);
      if (c.rank >= 3) c.gainEnergy(a, 120);
    }
    for (const v of c.foes(12)) {
      c.strike(v, c.raw * 0.5, { damageType: "physical" });
      c.strike(v, c.unit.attributes.Magic * 0.8, { damageType: "magical" });
      c.applyDebuff(v, "weaken", 4, amp);
      if (c.rank >= 3) c.dispelEnemy(v);
      if (c.rank >= 5 && v.hp > 0 && v.hp < v.attributes.MaxHp * 0.25) {
        c.strike(v, (c.unit.attributes.Attack + c.unit.attributes.Magic) * 1.75, { ignoreDefRatio: 1 });
      }
    }
  },
  doomsday_purgatory(c) {
    for (const v of c.foes(12)) {
      c.strike(v, c.raw * 0.5, { damageType: "physical" });
      c.strike(v, c.unit.attributes.Magic * (c.raw / Math.max(1, c.unit.attributes.Attack)) * 0.5, { damageType: "magical" });
      if (c.rank >= 3) c.control(v, 2.0, "stun");
      if (c.rank >= 5) {
        c.applyDebuff(v, "weaken", 8, 0.25);
        c.applyDebuff(v, "healBlock", 8, 1.0);
      }
    }
    if (c.rank >= 3) {
      c.addBarrier(c.unit, c.unit.attributes.MaxHp * 0.5);
      c.applyBuff(c.unit, "dmgReduction", 6, 0.4);
    }
    if (c.rank >= 5) {
      c.spawnZone({ x: c.unit.x, z: c.unit.z, remaining: 8, power: Math.round(c.stat * 0.7), radius: 14, kind: "purgatory", enemyWeaken: 0.25 });
    }
  },

  // 39. 法老兽 pharaoh_beast
  royal_scepter_smite(c) {
    const blind = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    const trueDmg = c.rank >= 5 ? Math.round((c.unit.attributes.Defense + c.unit.attributes.Resistance) * 1.8) : 0;
    for (const v of c.foes(3.6)) {
      c.strike(v, c.raw, { trueDamage: trueDmg });
      c.taunt(v, 2.5);
      c.applyDebuff(v, "blind", 4, blind);
      if (c.rank >= 3) {
        c.control(v, 1.4, "stun");
        c.applyDebuff(v, "weaken", 4, 0.3);
        c.applyDebuff(v, "slow", 4, 0.3);
      }
      if (c.rank >= 5) {
        const stolen = c.drainEnergy(v, 80);
        c.gainEnergy(c.unit, stolen);
      }
    }
  },
  pyramid_immortal_shield(c) {
    const selfShield = c.unit.attributes.MaxHp * byRank(c.rank, [0.24, 0.32, 0.32, 0.42, 0.5]);
    const allyShield = c.unit.attributes.MaxHp * byRank(c.rank, [0.15, 0.2, 0.2, 0.26, 0.32]);
    const def = byRank(c.rank, [0.3, 0.4, 0.4, 0.55, 0.65]);
    c.addBarrier(c.unit, selfShield);
    c.applyBuff(c.unit, "def", 5, def);
    for (const a of c.rank >= 3 ? c.allies(12) : c.allies(4.5)) {
      if (a !== c.unit) c.addBarrier(a, allyShield);
      if (c.rank >= 3) c.cleanse(a);
      if (c.rank >= 5) {
        c.applyBuff(a, "controlGuard", 5, 1);
        if (a !== c.unit) {
          a.shieldShareTo = c.unit.id;
          a.shieldShareTime = 5;
          a.shieldShareRatio = 0.4;
        }
      }
    }
  },
  pharaoh_curse_wave(c) {
    const healPct = byRank(c.rank, [0.15, 0.2, 0.2, 0.26, 0.3]);
    for (const v of c.foes(4.5)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) {
        c.applyDebuff(v, "healBlock", 4, 0.5);
        c.applyBuff(c.unit, "thorns", 4, 0.35);
      }
    }
    c.heal(c.unit, Math.round(c.unit.attributes.MaxHp * healPct));
  },
  sun_sandstorm_domain(c) {
    const shield = c.unit.attributes.MaxHp * byRank(c.rank, [0.3, 0.4, 0.4, 0.5, 0.5]);
    const def = byRank(c.rank, [0.3, 0.4, 0.4, 0.5, 0.5]);
    for (const v of c.foes(12)) {
      c.strike(v, c.raw);
      if (c.rank >= 3) c.control(v, 2.0, "root");
    }
    for (const a of c.allies(12)) {
      c.addBarrier(a, shield);
      c.applyBuff(a, "def", 6, def);
      if (c.rank >= 5) c.applyBuff(a, "dmgReduction", 6, 0.45);
    }
    if (c.rank >= 3) {
      c.unit.regeneration = 6;
      c.unit.regenTick = 1;
      c.unit.regenOwner = c.unit.id;
    }
  },

  // 40. 美杜莎 medusa
  split_venom_arrows(c) {
    const arrows = c.rank >= 3 ? 5 : 3;
    const foes = c.foes(8);
    const slow = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    for (let i = 0; i < arrows && foes.length; i++) {
      const v = foes[i % foes.length]!;
      const poisoned = (v.stacks.poison?.count ?? 0) > 0 || v.petrify > 0;
      const td = c.rank >= 5 ? Math.round(v.attributes.MaxHp * 0.05) : 0;
      c.strike(v, c.raw, { forceCrit: c.rank >= 5 && poisoned, trueDamage: td });
      c.addStack(v, "poison", 2, Math.round(c.stat * 0.18), 6, 20);
      c.applyDebuff(v, "slow", 4, slow);
      if (c.rank >= 3) c.applyDebuff(v, "resBreak", 4, 0.2);
    }
  },
  arcane_serpent_pack(c) {
    const drain = byRank(c.rank, [70, 95, 95, 120, 140]);
    let stolenSum = 0;
    for (const v of c.foes(8)) {
      c.strike(v, c.raw);
      stolenSum += c.drainEnergy(v, drain);
      if (c.rank >= 3) c.silence(v, 1.5);
      if (c.rank >= 5) c.dispelEnemy(v);
    }
    c.gainEnergy(c.unit, Math.round(stolenSum * 0.5));
    if (c.rank >= 3 && stolenSum > 0) {
      const topAlly = [...c.allies(12)].filter((a) => a !== c.unit).sort((a, b) => b.energy - a.energy)[0];
      if (topAlly) c.gainEnergy(topAlly, Math.round(stolenSum * 0.5));
    }
    if (c.rank >= 5) c.addBarrier(c.unit, c.stat * 3.0);
  },
  gorgon_glare_wave(c) {
    const rootSec = c.rank >= 2 ? 1.6 : 1.2;
    for (const v of c.foes(5.5)) {
      c.strike(v, c.raw);
      c.pullOrPush(v, c.unit, 0.8);
      if (c.rank >= 3) {
        c.control(v, c.rank >= 4 ? 1.8 : 1.5, "petrify");
        if (c.rank >= 5 && (v.stacks.poison?.count ?? 0) > 0) c.detonatePoison(v, 0.3, true);
      } else {
        c.control(v, rootSec, "root");
      }
    }
    if (c.rank >= 3) {
      for (const a of c.allies(12).filter((x) => x.profile.Role === "ranged" || x.profile.Role === "healer")) {
        c.applyBuff(a, "atk", 4, 0.25);
        c.applyBuff(a, "haste", 4, 0.25);
      }
    }
  },
  petrifying_gaze(c) {
    const sec = byRank(c.rank, [2.0, 2.4, 2.4, 2.8, 3.2]);
    for (const v of c.foes(12)) {
      c.strike(v, c.raw);
      c.control(v, sec, "petrify");
      if (c.rank >= 3) {
        c.applyDebuff(v, "armorBreak", sec, 0.5);
        c.applyDebuff(v, "resBreak", sec, 0.5);
        c.applyDebuff(v, "vuln", sec, 0.35);
      }
    }
  },

  // 41. 骷髅法王 skeleton_lich_king
  wither_doom_orb(c) {
    const center = c.target ?? c.foes(8)[0];
    if (!center) return;
    const waves = c.rank >= 3 ? 3 : 1;
    const shred = byRank(c.rank, [0.25, 0.32, 0.32, 0.4, 0.45]);
    const list = c.foes(8).filter((v) => distance(v, center) <= 3.0);
    for (const v of list) {
      const td = c.rank >= 3 ? Math.round(v.hp * 0.1) : 0;
      c.strike(v, c.raw, { trueDamage: td });
      c.applyDebuff(v, "resBreak", 5, shred);
      c.applyDebuff(v, "healBlock", 5, 0.5);
      c.addStack(v, "wither", waves, c.rank >= 5 ? 40 : 0, 5);
      if (c.rank >= 5) c.applyDebuff(v, "vuln", 5, 0.25);
    }
  },
  necromancer_decree(c) {
    const atk = byRank(c.rank, [0.22, 0.3, 0.3, 0.38, 0.42]);
    const leech = byRank(c.rank, [0.15, 0.2, 0.2, 0.25, 0.3]);
    for (const a of c.allies(12)) {
      c.applyBuff(a, "atk", 5, atk);
      c.applyBuff(a, "lifesteal", 5, leech);
      if (c.rank >= 3) c.addBarrier(a, a.attributes.MaxHp * 0.16);
      if (c.rank >= 5) {
        c.applyBuff(a, "crit", 5, 0.3);
        c.gainEnergy(a, 150);
      }
    }
    const low = [...c.allies(12)].sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp)[0];
    if (low) c.heal(low, Math.round(c.stat * 1.2));
    if (c.rank >= 3) {
      const scale = c.rank >= 4 ? 0.55 : 0.45;
      const explode = c.rank >= 5 ? 1.8 : 0;
      c.spawnSummon("skeleton", scale, 6, { explodeRatio: explode, tauntAll: true });
      c.spawnSummon("skeleton", scale, 6, { explodeRatio: explode, tauntAll: true });
    }
  },
  soul_shackles(c) {
    const count = c.rank >= 3 ? 4 : 2;
    const list = c.foes(10).slice(0, count);
    const ids = list.map((v) => v.id);
    const share = c.rank >= 4 ? 0.42 : 0.35;
    let totalHeal = 0;
    for (const v of list) {
      const r = c.strike(v, c.raw);
      totalHeal += r.loss;
      c.applyDebuff(v, "slow", 4, 0.3);
      if (c.rank >= 3) {
        v.shackleIds = ids.filter((id) => id !== v.id);
        v.shackleTime = 4;
        v.shackleRatio = share;
      }
      if (c.rank >= 5) c.control(v, 1.2, "stun");
    }
    if (c.rank >= 5 && totalHeal > 0) {
      for (const a of c.allies(12)) c.heal(a, Math.round(a.attributes.MaxHp * 0.2));
    }
  },
  undead_calamity(c) {
    for (const v of c.foes(14)) {
      c.strike(v, c.raw, { ignoreDefRatio: c.rank >= 5 ? 0.45 : 0 });
      if (c.rank >= 3) {
        c.silence(v, 2.0);
        c.control(v, 2.0, "stun");
        v.barrier = 0;
        c.drainEnergy(v, 150);
      }
      if (c.rank >= 5 && v.hp === 0) {
        for (const a of c.allies(14)) {
          c.applyBuff(a, "atk", 6, 0.25);
          c.heal(a, Math.round(a.attributes.MaxHp * 0.25));
        }
      }
    }
    if (c.rank >= 5) {
      c.spawnSummon("nightmare_dragon", 0.75, 8, { kind: "nightmare_dragon" });
    }
  },

  // 公主专属王庭战技（随等级进阶，综合强度高于全图鉴宠物）
  princess_radiant_grace(c) {
    const healAmt = Math.round(c.stat * byRank(c.rank, [0.4, 0.55, 0.72, 0.95, 1.3]));
    const wardBonus = c.unit.profile.Auto === "wardheal" ? 1.3 : 1;
    const shieldRatio = byRank(c.rank, [0.06, 0.08, 0.11, 0.14, 0.2]) * wardBonus;
    const lowAllies = [...c.allies(14)]
      .sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp)
      .slice(0, 2);
    for (const a of lowAllies) {
      c.cleanse(a);
      c.heal(a, healAmt);
      c.addBarrier(a, a.attributes.MaxHp * shieldRatio);
      if (c.rank >= 5) c.applyBuff(a, "lifesteal", 4, 0.15);
    }
    const foes = c.foes(10).slice(0, 3);
    for (const v of foes) {
      if (c.rank >= 5) c.dispelEnemy(v);
      c.strike(v, c.raw, { powerScale: foes.length === 1 ? 1.35 : 1 });
    }
  },
  princess_sanctuary_edict(c) {
    const atkBuff = byRank(c.rank, [0.1, 0.14, 0.18, 0.22, 0.28]);
    const hasteBuff = byRank(c.rank, [0.06, 0.08, 0.11, 0.14, 0.18]);
    const critBuff = byRank(c.rank, [0.07, 0.1, 0.13, 0.16, 0.2]);
    const energyGain = byRank(c.rank, [25, 36, 48, 60, 80]);
    const isCleanseStaff = c.unit.profile.Auto === "holy_light";
    for (const a of c.allies(14).slice(0, 2)) {
      c.applyBuff(a, "atk", 4.5, atkBuff);
      c.applyBuff(a, "haste", 4.5, hasteBuff);
      c.applyBuff(a, "crit", 4.5, critBuff);
      c.applyBuff(a, "dmgReduction", 4.5, byRank(c.rank, [0.06, 0.08, 0.1, 0.13, 0.18]));
      c.gainEnergy(a, energyGain + (isCleanseStaff ? 20 : 0));
    }
    const stunSec = byRank(c.rank, [0.35, 0.45, 0.55, 0.7, 0.9]) + (isCleanseStaff ? 0.2 : 0);
    const shred = byRank(c.rank, [0.14, 0.18, 0.22, 0.26, 0.34]);
    const foes = c.foes(12).slice(0, 3);
    for (let i = 0; i < foes.length; i++) {
      const v = foes[i]!;
      c.strike(v, c.raw);
      c.applyDebuff(v, "resBreak", 4, shred);
      c.applyDebuff(v, "armorBreak", 4, shred);
      if (i === 0) c.control(v, stunSec, "stun");
      if (i === 0 && isCleanseStaff) c.silence(v, 1.0);
    }
  },
  princess_starlight_judgment(c) {
    if (c.rank >= 5) c.cleanse(c.unit);
    const tdRatio = byRank(c.rank, [0.02, 0.03, 0.04, 0.05, 0.095]);
    const scale = c.unit.profile.Auto === "firebolt" ? 1.2 : 1;
    const foes = c.foes(14).slice(0, 4);
    for (let i = 0; i < foes.length; i++) {
      const v = foes[i]!;
      if (c.rank >= 5 && i === 0) c.dispelEnemy(v);
      const td = Math.round(v.attributes.MaxHp * tdRatio);
      c.strike(v, c.raw, {
        ignoreDefRatio: c.rank >= 4 ? 0.32 : 0.14,
        trueDamage: td,
        powerScale: scale * (i === 0 ? (c.rank >= 5 ? 1.75 : 1.35) : 0.85),
      });
      c.applyDebuff(v, "slow", 3.5, 0.25);
      c.applyDebuff(v, "weaken", 3.5, byRank(c.rank, [0.08, 0.11, 0.14, 0.18, 0.24]));
      if (c.unit.profile.Auto === "firebolt") {
        c.addStack(v, "burn", 2, Math.round(c.stat * 0.18), 4, 10);
      }
    }
    const low = [...c.allies(14)].sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp)[0];
    if (low) c.heal(low, Math.round(c.stat * byRank(c.rank, [0.35, 0.5, 0.7, 0.95, 1.3])));
  },
};

export function executeV2Skill(c: V2Context): boolean {
  const fn = handlers[c.skill];
  if (!fn) return false;
  fn(c);
  // 蛇妖 5阶真蛇妖态：普通技能双重释放
  if (
    c.kind === "auto" &&
    c.unit.transformTime > 0 &&
    c.unit.transformKind === "snake_demon" &&
    c.target &&
    c.target.hp > 0
  ) {
    fn(c);
  }
  return true;
}
