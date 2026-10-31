using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using BattleTower;
using Retro;
var d=TowerDefinition.Parse(File.ReadAllText("data/tower/thirty-floor-trial.json"));
var c=d.CreateCatalog(BattleCatalog.Parse(File.ReadAllText("data/combat/catalog.json")));
var r=new TowerRun(d,c);
var traces=new List<object>();
bool ultimates=args.Contains("--ultimates");
for(int floor=1;floor<=2;floor++){
 r.BeginFloor();r.Game.PrepareIndependentBattlefield();r.Game.StartRealtime();
 for(int tick=0;tick<6001;tick++){
  var b=r.Game.State.Battle!;var l=b.Live!;
  var commands=new List<string>();
  if(ultimates&&b.Result=="")foreach(var u in l.Units.Where(u=>!u.Enemy&&u.Hp>0&&u.Energy>=1000).ToArray())if(r.Game.CastRealtimeUltimate(u.Id)=="")commands.Add(u.Id);
  if(tick%20==0||b.Result!=""||commands.Count>0)traces.Add(new{floor,tick,commands,result=b.Result,random=l.RandomState,units=l.Units.Select(u=>new{u.Id,u.X,u.Z,u.Hp,u.Energy,u.DamageDone,u.HealingDone,u.AttackEnergy,u.HurtEnergy,u.KillEnergy,u.ActionKind,u.ActionWork,u.RecoveryWork,u.Cooldown,u.Special}).ToArray(),projectiles=l.Projectiles.Count});
  if(b.Result!="")break;r.Game.TickRealtime(.05);
 }
 if(r.Game.State.Battle!.Result!="victory")break;r.FinishFloor();
}
Console.WriteLine(JsonSerializer.Serialize(traces));
