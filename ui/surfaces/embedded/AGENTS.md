# ui/surfaces/embedded/ — 嵌入 Codex

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `dock.js`：识别主聊天、新版标签页与独立聊天，按最近操作的聊天上下文创建可撤销侧栏占位；收起释放占位，空间不足或不支持时只保留左栏入口，不显示说明或替代菜单，保留位置和宽度偏好。dockWidthLimit 排除文件侧栏，为拖动返回当前可用上限；按实际空间临时缩窄，不覆盖保存宽度；销毁后拒绝迟到回调与挂载。
- `width.js`：新旧侧栏共用的调宽手势与最小宽度；拖至收起断点时恢复拖动前保存宽度并关闭，键盘调宽止于最小宽度。
- `features.js`：将全部非贴边功能挂到原胶囊内容区，接入 workspace/layout 分栏及侧栏调宽；mainPlacement 选择侧栏或浮层，浮层释放占位，桌面接管后隐藏宿主主界面，返回时恢复出发前的开合状态。
- `launcher.js`：优先复用唯一官方 CodexBuddy 导航按钮，聊天内 capture 阻止原整页导航并调用旧工作台手势；右键保留官方菜单；openPluginSettings 供头部设置信号复用 thread 入口，follow=false，不自动跨聊天展开。命中时不再注入重复图标，缺失/歧义时保留旧入口；原节点更名/重建/停止时解除及重新绑定。默认含 Dev 均走原工作台手势。仅 Dev 调用方显式传入 pluginTabPreview 才连接官方插件标签及 tooltip；试验代码保留，不默认启用。挂载唯一左栏图标及分隔线，复用表情单/双击、Alt+Enter，右键打开设置；只保留悬停反馈，提供收起态窗口锚点；导航重建后恢复，导航缺失时等待重新挂载，不回退胶囊，停止运行时清理。
- `legacy.js`：旧 panel 配置的停靠生命周期与宽度/阅读保存，供仍可达的兼容工作台使用。
- [shell/AGENTS.md](shell/AGENTS.md)：原胶囊外壳、几何、表情、收放和键盘操作。

Codex 容器识别由 ui/codex/page-context.js 提供，输入与内容读取留在 codex。嵌入层不把自有功能节点识别为聊天。所有新功能位置完成迁移、旧 panel 入口退出后，才能删除 legacy.js。

布局保存将 workspace 持有的 expectedLayout 交给后台，避免覆盖设置页刚保存的编排；失败后由共用布局模块重新接收远端布局，功能草稿不卸载。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。

features.js 首次接管遵循后台 mainManaged；只有模型贴边时保留 legacy 工作台。旧后台缺少此字段时兼容原逻辑，已接管的页面不因最后一项移到贴边而恢复旧内容。

官方按钮识别优先 aria-label 与正文，再兼容 title；设置打开状态仅放 data-buddy-settings-status，不改写宿主标题，避免失去匹配后重复注入备用入口。
