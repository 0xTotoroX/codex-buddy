# tests/ — 自动测试与验收

> L2 | 父级：[AGENTS.md](../AGENTS.md)

集中维护契约、端到端、生命周期与原生验收，以及测试辅助和合成数据。Node 测试检查模块边界与审计器，许可集成测试读取 Cargo 元数据和已安装 npm 依赖；HTML fixture 供独立浏览器验收。需要二进制的测试通过 scripts/verify.mjs 准备与源码匹配的产物。运行数据仅写临时目录或 `target/reports/`。

窗口交接回归：popout-checks 区分 ready / presented，检查隐藏面板的有效回程坐标、胶囊出发的慢双击和收回状态还原、阅读接续、过期内容拒绝、快速反向切换和减少动态效果；native-check 通过 native-probe 采样指定测试进程主窗口的实际位置/尺寸/透明度，验证呈现确认、首个可见帧的来源尺寸和连续展开中间帧、三材质返回取消与退出，追加 --cross-screen 使用实际连接的第二块屏幕，--reverse-screens 交换起终屏幕，检查首帧和终点的屏幕坐标；采样本身无需截图。测试数值不能代替真实宿主的视觉体验验收。

模型业务用合成宿主验能力、唯一目标、完整回读与旧请求拒绝，不读取真实聊天或调用模型。feature-views 验共享视图草稿与模型控件，features-e2e 验真实 owner 交接；edge-native 复用几何/焦点/材质/首帧门控验收。原生事件权限或物理刘海缺失时明确记录跳过。

成员清单：

- [dev-sources.test.mjs](dev-sources.test.mjs)：Git 清单/共享偏好、路径限制、跨目标互斥、异常退出恢复、并发抢占、孤儿后台保护、并发切换/失败回退与认证开发 API 回归。
- [dev-sources-integration.test.mjs](dev-sources-integration.test.mjs)：完整监督脚本、真实 Vite/浏览器、临时双 worktree 的进程级交接/回退、热更新、稳定设置地址、旧标签页写保护与重开恢复及失效 controller/target 租约启动；全部使用合成宿主。 覆盖完整 React 设置表单与来源选择器同页渲染、切换后继续可用，以及缺失/过期凭据提示；不剥离主页面模块。
- [dev-source-fixture.mjs](dev-source-fixture.mjs)：上项测试的可控编译器和单实例后台夹具，不连接用户应用。


- [model-control-host.mjs](model-control-host.mjs)：官方能力响应关联、唯一输入目标、引用身份隔离、新旧菜单/内联/隐藏视图、菜单打开占位文字/速度可访问标签/高级视图返回、推理滑块、锁定选项、重复失败清理与完整回读、单次菜单事务、生成期间调整与官方禁用、迟到/部分失败及清理的合成宿主回归。
- [feature-views.mjs](feature-views.mjs)：真实通用页面的贴边收起/标签草稿保留、模型回读、常用和预设增删、原桌面头部、共享标签草稿、Shadow DOM 内真实鼠标拖放、原生唤起、纯黑切回宿主色及返回失败恢复/重试的浏览器验收。
- [model-control-fixture.mjs](model-control-fixture.mjs)：共享的合成官方模型菜单与能力响应宿主。
- [model-control-e2e.mjs](model-control-e2e.mjs)：真实 Rust HTTP/CDP 到合成官方菜单的链路、鉴权、完整回读、旧目标拒绝及设置页四形式主题隔离/持久化及贴边位置保存及私有末次诊断验收。
- [edge-native.mjs](edge-native.mjs)：共享 NSPanel 的稳定视口、原生轮廓/材质、scene-ready 首帧、焦点、悬停、定位、租约退出；合成后端，不操作官方宿主；默认不截图，只有明确需要截图时才传 --screenshots，截图失败后本轮不再重试。
- [model-control-probe.swift](model-control-probe.swift)：仅操作指定合成原生面板的窗口、焦点和鼠标验收探针。

- [startup-settings.test.mjs](startup-settings.test.mjs)：实际 React 启动选项默认值、强退提示、完整/限长上下文切换、失焦/选择自动保存、串行在途编辑、失败重试/冲突保护、快捷词及三种方向配置/位置排序/自定义积木/Jev 同意与密钥编辑、无效草稿及在途失败不阻止停用/撤回同意、页面重载恢复；合成本机 API，不退出真实宿主。

- [dev-launcher.test.mjs](dev-launcher.test.mjs)：开发 App 后台启动/日志/进程存续/正常退出及身份保护、启动策略参数传递、重复唤起、原目标重连、失败边界、失效记录交由监督进程恢复、早期具体错误透传、其他会话保护及 shell 转义；执行 AppleScript 夹具覆盖前台拒绝、超时、异常及通知不可用时正常返回，真实启动失败仍弹错误；设置 CODEX_BUDDY_NATIVE_LAUNCHER_TEST=1 显式验收合成原生窗口的 Dock 策略与焦点交接，不在普通回归中抢焦点。

- [bridge-requests.test.mjs](bridge-requests.test.mjs)：弹出请求失联后的超时释放、重试与迟到响应隔离，保留模型请求的长超时。

- [dock-appearance.test.mjs](dock-appearance.test.mjs)：停靠场景默认外观、独立本地偏好与星星选中表现，覆盖共享窗口偏好不受污染。

- [workbench-layout.test.mjs](workbench-layout.test.mjs)：纯布局决策、统一编排命令、无效落点、双向最低尺寸、滞回和旧偏好迁移。

- [workbench-binding.mjs](workbench-binding.mjs)：由 workbench.mjs 执行的关联回归，覆盖快捷词即时同步、旧命令拒绝与草稿保护，手动/自动 A-B-A 建议缓存恢复、重新挂载后安全填入、回答/生成设置失效，以及同目标保留、换目标迟到结果、兄弟输入框隔离、身份替换/失联/重挂载、窗口命令及冷初始化；只使用合成响应。

- [workbench.mjs](workbench.mjs)：工作台浏览器行为验收；自动/双轴布局、交换/重置、连续缩放及生成中切换不增加请求、独立持久化和嵌套滚动接续；真实占位、前景聊天迁移及输入目标、非模态注释浮层的编辑/删除与鼠标往返不改变停靠、模态让位与阅读恢复、两栏独立渲染、键盘调整、空间不足、功能开关、宿主重绘和销毁恢复。连续流程以延迟的合成响应验证聊天切换、过期结果、生成次数及双端阅读交接，不调用模型；`WORKBENCH_CASE` 可按名称片段只运行相关用例，结果单独写入 `selected-results.json`。

- [panel-settings.test.mjs](panel-settings.test.mjs)：隔离浏览器中的实际 React 设置控件回归，验证工作台偏好逐字段保存、数值范围及胶囊尺寸、主题和功能开关隔离。

- [embedded-glass.mjs](embedded-glass.mjs)：真实 Chromium 中用固定高对比背景验证正式构建的 SVG 背景像素、实时更新、B 版 Regular/Clear 液态变体与原生变体隔离、清理及正式构建集成；系统合成器允许透明时要求可见像素差，CI 主机启用“减少透明度”时核对不同效果契约，产品回退由 e2e 单独覆盖；独立命令 test:glass，不读取真实聊天。

- [e2e.mjs](e2e.mjs)：端到端测试入口；设置总览覆盖只读、保存值与草稿区分、分类切换后更新及宽窄/明暗布局，验证三种协议下超过旧桥接大小限制的完整中文/emoji 问答与显式限长与完整性标记；--popout-only 单独运行窗口协议、外观及交接回归，报告写入 target/reports/popout；按实际系统版本核对弹出能力并验证 Web 与内嵌偏好双向同步；macOS 14 只跑内嵌并确认弹出入口禁用，macOS 15+ 委托 popout-checks 验证窗口协议及外观同步；正式内嵌液态覆盖 SVG、浏览器不支持及“减少透明度”回退；同时验证表情单击 100ms 延迟、双击取消或中断收放并切换窗口、拖动不误触及左右固定对角缩放；报告写入 target/reports/e2e。
- [popout-checks.mjs](popout-checks.mjs)：端到端测试的弹出窗口子流程；检查快捷词只填入不发送及草稿保护、三材质单入口与双向保存、投影、宿主强调色动态同步及回退、收回、受限操作、隐藏像素、表面偏色、哑光/磨砂的单层圆角浅阴影，以及宿主 reset 有无变化时的公共几何、内边距和字体。
- [lifecycle-test.mjs](lifecycle-test.mjs)：进程生命周期测试入口，不使用真实聊天数据；验证启动器在不支持浮窗时保留内嵌、其他错误仍提示，以及旧默认目录迁移、安装、服务复用、升级、回滚和模型请求取消；报告写入 target/reports/lifecycle.json。 正式程序冷启动覆盖旧胶囊配置、工作台开合意图与独立宽度/比例。
- [native-check.mjs](native-check.mjs)：macOS 原生背景验收；--header-only 仅验证三材质透明头部与真实置顶开关层级、偏好保存和退出，写入 native-header，不发送鼠标事件；--genie-only 额外启用开发版私有网格，在哑光、磨砂和液态 Regular/Clear 中确认接口实际成功、形变完成后复位及收回取消，结果写入 target/reports/native-genie，追加 --chip-anchor 验证 84×36 胶囊锚点并写入 native-genie-chip；--motion-only 免截图单测提起、三材质回程取消、不同高度与中间偏好隔离，报告写入 target/reports/native-motion；验证闲置后的投影持续更新、窗口/WebView 与宿主主题一致及语义色同步、明暗材质与展开尺寸；`--workbench-only` 免截图检查原生工作台双轴布局、交换/重置与双面板、设置返回、独立滚动及三材质缩放，使用系统鼠标事件验证面板拖拽合并/专注/拆分且原生窗口不移动；默认走免截图的 appearance-only，只有显式 --screenshots 才运行像素采样；`--appearance-only` 可免截图检查主题、材质能力、通过公共头部进入设置并切换三材质后的 传统磨砂 HUDWindow/Active 状态/液态星星的 Regular/Clear 切换和拒绝收起及 AppKit 回读、跨材质保持展开与原生尺寸同步；同时验证 WebKit 的共同标题栏与盒模型，不证明原生折射像素。
- [native-backdrop.test.mjs](native-backdrop.test.mjs)：暂停动画帧时仍发送原生材质与收放状态通知，背景按宿主明暗设置自有窗口；不提供系统切换 IPC，且不重复发送未变状态；并发尺寸请求保留最后展开尺寸；旧样式迁入新材质后不覆盖后续选择。

- [dev-host.test.mjs](dev-host.test.mjs)：真实目标筛选、安装版连接恢复与配置/存储隔离；覆盖开发配置优先与首次继承日常策略、Dev 无连接准备/取消/复用及显式目标保护、无宿主启动不触发旧恢复、错误透传和失效旧目标保留归档；只使用合成本机服务。
- [dev-proxy.test.mjs](dev-proxy.test.mjs)：真实 Vite/开发网关的本机来源、鉴权、前端 api.ts 路由及后台重启后的会话稳定性；子进程捕获端点与取消错误；旧示例/模型入口返回 404；冷缓存请求后能退出，慢模型请求不被截断，客户端离开取消代理。
- [dev-panel.test.mjs](dev-panel.test.mjs)：隔离源码副本验证 CSS/逻辑版本分离，以及构建失败不覆盖最后可用快照。
- [fixtures.mjs](fixtures.mjs)：符合共享设置/字体契约的合成投影数据。

- [panel-modules.test.mjs](panel-modules.test.mjs)：对既有胶囊检查范围及共用内容模块执行 checkJs，检查依赖无环、Codex context 与大纲/下一步保持依赖边界；窗口入口及独立传输仍由各自检查覆盖。
- [native-probe.swift](native-probe.swift)：原生验收的合成背景窗口、指定测试进程窗口几何、合成窗口的真实鼠标拖拽及截图颜色读取器，只编译到临时目录。

- [host-fixture.html](host-fixture.html)：e2e 和弹出测试的宿主 fixture，不包含真实聊天；共享胶囊可交互的桌面宿主 DOM。
- [source-audit.test.mjs](source-audit.test.mjs)：公开边界、递归许可与真实依赖声明的行为测试；覆盖嵌套署名、显式路径、来源补充和原文引用，以及无 Git 源码清单和私有文件/符号链接拒绝。

- [popout-preferences.test.mjs](popout-preferences.test.mjs)：位置写入延迟时并发置顶/外观串行推进修订号，真实外部冲突仍拒绝。
- [workbench-actions.mjs](workbench-actions.mjs)：端到端检查通过标题/标签双击或 Esc 选择内容；showRetainedSettings 显式调用隐藏旧入口，仅供保留模板的兼容回归，不代表产品入口。

workbench 用例覆盖三材质、标签/分栏/专注、旧 capsule 偏好弹出时公共表情与明确收回入口，以及紧凑双击的出发状态。窄入口覆盖空间不足的可见解释、明确替代展开与取消；侧栏宽度排除文件侧栏并保持保存偏好，来源文字与关联菜单均隐藏。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

工作台回归覆盖精简后可见按钮数量、标题单击/双击/键盘放大恢复、窗口往返文案、头部中轴/图标尺寸、显式设置选择与文字对齐、单击收起/重新停靠和简化窄入口；外观测试依据轮廓/实心 SVG 几何区别验证 Clear 状态，不依赖 stroke/fill 的绘制方式。

设置入口回归覆盖停靠、聊天内浮动和独立浮窗：鼠标与 Enter 均只请求外部网页，保持面板实例/偏好及阅读位置；旧模板测试明确通过隐藏入口执行，原生兼容检查不点击真实网页启动器。

表情手势回归覆盖三材质的展开表情无底色/边框/光晕、悬停不画胶囊、只显示设置齿轮、桌面单击保持展开、双击与 Alt+Enter 收回；原有慢双击、收放与出发形态恢复继续保留。

弹出头部验证透明无底块的齿轮、唯一置顶按钮及开关回读；原生合成工作台验证保存的置顶值与系统窗口层级同步（置顶→普通→置顶）。

设置页端到端回归覆盖分类导航的宽窄布局、键盘/浏览器历史/旧深链接、草稿与阅读位置保留，以及平台限制；`node tests/e2e.mjs --settings-only` 单独检查生产资源与合成 Rust 服务的连续布局保存，不连接真实聊天或提醒事项。

主题回归覆盖宿主与系统明暗相反时的浮窗和模型快切、纯黑固定配色及其他三材质的收起/展开/选中/悬停/焦点配色；Web 设置保持浏览器主题。

形态边界回归覆盖宿主不支持侧栏时鼠标/键盘展开不改位置、显式替代选择、宿主恢复和运行时重载；菜单销毁与 Escape 取消。popout-preferences 与 Rust panel 单测覆盖收回动画期间外部修改位置的冲突拒绝、最后防抖偏好保存及失败后的窗口保留。

- [board.mjs](board.mjs)：隔离任务服务的认证、组内创建、悬停/聚焦删除、拖拽、归档、重启恢复、修订冲突和双端删除接口拒绝；渲染浅色/深色/窄窗口证据到 target/reports/board，绝不授权或写入真实提醒事项。

- [feature-surfaces.mjs](feature-surfaces.mjs)：由 workbench.mjs 执行的功能/容器试点，验证状态接续、任务唯一性、独立开关、轮询回收、Shadow DOM 键盘及宿主断连后任务编辑；使用合成任务，不访问 EventKit。
- native-check.mjs 的 --features-only 在真实 Wry/AppKit 窗口中验证大纲/看板选择、任务更新及宽窄布局，报告位于 target/reports/native-features；不连接用户聊天或提醒事项。

`independent-features.mjs`：唯一主界面的十轮侧栏/浮层交接、关闭状态与草稿保留、模型回读及无额外业务操作的浏览器回归。`features-e2e.mjs`：真实 Rust/HTTP/CDP 的整组位置、来源草稿确认、旧 owner 拒绝与断连本地编辑；--native 额外验证真实 Wry 自动 ready、共享 PID、恰好一个可见主窗口、返回后旧租约立即回收及往返。

看板简化验收：board.mjs 覆盖组内创建、宽跨列/窄标签真实拖放、分组改名新增与重启保留、旧 waiting/日期及归档记录保留、本地删除持久化与双端删除拒绝；feature-surfaces 保持搜索与草稿跨容器接续。

independent-features 的配置操作模拟设置 API；十轮往返保留草稿，并验证桥繁忙后的 ready/handoff 重试、侧栏收起再开，实际采样胶囊展开/收回中的 morphing 状态及 84×36 收起尺寸，检查没有新增功能菜单或位置选择器。

主界面回归检查仅有一个根节点、浮层不占用侧栏空间、展开不重开已关闭功能；通用视图检查液态看板工具栏透明、内容半透明而主要按钮文字不透明。

共享功能验收覆盖实际拖动分栏/合并、上下二等分后下半部左右二等分、各层比例、专注恢复、重载布局、窄窗恢复、草稿保留、侧栏宽度导出与看板工具同行；Dev 快照验证独立 feature 页面和样式更新，Rust 验证布局持久化、旧 owner 拒绝及设置重置。

结构重构继续复用 workbench、independent-features、feature-views 与 dev-panel 检查；旧工作台验收通过 workspace/legacy-content 使用同一份大纲/下一步渲染。source 路径随目录变更更新，不为搬文件单独增加测试。真实 Dev 生效另核对当前来源、活动窗口和资源修订号，不能以合成验收替代。宿主 fixture 提供左栏入口，前端验收不再点击隐藏胶囊；导航缺失仍须隐藏胶囊，重载须清除空侧栏占位，销毁后的迟到回调不得重新挂载。

panel-settings 复用逐项保存检查，核对内容/容器字段不会写入旧布局与主题；startup-settings 覆盖切换分类期间的在途草稿、失败及并发保护，以及 Dev 来源组件跨卸载/重新挂载的节点和编辑状态保留。

入口回归覆盖无选中底色、共用单/双击和 Alt+Enter、右键设置、导航替换后的唯一入口、导航缺失兼容和销毁；侧栏识别新版标签页，并在主聊天与仍打开的独立聊天间跟随操作目标。

左栏入口回归覆盖单/双击与右键设置；功能布局回归覆盖交接期间空分组清理及嵌套分隔线隔离。feature-views 验证容器没有设置按钮、看板搜索与功能标签同行，展开的输入框仍在底部。
