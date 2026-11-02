import { it, expect } from "vitest";
import trace from "../fixtures/csharp-first-two-floors.json";
import ultimateTrace from "../fixtures/csharp-ultimates.json";
import raw from "../../data/tower/thirty-floor-trial.json";
import { validateConfig } from "../../src/core/config";
import {LegacyEngine as TowerEngine} from "../helpers/legacy-engine";
it("与只读C#基线：两层正常初始资源、每20tick的移动/生命/能量/动作/随机状态对照", () => {
  const engine = new TowerEngine(validateConfig(raw));
  let floor = 0,
    tick = 0;
  for (const sample of trace) {
    if (floor !== sample.floor) {
      if (floor) expect(engine.dispatch({ type: "finish" }).ok).toBe(true);
      floor = sample.floor;
      tick = 0;
      engine.dispatch({ type: "begin" });
      engine.dispatch({ type: "start" });
    }
    engine.advance(sample.tick - tick);
    tick = sample.tick;
    const b = engine.getSnapshot().battle!;
    expect(b.result, `F${floor} T${tick} result`).toBe(sample.result);
    expect(b.random, `F${floor} T${tick} random`).toBe(sample.random);
    expect(b.projectiles.length).toBe(sample.projectiles);
    for (const v of sample.units) {
      const u = b.units.find((u) => u.id === v.Id)!;
      expect(u, `F${floor} T${tick} ${v.Id}`).toBeDefined();
      const fields = {
        X: u.x,
        Z: u.z,
        Hp: u.hp,
        Energy: u.energy,
        DamageDone: u.damage,
        HealingDone: u.healing,
        AttackEnergy: u.attackEnergy,
        HurtEnergy: u.hurtEnergy,
        KillEnergy: u.killEnergy,
        ActionWork: u.action?.work ?? 0,
        RecoveryWork: u.recovery,
        Cooldown: u.cooldown,
        Special: u.special,
      };
      for (const [key, value] of Object.entries(fields))
        expect(value, `F${floor} T${tick} ${v.Id} ${key}`).toBeCloseTo(
          v[key as keyof typeof fields],
          7,
        );
      expect(u.action?.kind ?? "").toBe(v.ActionKind);
    }
  }
});

it("C#基线：真实蓄能后即时手动施放大招，指令时间与结算对照", () => {
  const engine = new TowerEngine(validateConfig(raw));
  let floor = 0,
    tick = 0,
    cast = 0;
  for (const sample of ultimateTrace) {
    if (floor !== sample.floor) {
      if (floor) expect(engine.dispatch({ type: "finish" }).ok).toBe(true);
      floor = sample.floor;
      tick = 0;
      engine.dispatch({ type: "begin" });
      engine.dispatch({ type: "start" });
    }
    engine.advance(sample.tick - tick);
    tick = sample.tick;
    for (const id of sample.commands) {
      expect(engine.dispatch({ type: "ultimate", id }).ok).toBe(true);
      cast++;
    }
    const b = engine.getSnapshot().battle!;
    expect(b.result, `F${floor} T${tick}`).toBe(sample.result);
    expect(b.random, `F${floor} T${tick} rng`).toBe(sample.random);
    for (const v of sample.units) {
      const u = b.units.find((u) => u.id === v.Id)!;
      expect(u.hp, `F${floor} T${tick} ${v.Id} hp`).toBe(v.Hp);
      expect(u.energy).toBeCloseTo(v.Energy, 7);
      expect(u.damage).toBe(v.DamageDone);
      expect(u.healing).toBe(v.HealingDone);
      expect(u.action?.kind ?? "").toBe(v.ActionKind);
    }
  }
  expect(cast).toBeGreaterThan(0);
});
