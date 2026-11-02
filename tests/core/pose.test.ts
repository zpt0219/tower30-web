import {expect,it} from 'vitest';
import {battlePose} from '../../src/battle-view/pose';
const actor={id:'hero',kind:'hero',enemy:false,hp:100,x:0,z:0,entry:0,action:null};
it('combat chooses actual side rows for right and left movement, with 32px human stride',()=>{
 expect(battlePose(actor,{x:-1,z:0},[actor],'',0,16)).toMatchObject({row:2,sourceY:80});
 expect(battlePose(actor,{x:1,z:0},[actor],'',0,16)).toMatchObject({row:1,sourceY:48});
 const monster={...actor,kind:'slime_dusk',enemy:true};expect(battlePose(monster,undefined,[monster],'',0,16)).toMatchObject({row:1,sourceY:16,frame:1});
});
it('stationary attackers face action target and idle instead of playing walk frames',()=>{
 const target={...actor,id:'enemy',enemy:true,x:-3};const casting={...actor,action:{id:1,kind:'basic' as const,skill:'',target:'enemy',work:0}};
 expect(battlePose(casting,actor,[casting,target],'',.21,16)).toMatchObject({row:1,frame:1});
});
it('only living winning allies walk toward player; defeat, dead allies and enemies keep side poses',()=>{
 expect(battlePose(actor,actor,[actor],'victory',0,16)).toMatchObject({row:0,sourceY:16,frame:0});
 expect(battlePose(actor,actor,[actor],'victory',.21,16).frame).toBe(1);
 for(const unit of [{...actor,hp:0},{...actor,enemy:true}])expect(battlePose(unit,unit,[unit],'victory',.21,16).row).not.toBe(0);
 expect(battlePose(actor,actor,[actor],'defeat',.21,16)).toMatchObject({row:2,frame:1});
});
it('large monsters use their own frame size for all side and front rows',()=>{
 const large={...actor,kind:'war_dragon'};expect(battlePose(large,{x:-1,z:0},[large],'',0,64)).toMatchObject({sourceY:128,sourceX:0});expect(battlePose(large,large,[large],'victory',.61,64)).toMatchObject({sourceY:0,sourceX:64});
});
