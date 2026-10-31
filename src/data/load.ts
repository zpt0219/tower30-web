import tower from "../../data/tower/thirty-floor-trial.json";
import { validateConfig } from "../core/config";
export const config = validateConfig(tower);
