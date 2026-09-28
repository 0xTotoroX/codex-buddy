# ui/surfaces/embedded/ — 嵌入 Codex

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `dock.js`：按 Codex 页面上下文创建可撤销侧栏占位；收起释放占位，空间不足或不支持时给出明确原因，保留位置和宽度偏好。排除文件侧栏，按实际空间临时缩窄，不覆盖保存宽度。
- `features.js`：将全部非贴边功能挂到原胶囊内容区，接入 workspace/layout 分栏及侧栏调宽；mainPlacement 选择侧栏或浮层，浮层释放占位，桌面接管后隐藏宿主主界面。
- `legacy.js`：旧 panel 配置的停靠生命周期与宽度/阅读保存，供仍可达的兼容工作台使用。
- [shell/AGENTS.md](shell/AGENTS.md)：原胶囊外壳、几何、表情、收放和键盘操作。

Codex 容器识别由 ui/codex/page-context.js 提供，输入与内容读取留在 codex。嵌入层不把自有功能节点识别为聊天。所有新功能位置完成迁移、旧 panel 入口退出后，才能删除 legacy.js。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。
