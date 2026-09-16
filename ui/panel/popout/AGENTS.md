# ui/panel/popout/ — 系统窗口页面

> L2 | 父级：[AGENTS.md](../AGENTS.md)

index → boot → 共享胶囊；通过 HTTP/IPC 连接本机服务和 Wry。业务操作由宿主重新校验；系统明暗走本地 IPC；强调色通过共享 presentation 从宿主投影同步，与内嵌一致。原生背景独立合成，样式覆盖按顺序置于共享 CSS 之后。

成员清单：

- [index.html](index.html)：Rust 内嵌的透明系统窗口页面与连接提示容器。
- [boot.js](boot.js)：启动凭据、窗口租约、投影及 Web 偏好更新和原生背景通知（material 决定渲染路线，liquidVariant 决定原生液态分支）；几何消息携带视口尺寸以拒绝过期更新，窗口始终展开，使用 liquidVariant 选择 Regular/Clear；外观/可见性变更即时发布，只有动画几何采样依赖帧；系统明暗使用独立 IPC，回传错误解除等待。
- [transport.js](transport.js)：强制展开的偏好/尺寸投影、受限远端命令、确认对话框与尺寸/拖动通信；原生 resize 未完成时保留最新尺寸，调用方等待尺寸同步。
- [native.css](native.css)：原生材质覆盖与确认弹窗；不另设胶囊布局；缩放手柄内缩到原生圆角可命中的区域。磨砂与液态均使用透明网页前景，玻璃效果交给系统；共享 materials.css 为原生磨砂保留一层受窗口留白约束的圆角阴影，原生液态不叠加网页阴影。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
