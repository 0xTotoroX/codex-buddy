# ui/settings/ — React 配置网页

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

main 挂载设置视图并调用 api；类型来自 ../contracts.ts，API 层处理认证和 SSE 通信；设置版本变化时刷新，取消固定轮询。Web 覆盖模型、外观、交互与窗口设置；外观即时保存，模型表单显式保存。Vite 构建到 target/web，由 Rust 内嵌；不接收聊天正文。

成员清单：

- [index.html](index.html)：设置页 HTML 入口，加载同目录 main.tsx；标签页图标复用 ../icon.png。
- [main.tsx](main.tsx)：页面入口、连续分组设置表单、Field/Toggle 业务组合及操作反馈；页头复用产品图标；挂载设置大纲和模型快切局部设置；启动行为表单选择询问正常重开或直接强制重开，明确强退影响，显式保存；开发构建标明真实调试并固定启动端点和窗口。
- [settings-outline.tsx](settings-outline.tsx)：按已加载分组提供锚点导航，滚动跟随当前项并支持键盘及深链接；桌面固定侧栏，窄屏顶部横向导航。
- [panel-settings.tsx](panel-settings.tsx)：哑光/磨砂/液态材质、液态旁的 Clear 星星按钮、字号、摘要、点击、顺序及窗口设置，另提供明确的点击胶囊后展开方式（右侧嵌入/聊天内浮动，两者均留在宿主内）、侧栏宽度及停靠/浮窗各自的分栏/标签编排、选中标签、排列、首个面板、双轴比例和恢复默认，保存偏好不启用功能或更改主题；依据后台 popoutSupported 禁用不支持设备的桌面选项；按版本逐项保存，冲突时读取新状态；说明三材质在内嵌、弹出与旧系统下的实际效果。
- [model-control-settings.tsx](model-control-settings.tsx)：独立模型快切的显示器、边缘、位置和四主题即时设置；显示器按UUID保存，断开保留选择；版本冲突重读，忽略过期查询，不覆盖工作台外观。
- [dev-sources.js](dev-sources.js)：由 Dev 监督进程注入的独立设置入口，显示实际来源与资源确认、切换 worktree；沿用语义外观变量并局部隔离样式，不进入正式页面或聊天前端。
- [api.ts](api.ts)：公开数据类型、认证请求、错误和 SSE 状态订阅。
- [styles.css](styles.css)：Tailwind v4 入口、共享语义变量、锚点滚动留白及全局焦点/减少动效规则；只扫描本目录，布局和控件样式均由 TSX 工具类负责。
- [vite.config.ts](vite.config.ts)：React/Tailwind 构建插件、@ 别名、本机开发代理与 target/web 输出；仅代理 /api/ 请求，保留 api.ts 模块加载；依赖优化不等待全量模块遍历结束，避免冷启动后关闭卡住；只重写当前开发 HTTP 端口的来源，外部 Origin 交由后台拒绝。

- [utils.ts](utils.ts)：cn 合并条件类名与 Tailwind 冲突工具类。
- [components/ui/AGENTS.md](components/ui/AGENTS.md)：本地 shadcn/ui 基础组件，页面功能通过 props 组合；保留上游 MIT 许可。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
