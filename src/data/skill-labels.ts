// Presentation only. Action IDs remain stable in configuration, commands and replays.
export const skillNames: Readonly<Record<string,string>> = {
  swift:'迅击',steady:'稳击',heal:'治疗',renew:'新芽复苏',water:'水弹',tide:'涌潮',
  leafward:'嫩叶守护',forest_rest:'林息',aegis:'钳盾',shellwall:'潮壳阵',bait:'牵制',taunt:'坚壳挑衅',
  huntbite:'撕咬',pounce:'追猎',gust:'乱风',interrupt:'截风',firebolt:'火弹',fire_rain:'小火雨',
  ram:'拱撞',rupture:'碎甲冲',boss_stomp:'獠王震击',breakstrike:'裂甲击',wardheal:'叶幕治疗',flame:'龙息',
  drain:'蚀能',silence:'静默',spirit_armor:'灵甲',spirit_veil:'灵幕',leech:'汲血',doublecut:'双斩',
  mossheal:'苔衣',rooted_guard:'扎根',curse:'幽咒',ice_shard:'冰针',ice_domain:'寒潮',eye_ray:'凝视',
  cleanse:'净化',cleave:'横扫',crystal_pierce:'晶刺',cyclone:'飓风',dragon_claw:'龙爪',dragon_sweep:'龙牙扫荡',dragon_wall:'龙垒',draw_slash:'拔刀斩',earth_prison:'岩牢',earth_stomp:'地震踏',ember:'焰息',fear_strike:'恐惧突袭',forest_breath:'森息',forest_sanctuary:'森林庇护',frenzy_cut:'狂斩',frost_breath:'霜息',furious_assault:'狂袭',gloom:'幽暗领域',holy_light:'圣光',holy_prayer:'圣祈',lava_bolt:'熔弹',nightmare_strike:'梦魇击',parry:'招架',poison:'毒刺',poison_cloud:'毒雾',purify_veil:'净化帷幕',shatter_ray:'棱镜射线',silver_guard:'银光庇护',silver_wall:'银壁',tailwind:'顺风',boss_tempest:'烈风风暴',
  hard_shell:'硬壳',armor_front:'甲阵',boss_carapace:'虫王甲壳震击',
};
export const skillLabel=(id:string)=>skillNames[id]??id;
