# ui/features/model/ — 模型快切内容

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `view.tsx`：原紧凑推理矩阵、常用/其他模型、列宽、Fast 与预设；显示实际回读状态，通过注入操作提交选择。工具/其他模型展开状态和横向阅读位置随临时状态交接。
- `styles.css`：模型矩阵与控件布局，使用容器提供的语义颜色，不绘制外层窗口或材质。

官方能力和菜单适配在 ui/codex/model.js，串行校验与预设保存保留在 src/model_control.rs；屏幕、边缘、悬停与原生轮廓属于 surfaces/edge。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。
