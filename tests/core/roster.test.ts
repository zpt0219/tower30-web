import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import raw from "../../data/tower/thirty-floor-trial.json";
import { validateConfig } from "../../src/core/config";
import { TowerEngine } from "../../src/core/engine";
import { defaultPlaytestSetup } from "../../src/core/playtest";
import { move } from "../../src/core/movement";
import { newProject, importProject, validateProject } from "../../src/editor/project";
import { createMonster, renameSprite, dropSprite, sheetFrameSize } from "../../src/editor/roster";
const config = validateConfig(raw);
const png = `data:image/png;base64,${readFileSync("public/assets/moonbat.png").toString("base64")}`;
describe("新怪兽制作",()=>{
  it("复制模板全部属性与技能，保留源字段，上传图片与配置可往返且彼此独立",()=>{
    const draft = newProject(raw);
    const id = createMonster(draft,config,{name:"  幻晶灵猫  ",templateId:"moonbat",spriteDataUrl:png,frameSize:16});
    const c = validateProject(draft).config!;
    expect(c.Species.find(s=>s.Id===id)).toMatchObject({Name:"幻晶灵猫",Sprite:id,FrameSize:16,SpriteLayout:"sheet"});
    expect(c.Rules.Combatants[id]).toEqual(config.Rules.Combatants.moonbat);
    expect(c.Rules.Profiles[id]).toEqual(config.Rules.Profiles.moonbat);
    const restored = importProject(JSON.stringify(draft));
    expect(restored.sprites?.[id]).toBe(png);
    (draft.source as typeof raw).Rules.Combatants.moonbat.Base.MaxHp = 1;
    expect(validateProject(draft).config!.Rules.Combatants[id]!.Base.MaxHp).toBe(config.Rules.Combatants.moonbat!.Base.MaxHp);
    const engine = TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party:[id]});
    expect(engine.dispatch({type:"begin"}).ok).toBe(true);expect(engine.dispatch({type:"start"}).ok).toBe(true);
    expect(engine.getSnapshot().battle!.units[0]!.kind).toBe(id);
  });
  it("名称、PNG与模板不合法时不修改原草稿；仅支持准确的行走图尺寸",()=>{
    const draft=newProject(raw),before=JSON.stringify(draft);
    const input={name:"新怪兽",templateId:"moonbat",spriteDataUrl:png,frameSize:16 as const};
    for(const bad of [{...input,name:" "},{...input,templateId:"missing"},{...input,spriteDataUrl:"not-png"}])
      expect(()=>createMonster(draft,config,bad)).toThrow();
    expect(JSON.stringify(draft)).toBe(before);
    expect(sheetFrameSize(48,64)).toEqual({frameSize:16});expect(sheetFrameSize(192,256)).toEqual({frameSize:64});
    expect(sheetFrameSize(48,48)).toHaveProperty("error");
  });
  it("重命名和删除会维护上传图片，单张图片的显示方式保留在工程中",()=>{
    const draft=newProject(raw);
    const id=createMonster(draft,config,{name:"晶猫",templateId:"moonbat",spriteDataUrl:png,frameSize:16,layout:"single"});
    const source=draft.source as typeof config;
    source.Species.find(s=>s.Id===id)!.Id="crystal_cat";
    renameSprite(draft,id,"crystal_cat");
    expect(source.Species.at(-1)).toMatchObject({Id:"crystal_cat",Sprite:"crystal_cat",SpriteLayout:"single"});
    expect(draft.sprites?.crystal_cat).toBe(png);expect(draft.sprites?.[id]).toBeUndefined();
    source.Species.pop();dropSprite(draft,"crystal_cat");expect(draft.sprites).toBeUndefined();
  });
  it("共享上传贴图在拥有者改名和删除后仍可用，最后一个引用删除才清理",()=>{
    const draft=newProject(raw);
    const a=createMonster(draft,config,{name:"甲",templateId:"moonbat",spriteDataUrl:png,frameSize:16});
    const b=createMonster(draft,config,{name:"乙",templateId:"moonbat",spriteDataUrl:png,frameSize:16});
    const source=draft.source as typeof config;
    source.Species.find(s=>s.Id===b)!.Sprite=a;
    source.Species.find(s=>s.Id===a)!.Id="owner";renameSprite(draft,a,"owner");
    expect(source.Species.find(s=>s.Id===b)!.Sprite).toBe("owner");
    source.Species=source.Species.filter(s=>s.Id!=="owner");dropSprite(draft,"owner");
    expect(draft.sprites?.owner).toBe(png);
    source.Species=source.Species.filter(s=>s.Id!==b);dropSprite(draft,"owner");expect(draft.sprites?.owner).toBeUndefined();
  });
  it("夜翼蝠模板的新ID保留汲血移速加成，旧20Hz规则仍不应用此加成",()=>{
    const draft=newProject(raw),id=createMonster(draft,config,{name:"夜晶蝠",templateId:"nightwing",spriteDataUrl:png,frameSize:16});
    const c=validateProject(draft).config!,e=TowerEngine.createPlaytest(c,{...defaultPlaytestSetup(),party:[id]});
    e.dispatch({type:"begin"});e.dispatch({type:"start"});
    const a=structuredClone(e.getSnapshot().battle!.units[0]!),target=structuredClone(e.getSnapshot().battle!.units[1]!);
    a.x=-4;a.z=0;a.leech=2;a.entry=0;target.x=4;target.z=0;
    const original=structuredClone(a),plain=structuredClone(a),old=structuredClone(a);
    original.kind="nightwing";delete original.profile.LeechMoveMultiplier;
    delete plain.profile.LeechMoveMultiplier;
    move(a,target,[a,target]);move(original,target,[original,target]);move(plain,target,[plain,target]);move(old,target,[old,target],true);
    expect([a.x,a.z]).toEqual([original.x,original.z]);
    expect(Math.hypot(a.x+4,a.z)).toBeCloseTo(Math.hypot(plain.x+4,plain.z)*1.4,10);
    expect([old.x,old.z]).toEqual([plain.x,plain.z]);
  });
});
