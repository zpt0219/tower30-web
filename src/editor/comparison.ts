import {z} from "zod";
import {validateConfig,type Config} from "../core/config";
import {TowerEngine} from "../core/engine";
import {clone} from "../core/math";
import type {PlaytestSetup} from "../core/playtest";
import {createSimulationReport,simulationOptionsSchema,summarizeTrials,summarizePairs,trialSave,type SimulationOptions,type SimulationReport,type SimulationPair} from "../core/simulation";
import {readWorkbench,writeWorkbench} from "../storage/save";

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const f=(n:number|null,d=1)=>n===null?"—":n.toFixed(d);
const percent=(n:number|null)=>n===null?"—":(n*100).toFixed(1)+"%";
const outcome=(value:string)=>value==="victory"?"胜利":value==="loss"?"失败":"超时";
export class Comparison {
  private reference:Config;
  private label="原始基线";
  private referenceHash:string;
  private options:SimulationOptions={count:10,policy:"adaptive",reinforce:true};
  private report:SimulationReport|null=null;
  private worker:Worker|null=null;
  private message="先保存A配置，再调整草稿B；两者统一使用当前测试设置。";
  private writes=Promise.resolve();
  constructor(config:Config,private readonly changed:()=>void,private readonly notify:(message:string)=>void,private readonly download:(source:unknown,name:string)=>void,private readonly onPlay:(config:Config,setup:PlaytestSetup)=>void,private readonly onReview:(serialized:string)=>void){this.reference=clone(config);this.referenceHash=new TowerEngine(config).configHash;}
  async load(){
    try{
      const raw=await readWorkbench("comparison");if(!raw)return;
      if(raw.length>2_000_000)throw new Error("A配置过大");
      const saved:unknown=JSON.parse(raw);
      if(!saved || typeof saved!=="object" || !("format" in saved) || saved.format!=="tower30-comparison-reference" || !("source" in saved))throw new Error("A配置格式无效");
      this.reference=validateConfig(saved.source);this.referenceHash=new TowerEngine(this.reference).configHash;this.label="保存的配置";this.message="已恢复浏览器保存的A配置；当前草稿为B。";
    }catch{this.notify("A配置读取失败，已使用原始基线。正式试跑未改变。");}
  }
  input(el:HTMLInputElement|HTMLSelectElement){
    if(el.dataset.sim==="count")this.options.count=el.value===""?0:Number(el.value);
    if(el.dataset.sim==="policy")this.options.policy=el.value as SimulationOptions["policy"];
    if(el.dataset.sim==="reinforce"&&el instanceof HTMLInputElement)this.options.reinforce=el.checked;
  }
  private persistReference(){
    const text=JSON.stringify({format:"tower30-comparison-reference",source:this.reference});
    this.writes=this.writes.catch(()=>{}).then(()=>writeWorkbench("comparison",text));
    void this.writes.then(()=>{this.message="A配置已保存到此浏览器。";this.changed();}).catch(()=>{this.message="A配置保存失败，请导出配置备份。";this.changed();});
  }
  cancel(){
    if(!this.worker)return;
    this.worker.terminate();this.worker=null;
    if(this.report)this.report.status="cancelled";
    this.message="已取消，仅保留已完成的配对样本。";this.changed();
  }
  action(action:string,source:unknown,setup:PlaytestSetup,id?:string){
    try{
      if(action==="capture"){
        if(this.worker)throw new Error("请先取消当前模拟，再替换A配置");
        this.reference=validateConfig(source);this.referenceHash=new TowerEngine(this.reference).configHash;this.label="保存的配置";this.persistReference();this.changed();return;
      }
      if(action==="cancel"){this.cancel();return;}
      if(action==="export"){
        if(!this.report)throw new Error("请先运行配对模拟");
        this.download({...this.report,summary:{a:summarizeTrials(this.report.pairs.map(p=>p.a)),b:summarizeTrials(this.report.pairs.map(p=>p.b)),paired:summarizePairs(this.report.pairs)}},"tower30-comparison.json");return;
      }
      if(action==="reference"){this.download(this.reference,"tower30-reference-a.json");return;}
      if(action==="replay"||action==="play"||action==="review"){
        const [variant,index]=id!.split(":") as ["a"|"b",string];
        const report=this.report;if(!report)throw new Error("样本不存在");
        const record=trialSave(report,variant,Number(index));
        if(action==="replay")this.download(record,`tower30-${variant}-${record.setup.seed}-replay.json`);
        else if(action==="review"){this.cancel();this.onReview(JSON.stringify(record));}
        else{this.cancel();this.onPlay(report[variant].config,record.setup);}
        return;
      }
      if(action!=="run")return;
      if(this.worker)throw new Error("已有模拟正在运行");
      const report=createSimulationReport(this.reference,source,setup,simulationOptionsSchema.parse(this.options),this.label);
      this.report=report;this.message="模拟使用开始时冻结的配置；可继续编辑草稿。";
      const worker=new Worker(new URL("./simulation-worker.ts",import.meta.url),{type:"module"});this.worker=worker;
      worker.onmessage=(event:MessageEvent<{type:string;pair?:SimulationPair;message?:string}>)=>{
        if(this.worker!==worker)return;
        if(event.data.type==="pair"&&event.data.pair)report.pairs.push(event.data.pair);
        if(event.data.type==="complete"){report.status="complete";this.message="配对模拟完成；结果是当前自动策略下的样本统计。";worker.terminate();this.worker=null;}
        if(event.data.type==="error"){report.status="error";this.message=event.data.message??"模拟失败";worker.terminate();this.worker=null;}
        this.changed();
      };
      worker.onerror=()=>{
        if(this.worker!==worker)return;
        report.status="error";this.message="后台模拟未能运行，请重新开始。";worker.terminate();this.worker=null;this.changed();
      };
      worker.postMessage(report);this.changed();
    }catch(e){this.notify(e instanceof z.ZodError?"请修正配置与测试设置；运行次数须为1—100的整数。":e instanceof Error?e.message:"不能开始模拟");}
  }
  render(setup:PlaytestSetup,source:unknown){
    const r=this.report, rows=r?.pairs??[], a=summarizeTrials(rows.map(p=>p.a)),b=summarizeTrials(rows.map(p=>p.b)),paired=summarizePairs(rows);
    const running=!!this.worker;
    let currentHash:string|null=null;try{currentHash=new TowerEngine(validateConfig(source)).configHash;}catch{ /* Invalid drafts must not replace frozen results. */ }
    const stale=r&&(r.b.hash!==currentHash||r.a.hash!==this.referenceHash||JSON.stringify(setup)!==JSON.stringify(r.setup));
    const metric=(label:string,av:string,bv:string)=>`<div class="sim-metric"><span>${label}</span><strong>${av}</strong><strong>${bv}</strong></div>`;
    const partyName=(id:string)=>id==="hero"?"主角":id==="princess"?"公主":this.reference.Species.find(s=>s.Id===id)?.Name??id;
    const status=r?.status==="complete"?"已完成":r?.status==="cancelled"?"已取消":r?.status==="error"?"中止":"运行中";
    return `<section class="comparison"><div class="sim-controls"><div class="sim-title"><div><p class="eyebrow">PAIRED PLAYTEST</p><h2>批量模拟 · 配置对比</h2></div><span class="test-label">独立测试 · 不发放奖励</span></div><p class="sim-context">第${setup.floor}关 · Lv.${setup.level} / 怪兽${setup.rank}阶 · 初始生命${setup.hpPercent}% / 能量${setup.energy}<br>阵容顺序：${setup.party.map(id=>esc(partyName(id))).join("、")} · 首种子 ${setup.seed}，逐次+1</p><div class="sim-variants"><div><b>A · ${esc(this.label)}</b><span>保存后可继续修改B</span><button data-sim-action="capture" ${running?"disabled":""}>将当前草稿保存为A</button><button data-sim-action="reference">导出A配置</button></div><div><b>B · 当前草稿</b><span>两者统一使用上述阵容与关卡</span><button data-wb="setup">调整测试设置</button></div></div><div class="sim-settings"><label class="wb-field"><span>每份配置运行次数</span><input data-sim="count" aria-label="每份配置运行次数" type="number" min="1" max="100" step="1" value="${this.options.count}" ${running?"disabled":""}></label><label class="wb-field"><span>大招策略</span><select data-sim="policy" aria-label="大招策略" ${running?"disabled":""}><option value="adaptive" ${this.options.policy==="adaptive"?"selected":""}>满能释放，治疗与打断择机</option><option value="no-ultimates" ${this.options.policy==="no-ultimates"?"selected":""}>不使用我方大招</option></select></label><label class="sim-check"><input data-sim="reinforce" type="checkbox" aria-label="按阵容顺序自动补人" ${this.options.reinforce?"checked":""} ${running?"disabled":""}>按阵容顺序自动补人</label></div><div class="sim-buttons"><button class="primary" data-sim-action="run" ${running?"disabled":""}>运行A / B配对模拟</button><button data-sim-action="cancel" ${!running?"disabled":""}>取消模拟</button><button data-sim-action="export" ${!r?"disabled":""}>导出对比报告</button><button data-wb="play">▶ Play 第${setup.floor}关</button></div><p class="sim-message" role="status">${esc(this.message)}</p><details class="sim-method"><summary>查看策略与统计口径</summary><p>人类优先，按阵容顺序补足5首发。每tick尝试满能大招；新芽复苏、林息、圣祈与森林庇护等待存活队友生命低于65%，截风等待敌人吟唱，其余立即尝试。自动补人按阵容顺序，每tick最多1名，由核心检查票数和入场位置。A/B同种子，每场最多300秒；从首种子逐次+1，超过4294967295回到1。技能停用提示会随报告导出。</p><p>统计只计完成的配对样本，取消时丢弃正在运行的一对。全样本耗时包含失败，胜利耗时只含胜场。补人计实际消耗票数；生命包括未上场候补；能量计实际大招消耗和三类回能。本页不模拟购买、培养和旅馆花费，也不代表玩家胜率。报告包含冻结配置、设置及每场操作记录，可导出后由纯TS核心重放；刷新前请导出结果。</p></details></div><div class="sim-results" id="sim-results"><div class="sim-progress"><h3>${r?`${status} · ${rows.length} / ${r.options.count} 对` : "等待运行"}</h3>${stale?`<p class="sim-warning">A配置、草稿或测试设置已改变；下方保留上次结果，请重新运行。</p>`:""}${r?`<p>第${r.setup.floor}关 · 种子${r.setup.seed}起 · ${r.options.policy==="adaptive"?"择机大招":"不用大招"}${r.options.reinforce?" / 自动补人":" / 不补人"}<br>A ${esc(r.a.hash)} / B ${esc(r.b.hash)} · 开始时的冻结配置</p><progress max="${r.options.count}" value="${rows.length}" aria-label="配对模拟进度"></progress>`:"<p>完成后在这里查看胜率、资源消耗和逐个种子的差异。</p>"}</div>${r?`<div class="sim-summary"><div class="sim-metric sim-metric-head"><span>已完成 ${rows.length} 对</span><b>A · 配置快照</b><b>B · 草稿快照</b></div>${metric("胜率 / 胜场",`${percent(a.winRate)} / ${a.wins}`,`${percent(b.winRate)} / ${b.wins}`)}${metric("失败 / 超时",`${a.losses} / ${a.timeouts}`,`${b.losses} / ${b.timeouts}`)}${metric("平均耗时 · 全样本",f(a.seconds)+" 秒",f(b.seconds)+" 秒")}${metric("平均耗时 · 胜场",f(a.victorySeconds)+" 秒",f(b.victorySeconds)+" 秒")}${metric("平均倒下 / 补人",`${f(a.fallen)} / ${f(a.reinforcements)}`,`${f(b.fallen)} / ${f(b.reinforcements)}`)}${metric("战后 / 初始生命",percent(a.hpRemaining),percent(b.hpRemaining))}${metric("平均耗能 / 回能",`${f(a.energySpent,0)} / ${f(a.energyGained,0)}`,`${f(b.energySpent,0)} / ${f(b.energyGained,0)}`)}${metric("平均伤害 / 治疗",`${f(a.damage,0)} / ${f(a.healing,0)}`,`${f(b.damage,0)} / ${f(b.healing,0)}`)}${metric("平均护盾吸收",f(a.absorbed,0),f(b.absorbed,0))}</div><p class="sim-paired">同种子结果：仅A胜 ${paired.aOnly} · 仅B胜 ${paired.bOnly} · 都胜 ${paired.both} · 都未胜 ${paired.neither}</p>${[...r.a.warnings.map(w=>"A："+w),...r.b.warnings.map(w=>"B："+w)].length?`<p class="sim-warning">停用功能：${[...r.a.warnings.map(w=>"A："+w),...r.b.warnings.map(w=>"B："+w)].map(esc).join("；")}</p>`:""}<div class="sim-table"><table><thead><tr><th>种子</th><th>A结果 / 秒</th><th>B结果 / 秒</th><th>复现</th></tr></thead><tbody>${rows.map((p,i)=>`<tr><th>${p.a.seed}</th><td>${outcome(p.a.result)} / ${(p.a.ticks*.05).toFixed(2)}</td><td>${outcome(p.b.result)} / ${(p.b.ticks*.05).toFixed(2)}</td><td><div class="sim-row-actions"><button data-sim-action="review" data-id="a:${i}" ${running?"disabled":""}>查看A战果</button><button data-sim-action="review" data-id="b:${i}" ${running?"disabled":""}>查看B战果</button><button data-sim-action="replay" data-id="a:${i}">导出A记录</button><button data-sim-action="replay" data-id="b:${i}">导出B记录</button><button data-sim-action="play" data-id="b:${i}" ${running?"disabled":""}>手动Play B</button></div></td></tr>`).join("")}</tbody></table></div>`:""}</div></section>`;
  }
}
