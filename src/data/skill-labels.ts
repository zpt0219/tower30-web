// Presentation only. Action IDs remain stable in configuration, commands and replays.
export const skillNames: Readonly<Record<string,string>> = {
  swift:'迅击',steady:'稳击',heal:'治疗',renew:'新芽复苏',water:'水弹',tide:'涌潮',
  leafward:'嫩叶守护',forest_rest:'林息',aegis:'钳盾',shellwall:'潮壳阵',bait:'牵制',taunt:'坚壳挑衅',
  huntbite:'撕咬',pounce:'追猎',gust:'乱风',interrupt:'截风',firebolt:'火弹',fire_rain:'小火雨',
  ram:'拱撞',rupture:'碎甲冲',boss_stomp:'獠王震击',breakstrike:'裂甲击',wardheal:'叶幕治疗',flame:'龙息',
  drain:'蚀能',silence:'静默',spirit_armor:'灵甲',spirit_veil:'灵幕',leech:'汲血',doublecut:'双斩',
  mossheal:'苔衣',rooted_guard:'扎根',curse:'幽咒',ice_shard:'冰针',ice_domain:'寒潮',eye_ray:'凝视',
  hard_shell:'硬壳',armor_front:'甲阵',boss_carapace:'虫王甲壳震击',
};
export const skillLabel=(id:string)=>skillNames[id]??id;
