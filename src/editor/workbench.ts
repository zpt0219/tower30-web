import {effectDefinitions,resolveEffects,hasDotRatio,dotDefaults,hasShieldRatio,defaultShieldRatio,type EffectKey,type ShieldSkill} from "../core/effects";
import { skillLabel } from "../data/skill-labels";
import { type Attributes, type Config } from "../core/config";
import { TowerEngine } from "../core/engine";
import { combatantAttributes, enemyAttributes } from "../core/projections";
import { supportedSkills, type PlaytestSetup } from "../core/playtest";
import { clone } from "../core/math";
import { readWorkbench, writeWorkbench } from "../storage/save";
import {
  newProject,
  readPath,
  setPath,
  validateProject,
  importProject,
  restoreProject,
  editableEncounter,
  type EditorProject,
} from "./project";
import "./workbench.css";
import "./comparison.css";
import { Comparison } from "./comparison";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const attrs: Record<keyof Attributes, string> = {
  MaxHp: "生命",
  Attack: "攻击",
  Defense: "防御",
  Magic: "法术",
  Resistance: "魔抗",
  CritRate: "暴击",
  Penetration: "穿透",
  Haste: "急速",
  DodgeRate: "闪避",
  Lifesteal: "吸血",
  Tenacity: "韧性",
  EnergyRegen: "充能",
};
const percentages = new Set([
  "CritRate",
  "Haste",
  "DodgeRate",
  "Lifesteal",
  "Tenacity",
  "EnergyRegen",
]);
const roles: readonly (readonly [string, string])[] = [
  ["melee", "近战输出"],
  ["tank", "前排承伤"],
  ["ranged", "远程输出"],
  ["healer", "治疗辅助"],
];
type Path = (string | number)[];
export class Workbench {
  private root: HTMLElement | null = null;
  project: EditorProject;
  private tab: "characters" | "floors" | "skills" | "setup" | "analysis" = "characters";
  private readonly comparison: Comparison;
  private character = "hero";
  private action = "swift";
  private statTab: "Base" | "Growth" = "Base";
  private query = "";
  private group = 0;
  private lastValid: Config;
  private status = "草稿自动保存到浏览器";
  private revision = 0;
  private writes = Promise.resolve();
  constructor(
    private readonly baseline: unknown,
    baseConfig: Config,
    private readonly onPlay: (config: Config, setup: PlaytestSetup) => void,
    private readonly notify: (message: string) => void,
    onReview: (serialized:string) => void,
  ) {
    this.project = newProject(baseline);
    this.lastValid = baseConfig;
    this.comparison = new Comparison(baseConfig,()=>this.updateComparison(),notify,(source,name)=>this.download(source,name),onPlay,onReview);
  }
  async load() {
    try {
      const raw = await readWorkbench("draft");
      if (raw) {
        const input: unknown = JSON.parse(raw);
        if (
          input &&
          typeof input === "object" &&
          "format" in input &&
          input.format === "tower30-editor-project" &&
          "source" in input &&
          "setup" in input
        ) {
          const parsed = restoreProject(raw);
          this.project = parsed;
          this.status = "已恢复浏览器草稿";
        }
      }
    } catch {
      this.notify("工作台草稿未能读取，已保留正式试跑。可重新导入导出的工程。");
    }
    await this.comparison.load();
  }
  private updateComparison() {
    const host=this.root?.isConnected?this.root.querySelector<HTMLElement>("#wb-comparison"):null;
    if(!host)return;
    const left=host.querySelector(".sim-controls")?.scrollTop??0,right=host.querySelector(".sim-results")?.scrollTop??0,open=host.querySelector("details")?.open??false;
    host.innerHTML=this.comparison.render(this.project.setup,this.project.source);
    const controls=host.querySelector(".sim-controls"),results=host.querySelector(".sim-results"),details=host.querySelector("details");
    if(controls)controls.scrollTop=left;if(results)results.scrollTop=right;if(details)details.open=open;
  }
  attach(root: HTMLElement) {
    this.root = root;
    this.render();
    root.addEventListener("click", (e) => {
      const simulation=(e.target as Element).closest<HTMLElement>("[data-sim-action]");
      if(simulation){
        if(!(simulation instanceof HTMLButtonElement)||!simulation.disabled)this.comparison.action(simulation.dataset.simAction!,this.project.source,this.project.setup,simulation.dataset.id);
        return;
      }
      const el = (e.target as Element).closest<HTMLElement>("[data-wb]");
      if (!el || (el instanceof HTMLButtonElement && el.disabled)) return;
      this.click(el.dataset.wb!, el.dataset.id);
    });
    root.addEventListener("input", (e) => this.input(e));
    root.addEventListener("change", (e) => {
      if (
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLInputElement && e.target.type === "checkbox")
      )
        this.input(e);
    });
  }
  private config() {
    const r = validateProject(this.project);
    if (r.config) this.lastValid = r.config;
    return this.lastValid;
  }
  private name(id: string) {
    return id === "hero"
      ? "主角"
      : id === "princess"
        ? "公主"
        : (this.lastValid.Species.find((s) => s.Id === id)?.Name ?? id);
  }
  private async save() {
    const revision = ++this.revision,
      json = JSON.stringify(this.project);
    this.status = "正在保存草稿…";
    this.updateStatus();
    this.writes = this.writes
      .catch(() => {})
      .then(() => writeWorkbench("draft", json));
    try {
      await this.writes;
      if (revision === this.revision) {
        this.status = "草稿已保存到浏览器";
        this.updateStatus();
      }
    } catch {
      if (revision === this.revision) {
        this.status = "草稿保存失败，请导出";
        this.updateStatus();
      }
    }
  }
  private updateStatus() {
    if (!this.root) return;
    const result = validateProject(this.project);
    if (result.config) this.lastValid = result.config;
    const status = this.root.querySelector("#wb-save-status"),
      validation = this.root.querySelector("#wb-validation");
    if (status) status.textContent = this.status;
    const strict =
      result.warnings.length && this.project.setup.skillPolicy === "strict";
    if (validation)
      validation.innerHTML = result.errors.length
        ? `<b>配置有误，暂不能 Play</b><p>${result.errors.map(esc).join("<br>")}</p>`
        : strict
          ? `<b>所选关卡有未迁移功能</b><p>切换到“数值与已实现技能”可独立测试。</p>`
          : `<b>✓ 配置校验通过</b><span>42角色 · 30关 · ${result.warnings.length}项未迁移功能${result.warnings.length ? "将在测试中停用" : ""}</span>`;
    validation?.classList.toggle("invalid", !!result.errors.length || !!strict);
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-wb="play"]')
      .forEach((b) => (b.disabled = !!result.errors.length || !!strict));
    const preview = this.root.querySelector("#wb-preview");
    if (preview)
      preview.innerHTML = this.preview(
        result.errors.length ? null : result.config,
      );
  }
  private field(
    label: string,
    path: Path,
    fallback: unknown = 0,
    options: {
      percent?: boolean;
      min?: number;
      max?: number;
      step?: number;
      text?: boolean;
      select?: readonly (readonly [string, string])[];
      textarea?: boolean;
      optional?: boolean;
    } = {},
  ) {
    const raw = readPath(this.project.source, path),
      value = options.optional && (raw === undefined || raw === null) ? "" : raw === undefined ? fallback : raw,
      display =
        options.percent && typeof value === "number"
          ? Number((value * 100).toFixed(6))
          : value,
      id = "wb-" + path.join("-");
    const common = `aria-label="${esc(label)}${options.percent ? " %" : ""}" id="${esc(id)}" data-path="${esc(JSON.stringify(path))}" ${options.percent ? 'data-percent="1"' : ""}`;
    let control: string;
    if (options.select)
      control = `<select ${common}>${options.select.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    else if (options.textarea)
      control = `<textarea ${common}>${esc(display)}</textarea>`;
    else
      control = `<input ${common} type="${options.text ? "text" : "number"}" value="${esc(display)}" ${options.optional?`placeholder="默认 ${esc(Number((Number(fallback)*(options.percent?100:1)).toFixed(6)))}${options.percent?"%":""}"`:""} ${options.text ? "" : `min="${options.min ?? 0}" max="${options.max ?? 1000000}" step="${options.step ?? 1}" inputmode="decimal"`}>`;
    return `<label class="wb-field" for="${esc(id)}"><span>${esc(label)}${options.percent ? " %" : ""}</span>${control}</label>`;
  }
  private setting(
    label: string,
    key: keyof PlaytestSetup,
    options?: {
      select?: readonly (readonly [string, string])[];
      min?: number;
      max?: number;
    },
  ) {
    const value = this.project.setup[key];
    if (typeof value === "boolean")
      return `<label class="wb-check"><input type="checkbox" data-setting="${key}" ${value ? "checked" : ""}>${esc(label)}</label>`;
    if (options?.select)
      return `<label class="wb-field"><span>${label}</span><select aria-label="${esc(label)}" data-setting="${key}">${options.select.map(([v, l]) => `<option value="${esc(v)}" ${v === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    return `<label class="wb-field"><span>${label}</span><input aria-label="${esc(label)}" type="number" data-setting="${key}" value="${esc(value)}" min="${options?.min ?? 1}" max="${options?.max ?? 30}" step="1"></label>`;
  }
  private list() {
    const c = this.config();
    if (this.tab === "floors")
      return c.Floors.map((f) => {
        const ei = c.Encounters.findIndex((e) => e.Id === f.Encounter),
          e = editableEncounter(this.project.source, c, ei);
        return `<button data-wb="floor" data-id="${f.Number}" class="wb-entity ${f.Number === this.project.setup.floor ? "active" : ""}"><strong>${String(f.Number).padStart(2, "0")}</strong><span>${esc(e.Title)}<small>${e.Boss ? "Boss · " : ""}${e.Enemies.reduce((s, v) => s + v.Count, 0)}名敌人</small></span></button>`;
      }).join("");
    if (this.tab === "skills") return `<button data-wb="skill" data-id="effects" class="wb-entity ${this.action==="effects"?"active":""}"><span><strong>效果与被动</strong><small>减疗 · 反伤 · 急速 · 护盾</small></span></button>`+this.skillOptions().map(([id]) => `<button data-wb="skill" data-id="${esc(id)}" class="wb-entity ${id===this.action?"active":""}"><span><strong>${esc(skillLabel(id))}</strong><small>${esc(id)} · ${supportedSkills.has(id)?"已实现，可 Play":"待迁移，测试中停用"}</small></span></button>`).join("");
    return ["hero", "princess", ...c.Species.map((s) => s.Id)]
      .filter((id) => `${this.name(id)} ${id}`.includes(this.query))
      .map(
        (id) =>
          `<button data-wb="character" data-id="${esc(id)}" class="wb-entity ${id === this.character ? "active" : ""}"><span class="wb-avatar" style="background-image:url('${import.meta.env.BASE_URL}assets/${encodeURIComponent(id)}.png')">${["hero", "princess"].includes(id) ? "" : ""}</span><span>${esc(this.name(id))}<small>${["hero", "princess"].includes(id) ? "人类" : c.Rules.Species[id]!.PrimaryRole}</small></span></button>`,
      )
      .join("");
  }
  private characters() {
    const c = this.config(),
      d = c.Rules.Combatants[this.character]!,
      p = c.Rules.Profiles[this.character]!,
      sp = c.Rules.Species[this.character];
    const prefix = this.statTab === "Base" ? "基础" : "成长";
    return `<div class="wb-section-title"><div><p class="eyebrow">CHARACTER INSPECTOR · ${esc(this.character)}</p><h2>${esc(this.name(this.character))}</h2></div><button data-wb="reset-character">恢复此角色基线</button></div><div class="wb-stat-tabs"><button data-wb="base" class="${this.statTab === "Base" ? "active" : ""}">基础属性</button><button data-wb="growth" class="${this.statTab === "Growth" ? "active" : ""}">每级成长</button></div><p class="wb-help">百分比用0—100填写。最终属性受等级、装备和属性上限影响；右侧预览由核心计算。</p><div class="wb-fields">${Object.entries(
      attrs,
    )
      .map(([key, label]) =>
        this.field(
          `${prefix} · ${label}`,
          ["Rules", "Combatants", this.character, this.statTab, key],
          d[this.statTab][key as keyof Attributes],
          {
            percent: percentages.has(key),
            max: percentages.has(key) ? 100 : 1000000,
            step: percentages.has(key) ? 0.1 : 1,
          },
        ),
      )
      .join(
        "",
      )}</div><h3 class="wb-section-label">行动与空间</h3><div class="wb-fields">${this.field("定位", ["Rules", "Profiles", this.character, "Role"], p.Role, { select: roles })}${this.field(
      "普攻伤害类型",
      ["Rules", "Combatants", this.character, "BasicDamageType"],
      d.BasicDamageType,
      {
        select: [
          ["physical", "物理（使用攻击值）"],
          ["magical", "法术（使用法术值）"],
        ],
      },
    )}${this.field("普攻弹道", ["Rules", "Combatants", this.character, "ProjectileFamily"], d.ProjectileFamily, { select: [...new Set(["", ...Object.values(c.Rules.Combatants).map((d) => d.ProjectileFamily)])].map((v) => [v, v || "瞬时命中（无弹道）"]) })}${this.field("普攻间隔（秒）", ["Rules", "Profiles", this.character, "Interval"], p.Interval, { min: 0.4, max: 5, step: 0.05 })}${this.field("自动技能冷却（秒）", ["Rules", "Profiles", this.character, "Cooldown"], p.Cooldown, { min: 1, max: 30, step: 0.1 })}${this.field("普攻前摇比例", ["Rules", "Combatants", this.character, "WindupRatio"], d.WindupRatio, { min: 0.1, max: 0.8, step: 0.01 })}${this.field("碰撞半径", ["Rules", "Combatants", this.character, "Radius"], d.Radius ?? sp?.Radius ?? 0.4, { min: 0.05, max: 3, step: 0.05 })}${this.field("攻击射程", ["Rules", "Combatants", this.character, "AttackRange"], d.AttackRange ?? sp?.AttackRange ?? (["ranged", "healer"].includes(p.Role) ? 3.8 : 0.55), { min: 0.1, max: 10, step: 0.05 })}${this.field("移动速度", ["Rules", "Combatants", this.character, "MoveSpeed"], d.MoveSpeed ?? sp?.MoveSpeed ?? 3.8, { min: 0.1, max: 20, step: 0.1 })}</div><h3 class="wb-section-label">技能配置</h3><p class="wb-help">初始武器可能覆盖人类自动技能。未迁移技能可配置，但数值测试会停用并列明。</p><div class="wb-fields">${this.field("自动技能", ["Rules", "Profiles", this.character, "Auto"], p.Auto, { select: [["", "不使用自动技能"], ...this.skillOptions()] })}${this.field("手动大招", ["Rules", "Profiles", this.character, "Ultimate"], p.Ultimate, { select: this.skillOptions() })}</div>`;
  }
  private skillOptions() {
    return Object.keys(this.config().Rules.Actions).map(
      (id) =>
        [
          id,
          `${skillLabel(id)} · ${id}${supportedSkills.has(id) ? " · 已实现" : " · 待迁移"}`,
        ] as const,
    );
  }
  private effects() {
    return `<div class="wb-section-title"><div><p class="eyebrow">SHARED EFFECTS</p><h2>共用效果与被动</h2></div><button data-wb="reset-effects">恢复共用效果默认</button></div><p class="wb-effect-scope">共用参数影响双方全部使用者。留空沿用默认；0的含义见各项说明。改动只应用到新Play和批测快照。</p>${["状态","被动","护盾","装备"].map(group=>`<h3 class="wb-section-label">${group} · 双方共用</h3><div class="wb-effect-fields">${Object.entries(effectDefinitions).filter(([,d])=>d.group===group).map(([key,d])=>`<article>${this.field(d.label,["Rules","Effects",key],d.default,{optional:true,percent:d.percent,min:d.min*(d.percent?100:1),max:d.max*(d.percent?100:1),step:d.percent?.1:.05})}<p>${esc(d.help)}</p><button data-wb="clear-effect" data-id="${key}">沿用默认</button></article>`).join("")}</div>`).join("")}<button class="wb-compact-reset" data-wb="reset-effects">恢复共用效果默认</button>`;
  }
  private skills() {
    if(this.action==="effects")return this.effects();
    const r=this.config().Rules.Actions[this.action]!, path:Path=["Rules","Actions",this.action];
    const scalar=(key:string,label:string,options:{min?:number;max?:number;step?:number}={})=>this.field(label,[...path,key],r[key as keyof typeof r]??"",options);
    return `<div class="wb-section-title"><div><p class="eyebrow">SKILL INSPECTOR</p><h2>${esc(this.action)}</h2></div><button data-wb="reset-skill">恢复技能基线</button></div><p class="wb-help">同一技能的修改影响所有使用者。自动技能冷却在“角色”页设置。${supportedSkills.has(this.action)?"此技能已接入战斗核心。":"此技能尚未迁移；可以保存参数，Play 会按测试设置阻止或停用该技能。"}</p><h3 class="wb-section-label">动作时间轴</h3><div class="wb-fields">${scalar("Windup","技能前摇（秒）",{max:2,step:.05})}${scalar("Backswing","技能后摇（秒）",{max:3,step:.05})}${scalar("ProjectileSpeed","弹道速度",{min:1,max:100,step:1})}${scalar("Lifetime","弹道存活（秒）",{min:.05,max:4,step:.05})}${this.field("大招可被打断",[...path,"Interruptible"],String(r.Interruptible),{select:[["true","允许打断"],["false","不可打断"]]})}</div>${r.DamageType!=="buff"?`<h3 class="wb-section-label">${r.DamageType==="heal"?"治疗":"伤害"}系数 <small>属性 × 倍率 ＋ 固定值</small></h3><p class="wb-help">使用${r.ScalingStat==="mag"?"法术":"攻击"}属性。暴击、防御、护盾与被动在核心继续结算。</p><div class="wb-fields">${[0,1,2].map(i=>this.field(`Lv.${i+1} 倍率`,[...path,"Ratios",i],r.Ratios[Math.min(i,r.Ratios.length-1)]??1,{max:20,step:.05})+this.field(`Lv.${i+1} 固定值`,[...path,"Bases",i],r.Bases[Math.min(i,r.Bases.length-1)]??0,{max:1000000})).join("")}</div>`:""}<h3 class="wb-section-label">射程与效果覆盖</h3><p class="wb-help">留空沿用原技能规则。射程控制选取和执行距离；范围半径作用于涌潮、碎甲冲、火雨和寒潮；持续时间作用于本技能附加的控制、减伤、追击或持续恢复。瞬时伤害没有持续时间。</p><div class="wb-fields">${scalar("Range","技能射程覆盖",{max:30,step:.1})}${scalar("Radius","范围半径覆盖",{max:30,step:.1})}${scalar("Duration","效果持续（秒）覆盖",{max:30,step:.1})}</div>${hasDotRatio(this.action)?`<h3 class="wb-section-label">持续伤害</h3><p class="wb-help">每秒按施法时${r.ScalingStat==="mag"?"法术":"攻击"}属性计算；默认${this.action==="poison"?"1/6":"1/8"}，取整后最低1。填0不附加持续伤害；直接伤害仍使用上方倍率。毒刺与毒雾的治疗抑制比例在共用效果下设置。</p><div class="wb-fields">${this.field("持续伤害属性比例",[...path,"DotRatio"],dotDefaults[this.action],{optional:true,percent:true,min:0,max:500,step:.1})}</div>`:""}${hasShieldRatio(this.action)?`<h3 class="wb-section-label">数值护盾倍率</h3><p class="wb-help">使用${r.ScalingStat==="mag"?"法术":"攻击"}属性。每个技能等级分别设置；留空沿用本级默认，0不生成新护盾。取已有护盾与新护盾较大值，不叠加。</p><div class="wb-fields">${[0,1,2].map(i=>this.field(`Lv.${i+1} 护盾倍率`,[...path,"ShieldRatios",i],defaultShieldRatio(this.action as ShieldSkill,i+1),{optional:true,min:0,max:20,step:.05})).join("")}</div>`:""}<button data-wb="skill" data-id="effects">编辑共用效果与被动</button><button class="wb-compact-reset" data-wb="reset-skill">恢复技能基线</button>`;
  }
  private floors() {
    const c = this.config(),
      f = c.Floors[this.project.setup.floor - 1]!,
      ei = c.Encounters.findIndex((e) => e.Id === f.Encounter),
      e = editableEncounter(this.project.source, c, ei);
    const rawGear = readPath(this.project.source, [
      "Floors",
      f.Number - 1,
      "Equipment",
    ]);
    const rewardGear = Array.isArray(rawGear)
      ? rawGear.filter((v): v is string => typeof v === "string")
      : f.Equipment;
    this.group = Math.min(this.group, e.Enemies.length - 1);
    const g = e.Enemies[this.group]!,
      path: Path = ["Encounters", ei, "Enemies", this.group];
    return `<div class="wb-section-title"><div><p class="eyebrow">LEVEL INSPECTOR · ${e.Id}</p><h2>第${f.Number}关${e.Boss ? " · Boss" : ""}</h2></div><button data-wb="reset-floor">恢复本关基线</button></div><div class="wb-fields">${this.field("关卡名称", ["Encounters", ei, "Title"], e.Title, { text: true })}${this.field("主题", ["Floors", f.Number - 1, "Theme"], f.Theme, { text: true })}${this.field(
      "战场背景",
      ["Encounters", ei, "Background"],
      e.Background,
      {
        select: [
          ["forest", "林地"],
          ["coast", "海岸"],
          ["dragon", "龙境"],
          ["castle", "城堡"],
        ],
      },
    )}${this.field("通关金币", ["Encounters", ei, "Gold"], e.Gold, { min: 1, max: 10000 })}</div>${this.field("关卡提示", ["Encounters", ei, "Hint"], e.Hint, { textarea: true })}<h3 class="wb-section-label">敌方编组 <small>最多16名敌人 · 5首发，其余按票增援</small></h3><div class="wb-enemy-tabs">${e.Enemies.map((v, i) => `<button data-wb="group" data-id="${i}" class="${i === this.group ? "active" : ""}">${esc(this.name(v.Species))} ×${v.Count}</button>`).join("")}<button data-wb="add-enemy">＋ 增加敌组</button></div><div class="wb-fields">${this.field("敌人物种", [...path, "Species"], g.Species, { select: c.Species.map((s) => [s.Id, s.Name]) })}${this.field("敌人数量", [...path, "Count"], g.Count, { min: 1, max: 12 })}${this.field("敌人等级", [...path, "Level"], g.Level, { min: 1, max: 30 })}${this.field("敌人阶数", [...path, "Rank"], g.Rank, { min: 1, max: 5 })}${this.field("生命倍率", [...path, "Health"], g.Health, { min: 0.01, max: 30, step: 0.01 })}${this.field("攻击／法术倍率", [...path, "AttackScale"], g.AttackScale, { min: 0.01, max: 30, step: 0.01 })}${this.field("防御倍率", [...path, "DefenseScale"], g.DefenseScale, { min: 0, max: 30, step: 0.01 })}</div><div class="wb-row">${readPath(this.project.source, [...path, "ProfileOverride"]) ? `<button data-wb="clear-override">清除本敌组技能覆盖</button>` : ""}<button data-wb="remove-enemy" ${e.Enemies.length <= 1 ? "disabled" : ""}>删除当前敌组</button><span>修改敌组只作用于本关；角色属性会影响该物种的所有出场。</span></div><h3 class="wb-section-label">每名敌人的奖励 <small>仅保存配置，独立测试不发放奖励</small></h3><div class="wb-fields">${this.field("人类战斗经验", [...path, "Experience"], g.Experience, { max: 100000 })}${this.field("魂魄数量", [...path, "Souls"], g.Souls, { min: 1, max: 12 })}${this.field("小经验药水", [...path, "Potions"], g.Potions, { max: 100000 })}${this.field("中经验药水", [...path, "PotionsM"], g.PotionsM, { max: 100000 })}${this.field("大经验药水", [...path, "PotionsL"], g.PotionsL, { max: 100000 })}</div><details class="wb-reward-options"><summary>关卡装备奖励（${rewardGear.length}件）</summary>${c.Rules.Equipment.map((g) => `<label class="wb-check"><input type="checkbox" data-reward="${esc(g.Id)}" ${rewardGear.includes(g.Id) ? "checked" : ""}>${esc(g.Name)} <small>${esc(g.Id)}</small></label>`).join("")}</details>`;
  }
  private setup() {
    const c = this.config();
    return `<div class="wb-section-title"><div><p class="eyebrow">PLAYTEST SETUP</p><h2>测试阵容与初始状态</h2></div></div><p class="wb-help">这些设置只用于独立测试，测试胜负不推进正式楼层、不领取奖励。</p><div class="wb-fields">${this.setting("测试关卡", "floor", { min: 1, max: 30 })}${this.setting("固定随机种子", "seed", { min: 1, max: 4294967295 })}${this.setting("我方等级", "level", { min: 1, max: 30 })}${this.setting("怪兽阶数", "rank", { min: 1, max: 5 })}${this.setting("起始生命 %", "hpPercent", { min: 1, max: 100 })}${this.setting("起始能量", "energy", { min: 0, max: 1000 })}${this.setting(
      "技能测试模式",
      "skillPolicy",
      {
        select: [
          ["supported-only", "数值与已实现技能"],
          ["strict", "完整执行（须全部已迁移）"],
        ],
      },
    )}</div>${this.setting("装备初始武器（主角攻击+6，公主攻击+6／法术+8）", "startingGear")}<h3 class="wb-section-label">我方伙伴 <small>最多10名 · 人类优先，其余按列表顺序补足5首发</small></h3><div class="wb-party">${this.project.setup.party.map((id, i) => `<div><strong>${i < 5 ? "首发" : "候补"} ${i + 1}</strong><select data-party="${i}" aria-label="我方伙伴${i + 1}">${["hero", "princess", ...c.Species.map((s) => s.Id)].map((v) => `<option value="${esc(v)}" ${id === v ? "selected" : ""}>${esc(this.name(v))}</option>`).join("")}</select><button data-wb="remove-party" data-id="${i}" ${this.project.setup.party.length <= 1 ? "disabled" : ""}>移除</button></div>`).join("")}</div><button data-wb="add-party" ${this.project.setup.party.length >= 10 ? "disabled" : ""}>＋ 添加伙伴</button><div class="wb-notice">未迁移的大招、自动技能和三阶被动不会被替换成其它技能；数值模式会明确停用。Play始终创建新测试，旧测试配置保持冻结。</div>`;
  }
  private preview(c: Config | null) {
    if (!c) return "<p>修正配置错误后显示核心预览。</p>";
    if (this.tab === "skills" && this.action==="effects") {
      const values=resolveEffects(c.Rules.Effects);
      return `<p class="eyebrow">EFFECT PREVIEW</p><h3>当前生效数值</h3><p class="wb-help">共用效果；空白输入使用核心默认值。</p><dl>${Object.entries(effectDefinitions).map(([key,d])=>`<div><dt>${d.label}</dt><dd>${Number((values[key as EffectKey]*(d.percent?100:1)).toFixed(4))}${d.percent?"%":""}</dd></div>`).join("")}</dl>`;
    }
    if (this.tab === "skills") {
      const r=c.Rules.Actions[this.action]!;
      const users=Object.entries(c.Rules.Profiles).filter(([,p])=>p.Auto===this.action||p.Ultimate===this.action).map(([id])=>this.name(id));
      return `<p class="eyebrow">SKILL PREVIEW</p><h3>${esc(this.action)}</h3><p>${r.DamageType==="heal"?"治疗":r.DamageType==="buff"?"增益":r.DamageType==="magical"?"法术伤害":"物理伤害"} · ${r.Delivery==="projectile"?"投射物":"瞬时执行"}</p><p>前摇 ${r.Windup}s → 执行 → 后摇 ${r.Backswing}s</p><div class="wb-notice">使用角色：${users.map(esc).join("、")||"由装备或敌组覆盖使用"}</div><p class="wb-help">修改后点击 Play，创建独立测试。已运行的测试保留原配置。</p>`;
    }
    let title: string, a: Attributes;
    try {
      if (this.tab === "characters") {
        title = `${this.name(this.character)} · Lv.${this.project.setup.level}`;
        const gear =
          this.project.setup.startingGear &&
          ["hero", "princess"].includes(this.character)
            ? [this.character === "hero" ? "traveler_sword" : "healer_staff"]
            : [];
        a = combatantAttributes(
          c,
          this.character,
          this.project.setup.level,
          gear,
          ["hero","princess"].includes(this.character)?1:this.project.setup.rank,
        );
      } else {
        const e = c.Encounters.find(
          (e) => e.Id === c.Floors[this.project.setup.floor - 1]!.Encounter,
        )!;
        const g = e.Enemies[this.group] ?? e.Enemies[0]!;
        title = `敌方 ${this.name(g.Species)} · Lv.${g.Level}`;
        a = enemyAttributes(c, g);
      }
    } catch {
      return "<p>测试设置无效，预览暂停。</p>";
    }
    const warnings = validateProject(this.project).warnings;
    return `<p class="eyebrow">CORE PREVIEW</p><h3>${esc(title)}</h3><p class="wb-help">最终属性 · 含测试等级、倍率及已选装备 · 来自同一核心</p><dl>${Object.entries(
      attrs,
    )
      .map(
        ([k, label]) =>
          `<div><dt>${label}</dt><dd>${percentages.has(k) ? Number((a[k as keyof Attributes] * 100).toFixed(2)) + "%" : a[k as keyof Attributes]}</dd></div>`,
      )
      .join(
        "",
      )}</dl><div class="wb-notice">Play：第${this.project.setup.floor}关<br>我方 ${this.project.setup.party.map((id) => esc(this.name(id))).join("、")}<br>种子 ${this.project.setup.seed}</div>${warnings.length ? `<details open class="wb-warning"><summary>${warnings.length}项未迁移功能${this.project.setup.skillPolicy === "supported-only" ? "在测试中停用" : "阻止完整模式运行"}</summary><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>` : '<p class="wb-help">本次阵容与敌群所用技能已实现。</p>'}`;
  }
  render() {
    if (!this.root) return;
    this.root.innerHTML = `<section class="workbench"><div class="wb-toolbar"><div><strong>配置工作台</strong></div><div class="wb-actions"><button data-wb="save">保存草稿</button><button data-wb="export">导出工程</button><button data-wb="export-config">导出配表</button><button data-wb="import">导入</button><button data-wb="play" class="primary">▶ Play 第${this.project.setup.floor}关</button></div></div><div class="wb-tabs"><button data-wb="characters" class="${this.tab === "characters" ? "active" : ""}">角色 · 42</button><button data-wb="floors" class="${this.tab === "floors" ? "active" : ""}">关卡 · 30</button><button data-wb="skills" class="${this.tab === "skills" ? "active" : ""}">技能 · 73</button><button data-wb="setup" class="${this.tab === "setup" ? "active" : ""}">测试设置</button><button data-wb="analysis" class="${this.tab === "analysis" ? "active" : ""}">批量对比</button><button data-wb="reset-all" class="wb-reset">恢复全部基线</button></div><div id="wb-validation" class="wb-validation" role="status"></div><div class="wb-body ${this.tab === "analysis" ? "wb-analysis-body" : ""}">${this.tab === "analysis" ? `<div id="wb-comparison">${this.comparison.render(this.project.setup,this.project.source)}</div>` : `${this.tab === "setup" ? "" : `<aside class="wb-sidebar">${this.tab === "characters" ? `<label class="wb-search"><span>查找角色</span><input id="wb-search" placeholder="名称 / ID" value="${esc(this.query)}"></label>` : `<p class="wb-help">${this.tab==="skills"?"选择技能，修改参数后 Play 测试。":"点击关卡即可选择测试目标；不需要先通关。"}</p>`}<div id="wb-list">${this.list()}</div></aside>`}<div class="wb-inspector">${this.tab === "characters" ? this.characters() : this.tab === "floors" ? this.floors() : this.tab === "skills" ? this.skills() : this.setup()}${(this.tab === "characters" || this.tab === "floors") ? `<button class="wb-compact-reset" data-wb="${this.tab === "characters" ? "reset-character" : "reset-floor"}">${this.tab === "characters" ? "恢复此角色基线" : "恢复本关基线"}</button>` : ""}<button class="wb-compact-reset" data-wb="reset-all">恢复全部基线</button></div><aside id="wb-preview" class="wb-preview"></aside>`}</div><div class="wb-footer"><span id="wb-save-status">${this.status}</span> · 草稿仅保存在此浏览器；可导出／导入JSON。正式试跑与测试完全分开。</div></section>`;
    this.updateStatus();
  }
  private input(event: Event) {
    const el = event.target;
    if (
      !(
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      )
    )
      return;
    if (
      event.type === "input" &&
      (el instanceof HTMLSelectElement ||
        (el instanceof HTMLInputElement && el.type === "checkbox"))
    )
      return;
    if(el.dataset.sim){this.comparison.input(el as HTMLInputElement|HTMLSelectElement);return;}
    if (el.id === "wb-search") {
      this.query = el.value;
      const list = this.root?.querySelector("#wb-list");
      if (list) list.innerHTML = this.list();
      return;
    }
    try {
      if (el.dataset.path) {
        const path: unknown = JSON.parse(el.dataset.path);
        if (
          !Array.isArray(path) ||
          !path.every((v) => typeof v === "string" || typeof v === "number")
        )
          return;
        let value: unknown = el.value;
        if (el instanceof HTMLInputElement && el.type === "number")
          value =
            el.value === ""
              ? null
              : Number(el.value) / (el.dataset.percent ? 100 : 1);
        if(path[1]==="Effects") {
          if(readPath(this.project.source,["Rules","Effects"])===undefined)setPath(this.project.source,["Rules","Effects"],{});
          if(value===null)value=undefined;
        }
        if (path[1] === "Actions") {
          if (["Range","Radius","Duration","DotRatio"].includes(String(path.at(-1))) && value === null) value=undefined;
          if (path.at(-1) === "Interruptible") value=el.value === "true";
          if(path[3]==="ShieldRatios") {
            const current=readPath(this.project.source,path.slice(0,4));
            setPath(this.project.source,path.slice(0,4),[0,1,2].map(i=>Array.isArray(current)?current[i]??null:null));
          }
          if (path[3] === "Ratios" || path[3] === "Bases") {
            const r=this.lastValid.Rules.Actions[String(path[2])]!;
            const key=path[3]; const current=readPath(this.project.source,path.slice(0,4)); const values=[0,1,2].map(i=>Array.isArray(current)&&i<current.length?current[i]:r[key][Math.min(i,r[key].length-1)]??(key==="Ratios"?1:0));
            setPath(this.project.source,path.slice(0,4),values);
          }
        }
        setPath(this.project.source, path as Path, value);
        if(path[3]==="ShieldRatios") {
          const values=readPath(this.project.source,path.slice(0,4));
          if(Array.isArray(values)&&values.every(v=>v===null))setPath(this.project.source,path.slice(0,4),undefined);
        }
        if(path[1]==="Effects")this.pruneEffects();
      } else if (el.dataset.setting) {
        const key = el.dataset.setting as keyof PlaytestSetup;
        const value =
          el instanceof HTMLInputElement && el.type === "checkbox"
            ? el.checked
            : el instanceof HTMLInputElement
              ? Number(el.value)
              : el.value;
        Object.assign(this.project.setup, { [key]: value });
        if (key === "floor") this.group = 0;
        this.root
          ?.querySelectorAll('[data-wb="play"]')
          .forEach(
            (b) => (b.textContent = `▶ Play 第${this.project.setup.floor}关`),
          );
      } else if (el.dataset.party) {
        this.project.setup.party[Number(el.dataset.party)] = el.value;
      } else if (el.dataset.reward) {
        const path: Path = [
            "Floors",
            this.project.setup.floor - 1,
            "Equipment",
          ],
          current = readPath(this.project.source, path);
        if (!Array.isArray(current)) return;
        setPath(
          this.project.source,
          path,
          el instanceof HTMLInputElement && el.checked
            ? [...current, el.dataset.reward]
            : current.filter((v) => v !== el.dataset.reward),
        );
      } else return;
      this.updateStatus();
      void this.save();
    } catch (e) {
      this.notify(e instanceof Error ? e.message : "编辑失败");
    }
  }
  private download(source: unknown, file: string) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(source, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private pruneEffects() {
    const effects=readPath(this.project.source,["Rules","Effects"]);
    if(effects&&typeof effects==="object"&&Object.keys(effects).length===0)setPath(this.project.source,["Rules","Effects"],undefined);
  }
  private click(action: string, id?: string) {
    switch (action) {
      case "characters":
      case "floors":
      case "skills":
      case "setup":
      case "analysis":
        if (
          action === "floors" &&
          (!Number.isInteger(this.project.setup.floor) ||
            this.project.setup.floor < 1 ||
            this.project.setup.floor > 30)
        )
          this.project.setup.floor = 1;
        this.tab = action;
        this.render();
        return;
      case "skill":
        this.action=id!;this.render();return;
      case "clear-effect":
        if(id&&Object.hasOwn(effectDefinitions,id)&&readPath(this.project.source,["Rules","Effects"])!==undefined){setPath(this.project.source,["Rules","Effects",id],undefined);this.pruneEffects();this.render();void this.save();}return;
      case "reset-effects":
        setPath(this.project.source,["Rules","Effects"],undefined);this.render();void this.save();return;
      case "reset-skill":
        setPath(this.project.source,["Rules","Actions",this.action],readPath(this.baseline,["Rules","Actions",this.action]));this.render();void this.save();return;
      case "character":
        this.character = id!;
        this.render();
        return;
      case "floor":
        this.project.setup.floor = Number(id);
        this.group = 0;
        this.render();
        void this.save();
        return;
      case "base":
      case "growth":
        this.statTab = action === "base" ? "Base" : "Growth";
        this.render();
        return;
      case "group":
        this.group = Number(id);
        this.render();
        return;
      case "save":
        void this.save();
        return;
      case "export":
        this.download(this.project, "tower30-editor-project.json");
        return;
      case "export-config":
        this.download(this.project.source, "thirty-floor-trial-draft.json");
        return;
      case "import": {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          if (file.size > 2000000) {
            this.notify("配置文件不能超过2MB");
            return;
          }
          void file
            .text()
            .then((text) => {
              const project = importProject(text);
              this.project = project;
              this.character = "hero";
              this.group = 0;
              this.render();
              void this.save();
              this.notify("已导入草稿，点击 Play 测试。");
            })
            .catch((e) =>
              this.notify(
                "导入失败，原草稿未改变：" +
                  (e instanceof Error ? e.message : "格式错误"),
              ),
            );
        });
        input.click();
        return;
      }
      case "play": {
        const result = validateProject(this.project);
        if (!result.config || result.errors.length) {
          this.updateStatus();
          return;
        }
        try {
          TowerEngine.createPlaytest(result.config, this.project.setup);
          this.comparison.cancel();
          void this.save();
          this.onPlay(result.config, clone(this.project.setup));
        } catch (e) {
          this.notify(e instanceof Error ? e.message : "不能开始测试");
        }
        return;
      }
      case "reset-all":
        if (
          window.confirm("恢复全部基线？只替换工作台草稿，正式试跑不受影响。")
        ) {
          this.project = newProject(this.baseline);
          this.character = "hero";
          this.group = 0;
          this.render();
          void this.save();
        }
        return;
      case "reset-character":
        if (window.confirm("恢复此角色的基础属性、成长与行动设置？")) {
          for (const section of ["Combatants", "Profiles"])
            setPath(
              this.project.source,
              ["Rules", section, this.character],
              readPath(this.baseline, ["Rules", section, this.character]),
            );
          this.render();
          void this.save();
        }
        return;
      case "reset-floor": {
        if (!window.confirm("恢复当前关卡的敌组与奖励？")) return;
        const c = this.config(),
          floor = this.project.setup.floor,
          ei = c.Encounters.findIndex(
            (e) => e.Id === c.Floors[floor - 1]!.Encounter,
          );
        setPath(
          this.project.source,
          ["Encounters", ei],
          readPath(this.baseline, ["Encounters", ei]),
        );
        setPath(
          this.project.source,
          ["Floors", floor - 1],
          readPath(this.baseline, ["Floors", floor - 1]),
        );
        this.group = 0;
        this.render();
        void this.save();
        return;
      }
      case "add-party": {
        const next = [
          "hero",
          "princess",
          ...this.config().Species.map((s) => s.Id),
        ].find((id) => !this.project.setup.party.includes(id));
        if (next && this.project.setup.party.length < 10)
          this.project.setup.party.push(next);
        break;
      }
      case "remove-party":
        if (this.project.setup.party.length > 1)
          this.project.setup.party.splice(Number(id), 1);
        break;
      case "clear-override": {
        const c = this.config(),
          ei = c.Encounters.findIndex(
            (e) => e.Id === c.Floors[this.project.setup.floor - 1]!.Encounter,
          ),
          path: Path = ["Encounters", ei, "Enemies", this.group],
          raw = readPath(this.project.source, path);
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          const group = { ...raw };
          delete (group as Record<string, unknown>).ProfileOverride;
          setPath(this.project.source, path, group);
          this.render();
          void this.save();
        }
        return;
      }
      case "add-enemy":
      case "remove-enemy": {
        const c = this.config(),
          ei = c.Encounters.findIndex(
            (e) => e.Id === c.Floors[this.project.setup.floor - 1]!.Encounter,
          ),
          path: Path = ["Encounters", ei, "Enemies"],
          current = readPath(this.project.source, path);
        if (!Array.isArray(current)) return;
        const enemies = clone(current);
        if (action === "add-enemy") {
          enemies.push({
            Species: "slime_dusk",
            Count: 1,
            Level: 1,
            Rank: 1,
            Health: 1,
            AttackScale: 1,
            DefenseScale: 1,
            Souls: 1,
            Experience: 11,
            Potions: 0,
            PotionsM: 0,
            PotionsL: 0,
          });
          this.group = enemies.length - 1;
        } else if (enemies.length > 1) {
          enemies.splice(this.group, 1);
          this.group = Math.max(0, this.group - 1);
        }
        setPath(this.project.source, path, enemies);
        break;
      }
    }
    this.render();
    void this.save();
  }
}
