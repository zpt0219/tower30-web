// Archived 20 Hz reference paths keep the original C# assertions meaningful.
// The application and new tests import the production engine, which defaults to 60 Hz.
import {TowerEngine} from "../../src/core/engine";
import type {Config} from "../../src/core/config";
import type {PlaytestSetup} from "../../src/core/playtest";
export class LegacyEngine extends TowerEngine {
  constructor(config:Config,seed?:number){super(config,seed,20);}
  static override createPlaytest(config:Config,setup:PlaytestSetup){return TowerEngine.createPlaytest(config,setup,20);}
}
