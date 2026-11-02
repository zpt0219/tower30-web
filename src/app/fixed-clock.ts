import {STEP} from "../core/math";
// Host-independent scheduling: keep outstanding time when the per-frame budget is reached.
export class FixedClock {
  private debt=0;
  reset(){this.debt=0;}
  add(seconds:number,speed=1){
    if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(speed)||speed<=0)throw new Error("帧时间无效");
    this.debt+=seconds*speed;
  }
  get pendingSeconds(){return this.debt;}
  take(maxTicks=24){
    const ticks=Math.min(maxTicks,Math.floor((this.debt+1e-10)/STEP));
    this.debt=Math.max(0,this.debt-ticks*STEP);return ticks;
  }
  get alpha(){return Math.min(1,this.debt/STEP);}
}
