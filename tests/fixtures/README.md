# C#迁移基线

`csharp-first-two-floors.json` 来自原工程 commit `ed076a745e8986a7db10dd847dcbc7d15455a120` 的只读 C# 核心和本仓库未修改的起始 JSON。默认种子 `2463534242`，20 tick/秒，无交易、不使用大招、不调资源，默认首发，连打前两层。每20 tick和终局记录一次。

`tests/core/parity.test.ts` 对照坐标、生命、能量、伤害/治疗、三种回能、前后摇、冷却、随机状态及在途投射物数量。整数/随机状态严格一致；浮点使用 `1e-7` 数量级容差。不代表全部40物种、其它技能或跨语言逐位一致。

可选重建（需要原工程和.NET 9，仅迁移开发时使用；网页与正常测试不依赖它）：

```sh
dotnet run --project scripts/parity/Baseline.csproj \
  -p:SourceProjectRoot=/home/pt/Desktop/asterfell-scene \
  -p:BaseOutputPath="$TOWER_ARTIFACT_DIR/parity/bin/" \
  -p:BaseIntermediateOutputPath="$TOWER_ARTIFACT_DIR/parity/obj/" \
  > "$TOWER_ARTIFACT_DIR/csharp-trace.json"
```

在仓库根目录运行。不要在原工程目录编译、写文件或访问玩家存档。核对输出后再显式更新 fixture。

`csharp-ultimates.json`增加“每tick检查满能量后立即尝试施放”的指令对照。运行上述重建命令时在末尾附加 `-- --ultimates`，并输出到独立文件。每20 tick、指令发生时和终局记录；第二层在第163/248 tick成功施放，第253 tick结束。测试在完全相同tick向TS提交同一大招命令。

`csharp-ten-floors.json`为M2正常资源对照，生成命令在末尾使用 `-- --m2`。固定购买裂甲剑/叶幕杖、实际魂魄升阶、掉落药水培养、付费旅馆、默认首发与合法补人、大招和吟唱打断，连续通过10层。241个样本；`-- --m2 --dense`输出逐tick及诊断命中，实际3724个样本通过。详细资源策略与结果见[本次记录](../../docs/M2-STATUS.md)。

重建时写到本次NAS目录，核对再更新fixture。TS新增一次Boss战撤回/重试回归后，以相同战前状态继续对照；全量命令重放也在测试中验证。

`csharp-twenty-floors.json`在M2策略上增加11层前四件正常购买的装备与后续50金币住宿，连续通过20层；生成参数 `-- --twenty`，534个样本，`-- --twenty --dense`另有8005个逐tick样本实际对照。规则与资源明细见[前20层记录](../../docs/FLOOR20-STATUS.md)。
