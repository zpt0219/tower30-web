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
bool wrongParty=args.Contains("--wrong-party");
bool thirty=args.Contains("--thirty");
bool twenty=args.Contains("--twenty")||thirty;
bool m2=args.Contains("--m2")||twenty;
bool ultimates=args.Contains("--ultimates")||m2;
for(int floor=1;floor<=(thirty?30:twenty?20:m2?10:2);floor++){
 var setupCommands=new List<object>();var openingCommands=new List<string>();
 void Command(string type,string id="",string gear="",int quantity=1){setupCommands.Add(new{type,id,gear,quantity});}
 void Check(string error){if(error!="")throw new Exception(error);}
 if(m2){
   if(floor==1){foreach(var pair in new[]{("hero","break_sword"),("princess","ward_staff")}){Check(r.Buy("gear_"+pair.Item2));Command("buy","gear_"+pair.Item2);Check(r.Game.EquipGear(pair.Item1,pair.Item2));Command("equip",pair.Item1,pair.Item2);}}
   if(twenty&&floor==11){foreach(var pair in new[]{("princess","iron_armor"),("hero","rescue_armor"),("hero","pulse_charm"),("princess","resolve_charm")}){Check(r.Buy("gear_"+pair.Item2));Command("buy","gear_"+pair.Item2);Check(r.Game.EquipGear(pair.Item1,pair.Item2));Command("equip",pair.Item1,pair.Item2);}}
   if(thirty&&floor==21){foreach(var pair in new[]{("hero","break_sword_2"),("princess","ward_staff_2")}){Check(r.Buy("gear_"+pair.Item2));Command("buy","gear_"+pair.Item2);Check(r.Game.EquipGear(pair.Item1,pair.Item2));Command("equip",pair.Item1,pair.Item2);}}
   if(thirty&&floor==23){Check(r.Buy("gear_iron_armor_2"));Command("buy","gear_iron_armor_2");Check(r.Game.EquipGear("princess","iron_armor_2"));Command("equip","princess","iron_armor_2");}
   foreach(var member in r.Game.State.Members.Where(v=>!Combat.IsHuman(v.Id)))while(member.Rank<5&&r.Game.SoulBalance(member.Id)>=r.Game.NextRankCost(member)){Check(r.Game.RaiseMonster(member.Id));Command("rank",member.Id);}
   var core=(thirty&&!wrongParty&&floor==30?new[]{"skeleton_guard","sproutling","water_elemental","boar","reedwing"}:new[]{"mudguard","crab","sproutling","fire_imp","slime_dusk","reedwing"}).Where(id=>r.Game.State.Members.Any(v=>v.Id==id)).ToArray();
   if(thirty&&!wrongParty&&floor==30)foreach(var member in r.Game.State.Members.Where(v=>!core.Contains(v.Id)&&v.PotionXp>0)){Check(r.Game.ResetMonster(member.Id));Command("refund",member.Id);}
   for(int i=0;i<100;i++){
     var member=core.Select(r.Game.Member).Where(v=>r.Game.MemberLevel(v)<r.Game.Level+4).OrderBy(v=>r.Game.MemberLevel(v)).FirstOrDefault();if(member==null)break;
     int bottles=(int)Math.Ceiling((r.Game.NextExperience(member)-r.Game.CurrentExperience(member))/25.0);if(r.Game.Count("xp_potion")<bottles)break;
     Check(r.Game.FeedMonster(member.Id,bottles));Command("train",member.Id);
   }
   if(r.NeedsRest){Check(r.StayAtInn());Command("rest");}
 }
 r.BeginFloor();r.Game.PrepareIndependentBattlefield();
 if(thirty&&!wrongParty&&floor==30){foreach(var id in r.Game.State.Battle!.Live!.Opening.Where(id=>!Combat.IsHuman(id)).ToArray()){if(!r.Game.SelectLiveOpening(id))throw new Exception("opening failed");openingCommands.Add(id);}foreach(var id in new[]{"skeleton_guard","water_elemental","reedwing"}){if(!r.Game.SelectLiveOpening(id))throw new Exception("opening failed");openingCommands.Add(id);}}
 r.Game.StartRealtime();
 for(int tick=0;tick<6001;tick++){
  var b=r.Game.State.Battle!;var l=b.Live!;
  var commands=new List<string>();
  var reinforcements=new List<string>();
  if(ultimates&&b.Result=="")foreach(var u in l.Units.Where(u=>!u.Enemy&&u.Hp>0&&u.Energy>=1000).ToArray())if((!m2||u.Ultimate!="interrupt"||l.Units.Any(v=>v.Enemy&&v.ActionKind=="ultimate"))&&(!thirty||wrongParty||floor!=30||!new[]{"renew","forest_rest"}.Contains(u.Ultimate)||l.Units.Any(v=>!v.Enemy&&v.Hp>0&&v.Hp<v.MaxHp*.65))&&r.Game.CastRealtimeUltimate(u.Id)=="")commands.Add(u.Id);
  if(m2&&b.Result=="")foreach(var member in r.Game.State.Members.Where(v=>v.Hp>0&&!l.Units.Any(u=>u.Id==v.Id)).OrderByDescending(v=>thirty&&!wrongParty&&floor==30?(v.Id=="sproutling"?100000:v.Id=="boar"?90000:r.Game.Attack(v)+r.Game.MaxHp(v)*.2+v.Rank*3):0).ToArray())if(r.Game.ReinforceRealtime(member.Id)=="")reinforcements.Add(member.Id);
  if(args.Contains("--dense")||tick%20==0||b.Result!=""||commands.Count>0||reinforcements.Count>0)traces.Add(new{floor,tick,commands,reinforcements,openingCommands=tick==0?openingCommands:null,setupCommands=tick==0?setupCommands:null,gold=r.Gold,result=b.Result,random=l.RandomState,units=l.Units.Select(u=>new{u.Id,u.X,u.Z,u.Hp,u.Energy,u.DamageDone,u.HealingDone,u.AttackEnergy,u.HurtEnergy,u.KillEnergy,u.ActionKind,u.ActionWork,u.RecoveryWork,u.Cooldown,u.Special,u.Barrier,u.Shield,u.Stun,u.ControlGuard,u.ArmorBreak,u.Slow,u.Taunt,u.Taunter,u.Regeneration,u.FocusTime,u.Focus,u.Leech,u.Weaken,u.Root,u.PhysicalGuard,u.SpellGuard,u.ComboHits,u.ComboTarget,u.Haste,u.DotTime,u.DotTick,u.DotPower,u.DotOwner,u.HealBlock,u.ReflectCooldown,u.CounterReady,u.Charge}).ToArray(),hits=args.Contains("--dense")?l.Hits.TakeLast(10).ToArray():null,projectiles=l.Projectiles.Count});
  if(b.Result!="")break;r.Game.TickRealtime(.05);
 }
 if(r.Game.State.Battle!.Result!="victory")break;r.FinishFloor();
}
Console.WriteLine(JsonSerializer.Serialize(traces));
