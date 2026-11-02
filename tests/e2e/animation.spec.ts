import {test,expect} from '@playwright/test';
import {artifactDirectory} from '../../scripts/artifacts';
declare global {interface Window {__battlePoses:{id:string;x:number;y:number}[]}}
test('战中取左右行素材，胜利后存活友军正面踏步但逻辑tick不再推进',async({page},info)=>{
 test.setTimeout(90000);
 await page.addInitScript(()=>{
  const state=window;state.__battlePoses=[];
  const original=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<typeof original>){
   const [img,x,y]=args;
   if(img instanceof HTMLImageElement&&img.src.includes('/assets/')){
    state.__battlePoses.push({id:img.src.split('/').pop()!,x,y});if(state.__battlePoses.length>200)state.__battlePoses.shift();
   }
   return original.apply(this,args);
  } as typeof original;
 });
 await page.clock.install({time:new Date('2026-11-01T12:00:00Z')});await page.goto('./');
 await page.getByRole('button',{name:'准备挑战 →',exact:true}).click();await page.getByRole('button',{name:'开始交战 →',exact:true}).click();
 await page.clock.runFor(1200);
 const poses=()=>page.evaluate(()=>window.__battlePoses);
 let actual=await poses();expect(actual.some(p=>p.id==='hero.png'&&(p.y===80||p.y===48))).toBe(true);expect(actual.some(p=>p.id==='slime_dusk.png'&&(p.y===16||p.y===32))).toBe(true);
 await page.screenshot({path:`${artifactDirectory()}/${info.project.name}-web-side-battle.png`});
 await page.clock.runFor(24000);await expect(page.getByRole('heading',{name:'赢下这一战。',exact:true})).toBeVisible();
 const tick=await page.locator('#debug-tick').textContent();await page.evaluate(()=>window.__battlePoses=[]);
 await page.clock.runFor(1000);expect(await page.locator('#debug-tick').textContent()).toBe(tick);
 actual=await poses();const front=actual.filter(p=>p.id==='hero.png'&&p.y===16);expect(front.length).toBeGreaterThan(0);expect(new Set(front.map(p=>p.x)).size).toBeGreaterThan(1);
 await page.screenshot({path:`${artifactDirectory()}/${info.project.name}-web-victory-front.png`});
});
