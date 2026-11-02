import { z } from "zod";
import {MAX_TICKS} from "./math";
import type { TowerEngine } from "./engine";

const orderSchema = z.array(z.string().min(1).max(100)).max(10)
  .refine(ids => new Set(ids).size === ids.length, "策略顺序不可重复");
export const strategySchema = z.object({
  ultimates: z.boolean(),
  healing: z.enum(["threshold", "immediate", "disabled"]),
  healingHpPercent: z.number().min(0).max(100),
  interrupt: z.enum(["charging", "immediate", "disabled"]),
  ultimateOrder: orderSchema,
  reinforce: z.boolean(),
  reinforcementOrder: orderSchema,
}).strict();
export type BattleStrategy = z.infer<typeof strategySchema>;
export const defaultStrategy = (): BattleStrategy => ({
  ultimates: true, healing: "threshold", healingHpPercent: 65,
  interrupt: "charging", ultimateOrder: [], reinforce: true, reinforcementOrder: [],
});
export const orderedIds = (preferred: readonly string[], available: readonly string[]) =>
  [...preferred.filter(id => available.includes(id)), ...available.filter(id => !preferred.includes(id))];
const legacyHealingUltimates = new Set(["renew", "forest_rest", "holy_prayer", "forest_sanctuary"]);
const healingCache = new WeakMap<TowerEngine, Set<string>>();
function healingSkills(engine:TowerEngine){
  let skills=healingCache.get(engine);
  if(!skills){skills=new Set(Object.entries(engine.getConfigSnapshot().Rules.Actions).filter(([,action])=>action.DamageType==="heal").map(([id])=>id));healingCache.set(engine,skills);}
  return skills;
}

// Command controller shared by interactive Play and simulation. It never changes combat state directly.
// A partial priority list puts unlisted members afterwards, in their existing stable order.
export function applyStrategy(engine: TowerEngine, strategy: BattleStrategy, legacy = false): number {
  const battle = engine.getBattleSnapshot();
  if (!battle?.started || battle.result) return 0;
  if (strategy.ultimates) {
    const ready = battle.units.filter(u => !u.enemy && u.hp > 0 && u.entry <= 0 && u.energy >= 1000);
    for (const id of orderedIds(strategy.ultimateOrder, ready.map(u => u.id))) {
      const u = ready.find(u => u.id === id)!;
      if ((legacy ? legacyHealingUltimates : healingSkills(engine)).has(u.profile.Ultimate) && (strategy.healing === "disabled" ||
        strategy.healing === "threshold" && !battle.units.some(v => !v.enemy && v.hp > 0 && v.hp < (legacy ? v.attributes.MaxHp * .65 : v.attributes.MaxHp * strategy.healingHpPercent / 100)))) continue;
      if (u.profile.Ultimate === "interrupt" && (strategy.interrupt === "disabled" ||
        strategy.interrupt === "charging" && !battle.units.some(v => v.enemy && v.hp > 0 && v.charge > 0))) continue;
      engine.dispatch({ type: "ultimate", id });
    }
  }
  if (strategy.reinforce && battle.tickets > 0 && battle.units.filter(u => !u.enemy && u.hp > 0).length < 10) {
    const reserves = engine.getSnapshot().members.filter(m => !["hero", "princess"].includes(m.id) && !battle.units.some(u => u.id === m.id));
    for (const id of orderedIds(strategy.reinforcementOrder, reserves.map(m => m.id))) {
      if (engine.dispatch({ type: "reinforce", id }).ok) return 1;
    }
  }
  return 0;
}

// Scheduling only. Replay uses raw advance() plus the saved commands, so decisions never run twice.
export function advancePlaytest(engine: TowerEngine, ticks: number) {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS) throw new Error("tick数量无效");
  const setup = engine.getPlaytestSetup();
  if (!setup?.autoPlay) { engine.advance(ticks); return; }
  const strategy = setup.strategy ?? defaultStrategy();
  for (let i = 0; i < ticks; i++) {
    const battle = engine.getBattleSnapshot();
    if (!battle?.started || battle.result) break;
    applyStrategy(engine, strategy);
    engine.advance(1);
  }
}
