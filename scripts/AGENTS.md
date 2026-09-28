# scripts/ — 开发与分发工具

> L2 | 父级：[AGENTS.md](../AGENTS.md)

npm 命令进入开发、构建、审计、安装和验证编排工具；具体测试实现与辅助文件位于 [tests/](../tests/AGENTS.md)。日常安装器生成的 macOS applet 调用已安装 CLI，运行时不依赖这些脚本或 Node；独立 Dev applet 依赖本地源码和开发工具。默认检查与打包只读取仓库及已安装依赖。

成员清单：

- [dev-launcher.mjs](dev-launcher.mjs)：install:dev 生成独立 CodexBuddy Dev.app，首次后台执行带 --restart-running 的开发流程，日志写入 launcher.log；按开发配置（首次回退日常配置）的策略准备无连接宿主；重复打开按 session 中所选来源唤起工作台，dev:settings 打开固定开发设置地址；失联重连原目标，失败显式提示，并发启动的失败记录不干扰已取得占用的会话；--stop 校验进程身份后正常退出后台会话。Applet 启动期间显示 Dock 图标，经 AppKit 协作交接焦点后退出；连接成功后的前台切换失败仅发系统通知，通知异常不升级为弹窗；不更新日常安装，复用 launcher 的图标生成。
- [dev.mjs](dev.mjs)：真实 Codex 开发入口，管理独立后台、源码监听和编译失败回退，独立模型控制资源变化随原生后台重建；持有宿主目标与所选 worktree 租约，先绑定统一设置服务地址再传给开发后台齿轮，每个来源独立 Vite 缓存并去重 React；先编译后交接来源、失败回退，切换 Vite/监听/后台而不重启宿主；启动前先发现可调试宿主；显式 --restart-running 时先构建当前 CLI，再通过 host-only 模式准备宿主，仅在接管安装版后启用退出恢复，含占用获取和初始化在内的失败原因与进程 ID 写入私有 launcher-error.json，退出只清理本次会话记录；Ctrl+C 清理自身进程并恢复安装版连接。
- [material-preview.mjs](material-preview.mjs)：`dev:materials` 入口，将 Swift 对照工具编译到 target/material-preview 后打开；`--check` 验证同步控制，`--package` 在 dist/material-preview 生成自带程序和 MIT 许可的独立 App，并输出 ZIP；source/ 同时导出源码、独立构建入口和说明，可脱离主仓库二次开发；不修改安装版或产品偏好。
- [material-preview.swift](material-preview.swift)：14 种 NSVisualEffectView 材质的原生并排对照；独立背景窗口提供重复图案，统一切换外观、焦点状态与背景，支持真实桌面采样；标题栏固定不透明底色并跟随预览明暗。
- [dev-host.mjs](dev-host.mjs)：选择真实窗口与宿主启动配置（开发优先、首次继承日常），仅无宿主且显式授权自动准备时调用共享启动器，指定目标或歧义不触发重开；首次复制独立开发配置，暂停并恢复安装版连接；新目标已发现且旧目标不可用时将旧恢复记录保留为带唯一后缀的归档，不将安装版改连新聊天；API 错误保留后端原因；不创建浏览器或修改官方应用。
- [dev-panel.mjs](dev-panel.mjs)：原子发布开发资源快照，CSS 更新保留实例，逻辑更新销毁并恢复胶囊，页面引导变化重载窗口页面；共享 measurePanel 仅采集两端几何、材质能力和实例计数。
- [dev-sources.mjs](dev-sources.mjs)：Git worktree 清单及启动来源记忆、独占进程/目标租约、串行切换和失败回退状态；通过独占恢复记录串行回收已退出监督进程的租约，检查关联 worktree 与上次会话的后台，损坏记录或状态不明时保留并报错；不自行操作宿主或结束其他进程。
- [dev-runtime.mjs](dev-runtime.mjs)：受控子进程与稳定鉴权代理，开发来源 API 在后台切换时仍可用，切换中请求暂停、旧设置页写入按来源标识拒绝；可捕获宿主准备命令的端点及具体失败原因；后台重启后设置页会话保持有效；模型超时由后台控制，客户端断开时取消上游代理请求。
- [verify.mjs](verify.mjs)：统一检查、工作台/模型控制浏览器行为、构建、模型控制 HTTP/CDP 链路、端到端与生命周期验收；按源码/工具链摘要验证产物新鲜度，排除 Markdown 与 Finder 的 .DS_Store；原生检查显式选择。

- [build-panel.mjs](build-panel.mjs)：从 ui/codex/runtime/lifecycle.js 入口解析 ES modules，输出可重复注入的脚本，供 Cargo 内嵌。
- [install.mjs](install.mjs)：源码安装入口，不修改 shell PATH；本地 CLI / .app 启动器安装、旧默认数据目录迁移、旧程序保留和服务恢复；App 默认位于 /Applications。
- [launcher.mjs](launcher.mjs)：为安装器生成带本地签名的 CodexBuddy.app；从 ui/icon.png 生成多尺寸 ICNS 并绑定应用图标；双击调用 launch --restart-running 按设置处理缺少连接的宿主，取消不再弹错误；连接后在受支持系统弹出，以后台应用方式运行、不显示运行中的 Dock 图标；macOS 14 遇到浮窗门槛时保留内嵌，其他错误用系统对话框显示。
- [package.mjs](package.mjs)：本地打包入口，构建并校验当前 release、最低系统版本及许可；归档自带与其文件匹配的使用说明；macOS arm64 分发目录、manifest、程序包与源码包及供 Release 使用的总 SHA-256 校验文件，并从当前公开工作树重新生成源码归档。
- [source-audit.mjs](source-audit.mjs)：Git 与无 Git 源码目录共用文件清单，供审计、打包和测试复用；无 Git 时排除构建目录，拒绝私有文件与符号链接。核对包名及许可元数据并拒绝私有文档、运行配置、凭据和个人绝对路径。
- [license-texts.json](license-texts.json)：依赖包未附带的公开许可、署名原文与固定来源 URL，供许可生成器离线使用。
- [third-party-notices.mjs](third-party-notices.mjs)：collectLicenseFiles 递归收集包内许可与署名；generateNotices 合入固定补充与本地 shadcn/ui、OpenAI apps-sdk-ui 图标及 Model Deck 宿主适配许可并生成 THIRD_PARTY_NOTICES.md 和 dependencies.json，保留相对路径，只合并相同原文。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

内嵌液态：build-panel 在正式与开发构建中追加 ui/surfaces/theme/glass/lab.js，且只在非弹出页面启动；dev-panel 的只读测量记录实际渲染路径和阶段，不记录画面或错误文本。SVG 无第三方渲染依赖；third-party-notices 继续收集现用依赖及 shadcn/ui、OpenAI apps-sdk-ui 图标的许可。

任务看板由现有 Vite 多入口和 RustEmbed 随程序分发。verify 运行 board.mjs；提醒事项原生辅助 App 按需由程序在自身数据目录创建，不要求安装额外 CLI 或模型服务。

胶囊 bundle 包含共用功能内容；build-panel 使用现有 React JSX 转换和隔离样式。dev-panel 将 ui/features 的内容 CSS 与 ui/surfaces/workspace 的隔离挂载计入逻辑指纹，dev 监听 ui/codex、ui/features、ui/surfaces、ui/shared；外壳 CSS 可原位更新。

build/dev 追踪功能内容、容器和 Codex 适配的实际依赖；verify 纳入独立功能的真实 HTTP/CDP 验收，原生窗口另选 features-e2e --native。

Dev 控制器使用所选源码的 dev-panel 构建器，监听看板和通用功能视图；不能以控制器自身较旧的资源指纹确认新分支。构建脚本自身更新后须正常重启 Dev 监督进程。

开发快照从 ui/surfaces/main.ts 构建 feature.html/feature-dev.js；独立桌面和贴边以独立功能修订号检测更新，保存全部视图草稿后重载，忙碌/交接/分栏拖动时延期。development 几何回读区分宿主与桌面/贴边，不读取卡片标题或聊天正文。

Dev 来源识别和原生资源输入兼容新旧源码布局；旧路径仅作为历史 worktree 回退。升级目录布局时使用新版监督脚本正常重开，分别核对嵌入与实际存在的原生窗口资源修订号；没有活动窗口的旧遥测不代表当前已加载。
