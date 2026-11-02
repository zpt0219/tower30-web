import {FixedClock} from "./fixed-clock";
import {advancePlaytest} from "../core/strategy";
import { skillLabel } from "../data/skill-labels";
import "./style.css";
import { config as baselineConfig } from "../data/load";
import baselineSource from "../../data/tower/thirty-floor-trial.json";
import { Workbench } from "../editor/workbench";
import type { PlaytestSetup } from "../core/playtest";
import { supportedSkills } from "../core/playtest";
import {
  TowerEngine,
  PLAYABLE_FLOORS,
  isHuman,
  itemNames,
  type Snapshot,
} from "../core/engine";
import type { Attributes, Gear, Config } from "../core/config";
import type { Command } from "../core/model";
import {
  readSaves,
  writeSave,
  readWorkbench,
  writeWorkbench,
} from "../storage/save";
import { drawBattle } from "../battle-view/renderer";
const app = document.querySelector<HTMLDivElement>("#app")!;
let config: Config = baselineConfig;
let booted = false;
let engine = new TowerEngine(config),
  snap: Snapshot = engine.getSnapshot(),
  previous: ReturnType<TowerEngine["getBattleSnapshot"]> = null;
let normalEngine = engine;
let lastTestJson: string | null = null;
let testWrites: Promise<void> = Promise.resolve();
const workbench = new Workbench(
  baselineSource,
  baselineConfig,
  startPlaytest,
  toast,
  reviewPlaytest,
);
const clock=new FixedClock();
let visualSeconds=0;
let frameFps=0,logicMs=0;
let showClearedFloor=false;
let eventKindFilter="all", eventActorFilter="";
let page = "tower",
  selectedFloor = 1,
  selectedMember = "hero",
  filter = "all",
  codexFilter = "",
  paused = true,
  speed = 1,
  saveStatus = "尚未保存",
  storageFailed = false,
  saveHold = false,
  damagedSave: string | null = null,
  keepBackupOnce = false,
  lastTime = 0,

  lastSaveTick = -1;
const actions = new Map<string, () => void>();
let actionId = 0;
const scrollPositions = new Map<string, number>();
const focusPositions = new Map<string, string>();
const history: { page: string; member: string; filter: string }[] = [];
const labels: Record<string, string> = {
  tower: "试炼之塔",
  party: "伙伴",
  equipment: "主角装备",
  bag: "装备背包",
  shop: "常驻商店",
  items: "行囊",
  inn: "林间旅馆",
  codex: "物种图鉴",
  records: "试炼战报",
  settings: "存档与说明",
  battle: "实时战斗",
  member: "伙伴详情",
  editor: "编辑与 Play",
};
const roleNames: Record<string, string> = {
  melee: "近战输出",
  healer: "治疗辅助",
  tank: "前排承伤",
  ranged: "远程输出",
};
const attrNames: Record<keyof Attributes, string> = {
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
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
const rawName = (id: string) =>
  id === "hero"
    ? "主角"
    : id === "princess"
      ? "公主"
      : (config.Species.find((s) => s.Id === id)?.Name ??
        config.Rules.Equipment.find((g) => g.Id === id)?.Name ??
        itemNames[id] ??
        id);
const name = (id: string) => esc(rawName(id));
const skill = skillLabel;
const format = (key: string, value: number) =>
  percentages.has(key) ? `${Math.round(value * 100)}%` : String(value);
function button(
  text: string,
  fn: () => void,
  cls = "",
  disabled = false,
  extra = "",
) {
  const id = String(++actionId);
  actions.set(id, fn);
  return `<button data-action="${id}" class="${cls}" ${disabled ? "disabled" : ""} ${extra}>${text}</button>`;
}
function nav(target: string, text = labels[target] ?? target, cls = "") {
  return button(esc(text), () => navigate(target), cls);
}
function command(
  c: Command,
  text: string,
  confirmText?: string,
  cls = "",
  disabled = false,
) {
  return button(
    esc(text),
    () =>
      confirmText ? confirmAction(text, confirmText, () => send(c)) : send(c),
    cls,
    disabled,
  );
}
function portrait(id: string) {
  return [
    "hero",
    "princess",
    ...baselineConfig.Species.map((s) => s.Id),
  ].includes(id)
    ? `<div class="portrait ${isHuman(id) ? "human" : ""}" style="background-image:url('${import.meta.env.BASE_URL}assets/${id}.png')" aria-hidden="true"></div>`
    : `<div class="portrait rune" aria-hidden="true">${esc(name(id).slice(0, 1))}</div>`;
}
function bar(hp: number, max: number, cls = "health") {
  return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, (hp / max) * 100))}%"></i></div>`;
}
function attributes(a: Attributes, comparison?: Attributes) {
  return `<dl class="attributes">${Object.entries(attrNames)
    .map(
      ([k, label]) =>
        `<div><dt>${label}</dt><dd>${format(k, a[k as keyof Attributes])}${comparison && comparison[k as keyof Attributes] !== a[k as keyof Attributes] ? `<small class="delta"> → ${format(k, comparison[k as keyof Attributes])}</small>` : ""}</dd></div>`,
    )
    .join("")}</dl>`;
}
function bonuses(g: Gear) {
  return (
    Object.entries(g.Attributes)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${attrNames[k as keyof Attributes]} +${format(k, v)}`)
      .join(" · ") || "无属性加成"
  );
}
function memberCard(m: Snapshot["members"][number], compact = false) {
  return `<article class="member-card ${m.hp === 0 ? "fallen" : ""}"><div class="member-top">${portrait(m.id)}<div><h3>${name(m.id)} <small>Lv.${m.level}</small></h3><p>${isHuman(m.id) ? roleNames[m.profile.Role] : `${"★".repeat(m.rank)} · ${config.Rules.Species[m.id]!.PrimaryRole}`}</p></div></div><div class="metric"><span>生命</span><b>${m.hp} / ${m.attributes.MaxHp}</b></div>${bar(m.hp, m.attributes.MaxHp)}<div class="metric energy-text"><span>能量</span><b>${Math.floor(m.energy)} / 1000</b></div>${bar(m.energy, 1000, "energy")}${
    compact
      ? ""
      : `<p class="small">自动：${esc(skill(m.profile.Auto))} · 大招：${esc(skill(m.profile.Ultimate))}</p>${button(
          "查看伙伴 →",
          () => {
            selectedMember = m.id;
            navigate("member");
          },
          "wide subtle",
        )}`
  }</article>`;
}
function routeKey() {
  return `${page}:${selectedMember}:${filter}`;
}
function navigate(target: string, push = true) {
  if (target === "editor") {
    openEditor();
    return;
  }
  if (snap.battle && target !== "battle") {
    toast("战斗期间请在战场操作；结束后返回整备。");
    return;
  }
  const main = document.querySelector<HTMLElement>(".page-scroll");
  if (main) scrollPositions.set(routeKey(), main.scrollTop);
  const active = document.activeElement as HTMLElement | null;
  if (active?.dataset.focus)
    focusPositions.set(routeKey(), active.dataset.focus);
  if (push && page !== target)
    history.push({ page, member: selectedMember, filter });
  page = target;
  render();
}
function back() {
  if (page === "editor") {
    page = snap.battle ? "battle" : "tower";
    paused = true;
    render();
    return;
  }
  const p = history.pop();
  if (p) {
    selectedMember = p.member;
    filter = p.filter;
    page = p.page;
    render();
  } else navigate("tower", false);
}
function refresh() {
  previous = null;
  snap = engine.getSnapshot();
}
function send(c: Command) {
  const result = engine.dispatch(c);
  refresh();
  if (!result.ok) {
    toast(result.message);
    return;
  }
  if (c.type === "begin" || c.type === "start") {
    page = "battle";
    paused = c.type === "begin";
    visualSeconds=0;lastTime=0;
    clock.reset();
  }
  if(c.type==="finish"&&snap.completed)showClearedFloor=false;
  if (c.type === "finish" || c.type === "retry") {
    page = "tower";
    paused = true;
    selectedFloor = Math.min(snap.floor, 30);
  }
  render();
  queueSave();
}
function saveTest(active: boolean) {
  if (snap.mode === "playtest") lastTestJson = engine.serialize();
  if (!lastTestJson) return;
  const json = JSON.stringify({ active, serialized: lastTestJson });
  if (active) {
    saveStatus = "正在保存测试…";
    updateSaveLabel();
  }
  testWrites = testWrites
    .catch(() => {})
    .then(() => writeWorkbench("session", json))
    .then(() => {
      if (snap.mode === "playtest" && active) {
        saveStatus = "测试已保存";
        updateSaveLabel();
      }
    })
    .catch(() => {
      if (snap.mode === "playtest") {
        saveStatus = "测试保存失败 · 请导出";
        updateSaveLabel();
      }
      toast("测试存档保存失败，正式试跑未改变。");
    });
}
function openEditor() {
  paused = true;
  clock.reset();
  lastTime = 0;
  if (snap.mode === "playtest") {
    saveTest(false);
    engine = normalEngine;
    config = baselineConfig;
    refresh();
    saveStatus = "正式进度保留";
  } else {
    normalEngine = engine;
    queueSave();
  }
  page = "editor";
  render();
}
function startPlaytest(nextConfig: Config, setup: PlaytestSetup) {
  try {
    const next = TowerEngine.createPlaytest(nextConfig, setup);
    for (const type of ["begin", "start"] as const) {
      const result = next.dispatch({ type });
      if (!result.ok) throw new Error(result.message);
    }
    if (snap.mode === "run") normalEngine = engine;
    engine = next;visualSeconds=0;
    config = next.getConfigSnapshot();
    refresh();
    page = "battle";
    paused = false;
    clock.reset();
    lastTime = 0;
    lastSaveTick = 0;
    render();
    queueSave();
  } catch (e) {
    toast(e instanceof Error ? e.message : "测试启动失败");
  }
}
function reviewPlaytest(serialized:string) {
  try {
    const restored=TowerEngine.restorePlaytest(serialized);
    if(snap.mode==="run")normalEngine=engine;
    engine=restored;visualSeconds=restored.getBattleSnapshot()?.seconds??0;config=restored.getConfigSnapshot();refresh();page="battle";paused=true;clock.reset();lastTime=0;lastSaveTick=snap.tick;render();queueSave();
  } catch(e) {toast(e instanceof Error?e.message:"测试记录无法恢复");}
}
let pendingSave: string | null = null,
  saving = false;
function queueSave() {
  if (!booted) return;
  if (snap.mode === "playtest") {
    saveTest(true);
    return;
  }
  normalEngine = engine;
  if (saveHold) return;
  pendingSave = engine.serialize();
  saveStatus = "正在保存…";
  updateSaveLabel();
  if (!saving) void flushSave();
}
async function flushSave() {
  saving = true;
  while (pendingSave !== null) {
    const json = pendingSave;
    pendingSave = null;
    try {
      await writeSave(json, keepBackupOnce);
      keepBackupOnce = false;
      saveStatus = pendingSave === null ? "已保存到本机" : "正在保存…";
      storageFailed = false;
    } catch (e) {
      saveStatus = "保存失败 · 请导出";
      storageFailed = true;
      toast(
        `本机保存失败：${e instanceof Error ? e.message : "存储不可用"}。请导出存档。`,
      );
    }
    updateSaveLabel();
  }
  saving = false;
}
function updateSaveLabel() {
  const el = document.querySelector("#save-status");
  if (el) {
    el.textContent = saveStatus;
    el.classList.toggle("error", storageFailed);
  }
}
let toastTimer = 0;
function toast(text: string) {
  let el = document.querySelector<HTMLElement>("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove("visible"), 4000);
}
function dialog(
  title: string,
  body: string,
  setup?: (d: HTMLDialogElement) => void,
) {
  const d = document.createElement("dialog");
  d.innerHTML = `<div class="dialog-heading"><h2>${esc(title)}</h2><button class="dialog-x" aria-label="关闭">×</button></div><div class="dialog-body">${body}</div>`;
  document.body.append(d);
  d.querySelector(".dialog-x")!.addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  });
  setup?.(d);
  d.showModal();
  return d;
}
function confirmAction(title: string, body: string, accept: () => void) {
  return dialog(
    title,
    `<p>${esc(body)}</p><div class="dialog-actions"><button data-cancel>取消</button><button data-confirm class="primary">确认${esc(title)}</button></div>`,
    (d) => {
      d.querySelector("[data-cancel]")!.addEventListener("click", () =>
        d.close(),
      );
      d.querySelector("[data-confirm]")!.addEventListener("click", () => {
        d.close();
        accept();
      });
    },
  );
}
function render() {
  actions.clear();
  const inBattle = page === "battle";
  app.innerHTML = `<header class="topbar"><a class="brand" href="#" aria-label="试炼之塔首页"><span class="brand-seal">塔</span><div>翠庭试炼<small>THIRTY FLOORS</small></div></a><div class="run-status"><span>第 <b id="floor-counter">${String(Math.min(snap.floor, 30)).padStart(2, "0")}</b> / 30 层</span><span class="gold">${snap.mode === "playtest" ? '<b id="gold-counter">TEST</b> <small>不计奖励</small>' : `◈ <b id="gold-counter">${snap.gold}</b> <small>金币</small>`}</span></div><div class="save-indicator"><span class="version">${snap.mode === "playtest" ? "独立测试 · 不计通关" : snap.completed ? "已通关 · 30 / 30" : "正式试跑 · 全30层"}</span><button id="save-status" class="text-button">${saveStatus}</button></div></header><div class="workspace"><nav class="sidebar" aria-label="主要功能">${[
    ["tower", "Ⅰ", "试炼"],
    ["party", "♟", "伙伴"],
    ["bag", "⚔", "装备"],
    ["shop", "◈", "商店"],
    ["items", "▤", "行囊"],
    ["inn", "☾", "旅馆"],
    ["codex", "✧", "图鉴"],
    ["records", "≡", "战报"],
    ["editor", "⚒", "工作台"],
  ]
    .map(([id, icon, label]) =>
      button(
        `<span>${icon}</span>${label}`,
        () => navigate(id!),
        `nav-item ${page === id || (id === "party" && ["member", "equipment"].includes(page)) ? "active" : ""}`,
        inBattle && id !== "editor",
        `aria-label="${label}"`,
      ),
    )
    .join(
      "",
    )}<div class="nav-spacer"></div>${button("<span>⚙</span>存档", () => navigate("settings"), `nav-item ${page === "settings" ? "active" : ""}`, inBattle)}</nav><main class="${inBattle ? "battle-page" : "paper"} ${page === "editor" ? "editor-page" : ""}"><div class="page-heading"><div class="heading-left">${!["tower", "battle"].includes(page) ? button(page === "editor" ? "‹ 返回正式试跑" : "‹ 返回", back, "back") : ""}<div><p class="eyebrow">${inBattle ? "FOREST ARENA" : "THE EMERALD TRIAL"}</p><h1>${snap.mode === "playtest" && inBattle ? `独立 Play · 第${snap.floor}关` : labels[page]}</h1></div></div><div class="heading-note">${snap.mode === "playtest" ? "测试配置 " + snap.configHash : inBattle ? "自动交战 · 手动释放大招" : page === "tower" ? button("编辑属性与关卡 ▶ Play", () => openEditor(), "subtle") : page === "editor" ? "草稿 → 校验 → 独立测试" : "整备之后，再启程。"}</div></div>${inBattle ? battlePage() : `<div class="page-scroll">${content()}</div>`}</main></div><footer class="bottom-line"><span>30层编排 · 40物种已载入</span><span>${snap.mode === "playtest" ? "独立配置快照 · 测试不领取奖励" : page === "editor" ? "42角色 / 30关可编辑 · Play不改变正式存档" : inBattle ? "切换后台会自动暂停" : "全30层已开放 · 无免费恢复 · 本机独立存档"}</span></footer>`;
  app.querySelector(".brand")!.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("tower");
  });
  app
    .querySelector("#save-status")!
    .addEventListener("click", () => navigate("settings"));
  app
    .querySelectorAll<HTMLButtonElement>("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => actions.get(el.dataset.action!)?.()),
    );
  const scroller = app.querySelector<HTMLElement>(".page-scroll");
  if (scroller) scroller.scrollTop = scrollPositions.get(routeKey()) ?? 0;
  const focus = focusPositions.get(routeKey());
  if (focus)
    app
      .querySelector<HTMLElement>(`[data-focus="${CSS.escape(focus)}"]`)
      ?.focus({ preventScroll: true });
  if (inBattle) {
    const kind=app.querySelector<HTMLSelectElement>("#event-kind"), actor=app.querySelector<HTMLInputElement>("#event-actor");
    kind?.addEventListener("change",()=>{eventKindFilter=kind.value;updateBattleHud();});
    actor?.addEventListener("input",()=>{eventActorFilter=actor.value;updateBattleHud();});
    updateBattleHud();
  }
  if (page === "editor") {
    const root = app.querySelector<HTMLElement>("#workbench-root");
    if (root) workbench.attach(root);
  }
  app
    .querySelector<HTMLInputElement>("#codex-search")
    ?.addEventListener("input", (e) => {
      codexFilter = (e.target as HTMLInputElement).value;
      const list = app.querySelector("#codex-list")!;
      list.innerHTML = codexCards();
      bindActions(list);
    });
}
function bindActions(root: Element) {
  root
    .querySelectorAll<HTMLButtonElement>("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => actions.get(el.dataset.action!)?.()),
    );
}
function content(): string {
  switch (page) {
    case "editor":
      return '<div id="workbench-root"></div>';
    case "tower":
      return towerPage();
    case "party":
      return partyPage();
    case "member":
      return memberPage();
    case "equipment":
      return equipmentPage();
    case "bag":
      return bagPage();
    case "shop":
      return shopPage();
    case "items":
      return itemsPage();
    case "inn":
      return innPage();
    case "codex":
      return codexPage();
    case "records":
      return recordsPage();
    default:
      return settingsPage();
  }
}
function completionPage() {
  const c=snap.completion!;
  return `<section class="completion-layout"><div class="completion-banner"><p class="eyebrow">THIRTY FLOORS CLEARED</p><h2>30层试炼已完成</h2><p>风暴祭司已被击败。每一层胜利、消耗与掉落，都保存在这次试跑中。</p><span class="tag">正式通关 · 3位守关首领</span></div><div class="completion-metrics"><article><span>已通过</span><strong>${c.floors} / 30 层</strong><p>完整战报可逐层回看</p></article><article><span>累计战斗</span><strong>${(c.seconds/60).toFixed(1)} 分钟</strong><p>固定步长下的实际胜利用时</p></article><article><span>当前金币</span><strong>◈ ${c.gold}</strong><p>商店阶段 ${c.bosses} 已开放</p></article><article><span>收集伙伴</span><strong>${c.members} 位</strong><p>${c.alive} 位存活，生命与能量按战后状态保留</p></article></div><div class="hint"><span>✧</span><p>通关不提供免费恢复。可以继续整备、付费住宿，或进入工作台独立测试任意关卡。</p></div><div class="button-row">${nav("records","查看30层战报","primary")}${button("进入配置工作台",openEditor)}${button("回顾关卡",()=>{showClearedFloor=true;selectedFloor=30;render();})}${nav("settings","存档与新试跑")}</div></section>`;
}
function towerPage() {
  if(snap.completed&&!showClearedFloor)return completionPage();
  const f = config.Floors[selectedFloor - 1]!,
    e = config.Encounters.find((e) => e.Id === f.Encounter)!,
    cleared = selectedFloor < snap.floor,
    current = selectedFloor === snap.floor,
    supported = selectedFloor <= PLAYABLE_FLOORS;
  return `<div class="tower-layout"><aside class="floor-list"><div class="section-caption">攀登记录 <span>${snap.records.length} 层已通过</span></div>${config.Floors.map(
    (f) => {
      const done = f.Number < snap.floor,
        boss = f.Number % 10 === 0;
      return button(
        `<span class="floor-number">${String(f.Number).padStart(2, "0")}</span><span><b>${boss ? "守关之战" : f.Number <= PLAYABLE_FLOORS ? config.Encounters.find((e) => e.Id === f.Encounter)!.Title : f.Theme.split("·")[0]}</b><small>${done ? "已通过" : f.Number === snap.floor ? "当前楼层" : f.Number <= PLAYABLE_FLOORS ? "等待挑战" : "待后续版本开放"}</small></span><span class="floor-state">${done ? "✓" : boss ? "◆" : "›"}</span>`,
        () => {
          selectedFloor = f.Number;
          const sc = document.querySelector<HTMLElement>(".floor-list");
          const y = sc?.scrollTop ?? 0;
          render();
          const next = document.querySelector(".floor-list");
          if (next) next.scrollTop = y;
        },
        `floor-row ${selectedFloor === f.Number ? "selected" : ""} ${boss ? "boss" : ""}`,
      );
    },
  ).join(
    "",
  )}</aside><section class="floor-detail"><div class="floor-detail-scroll"><div class="floor-banner"><div><span class="tag">${e.Boss ? "BOSS · 守关" : esc(f.Theme)}</span><p class="eyebrow">FLOOR ${String(selectedFloor).padStart(2, "0")}</p><h2>${esc(e.Title)}</h2><p>${cleared ? "这一层的奖励已经领取。" : supported ? "整理队伍，准备踏入林间战场。" : "楼层资料已载入，技能迁移完成后开放挑战。"}</p></div><div class="tower-emblem" aria-hidden="true"><div class="tower-top"></div><div class="tower-body"><i></i><i></i><i></i></div><span>${String(selectedFloor).padStart(2, "0")}</span></div></div><div class="floor-info"><section><div class="section-caption">敌方阵容 <span>${e.Difficulty}</span></div><div class="enemy-line">${e.Enemies.map((g) => `<div class="enemy-entry">${portrait(g.Species)}<div><h3>${name(g.Species)} <small>×${g.Count}</small></h3><p>Lv.${g.Level} · ${g.Rank}阶 · ${roleNames[config.Rules.Profiles[g.Species]!.Role]}</p><p class="small">${esc(config.Rules.Profiles[g.Species]!.AutoDescription || skill(config.Rules.Profiles[g.Species]!.Auto))}</p></div></div>`).join("")}</div></section><section class="rewards"><div class="section-caption">首次胜利奖励</div><strong class="reward-gold">◈ ${e.Gold} <small>金币</small></strong><p>击败敌人后获得魂魄、经验药水与战利品</p><p class="small">首次收集消耗1魂魄 · 新伙伴半血加入</p></section></div><div class="hint"><span>✧</span><p>${esc(e.Hint)}</p></div></div><div class="section-caption">我的队伍 <span>${snap.members.length} 位伙伴 · 最多5首发</span></div><div class="party-preview">${snap.members.map((m) => `<div>${portrait(m.id)}<div><b>${name(m.id)} <small>Lv.${m.level}</small></b><p>${m.hp} / ${m.attributes.MaxHp}</p>${bar(m.hp, m.attributes.MaxHp)}</div></div>`).join("")}</div><div class="page-actions">${snap.completed?button("返回通关页",()=>{showClearedFloor=false;render();}):""}<div class="small">${selectedFloor > snap.playableFloors ? "当前楼层尚未开放。" : cleared ? "已通关楼层不能重复领取奖励。" : "进入后先选首发，再开始交战。生命与能量跨战保留。"}</div>${button(cleared ? "已通过本层" : !supported ? "后续版本开放" : !current ? "请先通过前层" : "准备挑战 →", () => send({ type: "begin" }), "primary large", !current || !supported || cleared)}</div></section></div>`;
}
function partyPage() {
  return `<div class="section-intro"><div><h2>一路同行的伙伴</h2><p>人类通过战斗经验成长；怪兽使用经验药水。满能量时，点击战场卡片释放大招。</p></div><span class="tag">${snap.members.length} 位已收集</span></div><div class="cards-grid">${snap.members.map((m) => memberCard(m)).join("")}</div>`;
}
function memberPage() {
  const m = snap.members.find((m) => m.id === selectedMember)!;
  return `<div class="detail-layout"><section>${memberCard(m, true)}<div class="section-caption">最终属性 <span>已计入装备</span></div>${attributes(m.attributes)}${isHuman(m.id) ? button("查看 / 更换装备 →", () => navigate("equipment"), "primary wide") : ""}</section><section><div class="section-caption">战斗技能</div><article class="info-card"><span class="tag">自动技能</span><h3>${skill(m.profile.Auto)}</h3><p>${esc(m.profile.AutoDescription || (m.id === "hero" ? "短前摇的单体物理攻击，使用攻击属性结算。" : "优先治疗低生命伙伴，使用法术属性结算。"))}</p></article><article class="info-card"><span class="tag">手动大招 · 1000能量</span><h3>${skill(m.profile.Ultimate)}</h3><p>${esc(m.profile.UltimateDescription || (m.id === "hero" ? "不可打断的强化单体斩击。消耗满额能量，在前摇后命中。" : "治疗附近受伤队友，并附加持续恢复。"))}</p></article>${isHuman(m.id) ? `<div class="hint"><p>人类共享战斗经验：${snap.xp}。升等级增加属性上限，生命不会免费恢复。</p></div>` : trainingPanel(m)}<div class="section-caption">使用道具</div><div class="button-row">${command({ type: "item", id: m.id, item: "herb" }, `草药 ×${snap.items.herb ?? 0}`, `为${name(m.id)}实际恢复${m.itemRecovery.herb}生命，消耗1份草药。`, "", !m.itemRecovery.herb || !snap.items.herb)}${command({ type: "item", id: m.id, item: "revive" }, `复活羽 ×${snap.items.revive ?? 0}`, `复活${name(m.id)}，恢复${m.itemRecovery.revive}生命，能量归零。`, "", !m.itemRecovery.revive || !snap.items.revive)}</div></section></div>`;
}
function trainingPanel(m: Snapshot["members"][number]) {
  const t = m.training;
  return `<div class="section-caption">伙伴培养 <span>${m.rank}阶 · Lv.${m.level}</span></div><div class="info-card"><p>当前经验 <b>${t.xp} / ${t.next}</b> · 储备 <b>${t.available}</b> 小瓶单位</p><p>本次培养至 Lv.${t.targetLevel}，消耗 <b>${t.units}</b> 小瓶单位（小 / 中 / 大 = 1 / 4 / 20）</p><p>同种魂魄 <b>${snap.souls[m.id] ?? 0}</b> / ${t.rankCost} · 下一阶：${m.rank === 1 ? "自动技能 Lv.2" : m.rank === 2 ? "被动 Lv.1" : m.rank === 3 ? "大招 Lv.2" : m.rank === 4 ? "自动技能 Lv.3 / 被动 Lv.2" : "已满阶"}</p><div class="button-row">${command({ type: "train", id: m.id }, "药水升级", `消耗${t.units}小瓶单位为${name(m.id)}培养至Lv.${t.targetLevel}，生命保持不变，多出的瓶数以小瓶找零。`, "primary", t.available < t.units || m.level >= 30)}${command({ type: "rank", id: m.id }, "魂魄升阶", `消耗${t.rankCost}个同种魂魄升阶。`, "", m.rank >= 5 || (snap.souls[m.id] ?? 0) < t.rankCost)}${command({ type: "refund", id: m.id }, "退还药水", `退还${t.refund}小瓶，重置药水经验；生命不超过降级后的上限。`, "", t.refund === 0)}</div></div>`;
}
function equipmentPage() {
  const m = snap.members.find((m) => m.id === selectedMember)!;
  return `<div class="equipment-layout"><section><div class="character-heading">${portrait(m.id)}<div><h2>${name(m.id)} <small>Lv.${m.level}</small></h2><p>生命 ${m.hp} / ${m.attributes.MaxHp}</p></div>${button(
    "切换角色",
    () => {
      selectedMember = m.id === "hero" ? "princess" : "hero";
      render();
    },
    "subtle",
  )}</div><div class="section-caption">最终属性 <span>含装备加成</span></div>${attributes(m.attributes)}</section><section><div class="section-caption">当前装备 <span>属性与用途同屏</span></div>${(
    ["weapon", "armor", "accessory"] as const
  )
    .map((slot) => {
      const g = config.Rules.Equipment.find((g) => g.Id === m.equipment[slot]);
      return `<article class="gear-slot"><div><span class="slot-symbol">${slot === "weapon" ? "⚔" : slot === "armor" ? "♜" : "✧"}</span><h3>${{ weapon: "武器", armor: "防具", accessory: "饰品" }[slot]} · ${g ? name(g.Id) : "未装备"}</h3>${button("更换", () => chooseGear(m.id, slot), "subtle")}</div><p>${g ? bonuses(g) : "从装备背包中选择一件装备。"}</p><p class="small">${g && slot === "weapon" ? `自动：${skill(g.Auto || m.profile.Auto)} Lv.${g.AutoLevel} · 大招：${skill(g.Ultimate || m.profile.Ultimate)} Lv.${g.UltimateLevel}` : g ? `被动：${g.Effect || "无额外技能"}` : "可在常驻商店获取装备。"}</p></article>`;
    })
    .join("")}</section></div>`;
}
function chooseGear(id: string, slot: Gear["Slot"]) {
  const options = config.Rules.Equipment.filter(
    (g) =>
      g.Slot === slot &&
      snap.equipment.includes(g.Id) &&
      ["", "all", "human", id].includes(g.Wearer),
  );
  const d = dialog(
    "选择装备",
    `<p>换装预览不会改变装备，确认后才生效。</p><button data-unequip>卸下当前装备</button>` +
      options
        .map(
          (g) =>
            `<article class="info-card"><h3>${g.Name}</h3><p>${bonuses(g)}</p><p>${esc(g.ModernDescription)}</p><button data-gear="${g.Id}">查看换装对比</button></article>`,
        )
        .join("") || "<p>背包没有该槽位的装备，可在商店购买。</p>",
  );
  d.querySelector("[data-unequip]")!.addEventListener("click", () => {
    d.close();
    confirmAction("卸下装备", "卸下后生命不会增加。", () =>
      send({ type: "unequip", id, slot }),
    );
  });
  d.querySelectorAll<HTMLButtonElement>("[data-gear]").forEach((el) =>
    el.addEventListener("click", () => {
      d.close();
      equipConfirm(id, el.dataset.gear!);
    }),
  );
}
function equipConfirm(id: string, gearId: string) {
  const preview = engine.previewEquip(id, gearId);
  if (!preview) return;
  const g = config.Rules.Equipment.find((g) => g.Id === gearId)!;
  const d = dialog(
    "确认更换装备",
    `<h3>${name(id)} → ${g.Name}</h3><p>${esc(g.ModernDescription)}</p>${attributes(preview.before, preview.after)}<div class="dialog-actions"><button data-cancel>取消</button><button data-confirm class="primary">确认换装</button></div>`,
  );
  d.querySelector("[data-cancel]")!.addEventListener("click", () => d.close());
  d.querySelector("[data-confirm]")!.addEventListener("click", () => {
    d.close();
    send({ type: "equip", id, gear: gearId });
  });
}
function bagPage() {
  const slots: Record<string, string> = {
    all: "全部",
    weapon: "武器",
    armor: "防具",
    accessory: "饰品",
  };
  return `<div class="section-intro"><p>一件装备只能由一名人类穿戴。查看加成后，再确认换装。</p><div class="button-row">${button(
    "主角装备",
    () => {
      selectedMember = "hero";
      navigate("equipment");
    },
  )}${button("公主装备", () => {
    selectedMember = "princess";
    navigate("equipment");
  })}</div></div><div class="tabs">${Object.entries(slots)
    .map(([id, text]) =>
      button(
        text,
        () => {
          filter = id;
          render();
        },
        filter === id ? "active" : "",
        false,
        `data-focus="filter-${id}"`,
      ),
    )
    .join("")}</div><div class="cards-grid gear-grid">${
    config.Rules.Equipment.filter(
      (g) =>
        snap.equipment.includes(g.Id) &&
        (filter === "all" || filter === g.Slot),
    )
      .map((g) => {
        const owner = snap.members.find((m) =>
          Object.values(m.equipment).includes(g.Id),
        );
        return `<article class="info-card"><div class="card-heading"><h3>${g.Name}</h3><span class="tag">${owner ? name(owner.id) + "使用中" : "可装备"}</span></div><p class="bonuses">${bonuses(g)}</p><p>${esc(g.ModernDescription)}</p><p class="small">${g.Wearer === "hero" ? "主角专用" : g.Wearer === "princess" ? "公主专用" : "两位人类通用"} · ${slots[g.Slot]}</p><div class="button-row">${button(
          "换装对比",
          () => {
            const id = ["hero", "princess"].includes(g.Wearer)
              ? g.Wearer
              : selectedMember === "princess"
                ? "princess"
                : "hero";
            equipConfirm(id, g.Id);
          },
          "primary",
        )}${command({ type: "sell", id: g.Id, quantity: 1 }, "出售", `出售${g.Name}，获得${config.Economy.SellPrices[g.Id] ?? 0}金币。`, "", !!owner || config.StartingEquipment.includes(g.Id) || !config.Economy.SellPrices[g.Id])}</div></article>`;
      })
      .join("") || '<p class="empty">该分类暂时没有装备。</p>'
  }</div>`;
}
function shopPage() {
  return `<div class="section-intro"><div><h2>为下一战做好准备</h2><p>击败10 / 20 / 30层Boss解锁新阶段。有限库存不会因刷新补充。</p></div><span class="tag">当前阶段 ${snap.shopStage} · ◈ ${snap.gold}</span></div><div class="shop-list">${config.Economy.Offers.map(
    (o) => {
      const g = config.Rules.Equipment.find((g) => g.Id === o.Item),
        locked = o.Stage > snap.shopStage,
        unsupported = !!g && !engine.gearSupported(g),
        stock = engine.quoteBuy(o.Id, 1)!.stock;
      return `<article class="shop-row ${locked || unsupported ? "locked" : ""}"><div class="item-symbol">${g ? "⚔" : o.Item === "herb" ? "❧" : o.Item === "revive" ? "✦" : "♧"}</div><div class="shop-info"><h3>${name(o.Item)} ${o.Amount > 1 ? "×" + o.Amount : ""}</h3><p>${g ? bonuses(g) : itemDescription(o.Item)}</p><p class="small">${g ? esc(g.ModernDescription) : "道具在战外使用"} · 持有 ${g ? (snap.equipment.includes(g.Id) ? 1 : 0) : (snap.items[o.Item] ?? 0)} · 库存 ${stock < 0 ? "不限" : stock}</p></div><div class="shop-buy"><b>◈ ${o.Price}</b>${button(locked ? `Boss阶段${o.Stage}解锁` : unsupported ? "技能迁移中" : stock === 0 ? "已售罄" : "购买", () => buyDialog(o.Id), "", locked || unsupported || stock === 0 || snap.gold < o.Price)}</div></article>`;
    },
  ).join("")}</div>`;
}
function itemDescription(id: string) {
  return (
    {
      herb: "恢复单名存活伙伴生命；具体恢复量见使用预览。",
      revive: "复活倒下伙伴，恢复其最大生命的四分之一。",
      xp_potion: "提供25经验，相当于1小瓶单位。",
      xp_potion_m: "提供100经验，相当于4小瓶单位，可找零。",
      xp_potion_l: "提供500经验，相当于20小瓶单位，可找零。",
      shell: "击败敌人掉落的硬壳，可在商店出售换取金币。",
    }[id] ?? ""
  );
}
function buyDialog(id: string) {
  const o = config.Economy.Offers.find((o) => o.Id === id)!;
  const d = dialog(
    "购买确认",
    `<h3>${name(o.Item)}</h3><p>${itemDescription(o.Item) || config.Rules.Equipment.find((g) => g.Id === o.Item)?.ModernDescription}</p><label class="quantity-label">购买数量 <input id="buy-quantity" type="number" min="1" max="100" step="1" value="1" inputmode="numeric"></label><div id="buy-quote" class="quote"></div><div class="dialog-actions"><button data-cancel>取消</button><button data-confirm class="primary">确认购买</button></div>`,
  );
  const input = d.querySelector<HTMLInputElement>("#buy-quantity")!,
    confirm = d.querySelector<HTMLButtonElement>("[data-confirm]")!;
  const update = () => {
    const quote = engine.quoteBuy(id, Number(input.value));
    d.querySelector("#buy-quote")!.innerHTML = quote
      ? `<p>获得数量 <b>${quote.amount}</b> · 合计 <b>◈ ${quote.total}</b></p><p>购买后余额 <b>${quote.balance}</b> · 剩余库存 ${quote.stock < 0 ? "不限" : quote.stock}</p>`
      : "请输入1—100的整数数量。";
    confirm.disabled =
      !quote ||
      quote.balance < 0 ||
      (quote.stock >= 0 && Number(input.value) > quote.stock);
  };
  input.addEventListener("input", update);
  update();
  d.querySelector("[data-cancel]")!.addEventListener("click", () => d.close());
  confirm.addEventListener("click", () => {
    const quantity = Number(input.value);
    d.close();
    send({ type: "buy", id, quantity });
  });
}
function itemsPage() {
  return `<div class="section-intro"><p>恢复没有免费捷径。使用前先查看目标和实际恢复量。</p>${nav("shop", "补充道具 →")}</div><div class="cards-grid">${Object.entries(
    itemNames,
  )
    .map(
      ([id, label]) =>
        `<article class="info-card"><div class="card-heading"><h3>${label}</h3><span class="item-count">×${snap.items[id] ?? 0}</span></div><p>${itemDescription(id)}</p>${id === "herb" || id === "revive" ? button("选择使用目标", () => itemDialog(id), "primary", (snap.items[id] ?? 0) <= 0) : id === "shell" ? command({ type: "sell", id, quantity: 1 }, "出售1份 · 10金币", "出售1份硬壳，获得10金币。", "", (snap.items[id] ?? 0) <= 0) : nav("party", "选择伙伴培养 →")}</article>`,
    )
    .join("")}</div>`;
}
function itemDialog(item: "herb" | "revive") {
  const d = dialog(
    "选择使用目标",
    snap.members
      .map(
        (m) =>
          `<article class="item-target"><div><h3>${name(m.id)}</h3><p>${m.hp} / ${m.attributes.MaxHp} → 实际恢复 ${m.itemRecovery[item]}</p></div><button data-member="${m.id}" ${!m.itemRecovery[item] ? "disabled" : ""}>使用${itemNames[item]}</button></article>`,
      )
      .join(""),
  );
  d.querySelectorAll<HTMLButtonElement>("[data-member]").forEach((el) =>
    el.addEventListener("click", () => {
      const m = snap.members.find((m) => m.id === el.dataset.member)!;
      d.close();
      confirmAction(
        "使用道具",
        `消耗1份${itemNames[item]}，为${name(m.id)}恢复${m.itemRecovery[item]}生命。`,
        () => send({ type: "item", id: m.id, item }),
      );
    }),
  );
}
function innPage() {
  const need = snap.members.some((m) => m.restRecovery > 0);
  return `<div class="inn-hero"><div class="moon" aria-hidden="true">☾</div><div><p class="eyebrow">A MOMENT OF REST</p><h2>在林间，歇一歇。</h2><p>恢复全队生命，复活倒下的伙伴。<br>存活者保留能量；倒下者复活后能量为0。</p></div><div class="inn-price"><small>本次住宿</small><b>◈ ${snap.innPrice}</b><span>余额 ${snap.gold} 金币</span></div></div><div class="section-caption">恢复预览 <span>确认后才扣费</span></div><div class="rest-list">${snap.members.map((m) => `<article>${portrait(m.id)}<div><h3>${name(m.id)}</h3><p>${m.hp} → ${m.attributes.MaxHp} <span class="delta">+${m.restRecovery}</span></p><p class="small">能量 ${Math.floor(m.energy)} → ${m.hp > 0 ? Math.floor(m.energy) : 0}</p></div><span class="tag">${m.hp === 0 ? "复活" : m.restRecovery > 0 ? "恢复生命" : "生命已满"}</span></article>`).join("")}</div><div class="page-actions"><p>${need ? (snap.gold < snap.innPrice ? "金币不足，可以出售多余战利品。" : "过层、Boss与通关都不会免费恢复。") : "全队生命已满，无需支付住宿费用。"}</p>${command({ type: "rest" }, "确认住宿", `支付${snap.innPrice}金币，为全队恢复生命并复活倒下伙伴。`, "primary large", !need || snap.gold < snap.innPrice)}</div>`;
}
function codexPage() {
  return `<div class="section-intro"><p>40个物种的当前属性与成长资料。图鉴中的存在不代表本版已经开放获取。</p><label class="search">查找物种 <input id="codex-search" value="${esc(codexFilter)}" placeholder="名称 / 定位" aria-label="查找物种"></label></div><div id="codex-list" class="cards-grid codex-grid">${codexCards()}</div>`;
}
function codexCards() {
  return (
    config.Species.filter((s) =>
      `${s.Name} ${config.Rules.Species[s.Id]!.PrimaryRole} ${config.Rules.Species[s.Id]!.Tier}`.includes(
        codexFilter,
      ),
    )
      .map((s) => {
        const p = config.Rules.Species[s.Id]!,
          a = config.Rules.Combatants[s.Id]!.Base,
          profile = config.Rules.Profiles[s.Id]!;
        return `<article class="info-card"><div class="member-top">${portrait(s.Id)}<div><h3>${s.Name}</h3><p>${p.Tier} · ${p.PrimaryRole} / ${p.SecondaryRoles.join("、")}</p></div></div><div class="codex-stats"><span>生命 <b>${a.MaxHp}</b></span><span>攻击 <b>${a.Attack}</b></span><span>防御 <b>${a.Defense}</b></span><span>法术 <b>${a.Magic}</b></span><span>魔抗 <b>${a.Resistance}</b></span><span>移速 <b>${p.MoveSpeed}</b></span></div><p>${esc(profile.AutoDescription)}</p><p>${esc(profile.UltimateDescription)}</p><p class="small">${esc(p.Specialty)}</p>${button("属性 / 成长详情", () => dialog(s.Name, `<p>${p.Tier} · ${p.PrimaryRole} · 射程 ${p.AttackRange} · 半径 ${p.Radius}</p>${attributes(a)}<h3>每级成长</h3>${attributes(config.Rules.Combatants[s.Id]!.Growth)}<p>${esc(profile.PassiveDescription)}</p><p>等级上限30 · 经验需求 ${p.LevelCosts.join(" / ")}</p>`), "subtle wide")}</article>`;
      })
      .join("") || '<p class="empty">没有找到符合条件的物种。</p>'
  );
}
function recordsPage() {
  return `<div class="section-intro"><p>仅记录实际胜利并确认的楼层；独立Play不计入正式通关。</p><span class="tag">${snap.records.length} 层实际通过</span></div>${snap.records.length ? snap.records.map((r) => `<article class="info-card"><div class="card-heading"><h3>第${r.floor}层 · ${config.Encounters.find((e) => e.Id === config.Floors[r.floor - 1]!.Encounter)!.Title}</h3><span class="tag">胜利 · ${(r.seconds??r.ticks*.05).toFixed(2)}秒</span></div><p>金币 +${r.gold} · 奖励已结算</p>${contributions(r.contributions)}${button("查看行动明细",()=>recordDetails(r),"subtle")}</article>`).join("") : '<div class="empty"><span>✧</span><h2>第一场胜利，尚在前方。</h2><p>从试炼之塔开始，战斗结果会记在这里。</p></div>'}`;
}
function recordDetails(r:Snapshot["records"][number]) {
  dialog(`第${r.floor}层 · 行动明细`,`<p>能量为实际获得量；大招、暴击、闪避和受打断次数由战斗核心记录。</p><div class="table-scroll"><table><thead><tr><th>伙伴</th><th>出手回能</th><th>受击回能</th><th>击杀回能</th><th>大招</th><th>暴击</th><th>闪避</th><th>受打断</th><th>硬直</th></tr></thead><tbody>${r.contributions.map(u=>`<tr><th>${name(u.id)}</th><td>${Math.floor(u.attackEnergy)}</td><td>${Math.floor(u.hurtEnergy)}</td><td>${Math.floor(u.killEnergy)}</td><td>${u.ultimates}</td><td>${u.criticals}</td><td>${u.dodges}</td><td>${u.interrupts}</td><td>${u.staggers}</td></tr>`).join("")}</tbody></table></div>`,d=>d.classList.add("record-detail-dialog"));
}
function contributions(
  rows: { id: string; damage: number; healing: number; absorbed: number }[],
) {
  return `<div class="table-scroll"><table><thead><tr><th>伙伴</th><th>实际伤害</th><th>有效治疗</th><th>护盾吸收</th></tr></thead><tbody>${rows.map((r) => `<tr><th>${name(r.id)}</th><td>${r.damage}</td><td>${r.healing}</td><td>${r.absorbed}</td></tr>`).join("")}</tbody></table></div>`;
}
function settingsPage() {
  return `<div class="settings-layout"><section><div class="section-caption">本机独立存档</div><article class="info-card"><h3>${saveStatus}</h3><p>操作后与战斗中自动保存。存档记录种子、tick、操作序列和配表指纹，导入时由核心重放校验。</p><p class="small">种子 ${snap.seed} · tick ${snap.tick} · 命令 ${snap.sequence}<br>配表 ${snap.configHash}</p><div class="button-row">${button(
    "立即保存",
    () =>
      saveHold
        ? confirmAction(
            "替换损坏存档",
            "会用当前试跑替换无法读取的存档。请先导出故障原件。",
            () => {
              saveHold = false;
              queueSave();
            },
          )
        : queueSave(),
    "primary",
  )}${button("导出存档 JSON", exportSave)}${damagedSave ? button("导出故障原件", () => downloadJson(damagedSave!, "tower30-damaged-original.json")) : ""}${button(
    "导入存档",
    () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) void importSave(file);
      });
      input.click();
    },
  )}</div></article><article class="info-card"><h3>开始新的试跑</h3><p>从初始两人、240金币、3草药与1复活羽重新开始。开始前建议导出当前存档。</p><label>随机种子 <input id="new-seed" type="number" min="1" max="4294967295" value="2463534242"></label>${button(
    "新建试跑",
    () => {
      const seed = Number(
        document.querySelector<HTMLInputElement>("#new-seed")!.value,
      );
      if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) {
        toast("请输入1—4294967295的整数种子");
        return;
      }
      confirmAction(
        "新建试跑",
        "当前本机进度会被新试跑替换。请确认已导出需要保留的存档。",
        () => {
          engine = new TowerEngine(config, seed);
          saveHold = false;
          refresh();
          selectedFloor = 1;
          showClearedFloor=false;
          page = "tower";
          history.length = 0;
          render();
          queueSave();
        },
      );
    },
    "danger",
  )}</article></section><section><div class="section-caption">首版试玩说明</div><article class="info-card"><h3>M3 · 完整30层资源流程</h3><p>已接通：固定60 tick/秒、移动碰撞、动作前后摇、在途投射物、普攻与自动技能、1000能量手动大招、收集、战报与操作重放存档。</p><p>可试用：基础商店、装备对比、道具、付费旅馆、药水升级与找零。正式30层及全部现行装备已开放。</p><p>已支持：配表与策略编辑、多关批量模拟、胜率统计与配置对比。</p></article><article class="info-card"><h3>操作方式</h3><p>自动普攻和自动技能不需要操作。能量达到1000时，点击伙伴卡片施放大招。暂停后可在调试栏单步推进；倍速只改变调度速度。</p><p>键盘：Tab切换焦点，Enter确认，Esc关闭弹窗；战场按空格暂停。切到后台后保持暂停，返回时手动继续。</p><p>所有资源与胜负均由本机核心计算，无游戏后端。</p></article></section></div>`;
}
function downloadJson(json: string, filename: string) {
  const blob = new Blob([json], { type: "application/json" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportSave() {
  downloadJson(
    engine.serialize(),
    `tower30-floor${snap.floor}-tick${snap.tick}.json`,
  );
}
async function importSave(file: File) {
  try {
    if (file.size > 2_000_000) throw new Error("存档超过2MB");
    const restored = TowerEngine.restore(config, await file.text()),
      s = restored.getSnapshot();
    confirmAction(
      "导入存档",
      `将替换为第${s.floor}层、${s.gold}金币的试跑。导入后战斗保持暂停。`,
      () => {
        engine = restored.upgradeTo60Hz();
        saveHold = false;
        refresh();
        page = snap.battle ? "battle" : "tower";
        selectedFloor = Math.min(snap.floor, 30);
        showClearedFloor=false;
        paused = true;
        clock.reset();
        history.length = 0;
        render();
        queueSave();
      },
    );
  } catch (e) {
    toast(
      `导入失败，当前进度未改变：${e instanceof Error ? e.message : "格式无效"}`,
    );
  }
}
function battlePage() {
  const b = snap.battle!;
  return `<div class="battle-toolbar"><div>${snap.mode === "playtest" ? `<span class="test-label">TEST · 第${snap.floor}关 · ${snap.playtest?.autoPlay?"策略自动执行":"手动大招"}</span>` : ""}<b id="battle-time">0.00s</b><span> / 300s</span><span class="battle-ticket">补人票 <b id="battle-tickets">${b.tickets}</b> / 3</span></div><div class="button-row">${snap.mode === "playtest" ? button("返回编辑", openEditor, "light") + button("重新 Play", () => startPlaytest(config, snap.playtest!), "light") + (!b.result?button("导出测试记录",()=>{paused=true;clock.reset();render();exportSave();},"light"):"") : ""}${button(paused ? "继续" : "暂停", () => togglePause(), "light", !!b.result, 'id="pause-button"')}${button(
    `${speed}× 速度`,
    () => {
      speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
      clock.reset();
      const el = document.querySelector("#speed-button");
      if (el) el.textContent = `${speed}× 速度`;
    },
    "light",
    false,
    'id="speed-button"',
  )}${button("撤回", () => confirmAction("撤回战斗", "不发放奖励，返回战前检查点后可重新挑战。", () => send({ type: "withdraw" })), "light", !b.started || !!b.result)}</div></div><div class="arena-wrap">${snap.mode === "playtest" && snap.skippedFeatures.length ? `<details class="test-warnings"><summary>已停用 ${snap.skippedFeatures.length} 项未迁移功能</summary><p>${snap.skippedFeatures.map(esc).join("<br>")}</p></details>` : ""}<div id="enemy-casts" class="enemy-cast-warning" role="status" hidden></div><canvas id="battle-canvas" aria-label="实时战场：双方移动、攻击与投射物"></canvas>${!b.started ? `<div class="deployment"><div class="deployment-card"><span class="tag">战前布阵 · 5首发 / 10在场</span><h2>准备好了吗？</h2><p>人类固定首发，怪兽可在此选择。<br>战斗自动进行，满1000能量后手动释放大招。</p><div class="opening-options">${snap.members.map((m) => button(`${name(m.id)} ${b.opening.includes(m.id) ? "✓" : "加入"}`, () => send({ type: "opening", id: m.id }), b.opening.includes(m.id) ? "selected" : "", isHuman(m.id) || m.hp <= 0)).join("")}</div>${command({ type: "start" }, "开始交战 →", undefined, "primary large")}${command({ type: "retry" }, "返回整备", undefined, "subtle")}</div></div>` : ""}${b.result ? resultOverlay() : ""}</div><div class="battle-roster">${b.units
    .filter((u) => !u.enemy)
    .map((u) =>
      button(
        `<div class="battle-unit-top">${portrait(u.kind)}<div><b>${name(u.id)}</b><span id="unit-status-${u.id}">自动交战</span></div></div><div class="metric"><span>HP</span><b id="unit-hp-${u.id}">${u.hp}</b></div><div class="bar health"><i id="unit-health-${u.id}"></i></div><div class="bar energy"><i id="unit-energy-${u.id}"></i></div><div class="ult-caption" id="unit-ult-${u.id}">蓄能中</div>`,
        () => send({ type: "ultimate", id: u.id }),
        "battle-unit",
        false,
        `data-unit="${u.id}" aria-label="${name(u.id)}大招"`,
      ),
    )
    .join("")}${snap.members
    .filter((m) => !b.units.some((u) => u.id === m.id))
    .map((m) =>
      button(
        `${portrait(m.id)}<b>${name(m.id)}</b><span>${b.started ? "点击补人" : "等待出场"}</span>`,
        () => send({ type: "reinforce", id: m.id }),
        "battle-unit reserve",
        !b.started || isHuman(m.id) || m.hp <= 0 || b.tickets < 1 || b.units.filter(u=>!u.enemy&&u.hp>0).length>=10,
        `data-reserve="${m.id}"`,
      ),
    )
    .join(
      "",
    )}</div><details class="debug"><summary>调试 · 固定步长 / 战斗事件</summary><div class="debug-content">${button(
    "单步 1/60秒",
    () => {
      if (!paused) {
        toast("请先暂停战斗");
        return;
      }
      advancePlaytest(engine,1);
      refresh();visualSeconds=snap.battle?.seconds??visualSeconds;
      updateBattleHud();
      if (snap.battle?.result) render();
      queueSave();
    },
    "light",
    !b.started || !!b.result,
  )}<span id="frame-metrics">逻辑60Hz</span><span>tick <b id="debug-tick">${snap.tick}</b> · seed ${snap.seed}</span><label>事件类型<select id="event-kind" aria-label="事件类型">${[["all","全部事件"],["hit","命中"],["heal","治疗"],["ward","护盾"],["charge","大招吟唱"],["cancel","动作打断"],["control","控制"],["launch","弹道发射"]].map(([v,l])=>`<option value="${v}" ${eventKindFilter===v?"selected":""}>${l}</option>`).join("")}</select></label><label>角色 / 目标<input id="event-actor" aria-label="事件角色或目标" placeholder="名称或ID" maxlength="100" value="${esc(eventActorFilter)}"></label><span class="event-window">最近64条事件 · 暂停可查看</span><code id="debug-events" role="log"></code></div></details>`;
}
function resultOverlay() {
  const b = snap.battle!,
    win = b.result === "victory";
  if (snap.mode === "playtest")
    return `<div class="result-overlay"><div class="result-card"><p class="eyebrow">PLAYTEST RESULT · ${snap.configHash}</p><h2>${win ? "测试胜利" : b.result === "loss" ? "测试失败" : "测试已撤回"}</h2><p>第${snap.floor}关 · ${b.seconds.toFixed(3)}秒 · 独立测试，不发放奖励或推进正式进度</p>${contributions(b.units.filter((u) => !u.enemy))}<p>${snap.skippedFeatures.length ? `本次停用了${snap.skippedFeatures.length}项未迁移功能。` : "本次使用的技能均已实现。"}</p><div class="button-row">${button("返回编辑", openEditor, "primary")}${button("重新 Play", () => startPlaytest(config, snap.playtest!))}${button("导出测试记录", exportSave)}</div></div></div>`;
  return `<div class="result-overlay"><div class="result-card"><p class="eyebrow">${win ? "FLOOR CLEARED" : "TRIAL PAUSED"}</p><h2>${win ? (snap.floor===30?"风暴祭司已击败":"赢下这一战。") : b.result === "loss" ? "队伍暂时倒下。" : "已撤回战斗。"}</h2><p>第${snap.floor}层 · ${b.seconds.toFixed(3)}秒${win ? ` · 通关金币 +${config.Encounters.find((e) => e.Id === config.Floors[snap.floor - 1]!.Encounter)!.Gold}` : " · 未发放奖励"}</p>${contributions(b.units.filter((u) => !u.enemy).map((u) => ({ id: u.id, damage: u.damage, healing: u.healing, absorbed: u.absorbed })))}${win ? `<p>魂魄、药水与首次收集已按规则结算。<br>${snap.floor===30?"生命不恢复；确认后领取金币并记录30层通关。":"生命不恢复；确认后领取金币并进入下一层。"}</p>${command({ type: "finish" }, snap.floor===30?"确认通关 · 查看记录":"确认战果 · 返回整备", undefined, "primary large")}` : `<p>返回该层战前检查点；战前已确认的交易保留。</p>${command({ type: "retry" }, "返回战前整备", undefined, "primary large")}`}</div></div>`;
}
function togglePause() {
  if (!snap.battle?.started || snap.battle.result) return;
  paused = !paused;
  clock.reset();
  const el = document.querySelector("#pause-button");
  if (el) el.textContent = paused ? "继续" : "暂停";
  if (paused) {visualSeconds=snap.battle?.seconds??visualSeconds;queueSave();}
}
function updateBattleHud() {
  const b = snap.battle;
  if (!b) return;
  const roster=document.querySelector<HTMLElement>(".battle-roster");
  if(roster && b.units.some(u=>!u.enemy&&!document.getElementById(`unit-hp-${u.id}`))){
    const scroll=roster.scrollLeft,debugOpen=document.querySelector<HTMLDetailsElement>(".debug")?.open??false;
    render();
    const updated=document.querySelector<HTMLElement>(".battle-roster"),debug=document.querySelector<HTMLDetailsElement>(".debug");
    if(updated)updated.scrollLeft=scroll;if(debug)debug.open=debugOpen;
    return;
  }
  const time = document.querySelector("#battle-time");
  if (time) time.textContent = `${b.seconds.toFixed(3)}s`;
  const tickets = document.querySelector("#battle-tickets");
  if (tickets) tickets.textContent = String(b.tickets);
  for (const u of b.units.filter((u) => !u.enemy)) {
    const hp = document.getElementById(`unit-hp-${u.id}`),
      health = document.getElementById(`unit-health-${u.id}`),
      energy = document.getElementById(`unit-energy-${u.id}`),
      ult = document.getElementById(`unit-ult-${u.id}`),
      status = document.getElementById(`unit-status-${u.id}`),
      button = document.querySelector<HTMLButtonElement>(
        `[data-unit="${u.id}"]`,
      );
    if (hp) hp.textContent = `${u.hp} / ${u.attributes.MaxHp}`;
    if (health) health.style.width = `${(u.hp / u.attributes.MaxHp) * 100}%`;
    if (energy) energy.style.width = `${(u.energy / 1000) * 100}%`;
    if (ult)
      ult.textContent = !supportedSkills.has(u.profile.Ultimate)
        ? "大招尚未迁移"
        : u.hp === 0
          ? "已倒下"
          : u.energy >= 1000
            ? `释放 · ${skill(u.profile.Ultimate)}`
            : `能量 ${Math.floor(u.energy)} / 1000`;
    if (status)
      status.textContent =
        u.action?.kind === "ultimate"
          ? "大招吟唱"
          : u.entry > 0
            ? "正在入场"
            : u.action?.kind === "auto"
              ? "自动技能"
              : u.stun > 0 ? "眩晕中"
                : u.silence > 0 ? "沉默中"
                : u.root > 0 ? "扎根中"
                : u.weaken > 0 ? "输出弱化"
                : u.physicalGuard > 0 ? "物理防护"
                : u.spellGuard > 0 ? "法术防护"
                : u.slow > 0 ? "减速中" : "自动交战";
    if (button) {
      button.disabled =
        !!b.result ||
        u.hp <= 0 || u.entry > 0 || u.stun > 0 || u.silence > 0 || u.hitStun > 0 || u.action?.kind === "ultimate" ||
        u.energy < 1000 ||
        !supportedSkills.has(u.profile.Ultimate);
      button.classList.toggle("ready", u.energy >= 1000 && u.hp > 0);
    }
  }
  for (const el of document.querySelectorAll<HTMLButtonElement>("[data-reserve]")) {
    const m=snap.members.find(m=>m.id===el.dataset.reserve);
    el.disabled=!!b.result || !b.started || !m || m.hp<=0 || b.tickets<1 || b.units.filter(u=>!u.enemy&&u.hp>0).length>=10;
  }
  const enemyCasts=document.querySelector<HTMLElement>("#enemy-casts");
  if(enemyCasts){
    const casts=b.result?[]:b.units.filter(u=>u.enemy&&u.hp>0&&u.action?.kind==="ultimate");
    enemyCasts.hidden=casts.length===0;
    enemyCasts.textContent=casts.slice(0,3).map(u=>`${rawName(u.kind)} · ${skill(u.action!.skill)} · ${u.charge.toFixed(1)}秒`).join(" / ");
  }
  const metrics=document.querySelector("#frame-metrics");
  if(metrics)metrics.textContent=`逻辑 ${snap.logicHz}Hz · 画面 ${Math.round(frameFps)}FPS · 每步 ${logicMs.toFixed(2)}ms`;
  const debug = document.querySelector("#debug-tick");
  if (debug) debug.textContent = String(snap.tick);
  const events = document.querySelector("#debug-events");
  if (events)
    events.textContent = snap.events
      .filter(e=>eventKindFilter==="all"||e.kind===eventKindFilter)
      .filter(e=>!eventActorFilter||`${e.actor} ${e.target} ${rawName(snap.battle?.units.find(u=>u.id===e.actor)?.kind??e.actor)} ${rawName(snap.battle?.units.find(u=>u.id===e.target)?.kind??e.target)}`.toLowerCase().includes(eventActorFilter.toLowerCase()))
      .map(
        (e) =>
          `#${e.id} T${e.tick} ${e.kind} ${e.actor} → ${e.target} ${e.amount || ""}`,
      )
      .join("\n");
}
function frame(time: number) {
  const delta = lastTime ? Math.max(0,(time-lastTime)/1000) : 0;
  lastTime=time;
  if(delta>0)frameFps=frameFps?frameFps*.9+(.1/delta):1/delta;
  if(page==="battle"&&snap.battle){
    if(snap.battle.started&&!snap.battle.result&&!paused&&!document.hidden){
      // An unserviceable interruption is an explicit pause, never skipped simulation ticks.
      if(delta>.5){paused=true;visualSeconds=snap.battle.seconds;clock.reset();render();queueSave();toast("画面长时间停顿，战斗已暂停；点击继续。");}
      else {
        clock.add(delta,speed);visualSeconds+=delta*speed;
        const ticks=clock.take();
        if(ticks>0){
          const start=performance.now();
          if(ticks>1)advancePlaytest(engine,ticks-1);
          const beforeLastTick=engine.getBattleSnapshot();
          advancePlaytest(engine,1);logicMs=(performance.now()-start)/ticks;
          refresh();previous=beforeLastTick;
          updateBattleHud();
          if(snap.battle?.result){paused=true;visualSeconds=snap.battle.seconds;render();queueSave();}
          else if(snap.tick-lastSaveTick>=60){lastSaveTick=snap.tick;queueSave();}
        }
        if(clock.pendingSeconds>.5){paused=true;visualSeconds=snap.battle.seconds;clock.reset();render();queueSave();toast("逻辑处理未能跟上，已暂停；可降低倍速后继续。");}
      }
    }
    if(snap.battle.result==="victory"&&!document.hidden)visualSeconds+=delta;
    const canvas=document.querySelector<HTMLCanvasElement>("#battle-canvas");
    if(canvas)drawBattle(canvas,snap,previous,paused?1:clock.alpha,paused&&!!snap.battle?.started,rawName,visualSeconds);
  }
  requestAnimationFrame(frame);
}
app.addEventListener("pointerdown", () => {}, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    paused = true;
    clock.reset();
    lastTime = 0;
    const el = document.querySelector("#pause-button");
    if (el) el.textContent = "继续";
    queueSave();
  }
});
document.addEventListener("keydown", (e) => {
  if (
    e.code === "Space" &&
    page === "battle" &&
    !document.querySelector("dialog[open]") &&
    !["BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY"].includes(
      (e.target as HTMLElement).tagName,
    )
  ) {
    e.preventDefault();
    togglePause();
  }
});
window.addEventListener("pagehide", () => queueSave());
async function boot() {
  try {
    const saves = await readSaves();
    let loadError = false;
    for (const [index, json] of [saves.current, saves.backup].entries()) {
      if (!json) continue;
      try {
        engine = TowerEngine.restore(config, json).upgradeTo60Hz();
        saveStatus = index === 0 ? "已恢复本机存档" : "已从备份恢复";
        keepBackupOnce = index === 1;
        loadError = false;
        break;
      } catch {
        loadError = true;
        damagedSave ??= json;
      }
    }
    if (loadError) {
      saveStatus = "原存档无法读取 · 未覆盖";
      storageFailed = true;
      saveHold = true;
      toast("现有存档校验失败，未覆盖。请在存档页导出当前试跑后再操作。");
    }
  } catch {
    saveStatus = "存储不可用 · 请导出";
    storageFailed = true;
  }
  normalEngine = engine;
  await workbench.load();
  try {
    const raw = await readWorkbench("session");
    if (raw) {
      const session: unknown = JSON.parse(raw);
      if (
        session &&
        typeof session === "object" &&
        "active" in session &&
        session.active === true &&
        "serialized" in session &&
        typeof session.serialized === "string"
      ) {
        const restored = TowerEngine.restorePlaytest(session.serialized);
        engine = restored.upgradeTo60Hz();
        config = restored.getConfigSnapshot();
        lastTestJson = engine.serialize();
        saveStatus = "已恢复独立测试";
      }
    }
  } catch {
    toast("上次测试记录无法恢复，正式试跑和草稿仍保留。");
  }
  refresh();
  visualSeconds=snap.battle?.seconds??0;
  booted = true;
  page = snap.battle ? "battle" : "tower";
  selectedFloor = Math.min(snap.floor, 30);
  render();
  requestAnimationFrame(frame);
}
void boot();
