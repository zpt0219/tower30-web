import {
  fingerprint,
  type ActionRule,
  type Attributes,
  type Config,
  type Gear,
} from "./config";
import { clone, damage, nextRandom, roundAway, roundEven, STEP } from "./math";
import {
  commandSchema,
  saveSchema,
  type Battle,
  type Command,
  type Event,
  type Member,
  type Result,
  type Run,
  type State,
  type Unit,
} from "./model";
import { deployment, distance, gap, move, separate } from "./movement";
import { combatantAttributes, enemyAttributes } from "./projections";
import {
  playtestSetupSchema,
  playtestWarnings,
  supportedSkills,
  type PlaytestSetup,
} from "./playtest";
import { z } from "zod";
import { validateConfig } from "./config";
export const PLAYABLE_FLOORS = 2;
export const SUPPORTED_SKILLS = supportedSkills;
export const isHuman = (id: string) => id === "hero" || id === "princess";
export const itemNames: Record<string, string> = {
  herb: "草药",
  revive: "复活羽",
  shell: "硬壳",
  xp_potion: "小经验药水",
  xp_potion_m: "中经验药水",
  xp_potion_l: "大经验药水",
};
const contribution = () => ({
  damage: 0,
  healing: 0,
  absorbed: 0,
  attackEnergy: 0,
  hurtEnergy: 0,
  killEnergy: 0,
  ultimates: 0,
  criticals: 0,
  dodges: 0,
  interrupts: 0,
  staggers: 0,
});
export class TowerEngine {
  private state: State;
  private playtest: PlaytestSetup | null = null;
  readonly configHash: string;
  private readonly config: Config;
  constructor(config: Config, seed = 2463534242) {
    this.config = clone(config);
    if (!Number.isInteger(seed) || seed <= 0 || seed > 0xffffffff)
      throw new Error("种子必须为非零 uint32");
    this.configHash = fingerprint(config);
    const members: Member[] = [
      {
        id: "hero",
        hp: 0,
        energy: 0,
        rank: 1,
        potionXp: 0,
        equipment: { weapon: "traveler_sword" },
      },
      {
        id: "princess",
        hp: 0,
        energy: 0,
        rank: 1,
        potionXp: 0,
        equipment: { weapon: "healer_staff" },
      },
    ];
    this.state = {
      floor: 1,
      xp: 0,
      members,
      items: { herb: 3, revive: 1 },
      souls: {},
      equipment: [...config.StartingEquipment],
      gold: config.Economy.StartingGold,
      purchased: {},
      records: [],
      tick: 0,
      sequence: 0,
      seed,
      battle: null,
      checkpoint: null,
      events: [],
      eventId: 0,
      journal: [],
    };
    for (const m of members) m.hp = this.attributes(m).MaxHp;
  }
  getSnapshot() {
    return clone({
      ...this.state,
      configHash: this.configHash,
      arenaBackground: this.current()?.Background ?? "forest",
      mode: this.playtest ? ("playtest" as const) : ("run" as const),
      playtest: this.playtest,
      skippedFeatures:
        this.playtest?.skillPolicy === "supported-only"
          ? playtestWarnings(this.config, this.playtest)
          : [],
      members: this.state.members.map((m) => ({
        ...m,
        attributes: this.attributes(m),
        level: this.level(m),
        profile: this.profile(m),
        training: this.training(m),
        restRecovery: this.attributes(m).MaxHp - m.hp,
        itemRecovery: {
          herb:
            m.hp > 0
              ? Math.min(
                  this.attributes(m).MaxHp - m.hp,
                  300 + 30 * (this.humanLevel() - 1),
                )
              : 0,
          revive:
            m.hp === 0
              ? Math.max(10, Math.trunc(this.attributes(m).MaxHp / 4))
              : 0,
        },
      })),
      innPrice: this.innPrice(),
      shopStage: this.shopStage(),
      playableFloors: PLAYABLE_FLOORS,
    });
  }
  takeEvents(): readonly Event[] {
    return clone(this.state.events);
  }
  private emit(
    kind: string,
    actor = "",
    target = "",
    amount = 0,
    critical = false,
    actionId = 0,
    projectileId = 0,
  ) {
    this.state.events.push({
      id: ++this.state.eventId,
      tick: this.state.tick,
      kind,
      actor,
      target,
      amount,
      critical,
      actionId,
      projectileId,
    });
    this.state.events = this.state.events.slice(-64);
  }
  private member(id: string) {
    return this.state.members.find((m) => m.id === id);
  }
  humanLevel() {
    return (
      1 + this.config.HumanXpThresholds.filter((x) => this.state.xp >= x).length
    );
  }
  level(m: Member) {
    if (isHuman(m.id)) return this.humanLevel();
    let xp = m.potionXp,
      level = 1;
    for (const cost of this.config.Rules.Species[m.id]!.LevelCosts) {
      if (xp < cost) break;
      xp -= cost;
      level++;
    }
    return level;
  }
  attributes(m: Member) {
    return combatantAttributes(
      this.config,
      m.id,
      this.level(m),
      Object.values(m.equipment),
    );
  }

  private profile(m: Member) {
    const p = { ...this.config.Rules.Profiles[m.id]! },
      w = this.config.Rules.Equipment.find((g) => g.Id === m.equipment.weapon);
    if (!w && isHuman(m.id)) p.Auto = "";
    if (w) {
      if (w.Auto) p.Auto = w.Auto;
      if (w.Ultimate) p.Ultimate = w.Ultimate;
      if (w.Role) p.Role = w.Role as typeof p.Role;
    }
    return p;
  }
  private training(m: Member) {
    const level = this.level(m),
      costs = this.config.Rules.Species[m.id]?.LevelCosts ?? [],
      basis = costs.slice(0, level - 1).reduce((s, v) => s + v, 0),
      need = level < 30 ? (costs[level - 1] ?? 0) - (m.potionXp - basis) : 0;
    return {
      xp: m.potionXp - basis,
      next: costs[level - 1] ?? 0,
      units: Math.ceil(need / 25),
      targetLevel: isHuman(m.id)
        ? level
        : this.level({
            ...m,
            potionXp:
              m.potionXp +
              Math.min(
                Math.ceil(need / 25) * 25,
                costs.reduce((s, v) => s + v, 0) - m.potionXp,
              ),
          }),
      available:
        (this.state.items.xp_potion ?? 0) +
        (this.state.items.xp_potion_m ?? 0) * 4 +
        (this.state.items.xp_potion_l ?? 0) * 20,
      rankCost: this.config.Rules.RankCosts[m.rank - 1] ?? 0,
      refund: Math.ceil(m.potionXp / 25),
    };
  }
  shopStage() {
    return this.config.Floors.slice(0, this.state.floor - 1).filter(
      (f) => this.config.Encounters.find((e) => e.Id === f.Encounter)!.Boss,
    ).length;
  }
  innPrice() {
    return (
      this.config.Economy.InnBase +
      this.shopStage() * this.config.Economy.InnStep
    );
  }
  gearSupported(g: Gear) {
    return (
      (!g.Auto || SUPPORTED_SKILLS.has(g.Auto)) &&
      (!g.Ultimate || SUPPORTED_SKILLS.has(g.Ultimate)) &&
      g.Effect === ""
    );
  }
  quoteBuy(id: string, quantity: number) {
    const o = this.config.Economy.Offers.find((o) => o.Id === id);
    if (!o || !Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      return null;
    return {
      total: o.Price * quantity,
      balance: this.state.gold - o.Price * quantity,
      stock: o.Stock < 0 ? -1 : o.Stock - (this.state.purchased[id] ?? 0),
      amount: o.Amount * quantity,
    };
  }
  previewEquip(id: string, gearId: string) {
    const m = this.member(id),
      g = this.config.Rules.Equipment.find((g) => g.Id === gearId);
    if (!m || !g) return null;
    const preview = clone(m);
    preview.equipment[g.Slot] = g.Id;
    return { before: this.attributes(m), after: this.attributes(preview) };
  }
  private run(): Run {
    const s = this.state;
    return clone({
      floor: s.floor,
      xp: s.xp,
      members: s.members,
      items: s.items,
      souls: s.souls,
      equipment: s.equipment,
      gold: s.gold,
      purchased: s.purchased,
      records: s.records,
    });
  }
  private current() {
    return this.config.Encounters.find(
      (e) => e.Id === this.config.Floors[this.state.floor - 1]?.Encounter,
    )!;
  }
  dispatch(input: Command): Result {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "命令格式无效" };
    if (this.state.journal.length >= 5000 || this.state.tick >= 200000)
      return { ok: false, message: "本试跑记录已满，请导出存档并开始新试跑" };
    const c = parsed.data,
      err = this.execute(c);
    if (err) return { ok: false, message: err };
    this.state.sequence++;
    this.state.journal.push({ tick: this.state.tick, command: clone(c) });
    this.emit("command", c.type);
    return { ok: true, message: "操作完成" };
  }
  private execute(c: Command): string {
    const s = this.state,
      b = s.battle,
      m = "id" in c ? this.member(c.id) : undefined;
    switch (c.type) {
      case "begin": {
        if (b) return "当前已有战斗";
        if (!this.playtest && s.floor > PLAYABLE_FLOORS)
          return "后续楼层技能尚在迁移，本版开放前两层";
        if (!s.members.some((m) => m.hp > 0))
          return "无人能够出战，请先在旅馆恢复";
        const enemies: Battle["enemies"] = [];
        for (const group of this.current().Enemies)
          for (let i = 0; i < group.Count; i++) {
            const a = enemyAttributes(this.config, group);
            const p =
              group.ProfileOverride ??
              this.config.Rules.Profiles[group.Species]!;
            if (
              this.playtest?.skillPolicy !== "supported-only" &&
              ((!!p.Auto && !SUPPORTED_SKILLS.has(p.Auto)) ||
                !SUPPORTED_SKILLS.has(p.Ultimate))
            )
              return "该楼层技能尚未迁移";
            enemies.push({
              id: `${this.current().Id}-${String(enemies.length + 1).padStart(2, "0")}`,
              kind: group.Species,
              hp: a.MaxHp,
              attributes: a,
              profile: clone(p),
              rank: group.Rank,
            });
          }
        s.checkpoint = this.run();
        s.battle = {
          started: false,
          result: "",
          tick: 0,
          random: s.seed,
          opening: s.members
            .filter((m) => m.hp > 0)
            .slice(0, 5)
            .map((m) => m.id),
          units: [],
          enemies,
          projectiles: [],
          actionId: 0,
          projectileId: 0,
          tickets: 1,
          enemyTickets: 1,
          recovery: 0,
          enemyRecovery: 0,
          wipe: 0,
        };
        this.emit("prepare");
        return "";
      }
      case "opening":
        if (!b || b.started || !m || m.hp <= 0 || isHuman(c.id))
          return "当前不能更改该首发";
        if (b.opening.includes(c.id)) {
          b.opening = b.opening.filter((id) => id !== c.id);
          return "";
        }
        if (b.opening.length >= 5) return "首发最多5人";
        b.opening.push(c.id);
        return "";
      case "start": {
        if (!b || b.started || !b.opening.length) return "请先准备首发队伍";
        const before = clone(b),
          events = clone(s.events),
          eventId = s.eventId;
        const opening = [
          ...b.opening.map((id) => ({ id, enemy: false })),
          ...b.enemies.slice(0, 5).map((e) => ({ id: e.id, enemy: true })),
        ];
        for (const unit of opening)
          if (!this.spawn(unit.id, unit.enemy, true)) {
            s.battle = before;
            s.events = events;
            s.eventId = eventId;
            return "入场位置不足，请减小碰撞半径或调整首发人数";
          }
        b.started = true;
        this.emit("start");
        return "";
      }
      case "ultimate": {
        const u = b?.units.find((u) => u.id === c.id && !u.enemy);
        if (
          !b ||
          !b.started ||
          b.result ||
          !u ||
          u.hp <= 0 ||
          u.entry > 0 ||
          u.stun > 0 ||
          u.hitStun > 0
        )
          return "该伙伴当前不能释放大招";
        if (!SUPPORTED_SKILLS.has(u.profile.Ultimate))
          return "该大招尚未迁移，当前测试不执行";
        if (u.energy < 1000) return "能量尚未蓄满1000";
        if (u.action?.kind === "ultimate") return "已经在释放大招";
        if (!this.available(u, u.profile.Ultimate)) return "当前没有合适目标";
        this.cancel(u);
        this.startAction(u, "ultimate", u.profile.Ultimate, this.target(u));
        return "";
      }
      case "reinforce":
        if (
          !b?.started ||
          b.result ||
          !m ||
          m.hp <= 0 ||
          isHuman(c.id) ||
          b.units.some((u) => u.id === c.id)
        )
          return "该伙伴不能增援";
        if (b.tickets <= 0) return "补人票不足";
        if (b.units.filter((u) => !u.enemy && u.hp > 0).length >= 10)
          return "场上已满10人";
        if (!this.spawn(c.id, false, false)) return "入场区域被占用";
        b.tickets--;
        return "";
      case "withdraw":
        if (!b?.started || b.result) return "当前不能撤回";
        b.result = "flee";
        this.emit("flee");
        return "";
      case "retry":
        if (!b || b.result === "victory" || !s.checkpoint)
          return "当前不能重试";
        Object.assign(s, clone(s.checkpoint));
        s.battle = null;
        s.checkpoint = null;
        this.emit("retry");
        return "";
      case "finish":
        if (this.playtest) return "独立测试不结算正式奖励，请返回工作台";
        if (!b || b.result !== "victory") return "尚未赢得本层";
        s.gold += this.current().Gold;
        s.equipment.push(...this.config.Floors[s.floor - 1]!.Equipment);
        s.records.push({
          floor: s.floor,
          ticks: b.tick,
          result: "victory",
          gold: this.current().Gold,
          contributions: b.units
            .filter((u) => !u.enemy)
            .map((u) => ({
              id: u.id,
              damage: u.damage,
              healing: u.healing,
              absorbed: u.absorbed,
            })),
        });
        s.floor++;
        s.battle = null;
        s.checkpoint = null;
        this.emit("finish");
        return "";
    }
    if (this.playtest)
      return "独立测试不进行经济交易，请返回工作台修改测试设置";
    if (b) return "返回整备后才能操作";
    switch (c.type) {
      case "buy": {
        const o = this.config.Economy.Offers.find((o) => o.Id === c.id);
        if (!o || o.Stage > this.shopStage()) return "商品尚未开放";
        if (o.Stock >= 0 && (s.purchased[o.Id] ?? 0) + c.quantity > o.Stock)
          return "库存不足";
        const g = this.config.Rules.Equipment.find((g) => g.Id === o.Item);
        if (g && !this.gearSupported(g)) return "该装备技能尚在迁移";
        if (g && (c.quantity !== 1 || s.equipment.includes(o.Item)))
          return "已拥有该装备";
        const cost = o.Price * c.quantity;
        if (s.gold < cost) return "金币不足";
        s.gold -= cost;
        s.purchased[o.Id] = (s.purchased[o.Id] ?? 0) + c.quantity;
        if (g) s.equipment.push(o.Item);
        else s.items[o.Item] = (s.items[o.Item] ?? 0) + o.Amount * c.quantity;
        this.emit("buy", o.Item, "", -cost);
        return "";
      }
      case "sell": {
        const prices = this.config.Economy.SellPrices;
        const price = Object.hasOwn(prices, c.id) ? prices[c.id] : undefined;
        if (!price || this.config.StartingEquipment.includes(c.id))
          return "此物品不可出售";
        if (s.equipment.includes(c.id)) {
          if (
            c.quantity !== 1 ||
            s.members.some((m) => Object.values(m.equipment).includes(c.id))
          )
            return "请先卸下装备";
          s.equipment = s.equipment.filter((id) => id !== c.id);
        } else {
          if ((s.items[c.id] ?? 0) < c.quantity) return "物品数量不足";
          s.items[c.id]! -= c.quantity;
        }
        s.gold += price * c.quantity;
        this.emit("sell", c.id, "", price * c.quantity);
        return "";
      }
      case "rest":
        if (!s.members.some((m) => m.hp < this.attributes(m).MaxHp))
          return "全队生命已满，无需住宿";
        if (s.gold < this.innPrice()) return "金币不足";
        s.gold -= this.innPrice();
        for (const m of s.members) {
          if (m.hp === 0) m.energy = 0;
          m.hp = this.attributes(m).MaxHp;
        }
        this.emit("rest");
        return "";
      case "item":
        if (!m || (s.items[c.item] ?? 0) <= 0) return "道具或伙伴不存在";
        if (c.item === "herb") {
          if (m.hp <= 0 || m.hp >= this.attributes(m).MaxHp)
            return "目标无需草药";
          m.hp = Math.min(
            this.attributes(m).MaxHp,
            m.hp + 300 + 30 * (this.humanLevel() - 1),
          );
        } else {
          if (m.hp > 0) return "只能复活倒下的伙伴";
          m.hp = Math.max(10, Math.trunc(this.attributes(m).MaxHp / 4));
          m.energy = 0;
        }
        s.items[c.item]!--;
        this.emit("item", c.item, m.id);
        return "";
      case "equip": {
        const g = this.config.Rules.Equipment.find((g) => g.Id === c.gear);
        if (!m || !isHuman(m.id) || !g || !s.equipment.includes(g.Id))
          return "装备或角色无效";
        if (!["", "all", "human", m.id].includes(g.Wearer))
          return "该装备为另一角色专用";
        if (!this.gearSupported(g)) return "该装备技能尚未迁移";
        if (
          s.members.some(
            (v) => v !== m && Object.values(v.equipment).includes(g.Id),
          )
        )
          return "装备已被其他角色占用";
        m.equipment[g.Slot] = g.Id;
        m.hp = Math.min(m.hp, this.attributes(m).MaxHp);
        this.emit("equip", m.id, g.Id);
        return "";
      }
      case "unequip":
        if (!m || !isHuman(m.id) || !m.equipment[c.slot])
          return "没有可卸下的装备";
        delete m.equipment[c.slot];
        m.hp = Math.min(m.hp, this.attributes(m).MaxHp);
        return "";
      case "train":
        if (!m || isHuman(m.id) || this.level(m) >= 30)
          return "该伙伴不能使用经验药水";
        {
          const t = this.training(m);
          if (t.available < t.units) return "经验药水不足";
          this.consumePotions(t.units);
          const cap = this.config.Rules.Species[m.id]!.LevelCosts.reduce(
            (s, v) => s + v,
            0,
          );
          m.potionXp += Math.min(t.units * 25, cap - m.potionXp);
          this.emit("train", m.id, "", t.units);
          return "";
        }
      case "refund":
        if (!m || isHuman(m.id) || m.potionXp <= 0) return "没有可退还药水";
        s.items.xp_potion =
          (s.items.xp_potion ?? 0) + Math.ceil(m.potionXp / 25);
        m.potionXp = 0;
        m.hp = Math.min(m.hp, this.attributes(m).MaxHp);
        return "";
      case "rank":
        if (!m || isHuman(m.id) || m.rank >= 5) return "不能继续升阶";
        {
          const cost = this.config.Rules.RankCosts[m.rank - 1]!;
          if ((s.souls[m.id] ?? 0) < cost) return "同种魂魄不足";
          if (m.rank >= 2) return "三阶被动尚在迁移，本版最多二阶";
          s.souls[m.id]! -= cost;
          m.rank++;
          return "";
        }
    }
  }
  private consumePotions(units: number) {
    let remaining = units;
    const items = this.state.items;
    for (const [id, value] of [
      ["xp_potion_l", 20],
      ["xp_potion_m", 4],
      ["xp_potion", 1],
    ] as const) {
      if (remaining >= value && (items[id] ?? 0) > 0) {
        const take = Math.min(Math.floor(remaining / value), items[id] ?? 0);
        items[id] = (items[id] ?? 0) - take;
        remaining -= take * value;
      }
    }
    if (remaining > 0) {
      if ((items.xp_potion_m ?? 0) > 0) {
        items.xp_potion_m!--;
        items.xp_potion = (items.xp_potion ?? 0) + 4 - remaining;
      } else if ((items.xp_potion_l ?? 0) > 0) {
        items.xp_potion_l!--;
        const change = 20 - remaining;
        items.xp_potion_m = (items.xp_potion_m ?? 0) + Math.floor(change / 4);
        items.xp_potion = (items.xp_potion ?? 0) + (change % 4);
      } else throw new Error("药水账本不一致");
    }
  }

  private spawn(id: string, enemy: boolean, opening: boolean): boolean {
    const b = this.state.battle!;
    if (
      b.units.some((u) => u.id === id) ||
      b.units.filter((u) => u.enemy === enemy && u.hp > 0).length >= 10
    )
      return false;
    const e = b.enemies.find((e) => e.id === id),
      m = this.member(id);
    if (!enemy && (!m || m.hp <= 0)) return false;
    const kind = enemy ? e!.kind : id,
      profile = clone(enemy ? e!.profile : this.profile(m!)),
      a = clone(enemy ? e!.attributes : this.attributes(m!)),
      rank = enemy ? e!.rank : isHuman(id) ? 1 : m!.rank;
    const slot = Array.from({ length: 10 }, (_, i) => i).find(
        (i) =>
          !b.units.some((u) => u.enemy === enemy && u.hp > 0 && u.slot === i),
      )!,
      sp = this.config.Rules.Species[kind],
      w = this.config.Rules.Equipment.find((g) => g.Id === m?.equipment.weapon);
    const u: Unit = {
      ...contribution(),
      id,
      kind,
      enemy,
      hp: enemy ? e!.hp : m!.hp,
      energy: enemy ? 0 : m!.energy,
      attributes: a,
      profile,
      rank,
      slot,
      x: 0,
      z: 0,
      radius: this.config.Rules.Combatants[kind]!.Radius ?? sp?.Radius ?? 0.4,
      range:
        this.config.Rules.Combatants[kind]!.AttackRange ??
        sp?.AttackRange ??
        (["ranged", "healer"].includes(profile.Role) ? 3.8 : 0.55),
      moveSpeed:
        this.config.Rules.Combatants[kind]!.MoveSpeed ?? sp?.MoveSpeed ?? 3.8,
      autoLevel: isHuman(kind)
        ? (w?.AutoLevel ?? 0)
        : rank >= 5
          ? 3
          : rank >= 2
            ? 2
            : 1,
      ultimateLevel: isHuman(kind)
        ? (w?.UltimateLevel ?? 1)
        : rank >= 4
          ? 2
          : 1,
      passiveLevel:
        this.playtest?.skillPolicy === "supported-only" || isHuman(kind)
          ? 0
          : rank >= 5
            ? 2
            : rank >= 3
              ? 1
              : 0,
      cooldown: 0.2 + slot * 0.08,
      special: 1.5 + slot * 0.1,
      entry: opening ? 0.35 : 0.9,
      slow: 0,
      stun: 0,
      barrier: 0,
      regeneration: 0,
      regenTick: 0,
      regenOwner: "",
      hitStun: 0,
      hitGuard: 0,
      blockedFor: 0,
      action: null,
      recovery: 0,
    };
    const p = deployment(u, b.units, opening);
    if (!p) return false;
    u.x = p.x;
    u.z = p.z;
    b.units.push(u);
    this.emit("enter", id, id);
    return true;
  }
  private target(u: Unit) {
    return this.state
      .battle!.units.filter(
        (v) => v.enemy !== u.enemy && v.hp > 0 && v.entry <= 0,
      )
      .sort(
        (a, b) =>
          gap(u, a) - gap(u, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];
  }
  private available(u: Unit, skill: string) {
    if (!SUPPORTED_SKILLS.has(skill)) return false;
    const r = this.config.Rules.Actions[skill]!;
    if (r.DamageType === "heal")
      return this.state.battle!.units.some(
        (v) =>
          v.enemy === u.enemy &&
          v.hp > 0 &&
          v.entry <= 0 &&
          gap(u, v) <= 6 &&
          v.hp < v.attributes.MaxHp,
      );
    return this.state.battle!.units.some(
      (v) =>
        v.enemy !== u.enemy &&
        v.hp > 0 &&
        v.entry <= 0 &&
        gap(u, v) <= (skill === u.profile.Ultimate ? 8 : u.range + 0.25),
    );
  }
  private rule(
    u: Unit,
    kind: "basic" | "auto" | "ultimate",
    skill: string,
  ): ActionRule {
    if (kind !== "basic") return clone(this.config.Rules.Actions[skill]!);
    const d = this.config.Rules.Combatants[u.kind]!;
    return {
      DamageType: d.BasicDamageType,
      Delivery: d.ProjectileFamily ? "projectile" : "instant",
      Family: d.ProjectileFamily,
      Windup: 0.35,
      Backswing: 0.25,
      ProjectileSpeed: 20,
      Lifetime: 2,
      Area: false,
      Interruptible: true,
      ScalingStat: "atk",
      Ratios: [1],
      Bases: [0],
    };
  }
  private startAction(
    u: Unit,
    kind: "basic" | "auto" | "ultimate",
    skill: string,
    target: Unit | undefined,
  ) {
    const b = this.state.battle!,
      r = this.rule(u, kind, skill);
    u.action = {
      id: ++b.actionId,
      kind,
      skill,
      target: target?.id ?? "",
      work:
        kind === "basic"
          ? u.profile.Interval *
            this.config.Rules.Combatants[u.kind]!.WindupRatio
          : r.Windup,
    };
    if (kind === "basic") u.cooldown = u.profile.Interval;
    if (kind === "auto") u.special = u.profile.Cooldown;
    if (kind === "ultimate") {
      u.energy -= 1000;
      u.ultimates++;
      u.recovery = 0;
    }
    this.emit(
      kind === "ultimate" ? "charge" : "windup",
      u.id,
      target?.id ?? "",
      0,
      false,
      u.action.id,
    );
  }
  private cancel(u: Unit, hostile = false) {
    if (!u.action) return;
    if (hostile) u.interrupts++;
    this.emit("cancel", u.id, u.id, 0, false, u.action.id);
    u.action = null;
  }
  private gain(u: Unit, amount: number, source: "action" | "hurt" | "kill") {
    if (u.hp <= 0) return;
    const before = u.energy;
    u.energy = Math.min(
      1000,
      u.energy + amount * (1 + u.attributes.EnergyRegen),
    );
    const gained = u.energy - before;
    if (source === "action") u.attackEnergy += gained;
    else if (source === "hurt") u.hurtEnergy += gained;
    else u.killEnergy += gained;
  }
  private hp(u: Unit, value: number) {
    u.hp = Math.max(0, Math.min(u.attributes.MaxHp, value));
    if (u.hp === 0) u.energy = 0;
    if (!u.enemy) this.member(u.id)!.hp = u.hp;
    else this.state.battle!.enemies.find((e) => e.id === u.id)!.hp = u.hp;
  }
  private roll(chance: number) {
    const b = this.state.battle!;
    b.random = nextRandom(b.random);
    return b.random / 0xffffffff < chance;
  }
  private heal(
    actor: Unit,
    target: Unit,
    amount: number,
    rule: ActionRule | null,
    actionId: number,
  ) {
    let critical = false;
    if (rule?.DamageType === "heal") {
      const lvl =
        actor.action?.kind === "ultimate"
          ? actor.ultimateLevel
          : actor.autoLevel;
      amount = roundAway(
        actor.attributes.Magic *
          (rule.Ratios[Math.min(lvl - 1, rule.Ratios.length - 1)] ?? 1) +
          (rule.Bases[Math.min(lvl - 1, rule.Bases.length - 1)] ?? 0),
      );
      critical = this.roll(actor.attributes.CritRate);
      if (critical) amount = roundAway(amount * 1.5);
    }
    const before = target.hp;
    this.hp(target, target.hp + amount);
    actor.healing += target.hp - before;
    if (target.hp > before)
      this.emit(
        "heal",
        actor.id,
        target.id,
        target.hp - before,
        critical,
        actionId,
      );
  }
  private hit(
    actor: Unit,
    target: Unit,
    raw: number,
    rule: ActionRule,
    kind: "basic" | "auto" | "ultimate",
    actionId: number,
    projectileId: number,
    source: Attributes,
  ) {
    if (target.hp <= 0 || target.entry > 0) return false;
    const dodge =
        rule.DamageType === "physical" &&
        kind !== "ultimate" &&
        this.roll(target.attributes.DodgeRate),
      critical = this.roll(source.CritRate);
    if (dodge) {
      target.dodges++;
      this.emit("dodge", actor.id, target.id, 0, false, actionId, projectileId);
      return false;
    }
    const amount = damage(
        raw,
        rule.DamageType === "magical"
          ? target.attributes.Resistance
          : target.attributes.Defense,
        source.Penetration,
        critical,
      ),
      absorbed = Math.min(amount, Math.ceil(target.barrier));
    target.barrier = Math.max(0, target.barrier - absorbed);
    target.absorbed += absorbed;
    const loss = Math.min(target.hp, amount - absorbed);
    this.hp(target, target.hp - loss);
    actor.damage += loss;
    if (critical) actor.criticals++;
    if (loss > 0 && target.hp > 0)
      this.gain(target, (500 * loss) / target.attributes.MaxHp, "hurt");
    if (target.hp === 0) {
      this.gain(actor, 300, "kill");
      this.cancel(target);
    }
    if (
      loss > 0 &&
      target.hp > 0 &&
      target.hitGuard <= 0 &&
      loss >
        target.attributes.MaxHp * (0.1 + target.attributes.Tenacity * 0.15) &&
      target.action?.kind !== "ultimate"
    ) {
      this.cancel(target, true);
      target.hitStun = 0.2 * (1 - target.attributes.Tenacity);
      target.hitGuard = 0.4;
      target.staggers++;
    }
    this.emit(
      "hit",
      actor.id,
      target.id,
      -loss,
      critical,
      actionId,
      projectileId,
    );
    return true;
  }
  private executeAction(
    u: Unit,
    target: Unit | undefined,
    kind: "basic" | "auto" | "ultimate",
    skill: string,
    r: ActionRule,
    actionId: number,
    projectileId = 0,
    source = u.attributes,
    power = 0,
  ) {
    const b = this.state.battle!,
      lvl = kind === "ultimate" ? u.ultimateLevel : u.autoLevel;
    if (r.DamageType === "heal") {
      const allies = b.units
        .filter(
          (v) =>
            v.enemy === u.enemy &&
            v.hp > 0 &&
            v.entry <= 0 &&
            v.hp < v.attributes.MaxHp &&
            gap(u, v) <= (kind === "ultimate" ? 6 : 5),
        )
        .sort((a, b) => a.hp / a.attributes.MaxHp - b.hp / b.attributes.MaxHp);
      for (const v of allies.slice(0, kind === "ultimate" ? 3 + lvl : 1)) {
        // heal() receives the correct skill level even after the action leaves windup.
        const scaled = {
          ...r,
          Ratios: [r.Ratios[Math.min(lvl - 1, r.Ratios.length - 1)]!],
          Bases: [r.Bases[Math.min(lvl - 1, r.Bases.length - 1)]!],
        };
        this.heal(u, v, 0, scaled, actionId);
        if (kind === "ultimate") {
          v.regeneration = 3 + lvl;
          v.regenTick = 1;
          v.regenOwner = u.id;
        }
      }
      return;
    }
    if (!target) return;
    const raw =
      kind === "basic"
        ? power || source[r.DamageType === "magical" ? "Magic" : "Attack"]
        : Math.max(
            1,
            roundAway(
              source[r.ScalingStat === "mag" ? "Magic" : "Attack"] *
                (r.Ratios[Math.min(lvl - 1, r.Ratios.length - 1)] ?? 1) +
                (r.Bases[Math.min(lvl - 1, r.Bases.length - 1)] ?? 0),
            ),
          );
    const targets =
      skill === "tide"
        ? b.units.filter(
            (v) =>
              v.enemy !== u.enemy &&
              v.hp > 0 &&
              v.entry <= 0 &&
              distance(v, target) <= 2.8 + lvl * 0.4,
          )
        : [target];
    const damageBefore = u.damage;
    for (const v of targets) {
      if (this.hit(u, v, raw, r, kind, actionId, projectileId, source)) {
        if (skill === "water") v.slow = 2 + u.passiveLevel * 0.5;
        if (skill === "tide") v.slow = 2 + lvl;
      }
    }
    const leech = roundAway(
      (u.damage - damageBefore) * source.Lifesteal * (r.Area ? 0.5 : 1),
    );
    if (leech > 0 && u.hp > 0) this.heal(u, u, leech, null, actionId);
  }
  private step() {
    const s = this.state,
      b = s.battle!;
    s.tick++;
    b.tick++;
    for (const p of [...b.projectiles]) {
      const target = b.units.find(
        (u) => u.id === p.target && u.hp > 0 && u.entry <= 0,
      );
      p.life -= STEP;
      if (!target || p.life <= 0) {
        b.projectiles = b.projectiles.filter((v) => v.id !== p.id);
        continue;
      }
      const d = distance(p, target),
        travel = p.speed * STEP;
      if (d > travel + target.radius + 0.06) {
        p.x += ((target.x - p.x) / d) * travel;
        p.z += ((target.z - p.z) / d) * travel;
        continue;
      }
      b.projectiles = b.projectiles.filter((v) => v.id !== p.id);
      this.executeAction(
        b.units.find((u) => u.id === p.owner)!,
        target,
        p.kind,
        p.skill,
        p.rule,
        p.actionId,
        p.id,
        p.source,
        p.power,
      );
    }
    if (b.tickets < 3) {
      b.recovery += STEP;
      if (b.recovery + 1e-8 >= 8) {
        b.tickets++;
        b.recovery = 0;
      }
    } else b.recovery = 0;
    if (b.enemyTickets < 3) {
      b.enemyRecovery += STEP;
      if (b.enemyRecovery + 1e-8 >= 8) {
        b.enemyTickets++;
        b.enemyRecovery = 0;
      }
    } else b.enemyRecovery = 0;
    separate(b.units);
    const waiting = b.enemies.find((e) => !b.units.some((u) => u.id === e.id));
    if (waiting && b.enemyTickets > 0 && this.spawn(waiting.id, true, false))
      b.enemyTickets--;
    for (const u of [...b.units]) {
      if (u.hp <= 0) continue;
      u.cooldown = Math.max(0, u.cooldown - STEP);
      u.special = Math.max(0, u.special - STEP);
      u.stun = Math.max(0, u.stun - STEP);
      u.slow = Math.max(0, u.slow - STEP);
      if (u.entry > 0) {
        u.entry = Math.max(0, u.entry - STEP);
        continue;
      }
      if (u.regeneration > 0) {
        u.regeneration = Math.max(0, u.regeneration - STEP);
        u.regenTick -= STEP;
        if (u.regenTick <= 0) {
          const healer = b.units.find((v) => v.id === u.regenOwner) ?? u;
          this.heal(
            healer,
            u,
            Math.max(2, roundEven(healer.attributes.Magic * 0.25)),
            null,
            0,
          );
          u.regenTick = 1;
        }
      }
      const speed = 1 + u.attributes.Haste;
      u.cooldown = Math.max(0, u.cooldown + STEP - STEP * speed);
      u.hitStun = Math.max(0, u.hitStun - STEP);
      u.hitGuard = Math.max(0, u.hitGuard - STEP);
      if (
        (u.stun > 0 || u.hitStun > 0) &&
        !(
          u.action?.kind === "ultimate" &&
          !this.rule(u, "ultimate", u.action.skill).Interruptible
        )
      ) {
        this.cancel(u, true);
        continue;
      }
      if (u.action) {
        const action = u.action;
        action.work = Math.max(0, action.work - STEP * speed);
        if (action.work > 1e-8) continue;
        const target = b.units.find(
            (v) => v.id === action.target && v.hp > 0 && v.entry <= 0,
          ),
          r = this.rule(u, action.kind, action.skill);
        u.action = null;
        u.recovery =
          action.kind === "basic"
            ? u.profile.Interval *
              (1 - this.config.Rules.Combatants[u.kind]!.WindupRatio)
            : r.Backswing;
        if (!target && !["heal", "buff"].includes(r.DamageType)) continue;
        if (action.kind === "basic") this.gain(u, 90, "action");
        if (r.Delivery === "projectile" && target) {
          b.projectiles.push({
            id: ++b.projectileId,
            actionId: action.id,
            owner: u.id,
            target: target.id,
            kind: action.kind,
            skill: action.skill,
            rule: r,
            source: clone(u.attributes),
            power:
              action.kind === "basic"
                ? roundAway(
                    u.attributes[
                      r.DamageType === "magical" ? "Magic" : "Attack"
                    ],
                  )
                : 0,
            x: u.x,
            z: u.z,
            speed: r.ProjectileSpeed,
            life: r.Lifetime,
          });
          this.emit(
            "launch",
            u.id,
            target.id,
            0,
            false,
            action.id,
            b.projectileId,
          );
        } else
          this.executeAction(
            u,
            target,
            action.kind,
            action.skill,
            r,
            action.id,
          );
        continue;
      }
      if (u.recovery > 0) {
        u.recovery = Math.max(0, u.recovery - STEP * speed);
        continue;
      }
      const target = this.target(u);
      if (
        u.enemy &&
        u.energy >= 1000 &&
        this.available(u, u.profile.Ultimate)
      ) {
        this.startAction(u, "ultimate", u.profile.Ultimate, target);
        continue;
      }
      if (
        u.profile.Auto &&
        u.special <= 0 &&
        this.available(u, u.profile.Auto)
      ) {
        this.startAction(u, "auto", u.profile.Auto, target);
        continue;
      }
      if (!target) continue;
      if (gap(u, target) > u.range) move(u, target, b.units);
      else if (u.cooldown <= 0) this.startAction(u, "basic", "attack", target);
    }
    for (const u of b.units.filter((u) => !u.enemy))
      this.member(u.id)!.energy = u.hp > 0 ? u.energy : 0;
    if (
      b.enemies.every((e) => e.hp === 0) &&
      b.units.some((u) => !u.enemy && u.hp > 0) &&
      !b.projectiles.some(
        (p) =>
          b.units.some((u) => u.id === p.owner && u.enemy) &&
          b.units.some((u) => u.id === p.target && u.hp > 0),
      )
    ) {
      b.result = "victory";
      if (!this.playtest) this.reward();
      this.emit("victory");
      return;
    }
    if (!b.units.some((u) => !u.enemy && u.hp > 0)) {
      b.wipe += STEP;
      const reserves = s.members.some(
        (m) => m.hp > 0 && !b.units.some((u) => u.id === m.id),
      );
      if (!reserves || b.wipe >= 4) {
        b.result = "loss";
        this.emit("loss");
      }
    } else b.wipe = 0;
    if (b.tick >= 6000 && b.result === "") {
      b.result = "flee";
      this.emit("timeout");
    }
  }
  private reward() {
    const s = this.state,
      b = s.battle!;
    let i = 0;
    for (const group of this.current().Enemies)
      for (let n = 0; n < group.Count; n++) {
        s.xp += group.Experience || 8 + group.Level * 3;
        const drop =
          i++ === 0 ? (this.current().Boss ? "revive" : "herb") : "shell";
        s.items[drop] = (s.items[drop] ?? 0) + 1;
        s.souls[group.Species] = (s.souls[group.Species] ?? 0) + group.Souls;
        for (const [id, amount] of [
          ["xp_potion", group.Potions],
          ["xp_potion_m", group.PotionsM],
          ["xp_potion_l", group.PotionsL],
        ] as const)
          s.items[id] = (s.items[id] ?? 0) + amount;
        if (!this.member(group.Species)) {
          const m: Member = {
            id: group.Species,
            hp: 0,
            energy: 0,
            rank: 1,
            potionXp: 0,
            equipment: {},
          };
          s.members.push(m);
          m.hp = Math.trunc((this.attributes(m).MaxHp + 1) / 2);
          s.souls[group.Species]!--;
          this.emit("collect", m.id);
        }
      }
    for (const u of b.units.filter((u) => !u.enemy))
      u.attributes.MaxHp = this.attributes(this.member(u.id)!).MaxHp;
  }
  advance(ticks: number) {
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > 200000)
      throw new Error("tick数量无效");
    for (let i = 0; i < ticks; i++) {
      if (
        !this.state.battle?.started ||
        this.state.battle.result ||
        this.state.tick >= 200000
      )
        break;
      this.step();
    }
  }
  serialize() {
    if (this.playtest)
      return JSON.stringify({
        format: "tower30-playtest",
        schemaVersion: 1,
        engineVersion: "tower30-ts-workbench-v1",
        config: this.config,
        configHash: this.configHash,
        setup: this.playtest,
        tick: this.state.tick,
        journal: this.state.journal,
      });
    return JSON.stringify({
      format: "tower30-web-command-save",
      schemaVersion: 1,
      engineVersion: "tower30-ts-m1-v1",
      configHash: this.configHash,
      seed: this.state.seed,
      tick: this.state.tick,
      journal: this.state.journal,
    });
  }
  getConfigSnapshot() {
    return clone(this.config);
  }
  static createPlaytest(config: Config, input: PlaytestSetup) {
    const setup = playtestSetupSchema.parse(input),
      checked = validateConfig(config),
      warnings = playtestWarnings(checked, setup);
    if (setup.skillPolicy === "strict" && warnings.length)
      throw new Error("存在未迁移功能：" + warnings.join("；"));
    const engine = new TowerEngine(checked, setup.seed);
    engine.playtest = clone(setup);
    const s = engine.state;
    s.floor = setup.floor;
    s.gold = 0;
    s.items = {};
    s.equipment = setup.startingGear ? [...checked.StartingEquipment] : [];
    s.xp = setup.level === 1 ? 0 : checked.HumanXpThresholds[setup.level - 2]!;
    s.members = [...setup.party]
      .sort((a, b) => Number(isHuman(b)) - Number(isHuman(a)))
      .map((id) => ({
        id,
        hp: 0,
        energy: setup.energy,
        rank: isHuman(id) ? 1 : setup.rank,
        potionXp: isHuman(id)
          ? 0
          : checked.Rules.Species[id]!.LevelCosts.slice(
              0,
              setup.level - 1,
            ).reduce((s, v) => s + v, 0),
        equipment:
          setup.startingGear && isHuman(id)
            ? { weapon: id === "hero" ? "traveler_sword" : "healer_staff" }
            : {},
      }));
    for (const m of s.members)
      m.hp = Math.max(
        1,
        Math.ceil((engine.attributes(m).MaxHp * setup.hpPercent) / 100),
      );
    return engine;
  }
  static restorePlaytest(json: string) {
    if (json.length > 2_000_000) throw new Error("测试存档过大");
    const schema = z
      .object({
        format: z.literal("tower30-playtest"),
        schemaVersion: z.literal(1),
        engineVersion: z.literal("tower30-ts-workbench-v1"),
        config: z.unknown(),
        configHash: z.string(),
        setup: playtestSetupSchema,
        tick: saveSchema.shape.tick,
        journal: saveSchema.shape.journal,
      })
      .strict();
    const save = schema.parse(JSON.parse(json)),
      engine = TowerEngine.createPlaytest(
        validateConfig(save.config),
        save.setup,
      );
    if (engine.configHash !== save.configHash)
      throw new Error("测试配置指纹不匹配");
    return TowerEngine.replay(engine, save.tick, save.journal);
  }
  private static replay(
    engine: TowerEngine,
    tick: number,
    journal: State["journal"],
  ) {
    for (const entry of journal) {
      if (entry.tick < engine.state.tick || entry.tick > tick)
        throw new Error("命令顺序错误");
      engine.advance(entry.tick - engine.state.tick);
      if (engine.state.tick !== entry.tick) throw new Error("非法战斗时间");
      const r = engine.dispatch(entry.command);
      if (!r.ok) throw new Error("存档命令失败：" + r.message);
    }
    engine.advance(tick - engine.state.tick);
    if (engine.state.tick !== tick) throw new Error("存档时间不一致");
    return engine;
  }
  static restore(config: Config, json: string) {
    if (json.length > 2_000_000) throw new Error("存档过大");
    const save = saveSchema.parse(JSON.parse(json)),
      engine = new TowerEngine(config, save.seed);
    if (engine.configHash !== save.configHash)
      throw new Error("存档配表版本不匹配");
    return TowerEngine.replay(engine, save.tick, save.journal);
  }
}
export type Snapshot = ReturnType<TowerEngine["getSnapshot"]>;
