# ui/board/ — 独立任务看板

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

从 ui/settings/board.html 构建独立页面，复用本机 API 认证但不依赖设置视图或宿主聊天。三组拖拽与阶段选择操作等价；完成与本地归档汇总在第三组，归档卡片通过详情取消归档；旧 waiting 显示为待办且不改原值。

- [api.ts](api.ts)：任务类型、字段格式与可注入认证客户端（默认客户端延迟导入，不读取宿主令牌）；本地编辑串行，旧响应不得覆盖新状态。
- [main.tsx](main.tsx)：独立页面入口，注入本机认证客户端。
- [app.tsx](app.tsx)：与承载形式无关的待办/进行中/完成归档和搜索；以 680px 容器宽度选择三列或看板/处理中/归档标签，接续内存阅读状态。
- [embed.tsx](embed.tsx)：Shadow DOM 挂载、样式隔离与 React root 卸载；由工作台注入受限任务传输。
- [card.tsx](card.tsx)：Pragmatic Drag and Drop 卡片/列、完成按钮及可键盘访问的移动选择；列内顺序只存本地。
- [editor.tsx](editor.tsx)：任务编辑、字段冲突对比、恢复与本地归档；日常只编辑标题、备注、阶段，旧日期/优先级保留；失败保留编辑草稿，同一任务原快照变化拒绝覆盖，无关修订可刷新后重试。
- [styles.css](styles.css)：独立页面的响应式多列、原生字体、米白与墨色的极简明暗主题及高对比、焦点和减少动态效果。

[PROTOCOL]: 文件或职责变化时同步本文与父级地图。

BoardView 增加原任务快照、revision、草稿字段及暂停编辑状态；Editor 的“保留草稿并返回”允许迁移前退出模态层。locked 在交接时禁用真实输入（包括可逃逸祖先 inert 的 modal）；移动不保存任务，expectedTask 仍校验原快照。
