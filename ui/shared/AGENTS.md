# ui/shared/ — 共用契约与资源

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

- `features.ts`：固定功能、默认字号与旧偏移回退、owner、递归分栏与标签组布局、传输与临时阅读状态类型，closing/disable-ready 用于关闭前捕获。
- `contracts.ts`：设置、字体、上下文、投影和受限命令类型；presentationError 区分保存成功后的窗口失败。
- `constants.js`：注入实例 DOM 标识、尺寸、时间和开发存储键。
- `scroll.js`：功能预览与容器共用的滚动读写，保留隐藏标签和尺寸变化时被浏览器夹紧的阅读意图。
- `text.js`：文本归一化、数值限制与 HTML/属性转义的纯函数。
- `tokens.css`：功能及设置页共用的基础颜色、间距、圆角和控件尺寸变量。
- [bridge/AGENTS.md](bridge/AGENTS.md)：受限 CDP 请求生命周期。
- [icons/AGENTS.md](icons/AGENTS.md)：公开 MIT SVG 子集及许可。

仅放真正跨模块使用的契约与资源；不承担功能呈现、窗口管理或业务保存。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。

features.ts 的 mainManaged 是后台主界面归属投影，不持久化为另一份配置；旧快照可省略。

AppearanceSettings 增加可选 settingsTarget（plugin/web），旧后台缺省按 plugin 展示。

AppearanceSettings.launcherAction 保存独立眼睛的默认动作（inside/outside/settings）；与工作台布局及生成设置分离。

contracts.ts声明宿主inputTarget只读目标和提示词优化verify/destroy生命周期接口；原文不进入持久化配置或窗口投影。

codex-host.ts定义独立后台管理状态和重启进度，不扩展FeatureId或插件注册。contracts声明上游只读Agent探针。

contracts 声明术语实例 verify/refresh/destroy、可选 typography 只读字体快照接口与无正文错误状态；正式词库不放入 shared。

EditableSettings.promptEnhancementEnabled是提示词优化独立开关，历史配置由后台默认true；不归入四功能FeatureId或布局。

features.ts 增加 terms、默认14px字号与术语筛选/选择阅读状态，其他功能身份和保存协议不变。
