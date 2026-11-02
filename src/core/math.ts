import type { Attributes } from "./config";
export const LOGIC_HZ = 60;
export const STEP = 1 / LOGIC_HZ;
export const LEGACY_STEP = 0.05;
export const MAX_TICKS = 600000;
export function elapsedSeconds(tick:number, legacy20ThroughTick=0) {
  return Math.min(tick,legacy20ThroughTick)*LEGACY_STEP + Math.max(0,tick-legacy20ThroughTick)*STEP;
}
export function roundAway(v: number): number {
  return Math.sign(v) * Math.floor(Math.abs(v) + 0.5);
}
export function roundEven(v: number): number {
  const f = Math.floor(v),
    d = v - f;
  return d === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(v);
}
export function damage(
  raw: number,
  defense: number,
  penetration: number,
  critical: boolean,
  multiplier = 1,
): number {
  return Math.max(
    1,
    roundAway(
      ((raw * 400) / (Math.max(0, defense - penetration) + 400)) *
        (critical ? 1.5 : 1) *
        multiplier,
    ),
  );
}
export function nextRandom(state: number): number {
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}
export function capped(a: Attributes): Attributes {
  return {
    ...a,
    CritRate: Math.min(0.75, a.CritRate),
    Haste: Math.min(1, a.Haste),
    DodgeRate: Math.min(0.4, a.DodgeRate),
    Lifesteal: Math.min(0.6, a.Lifesteal),
    Tenacity: Math.min(0.6, a.Tenacity),
    EnergyRegen: Math.min(1, a.EnergyRegen),
  };
}
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
