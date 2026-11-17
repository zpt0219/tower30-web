import tower from "../../data/tower/trial.json";

const legacySpriteAliases: Readonly<Record<string, string>> = {
  custom_01: "gray_rat",
  custom_03: "gray_bat",
  crab: "gray_wolf",
  nightwing: "skeleton",
  slime_dusk: "slime",
  bronze_beetle: "eyeball",
  evil_eye: "jellyfish",
  forest_sprite: "green_snake",
  reedwing: "wind_bug",
  blade_skeleton: "scorpion",
  cave_wolf: "twin_rooster",
  fire_imp: "mushroom",
  custom_10: "man_eating_flower",
  moonbat: "zombie",
  moss_crawler: "green_ooze",
  custom_11: "red_crab",
  sproutling: "treant",
  mudguard: "mudguard",
  custom_02: "spirit_turtle",
  mimic: "dark_kid",
  ice_spirit: "snake_demon",
  mantis: "sword_shield_orc",
  skeleton_guard: "flame_skeleton",
  spectral_armor: "phantom_bat",
  crystal_elemental: "nether_fire",
  custom_05: "lava_spirit",
  venom_dragonling: "emerald_venom_drake",
  white_ghost: "ice_ghost",
  orc_berserker: "shaman_orc",
  necromancer: "sword_shield_frog",
  wind_elemental: "storm_beast",
  spectral_samurai: "thunder_beast",
  earth_elemental: "rock_beast",
  wisp: "fluffy_jumper",
  nightmare: "nightmare_dragon",
  custom_12: "flame_warrior",
  custom_06: "minotaur",
  custom_07: "doomsday_satan",
  custom_04: "pharaoh_beast",
  custom_08: "medusa",
  custom_09: "skeleton_lich_king",
};

// The migration copied source-named sheets as species-ID.png. Edited sheets use
// the bundled ID directly; old source names must continue to resolve as well.
const migratedFiles = new Map(tower.Species.map((s) => [s.Sprite, s.Id]));
export function spriteFileName(sprite: string): string {
  return migratedFiles.get(sprite) ?? legacySpriteAliases[sprite] ?? sprite;
}
