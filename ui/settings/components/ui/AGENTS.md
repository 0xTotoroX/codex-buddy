# components/ui/ — Web 基础控件

> L2 | 父级：[设置页地图](../../AGENTS.md)

基于 shadcn/ui 的 new-york-v4 registry 定制；只提供结构、交互和 Tailwind 样式，不调用业务 API。页面通过 props 传入状态；utils.cn 合并类名，styles.css 映射共享颜色。添加上游组件时通过根目录 components.json 路由到这里。

- [button.tsx](button.tsx)：按钮变体与尺寸；Slot 支持复用子元素。
- [input.tsx](input.tsx)：输入框及输入控件的公共样式。
- [suggestion-input.tsx](suggestion-input.tsx)：可自由输入的候选框；键盘/指针选择只更新原草稿，Esc 取消、输入法确认不选取，普通失焦沿用调用方保存流程；列表沿用共用菜单样式并在底部空间不足时向上显示。
- [native-select.tsx](native-select.tsx)：保留原生选择语义与事件的下拉框，复用输入样式。settings-controls.css 在支持 base-select 的浏览器中统一弹出菜单、选中态与键盘焦点，不支持时保留原生菜单；不改变 onChange、禁用选项或保存流程。
- [card.tsx](card.tsx)：语义设置分组，沿用共享留白，不重复叠加卡片边框。
- [switch.tsx](switch.tsx)：Radix 开关负责键盘与受控状态，Tailwind 负责轨道和滑块。
- [LICENSE](LICENSE)：shadcn/ui 原始 MIT 许可，分发时并入第三方声明。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

设置页的控件高度、微圆角、灰阶选中底和细焦点线统一由 settings-controls.css 管理；基础组件保留语义及原生/Radix 行为，样式不进入宿主工作台。
