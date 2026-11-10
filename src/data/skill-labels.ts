// Presentation only. Action IDs remain stable in configuration, commands and replays.
export const skillNames: Readonly<Record<string, string>> = {
  swift: "迅击",
  steady: "稳击",
  heal: "治疗",
  renew: "新芽复苏",
  water: "水弹",
  tide: "涌潮",
  leafward: "嫩叶守护",
  forest_rest: "林息",
  aegis: "钳盾",
  shellwall: "潮壳阵",
  bait: "牵制",
  taunt: "坚壳挑衅",
  huntbite: "撕咬",
  pounce: "追猎",
  gust: "乱风",
  interrupt: "截风",
  firebolt: "火弹",
  fire_rain: "小火雨",
  ram: "拱撞",
  rupture: "碎甲冲",
  boss_stomp: "獠王震击",
  breakstrike: "裂甲击",
  wardheal: "叶幕治疗",
  flame: "龙息",
  drain: "蚀能",
  silence: "静默",
  spirit_armor: "灵甲",
  spirit_veil: "灵幕",
  leech: "汲血",
  doublecut: "双斩",
  mossheal: "苔衣",
  rooted_guard: "扎根",
  curse: "幽咒",
  ice_shard: "冰针",
  ice_domain: "寒潮",
  eye_ray: "凝视",
  cleanse: "净化",
  cleave: "横扫",
  crystal_pierce: "晶刺",
  cyclone: "飓风",
  dragon_claw: "龙爪",
  dragon_sweep: "龙牙扫荡",
  dragon_wall: "龙垒",
  draw_slash: "拔刀斩",
  earth_prison: "岩牢",
  earth_stomp: "地震踏",
  ember: "焰息",
  fear_strike: "恐惧突袭",
  forest_breath: "森息",
  forest_sanctuary: "森林庇护",
  frenzy_cut: "狂斩",
  frost_breath: "霜息",
  furious_assault: "狂袭",
  gloom: "幽暗领域",
  holy_light: "圣光",
  holy_prayer: "圣祈",
  lava_bolt: "熔弹",
  nightmare_strike: "梦魇击",
  parry: "招架",
  poison: "毒刺",
  poison_cloud: "毒雾",
  purify_veil: "净化帷幕",
  shatter_ray: "棱镜射线",
  silver_guard: "银光庇护",
  silver_wall: "银壁",
  tailwind: "顺风",
  boss_tempest: "烈风风暴",
  hard_shell: "硬壳",
  armor_front: "甲阵",
  boss_carapace: "虫王甲壳震击",
  guard: "护卫",
  ward: "结界",
  rally: "集结",
};

export const skillLabel = (id: string) => skillNames[id] ?? id;

export const skillDescriptions: Readonly<Record<string, string>> = {
  swift: "迅击：短前摇的单体物理攻击，使用攻击属性结算。",
  steady: "稳击：不可打断的强化单体斩击。消耗满额能量，在前摇后命中。",
  heal: "治疗：救治低血量队友，使用法术属性结算。",
  renew: "新芽复苏：群体治疗并附加持续恢复。",
  water: "水矢：远程法术伤害并减速敌人。",
  tide: "怒潮：召唤巨浪造成范围法术伤害。",
  leafward: "嫩叶守护：为濒危队友提供吸收护盾。",
  forest_rest: "林息：群体持续恢复并解除减速。",
  aegis: "援护：为低血量队友提供吸收护盾。",
  shellwall: "潮壳阵：群体护盾并提供减伤。",
  bait: "牵制：吸引附近敌人注意力。",
  taunt: "坚壳挑衅：嘲讽敌人并降低自身受到的伤害。",
  huntbite: "撕咬：优先撕咬受伤敌人。",
  pounce: "追猎：突进追击最脆弱的后排敌人。",
  gust: "乱风：命中敌人并削减其能量。",
  interrupt: "截风：优先打断正在吟唱技能的目标。",
  firebolt: "火球：向敌人投射火球造成法术伤害。",
  fire_rain: "熔火池：召唤火雨持续灼烧地面区域。",
  ram: "拱撞：近身击退并造成物理伤害。",
  rupture: "碎甲冲：冲撞目标并造成范围破甲。",
  boss_stomp: "獠王震击：重踏地面造成范围伤害与眩晕。",
  breakstrike: "裂甲击：单体物理攻击并降低目标护甲3秒。",
  wardheal: "叶幕治疗：治疗单体队友并附加护盾。",
  flame: "龙息：有明显前摇的前方锥形火焰吐息。",
  drain: "蚀能：攻击目标并削减其能量。",
  silence: "禁言：沉默敌方后排，阻止释放技能。",
  spirit_armor: "灵甲：抵挡下一次法术技能的部分伤害。",
  spirit_veil: "灵幕：保护附近队友免受法术爆发伤害。",
  leech: "汲血：近身伤害并回复自身生命。",
  doublecut: "双斩：快速连续造成两段物理伤害。",
  mossheal: "苔衣：为自身提供缓慢持续恢复。",
  rooted_guard: "扎根：大幅减伤并持续自疗，期间无法移动。",
  curse: "幽咒：伤害目标并降低其输出能力。",
  ice_shard: "冰针：向敌人发射冰针造成伤害与减速。",
  ice_domain: "寒潮：在目标区域造成冰霜伤害与短时间冻结。",
  eye_ray: "凝视：射出穿透射线造成魔法伤害。",
  cleanse: "安魂：解除一名队友的可净化负面状态。",
  cleave: "横扫：前方范围物理斩击，伤害并击退敌人。",
  crystal_pierce: "晶刺：射出水晶刺，优先破坏敌方护盾。",
  cyclone: "飓风：聚拢小范围敌人并造成减速。",
  dragon_claw: "龙爪：近身前方连续爪击。",
  dragon_sweep: "赤翼横扫：大范围物理爆发并击退前方敌人。",
  dragon_wall: "大地龙壁：嘲讽全场、高额减伤并反弹伤害。",
  draw_slash: "拔刀斩：瞬间拔刀造成前方范围斩击。",
  earth_prison: "岩牢：困住近处敌人并为自身附加护盾。",
  earth_stomp: "地震踏：震击地面造成范围伤害与减速。",
  ember: "焰息：向目标周围吐出小范围火焰。",
  fear_strike: "噩梦降临：单体高额爆发并使目标短时恐惧。",
  forest_breath: "森息：治疗濒危队友并附加吸收护盾。",
  forest_sanctuary: "古林庇护：全队群体治疗并获得短时减伤。",
  frenzy_cut: "狂斩：近身小范围连续撕裂攻击。",
  frost_breath: "霜息：喷射寒霜伤害并减速前方敌人。",
  furious_assault: "狂袭：大幅提升攻击节奏，暂时降低自身防御。",
  gloom: "幽暗领域：在区域内持续压制敌方输出。",
  guard: "护卫：为身边队友提供护盾保护。",
  hard_shell: "硬壳：短时间内大幅降低受到的普通攻击伤害。",
  holy_light: "圣光：治疗一名队友并净化其负面状态。",
  holy_prayer: "天穹祈愿：全队群体治疗与强效净化。",
  lava_bolt: "熔弹：投掷熔岩弹造成范围火焰伤害。",
  nightmare_strike: "梦魇击：追击受伤后排并造成暗影伤害。",
  parry: "招架：格挡保护自身并立刻进行反击。",
  poison: "毒刺：造成持续毒伤并大幅抑制目标受到的治疗。",
  poison_cloud: "毒雾：散布大范围毒雾持续造成毒伤与减疗。",
  purify_veil: "净化帷幕：全队群体护盾与异常状态清除。",
  rally: "集结：吹响号角提升全队士气与攻击速度。",
  shatter_ray: "棱镜射线：多目标穿透折射射线。",
  silver_guard: "流银守护：群体护盾与强力控制抗性。",
  silver_wall: "银壁：为自身与一名濒危队友附加坚固护盾。",
  tailwind: "顺风：短时间内大幅提高附近队友的攻击节奏。",
  ward: "结界：召唤法术结界降低全队受到的魔法伤害。",
  boss_carapace: "虫王甲壳震击：蓄力释放甲壳震波造成高额范围伤害。",
  boss_tempest: "烈风风暴：召唤全场撕裂狂风造成多段大范围法术伤害。",
  armor_front: "甲阵：架设坚固甲盾，抵挡正面的集中攻击。",
};

export const getSkillDescription = (id: string): string => {
  if (!id) return "不使用自动技能";
  return skillDescriptions[id] ?? `${skillLabel(id)} · ${id}`;
};

export interface PassiveDefinition {
  name: string;
  description: string;
}

export const passiveDefinitions: Readonly<Record<string, PassiveDefinition>> = {
  attack_heal: {
    name: "普攻吸血",
    description: "吸血增加5%×被动等级，只按实际扣血恢复，范围折半，合计上限60%。",
  },
  thorns: {
    name: "近身反伤",
    description: "近身攻击者受到少量反伤；反击者不发出手／击杀能量，不触发吸血与二次反伤。",
  },
  armor_bonus: {
    name: "破甲追击",
    description: "攻击破甲目标时追加伤害。",
  },
  burn_bonus: {
    name: "灼烧克制",
    description: "对处于灼烧状态的目标伤害提高。",
  },
  slow: {
    name: "迟缓加剧",
    description: "延长自身减速效果，控制仍受保护间隔约束。",
  },
  slow_power: {
    name: "霜冻重创",
    description: "对被减速的目标提高法术伤害。",
  },
  execute: {
    name: "弱者处决",
    description: "对低生命目标伤害提高。",
  },
  heal_low: {
    name: "急救强化",
    description: "受保护目标低血量时提高治疗效率。",
  },
  shield_heal: {
    name: "护盾共鸣",
    description: "已有护盾目标获得小幅治疗加成。",
  },
  shield_targets: {
    name: "广域守护",
    description: "自动护盾增加保护人数。",
  },
  damage_guard: {
    name: "常驻坚韧",
    description: "小幅常驻减伤。",
  },
  physical_guard: {
    name: "连击抵御",
    description: "受到连续普攻时提高减伤，设上限。",
  },
  spell_guard: {
    name: "法术屏障",
    description: "受到法术伤害时延长自身保护，设触发间隔。",
  },
  root_guard: {
    name: "磐石之躯",
    description: "解锁后韧性增加20%，缩短控制并提高受击硬直门槛。",
  },
  energy_attack: {
    name: "回能加速",
    description: "充能效率增加10%×被动等级，统一影响出手、受击与击杀回能，受100%上限约束。",
  },
  drain: {
    name: "噬能增效",
    description: "提高技能削减敌人能量的效率。",
  },
  combo: {
    name: "连击累积",
    description: "攻击同一目标时小幅积累伤害加成。",
  },
  self_heal: {
    name: "绝境愈合",
    description: "低生命时提高自身治疗效率。",
  },
  weaken: {
    name: "虚弱延长",
    description: "延长自身弱化效果。",
  },
  poison: {
    name: "剧毒蔓延",
    description: "延长毒伤，持续伤害不回施法者能量。",
  },
  controlled_bonus: {
    name: "受控惩戒",
    description: "对受控目标造成额外伤害。",
  },
  controlled_leech: {
    name: "暗影汲取",
    description: "攻击受控目标时获得短时吸血。",
  },
  shield_counter: {
    name: "破盾反击",
    description: "护盾被击破后强化一次普攻。",
  },
  low_power: {
    name: "狂暴濒危",
    description: "生命降低时提高伤害，设上限。",
  },
  shield_break: {
    name: "破障贯穿",
    description: "对有护盾的目标提高技能伤害。",
  },
  haste: {
    name: "极速顺风",
    description: "提高顺风覆盖率。",
  },
  silver: {
    name: "秘银重甲",
    description: "解锁后韧性增加20%，并获得32%物理保护；同类保护取较强者。",
  },
  cleanse_ward: {
    name: "净化加护",
    description: "净化后短时提高队友对控制的抵抗。",
  },
  unshielded: {
    name: "无防破绽",
    description: "对未获得护盾的目标提高伤害。",
  },
  flame_bonus: {
    name: "烈焰狂涌",
    description: "强化自身吐息伤害。",
  },
  shield_power: {
    name: "护甲锋芒",
    description: "自身护盾存在时提高近战伤害。",
  },
  counter: {
    name: "反制猛击",
    description: "成功承受攻击后强化下一次普攻。",
  },
  courage: {
    name: "勇气",
    description: "主角专属：坚定勇气，短前摇单体输出与意志强化。",
  },
  watch: {
    name: "守望",
    description: "公主专属：慈爱守护，为濒危队友提供守护与治疗。",
  },
};

export const getPassiveInfo = (effectId: string): PassiveDefinition => {
  if (!effectId) return { name: "无", description: "未配置三阶被动技能" };
  return (
    passiveDefinitions[effectId] ?? {
      name: effectId,
      description: "三阶解锁特殊被动效果",
    }
  );
};
