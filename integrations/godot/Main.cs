using Godot;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tower30;

public partial class Main : Control
{
    private QuickJsSession session=null!;
    private NativeSaveStore store=null!;
    private JsonElement config,view,snapshot,frame;
    private readonly List<double> costs=new();
    private readonly Dictionary<string,Button> buttons=new();
    private readonly Dictionary<string,string> names=new();
    private VBoxContainer root=null!;
    private Control content=null!;
    private HBoxContainer toolbar=null!,actions=null!;
    private Label heading=null!,notice=null!;
    private BattleCanvas? battlefield;
    private ConfirmationDialog? confirmation;
    private bool paused=true,debug,measurement,finished,capturing,saveBlocked;
    private int measuredTicks,warmupTicks,speed=1,ticksSinceSave;
    private ulong startUsec;
    private string stage="camp",message="",savePath="";
    private string? output,capture,uiTest,normalBeforeDebug,debugSave;
    private bool captureResult;
    public override void _Ready()
    {
        try{
            var args=OS.GetCmdlineUserArgs();
            string? Arg(string name)=>args.FirstOrDefault(s=>s.StartsWith(name+"="))?[(name.Length+1)..];
            var generated=ProjectSettings.GlobalizePath("res://generated");
            if(Arg("--verify") is string requests){GD.Print($"Godot + QuickJS completed {Verify.Run(generated,requests,Arg("--responses")??throw new Exception("Missing --responses"))} requests");GetTree().Quit();return;}
            session=new QuickJsSession(generated);
            using(var doc=JsonDocument.Parse(File.ReadAllText(Path.Combine(generated,"tower.json"))))config=doc.RootElement.Clone();
            names["hero"]="主角";names["princess"]="公主";
            foreach(var s in config.GetProperty("Species").EnumerateArray())names[s.GetProperty("Id").GetString()!]=s.GetProperty("Name").GetString()!;
            Engine.PhysicsTicksPerSecond=60;
            if(GetWindow().Size.X<1100)GetWindow().ContentScaleSize=GetWindow().Size;
            uiTest=Arg("--ui-test")??Arg("--project-test");output=Arg("--measure");measurement=output!=null;capture=Arg("--capture");captureResult=args.Contains("--capture-result");
            savePath=Arg("--save-path")??(uiTest!=null?uiTest+".session.json":ProjectSettings.GlobalizePath("user://tower30-ts-session.json"));
            store=new NativeSaveStore(savePath);projectStore=new NativeSaveStore(savePath+".project");BuildShell();
            var existing=!args.Contains("--fresh")&&uiTest==null&&!measurement?store.Read():null;
            if(existing!=null){try{Restore(existing);message="已恢复独立试跑进度；战中读档默认暂停。";}catch(Exception e){CreateRun();saveBlocked=true;message="存档读取失败，原文件保留："+e.Message;}}
            else CreateRun();
            if(measurement||args.Contains("--stress"))CreateStress();
            if(Arg("--project") is string projectPath){OpenProjectPage();InspectProjectFile(projectPath);}
            Render();startUsec=Time.GetTicksUsec();
            if(Arg("--project-test") is string projectTest)_ = RunProjectChecks(projectTest,Arg("--project-test-dir")??System.IO.Path.GetDirectoryName(projectTest)!);
            else if(uiTest!=null)_ = RunUiChecks(uiTest);
        }catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);}
    }
    private void BuildShell()
    {
        var theme=new Theme{DefaultFont=new SystemFont{FontNames=new[]{"Noto Sans CJK SC","sans-serif"}},DefaultFontSize=20};Theme=theme;
        theme.SetColor("font_color","Label",new Color("f3e9cd"));
        foreach(var (state,color) in new[]{("normal","e1d6b8"),("hover","f4e6c3"),("pressed","b4c6a2"),("disabled","6e7b69")})
            theme.SetStylebox(state,"Button",new StyleBoxFlat{BgColor=new Color(color),BorderColor=new Color("89936d"),BorderWidthLeft=2,BorderWidthRight=2,BorderWidthTop=2,BorderWidthBottom=2,CornerRadiusTopLeft=5,CornerRadiusTopRight=5,CornerRadiusBottomLeft=5,CornerRadiusBottomRight=5,ContentMarginLeft=12,ContentMarginRight=12});
        foreach(var color in new[]{"font_color","font_hover_color","font_pressed_color","font_focus_color"})theme.SetColor(color,"Button",new Color("243a2b"));
        theme.SetColor("font_disabled_color","Button",new Color("b9c3ab"));
        var margin=new MarginContainer();AddChild(margin);margin.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        foreach(var side in new[]{"left","right","top","bottom"})margin.AddThemeConstantOverride("margin_"+side,12);
        root=new VBoxContainer();margin.AddChild(root);root.AddThemeConstantOverride("separation",8);
        heading=new Label();heading.AddThemeFontSizeOverride("font_size",24);root.AddChild(heading);
        toolbar=new HBoxContainer();toolbar.AddThemeConstantOverride("separation",8);root.AddChild(toolbar);
        content=new Control{SizeFlagsVertical=SizeFlags.ExpandFill,CustomMinimumSize=new Vector2(0,150)};root.AddChild(content);
        actions=new HBoxContainer();actions.AddThemeConstantOverride("separation",8);root.AddChild(actions);
        notice=new Label{Text="",ClipText=true};notice.AddThemeFontSizeOverride("font_size",18);root.AddChild(notice);
    }
    private string DisplayName(string id)=>names.GetValueOrDefault(id,id);
    private static double Num(JsonElement e,string key)=>e.GetProperty(key).GetDouble();
    private static string Str(JsonElement e,string key)=>e.GetProperty(key).GetString()??"";
    private IEnumerable<JsonElement> Members=>snapshot.GetProperty("members").EnumerateArray();
    private JsonElement Battle=>snapshot.GetProperty("battle");
    private bool HasBattle=>Battle.ValueKind==JsonValueKind.Object;
    private bool Victory=>HasBattle&&Str(Battle,"result")=="victory";
    private void Clear(Node n){foreach(var child in n.GetChildren()){n.RemoveChild(child);child.QueueFree();}}
    private Label Label(Node parent,string text,int size=20){var label=new Label{Text=text,AutowrapMode=TextServer.AutowrapMode.WordSmart};label.AddThemeFontSizeOverride("font_size",size);parent.AddChild(label);return label;}
    private Button Button(Node parent,string text,Action action,bool disabled=false,string? key=null)
    {
        var b=new Button{Text=text,CustomMinimumSize=new Vector2(0,48),Disabled=disabled};parent.AddChild(b);buttons[key??text]=b;
        b.Pressed+=()=>{try{action();}catch(Exception e){message=e.Message;UpdateNotice();}};return b;
    }
    private VBoxContainer Card(Node parent)
    {
        var panel=new PanelContainer{SizeFlagsHorizontal=SizeFlags.ExpandFill};parent.AddChild(panel);
        panel.AddThemeStyleboxOverride("panel",new StyleBoxFlat{BgColor=new Color("2b493b"),ContentMarginLeft=14,ContentMarginRight=14,ContentMarginTop=10,ContentMarginBottom=10});
        var scroll=new ScrollContainer{SizeFlagsVertical=SizeFlags.ExpandFill,HorizontalScrollMode=ScrollContainer.ScrollMode.Disabled};panel.AddChild(scroll);
        var column=new VBoxContainer{SizeFlagsHorizontal=SizeFlags.ExpandFill};column.AddThemeConstantOverride("separation",10);scroll.AddChild(column);return column;
    }
    private void ReadView(){view=session.Invoke(new{op="view"});snapshot=view.GetProperty("snapshot");finished=HasBattle&&Str(Battle,"result")!="";debug=Str(snapshot,"mode")=="playtest";RefreshProjectNames();}
    private void DeriveStage(string? preferred=null)
    {
        stage=snapshot.GetProperty("completed").GetBoolean()?"completed":!HasBattle?"camp":!Battle.GetProperty("started").GetBoolean()?"deployment":finished&&preferred=="report"?"report":"battle";
    }
    private bool Command(object command)
    {
        var result=session.Invoke(new{op="command",command});
        if(!result.GetProperty("ok").GetBoolean()){message=Str(result,"message");UpdateNotice();return false;}
        ReadView();DeriveStage();if(finished)paused=true;AutoSave();return true;
    }
    private void Act(object command){if(Command(command))Render();}
    private void Confirm(string text,Action action)
    {
        if(confirmation!=null)confirmation.QueueFree();
        confirmation=new ConfirmationDialog{Title="确认操作",DialogText=text,OkButtonText="确认",CancelButtonText="取消"};AddChild(confirmation);
        confirmation.GetOkButton().CustomMinimumSize=new Vector2(120,48);confirmation.GetCancelButton().CustomMinimumSize=new Vector2(120,48);
        confirmation.Confirmed+=()=>{try{action();}catch(Exception e){message=e.Message;UpdateNotice();}};confirmation.PopupCentered(new Vector2I(560,180));
    }
    private void CreateRun()
    {
        session.Invoke(new{op="create",config,seed=2463534242u});ReadView();DeriveStage();paused=true;speed=1;costs.Clear();measuredTicks=0;normalBeforeDebug=null;debugSave=null;activeProject=null;
        saveBlocked=false;message="正式资源：从240金币与初始装备开始；胜利不会免费恢复。";
    }
    private void CreateStress()
    {
        if(!debug)normalBeforeDebug=Serialize();
        activeProject=null;var c=JsonNode.Parse(config.GetRawText())!;
        foreach(var entry in c["Rules"]!["Combatants"]!.AsObject()){entry.Value!["Base"]!["MaxHp"]=1000000;entry.Value["Growth"]!["MaxHp"]=0;}
        c["Encounters"]![0]!["Enemies"]![0]!["Count"]=12;
        session.Invoke(new{op="create",config=c,setup=new{floor=1,seed=2463534242u,party=new[]{"hero","princess","slime_dusk","sproutling","reedwing","boar","skeleton_guard","crab","water_elemental","earth_elemental"},level=1,rank=1,hpPercent=100,energy=0,startingGear=true,skillPolicy="supported-only",autoPlay=true,strategy=new{ultimates=false,healing="threshold",healingHpPercent=65,interrupt="charging",ultimateOrder=Array.Empty<string>(),reinforce=true,reinforcementOrder=Array.Empty<string>()}}});
        session.Invoke(new{op="command",command=new{type="begin"}});session.Invoke(new{op="command",command=new{type="start"}});session.Invoke(new{op="advance",ticks=2010});
        ReadView();DeriveStage();paused=false;costs.Clear();measuredTicks=0;speed=1;message="调试压力场景 · 百万生命 · 不计奖励，不写入正式进度。";
    }
    private string Serialize()=>JsonSerializer.Serialize(new{format="tower30-godot-session",version=1,core=session.Invoke(new{op="save"}).GetString(),stage,project=activeProject?.GetProperty("project"),projectName=activeProjectName});
    private void Restore(string json)
    {
        using var doc=JsonDocument.Parse(json);var data=doc.RootElement;
        if(Str(data,"format")!="tower30-godot-session"||data.GetProperty("version").GetInt32()!=1)throw new Exception("不支持的原生存档格式");
        JsonElement? restoredProject=null;
        if(data.TryGetProperty("project",out var project)&&project.ValueKind==JsonValueKind.Object)restoredProject=session.Invoke(new{op="restore-project",project,save=Str(data,"core")});
        else session.Invoke(new{op="restore",save=Str(data,"core"),config});
        activeProject=restoredProject;activeProjectName=data.TryGetProperty("projectName",out var title)&&title.ValueKind==JsonValueKind.String?title.GetString()!:"已保存工程";ReadView();DeriveStage(Str(data,"stage"));paused=true;speed=1;costs.Clear();
    }
    private void AutoSave(){if(!debug&&!saveBlocked){store.Write(Serialize());ticksSinceSave=0;}}
    private void SaveManual(){if(saveBlocked)throw new Exception("请先读取有效存档，或确认新试跑以保留损坏原件后重新开始。");if(debug){if(activeProject!=null)projectStore.Write(Serialize(),true);else debugSave=Serialize();}else store.Write(Serialize(),true);message=debug?(activeProject!=null?"项目测试已保存到独立测试槽；正式档未改动。":"测试会话已临时保存；正式档未改动。"):"已保存独立试跑进度与战报阶段。";UpdateNotice();}
    private void LoadManual(){var saved=debug?(activeProject!=null?projectStore.Read(true):debugSave):store.Read(true)??store.Read();if(saved==null){message="尚无可读取的独立存档。";UpdateNotice();return;}if(debug&&activeProject!=null)ValidateProjectSlot(saved);Restore(saved);saveBlocked=false;message="已恢复；战中读档保持暂停。";Render();}
    private void UpdateNotice()=>notice.Text=saveBlocked?"存档读取失败：当前为临时试跑，不会写盘；请载入有效档或确认新试跑。":message;
    private void Render()
    {
        ReadView();Clear(toolbar);Clear(actions);Clear(content);buttons.Clear();battlefield=null;
        heading.Text=debug?(activeProject!=null?$"项目试跑 · 第{snapshot.GetProperty("floor")}关 · 种子{snapshot.GetProperty("playtest").GetProperty("seed")}":"独立调试 · 10 vs 10 · 不计通关"):$"30层试炼   第{Math.Min(30,snapshot.GetProperty("floor").GetInt32())} / 30层   ◈ {snapshot.GetProperty("gold").GetInt32()}金币   {StageName()}";
        Button(toolbar,"新试跑",()=>Confirm("保存当前正式进度后，开始新的240金币试跑？",()=>{if(saveBlocked)store.PreserveRejected();else if(!debug)store.Write(Serialize(),true);CreateRun();AutoSave();Render();}));
        Button(toolbar,"保存进度",SaveManual);Button(toolbar,"载入进度",LoadManual);Button(toolbar,"工程 / Play",OpenProjectPage);
        if(debug)Button(toolbar,"返回正式进度",()=>{if(normalBeforeDebug!=null)Restore(normalBeforeDebug);else CreateRun();message="已返回正式进度。";Render();});
        else Button(toolbar,"调试场景",()=>{CreateStress();Render();});
        if(stage=="battle"){
            Button(toolbar,paused?"继续":"暂停",()=>{paused=!paused;Render();},finished,"pause");
            Button(toolbar,"单步 1/60秒",()=>{if(paused&&!finished)Step(1);},!paused||finished,"step");
            Button(toolbar,$"{speed}×速度",()=>{speed=speed==1?2:speed==2?4:1;Render();},finished,"speed");
        }
        switch(stage){
            case "project":RenderProjectPage();break;
            case "camp":RenderCamp();break;
            case "deployment":RenderDeployment();break;
            case "battle":RenderBattle();break;
            case "report":RenderReport();break;
            case "shop":RenderShop();break;
            case "completed":RenderCompleted();break;
        }
        UpdateNotice();
    }
    private string StageName()=>stage switch{"project"=>"网页工程", "camp"=>"战前整备","deployment"=>"首发布阵","battle"=>"战斗","report"=>"战报","shop"=>"商店与装备","completed"=>"已完成30层",_=>stage};
    private HBoxContainer Columns(){var row=new HBoxContainer();row.AddThemeConstantOverride("separation",12);content.AddChild(row);row.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);return row;}
    private void FloorCard(VBoxContainer column)
    {
        var floor=view.GetProperty("floor");if(floor.ValueKind!=JsonValueKind.Object)return;
        Label(column,$"第{floor.GetProperty("number")}层 · {Str(floor,"title")}",26);Label(column,Str(floor,"hint"));
        Label(column,$"{(floor.GetProperty("boss").GetBoolean()?"Boss关卡":"普通关卡")} · 确认战果后获得 {floor.GetProperty("gold")}金币");
        foreach(var enemy in floor.GetProperty("enemies").EnumerateArray()){
            var a=enemy.GetProperty("attributes");Label(column,$"{DisplayName(Str(enemy,"kind"))} ×{enemy.GetProperty("count")}  Lv{enemy.GetProperty("level")} / {enemy.GetProperty("rank")}阶\n生命 {a.GetProperty("MaxHp")}  攻击 {a.GetProperty("Attack")}  防御 {a.GetProperty("Defense")}");
        }
        var items=snapshot.GetProperty("items");Label(column,"当前物品："+string.Join("  ",items.EnumerateObject().Select(p=>$"{ItemName(p.Name)} {p.Value}")));
        Label(column,"生命与能量跨战保留；首发最多5人，每方最多10名存活单位。",18);
    }
    private string ItemName(string id)=>id switch{"herb"=>"草药","revive"=>"复活羽","shell"=>"硬壳","xp_potion"=>"小药水","xp_potion_m"=>"中药水","xp_potion_l"=>"大药水",_=>id};
    private void MemberCard(VBoxContainer parent,JsonElement m,bool deployment)
    {
        var id=Str(m,"id");var attributes=m.GetProperty("attributes");
        Label(parent,$"{DisplayName(id)}  Lv{m.GetProperty("level")} / {m.GetProperty("rank")}阶   生命 {m.GetProperty("hp")} / {attributes.GetProperty("MaxHp")}   能量 {Num(m,"energy"):F0}/1000",22);
        Label(parent,$"攻击 {attributes.GetProperty("Attack")}  防御 {attributes.GetProperty("Defense")}  魔力 {attributes.GetProperty("Magic")}  抗性 {attributes.GetProperty("Resistance")}",18);
        var row=new HFlowContainer();row.AddThemeConstantOverride("h_separation",8);row.AddThemeConstantOverride("v_separation",8);parent.AddChild(row);
        if(deployment){
            var selected=Battle.GetProperty("opening").EnumerateArray().Any(x=>x.GetString()==id);
            Button(row,selected?"首发 ✓":"加入首发",()=>Act(new{type="opening",id}),id is "hero" or "princess"||Num(m,"hp")<=0,"opening:"+id);
        }else{
            if(id is not "hero" and not "princess"){
                var t=m.GetProperty("training");Button(row,$"培养 · {t.GetProperty("units")}小瓶",()=>Act(new{type="train",id}),Num(t,"available")<Num(t,"units"),"train:"+id);
                Button(row,$"升阶 · {t.GetProperty("rankCost")}魂",()=>Act(new{type="rank",id}),m.GetProperty("rank").GetInt32()>=5,"rank:"+id);
                Button(row,"退还药水",()=>Act(new{type="refund",id}),Num(m,"potionXp")<=0,"refund:"+id);
            }
            Button(row,"草药",()=>Act(new{type="item",id,item="herb"}),Num(m,"hp")<=0,"herb:"+id);
            Button(row,"复活羽",()=>Act(new{type="item",id,item="revive"}),Num(m,"hp")>0,"revive:"+id);
        }
    }
    private void RenderCamp()
    {
        var columns=Columns();FloorCard(Card(columns));var team=Card(columns);Label(team,"伙伴 · 最终属性与资源",24);
        foreach(var m in Members)MemberCard(team,m,false);
        Button(actions,"战前布阵 →",()=>Act(new{type="begin"}));
        Button(actions,"商店 / 装备",()=>{stage="shop";Render();});
        Button(actions,$"旅馆 · {snapshot.GetProperty("innPrice")}金币",()=>Confirm($"支付 {snapshot.GetProperty("innPrice")}金币，在旅馆恢复全队？",()=>Act(new{type="rest"})),Num(snapshot,"gold")<Num(snapshot,"innPrice"),"rest");
    }
    private void RenderDeployment()
    {
        var columns=Columns();FloorCard(Card(columns));var team=Card(columns);
        Label(team,$"选择首发 · {Battle.GetProperty("opening").GetArrayLength()} / 5",24);
        foreach(var m in Members)MemberCard(team,m,true);
        Button(actions,"开始交战 →",()=>{if(Command(new{type="start"})){paused=false;costs.Clear();measuredTicks=0;Render();}});
        Button(actions,"返回整备",()=>Act(new{type="retry"}));
    }
    private void RenderBattle()
    {
        battlefield=new BattleCanvas();content.AddChild(battlefield);battlefield.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);battlefield.SetConfig(config);battlefield.SetDisplayNames(names);battlefield.Current=Battle;battlefield.FloorNumber=snapshot.GetProperty("floor").GetInt32();battlefield.Background=Str(snapshot,"arenaBackground");battlefield.VisualSeconds=Num(Battle,"seconds");
        var scroll=new ScrollContainer{SizeFlagsHorizontal=SizeFlags.ExpandFill,VerticalScrollMode=ScrollContainer.ScrollMode.Disabled};actions.AddChild(scroll);var row=new HBoxContainer();row.AddThemeConstantOverride("separation",8);scroll.AddChild(row);
        foreach(var m in Members){
            var id=Str(m,"id");var unit=Battle.GetProperty("units").EnumerateArray().FirstOrDefault(u=>!u.GetProperty("enemy").GetBoolean()&&Str(u,"id")==id);
            if(unit.ValueKind==JsonValueKind.Object)Button(row,$"{DisplayName(id)} · 大招 {Num(unit,"energy"):F0}",()=>{if(Command(new{type="ultimate",id}))SyncBattle();},finished||Num(unit,"hp")<=0||Num(unit,"energy")<1000,"ultimate:"+id);
            else Button(row,$"补入 {DisplayName(id)}",()=>{if(Command(new{type="reinforce",id})){Render();}},finished||Num(m,"hp")<=0,"reinforce:"+id);
        }
        if(activeProject!=null)Button(actions,"重开测试",RestartActiveProject);
        if(finished)Button(actions,"查看战报 →",()=>{stage="report";AutoSave();Render();});
        else Button(actions,"撤回",()=>Confirm("撤回本层战斗，进入失败战报？",()=>Act(new{type="withdraw"})));
    }
    private void RenderReport()
    {
        var columns=Columns();var summary=Card(columns);var stats=Card(columns);
        Label(summary,Victory?"赢下这一战。":"本层未能获胜。",30);
        Label(summary,$"第{snapshot.GetProperty("floor")}层 · {Str(view.GetProperty("floor"),"title")}\n用时 {Num(Battle,"seconds"):F3}秒 / {Battle.GetProperty("tick")} tick");
        Label(summary,debug?"独立测试不发放正式奖励。":Victory?$"待确认奖励：{view.GetProperty("floor").GetProperty("gold")}金币\n当前余额 {snapshot.GetProperty("gold")}；点击确认发放奖励并前往下一层。":"可以恢复本层战前检查点重试。未发放通关奖励。",22);
        Label(summary,"伙伴保留剩余生命与能量；进入下一层不会自动恢复。",18);
        Label(stats,"成员贡献 · 实际战斗统计",24);
        foreach(var u in Battle.GetProperty("units").EnumerateArray().Where(u=>!u.GetProperty("enemy").GetBoolean()))Label(stats,$"{DisplayName(Str(u,"kind"))}   输出 {u.GetProperty("damage")}   治疗 {u.GetProperty("healing")}\n吸收 {u.GetProperty("absorbed")}   大招 {u.GetProperty("ultimates")}   剩余生命 {u.GetProperty("hp")}");
        if(debug)Button(actions,"返回测试战场",()=>{stage="battle";Render();});
        else if(Victory)Button(actions,"确认战果 · 下一层 →",FinishBattle);
        else Button(actions,"重试本层 · 返回整备",()=>Act(new{type="retry"}));
        Button(actions,"返回战场",()=>{stage="battle";Render();});
    }
    private void FinishBattle(){if(debug)return;if(Command(new{type="finish"})){paused=true;message="已结算一次并保留生命/能量；可在旅馆付费恢复。";Render();}}
    private void RenderShop()
    {
        var columns=Columns();var goods=Card(columns);var gear=Card(columns);Label(goods,$"常驻商店 · 阶段{snapshot.GetProperty("shopStage")}",24);
        foreach(var offer in view.GetProperty("shop").EnumerateArray().Where(o=>o.GetProperty("unlocked").GetBoolean())){
            var id=Str(offer,"id");var item=Str(offer,"item");var g=offer.GetProperty("gear");var q=offer.GetProperty("quote");
            Label(goods,$"{(g.ValueKind==JsonValueKind.Object?Str(g,"Name"):ItemName(item))}  ×{offer.GetProperty("amount")}   {q.GetProperty("total")}金币   库存{(Num(q,"stock")<0?"不限":q.GetProperty("stock").ToString())}",22);
            if(g.ValueKind==JsonValueKind.Object){Label(goods,Str(g,"ModernDescription"),18);Label(goods,Attributes(g.GetProperty("Attributes")),18);}
            Button(goods,"购买 · "+q.GetProperty("total")+"金币",()=>Confirm($"花费 {q.GetProperty("total")}金币购买？",()=>{if(Command(new{type="buy",id,quantity=1})){stage="shop";Render();}}),Num(q,"balance")<0||Num(q,"stock")==0,"buy:"+id);
        }
        Label(gear,"主角装备 · 最终属性与装备加成",24);
        foreach(var human in Members.Where(m=>Str(m,"id") is "hero" or "princess")){
            var id=Str(human,"id");Label(gear,DisplayName(id)+" · 最终属性\n"+Attributes(human.GetProperty("attributes")),22);
            foreach(var equipped in human.GetProperty("equipment").EnumerateObject()){
                var definition=config.GetProperty("Rules").GetProperty("Equipment").EnumerateArray().First(g=>Str(g,"Id")==equipped.Value.GetString());
                Label(gear,$"{equipped.Name} · {Str(definition,"Name")}\n{Attributes(definition.GetProperty("Attributes"))}\n{Str(definition,"ModernDescription")}",18);
            }
        }
        Label(gear,"已拥有装备 · 点击穿戴",24);
        foreach(var owned in snapshot.GetProperty("equipment").EnumerateArray()){
            var item=owned.GetString()!;var g=config.GetProperty("Rules").GetProperty("Equipment").EnumerateArray().First(g=>Str(g,"Id")==item);
            Label(gear,Str(g,"Name")+" · "+Attributes(g.GetProperty("Attributes")),18);var row=new HFlowContainer();gear.AddChild(row);
            foreach(var id in new[]{"hero","princess"})Button(row,"装备给"+DisplayName(id),()=>{if(Command(new{type="equip",id,gear=item})){stage="shop";Render();}},false,"equip:"+id+":"+item);
        }
        Button(actions,"返回战前整备",()=>{stage="camp";Render();});
    }
    private string Attributes(JsonElement a)=>$"生命 {a.GetProperty("MaxHp")}  攻击 {a.GetProperty("Attack")}  防御 {a.GetProperty("Defense")}  魔力 {a.GetProperty("Magic")}  抗性 {a.GetProperty("Resistance")}";
    private void RenderCompleted(){var card=Card(Columns());Label(card,"30层试炼完成",32);Label(card,$"实际胜利记录 {snapshot.GetProperty("records").GetArrayLength()}层\n金币 {snapshot.GetProperty("gold")} · 累计 {snapshot.GetProperty("completion").GetProperty("seconds")}秒\n已保存独立试跑进度。",24);}
    private void SyncBattle()
    {
        frame=session.Invoke(new{op="frame"});if(battlefield!=null)battlefield.Current=frame.GetProperty("battle");
    }
    private void Step(int ticks)
    {
        if(stage!="battle"||finished)return;
        var watch=Stopwatch.StartNew();
        var before=battlefield!.Current;
        if(ticks>1)before=session.Invoke(new{op="advance",ticks=ticks-1}).GetProperty("battle");
        frame=session.Invoke(new{op="advance",ticks=1});
        if(battlefield!=null){battlefield.Previous=before;battlefield.Current=frame.GetProperty("battle");if(paused)battlefield.VisualSeconds=Num(battlefield.Current,"seconds");}
        watch.Stop();costs.Add(watch.Elapsed.TotalMilliseconds/ticks);measuredTicks+=ticks;ticksSinceSave+=ticks;
        var b=frame.GetProperty("battle");finished=Str(b,"result")!="";
        if(finished){ReadView();paused=true;message=Victory?"战斗胜利：存活伙伴面向玩家踏步；查看战报后确认奖励。":"战斗结束，可查看战报或重试。";AutoSave();Render();}
        else if(!measurement&&!debug&&ticksSinceSave>=60){ReadView();AutoSave();}
        if(!finished){
            foreach(var u in b.GetProperty("units").EnumerateArray().Where(u=>!u.GetProperty("enemy").GetBoolean()))if(buttons.TryGetValue("ultimate:"+Str(u,"id"),out var button)){button.Text=$"{DisplayName(Str(u,"kind"))} · 大招 {Num(u,"energy"):F0}";button.Disabled=Num(u,"hp")<=0||Num(u,"energy")<1000;}
            message=$"{(debug?"调试场景 · ":"")}逻辑60Hz · {Num(b,"seconds"):F3}秒 / T{b.GetProperty("tick")} · 画面{Engine.GetFramesPerSecond()}FPS · 均值{costs.Average():F2}ms";UpdateNotice();
        }
    }
    public override void _PhysicsProcess(double delta)
    {
        if(session==null||stage!="battle"||paused||finished)return;
        try{Step(speed);if(measurement){if(warmupTicks<60){warmupTicks++;costs.Clear();measuredTicks=0;startUsec=Time.GetTicksUsec();}else if(measuredTicks>=360)FinishMeasurement();}}
        catch(Exception e){GD.PushError(e.ToString());paused=true;GetTree().Quit(1);}
    }
    public override void _Process(double delta)
    {
        if(session==null||battlefield==null)return;
        if(delta>.5&&!measurement&&!finished){paused=true;message="检测到长帧，战斗已暂停。";Render();return;}
        if(!paused||Victory)battlefield.VisualSeconds+=delta;
        battlefield.Alpha=paused?1:(float)Engine.GetPhysicsInterpolationFraction();battlefield.QueueRedraw();
        if(uiTest==null&&capture!=null&&(captureResult?finished:measuredTicks>=180)&&!capturing){capturing=true;_ = Capture(capture);}
    }
    private async System.Threading.Tasks.Task Capture(string path,bool quit=true)
    {
        await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        var error=GetViewport().GetTexture().GetImage().SavePng(path);if(error!=Error.Ok)throw new Exception("Screenshot failed: "+error);
        if(quit&&!measurement)GetTree().Quit();
    }
    private void FinishMeasurement()
    {
        paused=true;measurement=false;costs.Sort();var b=frame.GetProperty("battle");var alive=b.GetProperty("units").EnumerateArray().Where(u=>Num(u,"hp")>0).ToArray();var elapsed=(Time.GetTicksUsec()-startUsec)/1000000.0;
        File.WriteAllText(output!,JsonSerializer.Serialize(new{host="Godot 4.6.2 .NET + QuickJS 2026-06-04",warmupTicks,ticks=measuredTicks,elapsedSeconds=elapsed,actualLogicHz=measuredTicks/elapsed,meanStepMs=costs.Average(),p95StepMs=costs[(int)(costs.Count*.95)],maxStepMs=costs.Last(),renderFps=Engine.GetFramesPerSecond(),livingAllies=alive.Count(u=>!u.GetProperty("enemy").GetBoolean()),livingEnemies=alive.Count(u=>u.GetProperty("enemy").GetBoolean()),windowPixels=new{width=GetWindow().Size.X,height=GetWindow().Size.Y},note="Linux desktop with software renderer; not a physical phone. Pipeline includes adjacent-snapshot reads, JSON and native bridge."},new JsonSerializerOptions{WriteIndented=true}));GetTree().Quit();
    }
    public override void _Draw()=>DrawRect(new Rect2(Vector2.Zero,Size),new Color("182d28"));
    public override void _ExitTree(){session?.Dispose();}
}
