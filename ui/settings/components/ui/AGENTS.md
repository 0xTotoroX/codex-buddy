# components/ui/ — Web 基础控件

> L2 | 父级：[设置页地图](../../AGENTS.md)

基于 shadcn/ui 的 new-york-v4 registry 定制；只提供结构、交互和 Tailwind 样式，不调用业务 API。页面通过 props 传入状态；utils.cn 合并类名，styles.css 映射共享颜色。添加上游组件时通过根目录 components.json 路由到这里。

- [button.tsx](button.tsx)：按钮变体与尺寸；Slot 支持复用子元素。
- [input.tsx](input.tsx)：输入框及输入控件的公共样式。
- [native-select.tsx](native-select.tsx)：保留原生选择语义与事件的下拉框，复用输入样式。
- [card.tsx](card.tsx)：语义 section 卡片和响应式边距。
- [switch.tsx](switch.tsx)：Radix 开关负责键盘与受控状态，Tailwind 负责轨道和滑块。
- [LICENSE](LICENSE)：shadcn/ui 原始 MIT 许可，分发时并入第三方声明。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
