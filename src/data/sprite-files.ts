import tower from "../../data/tower/thirty-floor-trial.json";

// The migration copied source-named sheets as species-ID.png. Edited sheets use
// the bundled ID directly; old source names must continue to resolve as well.
const migratedFiles = new Map(tower.Species.map((s) => [s.Sprite, s.Id]));
export function spriteFileName(sprite: string): string {
  return migratedFiles.get(sprite) ?? sprite;
}
