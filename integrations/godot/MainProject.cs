using Godot;
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Tower30;

public partial class Main
{
    private NativeSaveStore projectStore=null!;
    private JsonElement? pendingProject,activeProject;
    private string pendingProjectName="",activeProjectName="",projectReturnStage="camp",projectNamesHash="";
    private bool projectReturnPaused;
    private string projectError="";
    private FileDialog? projectDialog,recordDialog;
    private void RefreshProjectNames()
    {
        var hash=Str(snapshot,"configHash");if(hash==projectNamesHash)return;
        var activeConfig=session.Invoke(new{op="config"});names.Clear();names["hero"]="主角";names["princess"]="公主";
        foreach(var s in activeConfig.GetProperty("Species").EnumerateArray())names[Str(s,"Id")]=Str(s,"Name");projectNamesHash=hash;
    }
    private void OpenProjectPage()
    {
        if(stage!="project"){projectReturnStage=stage;projectReturnPaused=paused;}
        paused=true;stage="project";message="网页选择“导出Godot试跑”，在这里导入JSON；预览不会替换当前战斗。";Render();
    }
    private void OpenProjectPicker()
    {
        if(projectDialog!=null)projectDialog.QueueFree();
        projectDialog=new FileDialog{Title="导入网页工程 JSON",Access=FileDialog.AccessEnum.Filesystem,FileMode=FileDialog.FileModeEnum.OpenFile,UseNativeDialog=false,Filters=new[]{"*.json ; 网页工程 JSON"}};
        AddChild(projectDialog);projectDialog.GetOkButton().CustomMinimumSize=new Vector2(120,48);projectDialog.GetCancelButton().CustomMinimumSize=new Vector2(120,48);projectDialog.FileSelected+=path=>InspectProjectFile(path);projectDialog.PopupCenteredRatio(.85f);
    }
    private bool InspectProjectFile(string path)
    {
        try{
            if(new FileInfo(path).Length>2000000)throw new Exception("工程文件不能超过2MB");
            using var doc=JsonDocument.Parse(File.ReadAllText(path));
            var inspected=session.Invoke(new{op="inspect-project",project=doc.RootElement});
            projectError="";pendingProject=inspected;pendingProjectName=Path.GetFileName(path);
            message="工程校验通过；点击Play后才启动，当前运行中的配置没有变化。";stage="project";Render();return true;
        }catch(Exception e){projectError=e is JsonException?"文件不是完整有效的JSON，请重新从网页导出。":e.Message;message="导入失败，当前测试和已加载工程未改变。";if(stage=="project")Render();else UpdateNotice();return false;}
    }
    private void StartProject(JsonElement selected,string title)
    {
        var formal=!debug?Serialize():normalBeforeDebug;
        var next=session.Invoke(new{op="play-project",project=selected.GetProperty("project")});
        // Commit host context only after the shared core constructed and started a valid candidate.
        if(!debug)normalBeforeDebug=formal;
        activeProject=next;activeProjectName=title;ReadView();DeriveStage();paused=false;speed=1;costs.Clear();measuredTicks=0;ticksSinceSave=0;
        message=$"工程已冻结 · {Str(next.GetProperty("info"),"launchHash")} · 同种子重开可复现；不计正式奖励。";Render();
    }
    private void RestartActiveProject(){if(activeProject is JsonElement selected)StartProject(selected,activeProjectName);}
    private void ValidateProjectSlot(string saved)
    {
        using var doc=JsonDocument.Parse(saved);
        if(!doc.RootElement.TryGetProperty("project",out var p)||p.ValueKind!=JsonValueKind.Object)throw new Exception("独立测试槽缺少冻结工程，当前状态未改变");
    }
    private void RestoreLastProject()
    {
        var saved=projectStore.Read(true);if(saved==null){message="尚无已保存的项目测试。";UpdateNotice();return;}
        var formal=!debug?Serialize():normalBeforeDebug;
        ValidateProjectSlot(saved);Restore(saved);if(!debug)throw new Exception("独立测试槽格式无效");normalBeforeDebug=formal;message="已恢复冻结工程与命令记录；当前暂停。";Render();
    }
    private void OpenRecordExport()
    {
        if(!debug){message="请先启动独立项目测试。";UpdateNotice();return;}
        paused=true;Render();var frozen=session.Invoke(new{op="save"}).GetString()!;
        if(recordDialog!=null)recordDialog.QueueFree();
        recordDialog=new FileDialog{Title="导出冻结测试记录",Access=FileDialog.AccessEnum.Filesystem,FileMode=FileDialog.FileModeEnum.SaveFile,UseNativeDialog=false,Filters=new[]{"*.json ; 测试记录 JSON"},CurrentFile="tower30-playtest-record.json"};AddChild(recordDialog);recordDialog.GetOkButton().CustomMinimumSize=new Vector2(120,48);recordDialog.GetCancelButton().CustomMinimumSize=new Vector2(120,48);
        recordDialog.FileSelected+=path=>{try{File.WriteAllText(path,frozen,new UTF8Encoding(false));message="已导出测试记录；可回到网页工作台导入并回放。";UpdateNotice();}catch(Exception e){message="导出失败："+e.Message;UpdateNotice();}};
        recordDialog.PopupCenteredRatio(.85f);
    }
    private void ProjectDetails(VBoxContainer column,JsonElement entry,string title)
    {
        var info=entry.GetProperty("info");var setup=info.GetProperty("setup");
        Label(column,title,22);
        Label(column,$"第{setup.GetProperty("floor")}关 · 种子 {setup.GetProperty("seed")}",24);
        Label(column,$"配置 {Str(info,"configHash")}\n试跑 {Str(info,"launchHash")}",18);
        Label(column,$"{Str(info,"title")}\nLv{setup.GetProperty("level")} / {setup.GetProperty("rank")}阶 · 生命 {setup.GetProperty("hpPercent")}%\n能量 {setup.GetProperty("energy")}/1000",20);
        Label(column,"阵容："+string.Join("、",setup.GetProperty("party").EnumerateArray().Select(x=>DisplayName(x.GetString()!))),20);
        var auto=setup.TryGetProperty("autoPlay",out var play)&&play.GetBoolean();
        Label(column,auto?"策略自动执行；大招和补人按工程设置提交命令。":"手动大招与补人；角色普攻/自动技能照常执行。",18);
        if(setup.TryGetProperty("strategy",out var strategy))Label(column,$"治疗：{(Str(strategy,"healing")=="threshold"?"生命低于阈值":Str(strategy,"healing")=="immediate"?"满能即放":"不自动治疗")} · {strategy.GetProperty("healingHpPercent")}%\n打断：{(Str(strategy,"interrupt")=="charging"?"敌方吟唱时":Str(strategy,"interrupt")=="immediate"?"满能即放":"不自动打断")} · 自动补人{(strategy.GetProperty("reinforce").GetBoolean()?"开启":"关闭")}\n大招顺序：{(strategy.GetProperty("ultimateOrder").GetArrayLength()==0?"按阵容顺序":string.Join("、",strategy.GetProperty("ultimateOrder").EnumerateArray().Select(x=>DisplayName(x.GetString()!))))}",18);
        foreach(var warning in info.GetProperty("warnings").EnumerateArray())Label(column,"停用提示："+warning.GetString(),18);
    }
    private void RenderProjectPage()
    {
        var columns=Columns();var imported=Card(columns);var running=Card(columns);
        Label(imported,"网页工程 → 原生Play",27);if(pendingProject==null)Label(imported,"1. 网页修改属性、关卡、技能与策略。\n2. 点击“导出Godot试跑”。\n3. 导入JSON，检查关卡、种子与配置标识后Play。",20);
        Button(actions,"选择工程 JSON",OpenProjectPicker);if(projectError!="")Label(imported,"文件未应用："+projectError[..Math.Min(projectError.Length,1500)],18);
        if(pendingProject is JsonElement loaded){ProjectDetails(imported,loaded,"待启动 · "+pendingProjectName);}
        else Label(imported,"尚未导入工程。导入与重新导入都不会修改正在运行的测试。",20);
        if(activeProject is JsonElement active){ProjectDetails(running,active,"当前冻结测试 · "+activeProjectName);}
        else {Label(running,"正式进度独立保存",25);Label(running,"工程Play不扣除正式金币、不领取正式奖励。返回正式进度时恢复进入测试前状态。\n\n若网页改了新版本，需要重新导出并导入；正在运行的旧测试继续使用原配置。",20);}
        if(pendingProject is JsonElement ready)Button(actions,$"▶ Play 第{ready.GetProperty("info").GetProperty("setup").GetProperty("floor")}关",()=>StartProject(ready,pendingProjectName),false,"play-project");
        if(activeProject!=null){Button(actions,"同配置同种子重开",RestartActiveProject);Button(actions,"导出测试记录",OpenRecordExport);}
        Button(running,"恢复上次项目测试",RestoreLastProject);
        Button(actions,debug?"返回当前测试":"返回正式页面",()=>{stage=projectReturnStage;paused=projectReturnPaused;DeriveStage(stage);Render();});
    }
}
