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
bool twenty=args.Contains("--twenty");
bool m2=args.Contains("--m2")||twenty;
bool ultimates=args.Contains("--ultimates")||m2;
for(int floor=1;floor<=(twenty?20:m2?10:2);floor++){
 var setupCommands=new List<object>();
 void Command(string type,string id="",string gear="",int quantity=1){setupCommands.Add(new{type,id,gear,quantity});}
 void Check(string error){if(error!="")throw new Exception(error);}
 if(m2){
   if(floor==1){foreach(var pair in new[]{("hero","break_sword"),("princess","ward_staff")}){Check(r.Buy("gear_"+pair.Item2));Command("buy","gear_"+pair.Item2);Check(r.Game.EquipGear(pair.Item1,pair.Item2));Command("equip",pair.Item1,pair.Item2);}}
   if(twenty&&floor==11){foreach(var pair in new[]{("princess","iron_armor"),("hero","rescue_armor"),("hero","pulse_charm"),("princess","resolve_charm")}){Check(r.Buy("gear_"+pair.Item2));Command("buy","gear_"+pair.Item2);Check(r.Game.EquipGear(pair.Item1,pair.Item2));Command("equip",pair.Item1,pair.Item2);}}
   foreach(var member in r.Game.State.Members.Where(v=>!Combat.IsHuman(v.Id)))while(member.Rank<5&&r.Game.SoulBalance(member.Id)>=r.Game.NextRankCost(member)){Check(r.Game.RaiseMonster(member.Id));Command("rank",member.Id);}
   var core=new[]{"mudguard","crab","sproutling","fire_imp","slime_dusk","reedwing"}.Where(id=>r.Game.State.Members.Any(v=>v.Id==id)).ToArray();
   for(int i=0;i<100;i++){
     var member=core.Select(r.Game.Member).Where(v=>r.Game.MemberLevel(v)<r.Game.Level+4).OrderBy(v=>r.Game.MemberLevel(v)).FirstOrDefault();if(member==null)break;
     int bottles=(int)Math.Ceiling((r.Game.NextExperience(member)-r.Game.CurrentExperience(member))/25.0);if(r.Game.Count("xp_potion")<bottles)break;
     Check(r.Game.FeedMonster(member.Id,bottles));Command("train",member.Id);
   }
   if(r.NeedsRest){Check(r.StayAtInn());Command("rest");}
 }
 r.BeginFloor();r.Game.PrepareIndependentBattlefield();r.Game.StartRealtime();
 for(int tick=0;tick<6001;tick++){
  var b=r.Game.State.Battle!;var l=b.Live!;
  var commands=new List<string>();
  var reinforcements=new List<string>();
  if(ultimates&&b.Result=="")foreach(var u in l.Units.Where(u=>!u.Enemy&&u.Hp>0&&u.Energy>=1000).ToArray())if((!m2||u.Ultimate!="interrupt"||l.Units.Any(v=>v.Enemy&&v.ActionKind=="ultimate"))&&r.Game.CastRealtimeUltimate(u.Id)=="")commands.Add(u.Id);
  if(m2&&b.Result=="")foreach(var member in r.Game.State.Members.Where(v=>v.Hp>0&&!l.Units.Any(u=>u.Id==v.Id)).ToArray())if(r.Game.ReinforceRealtime(member.Id)=="")reinforcements.Add(member.Id);
  if(args.Contains("--dense")||tick%20==0||b.Result!=""||commands.Count>0||reinforcements.Count>0)traces.Add(new{floor,tick,commands,reinforcements,setupCommands=tick==0?setupCommands:null,gold=r.Gold,result=b.Result,random=l.RandomState,units=l.Units.Select(u=>new{u.Id,u.X,u.Z,u.Hp,u.Energy,u.DamageDone,u.HealingDone,u.AttackEnergy,u.HurtEnergy,u.KillEnergy,u.ActionKind,u.ActionWork,u.RecoveryWork,u.Cooldown,u.Special,u.Barrier,u.Shield,u.Stun,u.ControlGuard,u.ArmorBreak,u.Slow,u.Taunt,u.Taunter,u.Regeneration,u.FocusTime,u.Focus,u.Leech,u.Weaken,u.Root,u.PhysicalGuard,u.SpellGuard,u.ComboHits,u.ComboTarget}).ToArray(),hits=args.Contains("--dense")?l.Hits.TakeLast(10).ToArray():null,projectiles=l.Projectiles.Count});
  if(b.Result!="")break;r.Game.TickRealtime(.05);
 }
 if(r.Game.State.Battle!.Result!="victory")break;r.FinishFloor();
}
Console.WriteLine(JsonSerializer.Serialize(traces));
