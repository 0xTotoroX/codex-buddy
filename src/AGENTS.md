# src/ — Rust 应用源码

> L2 | 父级：[AGENTS.md](../AGENTS.md)

main → lifecycle/server；server → App；App → CDP/模型；panel 管理窗口子进程。业务校验在后台和宿主完成。当前仅实现 macOS arm64 路径，由根 build.rs 拒绝其他目标；不保留未适配的 Windows/Linux 启动、升级和窗口分支。

共享胶囊是宿主识别和写入的唯一实现，经受限请求桥请求模型；后台仅保留连接与胶囊状态摘要。HTTP 不再提供独立的建议、导航或草稿写入链。

成员清单：

- [assets.rs](assets.rs)：正式内嵌与开发快照的资源边界；只有 debug 程序接受显式 CODEX_BUDDY_DEV_ASSETS，release 始终使用内嵌资源。

- [cdp.rs](cdp.rs)：宿主连接基础层，被 state.rs 和 requests.rs 使用；目标发现与 Client 请求/事件/注入生命周期，内嵌共享胶囊，开发时检查胶囊归属并更新当前与导航后的脚本，将存活、显示同步和不含正文的状态摘要合并读取。
- [config.rs](config.rs)：Rust 配置基础层，以 CODEX_BUDDY_HOME 或 codex-buddy 默认目录管理独立数据；Config、Paths、默认参数及私有文件读写。
- [requests.rs](requests.rs)：renderer 与独立后台的受限操作边界，生成前后校验上下文；桌面请求分发、建议 items 转换及结果回送。
- [lifecycle.rs](lifecycle.rs)：CLI 进程管理层，负责复用服务和本地更新回滚；start/stop/status/doctor/launch/update 与 Runtime；launch 检查已有宿主并支持禁止打开设置网页。
- [main.rs](main.rs)：独立可执行文件入口，区分后台和窗口子进程；codex-buddy 命令分发与进程入口。
- [model.rs](model.rs)：模型适配层，统一 CLI 与 API 请求和结构化结果；Model、ModelInfo、Suggestion 与生成/测试/模型查询。
- [panel.rs](panel.rs)：后台系统浮窗管理层，窗口就绪后才隐藏内嵌胶囊；Panel、Preferences 及弹出/收回/受限命令协调；统一检测 macOS 15+ arm64 弹出能力，限制手动/自动恢复及窗口子进程入口；旧玻璃偏好迁移为磨砂，弹出偏好始终展开且忽略宿主收起同步，外观 PATCH（含 liquidVariant）验证与版本控制，Web 修改和宿主回传分开同步。
- [panel_window.rs](panel_window.rs)：窗口子进程实现，被 main.rs 调用；系统窗口事件循环、只允许展开尺寸的 WebView IPC、位置恢复、原生 resize 同事务更新玻璃与 WebView、拒绝过期网页尺寸、异步 System Events 明暗切换及 macOS 原生背景/手势，按材质实时切换传统磨砂 NSVisualEffectView HUDWindow/BehindWindow/Active 与系统液态 NSGlassEffectView（始终展开，由 liquidVariant 选择 Regular/Clear），回读实际状态；应用侧圆角父视图限制外溢绘制，液态通过 contentView 承载 WebView，磨砂位于透明 WebView 下方；哑光关闭原生背景，macOS 15–25 的弹出液态回退哑光；弹出进程禁止后台任务暂停以维持浮窗投影和租约。
- [server.rs](server.rs)：仅监听 loopback 的服务入口，公开状态剔除聊天正文；serve、HTTP/SSE API，内嵌 target/web 设置页与 ui/panel/popout 页面；开发模式按快照替换胶囊资源，受鉴权保护的 development API 只报告内嵌/原生实例、材质能力及限定的数值几何。
- [settings.rs](settings.rs)：分开维护保存版本与生成版本，大纲切换不取消生成；外部读取只返回密钥配置状态；Options、Update 及设置读取、校验和保存；返回后台检测的只读 popoutSupported。
- [state.rs](state.rs)：后台业务状态层，为 server、requests 与 panel 提供一致状态；App、View、连接与胶囊状态摘要；until_shutdown 统一取消退出中的生成、测试及模型列表请求；开发资源启用时固定启动端点及窗口，避免调试中切换到其他窗口。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
