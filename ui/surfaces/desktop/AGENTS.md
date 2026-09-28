# ui/surfaces/desktop/ — 桌面窗口

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `main.js` / `main.d.ts`：一个 main lease 对应一个共用工作台窗口；复用 workspace 头部和布局，适配原生左右下角缩放、置顶回读/保存、设置入口及往返动效。整组目标 ready 后提交 owner，失败恢复原位置。
- `legacy-board.tsx`：board.html 的任务专用入口，注入认证客户端并挂载同一个 Board；保留既有 CLI/旧窗口调用。
- [legacy/AGENTS.md](legacy/AGENTS.md)：旧 panel 租约的页面、HTTP/IPC 和原生外观适配。

原生窗口行为由 src/panel_window.rs 等既有窗口模块执行。兼容入口目前仍被旧配置、租约和 CLI 调用；仅在调用方迁至通用 main lease、旧租约失效且配置已可安全恢复后删除。兼容层不另做看板、大纲或下一步内容。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。
