using Godot;
using System;
using System.IO;
using System.Collections.Generic;
using System.Text.Json;
public partial class Main
{
    private async System.Threading.Tasks.Task RunProjectChecks(string outputPath,string artifacts)
    {
        var checks=new List<string>();var started=Time.GetTicksUsec();var tag=Path.GetFileName(outputPath).Replace("-project-checks.json","");
        try{
            void Check(bool ok,string text){if(!ok)throw new Exception(text);checks.Add(text);}
            void Press(string key){if(!buttons.TryGetValue(key,out var b)||b.Disabled)throw new Exception("Missing/disabled button: "+key);b.EmitSignal(Godot.Button.SignalName.Pressed);}
            string Save()=>session.Invoke(new{op="save"}).GetString()!;
            int Tick()=>session.Invoke(new{op="snapshot"}).GetProperty("tick").GetInt32();
            async System.Threading.Tasks.Task Frames(int count){for(var i=0;i<count;i++){if(Time.GetTicksUsec()-started>90000000)throw new Exception("Project checks timed out");await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);}}
            async System.Threading.Tasks.Task Shot(string name){await Frames(2);await Capture(Path.Combine(artifacts,tag+"-"+name+".png"),false);}
            void Select(string filename){Press("选择工程 JSON");projectDialog!.Hide();projectDialog.EmitSignal(FileDialog.SignalName.FileSelected,Path.Combine(artifacts,filename));}
            var formal=Save();var disk=store.Read();Press("工程 / Play");
            Select("desktop-web-project-a.json");Check(pendingProject!=null&&Save()==formal,"actual browser-exported project previews without changing formal core or currency");
            var a=pendingProject!.Value;var launch=Str(a.GetProperty("info"),"launchHash");
            await Shot("project-preview");Press("play-project");Check(debug&&activeProject!=null&&stage=="battle","project Play starts a separate real battle");
            Check(Num(snapshot,"floor")==3&&Num(snapshot.GetProperty("playtest"),"seed")==123456,"web floor and fixed seed reach native core");
            var cfg=session.Invoke(new{op="config"});Check(Num(cfg.GetProperty("Rules").GetProperty("Combatants").GetProperty("hero").GetProperty("Base"),"Attack")==411,"edited human attack reaches native core");
            Check(Num(cfg.GetProperty("Rules").GetProperty("Combatants").GetProperty("slime_dusk").GetProperty("Base"),"MaxHp")==23456,"edited monster health reaches native core");
            Check(cfg.GetProperty("Rules").GetProperty("Actions").GetProperty("firebolt").GetProperty("Ratios")[0].GetDouble()==3.25,"edited skill ratio reaches native core");
            Check(snapshot.GetProperty("playtest").GetProperty("strategy").GetProperty("healingHpPercent").GetInt32()==40,"web automatic strategy and threshold remain frozen");
            while(Tick()<180&&!finished)await Frames(1);if(!paused)Press("pause");var ticks=Tick();Check(ticks>=180&&!finished,"imported setup executes actual fixed-60Hz ticks");
            var initial=Save();File.WriteAllText(Path.Combine(artifacts,tag+"-native-record.json"),initial);
            await Shot("project-battle");Press("工程 / Play");Select("desktop-web-project-b.json");
            Check(Save()==initial&&Str(activeProject!.Value.GetProperty("info"),"launchHash")==launch,"importing B does not hot-swap running frozen A");
            Check(Str(pendingProject!.Value.GetProperty("info"),"launchHash")!=launch,"preview identifies a different launch as a different project");
            Press("同配置同种子重开");Press("pause");for(var i=0;i<ticks;i++)Press("step");Check(Save()==initial,"same-configuration same-seed restart reproduces exact native journal/state time");
            Press("保存进度");Press("step");Press("载入进度");Check(Save()==initial&&activeProject!=null,"project save slot restores frozen project and active battle without touching formal slot");
            Press("工程 / Play");Select("invalid-project.json");Check(Save()==initial&&Str(pendingProject!.Value.GetProperty("info"),"launchHash")!=launch,"invalid JSON preserves active A and pending valid B");
            await Shot("invalid-project");Select("oversize-project.json");Check(Save()==initial,"oversized project is rejected without replacing live state");
            Press("导出测试记录");recordDialog!.Hide();var exported=Path.Combine(artifacts,tag+"-exported-record.json");recordDialog.EmitSignal(FileDialog.SignalName.FileSelected,exported);
            Check(File.ReadAllText(exported)==initial,"native export is the exact shared-core playback record, not a rebuilt report");
            Press("play-project");Check(Str(activeProject!.Value.GetProperty("info"),"launchHash")!=launch&&Tick()==0,"explicit Play starts B with its own frozen identity");
            Press("返回正式进度");Check(!debug&&Save()==formal&&store.Read()==disk,"return from projects restores exact formal progress; normal save file unchanged");
            Press("工程 / Play");Press("恢复上次项目测试");Check(debug&&Save()==initial&&Str(activeProject!.Value.GetProperty("info"),"launchHash")==launch,"persisted test slot recovers A even after returning to formal progress");
            await Shot("restored-project");Press("返回正式进度");
            File.WriteAllText(outputPath,JsonSerializer.Serialize(new{passed=true,checks,ticks,launchHash=launch,record=tag+"-exported-record.json",note="Native file-dialog FileSelected and button pressed signals; actual browser exported project; no OS pointer automation."},new JsonSerializerOptions{WriteIndented=true}));GetTree().Quit();
        }catch(Exception e){File.WriteAllText(outputPath,JsonSerializer.Serialize(new{passed=false,checks,error=e.ToString()},new JsonSerializerOptions{WriteIndented=true}));GD.PushError(e.ToString());GetTree().Quit(1);}
    }
}
