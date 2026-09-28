# ui/features/ — 固定功能视图

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

大纲、下一步、看板、模型快切只消费既有业务投影和受限命令。宿主、桌面与贴边挂载同一视图，不启动额外生成或同步循环；Shadow DOM 隔离宿主样式。每功能一个活动 owner；来源冻结并保存临时状态，目标准备就绪后接管。

- `types.ts`：固定功能名称、位置、归属与临时阅读契约。
- `mount.tsx`：Shadow DOM/React 挂载、目标 ready 与销毁。
- `view.tsx`：业务内容、大纲/建议投影、身份校验命令、草稿确认与内存阅读交接。
- `model.tsx`：复用原紧凑推理矩阵、常用/其他分组、列宽、Fast 和预设；只显示实际回读配置。
- `styles.css`：宿主语义色与窄宽度内容布局，不自带第二层材质或位置选择器。
- `main.ts`：认证入口，按 surface 路由桌面或共享贴边挂载。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

- `edge.ts`：共享贴边标签、原生几何/首帧确认与悬停、保持挂载的收放生命周期。
- `edge.css`：稳定原生视口内的最小标签壳，不参与原生轮廓缩放。
- `surface.ts`：所有形式共用的主题语义色与原材质配方，纯黑保留 #000。

- `desktop.js` / `desktop.d.ts`：复用原工作台头部、原样式和原生窗口 IPC；shown/presented 后提交 owner，回程完成后交出草稿；失败调用原生 cancel-return 与服务 cancel-move，恢复来源并允许重试。

功能视图不绘制外壳或位置选择器；宿主由原 geometry 收放，桌面通过原 panel_window 动效，贴边通过既有原生遮罩。mount 的可选 motion 适配 ready/handoff 时机，不改变业务请求。
