# ui/panel/runtime/ — 运行协调与状态

> L2 | 父级：[AGENTS.md](../AGENTS.md)

constants/state 为下层基础；host 和功能模块各自工作；settings-sync 协调开关，presentation 生成投影，lifecycle 订阅通知并组合运行。状态分为 runtime、context、stepwise、outline、shell 五组；旧调试 state 只提供兼容投影。

presentation 的 panelReadingState 由 lifecycle 导出，记录标签、预览条目及滚动位置；工作台额外记录 outline/next 各自的内容 token 与滚动位置，并以任务/内容 token 校验；只在初次呈现或收回时恢复。panelWindowAnchor 提供临时屏幕矩形，隐藏内嵌或宿主页面不可见时由 shellLayout 计算，按出发形态返回胶囊或展开矩形；blinkHandoff 在交接结束眨眼一次。setDetached 是可等待、可反向中断的淡化交接，shell 保存临时动画与完成 promise，lifecycle 停用时回收。后台不可见页面或减少动态效果时立即交接，避免等待被浏览器暂停的帧；常规投影不重置阅读位置。

工作台的屏幕交接使用宿主适配提供的 `dockRect.anchor`：展开时匹配实际栏宽，收起时定位到44px入口范围；弹出期间仍按可恢复的布局计算，不能由保存的 `dockOpen` 单独推断。

成员清单：

- [constants.js](constants.js)：稳定 DOM 标识、尺寸与时间参数；构建标志区分开发版及其独立存储键。
- [state.js](state.js)：五组状态的初始化（弹出始终展开）、能力判断、受限 bridgeCall 和基础文本工具；不导入上层。
- [signals.js](signals.js)：固定的同步通知类型及订阅，包括 windowToggle 手势请求；不承载状态或业务实现。
- [diagnostics.js](diagnostics.js)：可见几何和本地限量诊断，不保存聊天正文。
- [settings-sync.js](settings-sync.js)：openSettings 打开统一配置页，不传未使用的页面定位参数；设置请求、保存、推送同步和 15 秒恢复检查；两个功能独立重置。
- [presentation.js](presentation.js)：包含宿主实际强调色的只读窗口投影（缺失时恢复默认色）、Web 三材质及 liquidVariant 偏好同步（忽略弹出收起偏好）、按钮与表情双击共用 togglePanelWindow 弹出/收回与动作校验，未收到后台 popoutSupported=true 时禁用弹出；执行业务动作前重新核对宿主；不接收远端 theme 命令，也不以投影明暗覆盖弹出系统主题；内嵌弹出/收回发出 appearance 通知以同步 SVG 液态；弹出与收回使用方向相反的图标，提示对应动作；窗口切换与置顶按钮位于共同标题栏，不插入弹出专用来源行。
- [lifecycle.js](lifecycle.js)：组合入口、DOM 观察、正文扫描、启停/销毁、接口和通知订阅，停用时清理表情连击记录；公开运行实例是否为开发版；停用/销毁时发送内嵌 SVG 液态清理通知。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
