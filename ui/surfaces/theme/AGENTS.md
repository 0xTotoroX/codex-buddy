# ui/surfaces/theme/ — 主题与材质

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `appearance.ts`：各形式的主题语义色与原材质配方，供隔离功能视图消费；纯黑保持 #000。
- `tokens.css`：胶囊语义颜色、材质参数与外壳变量，基础尺寸来自 ui/shared/tokens.css。
- `materials.css`：哑光、CSS 磨砂和原生材质透明前景；原生液态不重复叠加网页阴影。
- [glass/AGENTS.md](glass/AGENTS.md)：正式/开发构建共用的自有 SVG 凸面透镜与 Regular/Clear 变体。

各承载形式保留独立主题选择。桌面原生材质由 AppKit 合成，网页材质留在本模块；功能内容只消费语义色，不重复绘制容器底色。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。
