import {z} from "zod";

// Optional overrides: absent values preserve the original rules and configuration fingerprint.
// This registry supplies both runtime defaults and editor labels/ranges, never a second damage formula.
export const effectDefinitions = {
  HealingReceived: {label:"中毒时治疗保留",default:.6,min:0,max:1,group:"状态",percent:true,help:"毒刺与毒雾共用。60%表示实际治疗保留六成；100%不再抑制治疗。"},
  HasteBonus: {label:"急速增益",default:.25,min:0,max:1,group:"状态",percent:true,help:"顺风、狂斩、狂袭共用；与属性急速相加，合计仍受100%上限限制。"},
  HasteMoveMultiplier: {label:"急速时移动倍率",default:1.15,min:0,max:3,group:"状态",percent:false,help:"急速状态下的移动速度倍率，不修改单位基础移动属性。"},
  SlowMoveMultiplier: {label:"减速时移动倍率",default:.6,min:0,max:1,group:"状态",percent:false,help:"所有减速状态共用；1表示移动不减速。"},
  WeakenMultiplier: {label:"虚弱时输出保留",default:.75,min:0,max:1,group:"状态",percent:true,help:"虚弱与幽暗领域共用；其它增伤仍由核心叠加。"},
  ArmorBreakDefenseMultiplier: {label:"破甲时防御保留",default:.6,min:0,max:1,group:"状态",percent:true,help:"仅影响物理伤害计算中的防御；1表示不再降低防御。"},
  RegenerationRatio: {label:"持续恢复倍率",default:.25,min:0,max:5,group:"状态",percent:false,help:"每秒按恢复来源的法术属性计算，最低2生命；填0关闭持续恢复量。"},
  ReflectionRatio: {label:"反伤比例",default:.15,min:0,max:2,group:"被动",percent:true,help:"荆棘被动按实际损失生命计算原始反伤，再结算防御；0关闭反伤。"},
  ReflectionCooldown: {label:"反伤冷却（秒）",default:1,min:0,max:30,group:"被动",percent:false,help:"荆棘被动两次反伤之间的冷却。反伤不暴击、不吸血，也不再次触发反伤。"},
  CounterMultiplier: {label:"蓄势普攻倍率",default:1.3,min:1,max:5,group:"被动",percent:false,help:"反击与破盾反击共用，放大下一次普攻；1表示不再增加伤害。"},
  CleanseShieldRatio: {label:"净化附盾倍率",default:.3,min:0,max:5,group:"护盾",percent:false,help:"净化护盾被动的法术属性倍率，取已有护盾与新护盾中较大值。"},
  ShieldGuard: {label:"护体减伤比例",default:.5,min:0,max:.6,group:"护盾",percent:true,help:"潮壳阵、扎根、龙垒等护体状态共用；最终减伤仍受60%上限限制。"},
  TypedGuard: {label:"物理／法术庇护减伤",default:.45,min:0,max:.6,group:"护盾",percent:true,help:"硬壳、甲阵、灵甲、灵幕等对应伤害类型的庇护；不更改常驻被动减伤。"},
  OverhealShieldRatio: {label:"溢出治疗转盾比例",default:.5,min:0,max:1,group:"装备",percent:true,help:"溢出转盾装备将溢出治疗按此比例转为护盾。"},
  OverhealShieldCap: {label:"溢出护盾生命上限",default:.25,min:0,max:1,group:"装备",percent:true,help:"溢出转盾最多生成目标最大生命的一定比例；不会削减已有更强护盾。"},
  EmergencyShieldRatio: {label:"应急护盾生命比例",default:.18,min:0,max:1,group:"装备",percent:true,help:"应急装备低生命触发时的护盾量，按佩戴者最大生命计算。"},
  ArrivalShieldRatio: {label:"援护入场生命比例",default:.12,min:0,max:1,group:"装备",percent:true,help:"援护装备为补入伙伴生成的护盾量，按补入者最大生命计算。"},
} as const;
export type EffectKey = keyof typeof effectDefinitions;
const shape = Object.fromEntries(Object.entries(effectDefinitions).map(([key,d])=>[key,z.number().finite().min(d.min).max(d.max).optional()])) as {[K in EffectKey]:z.ZodOptional<z.ZodNumber>};
export const effectsSchema=z.object(shape).strict();
export type EffectOverrides=z.infer<typeof effectsSchema>;
export type Effects=Record<EffectKey,number>;
export function resolveEffects(overrides?:EffectOverrides):Effects {
  return Object.fromEntries(Object.entries(effectDefinitions).map(([key,d])=>[key,overrides?.[key as EffectKey]??d.default])) as Effects;
}
export const shieldDefaults = {
  leafward:[.4,.12],forest_breath:[.4,.12],wardheal:[.5,0],
  forest_sanctuary:[.6,.2],purify_veil:[.6,.2],
  aegis:[.7,.2],shellwall:[.7,.2],silver_wall:[.7,.2],silver_guard:[1,.3],
} as const;
export type ShieldSkill=keyof typeof shieldDefaults;
export const hasShieldRatio=(skill:string):skill is keyof typeof shieldDefaults=>Object.hasOwn(shieldDefaults,skill);
export function defaultShieldRatio(skill:keyof typeof shieldDefaults,level:number) {
  const [base,perLevel]=shieldDefaults[skill];return base+perLevel*level;
}
export const dotDefaults={poison:1/6,lava_bolt:1/8} as const;
export const hasDotRatio=(skill:string):skill is keyof typeof dotDefaults=>Object.hasOwn(dotDefaults,skill);
