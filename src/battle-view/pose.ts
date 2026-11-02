import layout from './sprite-layout.json';
import type {Unit} from '../core/model';
type Actor=Pick<Unit,'id'|'kind'|'enemy'|'hp'|'x'|'z'|'entry'|'action'>;
// Visual selection only. No position or combat state is changed by an animation.
export function battlePose(unit:Actor,previous:Pick<Actor,'x'|'z'>|undefined,units:readonly Actor[],result:string,seconds:number,frameSize:number){
 const victory=result==='victory'&&!unit.enemy&&unit.hp>0;
 const dx=previous?unit.x-previous.x:0,dz=previous?unit.z-previous.z:0;
 const target=units.find(v=>v.id===unit.action?.target);
 const facing=Math.abs(dx)>1e-6?dx:target&&Math.abs(target.x-unit.x)>1e-6?target.x-unit.x:unit.enemy?-1:1;
 const row=victory?layout.frontRow:facing<0?layout.sideLeftRow:layout.sideRightRow;
 const walking=unit.hp>0&&(victory||Math.abs(dx)+Math.abs(dz)>1e-6||unit.entry>0);
 const frame=walking?layout.walkFrames[Math.floor(Math.max(0,seconds)*layout.fps)%layout.walkFrames.length]!:1;
 const human=unit.kind==='hero'||unit.kind==='princess';
 return {row,frame,sourceX:frame*frameSize,sourceY:row*(human?layout.humanRowStride:frameSize)+(human?layout.humanCropY:0)};
}
