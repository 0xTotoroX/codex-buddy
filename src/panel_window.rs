// [INPUT]: Tao/Wry、Runtime、Preferences、共享 native_backdrop 与 AppKit 手势。
// [OUTPUT]: 开发版整窗曲面神奇效果与空间动画回退、尊重减少动态效果的跨屏提起/落回、位置与尺寸接续、可取消原生动效和呈现确认、原生 resize 同步 WebView、实时背景和 macOS 原生手势。
// [POS]: 窗口子进程实现，被 main.rs 调用。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

#[path = "window_warp.rs"]
mod window_warp;

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

#[derive(Clone, Copy, Debug)]
struct Pose {
    x: f64,
    y: f64,
    scale: f64,
    width: f64,
    height: f64,
    alpha: f64,
}

#[derive(Clone, Copy, PartialEq)]
enum Motion {
    Enter,
    Return,
    Recover,
    Close,
}

struct WindowTransition {
    started: std::time::Instant,
    last_frame: std::time::Instant,
    duration: std::time::Duration,
    from: Pose,
    to: Pose,
    motion: Motion,
    spatial: bool,
    genie_entry: bool,
    initial_bend: [f64; 2],
}

impl WindowTransition {
    fn value(&self, now: std::time::Instant) -> (Pose, bool) {
        let progress = (now.duration_since(self.started).as_secs_f64()
            / self.duration.as_secs_f64())
        .clamp(0., 1.);
        // 网格入场沿收回路径反向展开；普通空间过渡仍先接住来源再离开。
        let travel = if self.motion == Motion::Enter && self.spatial && !self.genie_entry {
            ((progress - 0.22) / 0.78).clamp(0., 1.)
        } else {
            progress
        };
        let eased = if self.genie_entry {
            travel.powi(3)
        } else {
            1. - (1. - travel).powi(3)
        };
        let mix = |a, b| a + (b - a) * eased;
        let opacity = if self.genie_entry {
            1.
        } else if self.motion == Motion::Enter {
            (progress / 0.25).min(1.)
        } else {
            eased
        };
        let pulse = if self.spatial && self.motion == Motion::Enter && !self.genie_entry {
            0.007 * (std::f64::consts::PI * travel).sin().powi(2)
        } else {
            0.
        };
        (
            Pose {
                x: mix(self.from.x, self.to.x),
                y: mix(self.from.y, self.to.y)
                    + if self.spatial {
                        10. * (std::f64::consts::PI * travel).sin()
                    } else {
                        0.
                    },
                scale: mix(self.from.scale, self.to.scale) + pulse,
                width: mix(self.from.width, self.to.width),
                height: mix(self.from.height, self.to.height),
                alpha: self.from.alpha + (self.to.alpha - self.from.alpha) * opacity,
            },
            progress >= 1.,
        )
    }

    fn bend(&self, now: std::time::Instant) -> [f64; 2] {
        let t = (now.duration_since(self.started).as_secs_f64() / self.duration.as_secs_f64())
            .clamp(0., 1.);
        if self.motion == Motion::Recover {
            return self.initial_bend.map(|value| value * (1. - t).powi(3));
        }
        if !self.spatial || !matches!(self.motion, Motion::Enter | Motion::Return) {
            return [0., 0.];
        }
        let t = if self.motion == Motion::Enter && !self.genie_entry {
            ((t - 0.22) / 0.78).clamp(0., 1.)
        } else {
            t
        };
        let strength = 0.74 * (std::f64::consts::PI * t).sin().powi(2);
        let direction = if self.genie_entry { -1. } else { 1. };
        let dx = direction * (self.to.x + self.to.width / 2. - self.from.x - self.from.width / 2.);
        let dy =
            -direction * (self.to.y + self.to.height / 2. - self.from.y - self.from.height / 2.);
        if dx.abs() > dy.abs() {
            [strength * dx.signum(), 0.]
        } else {
            [0., strength * if dy == 0. { 1. } else { dy.signum() }]
        }
    }

    fn frame(&mut self, now: std::time::Instant) -> (Pose, bool, [f64; 2]) {
        // 系统忙时保留中间帧，不让第一帧直接跨过整段淡出或曲面形变。
        let delta = now.duration_since(self.last_frame);
        let max_step = std::time::Duration::from_millis(32);
        if delta > max_step {
            self.started += delta - max_step;
        }
        self.last_frame = now;
        let (pose, finished) = self.value(now);
        (pose, finished, self.bend(now))
    }

    fn new(from: Pose, to: Pose, motion: Motion, spatial: bool) -> Self {
        let ms = match (motion, spatial) {
            (Motion::Enter, true) => 320,
            (Motion::Return | Motion::Recover, true) => 260,
            (Motion::Close, _) => 90,
            _ => 140,
        };
        let now = std::time::Instant::now();
        Self {
            started: now,
            last_frame: now,
            duration: std::time::Duration::from_millis(ms),
            from,
            to,
            motion,
            spatial,
            genie_entry: false,
            initial_bend: [0., 0.],
        }
    }
}

mod macos {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen, NSWindow, NSWorkspace};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use objc2_quartz_core::{CATransaction, CATransform3D};
    use serde_json::Value;
    use tao::{platform::macos::WindowExtMacOS, window::Window};

    pub fn glass_available() -> bool {
        crate::native_backdrop::glass_available()
    }

    pub fn reduce_motion() -> bool {
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
    }

    pub fn set_window_alpha(window: &Window, value: f64) {
        native_window(window).setAlphaValue(value.clamp(0., 1.));
    }

    pub fn pose(window: &Window) -> super::Pose {
        let native = native_window(window);
        let frame = native.frame();
        let origin = frame.origin;
        let scale = native
            .contentView()
            .and_then(|v| v.layer())
            .map_or(1., |l| l.transform().m11);
        super::Pose {
            x: origin.x,
            y: origin.y,
            scale,
            width: frame.size.width,
            height: frame.size.height,
            alpha: native.alphaValue(),
        }
    }

    pub fn apply_pose(window: &Window, pose: super::Pose, backdrop: &Backdrop) {
        let native = native_window(window);
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        let frame = NSRect::new(
            NSPoint::new(pose.x, pose.y),
            NSSize::new(pose.width, pose.height),
        );
        let resized = native.frame().size != frame.size;
        if native.frame() != frame {
            native.setFrame_display(frame, false);
        }
        if resized {
            backdrop.resize_viewport(window, true);
        }
        if let Some(root) = native.contentView() {
            root.setWantsLayer(true);
            if let Some(layer) = root.layer() {
                let bounds = layer.bounds();
                let anchor = layer.anchorPoint();
                let scale = pose.scale;
                layer.setTransform(CATransform3D {
                    m11: scale,
                    m12: 0.,
                    m13: 0.,
                    m14: 0.,
                    m21: 0.,
                    m22: scale,
                    m23: 0.,
                    m24: 0.,
                    m31: 0.,
                    m32: 0.,
                    m33: 1.,
                    m34: 0.,
                    m41: (0.5 - anchor.x) * bounds.size.width * (1. - scale),
                    m42: (0.5 - anchor.y) * bounds.size.height * (1. - scale),
                    m43: 0.,
                    m44: 1.,
                });
            }
        }
        native.setAlphaValue(pose.alpha.clamp(0., 1.));
        CATransaction::commit();
    }

    pub fn warp_rect(pose: super::Pose) -> NSRect {
        let mtm = MainThreadMarker::new().expect("window main thread");
        let height = NSScreen::screens(mtm)
            .firstObject()
            .map_or(0., |s| s.frame().size.height);
        NSRect::new(
            NSPoint::new(pose.x, height - pose.y - pose.height),
            NSSize::new(pose.width, pose.height),
        )
    }

    pub fn anchor_pose(window: &Window, value: &Value) -> Option<super::Pose> {
        let x = value["x"].as_f64()?;
        let top = value["y"].as_f64()?;
        let width = value["width"].as_f64()?;
        let height = value["height"].as_f64()?;
        if ![x, top, width, height].iter().all(|n| n.is_finite()) || width < 40. || height < 20. {
            return None;
        }
        let mtm = MainThreadMarker::new()?;
        let screens = NSScreen::screens(mtm);
        let primary = screens.firstObject()?.frame();
        let y = primary.size.height - top - height;
        let frame = native_window(window).frame();
        let frames: Vec<_> = screens.iter().map(|s| s.frame()).collect();
        if !anchor_on_displays(
            &frames,
            NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)),
            frame,
        ) {
            return None;
        }
        if !(40. ..=640.).contains(&width) || !(20. ..=720.).contains(&height) {
            return None;
        }
        Some(super::Pose {
            x: x - 12.,
            y: y - 12.,
            width: width + 24.,
            height: height + 24.,
            scale: 0.98,
            alpha: 1.,
        })
    }

    // NSScreen 的全局逻辑坐标覆盖主屏、随航与负坐标屏幕，不要求两端同屏。
    // 两端独立校验仍连接的屏幕；不要把 backing pixels 混入网格坐标。
    pub(super) fn anchor_on_displays(screens: &[NSRect], source: NSRect, target: NSRect) -> bool {
        let contains = |r: NSRect, px: f64, py: f64| {
            px >= r.origin.x
                && py >= r.origin.y
                && px <= r.origin.x + r.size.width
                && py <= r.origin.y + r.size.height
        };
        let on_screen = |x, y| screens.iter().any(|r| contains(*r, x, y));
        [source.origin.x, source.origin.x + source.size.width]
            .into_iter()
            .all(|x| {
                [source.origin.y, source.origin.y + source.size.height]
                    .into_iter()
                    .all(|y| on_screen(x, y))
            })
            && on_screen(
                target.origin.x + target.size.width / 2.,
                target.origin.y + target.size.height / 2.,
            )
    }

    pub struct Backdrop(crate::native_backdrop::Backdrop);

    impl Backdrop {
        pub fn new(window: &Window) -> Self {
            Self(crate::native_backdrop::Backdrop::new(native_window(window)))
        }

        pub fn style(&self) -> Option<&'static str> {
            self.0.style()
        }

        pub fn resize_viewport(&self, window: &Window, interactive: bool) {
            self.0.resize_viewport(native_window(window), interactive);
        }

        pub fn update(&self, window: &Window, message: &Value) {
            self.0.update(native_window(window), message);
        }
    }

    // WebView IPC 已离开原鼠标事件栈。按 AppKit 的全局点坐标移动，避免窗口跳位；
    // Tao 在 macOS 不支持 drag_resize_window，因此同一手势也处理边角缩放。
    pub struct Gesture {
        mouse: NSPoint,
        frame: NSRect,
        resize_left: Option<bool>,
    }

    pub(super) fn native_window(window: &Window) -> &NSWindow {
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
                frame.size.width = (self.frame.size.width + if left { -dx } else { dx }).max(324.);
                frame.size.height = (self.frame.size.height - dy).max(364.);
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
    macos::set_window_alpha(&window, 0.);
    let page = format!("http://127.0.0.1:{}/panel", runtime.port);
    let url = format!("{page}#token={}&lease={lease}", runtime.token);
    let proxy = event_loop.create_proxy();
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
            "window.__companionNativeMotion = true; window.__companionNativeBackdrop = true; window.__companionNativeGlass = {};",
            macos::glass_available()
        ));
    let webview = builder.build(&window)?;

    let mut gesture: Option<macos::Gesture> = None;
    let backdrop = macos::Backdrop::new(&window);
    let mut reported_glass_style = None;
    let mut window_transition: Option<WindowTransition> = None;
    let mut return_origin: Option<Pose> = None;
    let mut presentation_reported = false;
    let experimental_genie = cfg!(debug_assertions)
        && (crate::assets::development().is_some()
            || std::env::var("CODEX_BUDDY_DEV_GENIE").as_deref() == Ok("1"));
    let mut warp = window_warp::WindowWarp::load(
        macos::native_window(&window).windowNumber() as i32,
        experimental_genie,
    );
    let mut current_bend = [0., 0.];
    let mut motion_pose: Option<Pose> = None;
    let mut warp_source = macos::native_window(&window).frame().size;
    let mut next_motion_frame = std::time::Instant::now();
    event_loop.run(move |event, _, control| {
        *control = ControlFlow::Wait;
        match event {
            Event::UserEvent(message) => match message["kind"].as_str().unwrap_or_default() {
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
                    let mut target = macos::pose(&window);
                    target.alpha = 1.;
                    target.scale = 1.;
                    let anchor = macos::anchor_pose(&window, &message["anchor"])
                        .filter(|p| p.height >= 364. || warp.as_ref().is_some_and(|w| w.available()));
                    let mut from = anchor.unwrap_or(target);
                    from.alpha = 0.;
                    if anchor.is_none() { from.scale = 0.98; }
                    if macos::reduce_motion() { from = target; }
                    warp_source = macos::native_window(&window).frame().size;
                    let mut genie_entry = false;
                    if warp.as_ref().is_some_and(|w| w.available()) && anchor.is_some() && !macos::reduce_motion() {
                        macos::set_window_alpha(&window, 0.);
                        if let Some(warp) = &mut warp {
                            // 显示前先把整窗压到来源区域，避免首帧露出完整矩形。
                            warp.apply(macos::warp_rect(from), warp_source, [0., 0.]);
                            genie_entry = warp.available();
                        }
                    }
                    if !genie_entry { macos::apply_pose(&window, from, &backdrop); }
                    window.set_visible(true);
                    if activate { window.set_focus(); }
                    if macos::reduce_motion() {
                        presentation_reported = true;
                        let _ = webview.evaluate_script("window.__companionPopout?.presented(); window.__companionPopout?.motionFinished();");
                    } else {
                        let mut transition = WindowTransition::new(from, target, Motion::Enter, anchor.is_some());
                        transition.genie_entry = genie_entry;
                        window_transition = Some(transition);
                    }
                }
                "return" => {
                    warp_source = macos::native_window(&window).frame().size;
                    let from = motion_pose.unwrap_or_else(|| macos::pose(&window));
                    return_origin = Some(Pose { scale: 1., alpha: 1., ..from });
                    if let Some(target) = macos::anchor_pose(&window, &message["anchor"])
                        .filter(|p| p.height >= 364. || warp.as_ref().is_some_and(|w| w.available()))
                        && !macos::reduce_motion() {
                        window_transition = Some(WindowTransition::new(from, target, Motion::Return, true));
                    } else {
                        window_transition = None;
                        let _ = webview.evaluate_script("window.__companionPopout?.returned(true);");
                    }
                }
                "cancel-return" => {
                    if motion_pose.is_none() { warp_source = macos::native_window(&window).frame().size; }
                    if let Some(target) = return_origin.take() {
                        let from = motion_pose.unwrap_or_else(|| macos::pose(&window));
                        if macos::reduce_motion() {
                            if let Some(warp) = &mut warp { warp.reset(); }
                            current_bend = [0., 0.];
                            motion_pose = None;
                            macos::apply_pose(&window, target, &backdrop);
                            window_transition = None;
                            let _ = webview.evaluate_script("window.__companionPopout?.motionFinished();");
                        } else {
                            let mut transition = WindowTransition::new(from, target, Motion::Recover, true);
                            transition.initial_bend = current_bend;
                            window_transition = Some(transition);
                        }
                    }
                    let _ = webview.evaluate_script("window.__companionPopout?.returned(false);");
                }
                "close" if !window_transition.as_ref().is_some_and(|t| t.motion == Motion::Close) => {
                    gesture = None;
                    window.set_ignore_cursor_events(true).ok();
                    let from = motion_pose.unwrap_or_else(|| macos::pose(&window));
                    if macos::reduce_motion() || from.alpha <= 0. {
                        *control = ControlFlow::Exit;
                    } else {
                        window_transition = Some(WindowTransition::new(from, Pose { alpha: 0., ..from }, Motion::Close, false));
                    }
                }
                "drag" | "resize" => {
                    if let Some(warp) = &mut warp { warp.reset(); }
                    current_bend = [0., 0.];
                    if window_transition.is_some() || return_origin.is_some() {
                        window_transition = None;
                        return_origin = None;
                        let current = motion_pose.take().unwrap_or_else(|| macos::pose(&window));
                        macos::apply_pose(&window, Pose { scale: 1., alpha: 1., ..current }, &backdrop);
                        let _ = webview.evaluate_script("window.__companionPopout?.returned(false); window.__companionPopout?.motionFinished();");
                        if !presentation_reported {
                            presentation_reported = true;
                            let _ = webview.evaluate_script("window.__companionPopout?.presented();");
                        }
                    }
                    let resize = (message["kind"] == "resize").then_some(message["corner"] == "bl");
                    gesture = macos::Gesture::start(&window, resize);
                    if gesture.is_none() {
                        let _ = webview.evaluate_script("window.__companionFloatingPanel?.nativeGestureEnded();");
                    }
                }
                "pin" => window.set_always_on_top(message["value"] == true),
                "position" => {
                    if let (Some(x), Some(y)) = (message["x"].as_f64(), message["y"].as_f64()) {
                        window.set_outer_position(PhysicalPosition::new(x as i32, y as i32));
                    }
                }
                "size" if window_transition.is_some() => {
                    let _ = webview.evaluate_script(&format!("window.__companionPopout?.resized({});", message["id"]));
                }
                "size" => {
                    let width = message["width"].as_f64().filter(|n| n.is_finite()).unwrap_or(428.).max(324.);
                    let height = message["height"].as_f64().filter(|n| n.is_finite()).unwrap_or(444.).max(364.);
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
        if !matches!(*control, ControlFlow::Exit)
            && let Some(transition) = &mut window_transition
        {
            let now = std::time::Instant::now();
            if now < next_motion_frame {
                *control = ControlFlow::WaitUntil(next_motion_frame);
                return;
            }
            next_motion_frame = now + std::time::Duration::from_millis(16);
            let (pose, finished, bend) = transition.frame(now);
            let motion = transition.motion;
            current_bend = bend;
            motion_pose = Some(pose);
            let use_warp = (transition.spatial || (motion == Motion::Close && motion_pose.is_some()))
                && warp.as_ref().is_some_and(|w| w.available());
            if use_warp {
                if let Some(warp) = &mut warp { warp.apply(macos::warp_rect(pose), warp_source, current_bend); }
                macos::set_window_alpha(&window, pose.alpha);
                if warp.as_ref().is_some_and(|w| !w.available()) { macos::apply_pose(&window, pose, &backdrop); }
            } else { macos::apply_pose(&window, pose, &backdrop); }
            // 已在来源位置接住第一帧即可撤走内嵌，不必等整段移动完成。
            if motion == Motion::Enter && !presentation_reported && pose.alpha >= 0.55 {
                presentation_reported = true;
                let _ = webview.evaluate_script("window.__companionPopout?.presented();");
            }
            if finished {
                if motion != Motion::Return || !use_warp {
                    if let Some(warp) = &mut warp { warp.reset(); }
                    current_bend = [0., 0.];
                    if motion != Motion::Close { macos::apply_pose(&window, pose, &backdrop); }
                    motion_pose = None;
                }
                let status = warp.as_ref().map_or(json!({"supported":false}), |warp| warp.status());
                let _ = webview.evaluate_script(&format!("window.__companionNativeWarp = {status};"));
                window_transition = None;
                match motion {
                    Motion::Close => *control = ControlFlow::Exit,
                    Motion::Return => { let _ = webview.evaluate_script("window.__companionPopout?.returned(true);"); }
                    Motion::Enter | Motion::Recover => {
                        let _ = webview.evaluate_script("window.__companionPopout?.motionFinished();");
                    }
                }
            } else {
                *control = ControlFlow::WaitUntil(
                    std::time::Instant::now() + std::time::Duration::from_millis(16),
                );
            }
        }
    })
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

#[cfg(test)]
mod motion_tests {
    use super::*;

    #[test]
    fn anchors_can_cross_screens_but_not_target_disconnected_displays() {
        use objc2_foundation::{NSPoint, NSRect, NSSize};
        let rect = |x, y, w, h| NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
        let primary = rect(0., 0., 2048., 1152.);
        let source = rect(300., 600., 404., 376.);
        for (x, y) in [(171., -1155.), (-1539., 0.), (0., 1152.), (2048., 0.)] {
            let secondary = rect(x, y, 1539., 1155.);
            let target = rect(x + 100., y + 100., 428., 649.);
            assert!(macos::anchor_on_displays(
                &[primary, secondary],
                source,
                target
            ));
            assert!(macos::anchor_on_displays(
                &[primary, secondary],
                target,
                source
            ));
            assert!(!macos::anchor_on_displays(&[primary], source, target));
            assert!(!macos::anchor_on_displays(&[primary], target, source));
        }
    }

    #[test]
    fn genie_entry_reverses_return_without_a_hidden_or_held_start() {
        for (width, height) in [(108., 70.), (428., 400.)] {
            let source = Pose {
                x: 300.,
                y: 400.,
                width,
                height,
                scale: 0.98,
                alpha: 1.,
            };
            let destination = Pose {
                x: 700.,
                y: 200.,
                width: 428.,
                height: 649.,
                scale: 1.,
                alpha: 1.,
            };
            let returning = WindowTransition::new(destination, source, Motion::Return, true);
            let mut entering = WindowTransition::new(
                Pose {
                    alpha: 0.,
                    ..source
                },
                destination,
                Motion::Enter,
                true,
            );
            entering.genie_entry = true;
            for step in 0..=16 {
                let t = f64::from(step) / 16.;
                let enter_time = entering.started + entering.duration.mul_f64(t);
                let return_time = returning.started + returning.duration.mul_f64(1. - t);
                let (entry, _) = entering.value(enter_time);
                let (exit, _) = returning.value(return_time);
                for (a, b) in [
                    (entry.x, exit.x),
                    (entry.y, exit.y),
                    (entry.width, exit.width),
                    (entry.height, exit.height),
                    (entry.scale, exit.scale),
                ] {
                    assert!((a - b).abs() < 1e-8);
                }
                assert_eq!(entry.alpha, 1.);
                for (a, b) in entering
                    .bend(enter_time)
                    .into_iter()
                    .zip(returning.bend(return_time))
                {
                    assert!((a - b).abs() < 1e-8);
                }
                if step > 0 {
                    assert!(entry.x > source.x);
                }
                if step < 16 {
                    assert!(entry.height < destination.height);
                }
            }
        }
    }

    #[test]
    fn lift_holds_the_source_until_visible_and_finishes_at_rest() {
        let from = Pose {
            x: 300.,
            y: 400.,
            width: 428.,
            height: 400.,
            scale: 0.98,
            alpha: 0.,
        };
        let to = Pose {
            x: 700.,
            y: 200.,
            width: 428.,
            height: 649.,
            scale: 1.,
            alpha: 1.,
        };
        let motion = WindowTransition::new(from, to, Motion::Enter, true);
        let (handoff, _) = motion.value(motion.started + std::time::Duration::from_millis(50));
        assert!(handoff.alpha >= 0.55);
        assert_eq!(handoff.x, from.x);
        assert_eq!(handoff.height, from.height);
        let (last, finished) = motion.value(motion.started + motion.duration);
        assert!(finished);
        assert_eq!(last.x, to.x);
        assert!((last.y - to.y).abs() < 1e-9);
        assert_eq!(last.height, to.height);
        assert_eq!(last.scale, 1.);
        assert_eq!(last.alpha, 1.);
        let mut close = WindowTransition::new(to, Pose { alpha: 0., ..to }, Motion::Close, false);
        let (first, finished, _) =
            close.frame(close.started + std::time::Duration::from_millis(250));
        assert!(!finished && first.alpha > 0. && first.alpha < 1.);
    }

    #[test]
    fn reversing_a_return_starts_at_its_current_pose() {
        let from = Pose {
            x: 700.,
            y: 200.,
            width: 428.,
            height: 649.,
            scale: 1.,
            alpha: 1.,
        };
        let to = Pose {
            x: 300.,
            y: 400.,
            width: 428.,
            height: 400.,
            scale: 0.98,
            alpha: 1.,
        };
        let motion = WindowTransition::new(from, to, Motion::Return, true);
        let (current, _) = motion.value(motion.started + std::time::Duration::from_millis(100));
        let reversed = WindowTransition::new(current, from, Motion::Recover, true);
        let (first, _) = reversed.value(reversed.started);
        assert_eq!(first.x, current.x);
        assert_eq!(first.y, current.y);
        assert_eq!(first.height, current.height);
        assert_eq!(first.scale, current.scale);
        assert_eq!(first.alpha, 1.);
    }
}
