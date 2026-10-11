# ui/settings/ — React 配置网页

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

设置默认简易模式，集中四功能开关、生成时机、主界面位置/材质、眼睛入口和共享生成模型。详细模式分功能与交互、模型与生成、外观与布局、启动与开发四类；窄屏用分类下拉，宽屏用左侧目录。所有表单只挂载一份，模式和分类仅隐藏节点，不重置配置、草稿或折叠状态。展示模式保存在同源localStorage，分类记忆在当前标签页sessionStorage；阅读位置按模式/分类分别暂存。功能与布局请求沿用原服务、修订校验和保存队列。

成员清单：

- [main.tsx](main.tsx)：双模式入口、共享功能开关、唯一任务状态与分类容器，版本位于页面末尾右下角，短页面贴近底部，不覆盖内容；组合各设置模块，不持有任务或模型业务。
- [settings-overview.tsx](settings-overview.tsx)：按承载与功能组织只读总览；显示已保存的功能归属、承载主题与布局、生成配置、看板分组计数及当前/常用模型和预设，字号只显示一位小数，属性链接定位对应设置控件并展开折叠项；分类可见时读取现有 API，不直接修改配置或打开功能。
- [settings-outline.tsx](settings-outline.tsx)：默认简易模式，模式/四分类导航、浏览器历史、旧锚点按字段分流、阅读位置保存及 Dev 来源挂载；支持分类/属性锚点，等待异步表单就绪后展开并聚焦目标；重新挂载前保留外部注入的 Dev 节点，避免热更新丢失来源入口。
- [settings-disclosure.tsx](settings-disclosure.tsx)：原生details的展示强制展开与用户折叠状态接续；在布局阶段暂存/还原DOM开合，不用异步toggle事件覆盖用户状态，不卸载子内容。
- [settings-controls.tsx](settings-controls.tsx)：共用设置行、各功能页顶部的独立开关/打开按钮、反馈及自动/手动保存表单；不新增保存服务。
- [next-settings.tsx](next-settings.tsx)：下一步的方向、常用提示词和点击/显示行为；共享模型配置移入model-settings，不复制表单。
- [model-settings.tsx](model-settings.tsx)：唯一生成模型/凭据表单，简易模式按需展开，详细模式显示协议/环境变量及请求限制；局部模型列表、密钥显示及简单展开状态保留，调用共用SettingsEditor。
- [direction-settings.tsx](direction-settings.tsx)：方向来源、方向库及有序位置、Jev 同意与独立凭据，共用模型保存队列。
- [connection-settings.tsx](connection-settings.tsx)：启动策略及本机连接详情；Dev 固定启动时的目标，重连和断开不提交模型表单。
- [use-settings-form.ts](use-settings-form.ts)：模型及两套独立密钥的草稿、修订校验、保存队列及在途编辑合并；大纲与下一步开关单独提交，不携带其他字段或密钥草稿；导出 SettingsEditor 供展示模块组合。
- [panel-settings.tsx](panel-settings.tsx)：有效旧字段的分区适配；下一步显示及常用提示词/推荐指令共用的点击行为、四功能独立内容字号（步进 1px，手填保留一位小数）及全部字号重置、侧栏宽度/桌面置顶逐项保存；旧 fontOffset 作为大纲与下一步的兼容回退。不再编辑旧 dockLayout/popoutLayout、位置或主题。
- [feature-settings.tsx](feature-settings.tsx)：唯一主界面形式、每个功能加入主界面或贴边、四功能布局；与工作台共用 resolveFeatureLayout 读取旧布局，嵌套布局显示为自定义分栏、预设重排保留全部叶子功能，通过 main-layout 校验原快照后保存，未读取配置前禁用操作。
- [surface-settings.tsx](surface-settings.tsx)：按功能位置与布局、主题、内容字号、尺寸与窗口、贴边位置分组，仅大组间加分隔线；管理四种形式各自主题及贴边屏幕/位置；保留断开屏幕的选择，写入带 revision 校验。
- [model-control-settings.tsx](model-control-settings.tsx)：模型快切开关与打开操作，聚焦及轮询回读外部变更，写入期间不被旧读取覆盖；不持有位置或主题。
- [task-settings.tsx](task-settings.tsx)：看板分组管理及看板开关；同步授权/列表界面保留源码但不挂载；不修改同步规则。
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

`settings-entry.tsx` 在总览提供“设置按钮打开方式”：插件侧栏或内置浏览器网页，保存 appearance.settingsTarget，使用既有 revision 校验与错误回读；切换选项本身不打开页面。

当前 main 设置固定在 ChatGPT 内置浏览器打开；main.tsx 不再显示目标选择器。settings-entry.tsx 与后端 settingsTarget 兼容字段保留，供插件分支/旧配置使用，不删除用户偏好。

- `launcher-settings.tsx`：简易及外观分类中的眼睛默认单击动作（内/外/设置），保存 appearance.launcherAction 并保留修订冲突校验；不支持桌面浮窗时禁用外选项，切换默认值本身不移动工作台。

所有动作图标通过shared/icons/react读取同一公开SVG目录，统一18px。页面保留桌面16px、窄屏12px额外顶部留白及底部边距。

大纲和模型快切不占独立分类。旧锚点可进入对应详细分类并展开目标；Apple提醒事项继续隐藏。原settings-overview组件保留代码，但不作为当前页面入口。

设置凭据以同源localStorage共享并兼容迁移旧sessionStorage；入口hash令牌优先，读取后移出URL。storage/hashchange/focus触发SSE重连，不卸载表单或重放写入；新地址首次仍须通过眼睛菜单授权入口进入。开发来源请求实时读取共享凭据，不再固定旧令牌。

模式/分类按钮带data-settings-navigation；切换不触发模型表单或字号输入的失焦保存。原“打开功能”动作保留在详细功能分类的折叠操作区，不与每个开关常驻。字号、窗口、功能归属及贴边位置按需展开。

- codex-host-settings.tsx：详细模式“启动与开发”内独立管理区域，分类可见时轮询codex-host API；启停保存独立revision，安装、更新、回退、启动及重启停用均为显式操作。旧settings-codex-host锚点仍可定位，不新增整页。

View.connection.status支持unresponsive：主标题显示页面暂未响应，启动与连接仍保留断开/手动重连操作，不将短暂页面迟缓显示为凭据错误。
