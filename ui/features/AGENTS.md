# ui/features/ — 功能内容

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

四种功能共用内容实现，只消费业务投影和受限操作。任务拖放、建议预览及模型选择属于功能；外层窗口、位置、分栏、主题与交接由 surfaces 管理。任务保存和提醒事项同步保留在 Rust，必须读取或操作 Codex DOM 的逻辑保留在 codex。

- [board/AGENTS.md](board/AGENTS.md)：卡片、组内创建、悬停删除、同步异常处理与跨组拖动。
- [outline/AGENTS.md](outline/AGENTS.md)：大纲列表、编号对齐及定位操作。
- [next/AGENTS.md](next/AGENTS.md)：建议列表、预览与点击规则。
- [model/AGENTS.md](model/AGENTS.md)：模型矩阵、预设和选择操作。
- `content.tsx`：固定四种功能的内容组合与业务命令适配；接收受限传输和可选顶栏操作位置，保持身份校验与确认流程。
- `projected.tsx`：大纲/下一步的 React 投影适配，复用各自 view.js，保留预览及滚动状态；不解析宿主 DOM；名称由容器标签显示，内容区不重复绘制小标题，保留刷新操作。
- `content.css`：大纲、建议与快捷词的共用内容样式、焦点及内容动效；不绘制容器材质。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。
