# 内网主页卡片与静态部署

当前部署 v0.13.0：

- 主页：http://192.168.68.108/
- 游戏与编辑器：http://192.168.68.108/tower30/
- 状态：http://192.168.68.108/api/check/tower30

主页新增“30层试炼 · 编辑与试玩”卡片，直接进入已构建的网页；可按6跳转。状态来自实际部署的release.json，显示在线版本。与NAS上的ZIP下载入口分开，不需要启动Vite或Node游戏服务。

## 文件与更新

- 生产静态文件：`/var/www/portal/tower30/`。
- 主页：`/var/www/portal/index.html`。
- Nginx：`/etc/nginx/sites-available/portal`。
- 仓库模板：`deploy/portal-card.html`、`deploy/nginx-tower30.conf`。
- 更新：`npm run deploy:lan`。先构建，再暂存、替换本应用目录，使用受标记的片段更新卡片与Nginx；需要本机sudo权限。Nginx配置检查通过后才reload，无需新建开发服务。
- 检查：`npm run verify:lan`。核对全部部署资源SHA-256和JS MIME类型，再在桌面/横屏实际点击卡片、进入战斗、领取第一层奖励、刷新与打开工作台；检查上下文独立于用户浏览器进度。

部署脚本在 `.artifact-dir` 或 `TOWER_ARTIFACT_DIR` 对应目录保存主页与Nginx的修改前/后文件、release清单与部署信息。部署中的Nginx配置检查或reload失败会恢复主页和Nginx；已有游戏目录更新时保留为相邻 `.tower30-previous-时间戳` 目录，不自动删除。首次部署前没有tower30目录。

手动回滚主页/路由时，将对应产物目录的 `portal.before.html` 和 `nginx.before.conf` 分别安装回上述路径，运行 `sudo nginx -t` 后reload。不要使用旧备份覆盖其它应用后续新增的修改，需先比较差异。

## 本次验证

唯一产物目录：`/srv/nas/Shared/hd2d-videos/261101_1826_tower30_lan_portal/`。

Nginx配置检查通过。HTTP主页、游戏与健康状态均返回200；部署资源逐文件哈希与本机构建一致。桌面1280×720与横屏1000×450均实际从卡片进入游戏，以初始240金币真实完成第1层，领取后305金币、第2层，刷新保持，并可打开带Godot试跑导出的工作台。实际查看两个尺寸的主页卡片、战斗与编辑器截图。

这是内网静态网页部署；Godot原生工程仍按项目文档独立运行。本次没有修改原Godot项目或其它应用源码；保留现有门户其它卡片和服务。
