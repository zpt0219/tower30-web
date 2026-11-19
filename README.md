# 翠庭试炼 · 网页100层 · 开发与交接文档

项目目录：`/home/pt/Desktop/tower30-web`（目录名与内网路径 `/tower30/` 为历史沿用，不代表层数）。

## 1. 当前状态

基于 **Vite + vanilla TypeScript** 的原生网页试炼，浏览器本地完成全部玩法计算，无需游戏后端。

- **正式流程**：100层，5章×20层，每5层一个Boss（F5…F100，共20个）；41物种 + 主角/公主共43名角色。
- **队伍**：主角 + 公主 + 3只宠物，或主角 + 4只宠物（公主可离队）；宠物可替换。实时战斗为5首发、每方最多10名存活在场，余者按补人票入场。
- **平衡目标**（由 `tests/core/tower100.test.ts` 的真实60Hz流程验证）：合理培养与配装可无作弊打通100层；乱配资源会在中后段卡关；不带公主仅极限配置可通关；公主1v1强于任意单只宠物。
- **工作台**：编辑角色、关卡、技能、效果、策略，点击Play独立测试；批量A/B配对模拟；新怪兽制作（PNG上传）；导出工程ZIP或Godot试跑。见 [工作台说明](docs/WORKBENCH.md)。
- **Godot样机**：同一份JS核心通过QuickJS嵌入独立Godot 4.6.2 .NET工程，见 [工程运行说明](integrations/godot/README.md)。100层版尚未重新建立Godot端完整对照。
- 设计文档：[100层设计](docs/TOWER100-DESIGN.md)、[怪兽设计V2](docs/MONSTER-DESIGN-V2.md)、[新怪兽制作](docs/MONSTER-CREATION.md)。早期30层/20Hz阶段记录已移至 [docs/history](docs/history/README.md)，不代表当前行为。

尚未完成：原Godot角色场景、完整动画特效、Android导出与真机验证；手机真机上的F40—F100完整实玩手感尚无人工验收。

## 2. 运行与命令

```sh
npm ci
npm run dev -- --host 0.0.0.0
```

内网入口：[翠庭试炼](http://192.168.68.108/tower30/)，或 [内网主页](http://192.168.68.108/) 的“翠庭试炼 · 100层 · 编辑与试玩”卡片（按6）。部署与回滚见 [内网部署记录](docs/LAN-DEPLOY.md)。

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | 严格类型检查（含无宿主API的核心配置） |
| `npm run test -- --run` | Vitest核心测试（`tests/core/`） |
| `npm run audit:balance` | 100层强度曲线体检（支持 `--seed`、`--detail`、`--json`） |
| `npm run build` | 生成可静态托管的 `dist/` |
| `npm run test:e2e` | Playwright桌面1280×720与横屏1000×450浏览器流程 |
| `npm run deploy:lan` / `npm run verify:lan` | 内网部署与实际点击验证（需本机sudo） |
| `npm run apply:baseline -- <ZIP或JSON>` | 把工作台导出的工程设为仓库默认基线 |
| `npm run godot` / `npm run test:godot` / `npm run test:godot:project` | Godot样机运行与对照（需Godot 4.6.2 .NET、.NET 9、GCC） |

Node要求 >=22.12；Playwright浏览器首次安装 `npx playwright install chromium`。检查产物写入 `.artifact-dir` 指定的NAS目录（未配置时自动生成本地时区时间戳目录），也可传入 `TOWER_ARTIFACT_DIR`；写入后执行 `chmod -R 777`。

`tests/e2e/godot-record.spec.ts` 由 `npm run test:godot:project` 在生成Godot导出的记录后以 `TOWER_GODOT_RECORD=1` 调用；默认 `npm run test:e2e` 不包含该用例。

## 3. 技术边界

- `src/core/` 是唯一玩法实现：战斗、空间与碰撞、动作时间轴、成长、装备、经济、掉落、楼层推进、随机数和序列化。只用可移植的同步JS与JSON，不依赖DOM、Canvas、浏览器存储、网络、Node、Vite或Godot。
- 核心通过命令改变状态，通过快照和事件提供结果。界面不直接改生命、金币、能量、库存或胜负；Canvas只表现结果。
- 逻辑固定 `1/60秒`（60 tick/秒）；画面由requestAnimationFrame独立刷新并插值。暂停、单步与倍速只改变推进的tick数。后台页面暂停，恢复时不突跳追算。
- 迁移自原C#的随机数（xorshift32，uint分母）与舍入（AwayFromZero / 银行家舍入）规则保持不变。
- 不保留旧格式兼容：存档 `tower30-ts-m3-v2`、测试记录 `tower30-ts-workbench-v7`、批测报告 schemaVersion 4；旧格式直接拒绝，界面给出重新开始入口。

目录：

```text
data/tower/trial.json   100层编排、100个敌群、41物种、187个动作、44件装备与经济配置
data/combat/catalog.json 基础战斗目录
data/SOURCES.json       上游来源记录
src/core/               纯TS玩法核心
src/data/               配置加载与贴图映射
src/app/                页面、导航、输入与状态投影
src/battle-view/        Canvas战场渲染
src/editor/             工作台、批量对比、新怪兽制作
src/storage/            IndexedDB适配
src/bridge/             给Godot的JSON桥接会话
tests/core/ tests/e2e/  核心与浏览器测试
integrations/godot/     Godot样机
```

原Godot工程 `/home/pt/Desktop/asterfell-scene` 仅供只读参考，不得修改，构建与运行不依赖它。

## 4. 玩法规则摘要

- 开局：主角、公主，初始武器 `traveler_sword` / `healer_staff`，240金币，3份草药、1份复活道具。不赠送额外怪兽、装备或资源。
- 收编与升阶：首次收编消耗1魂，`RankCosts = [2, 4, 7, 11]`，满5阶共25魂；全部41物种在F1—F100内精确掉落25魂。
- 成长：人类靠战斗经验升级，怪兽靠经验药水（小/中/大 = 25/100/500 XP）升级，可无损退还；无等级上限，30级后经验需求按1.18倍递增。
- 商店：常驻买卖，有限库存不能靠刷新补充；累计击败2/4/8/12/16个Boss（即F10/F20/F40/F60/F80）依次解锁阶段1—5商品。穿戴中的装备需先卸下才能出售，初始武器保留。出售可快速选择数量。
- 旅馆：付费，价格 `35 + 商店阶段 × 15`（35—110金币）。楼层、Boss与通关不提供免费恢复。
- 公主战后回复：公主参战且存活时，战斗结束按比例回复主角与公主生命，比例可由装备提升。
- 奖励、首通装备、魂魄和药水只发放一次；重试恢复战前检查点，不能复制掉落或返还交易。
- 能量上限1000，跨战保留；回能仅来自出手、受击、击杀及其合法加成。

## 5. UI方向

维持原项目纸张面板、字体、像素人物与物品图；以1280×720横屏为基准并验证20:9手机横屏。每页围绕一项任务，把决策所需信息放在同屏；常用触控目标约48 CSS像素以上；不做小居中窗口、空白头像区或只有名称的物品格。主角装备与装备背包的“最终属性/装备加成同屏”布局已获用户认可，其余页面延续该密度。

## 6. 存档与配置编辑

- 正式存档与工作台草稿分别存于IndexedDB（库名 `tower30-web-v1`），保存当前档与上一份备份。存档可导入/导出JSON。
- 读档失败（如旧版本格式）时不覆盖原档，提示导出备份，并提供“清除并重新开始”。
- 配置编辑流程为“基线 → 草稿 → 校验 → Play新测试”；进行中的测试使用冻结快照，不随草稿改变。内置基线更新后，旧基线草稿自动备份并切换到新基线。
- 校验要求：100层、每5层一个Boss、唯一ID、引用完整、数值范围、技能与装备合法、价格与库存有效。

## 7. 验证要求

- 核心测试覆盖伤害/舍入、属性、技能与状态、控制打断、碰撞、回能、首发/补人、药水、装备、买卖/库存、旅馆、奖励幂等、存档与重放，以及100层正式流程与平衡目标。
- 浏览器流程实际操作并查看桌面与横屏截图；模拟触控与真机分别标明。
- 交付报告实际运行的命令与结果，标明未运行的检查。
