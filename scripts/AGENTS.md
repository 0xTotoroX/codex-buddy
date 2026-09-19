# scripts/ — 开发与分发工具

> L2 | 父级：[AGENTS.md](../AGENTS.md)

npm 命令进入开发、构建、审计、安装和验证编排工具；具体测试实现与辅助文件位于 [tests/](../tests/AGENTS.md)。日常安装器生成的 macOS applet 调用已安装 CLI，运行时不依赖这些脚本或 Node；独立 Dev applet 依赖本地源码和开发工具。默认检查与打包只读取仓库及已安装依赖。

成员清单：

- [dev-launcher.mjs](dev-launcher.mjs)：install:dev 生成独立 CodexBuddy Dev.app，打开专用 Terminal 执行现有开发流程，复用存活开发实例，不更新日常安装；复用 launcher 的图标生成。
- [dev.mjs](dev.mjs)：真实 Codex 开发入口，管理独立后台、源码监听和编译失败回退；Ctrl+C 清理自身进程并恢复安装版连接。
- [material-preview.mjs](material-preview.mjs)：`dev:materials` 入口，将 Swift 对照工具编译到 target/material-preview 后打开；`--check` 验证同步控制，`--package` 在 dist/material-preview 生成自带程序和 MIT 许可的独立 App，并输出 ZIP；source/ 同时导出源码、独立构建入口和说明，可脱离主仓库二次开发；不修改安装版或产品偏好。
- [material-preview.swift](material-preview.swift)：14 种 NSVisualEffectView 材质的原生并排对照；独立背景窗口提供重复图案，统一切换外观、焦点状态与背景，支持真实桌面采样；标题栏固定不透明底色并跟随预览明暗。
- [dev-host.mjs](dev-host.mjs)：选择真实窗口，首次复制独立开发配置，暂停并恢复安装版连接；不创建浏览器或修改官方应用。
- [dev-panel.mjs](dev-panel.mjs)：原子发布开发资源快照，CSS 更新保留实例，逻辑更新销毁并恢复胶囊，页面引导变化重载窗口页面；共享 measurePanel 仅采集两端几何、材质能力和实例计数。
- [dev-runtime.mjs](dev-runtime.mjs)：受控子进程与稳定鉴权代理；后台重启后设置页会话保持有效；模型超时由后台控制，客户端断开时取消上游代理请求。
- [verify.mjs](verify.mjs)：统一检查、工作台浏览器行为、构建、端到端与生命周期验收；按源码/工具链摘要验证产物新鲜度，排除 Markdown 与 Finder 的 .DS_Store；原生检查显式选择。

- [build-panel.mjs](build-panel.mjs)：从 lifecycle 入口解析 ES modules，输出可重复注入的脚本，供 Cargo 内嵌。
- [install.mjs](install.mjs)：源码安装入口，不修改 shell PATH；本地 CLI / .app 启动器安装、旧默认数据目录迁移、旧程序保留和服务恢复；App 默认位于 /Applications。
- [launcher.mjs](launcher.mjs)：为安装器生成带本地签名的 CodexBuddy.app；从 ui/icon.png 生成多尺寸 ICNS 并绑定应用图标；双击调用 CLI 连接并在受支持系统弹出，以后台应用方式运行、不显示运行中的 Dock 图标；macOS 14 遇到浮窗门槛时保留内嵌，其他错误用系统对话框显示。
- [package.mjs](package.mjs)：本地打包入口，构建并校验当前 release、最低系统版本及许可；归档自带与其文件匹配的使用说明；macOS arm64 分发目录、manifest、程序包与源码包及供 Release 使用的总 SHA-256 校验文件，并从当前公开工作树重新生成源码归档。
- [source-audit.mjs](source-audit.mjs)：Git 与无 Git 源码目录共用文件清单，供审计、打包和测试复用；无 Git 时排除构建目录，拒绝私有文件与符号链接。核对包名及许可元数据并拒绝私有文档、运行配置、凭据和个人绝对路径。
- [license-texts.json](license-texts.json)：依赖包未附带的公开许可、署名原文与固定来源 URL，供许可生成器离线使用。
- [third-party-notices.mjs](third-party-notices.mjs)：collectLicenseFiles 递归收集包内许可与署名；generateNotices 合入固定补充与本地 shadcn/ui、OpenAI apps-sdk-ui 图标许可并生成 THIRD_PARTY_NOTICES.md 和 dependencies.json，保留相对路径，只合并相同原文。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

内嵌液态：build-panel 在正式与开发构建中追加 ui/panel/glass/lab.js，且只在非弹出页面启动；dev-panel 的只读测量记录实际渲染路径和阶段，不记录画面或错误文本。SVG 无第三方渲染依赖；third-party-notices 继续收集现用依赖及 shadcn/ui、OpenAI apps-sdk-ui 图标的许可。
