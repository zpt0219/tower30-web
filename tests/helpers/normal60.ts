import {TowerEngine} from "../../src/core/engine";
import {validateConfig} from "../../src/core/config";
import type {Command} from "../../src/core/model";
import raw from "../../data/tower/thirty-floor-trial.json";
export interface RunSample {floor:number;tick:number;setupCommands:Command[]|null;openingCommands:string[]|null;commands:string[];reinforcements:string[];result:string;gold:number;seconds:number}
// A normal-budget controller: all trades, training, recovery and combat go through commands.
export function normal60(){
 const engine=new TowerEngine(validateConfig(raw)),trace:RunSample[]=[];
 const checked=(c:Command)=>{const r=engine.dispatch(c);if(!r.ok)throw new Error(`F${engine.getSnapshot().floor} ${JSON.stringify(c)}: ${r.message}`);};
 for(let floor=1;floor<=30;floor++){
  const setupCommands:Command[]=[],openingCommands:string[]=[];
  const command=(c:Command)=>{checked(c);setupCommands.push(c);};
  const gear=(id:string,gear:string)=>{command({type:"buy",id:"gear_"+gear,quantity:1});command({type:"equip",id,gear});};
  if(floor===1){gear("hero","break_sword");gear("princess","ward_staff");}
  if(floor===11){gear("princess","iron_armor");gear("hero","rescue_armor");gear("hero","pulse_charm");gear("princess","resolve_charm");}
  if(floor===21){gear("hero","break_sword_2");gear("princess","ward_staff_2");}
  if(floor===23)gear("princess","iron_armor_2");
  for(const m of engine.getSnapshot().members.filter(m=>!["hero","princess"].includes(m.id))){
   while(true){const s=engine.getSnapshot(),v=s.members.find(v=>v.id===m.id)!;if(v.rank>=5||(s.souls[m.id]??0)<v.training.rankCost)break;command({type:"rank",id:m.id});}
  }
  const core=floor===30?["skeleton_guard","sproutling","water_elemental","boar","reedwing"]:["mudguard","crab","sproutling","fire_imp","slime_dusk","reedwing"];
  if(floor===30)for(const m of engine.getSnapshot().members.filter(m=>!core.includes(m.id)&&m.potionXp>0))command({type:"refund",id:m.id});
  for(let i=0;i<100;i++){
   const s=engine.getSnapshot(),level=s.members.find(m=>m.id==="hero")!.level;
   const m=s.members.filter(m=>core.includes(m.id)&&m.level<level+4).sort((a,b)=>a.level-b.level)[0];
   if(!m||m.training.available<m.training.units)break;command({type:"train",id:m.id});
  }
  if(engine.getSnapshot().members.some(m=>m.hp<m.attributes.MaxHp))command({type:"rest"});
  checked({type:"begin"});
  if(floor===30){
   for(const id of engine.getBattleSnapshot()!.opening.filter(id=>!["hero","princess"].includes(id))){checked({type:"opening",id});openingCommands.push(id);}
   for(const id of ["skeleton_guard","water_elemental","reedwing"]){checked({type:"opening",id});openingCommands.push(id);}
  }
  checked({type:"start"});
  for(let tick=0;tick<=18000;tick++){
   const s=engine.getSnapshot(),b=s.battle!,commands:string[]=[],reinforcements:string[]=[];
   if(!b.result){
    for(const u of b.units.filter(u=>!u.enemy&&u.hp>0&&u.energy>=1000)){
     if(u.profile.Ultimate==="interrupt"&&!b.units.some(v=>v.enemy&&v.action?.kind==="ultimate"))continue;
     if(floor===30&&["renew","forest_rest"].includes(u.profile.Ultimate)&&!b.units.some(v=>!v.enemy&&v.hp>0&&v.hp<v.attributes.MaxHp*.65))continue;
     if(engine.dispatch({type:"ultimate",id:u.id}).ok)commands.push(u.id);
    }
    const rank=(m:typeof s.members[number])=>m.id==="sproutling"?100000:m.id==="boar"?90000:m.attributes.Attack+m.attributes.MaxHp*.2+m.rank*3;
    const reserves=s.members.filter(m=>m.hp>0&&!b.units.some(u=>u.id===m.id));if(floor===30)reserves.sort((a,b)=>rank(b)-rank(a));
    for(const m of reserves)if(engine.dispatch({type:"reinforce",id:m.id}).ok)reinforcements.push(m.id);
   }
   if(tick===0||commands.length||reinforcements.length||b.result)trace.push({floor,tick,setupCommands:tick===0?setupCommands:null,openingCommands:tick===0?openingCommands:null,commands,reinforcements,result:b.result,gold:s.gold,seconds:b.seconds});
   if(b.result){if(b.result!=="victory")throw new Error(`正常资源60Hz第${floor}层${b.result}，${b.seconds}秒，金币${s.gold}`);break;}
   engine.advance(1);
  }
  checked({type:"finish"});
 }
 return {engine,trace};
}
