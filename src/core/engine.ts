import {resolveEffects,type Effects,hasDotRatio,dotDefaults} from "./effects";
import {
  fingerprint,
  type ActionRule,
  type Attributes,
  type Config,
  type Gear,
} from "./config";
import { clone, damage, LOGIC_HZ, nextRandom, roundAway, roundEven, STEP, MAX_TICKS } from "./math";
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
import { canMove, deployment, distance, gap, move, separate } from "./movement";
import {
  combatantAttributes,
  enemyAttributes,
  humanLevelFromXp,
  humanXpForLevel,
  monsterCostForLevel,
  monsterLevelFromXp,
  monsterTotalXpForLevel,
  postBattleHumanHealRatio,
} from "./projections";
import {
  playtestSetupSchema,
  playtestWarnings,
  supportedSkills,
  supportedPassives,
  supportedGearEffects,
  type PlaytestSetup,
} from "./playtest";
import {
  V2_SKILL_IDS,
  executeV2Skill,
  v2IgnoresSilence,
  v2SelectTarget,
  v2TriggerEvery,
  type StrikeOptions,
  type V2Context,
} from "./v2-skills";
import { z } from "zod";
import { validateConfig } from "./config";
export const PLAYABLE_FLOORS = 100;
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
  readonly logicHz = LOGIC_HZ;
  readonly stepSeconds = STEP;
  private seconds(tick: number) { return tick * STEP; }
  private battleSeconds(b: Battle) { return this.seconds(b.tick); }
  getPlaytestSetup() { return clone(this.playtest); }
  readonly configHash: string;
  private readonly config: Config;
  private readonly effects: Effects;
  constructor(config: Config, seed = 2463534242) {
    this.config = clone(config);
    this.effects = resolveEffects(this.config.Rules.Effects);
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
      logicHz: this.logicHz, stepSeconds: this.stepSeconds,
      seconds: this.seconds(this.state.tick),
      battle:this.getBattleSnapshot(),
      events:this.state.events.map(e=>({...e,seconds:this.seconds(e.tick)})),
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
      ...(this.postBattleHumanHealRatio() > 0
        ? { postBattleHumanHealRatio: this.postBattleHumanHealRatio() }
        : {}),
      playableFloors: this.config.Floors.length,
      completed: !this.playtest && this.state.floor > this.config.Floors.length,
      completion: !this.playtest && this.state.floor > this.config.Floors.length ? {
        floors: this.state.records.length, bosses: this.clearedBosses(),
        ticks: this.state.records.reduce((sum,r)=>sum+r.ticks,0),
        seconds:this.state.records.reduce((sum,r)=>sum+(r.seconds??r.ticks*STEP),0),
        gold: this.state.gold, members: this.state.members.length,
        alive: this.state.members.filter(m=>m.hp>0).length,
      } : null,
    });
  }
  getFloorSnapshot() {
    const encounter=this.current(),floor=this.config.Floors[this.state.floor-1];
    if(!encounter||!floor)return null;
    return clone({number:floor.Number,title:encounter.Title,hint:encounter.Hint,boss:encounter.Boss,background:encounter.Background,
      gold:encounter.Gold,equipment:floor.Equipment,
      enemies:encounter.Enemies.map(group=>({kind:group.Species,count:group.Count,level:group.Level,rank:group.Rank,attributes:enemyAttributes(this.config,group)}))});
  }
  getShopSnapshot(){
    return clone(this.config.Economy.Offers.map(offer=>({id:offer.Id,item:offer.Item,stage:offer.Stage,amount:offer.Amount,unitPrice:offer.Price,
      unlocked:offer.Stage<=this.shopStage(),quote:this.quoteBuy(offer.Id,1),gear:this.config.Rules.Equipment.find(g=>g.Id===offer.Item)??null})));
  }
  getBattleSnapshot() {
    const b = this.state.battle;
    if (!b) return null;
    return clone({ ...b, seconds: this.battleSeconds(b) });
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
    return humanLevelFromXp(this.config.HumanXpThresholds, this.state.xp);
  }
  level(m: Member) {
    if (isHuman(m.id)) return this.humanLevel();
    return monsterLevelFromXp(
      this.config.Rules.Species[m.id]!.LevelCosts,
      m.potionXp,
    );
  }
  attributes(m: Member) {
    return combatantAttributes(
      this.config,
      m.id,
      this.level(m),
      Object.values(m.equipment),
      m.rank,
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
      basis = isHuman(m.id) ? 0 : monsterTotalXpForLevel(costs, level),
      next = isHuman(m.id) ? 0 : monsterCostForLevel(costs, level),
      need = isHuman(m.id) ? 0 : Math.max(0, next - (m.potionXp - basis)),
      units = Math.ceil(need / 25);
    return {
      xp: m.potionXp - basis,
      next,
      units,
      targetLevel: isHuman(m.id)
        ? level
        : this.level({
            ...m,
            potionXp: m.potionXp + units * 25,
          }),
      available:
        (this.state.items.xp_potion ?? 0) +
        (this.state.items.xp_potion_m ?? 0) * 4 +
        (this.state.items.xp_potion_l ?? 0) * 20,
      rankCost: this.config.Rules.RankCosts[m.rank - 1] ?? 0,
      refund: Math.ceil(m.potionXp / 25),
    };
  }
  private clearedBosses() {
    return this.config.Floors.slice(0, this.state.floor - 1).filter(
      (f) => this.config.Encounters.find((e) => e.Id === f.Encounter)!.Boss,
    ).length;
  }
  private postBattleHumanHealRatio() {
    const princess = this.member("princess");
    return postBattleHumanHealRatio(
      this.config,
      Object.values(princess?.equipment ?? {}),
    );
  }
  private applyPostBattleHumanHeal(princessParticipated: boolean) {
    if (!princessParticipated) return;
    const princess = this.member("princess");
    if (!princess || princess.hp <= 0) return;
    const ratio = this.postBattleHumanHealRatio();
    if (ratio <= 0) return;
    for (const id of ["hero", "princess"] as const) {
      const m = this.member(id);
      if (!m || m.hp <= 0) continue;
      const maxHp = this.attributes(m).MaxHp;
      const amount = Math.max(1, Math.round(maxHp * ratio));
      const gain = Math.min(maxHp - m.hp, amount);
      if (gain > 0) {
        m.hp += gain;
        this.emit("heal", "princess", id, gain);
      }
    }
  }
  shopStage() {
    const clearedBosses = this.clearedBosses();
    return [2, 4, 8, 12, 16].filter((m) => clearedBosses >= m).length;
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
      supportedGearEffects.has(g.Effect)
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
  quoteSell(id: string, quantity: number) {
    const prices = this.config.Economy.SellPrices;
    const unitPrice = Object.hasOwn(prices, id) ? prices[id] : undefined;
    if (
      !unitPrice ||
      this.config.StartingEquipment.includes(id) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 9999
    )
      return null;
    if (this.state.equipment.includes(id)) {
      const equipped = this.state.members.some((m) =>
        Object.values(m.equipment).includes(id),
      );
      if (equipped || quantity !== 1) return null;
      return {
        unitPrice,
        owned: 1,
        quantity: 1,
        total: unitPrice,
        remaining: 0,
        balance: this.state.gold + unitPrice,
      };
    }
    const owned = this.state.items[id] ?? 0;
    if (owned <= 0) return null;
    return {
      unitPrice,
      owned,
      quantity,
      total: unitPrice * quantity,
      remaining: owned - quantity,
      balance: this.state.gold + unitPrice * quantity,
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
    if (this.state.journal.length >= 5000 || this.state.tick >= MAX_TICKS)
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
        if (!this.playtest && s.floor > this.config.Floors.length)
          return `已完成全部${this.config.Floors.length}层试炼`;
        if (!this.playtest && s.floor > PLAYABLE_FLOORS)
          return `后续楼层技能尚在迁移，本版开放${PLAYABLE_FLOORS}层`;
        if (!s.members.some((m) => m.hp > 0))
          return "无人能够出战，请先在旅馆恢复";
        const currentEncounter = this.current();
        const missingSpecies = [
          ...new Set(
            currentEncounter.Enemies.filter(
              (g) =>
                !Object.hasOwn(this.config.Rules.Combatants, g.Species) ||
                !Object.hasOwn(this.config.Rules.Profiles, g.Species),
            ).map((g) => g.Species),
          ),
        ];
        if (missingSpecies.length > 0)
          return `当前关卡（第${s.floor}关）包含已删除怪兽 [${missingSpecies.join("、")}]，请在工作台关卡页修复后再试`;
        const enemies: Battle["enemies"] = [];
        for (const group of currentEncounter.Enemies)
          for (let i = 0; i < group.Count; i++) {
            const a = enemyAttributes(this.config, group);
            const p =
              group.ProfileOverride ??
              this.config.Rules.Profiles[group.Species]!;
            if (
              this.playtest?.skillPolicy !== "supported-only" &&
              ((!!p.Auto && !SUPPORTED_SKILLS.has(p.Auto)) ||
                !(p.AutoSkills ?? []).every((id) => SUPPORTED_SKILLS.has(id)) ||
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
          zones: [],
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
        if (!b || b.started || !m || m.hp <= 0 || c.id === "hero")
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
          u.stun > 0 || u.silence > 0 ||
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
          c.id === "hero" ||
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
          seconds: this.battleSeconds(b),
          result: "victory",
          gold: this.current().Gold,
          contributions: b.units
            .filter((u) => !u.enemy)
            .map((u) => ({
              id: u.id,
              damage: u.damage,
              healing: u.healing,
              absorbed: u.absorbed,
              attackEnergy: u.attackEnergy,
              hurtEnergy: u.hurtEnergy,
              killEnergy: u.killEnergy,
              ultimates: u.ultimates,
              criticals: u.criticals,
              dodges: u.dodges,
              interrupts: u.interrupts,
              staggers: u.staggers,
            })),
        });
        const princessSurvivedInBattle = b.units.some(
          (u) => !u.enemy && u.id === "princess" && u.hp > 0,
        );
        s.floor++;
        s.battle = null;
        s.checkpoint = null;
        this.applyPostBattleHumanHeal(princessSurvivedInBattle);
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
        if (!m || isHuman(m.id))
          return "该伙伴不能使用经验药水";
        {
          const t = this.training(m);
          if (t.available < t.units) return "经验药水不足";
          this.consumePotions(t.units);
          m.potionXp += t.units * 25;
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
          const prof = this.profile(m);
          if (m.rank >= 2 && !prof.AutoSkills?.length && !supportedPassives.has(prof.PassiveEffect)) return "该物种三阶被动尚在迁移";
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
      rank = enemy
        ? e!.rank
        : kind === "princess" && Boolean(profile.AutoSkills?.length)
          ? Math.min(5, 1 + Math.floor((this.level(m!) - 1) / 6))
          : isHuman(id)
            ? 1
            : m!.rank;
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
        : profile.AutoSkills?.length
          ? rank
          : rank >= 5
            ? 3
            : rank >= 2
              ? 2
              : 1,
      ultimateLevel: isHuman(kind)
        ? (w?.UltimateLevel ?? 1)
        : profile.AutoSkills?.length
          ? rank
          : rank >= 4
            ? 2
            : 1,
      passiveLevel:
        (this.playtest?.skillPolicy === "supported-only" &&
          Boolean(profile.PassiveEffect) &&
          !supportedPassives.has(profile.PassiveEffect)) ||
        isHuman(kind)
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
      haste: 0, dotTick: 0, dotPower: 0, dotOwner: "", healBlock: 0, reflectCooldown: 0, counterReady: false,
      weaken: 0, root: 0, physicalGuard: 0, spellGuard: 0, comboHits: 0, comboTarget: "", charge: 0,
      dotTime: 0, shield: 0, armorBreak: 0, silence: 0, taunt: 0, taunter: "", controlGuard: 0,
      leech: 0, focusTime: 0, focus: "", emergencyUsed: false,
      regeneration: 0,
      regenTick: 0,
      regenOwner: "",
      hitStun: 0,
      hitGuard: 0,
      blockedFor: 0,
      basicCount: 0,
      skillCursor: 0,
      resBreak: 0,
      resBreakAmount: 0,
      armorBreakAmount: 0,
      vuln: 0,
      vulnAmount: 0,
      blind: 0,
      blindRate: 0,
      disarm: 0,
      energyLock: 0,
      stealth: 0,
      undying: 0,
      reviveUsed: false,
      petrify: 0,
      petrifyDamage: 0,
      atkBuff: 0,
      atkBuffAmount: 0,
      defBuff: 0,
      defBuffAmount: 0,
      critBuff: 0,
      critBuffAmount: 0,
      critDmgBuff: 0,
      critDmgBuffAmount: 0,
      dodgeBuff: 0,
      dodgeBuffAmount: 0,
      lifestealBuff: 0,
      lifestealBuffAmount: 0,
      hasteBuffAmount: 0,
      dmgReduction: 0,
      dmgReductionAmount: 0,
      thornsTime: 0,
      thornsRatio: 0,
      damageCapTime: 0,
      damageCapRatio: 0,
      transformTime: 0,
      transformKind: "",
      stacks: {},
      shackleIds: [],
      shackleTime: 0,
      shackleRatio: 0,
      shieldShareTo: "",
      shieldShareTime: 0,
      shieldShareRatio: 0,
      hitsTaken: 0,
      damageTakenBucket: 0,
      chainUltUsed: 0,
      action: null,
      recovery: 0,
    };
    const p = deployment(u, b.units, opening);
    if (!p) return false;
    u.x = p.x;
    u.z = p.z;
    b.units.push(u);
    if (!enemy && !opening && b.units.some(v => !v.enemy && v.hp > 0 && v.entry <= 0 && this.gearEffect(v, "arrival"))) {
      u.barrier = Math.max(u.barrier, u.attributes.MaxHp * this.effects.ArrivalShieldRatio);
      this.emit("ward", id, id);
    }
    this.emit("enter", id, id);
    return true;
  }
  private passive(u: Unit) { return u.passiveLevel > 0 ? u.profile.PassiveEffect : ""; }
  private actionSpeed(u: Unit) {
    const hasteAmt = u.haste > 0 ? Math.max(this.effects.HasteBonus, u.hasteBuffAmount) : 0;
    return Math.max(0.4, 1 + Math.min(1, u.attributes.Haste + hasteAmt));
  }
  private negative(u: Unit) {
    return u.stun>0 || u.root>0 || u.slow>0 || u.weaken>0 || u.silence>0 || u.armorBreak>0 || u.resBreak>0 || u.dotTime>0 || u.healBlock>0 || u.blind>0 || u.disarm>0 || u.energyLock>0 || u.vuln>0 || Object.keys(u.stacks).length>0;
  }
  private multiplier(actor: Unit, target: Unit, rule: ActionRule, weaken: number, hpRatio: number, skill: string) {
    const attack=this.passive(actor), defense=this.passive(target), spell=rule.DamageType==="magical";
    let scale=weaken>0?this.effects.WeakenMultiplier:1;
    if(actor.atkBuff>0 && V2_SKILL_IDS.has(skill))scale*=1+actor.atkBuffAmount;
    if(target.vuln>0)scale*=1+target.vulnAmount;
    if(target.petrify>0 && target.rank>=3)scale*=1.25;
    if(attack==="execute" && target.hp<target.attributes.MaxHp*.4)scale+=.18;
    if(attack==="armor_bonus" && target.armorBreak>0)scale+=.12*actor.passiveLevel;
    if(attack==="burn_bonus" && target.dotTime>0)scale+=.12*actor.passiveLevel;
    if(["controlled_bonus","controlled_leech"].includes(attack) && (target.stun>0 || target.root>0))scale+=.12*actor.passiveLevel;
    if(attack==="unshielded"&&target.barrier<=0)scale+=.1*actor.passiveLevel;
    if(attack==="shield_power"&&actor.barrier>0)scale+=.12*actor.passiveLevel;
    if(attack==="shield_break"&&target.barrier>0)scale+=.25;
    if(attack==="slow_power"&&target.slow>0)scale+=.1*actor.passiveLevel;
    if(attack==="flame_bonus"&&["ember","flame"].includes(skill))scale+=.08*actor.passiveLevel;
    if(attack==="low_power")scale+=Math.min(.3,(1-hpRatio)*.35);
    if(attack==="combo")scale+=Math.min(3,actor.comboHits)*.06;
    let guard=target.shield>0?this.effects.ShieldGuard:0;
    if(spell && target.spellGuard>0 || !spell && target.physicalGuard>0)guard=Math.max(guard,this.effects.TypedGuard);
    if(target.dmgReduction>0)guard=Math.max(guard,target.dmgReductionAmount);
    if(defense==="damage_guard")guard=Math.max(guard,.08*target.passiveLevel);
    if(!spell && defense==="physical_guard")guard=Math.max(guard,.12*target.passiveLevel);
    if(!spell&&defense==="silver")guard=Math.max(guard,.32);
    if(spell && defense==="spell_guard")guard=Math.max(guard,.15*target.passiveLevel);
    if(spell && this.gearEffect(target,"spell_guard"))guard=Math.max(guard,.15);
    const maxCap = target.dmgReduction > 0 && target.dmgReductionAmount > 0.6 ? target.dmgReductionAmount : 0.6;
    return scale*(1-Math.min(maxCap,guard));
  }
  private gearEffect(u: Unit, effect: string) {
    return !u.enemy && Object.values(this.member(u.id)?.equipment ?? {}).some(id => this.config.Rules.Equipment.some(g => g.Id === id && g.Effect === effect));
  }
  private foes(u: Unit) {
    return this.state.battle!.units.filter(v => v.enemy !== u.enemy && v.hp > 0 && v.entry <= 0)
      .sort((a,b) => gap(u,a)-gap(u,b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  private target(u: Unit) {
    const foes = this.foes(u).filter(v => v.stealth <= 0);
    const pool = foes.length ? foes : this.foes(u);
    return pool.find(v => u.taunt > 0 && v.id === u.taunter) ?? pool.find(v => u.focusTime > 0 && v.id === u.focus) ?? pool[0];
  }
  private available(u: Unit, skill: string) {
    if (!SUPPORTED_SKILLS.has(skill)) return false;
    const r = this.config.Rules.Actions[skill]!;
    if (r.DamageType === "heal" || r.DamageType === "buff")
      return this.state.battle!.units.some(v => v.enemy === u.enemy && v.hp > 0 && v.entry <= 0 && gap(u,v) <= (r.Range ?? (V2_SKILL_IDS.has(skill) ? 12 : 6)) && (r.DamageType === "buff" || v.hp < v.attributes.MaxHp || this.negative(v)));
    const reach = V2_SKILL_IDS.has(skill) && skill !== u.profile.Ultimate
      ? Math.max(r.Range ?? 0, u.range + .25)
      : (r.Range ?? (skill === u.profile.Ultimate ? 8 : u.range + .25));
    return this.foes(u).some(v => gap(u,v) <= reach);
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
    u.charge = kind === "ultimate" ? u.action.work / this.actionSpeed(u) : 0;
    if (kind === "basic") u.cooldown = u.profile.Interval;
    if (kind === "auto") {
      u.special = u.profile.Cooldown;
      if (u.profile.AutoSkills?.length) u.cooldown = u.profile.Interval;
    }
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
    u.charge = 0;
  }
  private gain(u: Unit, amount: number, source: "action" | "hurt" | "kill") {
    if (u.hp <= 0 || u.energyLock > 0) return;
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
    const minHp = u.undying > 0 ? 1 : 0;
    u.hp = Math.max(minHp, Math.min(u.attributes.MaxHp, value));
    if (u.hp === 0) u.energy = 0;
    if (u.summoned) return;
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
    if (target.hp <= 0) return;
    let critical = false;
    if (rule?.DamageType === "heal") {
      amount = roundAway(actor.attributes[rule.ScalingStat === "mag" ? "Magic" : "Attack"] * (rule.Ratios[0] ?? 1) + (rule.Bases[0] ?? 0));
    }
    if (target.healBlock > 0) amount = Math.ceil(amount * this.effects.HealingReceived);
    if (this.passive(actor) === "self_heal" && actor === target) amount = Math.ceil(amount * 1.15);
    if (this.passive(actor) === "heal_low" && target.hp < target.attributes.MaxHp * .4) amount = Math.ceil(amount * 1.2);
    if (this.passive(actor) === "shield_heal" && target.barrier > 0) amount = Math.ceil(amount * 1.15);
    if (rule?.DamageType === "heal") {
      critical = this.roll(actor.attributes.CritRate);
      if (critical) amount = roundAway(amount * 1.5);
    }
    if (this.gearEffect(actor, "overheal") && target.hp + amount > target.attributes.MaxHp) {
      target.barrier = Math.max(target.barrier, Math.min(target.attributes.MaxHp * this.effects.OverhealShieldCap, (target.hp + amount - target.attributes.MaxHp) * this.effects.OverhealShieldRatio));
      this.emit("ward", actor.id, target.id);
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
    periodic = false,
    weaken = actor.weaken,
    hpRatio = actor.hp/actor.attributes.MaxHp,
    skill = "",
    reflection = false,
    opts: StrikeOptions = {},
  ) {
    return this.hitDetailed(
      actor,
      target,
      raw,
      rule,
      kind,
      actionId,
      projectileId,
      source,
      periodic,
      weaken,
      hpRatio,
      skill,
      reflection,
      opts,
      false,
    ).hit;
  }
  private hitDetailed(
    actor: Unit,
    target: Unit,
    raw: number,
    rule: ActionRule,
    kind: "basic" | "auto" | "ultimate",
    actionId: number,
    projectileId: number,
    source: Attributes,
    periodic = false,
    weaken = actor.weaken,
    hpRatio = actor.hp/actor.attributes.MaxHp,
    skill = "",
    reflection = false,
    opts: StrikeOptions = {},
    shacklePropagated = false,
  ): { hit: boolean; loss: number; critical: boolean } {
    if (target.hp <= 0 || target.entry > 0) return { hit: false, loss: 0, critical: false };
    const b = this.state.battle!;
    const dmgType = opts.damageType ?? rule.DamageType;
    const dodgeRate = Math.min(0.9, target.attributes.DodgeRate + (target.dodgeBuff > 0 ? target.dodgeBuffAmount : 0));
    const blindMiss = !reflection && !periodic && kind !== "ultimate" && actor.blind > 0 && this.roll(actor.blindRate);
    const dodge =
        blindMiss ||
        (!reflection && !periodic && dmgType === "physical" &&
        kind !== "ultimate" &&
        this.roll(dodgeRate));
    const critRate = Math.min(1, source.CritRate + (actor.critBuff > 0 ? actor.critBuffAmount : 0));
    const critical = !reflection && !periodic && (Boolean(opts.forceCrit) || this.roll(critRate));
    if (dodge) {
      target.dodges++;
      this.emit("dodge", actor.id, target.id, 0, false, actionId, projectileId);
      return { hit: false, loss: 0, critical: false };
    }
    let effDef =
      dmgType === "magical"
        ? target.attributes.Resistance * (target.resBreak > 0 ? Math.max(0, 1 - (target.resBreakAmount || 0.25)) : 1)
        : target.attributes.Defense *
          (target.armorBreak > 0
            ? (target.armorBreakAmount > 0 ? Math.max(0, 1 - target.armorBreakAmount) : this.effects.ArmorBreakDefenseMultiplier)
            : 1);
    if (target.defBuff > 0) effDef *= 1 + target.defBuffAmount;
    if (opts.ignoreDefRatio) effDef *= Math.max(0, 1 - opts.ignoreDefRatio);
    const effectiveRule = dmgType === rule.DamageType ? rule : { ...rule, DamageType: dmgType };
    const pureTrue = opts.trueDamage !== undefined && opts.trueDamage > 0 && raw === opts.trueDamage;
    let amount = pureTrue
      ? roundAway(opts.trueDamage!)
      : damage(
          raw,
          effDef,
          source.Penetration,
          critical,
          this.multiplier(actor, target, effectiveRule, weaken, hpRatio, skill === "firebolt" ? "ember" : skill),
        ) + (opts.trueDamage && opts.trueDamage > 0 ? roundAway(opts.trueDamage) : 0);
    const extraCrit = (actor.critDmgBuff > 0 ? actor.critDmgBuffAmount : 0) + (opts.bonusCritDmg ?? 0);
    if (critical && extraCrit > 0 && !pureTrue) amount = roundAway(amount * ((1.5 + extraCrit) / 1.5));
    if (target.damageCapTime > 0 && target.damageCapRatio > 0) {
      amount = Math.min(amount, Math.max(1, roundAway(target.attributes.MaxHp * target.damageCapRatio)));
    }
    const absorbed = Math.min(amount, Math.ceil(target.barrier));
    target.barrier = Math.max(0, target.barrier - absorbed);
    target.absorbed += absorbed;
    if(absorbed>0&&target.barrier===0&&this.passive(target)==="shield_counter")target.counterReady=true;
    let postShield = amount - absorbed;
    if (postShield > 0 && target.shieldShareTime > 0 && target.shieldShareTo && !shacklePropagated) {
      const guardian = b.units.find(v => v.id === target.shieldShareTo && v.hp > 0 && v.entry <= 0);
      if (guardian) {
        const share = Math.min(postShield, Math.max(1, roundAway(postShield * target.shieldShareRatio)));
        postShield -= share;
        const gAbs = Math.min(share, Math.ceil(guardian.barrier));
        guardian.barrier = Math.max(0, guardian.barrier - gAbs);
        guardian.absorbed += gAbs;
        const gLoss = Math.min(guardian.hp, share - gAbs);
        this.hp(guardian, guardian.hp - gLoss);
        actor.damage += gLoss;
        if (gLoss > 0) this.emit("hit", actor.id, guardian.id, -gLoss, false, actionId, projectileId);
      }
    }
    const loss = Math.min(target.hp, postShield);
    this.hp(target, target.hp - loss);
    actor.damage += loss;
    if (critical) actor.criticals++;
    if (target.petrify > 0 && target.petrifyDamage > 0 && loss > 0) {
      target.damageTakenBucket += loss;
    }
    if (loss > 0 && target.hp > 0) {
      target.hitsTaken++;
      this.gain(target, (500 * loss) / target.attributes.MaxHp, "hurt");
      if (!target.emergencyUsed && target.hp <= target.attributes.MaxHp * .3 && this.gearEffect(target, "emergency")) {
        target.emergencyUsed = true; target.barrier = Math.max(target.barrier, target.attributes.MaxHp * this.effects.EmergencyShieldRatio); this.emit("ward", target.id, target.id);
      }
    }
    if (target.hp === 0 && !target.reviveUsed && target.rank >= 5 && !target.summoned) {
      if (target.kind === "zombie") {
        target.reviveUsed = true;
        this.hp(target, Math.max(1, roundAway(target.attributes.MaxHp * 0.35)));
        target.undying = 4;
        this.emit("revive", target.id, target.id);
      } else if (target.kind === "flame_skeleton") {
        target.reviveUsed = true;
        this.hp(target, Math.max(1, roundAway(target.attributes.MaxHp * 0.4)));
        this.emit("revive", target.id, target.id);
        for (const f of this.foes(target).filter(v => gap(target, v) <= 2.8)) {
          this.hitDetailed(target, f, Math.max(1, roundAway(target.attributes.Magic * 1.6)), { ...rule, DamageType: "magical" }, "auto", actionId, 0, target.attributes, true, 0, target.hp / target.attributes.MaxHp, "revive_blast", true);
        }
      } else if (target.kind === "pharaoh_beast") {
        target.reviveUsed = true;
        this.hp(target, Math.max(1, roundAway(target.attributes.MaxHp * 0.5)));
        target.energy = 500;
        this.emit("revive", target.id, target.id);
      }
    }
    if (target.hp === 0) {
      if(!reflection)this.gain(actor, 300, "kill");
      this.cancel(target);
      if (target.explodeOnDeath && target.explodeOnDeath > 0) {
        const boom = Math.max(1, roundAway(target.attributes.MaxHp * target.explodeOnDeath));
        for (const f of this.foes(target).filter(v => gap(target, v) <= 2.6)) {
          this.hitDetailed(target, f, boom, { ...rule, DamageType: "magical" }, "auto", actionId, 0, target.attributes, true, 0, 1, "summon_explode", true);
        }
      }
    }
    if (
      !reflection && !periodic && loss > 0 &&
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
      reflection ? "reflect" : "hit",
      actor.id,
      target.id,
      -loss,
      critical,
      actionId,
      projectileId,
    );
    if (loss > 0 && !reflection && !shacklePropagated && target.shackleTime > 0 && target.shackleIds.length > 0) {
      for (const sid of target.shackleIds) {
        const linked = b.units.find(v => v.id === sid && v.hp > 0 && v.entry <= 0);
        if (!linked) continue;
        const shareDmg = Math.max(1, roundAway(loss * target.shackleRatio));
        const sLoss = Math.min(linked.hp, shareDmg);
        this.hp(linked, linked.hp - sLoss);
        actor.damage += sLoss;
        if (sLoss > 0) this.emit("hit", actor.id, linked.id, -sLoss, false, actionId, projectileId);
        if (linked.hp === 0) this.cancel(linked);
      }
    }
    if(loss>0&&!reflection) {
      if(target.hp>0&&this.passive(target)==="counter")target.counterReady=true;
      if(target.hp>0&&actor.hp>0&&!periodic&&target.thornsTime>0&&target.thornsRatio>0) {
        const reflectDmg = Math.max(1, roundAway(loss * target.thornsRatio));
        this.hitDetailed(target, actor, reflectDmg, { ...rule, DamageType: "magical" }, kind, actionId, 0, target.attributes, false, target.weaken, target.hp / target.attributes.MaxHp, "reflect", true);
      }
      if(target.hp>0&&actor.hp>0&&target.reflectCooldown<=0&&this.passive(target)==="thorns"&&this.effects.ReflectionRatio>0) {
        target.reflectCooldown=this.effects.ReflectionCooldown;
        this.hit(target,actor,Math.max(1,roundAway(loss*this.effects.ReflectionRatio)),{...rule,DamageType:"physical"},kind,actionId,0,target.attributes,false,target.weaken,target.hp/target.attributes.MaxHp,"reflect",true);
      }
    }
    return { hit: true, loss, critical };
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
    leechTime = u.leech,
    weakenTime = u.weaken,
    hpRatio = u.hp/u.attributes.MaxHp,
  ) {
    const b = this.state.battle!, lvl = kind === "ultimate" ? u.ultimateLevel : u.autoLevel;
    const duration = (fallback: number) => r.Duration ?? fallback;
    const range = (fallback: number) => r.Range ?? fallback;
    const radius = (fallback: number) => r.Radius ?? fallback;
    const stat = source[r.ScalingStat === "mag" ? "Magic" : "Attack"];
    const allies = (reach: number) => b.units.filter(v => v.enemy === u.enemy && v.hp > 0 && v.entry <= 0 && gap(u,v) <= range(reach));
    const foes = b.units.filter(v=>v.enemy!==u.enemy&&v.hp>0&&v.entry<=0).sort((a,b)=>gap(u,a)-gap(u,b));
    const scaled = { ...r, Ratios: [r.Ratios[Math.min(lvl-1,r.Ratios.length-1)] ?? (skill==="dragon_wall"?.9:1)], Bases: [r.Bases[Math.min(lvl-1,r.Bases.length-1)] ?? 0] };
    const raw = kind === "basic" ? power || roundAway(source[r.DamageType === "magical" ? "Magic" : "Attack"]*(u.counterReady?this.effects.CounterMultiplier:1)) : Math.max(1,roundAway(stat * scaled.Ratios[0]! + scaled.Bases[0]!));
    const shieldPower=(fallback:number)=>stat*(r.ShieldRatios?.[lvl-1]??fallback);
    const dotPower=(divisor:number)=>{
      const ratio=r.DotRatio;
      if(ratio===0)return 0;
      return Math.max(1,Math.floor(ratio===undefined || (hasDotRatio(skill)&&ratio===dotDefaults[skill]) ? stat/divisor : stat*ratio));
    };
    const regen = (v: Unit, time: number) => { v.regeneration = duration(time); v.regenTick = 1; v.regenOwner = u.id; };
    const taunt = (v: Unit, time: number) => { const before=v.taunt;v.taunter = u.id; v.taunt = duration(time);if(v.taunt>before)v.taunt=before+(v.taunt-before)*(1-v.attributes.Tenacity);this.emit(skill,u.id,v.id); };
    const cleanse=(v: Unit)=>{
      v.stun=v.root=v.slow=v.weaken=v.silence=v.armorBreak=v.healBlock=v.dotTime=0;
      if(this.passive(u)==="cleanse_ward")v.barrier=Math.max(v.barrier,source.Magic*this.effects.CleanseShieldRatio);
      this.emit("cleanse",u.id,v.id);
    };
    const control=(v: Unit,seconds:number,root=false)=>{
      if(v.controlGuard>0)return;
      const time=duration(seconds),key=root?"root":"stun",before=v[key];v[key]=Math.min(2,time);
      if(v[key]>before)v[key]=before+(v[key]-before)*(1-v.attributes.Tenacity);
      v.controlGuard=(root?time:Math.min(2,time))+2.5;
      if(!root&&v.stun>0&&!(v.action?.kind==="ultimate"&&!this.rule(v,"ultimate",v.action.skill).Interruptible))this.cancel(v,true);
      this.emit(root?"earth_prison":"control",u.id,v.id);
    };
    const dot=(v: Unit,power:number,seconds:number)=>{
      if(v.hp<=0)return;
      if(power<=0)return;
      if(power>=v.dotPower||v.dotTime<=0){v.dotOwner=u.id;v.dotPower=power;}
      v.dotTime=Math.max(v.dotTime,duration(seconds));v.dotTick=Math.max(STEP,v.dotTick);
    };
    if (V2_SKILL_IDS.has(skill)) {
      this.executeV2Action(u, target, kind, skill, r, actionId, projectileId, source, raw, stat, leechTime, weakenTime, hpRatio);
      return;
    }
    let leechAmount=0;
    const strike = (v: Unit) => {
      const before=u.damage,controlled=v.stun>0||v.root>0;
      const hit=this.hit(u,v,raw,r,kind,actionId,projectileId,source,false,weakenTime,hpRatio,skill);
      const rate=Math.min(.6,source.Lifesteal+(leechTime>0?.33:0)+(skill==="leech"?.6:0)+(this.passive(u)==="controlled_leech"&&controlled?.125:0));
      leechAmount+=(u.damage-before)*rate;
      return hit;
    };
    const finishLeech=()=>{
      const amount=roundAway(leechAmount*(r.Area?.5:1));
      if(amount>0&&u.hp>0)this.heal(u,u,amount,null,actionId);
    };
    if(skill==="boss_carapace") {
      this.heal(u,u,Math.trunc(u.attributes.MaxHp*.08),null,actionId);u.physicalGuard=duration(3);
      for(const v of b.units.filter(v=>v.enemy!==u.enemy&&v.hp>0&&v.entry<=0&&gap(u,v)<=range(7.5)))strike(v);
      finishLeech();
      return;
    }
    if(skill==="mossheal" || skill==="rooted_guard") {
      if(skill==="mossheal") {if(u.hp>=u.attributes.MaxHp)return;this.heal(u,u,0,scaled,actionId);regen(u,3);}
      else {const before=u.root;u.root=duration(2);if(u.root>before)u.root=before+(u.root-before)*(1-u.attributes.Tenacity);u.shield=duration(4);this.heal(u,u,0,scaled,actionId);this.emit(skill,u.id,u.id);}
      return;
    }
    if(["hard_shell","spirit_armor","armor_front","spirit_veil"].includes(skill)) {
      for(const v of kind==="ultimate"?allies(6):[u]) {
        if(skill==="hard_shell"||skill==="armor_front")v.physicalGuard=duration(kind==="ultimate"?4:3+lvl*.3);
        else v.spellGuard=duration(kind==="ultimate"?4:3+lvl*.3);
        this.emit(skill,u.id,v.id);
      }
      return;
    }
    if(["forest_rest","forest_sanctuary","holy_prayer","purify_veil"].includes(skill)) {
      const targets=allies(6);if(!targets.some(v=>v.hp<v.attributes.MaxHp||this.negative(v)))return;
      for(const v of targets){
        if(["forest_rest","holy_prayer","purify_veil"].includes(skill))cleanse(v);
        if(skill!=="purify_veil")this.heal(u,v,0,scaled,actionId);
        if(skill==="forest_rest")regen(v,4);
        if(skill==="forest_sanctuary"||skill==="purify_veil"){v.barrier=Math.max(v.barrier,shieldPower(.6+.2*lvl));if(skill==="forest_sanctuary")v.shield=duration(3);}
      }
      return;
    }
    if (r.DamageType === "heal") {
      const ordered = allies(kind === "ultimate" ? 6 : 5).sort((a,b) => a.hp/a.attributes.MaxHp - b.hp/b.attributes.MaxHp);
      const injured = ordered.filter(v => v.hp < v.attributes.MaxHp || (["leafward","forest_breath","holy_light","cleanse"].includes(skill) && this.negative(v)));
      const targets = skill === "forest_rest" ? (ordered.some(v=>v.hp<v.attributes.MaxHp||this.negative(v))?allies(6):[]) : injured.slice(0,kind === "ultimate" ? 3+lvl : 1);
      for (const v of targets) {
        if(skill==="holy_light"||skill==="cleanse")cleanse(v);
        this.heal(u,v,0,scaled,actionId);
        if (skill === "leafward" || skill === "forest_breath" || skill === "wardheal" || (skill === "heal" && u.passiveLevel > 0)) {
          v.barrier = Math.max(v.barrier,["leafward","forest_breath"].includes(skill) ? shieldPower(.4+lvl*.12) : skill === "wardheal" ? shieldPower(.5) : 3+u.passiveLevel*2); this.emit("ward",u.id,v.id);
        }
        if (skill === "renew") regen(v,3+lvl);
        if (skill === "leafward") regen(v,3);
        if (skill === "forest_rest") regen(v,4);
      }
      return;
    }
    if(skill==="tailwind"||skill==="silver_wall"||skill==="silver_guard"||skill==="dragon_wall"||skill==="furious_assault") {
      if(skill==="furious_assault"){u.haste=duration(5);u.armorBreak=duration(3);this.emit(skill,u.id,u.id);return;}
      const targets=skill==="dragon_wall"?[u]:allies(skill==="silver_guard"?6:5);
      for(const v of (skill==="silver_wall"?[...targets].sort((a,b)=>a.hp/a.attributes.MaxHp-b.hp/b.attributes.MaxHp).slice(0,2):targets)){
        if(skill==="tailwind")v.haste=Math.max(v.haste,duration(3+(this.passive(u)==="haste"?1:0)));
        if(skill==="silver_wall"){v.barrier=Math.max(v.barrier,shieldPower(.7+.2*lvl));v.controlGuard=Math.max(v.controlGuard,duration(1.5));}
        if(skill==="silver_guard"){v.barrier=Math.max(v.barrier,shieldPower(1+.3*lvl));v.controlGuard=duration(4);}
        if(skill==="dragon_wall")v.shield=duration(4);
        this.emit(skill,u.id,v.id);
      }
      if(skill==="dragon_wall")for(const v of foes.filter(v=>gap(u,v)<=range(4))){taunt(v,3+lvl);strike(v);}
      finishLeech();return;
    }
    if (skill === "aegis") {
      for (const v of allies(5).filter(v => v.barrier < stat*.5).sort((a,b) => a.hp/a.attributes.MaxHp-b.hp/b.attributes.MaxHp).slice(0,1+u.passiveLevel)) {
        v.barrier = Math.max(v.barrier,shieldPower(.7+.2*lvl)); this.emit(skill,u.id,v.id);
      }
      return;
    }
    if (skill === "shellwall") {
      for (const v of allies(5)) { v.shield = Math.max(v.shield,duration(3+lvl)); v.barrier = Math.max(v.barrier,shieldPower(.7+.2*lvl)); this.emit(skill,u.id,v.id); }
      return;
    }
    if (skill === "bait" || skill === "taunt") {
      for (const v of foes.filter(v => gap(u,v) <= range(skill === "bait" ? 3 : 4))) taunt(v,skill === "bait" ? 1.5+lvl*.5 : 2+lvl);
      if (skill === "taunt") { u.shield = Math.max(u.shield,duration(3+lvl)); this.emit("guard",u.id,u.id); }
      return;
    }
    if (skill === "pounce") {
      const rear = [...foes].sort((a,b) => Number(["healer","ranged"].includes(b.profile.Role))-Number(["healer","ranged"].includes(a.profile.Role)) || Math.abs(b.x)-Math.abs(a.x))[0];
      if (rear) { u.focus = rear.id; u.focusTime = duration(8); u.leech = duration(6+lvl*2); this.emit(skill,u.id,u.id); }
      return;
    }
    if (skill === "interrupt") {
      target = foes.filter(v => gap(u,v) <= range(8)).sort((a,b) => b.charge-a.charge || b.energy-a.energy)[0];
    }
    if (!target) return;
    if (kind === "auto" && !projectileId && gap(u,target) > range(u.range+.25)) return;
    if (["fire_rain","poison_cloud","gloom"].includes(skill)) {
      if (gap(u,target) <= range(skill==="gloom"?7:8)) { b.zones.push({owner:u.id,enemy:u.enemy,x:target.x,z:target.z,remaining:duration(4+lvl),tick:1,power:raw,radius:radius(3),kind:skill}); this.emit(skill,u.id,target.id); } return;
    }
    if(skill==="silence") {
      for(const v of foes.filter(v=>gap(u,v)<=range(8)).sort((a,b)=>Number(["healer","ranged"].includes(b.profile.Role))-Number(["healer","ranged"].includes(a.profile.Role))).slice(0,2+lvl)) {
        const before=v.silence;
        v.silence=Math.max(v.silence,duration(2+lvl));v.charge=0;strike(v);
        if(v.silence>before)v.silence=before+(v.silence-before)*(1-v.attributes.Tenacity);
      }
      finishLeech();
      return;
    }
    const primary = kind === "ultimate" && !["interrupt","boss_stomp","boss_tempest"].includes(skill) ? foes.find(v => gap(u,v) <= range(["ice_domain","earth_prison","cyclone","fear_strike","shatter_ray","draw_slash","dragon_sweep"].includes(skill)?8:7)) : target;
    if (!primary) return;
    let targets = [primary];
    if (["ice_domain","earth_prison","cyclone","draw_slash","dragon_sweep"].includes(skill)) targets = foes.filter(v=>gap(u,v)<=range(8)&&distance(v,primary)<=radius(3));
    if (skill === "shatter_ray") targets=foes.filter(v=>gap(u,v)<=range(8)).sort((a,b)=>b.barrier-a.barrier).slice(0,3);
    if (skill === "tide" || skill === "cleave") targets = foes.filter(v => distance(v,primary) <= radius(2.8+lvl*.4));
    if (skill === "rupture") targets = foes.filter(v => distance(v,primary) <= radius(2.1));
    if (skill === "boss_stomp" || skill === "boss_tempest") targets = b.units.filter(v => v.enemy !== u.enemy && v.hp > 0 && v.entry <= 0 && (r.Range === undefined || gap(u,v) <= r.Range));
    if (skill === "flame") {
      const dx=primary.x-u.x,dz=primary.z-u.z,len=Math.max(.001,distance(u,primary));
      targets=foes.filter(v => gap(u,v)<=range(7+lvl) && (v.x-u.x)*dx+(v.z-u.z)*dz>=distance(u,v)*len*.45);
    }
    if(kind==="auto"&&["ember","frenzy_cut","earth_stomp","lava_bolt","dragon_claw","frost_breath"].includes(skill))
      targets=b.units.filter(v=>v.enemy!==u.enemy&&v.hp>0&&v.entry<=0&&distance(v,target)<=radius(skill==="ember"?2:skill==="frost_breath"?2.5:1.6));
    if(skill==="parry")u.physicalGuard=duration(2);
    for (const v of targets) {
      const beforeArmor = v.armorBreak, beforeSlow = v.slow;
      if (skill === "rupture") v.armorBreak = duration(3+lvl);
      if (skill === "tide") v.slow = duration(2+lvl);
      if(skill==="interrupt")v.charge=0;
      if (skill === "interrupt" && v.controlGuard <= 0) { v.stun = Math.min(2,duration(1.2+lvl*.3))*(1-v.attributes.Tenacity); v.controlGuard = Math.min(2,duration(1.2+lvl*.3))+2.5; }
      const statusBefore={barrier:v.barrier,charge:v.charge};
      if(skill==="crystal_pierce"&&v.barrier>0)v.barrier=Math.max(0,v.barrier-stat*(.5+.2*lvl));
      const hit = strike(v);
      if(hit && kind==="basic") {u.comboHits=u.comboTarget===v.id?Math.min(3,u.comboHits+1):1;u.comboTarget=v.id;}
      if(skill==="doublecut") {
        const secondHit=strike(v);
        // C# action status memory spans both segments and restores on any miss.
        if(!hit||!secondHit){v.barrier=statusBefore.barrier;v.charge=statusBefore.charge;}
      }
      if (!hit) { v.armorBreak = beforeArmor; v.slow = beforeSlow; continue; }
      if (skill === "water" || skill === "ice_shard") v.slow = duration(2+u.passiveLevel*.5);
      if (["water","tide","ice_shard"].includes(skill) && v.slow > beforeSlow) v.slow = beforeSlow+(v.slow-beforeSlow)*(1-v.attributes.Tenacity);
      if(skill==="poison"){v.healBlock=duration(3+lvl);dot(v,dotPower(6),3+u.passiveLevel);}
      if(skill==="lava_bolt")dot(v,dotPower(8),3);
      if(skill==="nightmare_strike")control(v,.5);
      if(skill==="fear_strike")control(v,1+lvl*.25);
      if(skill==="earth_prison")control(v,1+lvl*.3,true);
      if(skill==="earth_stomp"||skill==="frost_breath"){
        v.slow=duration(2+u.passiveLevel*.4);if(v.slow>beforeSlow)v.slow=beforeSlow+(v.slow-beforeSlow)*(1-v.attributes.Tenacity);
      }
      if(skill==="cyclone"){
        const len=Math.max(.001,distance(primary,v)),x=v.x+(primary.x-v.x)/len*.5,z=v.z+(primary.z-v.z)/len*.5;
        if(canMove(v,x,z,b.units)){v.x=x;v.z=z;}
        v.slow=duration(3);if(v.slow>beforeSlow)v.slow=beforeSlow+(v.slow-beforeSlow)*(1-v.attributes.Tenacity);
      }
      if(skill==="drain")v.energy=Math.max(0,v.energy-(5+lvl+u.passiveLevel)*10);
      if(skill==="curse")v.weaken=duration(2+lvl*.5+u.passiveLevel);
      if(skill==="ice_domain") {
        v.slow=duration(3);if(v.slow>beforeSlow)v.slow=beforeSlow+(v.slow-beforeSlow)*(1-v.attributes.Tenacity);
        if(v.controlGuard<=0) {v.stun=Math.min(2,duration(.7+lvl*.2))*(1-v.attributes.Tenacity);v.controlGuard=Math.min(2,duration(.7+lvl*.2))+2.5;if(!(v.action?.kind==="ultimate"&&!this.rule(v,"ultimate",v.action.skill).Interruptible))this.cancel(v,true);}
      }
      if (skill === "gust") v.energy = Math.max(0,v.energy-(4+lvl)*10);
      if (skill === "interrupt") { v.energy=0; if (v.stun>0 && !(v.action?.kind === "ultimate" && !this.rule(v,"ultimate",v.action.skill).Interruptible)) this.cancel(v,true); }
      if (skill === "breakstrike") v.armorBreak = duration(3);
      if (skill === "ram") {
        if (v.controlGuard<=0) { v.stun=Math.min(2,duration(.35))*(1-v.attributes.Tenacity); v.controlGuard=Math.min(2,duration(.35))+2.5; if (!(v.action?.kind === "ultimate" && !this.rule(v,"ultimate",v.action.skill).Interruptible)) this.cancel(v,true); }
        const len=Math.max(.001,distance(u,v)), x=v.x+(v.x-u.x)/len*.6,z=v.z+(v.z-u.z)/len*.6;
        if (canMove(v,x,z,b.units)) { v.x=x; v.z=z; }
      }
    }
    if(skill==="frenzy_cut"){u.haste=duration(2.5);u.armorBreak=duration(2.5);}
    if (kind === "basic" && u.transformTime > 0 && (u.transformKind === "minotaur" || u.transformKind === "phantom_bat")) {
      const cleaveRadius = u.transformKind === "minotaur" ? 2.6 : 2.2;
      for (const extra of foes.filter(v => v.id !== primary.id && distance(v, primary) <= cleaveRadius)) {
        const hitExtra = this.hitDetailed(u, extra, raw, r, kind, actionId, projectileId, source, false, weakenTime, hpRatio, skill);
        if (u.transformKind === "phantom_bat" && hitExtra.loss > 0 && u.hp > 0) {
          this.heal(u, u, roundAway(hitExtra.loss * 0.3), null, actionId);
        }
      }
      if (u.transformKind === "phantom_bat") leechAmount += roundAway((u.damage > 0 ? 1 : 0) * 0);
    }
    if(kind==="basic")u.counterReady=false;
    finishLeech();
  }
  private executeV2Action(
    u: Unit,
    target: Unit | undefined,
    kind: "basic" | "auto" | "ultimate",
    skill: string,
    r: ActionRule,
    actionId: number,
    projectileId: number,
    source: Attributes,
    raw: number,
    stat: number,
    leechTime: number,
    weakenTime: number,
    hpRatio: number,
    chainDepth = 0,
  ) {
    if (chainDepth > 4) return;
    const b = this.state.battle!;
    const resolvedTarget = projectileId > 0 ? target : (v2SelectTarget(u, skill, this.foes(u)) ?? target);
    const ctx: V2Context = {
      rank: u.rank,
      unit: u,
      target: resolvedTarget,
      kind,
      skill,
      rule: r,
      stat,
      raw,
      actionId,
      projectileId,
      source,
      battle: b,
      allies: (reach = 12) =>
        b.units.filter(v => v.enemy === u.enemy && v.hp > 0 && v.entry <= 0 && gap(u, v) <= reach),
      foes: (reach = 12) =>
        b.units
          .filter(v => v.enemy !== u.enemy && v.hp > 0 && v.entry <= 0 && gap(u, v) <= reach)
          .sort((a, b2) => gap(u, a) - gap(u, b2) || (a.id < b2.id ? -1 : 1)),
      strike: (v, dmgRaw = raw, opts = {}) => {
        const res = this.hitDetailed(
          u,
          v,
          dmgRaw ?? raw,
          r,
          kind,
          actionId,
          projectileId,
          source,
          false,
          weakenTime,
          hpRatio,
          skill,
          false,
          opts,
        );
        const rate = Math.min(
          0.6,
          opts.lifestealOverride ??
            source.Lifesteal +
              (leechTime > 0 ? 0.33 : 0) +
              (u.lifestealBuff > 0 ? u.lifestealBuffAmount : 0),
        );
        if (res.loss > 0 && rate > 0 && u.hp > 0) {
          this.heal(u, u, roundAway(res.loss * rate), null, actionId);
        }
        return res;
      },
      heal: (v, amount) => {
        if (amount > 0 && v.hp > 0) this.heal(u, v, roundAway(amount), null, actionId);
      },
      dot: (v, power, seconds) => {
        if (v.hp <= 0 || power <= 0) return;
        if (power >= v.dotPower || v.dotTime <= 0) {
          v.dotOwner = u.id;
          v.dotPower = power;
        }
        v.dotTime = Math.max(v.dotTime, seconds);
        v.dotTick = Math.max(STEP, v.dotTick);
      },
      addStack: (v, sKind, count, power, seconds, maxStacks = 5) => {
        if (v.hp <= 0) return;
        const cur = v.stacks[sKind];
        const nextCount = Math.min(maxStacks, (cur?.count ?? 0) + count);
        v.stacks[sKind] = {
          count: nextCount,
          power: Math.max(cur?.power ?? 0, power),
          time: Math.max(cur?.time ?? 0, seconds),
          owner: u.id,
          tick: cur?.tick ?? 1,
        };
        this.emit("stack", u.id, v.id, nextCount);
        if (sKind === "poison" && u.kind === "green_snake" && u.rank >= 5 && nextCount >= 5) {
          delete v.stacks.poison;
          this.hitDetailed(u, v, Math.max(1, roundAway(source.Attack * 1.4)), { ...r, DamageType: "magical" }, "auto", actionId, 0, source, true, weakenTime, hpRatio, "poison_burst");
          const spreadTarget = this.foes(u).find(f => f.id !== v.id && gap(v, f) <= 3);
          if (spreadTarget && spreadTarget.hp > 0) {
            const sc = spreadTarget.stacks.poison;
            spreadTarget.stacks.poison = {
              count: Math.min(5, (sc?.count ?? 0) + 2),
              power: Math.max(sc?.power ?? 0, power),
              time: Math.max(sc?.time ?? 0, seconds),
              owner: u.id,
              tick: sc?.tick ?? 1,
            };
          }
        }
      },
      clearStacks: (v, sKind) => {
        if (sKind === "all") {
          let total = 0;
          for (const st of Object.values(v.stacks)) total += st.count;
          v.stacks = {};
          return total;
        }
        const c = v.stacks[sKind]?.count ?? 0;
        delete v.stacks[sKind];
        return c;
      },
      detonatePoison: (v, perStackRatio, keepHalf = false, ignoreResRatio = 0) => {
        const pCount = (v.stacks.poison?.count ?? 0) + (v.dotTime > 0 && !v.stacks.poison ? 1 : 0);
        if (pCount <= 0 || v.hp <= 0) return 0;
        const res = this.hitDetailed(
          u,
          v,
          Math.max(1, roundAway(pCount * stat * perStackRatio)),
          { ...r, DamageType: "magical" },
          kind,
          actionId,
          0,
          source,
          false,
          weakenTime,
          hpRatio,
          skill,
          false,
          { ignoreDefRatio: ignoreResRatio },
        );
        if (v.stacks.poison) {
          if (keepHalf) v.stacks.poison.count = Math.max(1, Math.floor(pCount / 2));
          else delete v.stacks.poison;
        }
        if (!keepHalf) v.dotTime = 0;
        return res.loss;
      },
      control: (v, seconds, mode = "stun") => {
        if (v.hp <= 0 || v.controlGuard > 0) return;
        if (mode === "petrify") {
          const time = Math.max(0.2, seconds * (1 - v.attributes.Tenacity));
          v.petrify = Math.max(v.petrify, time);
          v.controlGuard = time + 2.5;
          if (u.kind === "medusa" && u.rank >= 5) {
            v.petrifyDamage = Math.max(v.petrifyDamage, 0.25);
          }
          if (!(v.action?.kind === "ultimate" && !this.rule(v, "ultimate", v.action.skill).Interruptible)) {
            this.cancel(v, true);
          }
          this.emit("petrify", u.id, v.id);
          return;
        }
        const key = mode === "root" ? "root" : "stun";
        const before = v[key];
        const capped = Math.min(2, seconds);
        v[key] = capped;
        if (v[key] > before) v[key] = before + (v[key] - before) * (1 - v.attributes.Tenacity);
        v.controlGuard = (mode === "root" ? capped : Math.min(2, capped)) + 2.5;
        if (mode !== "root" && v.stun > 0 && !(v.action?.kind === "ultimate" && !this.rule(v, "ultimate", v.action.skill).Interruptible)) {
          this.cancel(v, true);
        }
        this.emit(mode === "root" ? "earth_prison" : "control", u.id, v.id);
      },
      silence: (v, seconds) => {
        if (v.hp <= 0) return;
        const before = v.silence;
        v.silence = Math.max(v.silence, seconds);
        v.charge = 0;
        if (v.silence > before) v.silence = before + (v.silence - before) * (1 - v.attributes.Tenacity);
        this.emit("silence", u.id, v.id);
      },
      taunt: (v, seconds) => {
        if (v.hp <= 0) return;
        const before = v.taunt;
        v.taunter = u.id;
        v.taunt = Math.max(v.taunt, seconds);
        if (v.taunt > before) v.taunt = before + (v.taunt - before) * (1 - v.attributes.Tenacity);
        this.emit(skill, u.id, v.id);
      },
      cleanse: (v) => {
        let count = Object.keys(v.stacks).length;
        for (const k of ["stun", "root", "slow", "weaken", "silence", "armorBreak", "resBreak", "healBlock", "dotTime", "blind", "disarm", "energyLock", "vuln", "petrify"] as const) {
          if (v[k] > 0) count++;
          v[k] = 0;
        }
        v.stacks = {};
        if (this.passive(u) === "cleanse_ward") {
          v.barrier = Math.max(v.barrier, source.Magic * this.effects.CleanseShieldRatio);
        }
        this.emit("cleanse", u.id, v.id);
        return count;
      },
      dispelEnemy: (v) => {
        v.barrier = 0;
        v.haste = 0;
        v.shield = 0;
        v.physicalGuard = 0;
        v.spellGuard = 0;
        v.atkBuff = 0;
        v.defBuff = 0;
        v.critBuff = 0;
        v.critDmgBuff = 0;
        v.dodgeBuff = 0;
        v.lifestealBuff = 0;
        v.dmgReduction = 0;
        v.thornsTime = 0;
        v.damageCapTime = 0;
        v.stealth = 0;
        this.emit("dispel", u.id, v.id);
      },
      addBarrier: (v, amount) => {
        if (amount > 0 && v.hp > 0) {
          v.barrier += roundAway(amount);
          this.emit("ward", u.id, v.id);
        }
      },
      gainEnergy: (v, amount) => {
        this.gain(v, amount, "action");
      },
      drainEnergy: (v, amount) => {
        const taken = Math.min(v.energy, amount);
        v.energy -= taken;
        return taken;
      },
      pullOrPush: (v, towards, dist) => {
        if (v.hp <= 0) return;
        const dx = v.x - towards.x;
        const dz = v.z - towards.z;
        const len = Math.max(0.001, Math.hypot(dx, dz));
        const moveDist = dist < 0 ? -Math.min(Math.max(0, len - 0.3), Math.abs(dist)) : dist;
        const nx = Math.max(-12, Math.min(12, v.x + (dx / len) * moveDist));
        const nz = Math.max(-5.5, Math.min(5.5, v.z + (dz / len) * moveDist));
        if (canMove(v, nx, nz, b.units)) {
          v.x = nx;
          v.z = nz;
        }
      },
      blinkNear: (v) => {
        if (v.hp <= 0) return;
        const sign = u.x <= v.x ? 1 : -1;
        const nx = Math.max(-12, Math.min(12, v.x + sign * (u.radius + v.radius + 0.35)));
        const nz = Math.max(-5.5, Math.min(5.5, v.z));
        u.x = nx;
        u.z = nz;
      },
      spawnZone: (zone) => {
        b.zones.push({ ...zone, owner: u.id, enemy: u.enemy, tick: 0.25 });
        this.emit(zone.kind, u.id, u.id);
      },
      spawnSummon: (label, ratio, duration, opts) => {
        const activeCount = b.units.filter(x => x.summoned && x.enemy === u.enemy && x.hp > 0).length;
        if (activeCount >= 4) return;
        const kindId = opts?.kind ?? label;
        const sumProfile = this.config.Rules.Profiles[kindId] ?? u.profile;
        const combatant = this.config.Rules.Combatants[kindId] ?? this.config.Rules.Combatants[u.kind]!;
        const id = `${u.id}_sum_${++b.actionId}`;
        const sumAttrs: Attributes = {
          ...clone(u.attributes),
          MaxHp: Math.max(40, roundAway(u.attributes.MaxHp * ratio)),
          Attack: Math.max(10, roundAway(u.attributes.Attack * ratio)),
          Magic: Math.max(10, roundAway(u.attributes.Magic * ratio)),
          Defense: roundAway(u.attributes.Defense * ratio),
          Resistance: roundAway(u.attributes.Resistance * ratio),
        };
        const sx = Math.max(-12, Math.min(12, u.x + (u.enemy ? -1 : 1) * 1.1));
        const sz = Math.max(-5.5, Math.min(5.5, u.z + ((activeCount % 2 === 0 ? 1 : -1) * 0.9)));
        const summonedUnit: Unit = {
          ...clone(u),
          id,
          kind: kindId,
          profile: clone(sumProfile),
          rank: Math.min(u.rank, 3),
          hp: sumAttrs.MaxHp,
          energy: 0,
          x: sx,
          z: sz,
          radius: combatant.Radius ?? u.radius,
          range: combatant.AttackRange ?? u.range,
          attributes: sumAttrs,
          cooldown: 0.3,
          special: 1.0,
          entry: 0.1,
          barrier: 0,
          stacks: {},
          shackleIds: [],
          shackleTime: 0,
          shieldShareTime: 0,
          petrify: 0,
          undying: 0,
          stealth: 0,
          stun: 0,
          root: 0,
          silence: 0,
          weaken: 0,
          slow: 0,
          reviveUsed: false,
          action: null,
          recovery: 0,
          summoned: true,
          summonTime: duration,
          summonOwner: u.id,
          explodeOnDeath: opts?.explodeRatio,
          ...contribution(),
        };
        b.units.push(summonedUnit);
        this.emit("enter", id, u.id);
        if (opts?.tauntAll) {
          for (const f of this.foes(summonedUnit).slice(0, 3)) {
            f.taunter = summonedUnit.id;
            f.taunt = Math.max(f.taunt, 2);
          }
        }
      },
      applyBuff: (v, bKind, duration, amount, tag) => {
        if (v.hp <= 0) return;
        switch (bKind) {
          case "atk": v.atkBuff = Math.max(v.atkBuff, duration); v.atkBuffAmount = Math.max(v.atkBuffAmount, amount); break;
          case "def": v.defBuff = Math.max(v.defBuff, duration); v.defBuffAmount = Math.max(v.defBuffAmount, amount); break;
          case "haste": v.haste = Math.max(v.haste, duration); v.hasteBuffAmount = Math.max(v.hasteBuffAmount, amount); break;
          case "crit": v.critBuff = Math.max(v.critBuff, duration); v.critBuffAmount = Math.max(v.critBuffAmount, amount); break;
          case "critDmg": v.critDmgBuff = Math.max(v.critDmgBuff, duration); v.critDmgBuffAmount = Math.max(v.critDmgBuffAmount, amount); break;
          case "dodge": v.dodgeBuff = Math.max(v.dodgeBuff, duration); v.dodgeBuffAmount = Math.max(v.dodgeBuffAmount, amount); break;
          case "lifesteal": v.lifestealBuff = Math.max(v.lifestealBuff, duration); v.lifestealBuffAmount = Math.max(v.lifestealBuffAmount, amount); break;
          case "dmgReduction": v.dmgReduction = Math.max(v.dmgReduction, duration); v.dmgReductionAmount = Math.max(v.dmgReductionAmount, amount); break;
          case "thorns": v.thornsTime = Math.max(v.thornsTime, duration); v.thornsRatio = Math.max(v.thornsRatio, amount); break;
          case "physGuard": v.physicalGuard = Math.max(v.physicalGuard, duration); break;
          case "spellGuard": v.spellGuard = Math.max(v.spellGuard, duration); break;
          case "controlGuard": v.controlGuard = Math.max(v.controlGuard, duration); break;
          case "undying": v.undying = Math.max(v.undying, duration); break;
          case "stealth": v.stealth = Math.max(v.stealth, duration); break;
          case "transform": v.transformTime = Math.max(v.transformTime, duration); v.transformKind = tag ?? v.kind; break;
        }
        this.emit("buff", u.id, v.id);
      },
      applyDebuff: (v, dKind, duration, amount = 0) => {
        if (v.hp <= 0) return;
        const ccTime = Math.max(0.5, duration * (1 - v.attributes.Tenacity * 0.5));
        switch (dKind) {
          case "slow": v.slow = Math.max(v.slow, ccTime); break;
          case "weaken": v.weaken = Math.max(v.weaken, duration); break;
          case "armorBreak": v.armorBreak = Math.max(v.armorBreak, duration); v.armorBreakAmount = Math.max(v.armorBreakAmount, amount); break;
          case "resBreak": v.resBreak = Math.max(v.resBreak, duration); v.resBreakAmount = Math.max(v.resBreakAmount, amount); break;
          case "vuln": v.vuln = Math.max(v.vuln, duration); v.vulnAmount = Math.max(v.vulnAmount, amount); break;
          case "healBlock": v.healBlock = Math.max(v.healBlock, duration); break;
          case "blind": v.blind = Math.max(v.blind, ccTime); v.blindRate = Math.max(v.blindRate, amount || 0.35); break;
          case "disarm": v.disarm = Math.max(v.disarm, ccTime); break;
          case "energyLock": v.energyLock = Math.max(v.energyLock, ccTime); break;
        }
        this.emit("debuff", u.id, v.id);
      },
      triggerSkillNow: (actorUnit, targetSkill, chosenTarget) => {
        if (actorUnit.hp <= 0) return;
        const nextKind = targetSkill === actorUnit.profile.Ultimate ? "ultimate" : "auto";
        const nextRule = this.rule(actorUnit, nextKind, targetSkill);
        const nextStat = actorUnit.attributes[nextRule.ScalingStat === "mag" ? "Magic" : "Attack"];
        const nextLvl = actorUnit.rank;
        const nextRatio = nextRule.Ratios[Math.min(nextLvl - 1, nextRule.Ratios.length - 1)] ?? 1;
        const nextBase = nextRule.Bases[Math.min(nextLvl - 1, nextRule.Bases.length - 1)] ?? 0;
        const nextRaw = Math.max(1, roundAway(nextStat * nextRatio + nextBase));
        if (V2_SKILL_IDS.has(targetSkill)) {
          this.executeV2Action(actorUnit, chosenTarget ?? this.target(actorUnit), nextKind, targetSkill, nextRule, ++b.actionId, 0, actorUnit.attributes, nextRaw, nextStat, actorUnit.leech, actorUnit.weaken, actorUnit.hp / actorUnit.attributes.MaxHp, chainDepth + 1);
        }
      },
      triggerAllyBasic: (ally, chosenTarget) => {
        if (ally.hp <= 0 || chosenTarget.hp <= 0) return;
        const basicRule = this.rule(ally, "basic", "attack");
        const basicPower = roundAway(ally.attributes[basicRule.DamageType === "magical" ? "Magic" : "Attack"]);
        this.hitDetailed(ally, chosenTarget, basicPower, basicRule, "basic", ++b.actionId, 0, ally.attributes, false, ally.weaken, ally.hp / ally.attributes.MaxHp, "attack");
      },
      emit: (evKind, targetId = u.id, amt = 0) => {
        this.emit(evKind, u.id, targetId, amt, false, actionId, projectileId);
      },
      roll: (chance) => this.roll(chance),
    };
    executeV2Skill(ctx);
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
        p.leech,
        p.weaken,
        p.hpRatio,
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
      if (u.summoned && u.summonTime !== undefined) {
        u.summonTime = Math.max(0, u.summonTime - STEP);
        if (u.summonTime <= 0) {
          u.hp = 0;
          this.cancel(u);
          continue;
        }
      }
      u.cooldown = Math.max(0, u.cooldown - STEP);
      u.special = Math.max(0, u.special - STEP);
      u.stun = Math.max(0, u.stun - STEP);
      u.slow = Math.max(0, u.slow - STEP);
      for (const k of ["haste","healBlock","reflectCooldown","weaken","root","physicalGuard","spellGuard","shield","armorBreak","silence","taunt","controlGuard","leech","focusTime","resBreak","vuln","blind","disarm","energyLock","stealth","undying","atkBuff","defBuff","critBuff","critDmgBuff","dodgeBuff","lifestealBuff","dmgReduction","thornsTime","damageCapTime","transformTime","shackleTime","shieldShareTime"] as const) u[k]=Math.max(0,u[k]-STEP);
      if (u.petrify > 0) {
        u.petrify = Math.max(0, u.petrify - STEP);
        if (u.petrify === 0) {
          if (u.petrifyDamage > 0 && u.damageTakenBucket > 0 && u.hp > 0) {
            const shatter = Math.max(1, roundAway(u.damageTakenBucket * u.petrifyDamage));
            const sLoss = Math.min(u.hp, shatter);
            this.hp(u, u.hp - sLoss);
            this.emit("hit", u.id, u.id, -sLoss, true, 0, 0);
          }
          u.petrifyDamage = 0;
          u.damageTakenBucket = 0;
        }
      }
      if (u.shackleTime === 0 && u.shackleIds.length) u.shackleIds = [];
      if (u.entry > 0) {
        u.entry = Math.max(0, u.entry - STEP);
        continue;
      }
      if(u.dotTime>0){
        u.dotTime=Math.max(0,u.dotTime-STEP);u.dotTick=Math.max(0,u.dotTick-STEP);
        if(u.dotTick===0){const owner=b.units.find(v=>v.id===u.dotOwner);if(owner)this.hit(owner,u,u.dotPower,{...this.config.Rules.Actions.poison!,DamageType:"magical"},"auto",0,0,owner.attributes,true);u.dotTick=1;}
        if(u.hp<=0)continue;
      }
      for (const [sKey, st] of Object.entries(u.stacks)) {
        st.time = Math.max(0, st.time - STEP);
        st.tick = Math.max(0, st.tick - STEP * (u.petrify > 0 || u.root > 0 ? 2 : 1));
        if (st.tick === 0 && st.power > 0 && st.count > 0 && (sKey === "poison" || sKey === "burn" || sKey === "wither")) {
          const owner = b.units.find(v => v.id === st.owner);
          if (owner) {
            this.hitDetailed(owner, u, Math.max(1, roundAway(st.power * st.count)), { ...this.config.Rules.Actions.attack!, DamageType: "magical" }, "auto", 0, 0, owner.attributes, true, 0, owner.hp / owner.attributes.MaxHp, sKey);
          }
          st.tick = 1;
        }
        if (st.time <= 0 || st.count <= 0) delete u.stacks[sKey];
      }
      if (u.hp <= 0) continue;
      if (u.regeneration > 0) {
        u.regeneration = Math.max(0, u.regeneration - STEP);
        u.regenTick -= STEP;
        if (u.regenTick <= 0) {
          const healer = b.units.find((v) => v.id === u.regenOwner) ?? u;
          this.heal(
            healer,
            u,
            this.effects.RegenerationRatio===0?0:Math.max(2, roundEven(healer.attributes.Magic * this.effects.RegenerationRatio)),
            null,
            0,
          );
          u.regenTick = 1;
        }
      }
      const speed = this.actionSpeed(u);
      u.cooldown = Math.max(0, u.cooldown + STEP - STEP * speed);
      u.hitStun = Math.max(0, u.hitStun - STEP);
      u.hitGuard = Math.max(0, u.hitGuard - STEP);
      if (
        (u.stun > 0 || u.hitStun > 0 || u.petrify > 0) &&
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
        if (u.silence > 0 && action.kind !== "basic" && !(action.kind === "auto" && v2IgnoresSilence(u, action.skill)) && !(action.kind === "ultimate" && !this.rule(u,"ultimate",action.skill).Interruptible)) { this.cancel(u,true); continue; }
        action.work = Math.max(0, action.work - STEP * speed);
        u.charge=action.kind==="ultimate"?action.work/speed:0;
        if (action.work > 1e-8) continue;
        const target = b.units.find(
            (v) => v.id === action.target && v.hp > 0 && v.entry <= 0,
          ),
          r = this.rule(u, action.kind, action.skill);
        u.action = null;
        u.charge=0;
        u.recovery =
          action.kind === "basic"
            ? u.profile.Interval *
              (1 - this.config.Rules.Combatants[u.kind]!.WindupRatio)
            : r.Backswing;
        if (!target && !["heal", "buff"].includes(r.DamageType)) continue;
        if (action.kind === "basic" || (action.kind === "auto" && Boolean(u.profile.AutoSkills?.length))) this.gain(u, 90, "action");
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
            leech: u.leech,
            weaken: u.weaken,
            hpRatio: u.hp/u.attributes.MaxHp,
            power:
              action.kind === "basic"
                ? roundAway(
                    u.attributes[
                      r.DamageType === "magical" ? "Magic" : "Attack"
                    ]*(u.counterReady?this.effects.CounterMultiplier:1),
                  )
                : 0,
            x: u.x,
            z: u.z,
            speed: r.ProjectileSpeed,
            life: r.Lifetime,
          });
          if(action.kind==="basic")u.counterReady=false;
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
        u.enemy && u.silence <= 0 &&
        u.energy >= 1000 &&
        this.available(u, u.profile.Ultimate)
      ) {
        this.startAction(u, "ultimate", u.profile.Ultimate, target);
        continue;
      }
      if (
        !u.profile.AutoSkills?.length &&
        u.silence <= 0 && u.profile.Auto &&
        u.special <= 0 &&
        this.available(u, u.profile.Auto)
      ) {
        this.startAction(u, "auto", u.profile.Auto, target);
        continue;
      }
      if (!target) continue;
      if (gap(u, target) > u.range) { if(u.root<=0) move(u, target, b.units, this.effects, STEP); }
      else if (u.cooldown <= 0 && u.disarm <= 0) {
        if (u.profile.AutoSkills?.length) {
          const skills = u.profile.AutoSkills;
          const nextSkill = skills[u.skillCursor % skills.length]!;
          u.basicCount++;
          const every = v2TriggerEvery(u, nextSkill);
          if (u.basicCount >= every && (u.silence <= 0 || v2IgnoresSilence(u, nextSkill)) && this.available(u, nextSkill)) {
            u.basicCount = 0;
            u.skillCursor = (u.skillCursor + 1) % skills.length;
            this.startAction(u, "auto", nextSkill, v2SelectTarget(u, nextSkill, this.foes(u)) ?? target);
          } else {
            this.startAction(u, "basic", "attack", target);
          }
        } else {
          this.startAction(u, "basic", "attack", target);
        }
      }
    }
    b.units = b.units.filter(u => !u.summoned || (u.hp > 0 && (u.summonTime ?? 0) > 0));
    for (const zone of [...b.zones]) {
      zone.remaining -= STEP; zone.tick -= STEP;
      if (zone.remaining <= 0) { b.zones = b.zones.filter(v=>v!==zone); continue; }
      if (zone.tick > 0) continue;
      zone.tick=1;
      const owner=b.units.find(u=>u.id===zone.owner);
      if (!owner) continue;
      if (zone.allyHealRatio || zone.allyEnergy || zone.allyGuard) {
        for (const a of b.units.filter(v => v.enemy === zone.enemy && v.hp > 0 && v.entry <= 0 && (v.x - zone.x) ** 2 + (v.z - zone.z) ** 2 <= zone.radius ** 2)) {
          if (zone.allyHealRatio) this.heal(owner, a, Math.max(1, roundAway(a.attributes.MaxHp * zone.allyHealRatio)), null, 0);
          if (zone.allyEnergy) this.gain(a, zone.allyEnergy, "action");
          if (zone.allyGuard) {
            a.dmgReduction = Math.max(a.dmgReduction, 1.2);
            a.dmgReductionAmount = Math.max(a.dmgReductionAmount, zone.allyGuard);
          }
        }
      }
      if (zone.kind === "thunder_avatar") {
        for (const v of this.foes(owner).slice(0, 2)) {
          this.hit(owner, v, zone.power, { ...this.config.Rules.Actions.attack!, DamageType: "magical" }, "ultimate", 0, 0, owner.attributes, true);
        }
        continue;
      }
      for (const v of b.units.filter(v=>v.enemy!==zone.enemy && v.hp>0 && v.entry<=0 && (v.x-zone.x)**2+(v.z-zone.z)**2<=zone.radius**2)) {
        if(zone.kind==="gloom" || zone.enemyWeaken)v.weaken=Math.max(v.weaken,1.2);
        if(zone.kind==="poison_cloud")v.healBlock=Math.max(v.healBlock,1.2);
        if(zone.enemySlow)v.slow=Math.max(v.slow,1.2);
        if(zone.enemyResBreak){v.resBreak=Math.max(v.resBreak,1.2);v.resBreakAmount=Math.max(v.resBreakAmount,zone.enemyResBreak);}
        if(zone.enemyStunTick && v.controlGuard<=0){v.stun=Math.max(v.stun,zone.enemyStunTick*(1-v.attributes.Tenacity));v.controlGuard=zone.enemyStunTick+2;}
        if(zone.power>0)this.hit(owner,v,zone.power,{...this.config.Rules.Actions.fire_rain!,DamageType:"magical"},"ultimate",0,0,owner.attributes,true);
      }
    }
    separate(b.units);
    for (const u of b.units.filter((u) => !u.enemy && !u.summoned))
      this.member(u.id)!.energy = u.hp > 0 ? u.energy : 0;
    if (
      b.enemies.every((e) => e.hp === 0) &&
      b.units.some((u) => !u.enemy && !u.summoned && u.hp > 0) &&
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
    if (!b.units.some((u) => !u.enemy && !u.summoned && u.hp > 0)) {
      b.wipe += STEP;
      const reserves = s.members.some(
        (m) => m.hp > 0 && !b.units.some((u) => u.id === m.id),
      );
      if (!reserves || b.wipe >= 4) {
        b.result = "loss";
        this.emit("loss");
      }
    } else b.wipe = 0;
    if (this.battleSeconds(b)+1e-8 >= 300 && b.result === "") {
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
    for (const u of b.units.filter((u) => !u.enemy && !u.summoned)) {
      const m = this.member(u.id)!;
      u.attributes.MaxHp = this.attributes(m).MaxHp;
      u.hp = Math.min(u.hp, u.attributes.MaxHp);
      m.hp = Math.min(m.hp, u.attributes.MaxHp);
    }
  }
  advance(ticks: number) {
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS)
      throw new Error("tick数量无效");
    for (let i = 0; i < ticks; i++) {
      if (
        !this.state.battle?.started ||
        this.state.battle.result ||
        this.state.tick >= MAX_TICKS
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
        engineVersion: "tower30-ts-workbench-v7",
        config: this.config,
        configHash: this.configHash,
        setup: this.playtest,
        tick: this.state.tick,
        journal: this.state.journal,
      });
    return JSON.stringify({
      format: "tower30-web-command-save",
      schemaVersion: 1,
      engineVersion: "tower30-ts-m3-v2",
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
      checked = validateConfig(config, { allowUnknownEnemySpecies: true }),
      warnings = playtestWarnings(checked, setup);
    if (setup.skillPolicy === "strict" && warnings.length)
      throw new Error("存在未迁移功能：" + warnings.join("；"));
    const currentEncounter = checked.Encounters.find(
      (e) => e.Id === checked.Floors[setup.floor - 1]?.Encounter,
    );
    const speciesSet = new Set(checked.Species.map((s) => s.Id));
    const missing = currentEncounter?.Enemies.filter((e) => !speciesSet.has(e.Species));
    if (missing && missing.length > 0) {
      const missingNames = [...new Set(missing.map((m) => m.Species))];
      throw new Error(`当前测试关卡（第${setup.floor}关）包含已删除怪兽 [${missingNames.join("、")}]，无法开始战斗。请在关卡页修复后再试。`);
    }
    const engine = new TowerEngine(checked, setup.seed);
    engine.playtest = clone(setup);
    const s = engine.state;
    s.floor = setup.floor;
    s.gold = 0;
    s.items = {};
    s.equipment = setup.startingGear ? [...checked.StartingEquipment] : [];
    s.xp = humanXpForLevel(checked.HumanXpThresholds, setup.level);
    s.members = [...setup.party]
      .sort((a, b) => Number(isHuman(b)) - Number(isHuman(a)))
      .map((id) => ({
        id,
        hp: 0,
        energy: setup.energy,
        rank: isHuman(id) ? 1 : setup.rank,
        potionXp: isHuman(id)
          ? 0
          : monsterTotalXpForLevel(
              checked.Rules.Species[id]!.LevelCosts,
              setup.level,
            ),
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
        engineVersion: z.literal("tower30-ts-workbench-v7"),
        config: z.unknown(),
        configHash: z.string(),
        setup: playtestSetupSchema,
        tick: saveSchema.shape.tick,
        journal: saveSchema.shape.journal,
      })
      .strict();
    const save = schema.parse(JSON.parse(json)),
      engine = TowerEngine.createPlaytest(
        validateConfig(save.config, { allowUnknownEnemySpecies: true }),
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
