import type { Config } from "../core/config";
import { skillLabel } from "../data/skill-labels";
import type { NewMonsterInput } from "./roster";
import { readMonsterPng, type MonsterPng } from "./png";
import "./monster-dialog.css";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

export function openMonsterDialog(config: Config, selected: string, create: (input: NewMonsterInput) => void): Promise<boolean> {
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "monster-dialog";
  dialog.setAttribute("aria-labelledby","monster-create-title");
  dialog.innerHTML = `<form novalidate><header><div><p>角色工坊</p><h2 id="monster-create-title">制作新怪兽</h2></div><button type="button" data-cancel aria-label="关闭制作窗口">关闭</button></header><div class="monster-dialog-body"><section class="monster-create-fields"><label>怪兽名字<input name="name" aria-label="新怪兽名字" maxlength="40" placeholder="例如：幻晶灵猫" required autofocus></label><label>属性与技能模板<select name="template" aria-label="怪兽模板">${config.Species.map(s=>`<option value="${esc(s.Id)}" ${s.Id===selected?"selected":""}>${esc(s.Name)} · ${esc(config.Rules.Species[s.Id]!.PrimaryRole)}</option>`).join("")}</select></label><label class="monster-upload">上传 PNG<input name="png" aria-label="上传怪兽PNG" type="file" accept="image/png,.png" required></label><p class="monster-upload-help">单张角色图或3列×4行行走图，最多220KB、宽高不超过2048px。行走图支持48×64、96×128、192×256px；透明背景效果更好。</p><label>图片用法<select name="layout" aria-label="PNG图片用法"><option value="auto">自动识别</option><option value="single">单张角色图</option><option value="sheet">3列×4行行走图</option></select></label></section><aside><div class="monster-image-stage"><div class="monster-image-preview" role="img" aria-label="新怪兽图片预览"></div><span class="monster-image-placeholder">上传后预览角色</span></div><p class="monster-image-info" aria-live="polite">尚未选择PNG</p><div class="monster-template-preview"></div><p class="monster-template-note">复制模板的基础属性、每级成长、定位、技能与品阶。图片使用你上传的PNG；创建后仍可逐项调整。</p></aside></div><footer><p class="monster-create-error" role="status" aria-live="polite"></p><div><button type="button" data-cancel>取消</button><button type="submit" class="primary" disabled>创建怪兽</button></div></footer></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form")!;
  const name = form.elements.namedItem("name") as HTMLInputElement;
  const template = form.elements.namedItem("template") as HTMLSelectElement;
  const file = form.elements.namedItem("png") as HTMLInputElement;
  const layout = form.elements.namedItem("layout") as HTMLSelectElement;
  const error = dialog.querySelector<HTMLElement>(".monster-create-error")!;
  const info = dialog.querySelector<HTMLElement>(".monster-image-info")!;
  const preview = dialog.querySelector<HTMLElement>(".monster-image-preview")!;
  const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
  let png: MonsterPng | undefined, reading = false, generation = 0, created = false;
  const imageLayout = () => layout.value === "single" || layout.value === "auto" && !png?.sheetSize ? "single" : "sheet";
  function update() {
    const p = config.Rules.Profiles[template.value]!, a = config.Rules.Combatants[template.value]!.Base;
    dialog.querySelector<HTMLElement>(".monster-template-preview")!.innerHTML = `<h3>模板：${esc(config.Species.find(s=>s.Id===template.value)!.Name)}</h3><dl><div><dt>生命</dt><dd>${a.MaxHp}</dd></div><div><dt>攻击 / 法术</dt><dd>${a.Attack} / ${a.Magic}</dd></div><div><dt>防御 / 魔抗</dt><dd>${a.Defense} / ${a.Resistance}</dd></div></dl><p>自动：${esc(skillLabel(p.Auto))}</p><p>大招：${esc(skillLabel(p.Ultimate))}</p>`;
    const invalidSheet = !!png && imageLayout() === "sheet" && !png.sheetSize;
    submit.disabled = reading || !png || !name.value.trim() || invalidSheet;
    preview.style.backgroundImage = png ? `url('${png.url}')` : "none";
    preview.classList.toggle("is-sheet",!!png && imageLayout() === "sheet");
    dialog.querySelector<HTMLElement>(".monster-image-placeholder")!.hidden = !!png;
    if (png) info.textContent = invalidSheet ? "此PNG不符合3列×4行规格，请改用单张角色图" : `${png.width} × ${png.height}px · ${imageLayout()==="sheet" ? `行走图，${png.sheetSize}px/帧` : "单张角色图"}`;
  }
  name.addEventListener("input",()=>{error.textContent="";update();});
  template.addEventListener("change",update);
  layout.addEventListener("change",()=>{error.textContent="";update();});
  file.addEventListener("change",()=>{
    const selectedFile = file.files?.[0], token = ++generation;
    png = undefined; error.textContent="";
    if (!selectedFile) {info.textContent="尚未选择PNG";update();return;}
    reading=true;info.textContent="正在读取PNG…";update();
    void readMonsterPng(selectedFile).then(result=>{
      if(token!==generation || !dialog.open)return;
      png=result;layout.value="auto";
    }).catch(e=>{if(token===generation)error.textContent=e instanceof Error?e.message:"PNG读取失败";})
      .finally(()=>{if(token===generation){reading=false;if(!png)info.textContent="尚未选择有效PNG";update();}});
  });
  return new Promise(resolve=>{
    const close = () => dialog.close();
    dialog.querySelectorAll("[data-cancel]").forEach(el=>el.addEventListener("click",close));
    dialog.addEventListener("close",()=>{generation++;dialog.remove();if(previous instanceof HTMLElement && previous.isConnected)previous.focus();resolve(created);},{once:true});
    form.addEventListener("submit",event=>{
      event.preventDefault();if(submit.disabled || !png)return;
      try {
        create({name:name.value,templateId:template.value,spriteDataUrl:png.url,frameSize:png.sheetSize??16,layout:imageLayout()});
        created=true;close();
      } catch(e) {error.textContent=e instanceof Error?e.message:"创建失败，请检查输入";}
    });
    update();dialog.showModal();name.focus();
  });
}
