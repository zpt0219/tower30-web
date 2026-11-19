import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data/tower/trial.json");
const BASE_CONFIG = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

/**
 * 5 Major Chapters x 20 Floors = 100 Floors (1 Boss every 5 floors: F5..F100).
 * 41 active V2 species each drop exact 25 Souls across F1..F100 (1,025 total),
 * finishing on F100 with Doomsday Satan so all 41 are ready at Rank 5 post-F100.
 */

const CHAPTERS = [
  {
    chapter: 1,
    theme: "翡翠林地 · 边境巡哨",
    background: "forest",
    startFloor: 1,
    endFloor: 20,
    minLevel: 1,
    maxLevel: 9,
  },
  {
    chapter: 2,
    theme: "潮汐沼泽 · 瘴气深水",
    background: "coast",
    startFloor: 21,
    endFloor: 40,
    minLevel: 9,
    maxLevel: 15,
  },
  {
    chapter: 3,
    theme: "古堡废墟 · 亡灵回廊",
    background: "castle",
    startFloor: 41,
    endFloor: 60,
    minLevel: 15,
    maxLevel: 21,
  },
  {
    chapter: 4,
    theme: "炽焰裂谷 · 熔岩龙巢",
    background: "dragon",
    startFloor: 61,
    endFloor: 80,
    minLevel: 21,
    maxLevel: 27,
  },
  {
    chapter: 5,
    theme: "终焉王座 · 魔界深渊",
    background: "castle",
    startFloor: 81,
    endFloor: 100,
    minLevel: 27,
    maxLevel: 32,
  },
];

// 20 Boss floors (F5..F100) receiving 1 equipment drop each from the 20 un-offered boss pool
const BOSS_SPECS = {
  5: {
    id: "f05_wolf_alpha",
    title: "林径伏击 · 灰狼头领",
    hint: "灰狼头领率狼群包抄后排，先集火前哨再用公主治疗稳住血线。",
    gear: "sweep_sword",
    gold: 130,
    enemies: [
      { Species: "gray_wolf", Count: 1, Level: 4, Rank: 2, Health: 1.5, AttackScale: 0.98, DefenseScale: 1.0 },
      { Species: "gray_rat", Count: 2, Level: 3, Rank: 1, Health: 1.0, AttackScale: 0.9, DefenseScale: 1.0 },
    ],
  },
  10: {
    id: "f10_treant_elder",
    title: "林心守卫 · 荆棘古树",
    hint: "荆棘古树拥有高额护盾与反伤，保留主角大招击破护盾或削弱治疗。",
    gear: "cleanse_staff",
    gold: 200,
    enemies: [
      { Species: "treant", Count: 1, Level: 6, Rank: 2, Health: 1.65, AttackScale: 0.98, DefenseScale: 1.05 },
      { Species: "mushroom", Count: 2, Level: 5, Rank: 2, Health: 1.0, AttackScale: 0.9, DefenseScale: 1.0 },
      { Species: "green_snake", Count: 2, Level: 5, Rank: 1, Health: 0.95, AttackScale: 0.9, DefenseScale: 1.0 },
    ],
  },
  15: {
    id: "f15_scorpion_king",
    title: "毒针巢穴 · 巨尾蝎将",
    hint: "蝎群擅长叠毒与破防，及时用净光杖或高回复辅助驱散持续伤害。",
    gear: "spirit_robe",
    gold: 230,
    enemies: [
      { Species: "scorpion", Count: 1, Level: 7, Rank: 2, Health: 1.65, AttackScale: 1.0, DefenseScale: 1.05 },
      { Species: "man_eating_flower", Count: 2, Level: 6, Rank: 2, Health: 1.0, AttackScale: 0.92, DefenseScale: 1.0 },
      { Species: "wind_bug", Count: 2, Level: 6, Rank: 2, Health: 0.95, AttackScale: 0.92, DefenseScale: 1.0 },
    ],
  },
  20: {
    id: "f20_dark_kid_prince",
    title: "林境暗影 · 暗黑小鬼",
    hint: "第一章大首领：暗黑小鬼会斩杀残血与压制攻击，携带高血前排分担爆发。",
    gear: "traveler_sword_2",
    gold: 300,
    enemies: [
      { Species: "dark_kid", Count: 1, Level: 9, Rank: 2, Health: 1.75, AttackScale: 1.0, DefenseScale: 1.05 },
      { Species: "eyeball", Count: 2, Level: 8, Rank: 2, Health: 1.05, AttackScale: 0.92, DefenseScale: 1.0 },
      { Species: "mudguard", Count: 1, Level: 8, Rank: 2, Health: 1.15, AttackScale: 0.92, DefenseScale: 1.05 },
    ],
  },
  25: {
    id: "f25_storm_beast",
    title: "浅滩飓风 · 岚风巨兽",
    hint: "风暴兽高频范围风压并打断吟唱，合理安排替补与瞬发大招节奏。",
    gear: "healer_staff_2",
    gold: 210,
    enemies: [
      { Species: "storm_beast", Count: 1, Level: 10, Rank: 3, Health: 2.1, AttackScale: 1.04, DefenseScale: 1.08 },
      { Species: "jellyfish", Count: 2, Level: 9, Rank: 2, Health: 1.25, AttackScale: 0.96, DefenseScale: 1.04 },
      { Species: "red_crab", Count: 2, Level: 9, Rank: 2, Health: 1.3, AttackScale: 0.96, DefenseScale: 1.08 },
    ],
  },
  30: {
    id: "f30_ice_ghost",
    title: "寒雾冰窟 · 霜魄幽灵",
    hint: "冰霜幽灵附带冰冻与群体减速，注意提升韧性或分散站位。",
    gear: "guard_sword_2",
    gold: 230,
    enemies: [
      { Species: "ice_ghost", Count: 1, Level: 12, Rank: 3, Health: 2.35, AttackScale: 1.06, DefenseScale: 1.12 },
      { Species: "green_ooze", Count: 2, Level: 11, Rank: 2, Health: 1.35, AttackScale: 0.98, DefenseScale: 1.08 },
      { Species: "spirit_turtle", Count: 1, Level: 11, Rank: 3, Health: 1.5, AttackScale: 0.96, DefenseScale: 1.12 },
    ],
  },
  35: {
    id: "f35_venom_drake",
    title: "毒沼龙潭 · 翡翠毒龙",
    hint: "翡翠毒龙能喷吐腐蚀毒雾叠加破甲，优先集火后排治疗再围剿毒龙。",
    gear: "sweep_sword_2",
    gold: 250,
    enemies: [
      { Species: "emerald_venom_drake", Count: 1, Level: 13, Rank: 3, Health: 2.5, AttackScale: 1.02, DefenseScale: 1.12 },
      { Species: "snake_demon", Count: 1, Level: 12, Rank: 3, Health: 1.45, AttackScale: 0.98, DefenseScale: 1.08 },
      { Species: "shaman_orc", Count: 1, Level: 12, Rank: 2, Health: 1.35, AttackScale: 0.96, DefenseScale: 1.06 },
    ],
  },
  40: {
    id: "f40_orc_warlord",
    title: "沼泽要塞 · 剑盾兽人统领",
    hint: "第二章大首领：高阶兽人阵线拥有护盾与爆发反击，需平衡破盾与续航。",
    gear: "bell_staff_2",
    gold: 280,
    enemies: [
      { Species: "sword_shield_orc", Count: 1, Level: 15, Rank: 3, Health: 2.65, AttackScale: 1.04, DefenseScale: 1.14 },
      { Species: "sword_shield_frog", Count: 1, Level: 14, Rank: 3, Health: 1.55, AttackScale: 0.98, DefenseScale: 1.1 },
      { Species: "shaman_orc", Count: 1, Level: 14, Rank: 3, Health: 1.45, AttackScale: 0.96, DefenseScale: 1.08 },
      { Species: "red_crab", Count: 1, Level: 14, Rank: 3, Health: 1.4, AttackScale: 0.96, DefenseScale: 1.08 },
    ],
  },
  45: {
    id: "f45_phantom_bat",
    title: "古堡钟楼 · 幻影吸血蝠",
    hint: "幻影蝠具备高吸血与闪避，建议配备命中/压制控制角色快速锁杀。",
    gear: "linen_armor_2",
    gold: 290,
    enemies: [
      { Species: "phantom_bat", Count: 1, Level: 16, Rank: 3, Health: 2.8, AttackScale: 1.02, DefenseScale: 1.14 },
      { Species: "gray_bat", Count: 2, Level: 15, Rank: 3, Health: 1.45, AttackScale: 0.96, DefenseScale: 1.08 },
      { Species: "zombie", Count: 2, Level: 15, Rank: 3, Health: 1.5, AttackScale: 0.96, DefenseScale: 1.1 },
    ],
  },
  50: {
    id: "f50_minotaur_arena",
    title: "断戟角斗场 · 战争牛头人",
    hint: "半程殿堂首领：牛头人冲锋具备强力击晕与高额物理伤害，注意替补吸收爆发。",
    gear: "rescue_armor_2",
    gold: 320,
    enemies: [
      { Species: "minotaur", Count: 1, Level: 18, Rank: 4, Health: 1.9, AttackScale: 0.78, DefenseScale: 1.06 },
      { Species: "rock_beast", Count: 1, Level: 17, Rank: 3, Health: 1.25, AttackScale: 0.8, DefenseScale: 1.06 },
      { Species: "flame_skeleton", Count: 1, Level: 17, Rank: 3, Health: 1.2, AttackScale: 0.8, DefenseScale: 1.04 },
    ],
  },
  55: {
    id: "f55_thunder_beast",
    title: "雷霆祭坛 · 霹雳魔兽",
    hint: "雷霆兽联动感电溅射与麻痹控制，全队抗性与及时抬血十分关键。",
    gear: "arrival_banner_2",
    gold: 330,
    enemies: [
      { Species: "thunder_beast", Count: 1, Level: 19, Rank: 4, Health: 2.35, AttackScale: 0.88, DefenseScale: 1.1 },
      { Species: "fluffy_jumper", Count: 1, Level: 18, Rank: 3, Health: 1.35, AttackScale: 0.86, DefenseScale: 1.06 },
      { Species: "skeleton", Count: 2, Level: 18, Rank: 4, Health: 1.25, AttackScale: 0.84, DefenseScale: 1.06 },
    ],
  },
  60: {
    id: "f60_medusa_sanctum",
    title: "石化回廊 · 美杜莎女皇",
    hint: "第三章大首领：美杜莎可石化多名单位，利用高韧性前排与净光驱散保持战线。",
    gear: "traveler_sword_3",
    gold: 360,
    enemies: [
      { Species: "medusa", Count: 1, Level: 21, Rank: 4, Health: 1.6, AttackScale: 0.72, DefenseScale: 1.04 },
      { Species: "snake_demon", Count: 1, Level: 20, Rank: 4, Health: 1.05, AttackScale: 0.72, DefenseScale: 1.0 },
      { Species: "green_snake", Count: 1, Level: 20, Rank: 4, Health: 1.05, AttackScale: 0.72, DefenseScale: 1.0 },
    ],
  },
  65: {
    id: "f65_lava_spirit",
    title: "黑曜熔炉 · 熔岩之灵",
    hint: "熔岩之灵高频灼烧全场并触发火焰增伤，带齐双奶或法盾应对持续掉血。",
    gear: "healer_staff_3",
    gold: 370,
    enemies: [
      { Species: "lava_spirit", Count: 1, Level: 22, Rank: 4, Health: 2.35, AttackScale: 0.86, DefenseScale: 1.1 },
      { Species: "flame_skeleton", Count: 2, Level: 21, Rank: 4, Health: 1.35, AttackScale: 0.84, DefenseScale: 1.06 },
      { Species: "rock_beast", Count: 1, Level: 21, Rank: 4, Health: 1.5, AttackScale: 0.84, DefenseScale: 1.1 },
    ],
  },
  70: {
    id: "f70_pharaoh_beast",
    title: "沙炎遗迹 · 法老魔兽",
    hint: "法老魔兽掌控沙暴诅咒与护盾反制，优先清理侧翼幽冥火以免全队被沉默。",
    gear: "guard_sword_3",
    gold: 390,
    enemies: [
      { Species: "pharaoh_beast", Count: 1, Level: 24, Rank: 4, Health: 2.4, AttackScale: 0.84, DefenseScale: 1.12 },
      { Species: "nether_fire", Count: 1, Level: 23, Rank: 4, Health: 1.45, AttackScale: 0.84, DefenseScale: 1.08 },
      { Species: "twin_rooster", Count: 2, Level: 23, Rank: 4, Health: 1.35, AttackScale: 0.82, DefenseScale: 1.06 },
    ],
  },
  75: {
    id: "f75_flame_warrior",
    title: "狱火前殿 · 烈焰战将",
    hint: "烈焰战将进入 5 阶狂暴斩击与点燃连段，保留关键控制大招打断其节奏。",
    gear: "sweep_sword_3",
    gold: 410,
    enemies: [
      { Species: "flame_warrior", Count: 1, Level: 25, Rank: 5, Health: 2.6, AttackScale: 0.88, DefenseScale: 1.14 },
      { Species: "dark_kid", Count: 1, Level: 24, Rank: 4, Health: 1.55, AttackScale: 0.86, DefenseScale: 1.1 },
      { Species: "lava_spirit", Count: 1, Level: 24, Rank: 4, Health: 1.55, AttackScale: 0.86, DefenseScale: 1.1 },
      { Species: "shaman_orc", Count: 1, Level: 24, Rank: 4, Health: 1.45, AttackScale: 0.82, DefenseScale: 1.08 },
    ],
  },
  80: {
    id: "f80_nightmare_dragon",
    title: "裂谷深渊 · 噩梦魔龙",
    hint: "第四章大首领：噩梦魔龙吐息附加恐惧与高额法伤，需大师级抗性与全员5星准备。",
    gear: "bell_staff_3",
    gold: 440,
    enemies: [
      { Species: "nightmare_dragon", Count: 1, Level: 27, Rank: 5, Health: 2.8, AttackScale: 0.9, DefenseScale: 1.16 },
      { Species: "emerald_venom_drake", Count: 1, Level: 26, Rank: 4, Health: 1.65, AttackScale: 0.86, DefenseScale: 1.12 },
      { Species: "phantom_bat", Count: 1, Level: 26, Rank: 4, Health: 1.6, AttackScale: 0.86, DefenseScale: 1.12 },
      { Species: "spirit_turtle", Count: 1, Level: 26, Rank: 5, Health: 1.7, AttackScale: 0.82, DefenseScale: 1.16 },
    ],
  },
  85: {
    id: "f85_nether_lord",
    title: "深渊外廷 · 幽冥魔火阵",
    hint: "幽冥魔火与寒霜死灵混合封锁治疗与能量回复，利用后备奇兵轮换破局。",
    gear: "fire_book_3",
    gold: 450,
    enemies: [
      { Species: "nether_fire", Count: 1, Level: 28, Rank: 5, Health: 2.95, AttackScale: 0.9, DefenseScale: 1.18 },
      { Species: "ice_ghost", Count: 1, Level: 27, Rank: 5, Health: 1.8, AttackScale: 0.88, DefenseScale: 1.14 },
      { Species: "sword_shield_orc", Count: 1, Level: 27, Rank: 5, Health: 1.9, AttackScale: 0.88, DefenseScale: 1.16 },
      { Species: "thunder_beast", Count: 1, Level: 27, Rank: 5, Health: 1.8, AttackScale: 0.88, DefenseScale: 1.14 },
    ],
  },
  90: {
    id: "f90_lich_king",
    title: "白骨王庭 · 骷髅巫妖王",
    hint: "巫妖王召唤亡灵军团并施放暗影诅咒，务必在召唤成型前集火压低其血量。",
    gear: "linen_armor_3",
    gold: 470,
    enemies: [
      { Species: "skeleton_lich_king", Count: 1, Level: 29, Rank: 5, Health: 2.75, AttackScale: 0.86, DefenseScale: 1.14 },
      { Species: "flame_skeleton", Count: 1, Level: 28, Rank: 5, Health: 1.75, AttackScale: 0.86, DefenseScale: 1.12 },
      { Species: "skeleton", Count: 1, Level: 28, Rank: 5, Health: 1.65, AttackScale: 0.86, DefenseScale: 1.12 },
    ],
  },
  95: {
    id: "f95_tri_sovereigns",
    title: "魔渊三巨头 · 传说的试炼",
    hint: "美杜莎、牛头人与法老魔兽三强联手镇守王座前门，善用 10 人满编替补车轮消耗！",
    gear: "iron_armor_3",
    gold: 500,
    enemies: [
      { Species: "minotaur", Count: 1, Level: 30, Rank: 5, Health: 2.2, AttackScale: 0.82, DefenseScale: 1.12 },
      { Species: "medusa", Count: 1, Level: 30, Rank: 5, Health: 2.0, AttackScale: 0.8, DefenseScale: 1.1 },
      { Species: "pharaoh_beast", Count: 1, Level: 30, Rank: 5, Health: 2.1, AttackScale: 0.8, DefenseScale: 1.1 },
    ],
  },
  100: {
    id: "f100_doomsday_satan",
    title: "终焉王座 · 末日撒旦",
    hint: "百层试炼大结局首领：末日撒旦亲率深渊魔火压境！击败后所有 41 种怪兽将集齐 25 魂魄突破至满阶，迎战后续终极最终 Boss。",
    gear: "rescue_armor_3",
    gold: 600,
    enemies: [
      { Species: "doomsday_satan", Count: 1, Level: 32, Rank: 5, Health: 4.8, AttackScale: 0.94, DefenseScale: 1.24 },
      { Species: "lava_spirit", Count: 2, Level: 31, Rank: 5, Health: 1.85, AttackScale: 0.86, DefenseScale: 1.16 },
      { Species: "nether_fire", Count: 1, Level: 31, Rank: 5, Health: 1.85, AttackScale: 0.86, DefenseScale: 1.16 },
    ],
  },
};

// Introduction/theme floor brackets per species to plan organic progression + exact 25 Souls total
// Normal (19): finish between F1..F78
// Elite (15): finish between F16..F98
// Legendary (7): finish between F70..F100 (final Legendary souls complete on F100!)
const NORMAL_WINDOWS = {
  slime: [1, 24],
  mushroom: [2, 34],
  gray_rat: [3, 18],
  gray_bat: [3, 20],
  gray_wolf: [3, 26],
  green_snake: [3, 30],
  wind_bug: [6, 36],
  skeleton: [7, 48],
  eyeball: [8, 42],
  man_eating_flower: [11, 46],
  scorpion: [11, 52],
  mudguard: [12, 54],
  jellyfish: [21, 56],
  red_crab: [21, 58],
  green_ooze: [22, 62],
  treant: [9, 64],
  twin_rooster: [23, 72],
  zombie: [26, 68],
  spirit_turtle: [27, 74],
};

const ELITE_WINDOWS = {
  dark_kid: [16, 76],
  storm_beast: [22, 79],
  ice_ghost: [28, 86],
  snake_demon: [31, 82],
  shaman_orc: [32, 84],
  emerald_venom_drake: [33, 88],
  sword_shield_frog: [34, 83],
  sword_shield_orc: [36, 89],
  phantom_bat: [41, 91],
  flame_skeleton: [43, 93],
  rock_beast: [44, 92],
  thunder_beast: [51, 94],
  fluffy_jumper: [52, 96],
  lava_spirit: [61, 100],
  nether_fire: [64, 100],
};

const LEGENDARY_WINDOWS = {
  minotaur: [50, 95],
  medusa: [60, 95],
  pharaoh_beast: [70, 95],
  flame_warrior: [75, 99],
  nightmare_dragon: [80, 99],
  skeleton_lich_king: [90, 99],
  doomsday_satan: [96, 100],
};

const ALL_WINDOWS = {
  ...NORMAL_WINDOWS,
  ...ELITE_WINDOWS,
  ...LEGENDARY_WINDOWS,
};

function getChapter(floor) {
  return CHAPTERS.find((c) => floor >= c.startFloor && floor <= c.endFloor);
}

function interpolateFloorStats(floor) {
  const ch = getChapter(floor);
  const t = (floor - ch.startFloor) / (ch.endFloor - ch.startFloor);
  const level = Math.round(ch.minLevel + (ch.maxLevel - ch.minLevel) * t);
  const rank =
    floor <= 9
      ? 1
      : floor <= 24
        ? 2
        : floor <= 48
          ? 3
          : floor <= 90
            ? 4
            : 5;
  const p = Math.max(0, floor - 20) / 80;
  const health = Number((0.78 + (floor <= 20 ? (floor / 20) * 0.2 : 0.2 + p * 0.9)).toFixed(2));
  const attackScale = Number((floor <= 20 ? 0.78 + (floor / 20) * 0.04 : 0.8 - p * 0.05).toFixed(2));
  const defenseScale = Number((0.96 + (floor / 100) * 0.16).toFixed(2));
  return { ch, level, rank, health, attackScale, defenseScale };
}

function buildFloorPlan() {
  const floors = [];
  for (let floor = 1; floor <= 100; floor++) {
    const ch = getChapter(floor);
    const boss = BOSS_SPECS[floor];
    const bg =
      ch.chapter === 5 && !boss && floor % 2 === 1 ? "dragon" : ch.background;
    if (boss) {
      floors.push({
        floor,
        chapter: ch.chapter,
        theme: `${ch.theme}`,
        background: bg,
        id: boss.id,
        title: boss.title,
        hint: boss.hint,
        boss: true,
        difficulty: ch.chapter <= 2 ? "首领" : ch.chapter <= 4 ? "强敌" : "终极首领",
        gold: boss.gold,
        gear: boss.gear,
        enemies: boss.enemies.map((e) => ({ ...e, Souls: 0, Potions: 0, PotionsM: 0, PotionsL: 0, Experience: 0 })),
      });
    } else {
      const { level, rank, health, attackScale, defenseScale } = interpolateFloorStats(floor);
      if (floor === 1) {
        floors.push({
          floor: 1,
          chapter: 1,
          theme: ch.theme,
          background: bg,
          id: "EN-001",
          title: "史莱姆初见",
          hint: "首次击败可收集史莱姆；人类共享战斗经验无限成长，怪兽使用经验药水培养。",
          boss: false,
          difficulty: "常规",
          gold: 65,
          gear: null,
          enemies: [
            {
              Species: "slime",
              Count: 1,
              Level: 1,
              Rank: 1,
              Health: 1,
              AttackScale: 1,
              DefenseScale: 1,
              Souls: 0,
              Potions: 0,
              PotionsM: 0,
              PotionsL: 0,
              Experience: 0,
            },
          ],
        });
        continue;
      }
      if (floor === 2) {
        floors.push({
          floor: 2,
          chapter: 1,
          theme: ch.theme,
          background: bg,
          id: "EN-002",
          title: "蘑菇精初见",
          hint: "击败蘑菇精与史莱姆扩充阵容，留意手动大招时机。",
          boss: false,
          difficulty: "常规",
          gold: 65,
          gear: null,
          enemies: [
            {
              Species: "mushroom",
              Count: 1,
              Level: 1,
              Rank: 1,
              Health: 0.78,
              AttackScale: 0.78,
              DefenseScale: 0.92,
              Souls: 0,
              Potions: 0,
              PotionsM: 0,
              PotionsL: 0,
              Experience: 0,
            },
            {
              Species: "slime",
              Count: 2,
              Level: 1,
              Rank: 1,
              Health: 0.8,
              AttackScale: 0.78,
              DefenseScale: 0.92,
              Souls: 0,
              Potions: 0,
              PotionsM: 0,
              PotionsL: 0,
              Experience: 0,
            },
          ],
        });
        continue;
      }
      const candidates = Object.entries(ALL_WINDOWS)
        .filter(([, [s, e]]) => floor >= s && floor <= e)
        .map(([id]) => id);
      // Deterministically pick 2-3 distinct species active at this floor
      const STALL_SPECIES = new Set(["spirit_turtle", "treant", "mushroom", "jellyfish", "shaman_orc", "green_ooze", "mudguard", "red_crab"]);
      const CH5_TANK_OR_HEAL = new Set(["spirit_turtle", "treant", "mushroom", "jellyfish", "shaman_orc", "rock_beast", "sword_shield_orc", "sword_shield_frog"]);
      const groupCount = floor <= 4 ? 2 : floor >= 60 ? 3 : floor % 3 === 0 ? 3 : 2;
      const chosen = [];
      for (let k = 0; k < candidates.length && chosen.length < groupCount; k++) {
        const idx = (floor * 7 + k * 5) % candidates.length;
        const sp = candidates[idx];
        const hasStall = chosen.some((c) => (floor >= 81 ? CH5_TANK_OR_HEAL : STALL_SPECIES).has(c));
        const hasLeg = chosen.some((c) => Boolean(LEGENDARY_WINDOWS[c]));
        if (!chosen.includes(sp) && !((floor >= 81 ? CH5_TANK_OR_HEAL : STALL_SPECIES).has(sp) && hasStall) && !(LEGENDARY_WINDOWS[sp] && hasLeg)) chosen.push(sp);
      }
      if (chosen.length === 0) chosen.push("gray_rat");
      const enemies = chosen.map((sp, idx) => {
        const isLeg = Boolean(LEGENDARY_WINDOWS[sp]);
        const isElite = Boolean(ELITE_WINDOWS[sp]);
        const count = isLeg || isElite || STALL_SPECIES.has(sp) ? 1 : floor >= 40 && idx === 0 ? 2 : floor <= 2 ? 1 : idx === 0 ? 2 : 1;
        const lv = Math.max(1, level - (idx > 0 ? 1 : 0));
        const spRank = Math.max(1, (idx > 0 && floor <= 96 && floor > 15) ? Math.min(4, rank - 1) : isLeg || isElite ? Math.min(5, rank) : Math.min(5, rank));
        return {
          Species: sp,
          Count: count,
          Level: lv,
          Rank: spRank,
          Health: isLeg ? Number((health * 0.86).toFixed(2)) : isElite ? Number((health * 0.94).toFixed(2)) : health,
          AttackScale: isLeg ? Number((attackScale * 0.8).toFixed(2)) : attackScale,
          DefenseScale: defenseScale,
          Souls: 0,
          Potions: 0,
          PotionsM: 0,
          PotionsL: 0,
          Experience: 0,
        };
      });
      const stageNames = [
        "林荫哨卡", "林间密道", "溪畔荒野", "盘根谷地", "藤蔓深处",
        "浅滩泥沼", "迷雾湿地", "毒水湾", "残骸礁石", "深潭守哨",
        "碎石长廊", "古堡哨塔", "白骨地窖", "回廊大厅", "圣殿废墟",
        "炽热通道", "黑曜崖壁", "熔金河岸", "龙息深窟", "炎狱前庭",
        "暗影前哨", "深渊长阶", "魔火祭坛", "血月走廊", "王座前阶",
      ];
      const nameIdx = ((ch.chapter - 1) * 5 + Math.floor((floor - ch.startFloor) / 4)) % stageNames.length;
      floors.push({
        floor,
        chapter: ch.chapter,
        theme: ch.theme,
        background: bg,
        id: `f${String(floor).padStart(3, "0")}_battle`,
        title: `第${floor}层 · ${stageNames[nameIdx]}`,
        hint: `第${ch.chapter}章常规战（推荐队伍 Lv.${Math.max(1, level - 2)}~${level}），保留大招应对第${Math.ceil(floor / 5) * 5}层守关首领。`,
        boss: false,
        difficulty: ch.chapter === 1 ? "普通" : ch.chapter <= 3 ? "标准" : "高压",
        gold: floor <= 20 ? Math.round(52 + floor * 1.8) : Math.round(75 + floor * 1.0),
        gear: null,
        enemies,
      });
    }
  }
  return floors;
}

function allocateSouls(floors) {
  const speciesList = Object.keys(BASE_CONFIG.Rules.Species);
  // Guarantee every species appears on enough floors to drop exact 25 Souls with 1 <= Souls <= 12 per unit
  for (const sp of speciesList) {
    let entries = [];
    for (const fl of floors) {
      for (const g of fl.enemies) {
        if (g.Species === sp) entries.push({ floor: fl.floor, boss: fl.boss, g });
      }
    }
    // Ensure doomsday_satan has at least 3 appearances ending at F100
    if (entries.length === 0 || (sp === "doomsday_satan" && entries.length < 3)) {
      const [start, end] = ALL_WINDOWS[sp];
      for (let f = end - 2; f >= start && entries.length < 3; f--) {
        const fl = floors[f - 1];
        if (fl.boss || fl.enemies.some((g) => g.Species === sp)) continue;
        const { level, rank, health, attackScale, defenseScale } = interpolateFloorStats(fl.floor);
        const g = {
          Species: sp,
          Count: 1,
          Level: level,
          Rank: rank,
          Health: Number((health * 1.02).toFixed(2)),
          AttackScale: Number((attackScale * 0.88).toFixed(2)),
          DefenseScale: defenseScale,
          Souls: 0,
          Potions: 0,
          PotionsM: 0,
          PotionsL: 0,
          Experience: 0,
        };
        fl.enemies.push(g);
        entries.push({ floor: fl.floor, boss: fl.boss, g });
      }
    }
    // Also ensure total max possible (sum Count * 12) >= 25
    while (entries.reduce((s, e) => s + e.g.Count * 12, 0) < 25) {
      entries[0].g.Count++;
    }
    entries.sort((a, b) => a.floor - b.floor);

    // Distribute exact 25 Souls across entries with constraints:
    // Each group has g.Souls >= 1 (since schema requires Souls >= 1) and <= 12!
    // Wait: if entries.length * 1 > 25, trim non-boss appearances of sp!
    while (entries.reduce((s, e) => s + e.g.Count, 0) > 25) {
      // Remove excess appearances from middle non-boss floors (keep first and boss and last!)
      const removableIdx = entries.findIndex(
        (e, i) => i > 0 && i < entries.length - 1 && !e.boss && floors[e.floor - 1].enemies.length > 1,
      );
      if (removableIdx >= 0) {
        const rem = entries.splice(removableIdx, 1)[0];
        const fl = floors[rem.floor - 1];
        fl.enemies = fl.enemies.filter((x) => x !== rem.g);
      } else {
        // Reduce Count on a Count > 1 non-boss group
        const multi = entries.find((e) => !e.boss && e.g.Count > 1);
        if (!multi) throw new Error(`Cannot fit 25 souls min=1 for ${sp}`);
        multi.g.Count--;
      }
    }

    // Now sum(Count) <= 25. Start each entry at Souls = 1. Remaining = 25 - sum(Count).
    for (const e of entries) e.g.Souls = 1;
    let rem = 25 - entries.reduce((s, e) => s + e.g.Count, 0);

    // Prefer giving extra souls to boss / final appearance (e.g. F100 for Legendaries!)
    const ordered = [...entries].reverse();
    while (rem > 0) {
      let progressed = false;
      for (const e of ordered) {
        if (rem >= e.g.Count && e.g.Souls < 12) {
          e.g.Souls++;
          rem -= e.g.Count;
          progressed = true;
          if (rem === 0) break;
        }
      }
      if (!progressed) {
        // Need a smaller Count group if rem < smallest Count (preserve F1/F2 test/intro purity)
        const smallFloor = floors.find(
          (fl) => !fl.boss && fl.floor >= 3 && fl.floor >= ALL_WINDOWS[sp][0] && fl.floor <= ALL_WINDOWS[sp][1] && !fl.enemies.some((x) => x.Species === sp),
        );
        if (smallFloor && rem >= 1) {
          const { level, rank, health, attackScale, defenseScale } = interpolateFloorStats(smallFloor.floor);
          const g = {
            Species: sp,
            Count: 1,
            Level: level,
            Rank: rank,
            Health: health,
            AttackScale: attackScale,
            DefenseScale: defenseScale,
            Souls: Math.min(12, rem),
            Potions: 0,
            PotionsM: 0,
            PotionsL: 0,
            Experience: 0,
          };
          smallFloor.enemies.push(g);
          entries.push({ floor: smallFloor.floor, boss: false, g });
          rem -= g.Souls;
        } else {
          // Split a Count=2 into Count=1,1 on same floor? No, schema allows duplicate species, or reduce Count on one entry
          const big = entries.find((e) => e.g.Count > 1);
          if (!big) throw new Error(`Cannot fit exact 25 souls remainder=${rem} for ${sp}`);
          big.g.Count--;
          rem += big.g.Souls;
        }
      }
    }
  }
}

function allocateEconomyAndXp(floors) {
  // Human XP budget: ~27,600 XP total across F1..F100 (reaches Hero/Princess Lv.32 by F100)
  // Monster Potion budget: ~5,000 small-potion equivalents (~125,000 XP) across F1..F100 -> genuinely scarce!
  let totalHumanXp = 0;
  let totalPotionUnits = 0;
  let totalGold = 0;

  for (const fl of floors) {
    if (fl.floor === 1) {
      fl.enemies[0].Experience = 11;
      fl.enemies[0].Potions = 2;
      fl.enemies[0].PotionsM = 0;
      fl.enemies[0].PotionsL = 0;
      totalHumanXp += 11 * fl.enemies[0].Count;
      totalPotionUnits += 2 * fl.enemies[0].Count;
      totalGold += fl.gold;
      continue;
    }
    const unitCount = fl.enemies.reduce((s, g) => s + g.Count, 0);
    // Floor target Human XP: reaches Hero/Princess Lv.33-34 cleanly
    const floorHumanXpTarget = fl.boss ? Math.round(155 + fl.floor * 5.8) : Math.round(72 + fl.floor * 4.2);
    const xpPerUnit = Math.max(12, Math.round(floorHumanXpTarget / unitCount));

    // Floor target Potion Units (in 25-XP small potions): ~5,950 units (~149k XP -> strictly < 8x Lv30 cost)
    const floorUnitsTarget = fl.boss
      ? Math.round(19 + fl.floor * 1.32)
      : Math.round(7 + fl.floor * 0.91);
    let remUnits = floorUnitsTarget;

    fl.enemies.forEach((g, idx) => {
      g.Experience = xpPerUnit;
      // Distribute floor potion units cleanly on idx === 0 or split across groups
      const share = idx === fl.enemies.length - 1 ? remUnits : Math.floor(floorUnitsTarget / fl.enemies.length);
      remUnits -= share;
      const perUnit = Math.floor(share / g.Count);
      const l = Math.floor(perUnit / 20);
      const m = Math.floor((perUnit - l * 20) / 4);
      const p = perUnit - l * 20 - m * 4;
      g.PotionsL = l;
      g.PotionsM = m;
      g.Potions = p;
      totalHumanXp += g.Experience * g.Count;
      totalPotionUnits += (p + m * 4 + l * 20) * g.Count;
    });
    totalGold += fl.gold;
  }

  return { totalHumanXp, totalPotionUnits, totalGold };
}

function main() {
  const floors = buildFloorPlan();
  allocateSouls(floors);
  const stats = allocateEconomyAndXp(floors);

  // Verify exact 25 Souls for all 41 species
  const soulCounts = Object.fromEntries(Object.keys(BASE_CONFIG.Rules.Species).map((id) => [id, 0]));
  for (const fl of floors) {
    for (const g of fl.enemies) {
      soulCounts[g.Species] += g.Count * g.Souls;
    }
  }
  for (const [sp, total] of Object.entries(soulCounts)) {
    if (total !== 25) throw new Error(`Soul mismatch for ${sp}: ${total} !== 25`);
  }
  const f100Leg = floors[99].enemies.map((e) => e.Species);

  // Add missing 3 endgame accessories into Shop Stages 4 & 5 and ensure SellPrices for all 44 gear items
  const existingOffers = [...BASE_CONFIG.Economy.Offers];
  const addOffers = [
    { Id: "gear_pulse_charm_3", Item: "pulse_charm_3", Stage: 4, Price: 260, Amount: 1, Stock: 1 },
    { Id: "gear_resolve_charm_3", Item: "resolve_charm_3", Stage: 5, Price: 280, Amount: 1, Stock: 1 },
    { Id: "gear_arrival_banner_3", Item: "arrival_banner_3", Stage: 5, Price: 300, Amount: 1, Stock: 1 },
  ];
  for (const offer of addOffers) {
    if (!existingOffers.some((o) => o.Item === offer.Item)) {
      existingOffers.push(offer);
    }
  }

  const sellPrices = { ...BASE_CONFIG.Economy.SellPrices };
  for (const gear of BASE_CONFIG.Rules.Equipment) {
    if (!sellPrices[gear.Id] && !BASE_CONFIG.StartingEquipment.includes(gear.Id)) {
      const offer = existingOffers.find((o) => o.Item === gear.Id);
      sellPrices[gear.Id] = offer
        ? Math.max(15, Math.floor(offer.Price / 3))
        : gear.Id.endsWith("_3")
          ? 95
          : gear.Id.endsWith("_2")
            ? 65
            : 35;
    }
  }

  const princessProfile = {
    ...BASE_CONFIG.Rules.Profiles.princess,
    Interval: 1.2,
    Cooldown: 5.5,
    TriggerEvery: 3,
    AutoSkills: [
      "princess_starlight_judgment",
      "princess_radiant_grace",
      "princess_sanctuary_edict",
    ],
    AutoDescription:
      "王庭三技轮转：每 3 次普攻依次触发【星辉圣裁】范围真伤圣光、【圣庭辉光】群疗净盾、【王女庇护敕令】全队增益控制，强度随等级进阶并受法杖与护衣加成。",
    Passive: "战后守望",
    PassiveEffect: "post_battle_human_heal",
    PostBattleHealBase: 0.12,
    PassiveDescription:
      "战斗胜利后若公主参战并存活，为两位存活人类恢复12%最大生命；可通过公主法杖与守护防具进一步提升回复比例。",
  };

  const princessCombatant = {
    ...BASE_CONFIG.Rules.Combatants.princess,
    Base: {
      ...BASE_CONFIG.Rules.Combatants.princess.Base,
      MaxHp: 610,
      Attack: 64,
      Defense: 45,
      Magic: 94,
      Resistance: 80,
      CritRate: 0.15,
      Haste: 0.05,
      DodgeRate: 0.07,
      Tenacity: 0.45,
      EnergyRegen: 0.12,
    },
    Growth: {
      ...BASE_CONFIG.Rules.Combatants.princess.Growth,
      MaxHp: 104,
      Attack: 6,
      Defense: 8,
      Magic: 22,
      Resistance: 14,
    },
  };

  const princessActions = {
    princess_radiant_grace: {
      DamageType: "magical",
      ScalingStat: "mag",
      Ratios: [0.75, 0.95, 1.15, 1.4, 2.0],
      Bases: [0, 0, 0, 0, 0],
      Delivery: "instant",
      Family: "",
      Windup: 0.25,
      Backswing: 0.2,
      ProjectileSpeed: 20,
      Lifetime: 2,
      Area: true,
      Interruptible: false,
      Range: 12,
      Radius: 10,
      Duration: 5,
    },
    princess_sanctuary_edict: {
      DamageType: "magical",
      ScalingStat: "mag",
      Ratios: [0.9, 1.1, 1.35, 1.65, 2.65],
      Bases: [0, 0, 0, 0, 0],
      Delivery: "instant",
      Family: "",
      Windup: 0.25,
      Backswing: 0.2,
      ProjectileSpeed: 20,
      Lifetime: 2,
      Area: true,
      Interruptible: false,
      Range: 12,
      Radius: 10,
      Duration: 5.5,
    },
    princess_starlight_judgment: {
      DamageType: "magical",
      ScalingStat: "mag",
      Ratios: [1.15, 1.4, 1.7, 2.1, 4.0],
      Bases: [0, 0, 0, 0, 0],
      Delivery: "instant",
      Family: "",
      Windup: 0.3,
      Backswing: 0.2,
      ProjectileSpeed: 20,
      Lifetime: 2,
      Area: true,
      Interruptible: false,
      Range: 14,
      Radius: 12,
      Duration: 4,
    },
  };

  const POST_HEAL_GEAR_BONUSES = {
    healer_staff: 0.06,
    healer_staff_2: 0.12,
    healer_staff_3: 0.2,
    ward_staff: 0.06,
    ward_staff_2: 0.12,
    ward_staff_3: 0.2,
    bell_staff: 0.1,
    bell_staff_2: 0.18,
    bell_staff_3: 0.28,
    cleanse_staff: 0.12,
    spirit_robe: 0.06,
    rescue_armor: 0.05,
    rescue_armor_2: 0.1,
    rescue_armor_3: 0.15,
  };

  const updatedEquipment = BASE_CONFIG.Rules.Equipment.map((g) => {
    const bonus = POST_HEAL_GEAR_BONUSES[g.Id] ?? 0;
    const baseDesc = (g.ModernDescription ?? "").replace(/；公主战后人类回复\+\d+%/g, "");
    return bonus > 0
      ? {
          ...g,
          PostBattleHealBonus: bonus,
          ModernDescription: `${baseDesc}；公主战后人类回复+${Math.round(bonus * 100)}%`,
        }
      : { ...g, PostBattleHealBonus: undefined, ModernDescription: baseDesc };
  });

  const nextConfig = {
    ...BASE_CONFIG,
    Rules: {
      ...BASE_CONFIG.Rules,
      Profiles: {
        ...BASE_CONFIG.Rules.Profiles,
        princess: princessProfile,
      },
      Combatants: {
        ...BASE_CONFIG.Rules.Combatants,
        princess: princessCombatant,
      },
      Actions: {
        ...BASE_CONFIG.Rules.Actions,
        ...princessActions,
      },
      Equipment: updatedEquipment,
    },
    Encounters: floors.map((fl) => ({
      Id: fl.id,
      Title: fl.title,
      Background: fl.background,
      Hint: fl.hint,
      Difficulty: fl.difficulty,
      Boss: fl.boss,
      Gold: fl.gold,
      Enemies: fl.enemies,
    })),
    Floors: floors.map((fl) => ({
      Number: fl.floor,
      Encounter: fl.id,
      Theme: fl.theme,
      Recover: false,
      Equipment: fl.gear ? [fl.gear] : [],
    })),
    Economy: {
      ...BASE_CONFIG.Economy,
      Offers: existingOffers,
      SellPrices: sellPrices,
    },
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(nextConfig, null, 2) + "\n", "utf8");
  console.log("Generated 100-floor config:", {
    floors: nextConfig.Floors.length,
    bosses: nextConfig.Encounters.filter((e) => e.Boss).map((e, i) => `F${(i + 1) * 5}:${e.Enemies[0].Species}`).join(", "),
    speciesWith25Souls: Object.keys(soulCounts).length,
    f100Species: f100Leg,
    totalHumanXp: stats.totalHumanXp,
    totalPotionUnits: stats.totalPotionUnits,
    totalPotionXp: stats.totalPotionUnits * 25,
    totalGold: stats.totalGold,
    offers: nextConfig.Economy.Offers.length,
    bossGearDrops: nextConfig.Floors.filter((f) => f.Equipment.length > 0).length,
  });
}

main();
