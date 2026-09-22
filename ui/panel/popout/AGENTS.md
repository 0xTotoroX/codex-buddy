# ui/panel/popout/ — 系统窗口页面

> L2 | 父级：[AGENTS.md](../AGENTS.md)

index → boot → 共享胶囊；通过 HTTP/IPC 连接本机服务和 Wry。业务操作由宿主重新校验；明暗与语义色通过共享 presentation 从宿主投影同步；backdrop IPC 将主题传到自有原生窗口，与内嵌一致。原生背景独立合成，样式覆盖按顺序置于共享 CSS 之后。

boot 先 ready，再请求原生 show；AppKit 在来源位置已可见时调用 presented，确认交接并继续提起。dock 先读取 panel/anchor、等待原生返回，再附带移动前的临时阅读位置和偏好恢复宿主，确认后才发 close；失败回到原位置。moving/docking 抑制中间尺寸与位置保存，return/cancel-return 支持中途取消。几何观察仅响应 root/popover/glass 的变化，以微任务合并同批通知；正文局部变化不触发背景测量。native.css 取消网页表面的材质渐变，让前景与原生背景同时切换。

成员清单：

- [index.html](index.html)：Rust 内嵌的透明系统窗口页面与连接提示容器。
- [boot.js](boot.js)：启动凭据、窗口租约、投影及 Web 偏好更新和原生背景通知（material 决定渲染路线，liquidVariant 决定原生液态分支）；几何消息携带视口尺寸以拒绝过期更新，窗口始终展开，使用 liquidVariant 选择 Regular/Clear；外观/可见性变更即时发布，只有动画几何采样依赖帧；主题随背景消息设置自有窗口外观，不控制系统明暗。
- [transport.js](transport.js)：强制展开的偏好/尺寸投影（工作台保留双面板且高度至少 440，停靠宽度与停靠/浮窗排列、双轴比例独立保存）、受限远端命令、确认对话框与尺寸/拖动通信；原生 resize 未完成时保留最新尺寸，调用方等待尺寸同步。
- [native.css](native.css)：原生材质覆盖与确认弹窗（颜色跟随宿主）；不另设胶囊布局；缩放手柄内缩到原生圆角可命中的区域。磨砂与液态均使用透明网页前景，玻璃效果交给系统；共享 materials.css 为弹出哑光与原生磨砂保留一层受窗口留白约束的圆角阴影，原生液态不叠加网页阴影。

boot 将位置、置顶及外观写入串行化，每个响应同步本地 revision；外观仍携带 expectedRevision，真正外部冲突不会静默覆盖或无限重试。所有弹出均显示工作台，仍保留出发时的布局偏好和 returnOpen。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
