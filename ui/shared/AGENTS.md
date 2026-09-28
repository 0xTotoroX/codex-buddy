# ui/shared/ — 共用契约与资源

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

- `features.ts`：固定功能、owner、布局、传输与临时阅读状态类型。
- `contracts.ts`：设置、入口位置、字体、上下文、投影和受限命令类型。
- `constants.js`：注入实例 DOM 标识、尺寸、时间和开发存储键。
- `scroll.js`：功能预览与容器共用的滚动读写，保留隐藏标签和尺寸变化时被浏览器夹紧的阅读意图。
- `text.js`：文本归一化、数值限制与 HTML/属性转义的纯函数。
- `tokens.css`：功能及设置页共用的基础颜色、间距、圆角和控件尺寸变量。
- [bridge/AGENTS.md](bridge/AGENTS.md)：受限 CDP 请求生命周期。
- [icons/AGENTS.md](icons/AGENTS.md)：公开 MIT SVG 子集及许可。

仅放真正跨模块使用的契约与资源；不承担功能呈现、窗口管理或业务保存。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。
