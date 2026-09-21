# src/ — Rust 应用源码

> L2 | 父级：[AGENTS.md](../AGENTS.md)

main → lifecycle/server；server → App；App → CDP/模型；panel 管理窗口子进程。业务校验在后台和宿主完成。当前仅实现 macOS arm64 路径，由根 build.rs 拒绝其他目标；不保留未适配的 Windows/Linux 启动、升级和窗口分支。

共享胶囊是宿主识别和写入的唯一实现，经受限请求桥请求模型；后台仅保留连接与胶囊状态摘要。HTTP 不再提供独立的建议、导航或草稿写入链。

窗口交接由 panel 管理 ready / presented / docking：server 暴露呈现确认端点，panel_window 在来源位置已可见时回报 presented，随后隐藏内嵌并继续移动；收回须等待内嵌确认恢复。ReadingState 仅供同任务、同内容的阅读接续，不持久化；可选 panes 分别保存 outline/next 的 contentToken 与 scrollTop，全局提示词预览索引和滚动位置保持兼容。Ui 的 layoutMode 默认 capsule，工作台 dockWidth（默认 340，截取到 300–460）、splitRatio（默认 0.45，截取到 0.2–0.8）和 dockOpen（默认 true）独立持久化；可选 dockLayout/popoutLayout 分别保存分栏/标签分组、激活标签、自动/上下/左右、首个面板和双轴比例（旧配置默认为分栏、大纲标签），旧配置缺失时由前端迁移旧比例，外观 PATCH 保持旧 splitRatio 与停靠上下比例兼容，不覆盖胶囊 width/height。Ui 的 width/height 只校验有限正数与最小尺寸，不再限定浮窗最大宽高；内嵌在渲染时约束实际尺寸，不截断保存的大尺寸。Preferences.returnOpen 独立持久保存出发形态，弹出 ui.open 恒为 true，投影给内嵌时恢复 returnOpen，收回成功才把该值写回 ui.open；旧配置缺少字段时保持此前展开行为。原生整窗位置、尺寸与共同容器轻缩放驱动 320ms 提起、260ms 收回移动及 90ms 交还后的淡出；panel/anchor 临时读取内嵌屏幕区域，隐藏时按布局计算，断开的屏幕或无效坐标回退短过渡，减少动态效果时立即完成；原生材质与 WebView 在同一无动画事务内切换，尺寸更新不追赶动画。

开发版 `window_warp` 动态解析 CGS 私有网格接口，不截屏；原生内容尺寸在动画中固定，合成后网格按临时坐标收束。入场在窗口显示前预置来源网格，再沿收回曲线反向展开，取消起步停顿与淡入遮挡；来源与目标按 NSScreen 全局逻辑坐标分别校验，可跨屏，不乘 backingScaleFactor；失效坐标仍回退。每 16ms 至多更新一次，完成、取消或接管后复位；失败停用，正式构建不加载。临时原生测试可在 debug 程序使用 `CODEX_BUDDY_DEV_GENIE=1`。

模型控制条由独立 model_control 服务与 NSPanel 子进程管理，不调用工作台弹出/收回契约。模型指令绑定宿主当前唯一输入目标和版本，经官方菜单执行后核验完整配置；与建议生成的 model.rs 完全分离。私有 model-control.json 仅保存边缘/屏幕位置、独立主题/液态变体、保持展开、模型置顶和配置预设，不保存聊天正文。API 鉴权复用现有服务；关闭或后端断开时租约失效。默认关闭，用户从设置或 CLI 开启后记住选择。控制条仅继承字号，默认纯黑凹角外壳；可选哑光/磨砂/液态，复用native_backdrop并按凹角裁切；NSEvent位置采样报告进入/离开与按键状态，由网页统一决定开合。window租约附带已连接宿主的可见性/焦点，原生面板仅在该宿主获得焦点时迁入当前Space，隐藏/失联时撤出，拒绝后台快捷键跨桌面唤起。content-size IPC按内容调整高度，窗口/网页共用凹角命中规则与刘海内容预算。

成员清单：

- [native_backdrop.rs](native_backdrop.rs)：NSWindow/NSPanel 共用的原生磨砂、液态 Regular/Clear、圆角/可选贴边凹角裁切与网页承载；不持有业务或窗口生命周期。

- [model_control.rs](model_control.rs)：独立控制条服务、串行操作、版本化局部偏好及窗口租约，防止跨聊天迟到结果与并发覆盖。
- [model_control_window.rs](model_control_window.rs)：非激活 NSPanel/WebView，显式键盘焦点、原生鼠标边界与冻结区域、按内容调高、边缘/刘海几何、屏幕恢复、线程安全显示器枚举、独立材质、快捷键和租约退出。
- [model_control_geometry.rs](model_control_geometry.rs)：逻辑点布局、凹角命中、安全区和显示器选择的纯计算及测试。


- [assets.rs](assets.rs)：正式内嵌与开发快照的资源边界；只有 debug 程序接受显式 CODEX_BUDDY_DEV_ASSETS，release 始终使用内嵌资源。

- [cdp.rs](cdp.rs)：宿主连接基础层，被 state.rs 和 requests.rs 使用；目标发现与 Client 请求/事件/注入生命周期，内嵌共享胶囊，开发时检查胶囊归属并更新当前与导航后的脚本，将存活、显示同步和不含正文的状态摘要合并读取。
- [config.rs](config.rs)：Rust 配置基础层，以 CODEX_BUDDY_HOME 或 codex-buddy 默认目录管理独立数据；Config、HostRestartPolicy（旧配置默认 ask）、Paths、默认参数及私有文件读写。
- [requests.rs](requests.rs)：renderer 与独立后台的受限操作边界，生成前后校验上下文；桌面请求分发、建议 items 转换及结果回送。
- [lifecycle.rs](lifecycle.rs)：CLI 进程管理层，负责复用服务和本地更新回滚；start/stop/status/doctor/launch/update 与 Runtime；launch 优先复用现有进程的调试连接，--restart-running 按 ask/force 策略确认正常退出或强制退出指定原生应用；等待退出后重开，取消/超时不升级或循环重启；--host-only 只输出就绪端点，不启动后台或改写配置，供 Dev 共享启动策略。
- [main.rs](main.rs)：独立可执行文件入口，区分后台和窗口子进程；codex-buddy 命令分发与进程入口。
- [model.rs](model.rs)：模型适配层，统一 CLI 与 API 请求和结构化结果；Model、ModelInfo、Suggestion 与生成/测试/模型查询。
- [panel.rs](panel.rs)：后台系统浮窗管理层，窗口呈现确认后才隐藏内嵌胶囊，宿主恢复失败时保留浮窗；Panel、Preferences、临时 ReadingState 及弹出/收回/受限命令协调；reveal_panel 保留现有呈现方式和实例，提供开发入口的唤起目标；统一检测 macOS 15+ arm64 弹出能力，限制手动/自动恢复及窗口子进程入口；旧玻璃偏好迁移为磨砂，弹出偏好始终展开且忽略宿主收起同步，外观 PATCH（含 liquidVariant）验证与版本控制，Web 修改和宿主回传分开同步。
- [window_warp.rs](window_warp.rs)：panel_window 的开发版整窗形变后端；私有 ABI 动态加载、独立曲面网格、错误回退和复位，网格身份/四方向顺序测试同文件维护。
- [panel_window.rs](panel_window.rs)：窗口子进程实现，被 main.rs 调用；系统窗口事件循环、只允许展开尺寸的 WebView IPC、位置恢复、原生 resize 同事务更新玻璃与 WebView、拒绝过期网页尺寸、异步 System Events 明暗切换及 macOS 原生手势；通过共享 native_backdrop 按材质实时切换传统磨砂 NSVisualEffectView HUDWindow/BehindWindow/Active 与系统液态 NSGlassEffectView（始终展开，由 liquidVariant 选择 Regular/Clear），回读实际状态；应用侧圆角父视图限制外溢绘制，液态通过 contentView 承载 WebView，磨砂位于透明 WebView 下方；哑光关闭原生背景，macOS 15–25 的弹出液态回退哑光；弹出进程禁止后台任务暂停以维持浮窗投影和租约。
- [server.rs](server.rs)：仅监听 loopback 的服务入口，公开状态剔除聊天正文；serve、HTTP/SSE API，内嵌 target/web 设置页与 ui/panel/popout 页面；开发模式按快照替换胶囊资源，受鉴权保护的 development API 报告内嵌/原生实例、材质能力及限定的数值几何；development/reveal 仅开发快照启用时开放，展开并定位原宿主或返回已有浮窗 PID，由前台启动器交接焦点，不另建窗口。
- [settings.rs](settings.rs)：分开维护保存版本与生成版本，大纲切换不取消生成；外部读取只返回密钥配置状态；Options、Update 及设置读取、校验和保存；返回后台检测的只读 popoutSupported。
- [state.rs](state.rs)：后台业务状态层，为 server、requests 与 panel 提供一致状态；App、View、连接与胶囊状态摘要；until_shutdown 统一取消退出中的生成、测试及模型列表请求；开发资源启用时固定启动端点及窗口，避免调试中切换到其他窗口。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
