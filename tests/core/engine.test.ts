import { describe, expect, it } from "vitest";
import raw from "../../data/tower/thirty-floor-trial.json";
import { validateConfig } from "../../src/core/config";
import { TowerEngine } from "../../src/core/engine";
import { damage, nextRandom, roundAway, roundEven } from "../../src/core/math";
const config = validateConfig(raw);
function fighting(seed?: number) {
  const e = new TowerEngine(config, seed);
  expect(e.dispatch({ type: "begin" }).ok).toBe(true);
  expect(e.dispatch({ type: "start" }).ok).toBe(true);
  return e;
}
function win(e: TowerEngine) {
  e.advance(6001);
  expect(e.getSnapshot().battle?.result).toBe("victory");
}
describe("配表与可移植数学", () => {
  it("校验全部30层40物种且拒绝损坏引用", () => {
    expect(config.Species).toHaveLength(40);
    expect(config.Encounters.filter((e) => e.Boss)).toHaveLength(3);
    const bad = structuredClone(raw);
    bad.Floors[0]!.Encounter = "missing";
    expect(() => validateConfig(bad)).toThrow();
    const nan = structuredClone(raw);
    nan.Rules.Combatants.hero.Base.Attack = NaN;
    expect(() => validateConfig(nan)).toThrow();
  });
  it("保留C#正负半值舍入与uint随机分母规则", () => {
    expect(roundAway(-2.5)).toBe(-3);
    expect(roundEven(2.5)).toBe(2);
    expect(roundEven(3.5)).toBe(4);
    expect(nextRandom(1)).toBe(270369);
    expect(damage(100, 400, 0, false)).toBe(50);
    expect(damage(100, 400, 400, true)).toBe(150);
  });
});
describe("真实战斗、奖励、重放", () => {
  it("初始预算准确，快照不能修改核心", () => {
    const e = new TowerEngine(config),
      s = e.getSnapshot();
    expect(s.gold).toBe(240);
    expect(s.members.map((m) => m.hp)).toEqual([1800, 1500]);
    expect(s.members[0]!.attributes.Attack).toBe(146);
    s.members[0]!.hp = 1;
    expect(e.getSnapshot().members[0]!.hp).toBe(1800);
  });
  it("批量、逐tick及在途弹道存档恢复一致", () => {
    const a = fighting(1),
      b = fighting(1);
    a.advance(80);
    for (let i = 0; i < 80; i++) b.advance(1);
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    let limit = 400;
    while (a.getSnapshot().battle!.projectiles.length === 0 && limit-- > 0)
      a.advance(1);
    expect(a.getSnapshot().battle!.projectiles.length).toBeGreaterThan(0);
    const restored = TowerEngine.restore(config, a.serialize());
    a.advance(50);
    restored.advance(50);
    expect(restored.getSnapshot()).toEqual(a.getSnapshot());
  });
  it("伤害之前存在真实前摇与飞行，基础出手回能90，治疗不回能", () => {
    const e = fighting();
    let found = false;
    for (let i = 0; i < 300; i++) {
      e.advance(1);
      const s = e.getSnapshot();
      if (s.battle!.projectiles.length) {
        const p = s.battle!.projectiles[0]!,
          actor = s.battle!.units.find((u) => u.id === p.owner)!;
        if (p.kind === "basic") expect(actor.attackEnergy).toBe(90);
        else expect(actor.attackEnergy).toBe(0);
        expect(p.life).toBeGreaterThan(0);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    expect(e.getSnapshot().battle!.units.every((u) => u.energy <= 1000)).toBe(
      true,
    );
  });
  it("胜利后奖励只给一次，收集半血，跨战保留能量，两层正常预算可过", () => {
    const e = fighting();
    win(e);
    const before = e.getSnapshot();
    expect(before.items.xp_potion).toBe(2);
    expect(before.members.find((m) => m.id === "slime_dusk")!.hp).toBe(540);
    e.advance(500);
    expect(e.getSnapshot()).toEqual(before);
    expect(e.dispatch({ type: "finish" }).ok).toBe(true);
    expect(e.dispatch({ type: "finish" }).ok).toBe(false);
    expect(e.getSnapshot().gold).toBe(305);
    const hp = e.getSnapshot().members[0]!.hp;
    expect(e.dispatch({ type: "begin" }).ok).toBe(true);
    e.dispatch({ type: "start" });
    expect(e.getSnapshot().members[0]!.hp).toBe(hp);
    win(e);
    e.dispatch({ type: "finish" });
    expect(e.getSnapshot().floor).toBe(3);
    expect(e.getSnapshot().gold).toBe(370);
    expect(e.dispatch({ type: "begin" }).ok).toBe(true);
  });
  it("撤回重试恢复战前检查点，已确认购买不回退", () => {
    const e = new TowerEngine(config);
    e.dispatch({ type: "buy", id: "herb", quantity: 2 });
    const before = e.getSnapshot();
    e.dispatch({ type: "begin" });
    e.dispatch({ type: "start" });
    e.advance(80);
    e.dispatch({ type: "withdraw" });
    e.dispatch({ type: "retry" });
    const after = e.getSnapshot();
    expect(after.members).toEqual(before.members);
    expect(after.gold).toBe(216);
    expect(after.items.herb).toBe(5);
    expect(after.battle).toBeNull();
  });
  it("非满能量命令失败且不进入记录；篡改命令、版本、时间均拒绝导入", () => {
    const e = fighting();
    expect(e.dispatch({ type: "ultimate", id: "hero" }).ok).toBe(false);
    expect(e.getSnapshot().sequence).toBe(2);
    const save = JSON.parse(e.serialize());
    save.journal.push({
      tick: 0,
      command: { type: "buy", id: "herb", quantity: 100 },
    });
    expect(() => TowerEngine.restore(config, JSON.stringify(save))).toThrow();
    save.configHash = "bad";
    expect(() => TowerEngine.restore(config, JSON.stringify(save))).toThrow();
    const s = JSON.parse(new TowerEngine(config).serialize());
    s.tick = 10;
    expect(() => TowerEngine.restore(config, JSON.stringify(s))).toThrow();
  });
});
describe("经济与养成", () => {
  it("有限库存不刷新、穿戴占用与初始武器限制、恢复付费", () => {
    const e = new TowerEngine(config);
    expect(
      e.dispatch({ type: "buy", id: "gear_linen_armor", quantity: 1 }).ok,
    ).toBe(true);
    expect(
      e.dispatch({ type: "buy", id: "gear_linen_armor", quantity: 1 }).ok,
    ).toBe(false);
    expect(
      e.dispatch({ type: "equip", id: "hero", gear: "linen_armor" }).ok,
    ).toBe(true);
    expect(
      e.dispatch({ type: "sell", id: "linen_armor", quantity: 1 }).ok,
    ).toBe(false);
    expect(
      e.dispatch({ type: "sell", id: "traveler_sword", quantity: 1 }).ok,
    ).toBe(false);
    expect(
      e.dispatch({ type: "equip", id: "princess", gear: "linen_armor" }).ok,
    ).toBe(false);
    expect(TowerEngine.restore(config, e.serialize()).getSnapshot()).toEqual(
      e.getSnapshot(),
    );
  });
  it("药水按小瓶单位消耗，中瓶找零，退还不复制药水，升级不回血", () => {
    const e = fighting();
    win(e);
    e.dispatch({ type: "finish" });
    e.dispatch({ type: "buy", id: "potion_m", quantity: 1 });
    const s = e.getSnapshot(),
      hp = s.members.find((m) => m.id === "slime_dusk")!.hp;
    expect(e.dispatch({ type: "train", id: "slime_dusk" }).ok).toBe(true);
    const trained = e.getSnapshot();
    expect(trained.members.find((m) => m.id === "slime_dusk")!.hp).toBe(hp);
    const spent = trained.members.find((m) => m.id === "slime_dusk")!.training
      .refund;
    expect(e.dispatch({ type: "refund", id: "slime_dusk" }).ok).toBe(true);
    expect(e.dispatch({ type: "refund", id: "slime_dusk" }).ok).toBe(false);
    const total = (s.items.xp_potion ?? 0) + 4 * (s.items.xp_potion_m ?? 0);
    expect(
      e.getSnapshot().members.find((m) => m.id === "slime_dusk")!.training
        .available,
    ).toBe(total);
    expect(spent).toBeGreaterThan(0);
    expect(e.dispatch({ type: "rest" }).ok).toBe(true);
    expect(e.getSnapshot().gold).toBe(s.gold - 35);
  });
});
it("手动大招在真实蓄能后扣1000，记录命令并可重放", () => {
  const e = fighting();
  win(e);
  e.dispatch({ type: "finish" });
  e.dispatch({ type: "begin" });
  e.dispatch({ type: "start" });
  for (let i = 0; i < 600; i++) {
    const s = e.getSnapshot(),
      u = s.battle!.units.find((u) => u.id === "hero")!;
    if (u.energy >= 1000 && u.entry <= 0) {
      const energy = u.energy,
        result = e.dispatch({ type: "ultimate", id: "hero" });
      if (!result.ok) {
        e.advance(1);
        continue;
      }
      const after = e.getSnapshot().battle!.units.find((u) => u.id === "hero")!;
      expect(after.energy).toBe(energy - 1000);
      expect(after.action?.kind).toBe("ultimate");
      expect(after.ultimates).toBe(1);
      const loaded = TowerEngine.restore(config, e.serialize());
      e.advance(20);
      loaded.advance(20);
      expect(loaded.getSnapshot()).toEqual(e.getSnapshot());
      return;
    }
    e.advance(1);
  }
  throw new Error("正常战斗中未能释放大招");
});
it("高压对照战真实失败，无奖励，重试还原战前状态", () => {
  const hard = structuredClone(raw);
  hard.Encounters[0]!.Enemies[0]!.Health = 30;
  hard.Encounters[0]!.Enemies[0]!.AttackScale = 3;
  const e = new TowerEngine(validateConfig(hard));
  const before = e.getSnapshot();
  e.dispatch({ type: "begin" });
  e.dispatch({ type: "start" });
  e.advance(6001);
  expect(e.getSnapshot().battle?.result).toBe("loss");
  expect(e.getSnapshot().items).toEqual(before.items);
  expect(e.getSnapshot().gold).toBe(240);
  expect(e.getSnapshot().records).toHaveLength(0);
  expect(e.dispatch({ type: "retry" }).ok).toBe(true);
  expect(e.getSnapshot().members).toEqual(before.members);
});
it("卸下人类武器后失去自动技能，不会产生空技能崩溃", () => {
  const e = new TowerEngine(config);
  expect(e.dispatch({ type: "unequip", id: "hero", slot: "weapon" }).ok).toBe(
    true,
  );
  expect(e.getSnapshot().members[0]!.profile.Auto).toBe("");
  e.dispatch({ type: "begin" });
  e.dispatch({ type: "start" });
  e.advance(6001);
  expect(e.getSnapshot().battle?.result).toBe("victory");
});
it("补人消耗唯一初始票，8秒回票，未参战伙伴不被误算入场", () => {
  const e = fighting();
  win(e);
  e.dispatch({ type: "finish" });
  e.dispatch({ type: "begin" });
  expect(e.dispatch({ type: "opening", id: "slime_dusk" }).ok).toBe(true);
  e.dispatch({ type: "start" });
  expect(e.getSnapshot().battle!.units.filter((u) => !u.enemy)).toHaveLength(2);
  expect(e.dispatch({ type: "reinforce", id: "slime_dusk" }).ok).toBe(true);
  expect(e.getSnapshot().battle!.tickets).toBe(0);
  expect(
    e.getSnapshot().battle!.units.find((u) => u.id === "slime_dusk")!.entry,
  ).toBe(0.9);
  expect(e.dispatch({ type: "reinforce", id: "slime_dusk" }).ok).toBe(false);
  e.advance(479);
  expect(e.getSnapshot().battle!.tickets).toBe(0);
  e.advance(1);
  expect(e.getSnapshot().battle!.tickets).toBe(1);
});
it("无被动时间回能，移动碰撞不穿透，5名敌首发后按票补人", () => {
  const e = fighting();
  e.advance(40);
  expect(e.getSnapshot().battle!.units.every((u) => u.energy === 0)).toBe(true);
  for (let i = 0; i < 90; i++) {
    e.advance(1);
    const units = e.getSnapshot().battle!.units.filter((u) => u.hp > 0);
    for (let a = 0; a < units.length; a++)
      for (let b = a + 1; b < units.length; b++) {
        const u = units[a]!,
          v = units[b]!;
        expect(Math.hypot(u.x - v.x, u.z - v.z) + 0.001).toBeGreaterThanOrEqual(
          u.radius + v.radius,
        );
      }
  }
  const crowded = structuredClone(raw);
  crowded.Encounters[0]!.Enemies[0]!.Count = 12;
  crowded.Encounters[0]!.Enemies[0]!.Health = 30;
  const trial = new TowerEngine(validateConfig(crowded));
  trial.dispatch({ type: "begin" });
  trial.dispatch({ type: "start" });
  expect(trial.getSnapshot().battle!.units.filter((u) => u.enemy)).toHaveLength(
    5,
  );
  trial.advance(1);
  expect(trial.getSnapshot().battle!.units.filter((u) => u.enemy)).toHaveLength(
    6,
  );
  for (let i = 0; i < 400; i++) {
    trial.advance(1);
    expect(
      trial.getSnapshot().battle!.units.filter((u) => u.enemy && u.hp > 0)
        .length,
    ).toBeLessThanOrEqual(10);
  }
});
it("拒绝原型链名称充当商品ID，失败命令不能破坏金币或库存", () => {
  const e = new TowerEngine(config);
  const before = e.getSnapshot();
  for (const id of ["constructor", "__proto__", "toString"])
    expect(e.dispatch({ type: "sell", id, quantity: 1 }).ok).toBe(false);
  expect(e.getSnapshot()).toEqual(before);
});
