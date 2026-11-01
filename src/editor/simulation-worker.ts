import {createSimulationReport,simulatePair,type SimulationReport} from "../core/simulation";

// Browser scheduling stays outside src/core; each trial still calls the ordinary TowerEngine.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SimulationReport>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = (event) => {
  try {
    const r=event.data;
    const report=createSimulationReport(r.a.config,r.b.config,r.setup,r.options,r.a.label);
    for(let i=0;i<report.options.count;i++)scope.postMessage({type:"pair",pair:simulatePair(report,i)});
    scope.postMessage({type:"complete"});
  } catch(e) {
    scope.postMessage({type:"error",message:e instanceof Error?e.message:"模拟失败"});
  }
};
