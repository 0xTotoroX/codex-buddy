# ui/settings/ — React 配置网页

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

设置包含只读总览，并按大纲、下一步、看板、模型快切、显示与布局、启动与连接分类，Dev 另有开发来源。分类切换隐藏而不卸载内容，保留草稿和阅读位置；窄屏用顶部横向导航。功能设置调用各自后台服务，形式、主题和布局分别写入 features/surfaces/appearance，不在设置页实现业务。模型表单失焦或选项切换自动保存，失败保留草稿；串行队列及 configurationRevision 沿用 use-settings-form。

成员清单：

- [main.tsx](main.tsx)：页面入口、服务状态、分类容器及大纲开关；组合各设置模块，不持有任务或模型业务。
- [settings-overview.tsx](settings-overview.tsx)：将保留的内嵌设置页主信息/摘要布局适配为只读总览；显示已保存的功能归属、承载主题与布局、生成/看板/模型选项，分类可见时读取现有 API，不提供修改、测试或打开功能的控件。
- [settings-outline.tsx](settings-outline.tsx)：总览为首次打开的默认分类，分类导航、浏览器历史、旧锚点兼容、阅读位置保存及 Dev 来源挂载；旧深链接等待异步表单就绪再定位；重新挂载前保留外部注入的 Dev 节点，避免热更新丢失来源入口。
- [settings-controls.tsx](settings-controls.tsx)：共用设置行、功能开关/打开按钮、反馈及自动/手动保存表单；不新增保存服务。
- [next-settings.tsx](next-settings.tsx)：下一步开关、生成方式、生成模型、常用提示词与高级生成限制；模型读取/连接测试仅由显式操作触发。
- [direction-settings.tsx](direction-settings.tsx)：方向来源、方向库及有序位置、Jev 同意与独立凭据，共用模型保存队列。
- [connection-settings.tsx](connection-settings.tsx)：启动策略及本机连接详情；Dev 固定启动时的目标，重连和断开不提交模型表单。
- [use-settings-form.ts](use-settings-form.ts)：模型及两套独立密钥的草稿、修订校验、保存队列及在途编辑合并；导出 SettingsEditor 供展示模块组合。
- [panel-settings.tsx](panel-settings.tsx)：有效旧字段的分区适配；下一步显示/点击行为、容器字号/侧栏宽度/桌面置顶逐项保存。不再编辑旧 dockLayout/popoutLayout、位置或主题。
- [feature-settings.tsx](feature-settings.tsx)：唯一主界面形式、每个功能加入主界面或贴边、四功能布局；与工作台共用 resolveFeatureLayout 读取旧布局，通过 main-layout 校验原快照后保存，未读取配置前禁用操作。
- [surface-settings.tsx](surface-settings.tsx)：组合形式设置，管理四种形式各自主题及贴边屏幕/位置；保留断开屏幕的选择，写入带 revision 校验。
- [model-control-settings.tsx](model-control-settings.tsx)：模型快切开关与打开操作，不持有位置或主题。
- [task-settings.tsx](task-settings.tsx)：看板分组管理、看板/同步独立开关、显式授权、唯一 iCloud 列表及旧同步配置恢复；不修改同步规则。
- [dev-sources.js](dev-sources.js)：Dev 监督进程注入的来源、资源确认及 worktree 切换；新版移入开发分类，旧 worktree 继续使用顶部独立入口，不进入正式页面。
- [api.ts](api.ts)：认证请求、错误和 SSE 状态订阅，共用 ../shared/contracts.ts；普通入口根据认证状态跳转 Dev 统一页。
- [styles.css](styles.css)：Tailwind v4、语义主题、分类导航、设置行和窄屏布局、焦点及减少动效规则；只扫描本目录，不注入宿主。
- [index.html](index.html)：设置网页入口，图标复用 ../icon.png。
- [board.html](board.html)：旧独立看板 HTML 入口，仍挂载 ../surfaces/desktop/legacy-board.tsx 及共用看板内容。
- [feature.html](feature.html)：桌面和贴边通用 HTML 入口。
- [vite.config.ts](vite.config.ts)：React/Tailwind 多入口构建到 target/web，缓存按 worktree 隔离并去重 React；本机代理只处理 /api/ 请求。
- [utils.ts](utils.ts)：合并条件类名与 Tailwind 冲突工具类。
- [components/ui/AGENTS.md](components/ui/AGENTS.md)：本地基础组件，保留上游 MIT 许可。

旧布局与外观字段仍由后台兼容，不提供第二套完整设置界面；旧窗口及 CLI 入口迁移完成后再退出对应兼容逻辑。

[PROTOCOL]: 结构或契约变化时更新本文，并核对父级地图。
