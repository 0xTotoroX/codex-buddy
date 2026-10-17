# ui/settings/ — React 配置网页

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

设置统一使用功能、生成、界面、系统四组及12个独立子页（开发来源仅开发版可见），不提供简易/详细切换；760px及以下在头部下方显示分组行和当前分组子页行，自然换行，宽屏保持左侧目录。所有表单只挂载一份，分类仅隐藏节点，不重置配置或草稿；关闭抽屉保留内部滚动位置。分类记忆保存在当前标签页 sessionStorage，兼容旧分类键；旧模式值忽略且不清除，旧简易/总览链接进入常用开关。阅读位置按子页暂存，功能与布局请求沿用原服务、修订校验和保存队列。

成员清单：

- [main.tsx](main.tsx)：Tom Modern 统一入口、共享功能开关、唯一任务状态与分类容器；组合现有模块及其只读预览快照，表单保持单份挂载；常规配置直接显示，头部与导航按760px断点布局：窄屏紧凑头部下方横排分类，宽屏左侧纵排目录；共用单份导航与表单；功能开关旁不重复提供打开按钮；版本位于页面末尾，不覆盖内容，不持有任务或模型业务。
- [settings-overview.tsx](settings-overview.tsx)：按承载与功能组织只读总览；显示已保存的功能归属、承载主题与布局、生成配置、看板分组计数及当前/常用模型和预设，字号只显示一位小数，属性链接定位对应设置控件并展开折叠项；分类可见时读取现有 API，不直接修改配置或打开功能。
- [settings-outline.tsx](settings-outline.tsx)：统一分组及子页导航、浏览器历史、旧锚点按字段分流、阅读位置保存及 Dev 来源挂载；支持分类/属性锚点，等待异步表单就绪后展开并聚焦目标；重新挂载前保留外部注入的 Dev 节点，避免热更新丢失来源入口。
- [settings-disclosure.tsx](settings-disclosure.tsx)：保留的原生details展示兼容组件，当前常规配置已改为直接显示；支持强制展开与用户折叠状态接续；在布局阶段暂存/还原DOM开合，不用异步toggle事件覆盖用户状态，不卸载子内容。
- [settings-controls.tsx](settings-controls.tsx)：共用设置行、功能开关、反馈及自动/手动保存表单；手动保存沿用原队列，原位显示等待/成功，失败与在途新编辑不误报成功，不新增保存服务。
- [next-settings.tsx](next-settings.tsx)：下一步的方向和点击/显示行为、独立常用提示词页；按 section 隐藏原节点保留草稿；共享模型配置移入model-settings，不复制表单。
- [model-settings.tsx](model-settings.tsx)：唯一生成模型/凭据表单，直接显示常规参数及协议；环境变量名与高级生成参数统一在“高级设置”抽屉中编辑；局部模型列表、密钥显示与草稿保留，调用共用SettingsEditor。模型候选使用共用 SuggestionInput，箭头/方向键主动读取已保存连接的列表，展开显示全部候选、输入过滤；读取失败或空列表仍可手填。未保存连接不读旧候选，修订号及请求序号隔离迟到结果；展开不提交草稿，保留原失焦保存。连接测试的保存中/等待耗时/成功/失败结果直接显示在按钮下方，不依赖页顶通知；保存失败不测试旧配置，编辑或修订变化清除旧结果，在途配置变更不显示为当前连接成功。
- [model-credentials.tsx](model-credentials.tsx)：已存 API 密钥显示配置状态与更换入口，不回读原值；新草稿非空才提供眼睛，取消保留旧密钥。删除仅在高级连接设置显示，原生 dialog 默认聚焦取消，确认后走独立清除补丁；失败保留状态，确认修订过期时拒绝删除。
- [direction-settings.tsx](direction-settings.tsx)：方向来源、方向库及有序位置、Jev 同意与独立凭据，共用模型保存队列。
- [connection-settings.tsx](connection-settings.tsx)：启动策略及本机连接详情；Dev 固定启动时的目标，重连和断开不提交模型表单。
- [use-settings-form.ts](use-settings-form.ts)：模型及两套独立密钥的草稿、修订校验、保存队列及在途编辑合并；大纲与下一步开关单独提交，不携带其他字段或密钥草稿；删除 API 密钥复用串行队列，仅发送 clearApiKey 与修订号，不携带其他草稿或将删除意图留在自动保存中；导出 SettingsEditor 供展示模块组合。
- [panel-settings.tsx](panel-settings.tsx)：有效旧字段的分区适配；下一步显示及常用提示词/推荐指令共用的点击行为、统一字体跟随来源、相对比例及自定义字号、侧栏宽度/桌面置顶逐项保存；旧 fontOffset 作为大纲与下一步的兼容回退。不再编辑旧 dockLayout/popoutLayout、位置或主题。
- [feature-settings.tsx](feature-settings.tsx)：唯一主界面形式、每个功能加入主界面或贴边、四功能布局；与工作台共用 resolveFeatureLayout 读取旧布局，嵌套布局显示为自定义分栏、预设重排保留全部叶子功能，通过 main-layout 校验原快照后保存，未读取配置前禁用操作。
- [surface-settings.tsx](surface-settings.tsx)：功能位置与布局、主题、字体、尺寸与窗口、贴边位置直接分组显示；管理四种形式各自主题及贴边屏幕/位置；屏幕可显式跟随 Codex，保留自动选择与固定屏幕及断开屏幕的选择，写入带 revision 校验。
- [model-control-settings.tsx](model-control-settings.tsx)：模型快切开关、分类状态与串行修订保存，聚焦及轮询回读外部变更，写入期间不被旧读取覆盖；冲突重新读取但不自动重放，失败保留编辑草稿；不持有位置或主题。
- `model-organization.tsx`：通过右侧“模型分组”抽屉管理；批量纠正厂家/移动/恢复自动、自定义组增删改名及组内/组间排序。厂家候选使用共用 SuggestionInput，仍可自填并显式应用。暂不可用模型保留配置，同名模型显示完整 ID 以区分渠道；不改常用与预设。
- [task-settings.tsx](task-settings.tsx)：直接显示看板分组，使用保存/新增图标及明确无障碍名称；同步授权/列表界面保留源码但不挂载；不修改同步规则。
- [dev-sources.js](dev-sources.js)：Dev 监督进程注入的来源、资源确认及 worktree 切换；新版移入开发分类，旧 worktree 继续使用顶部独立入口，不进入正式页面。
- [api.ts](api.ts)：认证请求、错误和 SSE 状态订阅，共用 ../shared/contracts.ts；普通入口根据认证状态跳转 Dev 统一页。
- [styles.css](styles.css)：Tailwind v4、语义主题映射、搜索和保留的旧总览样式；只扫描本目录，不注入宿主。
- [settings-layout.css](settings-layout.css)：Tom Modern 设置专属色值、分组导航、表单与深浅/窄屏适配；继续跟随统一字体，不修改共享工作台主题。主布局和表单节奏的唯一样式入口；760px及以下使用紧凑版，761px起保留宽屏左侧目录、1440px内容上限。两套主题均取消背景网格、页头/列表/预览内的重复线条，普通选择器使用灰阶底面与字重，页头主题为单一入口和轻量选项浮层，仅标题层级保留 Tom Modern 字重和朱橙点缀：页面标题、分区/预览/抽屉标题及当前导航项；表单底色、预览边界、软阴影、列宽、留白与中性控件恢复视觉改版前样式。控件4px微圆角，开关保留6px轨道/4px滑块及原尺寸动效；字体继续跟随已保存偏好。
- [settings-controls.css](settings-controls.css)：按钮、输入框、选择器、开关的统一高度、微圆角、中性焦点与禁用态；支持 base-select 时定制原生菜单和选项，原生键盘、点击、取消、禁用及 change 事件不变，不支持时保留系统菜单。自由输入候选和搜索弹层沿用同一菜单样式。Dev 来源因 Shadow DOM 隔离，在 dev-sources.js 内以同一语义变量适配，不依赖新版源码文件。
- [settings-preview.tsx](settings-preview.tsx)：只读联动预览。复用既有模块回读的功能、材质、模型和看板快照；嵌套布局复用 resolveFeatureLayout，过滤关闭功能。生成参数显示当前草稿并标识未保存；主形式与材质只显示成功保存的值。示例操作只改变本组件状态，不请求 API、不读任务正文或凭据。
- [settings-preview.css](settings-preview.css)：预览画布、功能示例、生成路径和连接示意的样式，材质为近似效果，不用于实际业务视图。
- [settings-list-motion.ts](settings-list-motion.ts)：配置列表增删/排序的200ms补位和新项4px淡入；以稳定ID测量相对位置，提示词没有持久ID时使用仅在界面保留的身份，兼容重复内容、后台整表回读与删除确认；不改变布局、保存时机或数据结构。
- [settings-motion.ts](settings-motion.ts)：分类入场、预览位置/分栏变化与功能预览200ms交叉淡入淡出的可中断动画，读取输入方式以保持键盘即时响应，尊重动态减少效果偏好；ResizeObserver 同步顶栏真实高度至目录/预览粘性偏移，不重新挂载控件、不存储配置。
- [settings-motion.css](settings-motion.css)：主题颜色、按钮反馈、搜索/候选/原生菜单入场和原生 details 展开/收起；不支持插值的浏览器保留原生即时行为。键盘和减少动态效果不等待装饰动画，候选菜单不受折叠裁切。
- [settings-theme.tsx](settings-theme.tsx)：页头单一主题入口，展开后保留“跟随 Codex”及浅色/深色选项；方向键/Home/End 切换焦点，Esc 关闭回到入口，外点或移出焦点关闭；默认跟随认证 SSE 的 panelTheme，无有效快照时保留本页末次主题，尚未收到时回退系统。选择在同源 localStorage 记忆并跨标签页同步，受限存储仍允许当前页切换；不写宿主或业务配置、不触发表单失焦保存。settings-layout.css 统一语义色，品牌图标保持原图，动作图标沿用 currentColor。
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

- `launcher-settings.tsx`：外观与字体分类中的眼睛默认单击动作（内/外/设置），保存 appearance.launcherAction 并保留修订冲突校验；不支持桌面浮窗时禁用外选项，切换默认值本身不移动工作台。

所有动作图标通过shared/icons/react读取同一公开SVG目录，统一18px。页面保留桌面16px、窄屏12px额外顶部留白及底部边距。

大纲保留在常用开关；下一步、常用提示词、术语释义、任务看板和模型快切各有独立子页。旧锚点可进入对应详细分类并展开目标；Apple提醒事项继续隐藏。原settings-overview组件保留代码，但不作为当前页面入口。

设置凭据以同源localStorage共享并兼容迁移旧sessionStorage；入口hash令牌优先，读取后移出URL。storage/hashchange/focus触发SSE重连，不卸载表单或重放写入；新地址首次仍须通过眼睛菜单授权入口进入。开发来源请求实时读取共享凭据，不再固定旧令牌。

分类按钮带data-settings-navigation；切换不触发模型表单或字号输入的失焦保存。常规模型、各形式材质、字体、窗口、功能位置、看板分组及术语识别/词库直接显示。高级设置、Jev 高级设置、模型分组、词库管理及程序路径统一使用右侧抽屉，内部不嵌套折叠；手动/智能模式的方向库直接显示；Dev 来源属于高级开发配置。小字去掉装饰和重复描述，保留发送/重开后果、数据使用、环境覆盖、失败和必要状态。

- codex-host-settings.tsx：详细模式“系统 → 宿主管理”独立页面，分类可见时轮询codex-host API；启停保存独立revision，安装、更新、回退、启动及重启停用均为显式操作。旧settings-codex-host锚点保持有效。

View.connection.status支持unresponsive：主标题显示页面暂未响应，启动与连接仍保留断开/手动重连操作，不将短暂页面迟缓显示为凭据错误。

- `terminology-settings.tsx`：详细“功能 → 术语释义”中直接显示标注开关、上下文词义核对/联网选项、贴字浮层预览及五类背景材质、词库检索与掌握/恢复图标；添加自定义术语与导入导出合并到“词库管理”。失败时保留输入，材质与液态变体/自定义背景持久化。

settings-search.tsx在页头提供本地设置搜索：从唯一挂载的标签/标题索引分类和控件ID，Enter/点击通过settings-outline导航到详细分类并打开所属抽屉、定位字段（兼容旧details）；搜索本身不提交表单，也不索引输入值、密钥或聊天。main以data-settings-page标记归属，锚点字段支持URL解码。提示词优化开关共用SettingsEditor独立控制补丁，避免提交其他未保存凭据。

Cmd/Ctrl+K 聚焦搜索，模态抽屉开启时保留抽屉焦点；搜索仍属于不触发失焦保存的导航区域。设置搜索的 Enter 操作根据当前输入与已挂载控件即时重新匹配，避免快速输入早于异步索引时失效；输入法组合期间不提交，仍只索引标签而不读取配置值。

术语设置去掉重复的“打开”动作，保留收藏筛选；移除阅读批注候选，旧 note 偏好读取为 plain。

`typography-settings.tsx` 是字体唯一设置入口，复用 PanelSettings 外观 revision 保存，数字草稿跨分类保留；`use-typography.ts` 通过认证 SSE 接收字体快照，更新自有文档字体和 rem 基准。设置文字层级按同一基准缩放，颜色由 settings-theme 独立管理。旧分功能字号表单由统一跟随/自定义控件替换，旧值不删除。

术语设置提供“点击术语时跳转到上下文”开关，默认关闭；通过原 terminology settings/revision 通道持久保存 jumpOnClick，失败保留原值。

功能预览四个示例共用同一网格，以最高内容维持外框高度；非当前示例 inert/aria-hidden，不接受输入。切换保留示例草稿，旧内容淡出、新内容由下方4px进入；键盘或减少动态效果立即切换并取消在途动画。测试连接、模型读取/刷新和手动保存使用统一160ms动作图标，成功仅依据请求结果，勾号短暂保留后恢复；按钮文字预留各状态宽度，不新增依赖。

- `settings-confirmation.tsx`：设置页共用确认弹窗与按钮，默认聚焦取消，Esc/取消不执行动作，在途禁止重复提交/关闭，失败原位反馈，修订变化拒绝旧确认；不读写业务配置。
- 危险操作统一确认：API/Jev 密钥删除、方向/提示词删除、模型分组删除与恢复自动分类、强制重开策略、断开连接、CodexHost 重启停用/版本恢复、丢弃草稿重新载入及词库导入。普通开关、排序、移除可重新选择的方向位置及掌握/恢复提示保持直接操作。
- `model-credentials.tsx` 共用 API/Jev 已配置/更换/取消控件，空输入隐藏眼睛；密钥删除仅由带修订校验的独立补丁执行。`use-settings-form.ts` 的方向/提示词删除也只在成功后更新对应草稿，失败不留待自动保存的删除标记，不连带提交其他配置或新密钥。
- 模型的高级连接与生成限制合并为一个“高级设置”；保留原字段/锚点。连接端口直接显示，Dev 仍只读。Jev 常用配置直接显示、删除藏在高级设置；词库导入说明同编号覆盖，批次失败显示已完成数量，不假报全部成功。

模型来源切换时仅对现有相关字段做180ms/4px同步淡入，不加包装层、延迟或重置输入；首次载入、打字和普通回读不重播。列表与字段沿用settings-ease；键盘和减少动态效果即时完成并取消在途动画。列表覆盖常用提示词、方向位置/库、看板分组及模型分组/组内模型，删除仍按既有确认与保存结果生效。

确认弹窗内控件自身失焦不触发自动保存（含处理中禁用和删除后卸载），普通输入的失焦/选择保存与串行队列保持原样，避免删除成功后旧快照被再次提交。

- `settings-drawer.tsx`：共用原生 dialog 右侧抽屉，保留原 DOM/表单归属、草稿和内部滚动；关闭、Esc、背景点击及分类切换不增加保存。搜索/旧锚点可打开目标，重复定位仍有效；关闭按钮与标题不进入搜索索引。窄屏占满宽度，键盘/减少动态效果即时完成，嵌套危险操作确认仍单独取消。
- 抽屉中的保存状态/失败反馈读取既有 SettingsEditor；手动保存继续提交原 SettingsForm，同一串行队列与修订保护不变。模型分组和词库复用原操作反馈；模型/密钥/词库数据不迁移。样式归 settings-controls.css，常用配置仍直接显示。

两级设置导航：settings-outline.tsx 集中维护四组/子页和旧锚点映射；桌面分组始终显示，窄屏分组按钮切换同一份子页链接，不使用展开菜单。main.tsx、next-settings.tsx、surface-settings.tsx 和 panel-settings.tsx 只隐藏原节点：下一步/提示词、布局/外观各分开，表单与草稿不重复创建。搜索索引补充页面及按需加载的词库入口，字段按最近 data-settings-page 定位；手动保存遇到隐藏的无效字段会切到所属页/抽屉并显示原生校验。预览按当前功能选取场景，术语/宿主管理/开发来源不挂无关预览。

设置模式合并：main.tsx 不再渲染模式入口或简易聚合表单；settings-outline 不读写模式偏好，仅维护分组子页、历史和逐页滚动；settings-preview 按子页选择预览。settings-layout.css 移除模式专用样式，保留原两级导航、主题与表单节奏。

页面大标题与内容区同名时只显示页面标题：生成模型、术语释义、常用提示词和开发来源不重复显示同名小标题；保留原节点/锚点及可访问名称。下一步交互、看板分组、各形式外观等有区分作用的标题保留，不改变分组顺序或其他样式。
