# ui/features/outline/ — 大纲内容

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `view.js`：从大纲投影生成列表，处理编号悬挂对齐、条目及首尾定位按钮；以回调交出定位意图。

共享投影视图和旧工作台适配器使用同一实现。聊天解析与实际定位位于 ui/codex/outline.js；标题拖动与临时放大由 workspace 处理。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。
