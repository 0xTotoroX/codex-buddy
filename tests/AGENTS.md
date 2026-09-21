# tests/ — 自动测试与验收

> L2 | 父级：[AGENTS.md](../AGENTS.md)

集中维护契约、端到端、生命周期与原生验收，以及测试辅助和合成数据。Node 测试检查模块边界与审计器，许可集成测试读取 Cargo 元数据和已安装 npm 依赖；HTML fixture 供独立浏览器验收。需要二进制的测试通过 scripts/verify.mjs 准备与源码匹配的产物。运行数据仅写临时目录或 `target/reports/`。

窗口交接回归：popout-checks 区分 ready / presented，检查隐藏面板的有效回程坐标、胶囊出发的慢双击和收回状态还原、阅读接续、过期内容拒绝、快速反向切换和减少动态效果；native-check 通过 native-probe 采样指定测试进程主窗口的实际位置/尺寸/透明度，验证呈现确认、首个可见帧的来源尺寸和连续展开中间帧、三材质返回取消与退出，追加 --cross-screen 使用实际连接的第二块屏幕，--reverse-screens 交换起终屏幕，检查首帧和终点的屏幕坐标；采样本身无需截图。测试数值不能代替真实宿主的视觉体验验收。

模型控制条使用独立合成宿主与本机 API 验收；不读取真实聊天、不调用模型，也不修改官方应用配置。宿主适配和网页行为纳入 verify，原生窗口单独检查焦点与鼠标。

成员清单：

- [model-control-host.mjs](model-control-host.mjs)：官方能力响应关联、唯一输入目标、引用身份隔离、新旧菜单/内联/隐藏视图、推理滑块、锁定选项、重复失败清理与完整回读、迟到/生成/部分失败及清理的合成宿主回归。
- [model-control-view.mjs](model-control-view.mjs)：控制条预设、矩阵、排序、列宽、首次点击同步/目标变化拦截、读回状态及键盘交互的浏览器回归。
- [model-control-fixture.mjs](model-control-fixture.mjs)：共享的合成官方模型菜单与能力响应宿主。
- [model-control-e2e.mjs](model-control-e2e.mjs)：真实 Rust HTTP/CDP 到合成官方菜单的链路、鉴权、完整回读、旧目标拒绝及设置页主题/位置保存验收。
- [model-control-native.mjs](model-control-native.mjs)：独立 NSPanel 的实际窗口尺寸、焦点、独立四主题与原生材质、内容高度、宿主隐藏/恢复、租约退出与定位验收；不支持的系统输入事件明确记录跳过。
- [model-control-probe.swift](model-control-probe.swift)：仅操作指定合成原生面板的窗口、焦点和鼠标验收探针。

- [startup-settings.test.mjs](startup-settings.test.mjs)：实际 React 启动选项默认值、强退提示、显式保存及页面重载恢复；合成本机 API，不退出真实宿主。

- [dev-launcher.test.mjs](dev-launcher.test.mjs)：开发 App 后台启动/日志/进程存续/正常退出及身份保护、启动策略参数传递、重复唤起、原目标重连、失败边界、失效锁保留及 shell 转义；设置 CODEX_BUDDY_NATIVE_LAUNCHER_TEST=1 显式验收合成原生窗口的 Dock 策略与焦点交接，不在普通回归中抢焦点。

- [bridge-requests.test.mjs](bridge-requests.test.mjs)：弹出请求失联后的超时释放、重试与迟到响应隔离，保留模型请求的长超时。

- [dock-appearance.test.mjs](dock-appearance.test.mjs)：停靠场景默认外观、独立本地偏好与星星选中表现，覆盖共享窗口偏好不受污染。

- [workbench-layout.test.mjs](workbench-layout.test.mjs)：纯布局决策、统一编排命令、无效落点、双向最低尺寸、滞回和旧偏好迁移。

- [workbench-binding.mjs](workbench-binding.mjs)：由 workbench.mjs 执行的六组关联回归，覆盖同目标保留、换目标迟到结果、兄弟输入框隔离、身份替换/失联/重挂载、窗口命令及冷初始化；只使用合成响应。

- [workbench.mjs](workbench.mjs)：工作台浏览器行为验收；自动/双轴布局、交换/重置、连续缩放及生成中切换不增加请求、独立持久化和嵌套滚动接续；真实占位、前景聊天迁移及输入目标、模态让位与阅读恢复、两栏独立渲染、键盘调整、空间不足、功能开关、宿主重绘和销毁恢复。连续流程以延迟的合成响应验证聊天切换、过期结果、生成次数及双端阅读交接，不调用模型；`WORKBENCH_CASE` 可按名称片段只运行相关用例，结果单独写入 `selected-results.json`。

- [panel-settings.test.mjs](panel-settings.test.mjs)：隔离浏览器中的实际 React 设置控件回归，验证工作台偏好逐字段保存、数值范围及胶囊尺寸、主题和功能开关隔离。

- [embedded-glass.mjs](embedded-glass.mjs)：真实 Chromium 中用固定高对比背景验证正式构建的 SVG 背景像素、实时更新、B 版 Regular/Clear 液态变体与原生变体隔离、清理及正式构建集成；系统合成器允许透明时要求可见像素差，CI 主机启用“减少透明度”时核对不同效果契约，产品回退由 e2e 单独覆盖；独立命令 test:glass，不读取真实聊天。

- [e2e.mjs](e2e.mjs)：端到端测试入口；--popout-only 单独运行窗口协议、外观及交接回归，报告写入 target/reports/popout；按实际系统版本核对弹出能力并验证 Web 与内嵌偏好双向同步；macOS 14 只跑内嵌并确认弹出入口禁用，macOS 15+ 委托 popout-checks 验证窗口协议及外观同步；正式内嵌液态覆盖 SVG、浏览器不支持及“减少透明度”回退；同时验证表情单击 100ms 延迟、双击取消或中断收放并切换窗口、拖动不误触及左右固定对角缩放；报告写入 target/reports/e2e。
- [popout-checks.mjs](popout-checks.mjs)：端到端测试的弹出窗口子流程；检查三材质单入口与双向保存、投影、宿主强调色动态同步及回退、收回、受限操作、隐藏像素、表面偏色、哑光/磨砂的单层圆角浅阴影，以及宿主 reset 有无变化时的公共几何、内边距和字体。
- [lifecycle-test.mjs](lifecycle-test.mjs)：进程生命周期测试入口，不使用真实聊天数据；验证启动器在不支持浮窗时保留内嵌、其他错误仍提示，以及旧默认目录迁移、安装、服务复用、升级、回滚和模型请求取消；报告写入 target/reports/lifecycle.json。 正式程序冷启动覆盖旧胶囊配置、工作台开合意图与独立宽度/比例。
- [native-check.mjs](native-check.mjs)：macOS 原生背景验收；--genie-only 额外启用开发版私有网格，在哑光、磨砂和液态 Regular/Clear 中确认接口实际成功、形变完成后复位及收回取消，结果写入 target/reports/native-genie，追加 --chip-anchor 验证 84×46 胶囊锚点并写入 native-genie-chip；--motion-only 免截图单测提起、三材质回程取消、不同高度与中间偏好隔离，报告写入 target/reports/native-motion；验证闲置后的投影持续更新、窗口/WebView 主题及宿主强调色、明暗材质与展开尺寸；`--workbench-only` 免截图检查原生工作台双轴布局、交换/重置与双面板、设置返回、独立滚动及三材质缩放，使用系统鼠标事件验证面板拖拽合并/专注/拆分且原生窗口不移动；完整检查需屏幕录制权限，`--appearance-only` 可免截图检查主题、材质能力、通过公共头部进入设置并切换三材质后的 传统磨砂 HUDWindow/Active 状态/液态星星的 Regular/Clear 切换和拒绝收起及 AppKit 回读、跨材质保持展开与原生尺寸同步；同时验证 WebKit 的共同标题栏与盒模型，不证明原生折射像素。
- [native-backdrop.test.mjs](native-backdrop.test.mjs)：暂停动画帧时仍发送原生材质与收放状态通知，背景不覆盖系统明暗；系统切换单独走 IPC 并防止重复请求，且不重复发送未变状态；并发尺寸请求保留最后展开尺寸；旧样式迁入新材质后不覆盖后续选择。

- [dev-host.test.mjs](dev-host.test.mjs)：真实目标筛选、安装版连接恢复与配置/存储隔离；覆盖开发配置优先与首次继承日常策略、Dev 无连接准备/取消/复用及显式目标保护、无宿主启动不触发旧恢复、错误透传和失效旧目标保留归档；只使用合成本机服务。
- [dev-proxy.test.mjs](dev-proxy.test.mjs)：真实 Vite/开发网关的本机来源、鉴权、前端 api.ts 路由及后台重启后的会话稳定性；子进程捕获端点与取消错误；旧示例/模型入口返回 404；冷缓存请求后能退出，慢模型请求不被截断，客户端离开取消代理。
- [dev-panel.test.mjs](dev-panel.test.mjs)：隔离源码副本验证 CSS/逻辑版本分离，以及构建失败不覆盖最后可用快照。
- [fixtures.mjs](fixtures.mjs)：符合共享设置/字体契约的合成投影数据。

- [panel-modules.test.mjs](panel-modules.test.mjs)：对全部胶囊功能模块执行 checkJs，检查依赖无环和两项功能无互相依赖。
- [native-probe.swift](native-probe.swift)：原生验收的合成背景窗口、指定测试进程窗口几何、合成窗口的真实鼠标拖拽及截图颜色读取器，只编译到临时目录。

- [host-fixture.html](host-fixture.html)：e2e 和弹出测试的宿主 fixture，不包含真实聊天；共享胶囊可交互的桌面宿主 DOM。
- [source-audit.test.mjs](source-audit.test.mjs)：公开边界、递归许可与真实依赖声明的行为测试；覆盖嵌套署名、显式路径、来源补充和原文引用，以及无 Git 源码清单和私有文件/符号链接拒绝。

- [popout-preferences.test.mjs](popout-preferences.test.mjs)：位置写入延迟时并发置顶/外观串行推进修订号，真实外部冲突仍拒绝。
- [workbench-actions.mjs](workbench-actions.mjs)：端到端检查通过实际设置/专注控件选择内容，替代旧展开页标签。

workbench 用例覆盖三材质、标签/分栏/专注、旧 capsule 偏好弹出时公共表情与明确收回入口，以及紧凑双击的出发状态。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

工作台回归覆盖头部中轴/图标尺寸、显式设置选择与文字对齐、单击收起/重新停靠和简化窄入口；外观测试依据轮廓/实心 SVG 几何区别验证 Clear 状态，不依赖 stroke/fill 的绘制方式。
