# ui/panel/ — 共享胶囊

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

runtime/lifecycle.js 是组合入口：读取宿主上下文、协调独立的 Stepwise/大纲、驱动外壳与窗口投影。模块依赖无环；向上请求通过固定的 signals 通知入口处理。源码分工维护，esbuild 仍生成一个可重复注入单元。

成员清单：

- [icons/AGENTS.md](icons/AGENTS.md)：公开 OpenAI MIT 图标子集与许可，所有工作台控制共用纯资源。

- [glass/AGENTS.md](glass/AGENTS.md)：正式与开发构建共用的内嵌液态，自有 SVG 实时背景与 B 版 Regular/Clear 液态变体。
- [workbench/AGENTS.md](workbench/AGENTS.md)：真实右侧占位、双面板、独立阅读与弹出接续。
- [core/AGENTS.md](core/AGENTS.md)：外壳视图、几何、交互、效果和 CSS。
- [host/AGENTS.md](host/AGENTS.md)：宿主任务、输入框和外观适配。
- [runtime/AGENTS.md](runtime/AGENTS.md)：分域状态、设置同步、运行协调与投影。
- [popout/AGENTS.md](popout/AGENTS.md)：系统窗口页面与通信。
- [stepwise.js](stepwise.js)：建议整理、生成、最近 32 次结果的运行期内存缓存（校验完整用户问题、回答、聊天及生成配置）及普通/快捷词填入的草稿保护；聊天切换保留缓存，停用或生成配置变化清空，通过 host/composer 写入。
- [outline.js](outline.js)：本地大纲解析、刷新、展示与定位；不依赖 Stepwise。

workbench/association 提供共享聊天关联入口，策略由 host/context 执行；runtime/state 恢复元数据，presentation 同步浮窗并校验命令，业务模块在来源不可用时拒绝操作。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
