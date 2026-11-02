using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
public partial class Main
{
    private async System.Threading.Tasks.Task RunUiChecks(string path)
    {
        var checks=new List<string>();var started=Time.GetTicksUsec();var dir=Path.GetDirectoryName(path)!;var label="godot-"+Path.GetFileName(path).Replace("-ui-checks.json","");
        try{
            void Check(bool ok,string text){if(!ok)throw new Exception(text);checks.Add(text);}
            void Press(string key){if(!buttons.TryGetValue(key,out var b))throw new Exception("Missing button: "+key);if(b.Disabled)throw new Exception("Disabled button: "+key);b.EmitSignal(Godot.Button.SignalName.Pressed);}
            void Accept(){confirmation!.Hide();confirmation.EmitSignal(ConfirmationDialog.SignalName.Confirmed);}
            int Tick()=>session.Invoke(new{op="snapshot"}).GetProperty("tick").GetInt32();
            async System.Threading.Tasks.Task Frames(int count){for(var i=0;i<count;i++){if(Time.GetTicksUsec()-started>180000000)throw new Exception("UI check timed out");await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);}}
            async System.Threading.Tasks.Task Shot(string name){await Frames(OS.GetCmdlineUserArgs().Contains("--demo-only")?(name is "victory-front-walk" or "report" or "next-floor"?60:30):2);await Capture(Path.Combine(dir,label+"-"+name+".png"),false);}
            Check(stage=="camp"&&Num(snapshot,"gold")==240,"fresh run opens preparation with original 240 gold");
            await Shot("preparation");Check(buttons["战前布阵 →"].GetGlobalRect().Size.Y>=48,"primary button retains 48px touch height");
            Press("商店 / 装备");var gold=Num(snapshot,"gold");Press("buy:gear_break_sword");Check(Num(snapshot,"gold")==gold,"purchase preview does not spend before confirmation");Accept();Press("equip:hero:break_sword");Press("buy:gear_ward_staff");Accept();Press("equip:princess:ward_staff");
            Check(Num(snapshot,"gold")==45,"starter upgrades spend only actual configured prices");await Shot("shop-equipment");Press("返回战前整备");
            Press("战前布阵 →");Check(stage=="deployment"&&!Battle.GetProperty("started").GetBoolean(),"begin prepares without running physics");await Shot("deployment");Press("开始交战 →");
            while(Tick()<60)await Frames(1);Press("pause");var tick=Tick();await Frames(10);Check(Tick()==tick,"pause freezes core while rendering continues");
            Press("step");Check(Tick()==tick+1,"single step advances exactly 1/60 second");
            var ally=battlefield!.Current.GetProperty("units").EnumerateArray().First(u=>!u.GetProperty("enemy").GetBoolean());var enemy=battlefield.Current.GetProperty("units").EnumerateArray().First(u=>u.GetProperty("enemy").GetBoolean());
            Check(battlefield.Pose(ally,0).Position.Y==80,"human in combat uses actual right-facing row, not front or mirrored front");Check(battlefield.Pose(enemy,0).Position.Y==16,"monster in combat uses actual left-facing row");await Shot("side-battle");
            Press("保存进度");var saved=session.Invoke(new{op="snapshot"}).GetRawText();for(var i=0;i<10;i++)Press("step");Press("载入进度");Check(session.Invoke(new{op="snapshot"}).GetRawText()==saved,"native disk journal restore reproduces exact active battle");
            Press("pause");while(!finished)await Frames(1);Check(Tick()==555&&Victory,"Godot physics reaches real normal-resource first-floor victory at 555 ticks");
            var finalTick=Tick();var visual=battlefield!.VisualSeconds;await Frames(18);Check(Tick()==finalTick&&battlefield.VisualSeconds>visual,"victory animates facing-player walk while logical tick remains frozen");
            ally=battlefield.Current.GetProperty("units").EnumerateArray().First(u=>!u.GetProperty("enemy").GetBoolean()&&Num(u,"hp")>0);Check(battlefield.Pose(ally,0).Position.Y==16,"winning human changes to front row");Check(battlefield.Pose(ally,.01).Position.X!=battlefield.Pose(ally,.21).Position.X,"winning front walk cycles frames");await Shot("victory-front-walk");
            Press("查看战报 →");Check(stage=="report"&&Num(snapshot,"gold")==45,"report shows unclaimed reward without awarding it");await Shot("report");
            Press("保存进度");Press("返回战场");Press("载入进度");Check(stage=="report"&&Tick()==555,"disk restore keeps unclaimed report stage");
            var hp=Members.ToDictionary(m=>Str(m,"id"),m=>Num(m,"hp"));Press("确认战果 · 下一层 →");Check(stage=="camp"&&Num(snapshot,"floor")==2&&Num(snapshot,"gold")==110,"finish advances to floor 2 with one 65-gold configured reward");
            Check(Members.All(m=>hp.GetValueOrDefault(Str(m,"id"),Num(m,"hp"))==Num(m,"hp")),"next floor preserves surviving health, no free recovery");
            var duplicate=session.Invoke(new{op="command",command=new{type="finish"}});Check(!duplicate.GetProperty("ok").GetBoolean()&&Num(session.Invoke(new{op="snapshot"}),"gold")==110,"duplicate reward command is rejected without extra gold");
            Press("保存进度");Press("载入进度");Check(stage=="camp"&&Num(snapshot,"floor")==2&&Num(snapshot,"gold")==110,"claimed progress reload stays on next floor, reward not duplicated");await Shot("next-floor");
            if(OS.GetCmdlineUserArgs().Contains("--demo-only")){File.WriteAllText(path,JsonSerializer.Serialize(new{passed=true,checks,kind="recorded first-floor flow only"}));GetTree().Quit();return;}
            Press("rest");Accept();Check(Num(snapshot,"gold")==75&&Members.All(m=>Num(m,"hp")==Num(m.GetProperty("attributes"),"MaxHp")),"rest charges original 35 gold through core and recovers party");
            Press("战前布阵 →");Check(buttons.ContainsKey("opening:slime_dusk"),"collected monster becomes available for opening selection");Press("opening:slime_dusk");Check(!Battle.GetProperty("opening").EnumerateArray().Any(x=>x.GetString()=="slime_dusk"),"opening toggle uses actual core selection");Press("opening:slime_dusk");Press("开始交战 →");while(Tick()<600)await Frames(1);Press("撤回");Accept();Check(finished&&Str(Battle,"result")=="flee","withdraw creates actual failure result");Press("查看战报 →");Press("重试本层 · 返回整备");Check(stage=="camp"&&Num(snapshot,"floor")==2&&Num(snapshot,"gold")==75,"retry restores checkpoint without extra reward or funds");
            var normal=session.Invoke(new{op="snapshot"}).GetRawText();Press("调试场景");Check(debug&&battlefield!.Current.GetProperty("units").EnumerateArray().Count(u=>Num(u,"hp")>0)==20,"stress scene isolates 20 real living units from formal progress");Press("pause");Press("保存进度");var stress=session.Invoke(new{op="snapshot"}).GetRawText();Press("step");Press("载入进度");Check(session.Invoke(new{op="snapshot"}).GetRawText()==stress,"debug memory save/restore remains separate from native formal file");Press("返回正式进度");Check(session.Invoke(new{op="snapshot"}).GetRawText()==normal,"return from debug preserves exact formal session");
            foreach(var boss in new[]{10,20,30}){
                var checkpoint=Path.Combine(dir,$"native-boss-{boss}-unclaimed.json");
                if(!File.Exists(checkpoint))throw new Exception("Missing real normal-resource checkpoint: "+checkpoint);
                store.Write(File.ReadAllText(checkpoint),true);Press("载入进度");
                Check(stage=="report"&&Victory&&Num(snapshot,"floor")==boss,$"boss {boss}: genuine unclaimed normal-resource save restores into report");
                if(boss==10){
                    Press("返回战场");var monster=battlefield!.Current.GetProperty("units").EnumerateArray().First(u=>!u.GetProperty("enemy").GetBoolean()&&Str(u,"kind") is not "hero" and not "princess"&&Num(u,"hp")>0);
                    Check(battlefield.Pose(monster,0).Position.Y==0,"winning monster uses front row from actual Boss 10 victory save");
                    Check(battlefield.Pose(monster,.01).Position.X!=battlefield.Pose(monster,.21).Position.X,"winning monster front walk cycles without advancing core");
                    await Shot("monsters-victory-front-walk");Press("查看战报 →");
                }
                var before=Num(snapshot,"gold");var reward=Num(view.GetProperty("floor"),"gold");Press("确认战果 · 下一层 →");
                Check(Num(snapshot,"floor")==boss+1&&Num(snapshot,"gold")==before+reward,$"boss {boss}: UI confirmation awards once and advances");
                Check(Num(snapshot,"shopStage")==boss/10&&Num(snapshot,"innPrice")==35+15*(boss/10),$"boss {boss}: core shop stage and paid inn price update");
                Press("保存进度");Press("载入进度");
                Check(Num(snapshot,"floor")==boss+1&&Num(snapshot,"gold")==before+reward,$"boss {boss}: persisted claimed state cannot duplicate reward");
                if(boss==30){Check(stage=="completed"&&snapshot.GetProperty("completed").GetBoolean()&&snapshot.GetProperty("records").GetArrayLength()==30&&Num(snapshot,"gold")==610,"actual 30-floor save reaches completed page with 610 gold and 30 victory records");await Shot("completed-30");}
                else {await Shot($"boss-{boss}-next-floor");}
            }
            File.WriteAllText(path,JsonSerializer.Serialize(new{passed=true,checks,firstVictoryTick=555,claimedGold=110,paidRestGold=75,source="Godot button pressed/confirmation signals with actual physics frames and independent disk save path; no OS pointer automation"},new JsonSerializerOptions{WriteIndented=true}));GetTree().Quit();
        }catch(Exception e){File.WriteAllText(path,JsonSerializer.Serialize(new{passed=false,checks,error=e.ToString()},new JsonSerializerOptions{WriteIndented=true}));GD.PushError(e.ToString());GetTree().Quit(1);}
    }
}
