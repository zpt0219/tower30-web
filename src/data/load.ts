import tower from "../../data/tower/trial.json";
import { validateConfig } from "../core/config";
export const config = validateConfig(tower, { allowUnknownEnemySpecies: true });
