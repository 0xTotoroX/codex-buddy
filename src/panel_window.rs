// [INPUT]: Tao/Wry、Runtime、Preferences 与 AppKit 原生背景和手势。
// [OUTPUT]: 系统窗口事件循环、系统明暗切换 IPC、原生 resize 同步 WebView、位置恢复、实时窗口背景、传统磨砂/按偏好切换的系统液态样式回读与展开尺寸边界、原生绘制边界与 macOS 原生手势。
// [POS]: 窗口子进程实现，被 main.rs 调用。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{config::Paths, lifecycle::Runtime, panel::Preferences};
use anyhow::Result;
use serde_json::{Value, json};
use tao::{
    dpi::{LogicalSize, PhysicalPosition},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::{Window, WindowBuilder},
};
use wry::WebViewBuilder;

mod macos {
    use objc2::{MainThreadMarker, MainThreadOnly, rc::Retained, runtime::AnyClass};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSEvent, NSGlassEffectView, NSGlassEffectViewStyle, NSView,
        NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState,
        NSVisualEffectView, NSWindow,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use objc2_quartz_core::CATransaction;
    use serde_json::Value;
    use tao::{platform::macos::WindowExtMacOS, window::Window};

    pub fn glass_available() -> bool {
        AnyClass::get(c"NSGlassEffectView").is_some()
    }

    // 磨砂使用 HUDWindow 并保持激活外观；液态始终展开并按偏好选择 Regular/Clear，继续跟随系统玻璃偏好和焦点。
    pub struct Backdrop {
        glass: Option<Retained<NSGlassEffectView>>,
        frosted: Retained<NSVisualEffectView>,
        boundary: Retained<NSView>,
        carrier: Retained<NSView>,
        web: Retained<NSView>,
    }

    impl Backdrop {
        pub fn new(window: &Window) -> Self {
            let mtm = MainThreadMarker::new().expect("window main thread");
            let root = native_window(window)
                .contentView()
                .expect("Wry content view");
            let web = root.subviews().objectAtIndex(0);
            web.setAutoresizingMask(NSAutoresizingMaskOptions::empty());
            // 在应用自己的父视图上限定绘制范围，不修改 AppKit 私有玻璃子层。
            let boundary = NSView::initWithFrame(NSView::alloc(mtm), NSRect::ZERO);
            boundary.setWantsLayer(true);
            root.addSubview(&boundary);
            // 原生背景位于网页下方，避免首次磨砂命中背景视图而吞掉手势。
            web.removeFromSuperview();
            root.addSubview(&web);
            let frosted =
                NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), NSRect::ZERO);
            frosted.setMaterial(NSVisualEffectMaterial::HUDWindow);
            frosted.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            frosted.setState(NSVisualEffectState::Active);
            frosted.setHidden(true);
            boundary.addSubview(&frosted);
            let carrier = NSView::initWithFrame(NSView::alloc(mtm), NSRect::ZERO);
            let glass = glass_available().then(|| {
                let view =
                    NSGlassEffectView::initWithFrame(NSGlassEffectView::alloc(mtm), NSRect::ZERO);
                view.setStyle(NSGlassEffectViewStyle::Regular);
                view.setContentView(Some(&carrier));
                view.setHidden(true);
                boundary.addSubview(&view);
                view
            });
            Self {
                glass,
                frosted,
                boundary,
                carrier,
                web,
            }
        }

        pub fn style(&self) -> Option<&'static str> {
            if !self.frosted.isHidden() {
                return Some(
                    if self.frosted.material() == NSVisualEffectMaterial::HUDWindow
                        && self.frosted.state() == NSVisualEffectState::Active
                        && self.frosted.blendingMode() == NSVisualEffectBlendingMode::BehindWindow
                    {
                        "frosted-hud-active"
                    } else {
                        "frosted-unexpected"
                    },
                );
            }
            self.glass
                .as_ref()
                .filter(|glass| !glass.isHidden())
                .map(|glass| {
                    if glass.style() == NSGlassEffectViewStyle::Regular {
                        "regular"
                    } else {
                        "clear"
                    }
                })
        }

        pub fn resize_viewport(&self, window: &Window, interactive: bool) {
            let root = native_window(window)
                .contentView()
                .expect("Wry content view");
            let mut frame = self.web.frame();
            let size = root.bounds().size;
            CATransaction::begin();
            CATransaction::setDisableActions(true);
            if interactive {
                // 玻璃边界与窗口同一事务更新，不等一次 JS/IPC 往返后再追赶。
                let mut boundary = self.boundary.frame();
                boundary.size.width += size.width - frame.size.width;
                boundary.size.height += size.height - frame.size.height;
                self.boundary.setFrame(boundary);
                let local = NSRect::new(NSPoint::ZERO, boundary.size);
                self.frosted.setFrame(local);
                if let Some(glass) = &self.glass {
                    glass.setFrame(local);
                }
            }
            frame.size = size;
            self.web.setFrame(frame);
            CATransaction::commit();
        }

        pub fn update(&self, window: &Window, message: &Value) {
            let root = native_window(window)
                .contentView()
                .expect("Wry content view");
            let bounds = root.bounds();
            // 窗口缩放时，上一视口的 DOM 消息可能晚到；不能用它回退或隐藏原生背景。
            if message["hidden"] != true
                && (message["viewportWidth"]
                    .as_f64()
                    .is_some_and(|w| (w - bounds.size.width).abs() > 1.)
                    || message["viewportHeight"]
                        .as_f64()
                        .is_some_and(|h| (h - bounds.size.height).abs() > 1.))
            {
                return;
            }
            let read = |key: &str| message[key].as_f64().filter(|v| v.is_finite());
            let geometry = read("x")
                .zip(read("y"))
                .zip(read("width"))
                .zip(read("height"))
                .zip(read("radius"))
                .map(|((((x, y), w), h), r)| (x, y, w, h, r))
                .filter(|&(x, y, w, h, _)| {
                    w > 0.
                        && h > 0.
                        && x >= 0.
                        && y >= 0.
                        && x + w <= bounds.size.width + 1.
                        && y + h <= bounds.size.height + 1.
                });
            if geometry.is_none() && message["hidden"] != true {
                return;
            }
            let visible = geometry.is_some() && message["hidden"] != true;
            let use_glass =
                visible && message["material"] == "native-glass" && self.glass.is_some();
            let use_frosted = visible && message["material"] == "frosted";
            CATransaction::begin();
            CATransaction::setDisableActions(true);
            if use_glass {
                let glass = self.glass.as_ref().expect("available glass");
                let style = if message["liquidVariant"] == "clear" {
                    NSGlassEffectViewStyle::Clear
                } else {
                    NSGlassEffectViewStyle::Regular
                };
                if glass.style() != style {
                    glass.setStyle(style);
                }
                if unsafe { self.web.superview() }.as_deref() != Some(&*self.carrier) {
                    self.web.removeFromSuperview();
                    self.carrier.addSubview(&self.web);
                }
            } else {
                if unsafe { self.web.superview() }.as_deref() != Some(&*root) {
                    self.web.removeFromSuperview();
                    root.addSubview(&self.web);
                }
                self.web.setFrame(bounds);
            }
            if let Some((x, y, width, height, radius)) = geometry {
                let origin_y = if root.isFlipped() {
                    y
                } else {
                    bounds.size.height - y - height
                };
                let rect = NSRect::new(NSPoint::new(x, origin_y), NSSize::new(width, height));
                let radius = radius.clamp(0., width.min(height) / 2.);
                self.boundary.setFrame(rect);
                // 保留圆角外溢裁切，避免原生玻璃阴影占用透明窗口边距。
                self.boundary.setClipsToBounds(true);
                if let Some(layer) = self.boundary.layer() {
                    layer.setCornerRadius(radius);
                    layer.setMasksToBounds(true);
                }
                let local = NSRect::new(NSPoint::ZERO, rect.size);
                self.frosted.setFrame(local);
                if let Some(glass) = &self.glass {
                    glass.setFrame(local);
                    glass.setCornerRadius(radius);
                    if use_glass {
                        // 保持网页完整视口，只把当前胶囊区域放进玻璃容器。
                        self.web.setFrame(NSRect::new(
                            NSPoint::new(-x, -(bounds.size.height - y - height)),
                            bounds.size,
                        ));
                    }
                }
            }
            if let Some(glass) = &self.glass {
                glass.setHidden(!use_glass);
            }
            self.frosted.setHidden(!use_frosted);
            self.boundary.setHidden(!use_glass && !use_frosted);
            CATransaction::commit();
        }
    }

    // WebView IPC 已离开原鼠标事件栈。按 AppKit 的全局点坐标移动，避免窗口跳位；
    // Tao 在 macOS 不支持 drag_resize_window，因此同一手势也处理边角缩放。
    pub struct Gesture {
        mouse: NSPoint,
        frame: NSRect,
        resize_left: Option<bool>,
    }

    fn native_window(window: &Window) -> &NSWindow {
        // Tao 持有 NSWindow，且本模块仅在窗口所属的主线程使用该借用。
        unsafe { &*(window.ns_window() as *const NSWindow) }
    }

    impl Gesture {
        pub fn start(window: &Window, resize_left: Option<bool>) -> Option<Self> {
            (NSEvent::pressedMouseButtons() & 1 != 0).then(|| Self {
                mouse: NSEvent::mouseLocation(),
                frame: native_window(window).frame(),
                resize_left,
            })
        }

        pub fn is_resize(&self) -> bool {
            self.resize_left.is_some()
        }

        pub fn update(&self, window: &Window) -> bool {
            let mouse = NSEvent::mouseLocation();
            let (dx, dy) = (mouse.x - self.mouse.x, mouse.y - self.mouse.y);
            let mut frame = self.frame;
            if let Some(left) = self.resize_left {
                frame.size.width =
                    (self.frame.size.width + if left { -dx } else { dx }).clamp(324., 664.);
                frame.size.height = (self.frame.size.height - dy).clamp(364., 744.);
                frame.origin.y += self.frame.size.height - frame.size.height;
                if left {
                    frame.origin.x += self.frame.size.width - frame.size.width;
                }
            } else {
                frame.origin.x += dx;
                frame.origin.y += dy;
            }
            let native = native_window(window);
            if native.frame() != frame {
                native.setFrame_display(frame, !self.is_resize());
            }
            NSEvent::pressedMouseButtons() & 1 != 0
        }
    }
}

// 独立子进程在主线程运行系统窗口；后台退出会回收它。
pub fn run(paths: &Paths, lease: &str, activate: bool) -> Result<()> {
    crate::panel::require_popout(crate::panel::popout_supported())?;
    let runtime = Runtime::read(paths)?;
    let prefs = Preferences::read(paths);
    let mut event_loop = EventLoopBuilder::<Value>::with_user_event().build();
    {
        use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
        event_loop.set_activation_policy(ActivationPolicy::Accessory);
    }
    let size = (prefs.ui.width + 24., prefs.ui.height + 24.);
    let window = WindowBuilder::new()
        .with_title(if crate::assets::development().is_some() {
            "CodexBuddy · 开发版"
        } else {
            "CodexBuddy"
        })
        .with_decorations(false)
        .with_transparent(true)
        .with_focused(false)
        .with_visible(false)
        .with_always_on_top(prefs.always_on_top)
        .with_inner_size(LogicalSize::new(size.0, size.1))
        .with_min_inner_size(LogicalSize::new(324., 364.))
        .with_max_inner_size(LogicalSize::new(664., 744.))
        .build(&event_loop)?;
    {
        use tao::platform::macos::WindowExtMacOS;
        // 半透明网页的逐像素系统阴影会让字形出现重影。
        window.set_has_shadow(false);
    }
    if let Some(position) = prefs.position {
        window.set_outer_position(PhysicalPosition::new(position.x as i32, position.y as i32));
    } else if let Some(monitor) = window.primary_monitor() {
        let origin = monitor.position();
        let size = monitor.size();
        window.set_outer_position(PhysicalPosition::new(
            origin.x + size.width as i32 - window.outer_size().width as i32 - 48,
            origin.y + 96,
        ));
    }
    keep_on_screen(&window);
    let page = format!("http://127.0.0.1:{}/panel", runtime.port);
    let url = format!("{page}#token={}&lease={lease}", runtime.token);
    let proxy = event_loop.create_proxy();
    let theme_proxy = proxy.clone();
    let allowed = page.clone();
    let builder = WebViewBuilder::new()
        .with_incognito(crate::assets::development().is_some())
        .with_url(url)
        .with_transparent(true)
        .with_focused(false)
        .with_navigation_handler(move |url| {
            url == allowed || url.starts_with(&format!("{allowed}#"))
        })
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .with_ipc_handler(move |request| {
            if request.body().len() <= 8192
                && let Ok(value) = serde_json::from_str::<Value>(request.body())
            {
                let _ = proxy.send_event(value);
            }
        });
    let builder = builder
        // 浮窗不抢占焦点，也可能暂时被遮挡；投影与租约不能随 WebKit 后台页面一起暂停。
        .with_background_throttling(wry::BackgroundThrottlingPolicy::Disabled)
        .with_initialization_script(format!(
            "window.__companionNativeBackdrop = true; window.__companionNativeGlass = {};",
            macos::glass_available()
        ));
    let webview = builder.build(&window)?;

    let mut gesture: Option<macos::Gesture> = None;
    let backdrop = macos::Backdrop::new(&window);
    let mut reported_glass_style = None;
    let mut theme_pending = false;
    event_loop.run(move |event, _, control| {
        *control = ControlFlow::Wait;
        match event {
            Event::UserEvent(message) => match message["kind"].as_str().unwrap_or_default() {
                "system-theme" if !theme_pending => {
                    if let Some(dark) = message["dark"].as_bool() {
                        theme_pending = true;
                        let proxy = theme_proxy.clone();
                        std::thread::spawn(move || {
                            let error = set_system_theme(dark).err().map(|error| error.to_string());
                            let _ = proxy
                                .send_event(json!({"kind":"system-theme-result", "error":error}));
                        });
                    }
                }
                "system-theme-result" => {
                    theme_pending = false;
                    let _ = webview.evaluate_script(&format!(
                        "window.__companionPopout?.themeResult({});",
                        message["error"]
                    ));
                }
                "backdrop" => {
                    backdrop.update(&window, &message);
                    let style = backdrop.style();
                    if reported_glass_style != style {
                        reported_glass_style = style;
                        let _ = webview.evaluate_script(&format!(
                            "window.__companionNativeGlassStyle = {};",
                            json!(style)
                        ));
                    }
                }
                "show" => {
                    window.set_visible(true);
                    if activate {
                        window.set_focus();
                    }
                }
                "close" => *control = ControlFlow::Exit,
                "drag" => {
                    gesture = macos::Gesture::start(&window, None);
                }
                "pin" => window.set_always_on_top(message["value"] == true),
                "position" => {
                    if let (Some(x), Some(y)) = (message["x"].as_f64(), message["y"].as_f64()) {
                        window.set_outer_position(PhysicalPosition::new(x as i32, y as i32));
                    }
                }
                "resize" => {
                    window.set_min_inner_size(Some(LogicalSize::new(324., 364.)));
                    gesture = macos::Gesture::start(&window, Some(message["corner"] == "bl"));
                    if gesture.is_none() {
                        let _ = webview.evaluate_script(
                            "window.__companionFloatingPanel?.nativeGestureEnded();",
                        );
                    }
                }
                "size" => {
                    let width = message["width"].as_f64().unwrap_or(428.).clamp(324., 664.);
                    let height = message["height"].as_f64().unwrap_or(444.).clamp(364., 744.);
                    window.set_min_inner_size(Some(LogicalSize::new(324., 364.)));
                    let old = window.outer_size();
                    let position = window.outer_position().ok();
                    window.set_inner_size(LogicalSize::new(width, height));
                    if let Some(position) = position {
                        let next_width = (width * window.scale_factor()).round() as i32;
                        window.set_outer_position(PhysicalPosition::new(
                            position.x + (old.width as i32 - next_width) / 2,
                            position.y,
                        ));
                    }
                    keep_on_screen(&window);
                    let _ = webview.evaluate_script(&format!(
                        "window.__companionPopout?.resized({});",
                        message["id"]
                    ));
                }
                _ => {}
            },
            Event::WindowEvent {
                event: WindowEvent::Resized(_),
                ..
            } => backdrop.resize_viewport(
                &window,
                gesture.as_ref().is_some_and(macos::Gesture::is_resize),
            ),
            Event::WindowEvent {
                event: WindowEvent::Moved(position),
                ..
            } => {
                let _ = webview.evaluate_script(&format!(
                    "window.__companionPopout?.moved({});",
                    json!({"x":position.x,"y":position.y})
                ));
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                let _ = webview.evaluate_script("window.__companionPopout?.dock();");
            }
            _ => {}
        }
        if !matches!(*control, ControlFlow::Exit)
            && let Some(active) = &gesture
        {
            if active.update(&window) {
                *control = ControlFlow::WaitUntil(
                    std::time::Instant::now() + std::time::Duration::from_millis(16),
                );
            } else {
                gesture = None;
                keep_on_screen(&window);
                let _ = webview
                    .evaluate_script("window.__companionFloatingPanel?.nativeGestureEnded();");
            }
        }
    })
}

fn set_system_theme(dark: bool) -> Result<()> {
    let script = format!(
        "with timeout of 30 seconds\ntell application id \"com.apple.systemevents\" to tell appearance preferences\nset dark mode to {dark}\nreturn dark mode\nend tell\nend timeout"
    );
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        if detail.contains("-1743") {
            anyhow::bail!(
                "未获准切换 macOS 明暗。请在系统设置 → 隐私与安全性 → 自动化中允许控制 System Events。"
            );
        }
        anyhow::bail!("macOS 明暗切换失败：{}", detail.trim());
    }
    anyhow::ensure!(
        String::from_utf8_lossy(&output.stdout).trim() == dark.to_string(),
        "macOS 未确认目标明暗状态，请重试。"
    );
    Ok(())
}

fn keep_on_screen(window: &Window) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let size = window.outer_size();
    let monitor = window
        .available_monitors()
        .find(|monitor| {
            let origin = monitor.position();
            let size = monitor.size();
            position.x >= origin.x
                && position.x < origin.x + size.width as i32
                && position.y >= origin.y
                && position.y < origin.y + size.height as i32
        })
        .or_else(|| window.primary_monitor());
    if let Some(monitor) = monitor {
        let origin = monitor.position();
        let bounds = monitor.size();
        let x = position.x.clamp(
            origin.x,
            (origin.x + bounds.width as i32 - size.width as i32).max(origin.x),
        );
        let y = position.y.clamp(
            origin.y + 48,
            (origin.y + bounds.height as i32 - size.height as i32 - 24).max(origin.y + 48),
        );
        if position.x != x || position.y != y {
            window.set_outer_position(PhysicalPosition::new(x, y));
        }
    }
}
