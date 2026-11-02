import {expect,it} from "vitest";
import {readFileSync,writeFileSync} from "node:fs";
import {normal60} from "../helpers/normal60";
import {TowerEngine} from "../../src/core/engine";
import {validateConfig} from "../../src/core/config";
import raw from "../../data/tower/thirty-floor-trial.json";
it("60Hz正常预算从新档连续通过30层，全部真实命令、奖励与恢复一致",()=>{
 const {engine,trace}=normal60();
 if(process.env.TOWER_RECORD_60)writeFileSync('tests/fixtures/ts60-thirty-floors.json',JSON.stringify(trace));
 expect(trace).toEqual(JSON.parse(readFileSync('tests/fixtures/ts60-thirty-floors.json','utf8')));
 const s=engine.getSnapshot();expect(s.logicHz).toBe(60);expect(s.completed).toBe(true);expect(s.records).toHaveLength(30);expect(s.floor).toBe(31);
 expect(TowerEngine.restore(validateConfig(raw),engine.serialize()).getSnapshot()).toEqual(s);
 expect(engine.dispatch({type:"finish"}).ok).toBe(false);
},120000);
