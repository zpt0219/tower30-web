import {inspectProject} from "../core/project";
import {defaultStrategy,orderedIds} from "../core/strategy";
import {renderStrategy} from "./strategy-editor";
import "./strategy.css";
import {effectDefinitions,resolveEffects,hasDotRatio,dotDefaults,hasShieldRatio,defaultShieldRatio,type EffectKey,type ShieldSkill} from "../core/effects";
import { skillLabel } from "../data/skill-labels";
import { spriteFileName } from "../data/sprite-files";
import { spriteUrl } from "../battle-view/renderer";
import { createMonster, dropSprite, renameSprite } from "./roster";
import { openMonsterDialog } from "./monster-dialog";
import { validateProjectSprites } from "./png";
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
import { buildZip, readZip, type ZipFileEntry } from "./zip";
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
const availableSprites: readonly (readonly [string, string])[] = [
  ["blade_skeleton", "持刃骷髅 (blade_skeleton)"],
  ["boar", "野猪 (boar)"],
  ["bronze_beetle", "铜甲虫 (bronze_beetle)"],
  ["bronze_dragon", "青铜龙 (bronze_dragon · 32px)"],
  ["cave_wolf", "岩洞狼 (cave_wolf)"],
  ["celestial_dragon", "天界龙 (celestial_dragon · 32px)"],
  ["crab", "石壳蟹 (crab)"],
  ["crystal_elemental", "水晶元素 (crystal_elemental)"],
  ["earth_elemental", "大地元素 (earth_elemental)"],
  ["ember_dragon", "烬火龙 (ember_dragon · 32px)"],
  ["evil_eye", "邪眼 (evil_eye)"],
  ["fire_imp", "火焰小鬼 (fire_imp)"],
  ["forest_dragon", "森之龙 (forest_dragon · 32px)"],
  ["forest_sprite", "林间精灵 (forest_sprite)"],
  ["frost_dragon", "霜翼龙 (frost_dragon · 32px)"],
  ["ice_spirit", "冰晶怪 (ice_spirit)"],
  ["iron_automaton", "钢铁魔像 (iron_automaton)"],
  ["lava_elemental", "熔岩元素 (lava_elemental)"],
  ["mantis", "巨螳螂 (mantis)"],
  ["mimic", "宝箱怪 (mimic)"],
  ["moonbat", "月翼蝠 (moonbat)"],
  ["moss_crawler", "苔背爬虫 (moss_crawler)"],
  ["mudguard", "石壳守卫 (mudguard)"],
  ["necromancer", "死灵术士 (necromancer)"],
  ["nightmare", "夜魇 (nightmare)"],
  ["nightwing", "夜翼蝠 (nightwing)"],
  ["orc_berserker", "狂兽人 (orc_berserker)"],
  ["reedwing", "风翅虫 (reedwing)"],
  ["silver_slime", "白银史莱姆 (silver_slime)"],
  ["skeleton_guard", "骷髅卫士 (skeleton_guard)"],
  ["slime_dusk", "史莱姆 (slime_dusk)"],
  ["spectral_armor", "幽灵铠甲 (spectral_armor)"],
  ["spectral_samurai", "武士亡魂 (spectral_samurai)"],
  ["sproutling", "蘑菇精 (sproutling)"],
  ["venom_dragonling", "剧毒幼龙 (venom_dragonling)"],
  ["war_dragon", "战阵巨龙 (war_dragon · 32px)"],
  ["water_elemental", "水元素 (water_elemental)"],
  ["white_ghost", "白幽灵 (white_ghost)"],
  ["wind_elemental", "风元素 (wind_elemental)"],
  ["wisp", "荧火 (wisp)"],
];
type Path = (string | number)[];
export class Workbench {
  private root: HTMLElement | null = null;
  project: EditorProject;
  private tab: "characters" | "floors" | "skills" | "setup" | "strategy" | "analysis" = "characters";
  private readonly comparison: Comparison;
  private character = "hero";
  private action = "swift";
  private query = "";
  private group = 0;
  private lastValid: Config;
  private status = "草稿自动保存到浏览器";
  private revision = 0;
  private writes = Promise.resolve();
  constructor(
    private readonly baseline: unknown,
    baseConfig: Config,
    private readonly onPlay: (config: Config, setup: PlaytestSetup, sprites?: Record<string,string>) => void,
    private readonly notify: (message: string) => void,
    private readonly onReview: (serialized:string) => void,
  ) {
    this.project = newProject(baseline);
    this.lastValid = baseConfig;
    this.comparison = new Comparison(baseConfig,focus=>this.updateComparison(focus),notify,(source,name)=>this.download(source,name),(config,setup)=>onPlay(config,setup,clone(this.project.sprites??{})),onReview);
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
  private updateComparison(focus?:string) {
    const host=this.root?.isConnected?this.root.querySelector<HTMLElement>("#wb-comparison"):null;
    if(!host)return;
    const left=host.querySelector(".sim-controls")?.scrollTop??0,right=host.querySelector(".sim-results")?.scrollTop??0;
    const open=[...host.querySelectorAll("details")].map(el=>el.open);
    const active=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const input=active?.dataset.sim,floor=active?.dataset.floor;
    host.innerHTML=this.comparison.render(this.project.setup,this.project.source);
    const controls=host.querySelector(".sim-controls"),results=host.querySelector(".sim-results");
    if(controls)controls.scrollTop=left;if(results)results.scrollTop=right;
    host.querySelectorAll("details").forEach((el,i)=>{el.open=open[i]??false;});
    if(focus==="detail"&&results){const detail=host.querySelector("#sim-floor-detail");if(detail)results.scrollTop+=detail.getBoundingClientRect().top-results.getBoundingClientRect().top;}
    if(input)host.querySelector<HTMLElement>(`[data-sim="${CSS.escape(input)}"]${floor?`[data-floor="${CSS.escape(floor)}"]`:""}`)?.focus({preventScroll:true});
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
    if (id === "hero") return "主角";
    if (id === "princess") return "公主";
    const speciesList = readPath(this.project.source, ["Species"]) as { Id: string; Name: string }[] | undefined;
    if (Array.isArray(speciesList)) {
      const match = speciesList.find((s) => s.Id === id);
      if (match?.Name) return match.Name;
    }
    return this.lastValid.Species.find((s) => s.Id === id)?.Name ?? id;
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
    const currentSpeciesCount = (
      (readPath(this.project.source, ["Species"]) as any[]) ??
      this.lastValid.Species
    ).length;
    const charTab = this.root.querySelector<HTMLButtonElement>('[data-wb="characters"]');
    if (charTab) {
      charTab.textContent = `角色 · ${currentSpeciesCount + 2}`;
    }
    const strict =
      result.warnings.length && this.project.setup.skillPolicy === "strict";
    if (validation)
      validation.innerHTML = result.errors.length
        ? `<b>配置有误，暂不能 Play</b><p>${result.errors.map(esc).join("<br>")}</p>`
        : this.tab==="analysis"
          ? `<b>✓ 草稿结构校验通过</b><span>运行前校验全部批测关卡；单关Play仍使用测试设置的当前关卡。</span>`
        : strict
          ? `<b>所选关卡有未迁移功能</b><p>切换到“数值与已实现技能”可独立测试。</p>`
          : `<b>✓ 配置校验通过</b><span>${currentSpeciesCount + 2}角色 · 30关 · ${result.warnings.length}项未迁移功能${result.warnings.length ? "将在测试中停用" : ""}</span>`;
    validation?.classList.toggle("invalid", !!result.errors.length || (this.tab!=="analysis" && !!strict));
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-wb="play"],[data-wb="export-godot"]')
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
      value = options.optional && (raw === undefined || raw === null) ? "" : raw === undefined ? fallback : path[0] === "Species" && path[2] === "Sprite" && typeof raw === "string" ? spriteFileName(raw) : raw,
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
    const speciesList =
      (readPath(this.project.source, ["Species"]) as any[]) ?? c.Species;
    return ["hero", "princess", ...speciesList.map((s) => s.Id)]
      .filter((id) => {
        const t = ["hero", "princess"].includes(id)
          ? "主角 人类"
          : ((readPath(this.project.source, ["Rules", "Species", id, "Tier"]) as string) ??
             c.Rules.Species[id]?.Tier ??
             "普通");
        return `${this.name(id)} ${id} ${t}`.includes(this.query);
      })
      .map((id) => {
        const sp = speciesList.find((s) => s.Id === id);
        const spriteFile =
          sp?.Sprite && availableSprites.some(([k]) => k === spriteFileName(sp.Sprite))
            ? spriteFileName(sp.Sprite)
            : availableSprites.some(([k]) => k === id)
              ? id
              : id === "hero" || id === "princess"
                ? id
                : "slime_dusk";
        const isLarge = sp?.FrameSize === 32;
        const role = ["hero", "princess"].includes(id)
          ? "人类"
          : (readPath(this.project.source, [
              "Rules",
              "Species",
              id,
              "PrimaryRole",
            ]) as string) ??
            c.Rules.Species[id]?.PrimaryRole ??
            "怪兽";
        const tier = ["hero", "princess"].includes(id)
          ? "人类"
          : ((readPath(this.project.source, ["Rules", "Species", id, "Tier"]) as string) ??
             c.Rules.Species[id]?.Tier ??
             "普通");
        const tierClass = tier === "传说" ? "legendary" : tier === "精英" ? "elite" : tier === "人类" ? "hero" : "normal";
        const source = this.project.sprites?.[sp?.Sprite] ?? spriteFile;
        return `<button data-wb="character" data-id="${esc(id)}" class="wb-entity ${id === this.character ? "active" : ""}"><span class="wb-avatar ${isLarge ? "wb-avatar-32" : ""} ${sp?.SpriteLayout === "single" ? "wb-avatar-single" : ""}" style="background-image:url('${esc(spriteUrl(source))}')"></span><span class="wb-entity-col"><span class="wb-entity-name-row"><strong class="wb-entity-title">${esc(this.name(id))}</strong><span class="wb-tier-badge wb-tier-${tierClass}">${esc(tier)}</span></span><small>${esc(role)}</small></span></button>`;
      })
      .join("");
  }
  private characters() {
    const c = this.config(),
      d = (readPath(this.project.source, ["Rules", "Combatants", this.character]) as any) ?? c.Rules.Combatants[this.character]!,
      p = (readPath(this.project.source, ["Rules", "Profiles", this.character]) as any) ?? c.Rules.Profiles[this.character]!,
      sp = (readPath(this.project.source, ["Rules", "Species", this.character]) as any) ?? c.Rules.Species[this.character],
      speciesList = (readPath(this.project.source, ["Species"]) as any[]) ?? c.Species,
      si = speciesList.findIndex((s) => s.Id === this.character);
    const tier = ["hero", "princess"].includes(this.character)
      ? "人类"
      : ((readPath(this.project.source, ["Rules", "Species", this.character, "Tier"]) as string) ??
         sp?.Tier ??
         "普通");
    const tierClass = tier === "传说" ? "legendary" : tier === "精英" ? "elite" : tier === "人类" ? "hero" : "normal";

    const identity =
      sp && si >= 0
        ? `<h3 class="wb-section-label">名称、品阶、外观与功能介绍 <small>校正怪物识别名称、稀有品阶、外观贴图与功能定位，供 AI 与数值平衡参考</small></h3><div class="wb-fields">${this.field("怪物名称", ["Species", si, "Name"], speciesList[si]!.Name, { text: true })}${this.field("品阶稀有度", ["Rules", "Species", this.character, "Tier"], sp.Tier ?? "普通", { select: [["普通", "普通 (Normal)"], ["精英", "精英 (Elite)"], ["传说", "传说 (Legendary)"]] })}${this.field("主职责标签", ["Rules", "Species", this.character, "PrimaryRole"], sp.PrimaryRole, { text: true })}${this.field("外观贴图", ["Species", si, "Sprite"], speciesList[si]!.Sprite && availableSprites.some(([k]) => k === speciesList[si]!.Sprite) ? speciesList[si]!.Sprite : (availableSprites.some(([k]) => k === this.character) ? this.character : "slime_dusk"), { select: [...availableSprites, ...Object.keys(this.project.sprites??{}).map(id=>[id,`上传PNG · ${this.name(id)}`] as const)] })}${this.field("贴图切片规格", ["Species", si, "FrameSize"], speciesList[si]!.FrameSize ?? 16, { select: [["16", "16×16 (标准怪物)"], ["32", "32×32 (大型巨龙)"], ["64", "64×64 (超大)"]] })}${this.field("贴图显示方式", ["Species", si, "SpriteLayout"], speciesList[si]!.SpriteLayout ?? "sheet", { select: [["sheet","3列×4行行走图"],["single","单张角色图"]] })}</div>${this.field("怪物介绍与功能定位", ["Rules", "Species", this.character, "Specialty"], sp.Specialty, { textarea: true })}`
        : "";

    const attrCards = Object.entries(attrs)
      .map(([key, label]) => {
        const isPercent = percentages.has(key);
        const max = isPercent ? 100 : 1000000;
        const step = isPercent ? 0.1 : 1;
        const baseVal =
          (readPath(this.project.source, ["Rules", "Combatants", this.character, "Base", key]) as number | undefined) ??
          d.Base[key as keyof Attributes];
        const growthVal =
          (readPath(this.project.source, ["Rules", "Combatants", this.character, "Growth", key]) as number | undefined) ??
          d.Growth[key as keyof Attributes];
        const baseDisplay =
          isPercent && typeof baseVal === "number"
            ? Number((baseVal * 100).toFixed(6))
            : baseVal;
        const growthDisplay =
          isPercent && typeof growthVal === "number"
            ? Number((growthVal * 100).toFixed(6))
            : growthVal;
        return `<div class="wb-attr-card"><div class="wb-attr-card-header"><span class="wb-attr-name">${esc(label)}</span>${isPercent ? '<span class="wb-attr-unit">% 百分比</span>' : ""}</div><div class="wb-attr-inputs"><label class="wb-attr-input-group"><span class="wb-attr-tag">基础</span><input id="wb-Rules-Combatants-${esc(this.character)}-Base-${key}" aria-label="基础 · ${esc(label)}${isPercent ? " %" : ""}" data-path="${esc(JSON.stringify(["Rules", "Combatants", this.character, "Base", key]))}" ${isPercent ? 'data-percent="1"' : ""} type="number" value="${esc(baseDisplay)}" min="0" max="${max}" step="${step}" inputmode="decimal"></label><label class="wb-attr-input-group"><span class="wb-attr-tag">每级成长</span><input id="wb-Rules-Combatants-${esc(this.character)}-Growth-${key}" aria-label="成长 · ${esc(label)}${isPercent ? " %" : ""}" data-path="${esc(JSON.stringify(["Rules", "Combatants", this.character, "Growth", key]))}" ${isPercent ? 'data-percent="1"' : ""} type="number" value="${esc(growthDisplay)}" min="0" max="${max}" step="${step}" inputmode="decimal"></label></div></div>`;
      })
      .join("");

    return `<div class="wb-section-title"><div><p class="eyebrow">CHARACTER INSPECTOR · ${esc(this.character)}${sp ? ` <button data-wb="rename-character" class="wb-subtle-btn">修改 ID</button>` : ""}</p><div class="wb-title-row"><h2>${esc(this.name(this.character))}</h2>${sp ? `<span class="wb-tier-badge wb-tier-${tierClass} wb-tier-lg">${esc(tier)}</span>` : ""}</div></div><div class="wb-title-actions">${sp ? `<button data-wb="delete-character" class="wb-danger-btn">删除此怪兽</button>` : ""}<button data-wb="reset-character">恢复此角色基线</button></div></div>${identity}<h3 class="wb-section-label">基础属性与每级成长 <small>左侧设定1级基础数值，右侧设定每级成长；右侧实时计算当前测试等级最终属性</small></h3><p class="wb-help">百分比用0—100填写。最终属性受等级、装备和属性上限影响；右侧预览由核心计算。</p><div class="wb-attr-grid">${attrCards}</div><h3 class="wb-section-label">行动与空间</h3><div class="wb-fields">${this.field("定位", ["Rules", "Profiles", this.character, "Role"], p.Role, { select: roles })}${this.field(
      "普攻伤害类型",
      ["Rules", "Combatants", this.character, "BasicDamageType"],
      d.BasicDamageType,
      {
        select: [
          ["physical", "物理（使用攻击值）"],
          ["magical", "法术（使用法术值）"],
        ],
      },
    )}${this.field("普攻弹道", ["Rules", "Combatants", this.character, "ProjectileFamily"], d.ProjectileFamily, { select: [...new Set(["", ...Object.values(c.Rules.Combatants).map((d) => d.ProjectileFamily)])].map((v) => [v, v || "瞬时命中（无弹道）"]) })}${this.field("普攻间隔（秒）", ["Rules", "Profiles", this.character, "Interval"], p.Interval, { min: 0.4, max: 5, step: 0.05 })}${this.field("自动技能冷却（秒）", ["Rules", "Profiles", this.character, "Cooldown"], p.Cooldown, { min: 1, max: 30, step: 0.1 })}${this.field("普攻前摇比例", ["Rules", "Combatants", this.character, "WindupRatio"], d.WindupRatio, { min: 0.1, max: 0.8, step: 0.01 })}${this.field("碰撞半径", ["Rules", "Combatants", this.character, "Radius"], d.Radius ?? sp?.Radius ?? 0.4, { min: 0.05, max: 3, step: 0.05 })}${this.field("攻击射程", ["Rules", "Combatants", this.character, "AttackRange"], d.AttackRange ?? sp?.AttackRange ?? (["ranged", "healer"].includes(p.Role) ? 3.8 : 0.55), { min: 0.1, max: 10, step: 0.05 })}${this.field("移动速度", ["Rules", "Combatants", this.character, "MoveSpeed"], d.MoveSpeed ?? sp?.MoveSpeed ?? 3.8, { min: 0.1, max: 20, step: 0.1 })}</div><h3 class="wb-section-label">技能配置</h3><p class="wb-help">初始武器可能覆盖人类自动技能。未迁移技能可配置，但数值测试会停用并列明。</p><div class="wb-fields">${this.field("自动技能", ["Rules", "Profiles", this.character, "Auto"], p.Auto, { select: [["", "不使用自动技能"], ...this.skillOptions()] })}${this.field("手动大招", ["Rules", "Profiles", this.character, "Ultimate"], p.Ultimate, { select: this.skillOptions() })}${this.field("自动技能介绍", ["Rules", "Profiles", this.character, "AutoDescription"], p.AutoDescription, { text: true })}${this.field("手动大招介绍", ["Rules", "Profiles", this.character, "UltimateDescription"], p.UltimateDescription, { text: true })}${this.field("被动名称／介绍", ["Rules", "Profiles", this.character, "PassiveDescription"], p.PassiveDescription, { text: true })}</div>`;
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
    return `<p class="eyebrow">CORE PREVIEW</p><h3>${esc(title)}</h3>${
      this.tab === "characters" && c.Rules.Species[this.character]
        ? `<p class="wb-help">${esc(c.Rules.Species[this.character]!.PrimaryRole)}${c.Rules.Species[this.character]!.Specialty ? ` · ${esc(c.Rules.Species[this.character]!.Specialty)}` : ""}</p>`
        : ""
    }<p class="wb-help">最终属性 · 含测试等级、倍率及已选装备 · 来自同一核心</p><dl>${Object.entries(
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
    const currentSpeciesCount = (
      (readPath(this.project.source, ["Species"]) as any[]) ??
      this.config().Species
    ).length;
    this.root.innerHTML = `<section class="workbench"><div class="wb-toolbar"><div><strong>配置工作台</strong></div><div class="wb-actions"><button data-wb="save">保存草稿</button><button data-wb="export-zip" class="primary-zip">导出工程 (ZIP)</button><button data-wb="import">导入</button>${this.tab !== "strategy" ? '<button data-wb="export-godot">导出Godot试跑</button>' : ""}${this.tab !== "strategy" ? `<button data-wb="import-record">导入测试记录</button><button data-wb="play" class="primary">▶ Play 第${this.project.setup.floor}关</button>` : ""}</div></div><div class="wb-tabs"><button data-wb="characters" class="${this.tab === "characters" ? "active" : ""}">角色 · ${currentSpeciesCount + 2}</button><button data-wb="floors" class="${this.tab === "floors" ? "active" : ""}">关卡 · 30</button><button data-wb="skills" class="${this.tab === "skills" ? "active" : ""}">技能 · 73</button><button data-wb="setup" class="${this.tab === "setup" ? "active" : ""}">测试设置</button><button data-wb="strategy" class="${this.tab === "strategy" ? "active" : ""}">战斗策略</button><button data-wb="analysis" class="${this.tab === "analysis" ? "active" : ""}">批量对比</button><button data-wb="reset-all" class="wb-reset">恢复全部基线</button></div><div id="wb-validation" class="wb-validation" role="status"></div><div class="wb-body ${this.tab === "analysis" ? "wb-analysis-body" : this.tab === "strategy" ? "wb-strategy-body" : ""}">${this.tab === "strategy" ? renderStrategy(this.project.setup,id=>this.name(id)) : this.tab === "analysis" ? `<div id="wb-comparison">${this.comparison.render(this.project.setup,this.project.source)}</div>` : `${this.tab === "setup" ? "" : `<aside class="wb-sidebar">${this.tab === "characters" ? `<div class="wb-sidebar-header"><label class="wb-search"><span>查找角色</span><input id="wb-search" placeholder="名称 / ID" value="${esc(this.query)}"></label><button data-wb="add-character" class="wb-add-character-btn" aria-label="＋ 新增怪兽">＋ 新增怪兽</button></div>` : `<p class="wb-help">${this.tab==="skills"?"选择技能，修改参数后 Play 测试。":"点击关卡即可选择测试目标；不需要先通关。"}</p>`}<div id="wb-list">${this.list()}</div></aside>`}<div class="wb-inspector">${this.tab === "characters" ? this.characters() : this.tab === "floors" ? this.floors() : this.tab === "skills" ? this.skills() : this.setup()}${(this.tab === "characters" || this.tab === "floors") ? `<button class="wb-compact-reset" data-wb="${this.tab === "characters" ? "reset-character" : "reset-floor"}">${this.tab === "characters" ? "恢复此角色基线" : "恢复本关基线"}</button>` : ""}<button class="wb-compact-reset" data-wb="reset-all">恢复全部基线</button></div><aside id="wb-preview" class="wb-preview"></aside>`}</div><div class="wb-footer"><span id="wb-save-status">${this.status}</span> · 草稿仅保存在此浏览器；支持导出全量ZIP（含配表、工程与贴图素材）或导入。测试与正式进度分开。</div></section>`;
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
    if(el.dataset.sim){this.comparison.input(el as HTMLInputElement|HTMLSelectElement,this.project.setup);return;}
    if (el.id === "wb-search") {
      this.query = el.value;
      const list = this.root?.querySelector("#wb-list");
      if (list) list.innerHTML = this.list();
      return;
    }
    try {
      if (el.dataset.strategy) {
        const strategy=this.project.setup.strategy??=defaultStrategy();
        const key=el.dataset.strategy;
        Object.assign(strategy,{[key]:el instanceof HTMLInputElement?el.type==="checkbox"?el.checked:Number(el.value):el.value});
      } else if (el.dataset.path) {
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
        if (path[0] === "Species" && path[2] === "FrameSize") {
          value = Number(el.value);
        }
        if (path[0] === "Species" && path[2] === "Sprite") {
          const sheet = (this.baseline as Config).Species.find((s) => spriteFileName(s.Sprite) === value);
          if (sheet) {
            setPath(this.project.source, ["Species", path[1] as number, "SpriteLayout"], "sheet");
            const layoutControl = this.root?.querySelector<HTMLSelectElement>(`#wb-Species-${Number(path[1])}-SpriteLayout`);
            if (layoutControl) layoutControl.value = "sheet";
            setPath(this.project.source, ["Species", path[1] as number, "FrameSize"], sheet.FrameSize);
            const control = this.root?.querySelector<HTMLSelectElement>(`#wb-Species-${Number(path[1])}-FrameSize`);
            if (control) control.value = String(sheet.FrameSize);
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
        this.pruneStrategy();
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
      if (this.tab === "characters") {
        const list = this.root?.querySelector("#wb-list");
        if (list) {
          const scroll = list.scrollTop;
          list.innerHTML = this.list();
          list.scrollTop = scroll;
        }
        const heading = this.root?.querySelector(
          ".wb-inspector .wb-section-title h2",
        );
        if (heading) heading.textContent = this.name(this.character);
      }
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
  private async exportZip() {
    this.notify("正在打包全量 ZIP 资源包…");
    try {
      const project = clone(this.project);
      const c = this.config();
      const speciesList =
        (readPath(project.source, ["Species"]) as any[]) ?? c.Species;
      const files: ZipFileEntry[] = [];

      files.push({
        name: "thirty-floor-trial-draft.json",
        data: JSON.stringify(project.source, null, 2),
      });
      files.push({
        name: "tower30-editor-project.json",
        data: JSON.stringify(project, null, 2),
      });

      const d = new Date();
      const dateStr = d.toISOString().replace("T", " ").slice(0, 19);
      let md = `# 翠庭试炼 · 怪兽图鉴与平衡清单\n\n`;
      md += `> 导出时间：${dateStr}\n`;
      md += `> 怪兽总数：${speciesList.length} 种（外加主角与公主 2 名人类角色）\n\n`;
      md += `## 怪兽总览表\n\n`;
      md += `| ID | 名称 | 品阶 | 主职责 | 外观贴图 | 规格 | 自动技能 | 手动大招 | 功能介绍与定位 |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const s of speciesList) {
        const sp =
          (readPath(project.source, ["Rules", "Species", s.Id]) as any) ??
          c.Rules.Species[s.Id];
        const pr =
          (readPath(project.source, ["Rules", "Profiles", s.Id]) as any) ??
          c.Rules.Profiles[s.Id];
        md += `| \`${s.Id}\` | ${s.Name} | **${sp?.Tier ?? "普通"}** | ${sp?.PrimaryRole ?? "-"} | \`${s.Id}.png\` | ${s.FrameSize ?? 16}px | ${pr?.Auto || "无"} | ${pr?.Ultimate || "-"} | ${sp?.Specialty?.replace(/\n/g, " ") || "-"} |\n`;
      }

      md += `\n## 详细设定清单\n\n`;
      for (const s of speciesList) {
        const sp =
          (readPath(project.source, ["Rules", "Species", s.Id]) as any) ??
          c.Rules.Species[s.Id];
        const pr =
          (readPath(project.source, ["Rules", "Profiles", s.Id]) as any) ??
          c.Rules.Profiles[s.Id];
        const cb =
          (readPath(project.source, ["Rules", "Combatants", s.Id]) as any) ??
          c.Rules.Combatants[s.Id];
        md += `### ${s.Name} (\`${s.Id}\`)\n`;
        md += `- **稀有品阶**：${sp?.Tier ?? "普通"}\n`;
        md += `- **定位与职责**：${sp?.PrimaryRole ?? "-"}（定位: ${pr?.Role ?? "-"}）\n`;
        md += `- **贴图素材**：\`sprites/${s.Id}.png\` (${s.FrameSize ?? 16}×${s.FrameSize ?? 16})\n`;
        md += `- **功能介绍**：${sp?.Specialty || "暂无"}\n`;
        md += `- **基础属性与成长**：生命 ${cb?.Base?.MaxHp ?? 0} (+${cb?.Growth?.MaxHp ?? 0}/级) / 攻击 ${cb?.Base?.Attack ?? 0} (+${cb?.Growth?.Attack ?? 0}/级) / 防御 ${cb?.Base?.Defense ?? 0} (+${cb?.Growth?.Defense ?? 0}/级) / 法术 ${cb?.Base?.Magic ?? 0} (+${cb?.Growth?.Magic ?? 0}/级) / 魔抗 ${cb?.Base?.Resistance ?? 0} (+${cb?.Growth?.Resistance ?? 0}/级)\n`;
        md += `- **普攻机制**：${cb?.BasicDamageType === "magical" ? "法术伤害" : "物理伤害"}，间隔 ${pr?.Interval ?? 1}s，射程 ${cb?.AttackRange ?? 0.55}，移速 ${cb?.MoveSpeed ?? 3.8}\n`;
        md += `- **技能设定**：\n`;
        md += `  - 自动技能：\`${pr?.Auto || "无"}\`（冷却: ${pr?.Cooldown ?? 0}s）- ${pr?.AutoDescription || "暂无说明"}\n`;
        md += `  - 手动大招：\`${pr?.Ultimate || "无"}\` - ${pr?.UltimateDescription || "暂无说明"}\n`;
        md += `  - 被动技能：${pr?.Passive || "无"} - ${pr?.PassiveDescription || "暂无说明"}\n\n`;
      }
      files.push({ name: "MONSTER_ROSTER.md", data: md });

      // Export each sheet under its species ID; the source keeps its Sprite mapping.
      const spriteFiles = new Map<string, string>([["hero", "hero"], ["princess", "princess"]]);
      for (const s of speciesList) spriteFiles.set(s.Id, spriteFileName(s.Sprite ?? s.Id));
      const fileDataCache = new Map<string, Uint8Array>();
      for (const [id, spriteFile] of spriteFiles) {
        let data: Uint8Array;
        const uploaded = project.sprites?.[spriteFile];
        if (uploaded) {
          const binary = atob(uploaded.slice(uploaded.indexOf(",") + 1));
          data = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        } else {
          if (!/^[A-Za-z0-9_]+$/.test(spriteFile)) throw new Error(`贴图名称无效：${spriteFile}`);
          const cached = fileDataCache.get(spriteFile);
          if (cached) data = cached;
          else {
            const resp = await fetch(`${import.meta.env.BASE_URL}assets/${spriteFile}.png`);
            if (!resp.ok) throw new Error(`无法读取贴图 ${spriteFile}.png（${resp.status}）`);
            data = new Uint8Array(await resp.arrayBuffer());
            if (![137,80,78,71,13,10,26,10].every((v, i) => data[i] === v))
              throw new Error(`贴图 ${spriteFile}.png 不是有效 PNG`);
            fileDataCache.set(spriteFile, data);
          }
        }
        files.push({ name: `sprites/${id}.png`, data });
      }

      const zipBytes = buildZip(files);
      const d2 = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${pad(d2.getFullYear() % 100)}${pad(d2.getMonth() + 1)}${pad(d2.getDate())}_${pad(d2.getHours())}${pad(d2.getMinutes())}`;
      const zipName = `tower30-project-${stamp}.zip`;

      const blob = new Blob([zipBytes as unknown as BlobPart], {
        type: "application/zip",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.notify(
        `已导出工程全量 ZIP（包含配表、工程、图鉴及 ${spriteFiles.size} 张贴图素材）`,
      );
    } catch (e) {
      this.notify(
        "导出 ZIP 失败：" + (e instanceof Error ? e.message : "未知错误"),
      );
    }
  }
  private pruneStrategy(){
    const s=this.project.setup.strategy;if(!s)return;
    for(const key of ["ultimateOrder","reinforcementOrder"] as const)s[key]=s[key].filter(id=>this.project.setup.party.includes(id));
  }
  private pruneEffects() {
    const effects=readPath(this.project.source,["Rules","Effects"]);
    if(effects&&typeof effects==="object"&&Object.keys(effects).length===0)setPath(this.project.source,["Rules","Effects"],undefined);
  }
  private click(action: string, id?: string) {
    switch (action) {
      case "strategy-reset":
        this.project.setup.strategy=defaultStrategy();this.render();void this.save();return;
      case "strategy-up":
      case "strategy-down": {
        const [key,index]=id!.split(":") as ["ultimateOrder"|"reinforcementOrder",string];
        const s=this.project.setup.strategy??=defaultStrategy(),ids=key==="ultimateOrder"?this.project.setup.party:this.project.setup.party.filter(id=>!["hero","princess"].includes(id));
        const order=orderedIds(s[key],ids),i=Number(index),j=i+(action==="strategy-up"?-1:1);
        if(i<0||i>=order.length||j<0||j>=order.length)return;
        [order[i],order[j]]=[order[j]!,order[i]!];s[key]=order;
        const scroll=this.root?.querySelector(".strategy-priorities")?.scrollTop??0;
        this.render();const pane=this.root?.querySelector(".strategy-priorities");if(pane)pane.scrollTop=scroll;
        this.root?.querySelector<HTMLElement>(`[data-wb="${action}"][data-id="${key}:${j}"]`)?.focus({preventScroll:true});
        void this.save();return;
      }

      case "characters":
      case "floors":
      case "skills":
      case "setup":
      case "strategy":
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
      case "character": {
        this.character = id!;
        const scroll = this.root?.querySelector("#wb-list")?.scrollTop ?? 0;
        this.render();
        const list = this.root?.querySelector("#wb-list");
        if (list) list.scrollTop = scroll;
        return;
      }
      case "floor":
        this.project.setup.floor = Number(id);
        this.group = 0;
        this.render();
        void this.save();
        return;
      case "group":
        this.group = Number(id);
        this.render();
        return;
      case "add-character": {
        const c = this.config();
        const selected = c.Species.some(s => s.Id === this.character) ? this.character : c.Species[0]!.Id;
        void openMonsterDialog(c,selected,input=>{
          const candidate = clone(this.project);
          const id = createMonster(candidate,c,input);
          // Validate a candidate before replacing the draft; errors stay in the dialog.
          importProject(JSON.stringify(candidate,null,2));
          this.project = candidate;
          this.character = id;
          this.query = "";
          this.render();void this.save();
          this.notify(`已创建怪兽 ${input.name.trim()}，可继续编辑属性或加入测试阵容。`);
        }).then(created=>{
          if(created)this.root?.querySelector<HTMLInputElement>('[aria-label="怪物名称"]')?.focus({preventScroll:true});
        });
        return;
      }
      case "delete-character": {
        if (["hero", "princess"].includes(this.character)) {
          this.notify("人类主角和公主不能删除");
          return;
        }
        const toDelete = this.character;
        const charName = this.name(toDelete);
        const usedFloors = this.config().Floors.filter((floor) =>
          this.config().Encounters.find((e) => e.Id === floor.Encounter)?.Enemies.some((e) => e.Species === toDelete),
        ).map((floor) => floor.Number);
        if (usedFloors.length) {
          this.notify(`第 ${usedFloors.join("、")} 关仍使用此怪兽，请先在关卡页替换或删除对应敌组。`);
          return;
        }
        if (
          !window.confirm(
            `确定要删除怪兽「${charName} (${toDelete})」吗？\n删除后将从物种列表、角色属性与技能中移除。`,
          )
        ) {
          return;
        }
        const speciesList = readPath(this.project.source, ["Species"]) as any[];
        const si = speciesList?.findIndex((s) => s.Id === toDelete) ?? -1;
        const removedSprite = speciesList?.[si]?.Sprite;
        if (si >= 0 && Array.isArray(speciesList)) {
          speciesList.splice(si, 1);
        }
        delete (this.project.source as any).Rules?.Species?.[toDelete];
        delete (this.project.source as any).Rules?.Combatants?.[toDelete];
        delete (this.project.source as any).Rules?.Profiles?.[toDelete];
        dropSprite(this.project,toDelete);
        if (typeof removedSprite === "string") dropSprite(this.project,removedSprite);
        this.project.setup.party = this.project.setup.party.filter(
          (id) => id !== toDelete,
        );
        if (this.project.setup.party.length === 0) {
          this.project.setup.party = ["hero", "princess"];
        }
        this.pruneStrategy();

        const remaining = readPath(this.project.source, ["Species"]) as any[];
        this.character =
          remaining?.[Math.min(Math.max(0, si), (remaining?.length ?? 1) - 1)]?.Id ??
          "hero";

        this.render();
        void this.save();
        this.notify(`已删除怪兽 ${charName}。`);
        return;
      }
      case "rename-character": {
        if (["hero", "princess"].includes(this.character)) return;
        const oldId = this.character;
        const input = window.prompt(
          "请输入新怪兽 ID（仅允许英文字母、数字和下划线）：",
          oldId,
        );
        if (!input || input.trim() === oldId) return;
        const newId = input.trim();
        if (!/^[a-zA-Z0-9_]{1,100}$/.test(newId) || ["__proto__", "constructor", "prototype"].includes(newId)) {
          this.notify("ID 格式不正确，仅限英文字母、数字和下划线（1-100字符）");
          return;
        }
        const c = this.config();
        const speciesList = readPath(this.project.source, ["Species"]) as any[];
        if (
          newId !== oldId &&
          (speciesList?.some((s) => s.Id === newId) ||
            c.Species.some((s) => s.Id === newId) ||
            ["hero", "princess"].includes(newId))
        ) {
          this.notify(`ID ${newId} 已存在，请使用其他 ID`);
          return;
        }
        const si = speciesList?.findIndex((s) => s.Id === oldId) ?? -1;
        if (oldId === "nightwing")
          (this.project.source as Config).Rules.Profiles[oldId]!.LeechMoveMultiplier ??= 1.4;
        if (si >= 0) {
          setPath(this.project.source, ["Species", si, "Id"], newId);
        }
        for (const section of ["Species", "Combatants", "Profiles"] as const) {
          const raw = readPath(this.project.source, ["Rules", section, oldId]);
          if (raw !== undefined) {
            setPath(this.project.source, ["Rules", section, newId], raw);
            delete (this.project.source as any).Rules[section][oldId];
          }
        }
        this.project.setup.party = this.project.setup.party.map((id) =>
          id === oldId ? newId : id,
        );
        for (const encounter of (this.project.source as Config).Encounters)
          for (const enemy of encounter.Enemies)
            if (enemy.Species === oldId) enemy.Species = newId;
        for (const key of ["ultimateOrder", "reinforcementOrder"] as const) {
          const strategy = this.project.setup.strategy;
          if (strategy) strategy[key] = strategy[key].map((id) => id === oldId ? newId : id);
        }
        renameSprite(this.project,oldId,newId);
        this.character = newId;
        this.render();
        void this.save();
        this.notify(`怪兽 ID 已变更为 ${newId}`);
        return;
      }
      case "save":
        void this.save();
        return;
      case "export-zip":
        void this.exportZip();
        return;
      case "export-godot": {
        try {const p=inspectProject(this.project);this.download(p.project,`tower30-godot-F${p.info.setup.floor}-${p.info.launchHash}.json`);this.notify(`已导出Godot试跑 · ${p.info.configHash} · 种子${p.info.setup.seed}`);}
        catch(e){this.notify(e instanceof Error?e.message:"工程不能开始测试");}return;
      }
      case "import-record": {
        const input=document.createElement("input");input.type="file";input.accept=".json,application/json";
        input.addEventListener("change",()=>{const file=input.files?.[0];if(!file)return;if(file.size>2000000){this.notify("测试记录不能超过2MB");return;}
          void file.text().then(text=>{TowerEngine.restorePlaytest(text);this.onReview(text);this.notify("已导入测试记录，当前暂停；可导出核对或继续。");}).catch(e=>this.notify("测试记录导入失败，当前状态未改变："+(e instanceof Error?e.message:"格式错误")));
        });input.click();return;
      }
      case "import": {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,.zip,application/json,application/zip";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          if (file.size > 20000000) {
            this.notify("文件不能超过20MB");
            return;
          }
          if (file.name.endsWith(".zip")) {
            void file
              .arrayBuffer()
              .then(async (buf) => {
                const zip = readZip(new Uint8Array(buf));
                const projectData =
                  zip.get("tower30-editor-project.json") ??
                  zip.get("thirty-floor-trial-draft.json");
                if (!projectData) {
                  this.notify(
                    "ZIP 包中未找到 tower30-editor-project.json 或 thirty-floor-trial-draft.json",
                  );
                  return;
                }
                const text = new TextDecoder().decode(projectData);
                const project = importProject(text);
                await validateProjectSprites(project);
                this.project = project;
                this.character = "hero";
                this.group = 0;
                this.render();
                void this.save();
                this.notify("已从 ZIP 导入草稿，点击 Play 测试。");
              })
              .catch((e) =>
                this.notify(
                  "ZIP 导入失败：" +
                    (e instanceof Error ? e.message : "格式错误"),
                ),
              );
            return;
          }
          void file
            .text()
            .then(async (text) => {
              const project = importProject(text);
              await validateProjectSprites(project);
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
          this.onPlay(result.config, clone(this.project.setup), clone(this.project.sprites??{}));
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
        if (!Object.hasOwn((this.baseline as Config).Rules.Combatants, this.character)) {
          this.notify("此怪兽没有原始基线；可继续编辑，或删除后重新从模板新增。");
          return;
        }
        if (window.confirm("恢复此角色的名称、介绍、基础属性、成长与行动设置？")) {
          const si = (readPath(this.project.source, ["Species"]) as Config["Species"]).findIndex(
            (s) => s.Id === this.character,
          );
          const baselineSpecies = (this.baseline as Config).Species.find((s) => s.Id === this.character);
          if (si >= 0) {
            setPath(
              this.project.source,
              ["Species", si],
              baselineSpecies,
            );
            setPath(
              this.project.source,
              ["Rules", "Species", this.character],
              readPath(this.baseline, ["Rules", "Species", this.character]),
            );
          }
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
        this.pruneStrategy();
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
