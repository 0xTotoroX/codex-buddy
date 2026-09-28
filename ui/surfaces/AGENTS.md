# ui/surfaces/ — 承载界面

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

侧栏、页面浮层、桌面窗口共用唯一主界面；贴边窗口可独立共存。功能内容由 ui/features 提供，容器只管理挂载、布局、主题、窗口交接与动作反馈，不直接修改任务或模型业务数据。

- `main.ts`：带认证的通用窗口入口，根据 surface 路由桌面或贴边。
- [workspace/AGENTS.md](workspace/AGENTS.md)：公共头部、标签、分栏、比例、临时放大、阅读与草稿交接。
- [embedded/AGENTS.md](embedded/AGENTS.md)：Codex 内侧栏占位与页面浮层、原胶囊收放和调宽。
- [desktop/AGENTS.md](desktop/AGENTS.md)：独立桌面窗口与原生尺寸、置顶、往返适配。
- [edge/AGENTS.md](edge/AGENTS.md)：贴边标签、悬停收放与原生首帧/轮廓适配。
- [theme/AGENTS.md](theme/AGENTS.md)：各形式主题语义色、材质和内嵌 SVG 液态。

ui/codex/runtime/lifecycle.js 仍是浏览器注入的集成入口。Rust src/features.rs 管理功能 owner 和业务分发，src/surfaces.rs 管理承载配置及窗口生命周期。原生操作只在各形式适配层实现，功能视图不决定窗口位置。

带 legacy 名称的模块仅接续尚可到达的旧配置、窗口租约与 CLI 入口。它们复用当前功能内容；退出条件见 workspace 与 desktop 地图。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。
