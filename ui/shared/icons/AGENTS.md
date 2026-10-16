# icons/ — 共享图标

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `index.js`：按语义名导出静态 SVG，供外壳、工作台、宿主窄入口与窗口控件使用；bolt 对应公开 Bolt.tsx，用于模型快切 Fast。
- `index.d.ts`：共享 SVG 入口的 TypeScript 类型，供独立功能视图复用。
- `LICENSE`：OpenAI 原始 MIT 许可；分发许可生成器收集本目录。

来源：https://github.com/openai/apps-sdk-ui/tree/0f00143c7a639906f1621fe58e1b6be7b5bea46d/src/components/Icon/svg

仅摘取所用图标，去除 React 包装并转换 SVG 属性名；保留路径、24×24 画布和 currentColor。控制图标统一渲染为 18px、按钮命中区域至少 28px；表情属于状态控件，不套用图标尺寸。没有复制本机官方应用资源。

[PROTOCOL]: 图标变更时同步语义映射与固定来源，保留许可原文。

- `react.tsx`：设置和看板共用的React适配，固定18px，不引入第二套图标。新增语义映射：eye→Eye、eye-off→EyeOff、arrow-up→ArrowUp、arrow-down→ArrowDown、trash→Trash、search→Search、warning→ExclamationMarkCircle；均来自上述固定提交。加载动画复用refresh旋转。

window-expand→ExpandMd、window-restore→CollapseSmall，来自同一固定提交；仅供窗口控件，不改变内容面板专注图标。

sparkles→Sparkles，来自同一固定公开提交，供输入框“优化”按钮使用。

prompt-improve→PencilSparkle，同一固定公开提交；提示词优化采用此笔形图标的无填充描边样式，React stroke属性转换为标准SVG属性；保留sparkles资源供兼容。

bookmark / bookmark-filled / check 分别摘取同一固定提交的 SavedXs / SavedFilledXs / Check，保留原路径；SavedXs 的18px源画布等比规范化到24px，控件统一18px，用于术语浮卡收藏与掌握。

grip 使用同一固定提交的 DotsVertical.tsx 路径，分别平移 −4 / +4 组成双列握柄，保持24px画布和18px显示，用于模型列宽拖动。

catalog 摘取同一固定公开提交的 Grid.tsx，四个空心圆表示模型目录，使用原路径及24px画布，以18px显示。

pencil 摘取同一固定公开提交的 Pencil.tsx，原路径和24px画布，用于模型预设统一编辑模式。
