import {defaultStrategy,strategySchema,type BattleStrategy} from "../core/strategy";
import {strategySummary} from "./strategy-editor";
import {z} from "zod";
import {validateConfig,type Config} from "../core/config";
import {TowerEngine} from "../core/engine";
import {clone} from "../core/math";
import type {PlaytestSetup} from "../core/playtest";
import {createSimulationReport,simulationOptionsSchema,simulationFloorsSchema,simulationTotal,reportFloors,summarizeTrials,summarizePairs,summarizeFloors,trialSave,type SimulationOptions,type SimulationReport,type SimulationPair} from "../core/simulation";
import {readWorkbench,writeWorkbench} from "../storage/save";

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const f=(n:number|null,d=1)=>n===null?"—":n.toFixed(d);
const percent=(n:number|null)=>n===null?"—":(n*100).toFixed(1)+"%";
const outcome=(value:string)=>value==="victory"?"胜利":value==="loss"?"失败":"超时";
const PAGE_SIZE=20;
type SampleFilter="all"|"a-failed"|"b-failed"|"any-failed";
export class Comparison {
  private reference:Config;
  private label="原始基线";
  private referenceStrategy:BattleStrategy=defaultStrategy();
  private referenceHash:string;
  private options:SimulationOptions={count:10,policy:"adaptive",reinforce:true};
  private selectedFloors:number[]|null=null;
  private report:SimulationReport|null=null;
  private worker:Worker|null=null;
  private renderTimer:number|null=null;
  private detailFloor=0;
  private sampleFilter:SampleFilter="all";
  private samplePage=0;
  private message="先保存A配置，再调整草稿B；两者统一使用当前测试设置。";
  private writes=Promise.resolve();
  constructor(config:Config,private readonly changed:(focus?:string)=>void,private readonly notify:(message:string)=>void,private readonly download:(source:unknown,name:string)=>void,private readonly onPlay:(config:Config,setup:PlaytestSetup)=>void,private readonly onReview:(serialized:string)=>void){this.reference=clone(config);this.referenceHash=new TowerEngine(config).configHash;}
  async load(){
    try{
      const raw=await readWorkbench("comparison");if(!raw)return;
      if(raw.length>2_000_000)throw new Error("A配置过大");
      const saved:unknown=JSON.parse(raw);
      if(!saved || typeof saved!=="object" || !("format" in saved) || saved.format!=="tower30-comparison-reference" || !("source" in saved))throw new Error("A配置格式无效");
      this.reference=validateConfig(saved.source);this.referenceHash=new TowerEngine(this.reference).configHash;this.label="保存的配置";this.message="已恢复浏览器保存的A配置；当前草稿为B。";
      if("strategy" in saved)this.referenceStrategy=strategySchema.parse(saved.strategy);
      if("options" in saved){const result=simulationOptionsSchema.safeParse(saved.options);if(result.success)this.options=result.data;}
      if("floors" in saved&&saved.floors!==null){if(Array.isArray(saved.floors)&&!saved.floors.length)this.selectedFloors=[];else this.selectedFloors=simulationFloorsSchema.parse(saved.floors).sort((a,b)=>a-b);}
    }catch{this.notify("批测偏好读取失败，可重新选择关卡；正式试跑未改变。");}
  }
  private floors(setup:PlaytestSetup){return this.selectedFloors??[setup.floor];}
  input(el:HTMLInputElement|HTMLSelectElement,setup:PlaytestSetup){
    const key=el.dataset.sim;
    if(this.worker&&["count","policy","reinforce","floor"].includes(key??""))return;
    if(key==="count")this.options.count=el.value===""?0:Number(el.value);
    if(key==="policy")this.options.policy=el.value as SimulationOptions["policy"];
    if(key==="reinforce"&&el instanceof HTMLInputElement)this.options.reinforce=el.checked;
    if(key==="floor"&&el instanceof HTMLInputElement){
      const floor=Number(el.dataset.floor),selected=new Set(this.floors(setup));
      if(el.checked)selected.add(floor);else selected.delete(floor);
      this.selectedFloors=[...selected].sort((a,b)=>a-b);this.changed();
    }
    if(key==="detail-floor"){this.detailFloor=Number(el.value);this.samplePage=0;this.changed("detail");return;}
    if(key==="sample-filter"){this.sampleFilter=el.value as SampleFilter;this.samplePage=0;this.changed("detail");return;}
    if(simulationOptionsSchema.safeParse(this.options).success)this.persistReference(false);
    if(key!=="floor")this.changed();
  }
  private persistReference(showMessage=true){
    const text=JSON.stringify({format:"tower30-comparison-reference",source:this.reference,strategy:this.referenceStrategy,options:this.options,floors:this.selectedFloors});
    this.writes=this.writes.catch(()=>{}).then(()=>writeWorkbench("comparison",text));
    void this.writes.then(()=>{if(showMessage){this.message="A配置已保存到此浏览器。";this.changed();}}).catch(()=>{this.message="批测偏好保存失败，请导出配置备份。";this.changed();});
  }
  private redraw(immediate=false){
    if(immediate){if(this.renderTimer!==null)window.clearTimeout(this.renderTimer);this.renderTimer=null;this.changed();return;}
    if(this.renderTimer===null)this.renderTimer=window.setTimeout(()=>{this.renderTimer=null;this.changed();},150);
  }
  cancel(){
    if(!this.worker)return;
    this.worker.terminate();this.worker=null;
    if(this.report)this.report.status="cancelled";
    this.message="已取消，仅保留已完成的配对样本。";this.redraw(true);
  }
  action(action:string,source:unknown,setup:PlaytestSetup,id?:string){
    try{
      if(action==="select"){
        if(this.worker)throw new Error("请先取消当前模拟，再调整关卡");
        this.selectedFloors=id==="current"?null:id==="bosses"?[10,20,30]:id==="all"?Array.from({length:30},(_,i)=>i+1):[];
        this.persistReference(false);this.changed();return;
      }
      if(action==="show-floor"){this.detailFloor=Number(id);this.samplePage=0;this.changed("detail");return;}
      if(action==="previous-page"||action==="next-page"){this.samplePage=Math.max(0,this.samplePage+(action==="next-page"?1:-1));this.changed("detail");return;}
      if(action==="capture"){
        if(this.worker)throw new Error("请先取消当前模拟，再替换A配置");
        const strategy=strategySchema.parse(setup.strategy??defaultStrategy());
        this.reference=validateConfig(source);this.referenceStrategy=strategy;this.referenceHash=new TowerEngine(this.reference).configHash;this.label="保存的配置";this.persistReference();this.changed();return;
      }
      if(action==="cancel"){this.cancel();return;}
      if(action==="export"){
        if(!this.report)throw new Error("请先运行配对模拟");
        this.download({...this.report,summary:{a:summarizeTrials(this.report.pairs.map(p=>p.a)),b:summarizeTrials(this.report.pairs.map(p=>p.b)),paired:summarizePairs(this.report.pairs)},byFloor:summarizeFloors(this.report)},"tower30-comparison.json");return;
      }
      if(action==="reference"){this.download(this.reference,"tower30-reference-a.json");return;}
      if(action==="replay"||action==="play"||action==="auto-play"||action==="review"){
        const [variant,index]=id!.split(":") as ["a"|"b",string];
        const report=this.report;if(!report)throw new Error("样本不存在");
        const record=trialSave(report,variant,Number(index));
        if(action==="replay")this.download(record,`tower30-f${record.setup.floor}-${variant}-${record.setup.seed}-replay.json`);
        else if(action==="review"){this.cancel();this.onReview(JSON.stringify(record));}
        else{this.cancel();this.onPlay(report[variant].config,{...record.setup,autoPlay:action==="auto-play"});}
        return;
      }
      if(action!=="run")return;
      if(this.worker)throw new Error("已有模拟正在运行");
      const report=createSimulationReport(this.reference,source,setup,simulationOptionsSchema.parse(this.options),this.label,this.floors(setup),{a:this.referenceStrategy,b:strategySchema.parse(setup.strategy??defaultStrategy())});
      const worker=new Worker(new URL("./simulation-worker.ts",import.meta.url),{type:"module"});this.worker=worker;
      this.report=report;this.detailFloor=0;this.sampleFilter="all";this.samplePage=0;this.message="各关独立开局；配置、关卡和种子在开始时冻结。";
      worker.onmessage=(event:MessageEvent<{type:string;pair?:SimulationPair;message?:string}>)=>{
        if(this.worker!==worker)return;
        if(event.data.type==="pair"&&event.data.pair)report.pairs.push(event.data.pair);
        if(event.data.type==="complete"){report.status="complete";this.message="配对模拟完成；结果是当前自动策略下的样本统计。";worker.terminate();this.worker=null;}
        if(event.data.type==="error"){report.status="error";this.message=event.data.message??"模拟失败";worker.terminate();this.worker=null;}
        this.redraw(event.data.type!=="pair");
      };
      worker.onerror=()=>{
        if(this.worker!==worker)return;
        report.status="error";this.message="后台模拟未能运行，请重新开始。";worker.terminate();this.worker=null;this.redraw(true);
      };
      worker.postMessage(report);this.redraw(true);
    }catch(e){this.notify(e instanceof z.ZodError?(e.issues.some(i=>i.path.includes("healingHpPercent"))?"治疗生命阈值须为0—100的有效数值。":e.issues.some(i=>i.path[0]==="count")?"请修正配置与测试设置；运行次数须为1—100的整数。":"请修正配置与测试设置；选择1—30个不同关卡，每关运行1—100次。"):e instanceof Error?e.message:"不能开始模拟");}
  }
  private selection(setup:PlaytestSetup,running:boolean){
    const floors=this.floors(setup);
    return `<details class="sim-floor-picker"><summary>选择测试关卡 · 已选${floors.length}关${this.selectedFloors===null?"（跟随当前关卡）":""}</summary><div class="sim-presets">${[["current","当前关卡"],["bosses","10 / 20 / 30 Boss"],["all","全部关卡"],["clear","清空选择"]].map(([id,label])=>`<button data-sim-action="select" data-id="${id}" ${running?"disabled":""}>${label}</button>`).join("")}</div><div class="sim-floor-options">${Array.from({length:30},(_,i)=>i+1).map(floor=>`<label><input type="checkbox" data-sim="floor" data-floor="${floor}" aria-label="测试第${floor}关" ${floors.includes(floor)?"checked":""} ${running?"disabled":""}><span>${floor}${floor%10===0?" ◆":""}</span></label>`).join("")}</div></details>${floors.length?"":'<p class="sim-selection-invalid">至少选择1个关卡才能运行。</p>'}<p class="sim-plan">${floors.length}关 × ${this.options.count}种子 × A/B = ${floors.length*this.options.count*2}场；每关独立重置生命与能量。</p>`;
  }
  private metrics(rows:SimulationPair[],scope:string){
    const a=summarizeTrials(rows.map(p=>p.a)),b=summarizeTrials(rows.map(p=>p.b)),paired=summarizePairs(rows);
    const metric=(label:string,av:string,bv:string)=>`<div class="sim-metric"><span>${label}</span><strong>${av}</strong><strong>${bv}</strong></div>`;
    return `<div class="sim-summary"><div class="sim-metric sim-metric-head"><span>${scope} · ${rows.length}对</span><b>A · 配置快照</b><b>B · 草稿快照</b></div>${metric("胜率 / 胜场",`${percent(a.winRate)} / ${a.wins}`,`${percent(b.winRate)} / ${b.wins}`)}${metric("失败 / 超时",`${a.losses} / ${a.timeouts}`,`${b.losses} / ${b.timeouts}`)}${metric("平均耗时 · 全样本",f(a.seconds)+" 秒",f(b.seconds)+" 秒")}${metric("平均耗时 · 胜场",f(a.victorySeconds)+" 秒",f(b.victorySeconds)+" 秒")}${metric("平均倒下 / 补人",`${f(a.fallen)} / ${f(a.reinforcements)}`,`${f(b.fallen)} / ${f(b.reinforcements)}`)}${metric("战后 / 初始生命",percent(a.hpRemaining),percent(b.hpRemaining))}${metric("平均耗能 / 回能",`${f(a.energySpent,0)} / ${f(a.energyGained,0)}`,`${f(b.energySpent,0)} / ${f(b.energyGained,0)}`)}${metric("平均伤害 / 治疗",`${f(a.damage,0)} / ${f(a.healing,0)}`,`${f(b.damage,0)} / ${f(b.healing,0)}`)}${metric("平均护盾吸收",f(a.absorbed,0),f(b.absorbed,0))}</div><p class="sim-paired">同种子结果：仅A胜 ${paired.aOnly} · 仅B胜 ${paired.bOnly} · 都胜 ${paired.both} · 都未胜 ${paired.neither}</p>`;
  }
  private frozenStrategies(report:SimulationReport){
    const detail=(v:"a"|"b")=>{const s=report[v].strategy!;const order=(ids:string[])=>ids.length?ids.map(id=>report[v].config.Species.find(m=>m.Id===id)?.Name??(id==="hero"?"主角":id==="princess"?"公主":id)).join(" → "):"按在场 / 阵容顺序";return `<p><b>${v.toUpperCase()} · ${esc(strategySummary(s))}</b><br>打断：${s.interrupt==="charging"?"等待吟唱":s.interrupt==="immediate"?"满能释放":"禁用"}<br>大招顺序：${esc(order(s.ultimateOrder))}<br>补人顺序：${esc(order(s.reinforcementOrder))}</p>`;};
    return `<details class="sim-frozen-strategies"><summary>查看本次 A / B 策略快照</summary>${detail("a")}${detail("b")}</details>`;
  }
  private floorTable(report:SimulationReport){
    return `<div class="sim-floor-overview"><h3>逐关汇总</h3><p class="sim-help">每格按 A / B 排列；样本按本关实际完成配对计数。点击关卡查看明细。</p><div class="sim-floor-table"><table aria-label="逐关汇总"><thead><tr><th>关卡</th><th>完成 / 计划</th><th>胜率 A / B</th><th>平均秒数 A / B</th><th>补人 A / B</th><th>耗能 A / B</th></tr></thead><tbody>${summarizeFloors(report).map(row=>`<tr data-summary-floor="${row.floor}"><th><button data-sim-action="show-floor" data-id="${row.floor}">第${row.floor}关</button></th><td>${row.completed} / ${row.requested}</td><td>${percent(row.a.winRate)} / ${percent(row.b.winRate)}</td><td>${f(row.a.seconds)} / ${f(row.b.seconds)}</td><td>${f(row.a.reinforcements)} / ${f(row.b.reinforcements)}</td><td>${f(row.a.energySpent,0)} / ${f(row.b.energySpent,0)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  private details(report:SimulationReport,running:boolean){
    const floors=reportFloors(report),multi=floors.length>1;
    const scoped=report.pairs.map((pair,index)=>({pair,index})).filter(({pair})=>!this.detailFloor||(pair.floor??report.setup.floor)===this.detailFloor);
    const visible=scoped.filter(({pair})=>this.sampleFilter==="all"||this.sampleFilter==="a-failed"&&pair.a.result!=="victory"||this.sampleFilter==="b-failed"&&pair.b.result!=="victory"||this.sampleFilter==="any-failed"&&(pair.a.result!=="victory"||pair.b.result!=="victory"));
    const pages=Math.max(1,Math.ceil(visible.length/PAGE_SIZE));this.samplePage=Math.min(this.samplePage,pages-1);
    const page=visible.slice(this.samplePage*PAGE_SIZE,(this.samplePage+1)*PAGE_SIZE);
    const scope=this.detailFloor?`第${this.detailFloor}关`:multi?"全部关卡":"已完成";
    return `<section id="sim-floor-detail"><h3>样本与战斗资源</h3><div class="sim-filters"><label class="wb-field"><span>查看关卡</span><select data-sim="detail-floor" aria-label="查看关卡"><option value="0">全部关卡</option>${floors.map(floor=>`<option value="${floor}" ${this.detailFloor===floor?"selected":""}>第${floor}关</option>`).join("")}</select></label><label class="wb-field"><span>样本筛选</span><select data-sim="sample-filter" aria-label="样本筛选">${[["all","全部样本"],["a-failed","A未胜（含超时）"],["b-failed","B未胜（含超时）"],["any-failed","任一方未胜"]].map(([id,label])=>`<option value="${id}" ${this.sampleFilter===id?"selected":""}>${label}</option>`).join("")}</select></label></div>${this.metrics(scoped.map(s=>s.pair),scope)}<p class="sim-help">统计含所选范围全部已完成样本；下方筛选只改变列表。</p><div class="sim-pagination"><span>筛选后 ${visible.length} 对 · 第${this.samplePage+1} / ${pages}页</span><button data-sim-action="previous-page" ${this.samplePage===0?"disabled":""}>上一页</button><button data-sim-action="next-page" ${this.samplePage+1>=pages?"disabled":""}>下一页</button></div><div class="sim-table"><table><thead><tr>${multi?"<th>关卡</th>":""}<th>种子</th><th>A结果 / 秒</th><th>B结果 / 秒</th><th>复现</th></tr></thead><tbody>${page.map(({pair:p,index:i})=>`<tr data-pair-index="${i}">${multi?`<th>第${p.floor}关</th>`:""}<th>${p.a.seed}</th><td>${outcome(p.a.result)} / ${(p.a.ticks*.05).toFixed(2)}</td><td>${outcome(p.b.result)} / ${(p.b.ticks*.05).toFixed(2)}</td><td><div class="sim-row-actions">${(["a","b"] as const).map(v=>`<button data-sim-action="review" data-id="${v}:${i}" ${running?"disabled":""}>查看${v.toUpperCase()}战果</button><button data-sim-action="replay" data-id="${v}:${i}">导出${v.toUpperCase()}记录</button><button data-sim-action="play" data-id="${v}:${i}" ${running?"disabled":""}>手动Play ${v.toUpperCase()}</button><button data-sim-action="auto-play" data-id="${v}:${i}" ${running?"disabled":""}>策略Play ${v.toUpperCase()}</button>`).join("")}</div></td></tr>`).join("")}</tbody></table></div>${visible.length?"":'<p class="sim-no-samples">当前筛选没有已完成样本。</p>'}</section>`;
  }
  render(setup:PlaytestSetup,source:unknown){
    const r=this.report,rows=r?.pairs??[],floors=this.floors(setup),running=!!this.worker;
    let currentHash:string|null=null;try{currentHash=new TowerEngine(validateConfig(source)).configHash;}catch{ /* Preserve frozen results when a draft is invalid. */ }
    const common=(s:PlaytestSetup)=>JSON.stringify({...s,floor:0,strategy:undefined,autoPlay:undefined});
    const stale=r&&(r.b.hash!==currentHash||r.a.hash!==this.referenceHash||JSON.stringify(r.a.strategy)!==JSON.stringify(this.referenceStrategy)||JSON.stringify(r.b.strategy)!==JSON.stringify(setup.strategy??defaultStrategy())||common(setup)!==common(r.setup)||JSON.stringify(this.options)!==JSON.stringify(r.options)||JSON.stringify(floors)!==JSON.stringify(reportFloors(r)));
    const partyName=(id:string)=>id==="hero"?"主角":id==="princess"?"公主":this.reference.Species.find(s=>s.Id===id)?.Name??id;
    const status=r?.status==="complete"?"已完成":r?.status==="cancelled"?"已取消":r?.status==="error"?"中止":"运行中";
    const total=r?simulationTotal(r):0,completedFloors=r?summarizeFloors(r).filter(s=>s.completed===s.requested).length:0;
    return `<section class="comparison"><div class="sim-controls"><div class="sim-title"><div><p class="eyebrow">PAIRED PLAYTEST</p><h2>批量模拟 · 配置对比</h2></div><span class="test-label">独立测试 · 不发放奖励</span></div><p class="sim-context">${floors.length===1?`第${floors[0]}关`:`已选${floors.length}关`} · Lv.${setup.level} / 怪兽${setup.rank}阶 · 初始生命${setup.hpPercent}% / 能量${setup.energy}<br>阵容顺序：${setup.party.map(id=>esc(partyName(id))).join("、")} · 首种子 ${setup.seed}，逐次+1</p>${this.selection(setup,running)}<div class="sim-variants"><div><b>A · ${esc(this.label)}</b><span>保存配表与策略，继续修改B</span><p class="sim-strategy-a">${esc(strategySummary(this.referenceStrategy))}</p><button data-sim-action="capture" ${running?"disabled":""}>将当前草稿保存为A</button><button data-sim-action="reference">导出A配置</button></div><div><b>B · 当前草稿</b><span>两者统一使用阵容与选中关卡</span><p class="sim-strategy-b">${esc(strategySummary(setup.strategy??defaultStrategy()))}</p><button data-wb="strategy">编辑B策略</button><button data-wb="setup">调整测试设置</button></div></div><div class="sim-settings"><label class="wb-field"><span>每关每份配置运行次数</span><input data-sim="count" aria-label="每份配置运行次数" type="number" min="1" max="100" step="1" value="${this.options.count}" ${running?"disabled":""}></label><label class="wb-field"><span>大招策略</span><select data-sim="policy" aria-label="大招策略" ${running?"disabled":""}><option value="adaptive" ${this.options.policy==="adaptive"?"selected":""}>分别执行保存的A / B策略</option><option value="no-ultimates" ${this.options.policy==="no-ultimates"?"selected":""}>不使用我方大招</option></select></label><label class="sim-check"><input data-sim="reinforce" type="checkbox" aria-label="按阵容顺序自动补人" ${this.options.reinforce?"checked":""} ${running?"disabled":""}>允许执行各自补人策略</label></div><div class="sim-buttons"><button class="primary" data-sim-action="run" ${running||!floors.length?"disabled":""}>运行A / B配对模拟</button><button data-sim-action="cancel" ${!running?"disabled":""}>取消模拟</button><button data-sim-action="export" ${!r?"disabled":""}>导出对比报告</button><button data-wb="play">▶ Play 第${setup.floor}关</button></div><p class="sim-message" role="status">${esc(this.message)}</p><details class="sim-method"><summary>查看策略与统计口径</summary><p>人类优先补足5首发；每tick尝试满能大招。A/B分别按保存的治疗阈值、打断条件、大招优先级与补人顺序执行；未配置时治疗阈值65%、打断等待吟唱。上方“不使用我方大招”与补人开关是共同限制，优先于A/B策略。补人每tick最多1名，由核心检查票数和位置。每关使用相同种子序列，按同种子逐关运行；超过4294967295回到1，每场最多300秒。</p><p>各关独立创建战斗，重置为测试设置的等级、生命与能量，不跨关携带资源。统计只计完整完成的配对，取消丢弃当前一对；逐关显示实际分母。全样本耗时包含失败和超时，生命包括候补，能量为实际大招消耗与三类回能。不模拟购买、培养或旅馆，也不等于玩家胜率。报告包含冻结配置、全部选关、设置、策略版本与操作记录，导出包含逐关汇总及全部样本；刷新前请导出结果。</p></details></div><div class="sim-results" id="sim-results"><div class="sim-progress"><h3>${r?`${status} · ${rows.length} / ${total} 对`:"等待运行"}</h3>${r&&reportFloors(r).length>1?`<div class="sim-multi-progress">${completedFloors} / ${reportFloors(r).length}关完成 · 共${total*2}场计划</div>`:""}${stale?`<p class="sim-warning">A配置、草稿、选关或测试设置已改变；下方保留上次结果，请重新运行。</p>`:""}${r?`<p>${reportFloors(r).map(f=>`第${f}关`).join("、")} · 种子${r.setup.seed}起 · ${r.options.policy==="adaptive"?"择机大招":"不用大招"}${r.options.reinforce?" / 自动补人":" / 不补人"}<br>A ${esc(r.a.hash)} / B ${esc(r.b.hash)} · 开始时的冻结配置与策略</p><progress max="${total}" value="${rows.length}" aria-label="配对模拟进度"></progress>`:"<p>选择多个关卡，完成后逐关查看胜率、资源消耗和失败样本。</p>"}</div>${r?`${reportFloors(r).length>1?this.floorTable(r):""}${r.schemaVersion===3?this.frozenStrategies(r):""}${[...r.a.warnings.map(w=>"A："+w),...r.b.warnings.map(w=>"B："+w)].length?`<p class="sim-warning">停用功能：${[...r.a.warnings.map(w=>"A："+w),...r.b.warnings.map(w=>"B："+w)].map(esc).join("；")}</p>`:""}${this.details(r,running)}`:""}</div></section>`;
  }
}
