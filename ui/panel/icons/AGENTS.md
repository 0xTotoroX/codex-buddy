# icons/ — 共享图标

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `index.js`：按语义名导出静态 SVG，供外壳、工作台、宿主窄入口与窗口控件使用；bolt 对应公开 Bolt.tsx，用于模型快切 Fast。
- `LICENSE`：OpenAI 原始 MIT 许可；分发许可生成器收集本目录。

来源：https://github.com/openai/apps-sdk-ui/tree/0f00143c7a639906f1621fe58e1b6be7b5bea46d/src/components/Icon/svg

仅摘取所用图标，去除 React 包装并转换 SVG 属性名；保留路径、24×24 画布和 currentColor。控制图标统一渲染为 18px、按钮命中区域至少 28px；表情属于状态控件，不套用图标尺寸。没有复制本机官方应用资源。

[PROTOCOL]: 图标变更时同步语义映射与固定来源，保留许可原文。
