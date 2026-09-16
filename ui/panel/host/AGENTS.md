# ui/panel/host/ — 宿主适配

> L2 | 父级：[AGENTS.md](../AGENTS.md)

只负责宿主读取和明确的输入意图。context 变化通知入口，各功能自行失效旧结果；不导入 Stepwise、大纲或外壳视图。

成员清单：

- [context.js](context.js)：任务/回答/输入目标识别、上下文与流式状态；集中页面选择器和正文解析。
- [composer.js](composer.js)：输入框操作及发送就绪重试；每次重试核对调用方意图和上下文。
- [host-appearance.js](host-appearance.js)：读取宿主字体、主题、内容边界与执行明确的主题切换。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
