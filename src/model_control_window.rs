// [INPUT]: Paths/Runtime、独立 model-control HTTP/IPC、AppKit/Wry/Tao。
// [OUTPUT]: macOS 14+ 非激活 NSPanel、原生鼠标边界事件、内容高度与凹角命中、宿主桌面跟随、统一开合进度与独立四主题、显示器枚举与租约退出。
// [POS]: 独立窗口子进程；不依赖 panel/workbench，不启动或终止官方宿主。
// [PROTOCOL]: 集成需在 main 声明模块，并启用 AppKit NSPanel/NSColor/NSResponder features。

#[path = "model_control_geometry.rs"]
mod geometry;

use crate::{config::Paths, lifecycle::Runtime};
use anyhow::{Context, Result};
use geometry::{Edge, Rect, Screen, SurfaceRegion};
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, rc::Retained};
use objc2_app_kit::{
    NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSBackingStoreType,
    NSColor, NSEvent, NSEventModifierFlags, NSPanel, NSScreen, NSStatusWindowLevel, NSView,
    NSWindowAnimationBehavior, NSWindowCollectionBehavior, NSWindowStyleMask, NSWorkspace,
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, ns_string};
use serde_json::{Value, json};
use std::{
    cell::Cell,
    ffi::c_void,
    ptr::NonNull,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    platform::{
        macos::{ActivationPolicy, EventLoopExtMacOS},
        run_return::EventLoopExtRunReturn,
    },
};
use wry::{
    WebView, WebViewBuilder,
    raw_window_handle::{
        AppKitWindowHandle, HandleError, HasWindowHandle, RawWindowHandle, WindowHandle,
    },
};

#[derive(Default)]
struct KeyboardGate {
    allowed: Cell<bool>,
}

#[derive(Default)]
struct HitRegion {
    excluded: Cell<Rect>,
    allowed: Cell<Rect>,
    edge: Cell<Edge>,
}

define_class!(
    #[unsafe(super = NSView)]
    #[name = "CodexBuddyModelControlView"]
    #[thread_kind = MainThreadOnly]
    #[ivars = HitRegion]
    struct ControlView;

    impl ControlView {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, point: NSPoint) -> *mut NSView {
            if !(SurfaceRegion {rect: self.ivars().allowed.get(), edge: self.ivars().edge.get()}).contains(point.x, point.y)
                || self.ivars().excluded.get().contains(point.x, point.y) { return std::ptr::null_mut(); }
            unsafe { msg_send![super(self), hitTest: point] }
        }
    }
);

define_class!(
    // 创建真实 NSPanel 子类；从不更改 Tao/NSWindow 的 Objective-C isa。
    #[unsafe(super = NSPanel)]
    #[name = "CodexBuddyModelControlPanel"]
    #[thread_kind = MainThreadOnly]
    #[ivars = KeyboardGate]
    struct ControlPanel;

    impl ControlPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool { self.ivars().allowed.get() }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main(&self) -> bool { false }
    }
);

impl ControlPanel {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(KeyboardGate::default());
        // NSPanel designated initializer; the mask is fixed for the panel's entire life.
        let panel: Retained<Self> = unsafe {
            msg_send![super(this),
                initWithContentRect: NSRect::new(NSPoint::ZERO, NSSize::new(geometry::COMPACT_DEPTH, geometry::COMPACT_LENGTH)),
                styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
                backing: NSBackingStoreType::Buffered, defer: false
            ]
        };
        unsafe { panel.setReleasedWhenClosed(false) };
        panel.setLevel(NSStatusWindowLevel);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::Default
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        panel.setHasShadow(false);
        panel.setAnimationBehavior(NSWindowAnimationBehavior::None);
        panel.setHidesOnDeactivate(false);
        panel.setBecomesKeyOnlyIfNeeded(true);
        panel.setAcceptsMouseMovedEvents(true);
        panel.setMovable(false);
        panel.setMovableByWindowBackground(false);
        panel
    }
}

// Wry re-exports raw-window-handle 0.6; no additional Cargo dependency is needed.
struct NativeParent(Retained<ControlView>);
impl HasWindowHandle for NativeParent {
    fn window_handle(&self) -> std::result::Result<WindowHandle<'_>, HandleError> {
        let pointer = NonNull::from(&*self.0).cast();
        // The retained NSView belongs to our NSPanel and outlives the WebView.
        Ok(unsafe {
            WindowHandle::borrow_raw(RawWindowHandle::AppKit(AppKitWindowHandle::new(pointer)))
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Appearance {
    material: String,
    liquid_variant: String,
    font_offset: f64,
    host_theme: Value,
}
impl Appearance {
    fn read(value: &Value) -> Self {
        let ui = value;
        Self {
            host_theme: ui["hostTheme"].clone(),
            material: match ui["material"].as_str() {
                Some("frosted") => "frosted",
                Some("native-glass") => "native-glass",
                _ => "matte",
            }
            .into(),
            font_offset: ui["fontOffset"]
                .as_f64()
                .filter(|n| n.is_finite())
                .unwrap_or(0.),
            liquid_variant: if ui["liquidVariant"] == "clear" {
                "clear"
            } else {
                "regular"
            }
            .into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Preferences {
    edge: Edge,
    position: f64,
    screen: String,
    keep_open: bool,
    theme: String,
    liquid_variant: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            edge: Edge::Right,
            position: 0.5,
            screen: String::new(),
            keep_open: false,
            theme: "black".into(),
            liquid_variant: "regular".into(),
        }
    }
}
impl Preferences {
    fn read(value: &Value) -> Self {
        Self {
            edge: value["edge"]
                .as_str()
                .and_then(Edge::parse)
                .unwrap_or_default(),
            position: geometry::fraction(value["position"].as_f64().unwrap_or(0.5)),
            screen: value["screen"].as_str().unwrap_or_default().to_owned(),
            keep_open: value["keepOpen"].as_bool().unwrap_or(false),
            theme: value["theme"].as_str().unwrap_or("black").into(),
            liquid_variant: value["liquidVariant"].as_str().unwrap_or("regular").into(),
        }
    }
}

#[derive(Debug)]
enum Message {
    Ipc(Value),
    Snapshot { value: Value, revision: u64 },
    PreferenceError,
    BackendGone,
    Hotkey,
}

struct Patch {
    revision: u64,
    value: Value,
}

struct Backend {
    sender: tokio::sync::mpsc::UnboundedSender<Patch>,
    stopped: Arc<AtomicBool>,
}

impl Backend {
    fn start(runtime: Runtime, lease: String, proxy: EventLoopProxy<Message>) -> Result<Self> {
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<Patch>();
        let stopped = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        std::thread::Builder::new().name("model-control-lease".into()).spawn(move || {
            let result = (|| -> Result<()> {
                let executor = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
                executor.block_on(async {
                    let client = reqwest::Client::builder().no_proxy()
                        .redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(2)).build()?;
                    let base = format!("http://127.0.0.1:{}/api/model-control", runtime.port);
                    let mut interval = tokio::time::interval(Duration::from_secs(1));
                    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                    let mut revision = 0;
                    while !stop.load(Ordering::Relaxed) {
                        tokio::select! {
                            _ = interval.tick() => {
                                let value: Value = client.get(format!("{base}/window"))
                                    .query(&[("lease", &lease)]).bearer_auth(&runtime.token)
                                    .send().await?.error_for_status()?.json().await?;
                                if value["valid"] != true { break; }
                                if proxy.send_event(Message::Snapshot { value, revision }).is_err() { break; }
                            }
                            patch = receiver.recv() => {
                                let Some(mut patch) = patch else { break; };
                                // 拖动只写最新偏好；合并字段而不是丢弃期间的 edge/keepOpen 修改。
                                while let Ok(next) = receiver.try_recv() {
                                    if let (Some(a), Some(b)) = (patch.value.as_object_mut(), next.value.as_object()) {
                                        a.extend(b.clone());
                                    }
                                    patch.revision = next.revision;
                                }
                                let response = client.post(format!("{base}/preferences"))
                                    .bearer_auth(&runtime.token).json(&json!({"patch": patch.value})).send().await;
                                revision = patch.revision;
                                if response.and_then(|r| r.error_for_status()).is_err() {
                                    let _ = proxy.send_event(Message::PreferenceError);
                                }
                            }
                        }
                    }
                    Ok(())
                })
            })();
            if result.is_err() { tracing::debug!("model-control backend unavailable"); }
            let _ = proxy.send_event(Message::BackendGone);
        }).context("无法启动模型控窗租约线程")?;
        Ok(Self { sender, stopped })
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
}

struct Surface {
    // Drop WebView before its retained parent and panel.
    webview: WebView,
    backdrop: crate::native_backdrop::Backdrop,
    content_height: f64,
    pointer_state: Option<Value>,
    hover_suppressed: Vec<SurfaceRegion>,
    _parent: NativeParent,
    panel: Retained<ControlPanel>,
    prefs: Preferences,
    appearance: Appearance,
    screen: Option<Screen>,
    host: Value,
    host_attached: bool,
    expanded: bool,
    unfold: geometry::Unfold,
    motion_tick: Instant,
    screen_check: Instant,
    keyboard: bool,
    hidden: bool,
    ready: bool,
    valid: bool,
    reveal: Option<u64>,
    pending_keyboard: bool,
    revision: u64,
    preference_error: bool,
    shortcut_error: Option<String>,
    last_detail: Option<Value>,
    last_backdrop: Option<Value>,
}

impl Surface {
    fn effective_material(&self) -> &str {
        if self.prefs.theme == "native-glass" && !crate::native_backdrop::glass_available() {
            "matte"
        } else {
            &self.prefs.theme
        }
    }

    fn dispatch(&mut self) {
        if !self.ready {
            return;
        }
        let presenting = self.expanded || self.unfold.active(self.expanded);
        let screen = self.screen.as_ref();
        let size = self.panel.frame().size;
        let compact = screen
            .map(|s| geometry::layout(s, self.prefs.edge, self.prefs.position, false))
            .unwrap_or_default();
        let notch = screen
            .map(|s| {
                geometry::excluded_notch(s, rect(self.panel.frame()), self.prefs.edge, presenting)
            })
            .unwrap_or_default();
        let offset = screen.map_or(0., |s| {
            geometry::content_offset(s, self.prefs.edge, presenting)
        });
        let detail = json!({
            "expanded": self.expanded, "unfold": self.unfold.value.clamp(0.,1.), "animating": self.unfold.active(self.expanded),
            "layoutWidth": screen.map_or(480., |s| geometry::layout(s,self.prefs.edge,self.prefs.position,true).width),
            "keyboard": self.keyboard, "edge": self.prefs.edge.as_str(),
            "position": self.prefs.position, "screen": screen.map(|s| &s.id),
            "preferredScreen": self.prefs.screen, "keepOpen": self.prefs.keep_open, "hidden": self.hidden,
            "notchWidth": screen.map_or(0., |s| s.notch_width), "notchHeight": screen.map_or(0., |s| s.notch_height),
            "width": size.width, "height": size.height,
            "compactWidth": compact.width, "compactHeight": compact.height,
            "notchX": notch.x, "notchY": if notch.height > 0. { size.height - notch.y - notch.height } else { 0. },
            "contentOffsetY": offset, "contentHeight": (size.height - offset).max(0.),
            "shortcutAvailable": self.shortcut_error.is_none(), "shortcutError": self.shortcut_error,
            "preferenceError": if self.preference_error { Some("无法保存模型控窗偏好，请稍后重试") } else { None },
            "appearance": {"material": self.appearance.material, "liquidVariant": self.appearance.liquid_variant, "fontOffset": self.appearance.font_offset, "hostTheme":self.appearance.host_theme},
            "nativeDark": self.panel.effectiveAppearance().bestMatchFromAppearancesWithNames(
                &NSArray::from_slice(&[unsafe {NSAppearanceNameDarkAqua}, unsafe {NSAppearanceNameAqua}])
            ).is_some_and(|name| name.isEqualToString(unsafe {NSAppearanceNameDarkAqua})),
            "theme": self.prefs.theme, "liquidVariant": self.prefs.liquid_variant,
            "effectiveMaterial": self.effective_material(),
            "availableHeight": screen.map_or(640., |s| s.usable.height) + offset,
            "nativeGlassAvailable": crate::native_backdrop::glass_available(),
            "nativeBackdrop": self.backdrop.style().is_some(), "backdropStyle": self.backdrop.style(),
        });
        // 页面用 keyboard 变化安排输入焦点；重复轮询不能把预设编辑器的焦点抢回搜索框。
        if self.last_detail.as_ref() == Some(&detail) {
            return;
        }
        self.last_detail = Some(detail.clone());
        let _ = self.webview.evaluate_script(&format!(
            "window.dispatchEvent(new CustomEvent('model-control-native',{{detail:{detail}}}));"
        ));
    }

    fn reflow(&mut self, mtm: MainThreadMarker) -> Result<()> {
        if self.host["visible"] != true {
            self.release_keyboard();
            self.panel.orderOut(None);
            return Ok(());
        }
        // Only the connected host acquiring focus may move this panel to a Space.
        // Background polling, hover and a global hotkey must never bring it elsewhere.
        if self.host["focused"] == true {
            self.host_attached = true;
            if self.ready && self.valid && !self.hidden && !self.panel.isOnActiveSpace() {
                let behavior = self.panel.collectionBehavior();
                self.panel.setCollectionBehavior(
                    behavior | NSWindowCollectionBehavior::MoveToActiveSpace,
                );
                self.panel.orderFrontRegardless();
                self.panel.setCollectionBehavior(behavior);
            }
        }
        if !self.host_attached {
            return Ok(());
        }
        let refresh_screen = self.screen.is_none() || Instant::now() >= self.screen_check;
        let previous_screen = self.screen.clone();
        if refresh_screen {
            self.screen_check = Instant::now() + Duration::from_secs(1);
            let screens = screen_snapshots(mtm);
            let pointer = NSEvent::mouseLocation();
            let current = self.screen.as_ref().map_or("", |s| s.id.as_str());
            let selected = geometry::select_screen(
                &screens,
                &self.prefs.screen,
                current,
                (pointer.x, pointer.y),
            )
            .cloned();
            self.screen = selected;
        }
        let changed = previous_screen != self.screen;
        let Some(screen) = self.screen.as_ref() else {
            self.panel.orderOut(None);
            return Ok(());
        };
        let target = geometry::layout_height(
            screen,
            self.prefs.edge,
            self.prefs.position,
            true,
            self.content_height,
        );
        let compact = geometry::layout(screen, self.prefs.edge, self.prefs.position, false);
        let now = Instant::now();
        self.unfold.step(
            self.expanded,
            (now - self.motion_tick).as_secs_f64(),
            NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion(),
        );
        self.motion_tick = now;
        let presenting = self.expanded || self.unfold.active(self.expanded);
        let rect = self.unfold.frame(compact, target);
        self._parent
            .0
            .ivars()
            .excluded
            .set(geometry::excluded_notch(
                screen,
                rect,
                self.prefs.edge,
                presenting,
            ));
        let offset = geometry::content_offset(screen, self.prefs.edge, presenting);
        let allowed = if self.prefs.edge == Edge::Top && screen.notch_width > 0. && !presenting {
            Rect {
                x: (screen.notch_x - rect.x - geometry::NOTCH_FLANK).max(0.),
                y: 0.,
                width: geometry::NOTCH_FLANK,
                height: rect.height,
            }
        } else {
            Rect {
                x: 0.,
                y: 0.,
                width: rect.width,
                height: (rect.height - offset).max(0.),
            }
        };
        self._parent.0.ivars().allowed.set(allowed);
        self._parent.0.ivars().edge.set(self.prefs.edge);
        let frame = NSRect::new(
            NSPoint::new(rect.x, rect.y),
            NSSize::new(rect.width, rect.height),
        );
        let resized = self.panel.frame() != frame;
        if resized {
            self.panel.setFrame_display(frame, false);
            self.webview.set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0., 0.).into(),
                size: wry::dpi::LogicalSize::new(rect.width, rect.height).into(),
            })?;
        }
        let backdrop = json!({
            "material": self.effective_material(), "liquidVariant": self.prefs.liquid_variant,
            "theme": if self.prefs.theme == "black" { json!("dark") } else { self.appearance.host_theme["theme"].clone() },
            "x":0., "y":0., "width":rect.width, "height":rect.height,
            "radius":0., "hidden": self.hidden, "edge":self.prefs.edge.as_str(),
            "viewportWidth":rect.width, "viewportHeight":rect.height,
        });
        if self.last_backdrop.as_ref() != Some(&backdrop) {
            self.backdrop.resize_viewport(&self.panel, false);
            self.backdrop.update(&self.panel, &backdrop);
            if self.backdrop.style().is_some() {
                let notch = (self.prefs.edge == Edge::Top && screen.notch_width > 0.).then_some((
                    screen.notch_x - rect.x,
                    screen.notch_width,
                    screen.notch_height,
                ));
                let content_top = if notch.is_some() && !presenting {
                    rect.height
                } else {
                    offset
                };
                self.backdrop.clip_edge(
                    rect.width,
                    rect.height,
                    self.prefs.edge.as_str(),
                    content_top,
                    notch,
                );
            }
            self.last_backdrop = Some(backdrop);
        }
        if self.valid
            && self.ready
            && !self.hidden
            && !self.panel.isVisible()
            && (self.host["focused"] == true || self.panel.isOnActiveSpace())
        {
            self.panel.orderFrontRegardless();
        }
        if changed || resized {
            self.dispatch();
        }
        self.mouse_passthrough();
        Ok(())
    }

    fn hover_regions(&self) -> Vec<SurfaceRegion> {
        let frame = rect(self.panel.frame());
        let allowed = self._parent.0.ivars().allowed.get();
        let mut regions = vec![SurfaceRegion {
            edge: self.prefs.edge,
            rect: Rect {
                x: frame.x + allowed.x,
                y: frame.y + allowed.y,
                ..allowed
            },
        }];
        // Keep the original notch flank connected to the expanded content below it.
        if let Some(screen) = &self.screen
            && self.expanded
            && self.prefs.edge == Edge::Top
            && screen.notch_width > 0.
        {
            regions.push(SurfaceRegion {
                edge: Edge::Top,
                rect: Rect {
                    x: screen.notch_x - geometry::NOTCH_FLANK,
                    y: frame.y + frame.height
                        - geometry::content_offset(screen, self.prefs.edge, true),
                    width: geometry::NOTCH_FLANK,
                    height: geometry::content_offset(screen, self.prefs.edge, true),
                },
            });
        }
        regions
    }

    fn mouse_passthrough(&mut self) {
        if !self.ready
            || !self.valid
            || self.hidden
            || !self.panel.isVisible()
            || !self.panel.isOnActiveSpace()
        {
            return;
        }
        let point = NSEvent::mouseLocation();
        let buttons = NSEvent::pressedMouseButtons();
        let frame = rect(self.panel.frame());
        let x = point.x - frame.x;
        let y = point.y - frame.y;
        let regions = self._parent.0.ivars();
        let excluded = regions.excluded.get().contains(x, y);
        let ignored = buttons == 0
            && frame.contains(point.x, point.y)
            && (!SurfaceRegion {
                rect: regions.allowed.get(),
                edge: self.prefs.edge,
            }
            .contains(x, y)
                || excluded);
        if self.panel.ignoresMouseEvents() != ignored {
            self.panel.setIgnoresMouseEvents(ignored);
        }
        if !self
            .hover_suppressed
            .iter()
            .any(|r| r.contains(point.x, point.y))
        {
            self.hover_suppressed.clear();
        }
        let inside = !excluded
            && self
                .hover_regions()
                .iter()
                .any(|r| r.contains(point.x, point.y));
        let detail = json!({"inside": inside, "buttons": buttons, "option": NSEvent::modifierFlags_class().contains(NSEventModifierFlags::Option), "hoverSuppressed": !self.hover_suppressed.is_empty()});
        if self.pointer_state.as_ref() != Some(&detail) {
            self.pointer_state = Some(detail.clone());
            let _ = self.webview.evaluate_script(&format!(
                "window.dispatchEvent(new CustomEvent('model-control-pointer',{{detail:{detail}}}));"
            ));
        }
    }

    fn release_keyboard(&mut self) {
        // Ordering out a nonactivating key panel returns keyboard ownership to the prior app.
        if self.panel.isKeyWindow() {
            self.panel.orderOut(None);
        }
        self.panel.ivars().allowed.set(false);
        self.keyboard = false;
        self.pending_keyboard = false;
    }

    fn expand(&mut self, keyboard: bool, mtm: MainThreadMarker) -> Result<()> {
        if self.host["visible"] != true
            || !self.host_attached
            || (self.host["focused"] != true && !self.panel.isOnActiveSpace())
        {
            return Ok(());
        }
        self.hidden = false;
        if !self.unfold.active(self.expanded) {
            self.motion_tick = Instant::now();
        }
        self.expanded = true;
        self.reflow(mtm)?;
        if keyboard && self.valid && self.ready && self.screen.is_some() {
            self.panel.ivars().allowed.set(true);
            self.panel.makeKeyWindow();
            self.webview.focus()?;
            self.keyboard = self.panel.isKeyWindow();
            self.pending_keyboard = false;
        } else if keyboard {
            self.pending_keyboard = true;
        }
        self.dispatch();
        Ok(())
    }

    fn persist(&mut self, backend: &Backend, value: Value) {
        self.revision += 1;
        self.preference_error = backend
            .sender
            .send(Patch {
                revision: self.revision,
                value,
            })
            .is_err();
    }

    fn ipc(&mut self, value: &Value, backend: &Backend, mtm: MainThreadMarker) -> Result<()> {
        match value["action"].as_str().unwrap_or_default() {
            "ready" => {
                self.ready = true;
                self.last_detail = None;
                self.pointer_state = None;
                self.reflow(mtm)?;
                if self.pending_keyboard {
                    self.expand(true, mtm)?;
                }
            }
            "expand" => self.expand(value["keyboard"] == true, mtm)?,
            "focus" => self.expand(true, mtm)?,
            "collapse" => {
                self.hover_suppressed = self.hover_regions();
                self.release_keyboard();
                if !self.unfold.active(self.expanded) {
                    self.motion_tick = Instant::now();
                }
                self.expanded = false;
                if self.prefs.keep_open {
                    self.prefs.keep_open = false;
                    self.persist(backend, json!({"keepOpen": false}));
                }
                self.reflow(mtm)?;
            }
            "content-size" => {
                if let Some(height) = value["height"].as_f64().filter(|v| v.is_finite()) {
                    let height = height.clamp(144., 2000.);
                    if (height - self.content_height).abs() >= 1. {
                        self.content_height = height;
                        self.reflow(mtm)?;
                    }
                }
            }
            "hide" => {
                self.release_keyboard();
                self.hidden = true;
                self.panel.orderOut(None);
            }
            "position" => {
                if let Some(delta) = value["delta"].as_f64().filter(|v| v.is_finite()) {
                    self.prefs.position = geometry::fraction(self.prefs.position + delta);
                    let mut patch = json!({"position": self.prefs.position});
                    // 只有用户的显式拖动才采纳当前回退屏幕；轮询/reflow 从不写屏幕身份。
                    if let Some(screen) = &self.screen
                        && !screen.id.is_empty()
                    {
                        self.prefs.screen = screen.id.clone();
                        patch["screen"] = json!(screen.id);
                    }
                    self.persist(backend, patch);
                    self.reflow(mtm)?;
                }
            }
            "edge" => {
                if let Some(edge) = value["edge"].as_str().and_then(Edge::parse) {
                    self.prefs.edge = edge;
                    self.persist(backend, json!({"edge": edge.as_str()}));
                    self.reflow(mtm)?;
                }
            }
            _ => {}
        }
        self.dispatch();
        Ok(())
    }

    fn snapshot(&mut self, value: Value, revision: u64, mtm: MainThreadMarker) -> Result<()> {
        self.valid = true;
        self.host = value["host"].clone();
        let mut appearance = Appearance::read(&value["appearance"]);
        if !matches!(
            appearance.host_theme["theme"].as_str(),
            Some("light" | "dark")
        ) {
            appearance.host_theme = self.appearance.host_theme.clone();
        }
        self.appearance = appearance;
        let reveal = value["reveal"].as_u64().unwrap_or(0);
        let requested = self.reveal.is_some_and(|previous| previous != reveal);
        self.reveal = Some(reveal);
        if revision >= self.revision {
            let prefs = Preferences::read(&value["preferences"]);
            if prefs.keep_open {
                self.expanded = true;
            } else if self.prefs.keep_open && !self.keyboard {
                self.expanded = false;
            }
            self.prefs = prefs;
        }
        // Native polling also recovers from changed resolution, scaling, Dock or display topology.
        self.reflow(mtm)?;
        if requested || self.pending_keyboard {
            self.expand(true, mtm)?;
        }
        self.dispatch();
        Ok(())
    }
}

pub fn run(paths: &Paths, lease: &str) -> Result<()> {
    let mtm = MainThreadMarker::new().context("模型控窗必须在主线程启动")?;
    let runtime = Runtime::read(paths)?;
    let mut event_loop = EventLoopBuilder::<Message>::with_user_event().build();
    event_loop.set_activation_policy(ActivationPolicy::Accessory);
    event_loop.set_activate_ignoring_other_apps(false);
    let panel = ControlPanel::new(mtm);
    let view: Retained<ControlView> = unsafe {
        msg_send![super(ControlView::alloc(mtm).set_ivars(HitRegion::default())),
            initWithFrame: NSRect::new(NSPoint::ZERO, NSSize::new(geometry::COMPACT_DEPTH, geometry::COMPACT_LENGTH))]
    };
    panel.setContentView(Some(&view));
    let parent = NativeParent(view);
    let page = format!("http://127.0.0.1:{}/model-control", runtime.port);
    let mut url = reqwest::Url::parse(&page)?;
    let fragment = reqwest::Url::parse_with_params(
        "http://localhost/",
        &[("token", runtime.token.as_str()), ("lease", lease)],
    )?;
    url.set_fragment(fragment.query());
    let allowed = page;
    let proxy = event_loop.create_proxy();
    let webview = WebViewBuilder::new()
        .with_url(url.as_str())
        .with_transparent(true)
        .with_focused(false)
        .with_accept_first_mouse(true)
        .with_navigation_handler(move |url| {
            url == allowed || url.starts_with(&format!("{allowed}#"))
        })
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .with_ipc_handler(move |request| {
            if request.body().len() <= 8192
                && let Ok(value) = serde_json::from_str(request.body())
            {
                let _ = proxy.send_event(Message::Ipc(value));
            }
        })
        .with_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0., 0.).into(),
            size: wry::dpi::LogicalSize::new(geometry::COMPACT_DEPTH, geometry::COMPACT_LENGTH)
                .into(),
        })
        .build_as_child(&parent)?;
    let (hotkey, shortcut_error) = match Hotkey::register(event_loop.create_proxy()) {
        Ok(hotkey) => (Some(hotkey), None),
        Err(error) => (None, Some(error)),
    };
    let backend = Backend::start(runtime, lease.into(), event_loop.create_proxy())?;
    let backdrop = crate::native_backdrop::Backdrop::new(&panel);
    let mut surface = Surface {
        webview,
        backdrop,
        content_height: 274.,
        pointer_state: None,
        hover_suppressed: Vec::new(),
        _parent: parent,
        panel,
        prefs: Preferences::default(),
        appearance: Appearance::read(&Value::Null),
        screen: None,
        host: Value::Null,
        host_attached: false,
        expanded: false,
        unfold: geometry::Unfold::default(),
        motion_tick: Instant::now(),
        screen_check: Instant::now(),
        keyboard: false,
        hidden: false,
        ready: false,
        valid: false,
        reveal: None,
        pending_keyboard: false,
        revision: 0,
        preference_error: false,
        shortcut_error,
        last_detail: None,
        last_backdrop: None,
    };
    let mut error = None;
    let mut next_tick = Instant::now();
    event_loop.run_return(|event, _, control| {
        *control = ControlFlow::Wait;
        let result = match event {
            Event::UserEvent(Message::BackendGone) => {
                *control = ControlFlow::Exit;
                Ok(())
            }
            Event::UserEvent(Message::Snapshot { value, revision }) => {
                surface.snapshot(value, revision, mtm)
            }
            Event::UserEvent(Message::PreferenceError) => {
                surface.preference_error = true;
                surface.dispatch();
                Ok(())
            }
            Event::UserEvent(Message::Ipc(value)) => surface.ipc(&value, &backend, mtm),
            Event::UserEvent(Message::Hotkey) => {
                if surface.expanded && surface.keyboard && surface.panel.isKeyWindow() {
                    surface.ipc(&json!({"action": "collapse"}), &backend, mtm)
                } else {
                    surface.expand(true, mtm)
                }
            }
            Event::MainEventsCleared if Instant::now() >= next_tick => {
                next_tick = Instant::now() + Duration::from_millis(16);
                surface.mouse_passthrough();
                if surface.keyboard && !surface.panel.isKeyWindow() {
                    surface.panel.ivars().allowed.set(false);
                    surface.keyboard = false;
                    surface.dispatch();
                }
                if (surface.unfold.active(surface.expanded)
                    && surface.motion_tick.elapsed() >= Duration::from_millis(16))
                    || Instant::now() >= surface.screen_check
                {
                    surface.reflow(mtm)
                } else {
                    Ok(())
                }
            }
            _ => Ok(()),
        };
        if let Err(failure) = result {
            error = Some(failure);
            *control = ControlFlow::Exit;
        }
        // NSEvent mouseLocation also detects entry before an inactive WebView gets any events.
        // No event tap, input permission or focus change is involved.
        if !matches!(*control, ControlFlow::ExitWithCode(_))
            && !surface.hidden
            && surface.ready
            && surface.valid
        {
            *control = ControlFlow::WaitUntil(next_tick);
        }
    });
    surface.panel.orderOut(None);
    drop(hotkey); // Unregister callbacks while their EventLoopProxy is still alive.
    drop(backend);
    error.map_or(Ok(()), Err)
}

fn rect(value: NSRect) -> Rect {
    Rect {
        x: value.origin.x,
        y: value.origin.y,
        width: value.size.width,
        height: value.size.height,
    }
}

fn screen_snapshots(mtm: MainThreadMarker) -> Vec<Screen> {
    NSScreen::screens(mtm)
        .iter()
        .filter_map(|screen| {
            let frame = rect(screen.frame());
            let visible = rect(screen.visibleFrame());
            let safe = screen.safeAreaInsets();
            let x = (frame.x + safe.left).max(visible.x);
            let y = (frame.y + safe.bottom).max(visible.y);
            let right = (frame.x + frame.width - safe.right).min(visible.x + visible.width);
            let top = (frame.y + frame.height - safe.top).min(visible.y + visible.height);
            if right - x < 1. || top - y < 1. {
                return None;
            }
            let left = screen.auxiliaryTopLeftArea();
            let right_area = screen.auxiliaryTopRightArea();
            let notch_width = if safe.top > 0. && left.size.width > 0. && right_area.size.width > 0.
            {
                (frame.width - left.size.width - right_area.size.width).max(0.)
            } else {
                0.
            };
            Some(Screen {
                id: display_identity(&screen),
                frame,
                usable: Rect {
                    x,
                    y,
                    width: right - x,
                    height: top - y,
                },
                notch_width,
                notch_height: if notch_width > 0. { safe.top } else { 0. },
                notch_x: left.origin.x + left.size.width,
            })
        })
        .collect()
}

#[repr(C)]
struct UuidBytes {
    bytes: [u8; 16],
}
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGDisplayCreateUUIDFromDisplayID(display: u32) -> *const c_void;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> NSRect;
    fn CGDisplayIsBuiltin(display: u32) -> u32;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFUUIDGetUUIDBytes(uuid: *const c_void) -> UuidBytes;
    fn CFRelease(value: *const c_void);
}

fn display_identity(screen: &NSScreen) -> String {
    let description = screen.deviceDescription();
    let Some(number) = description.objectForKey(ns_string!("NSScreenNumber")) else {
        return String::new();
    };
    // NSNumber returned for Apple's documented NSScreenNumber key.
    let display: u32 = unsafe { msg_send![&*number, unsignedIntValue] };
    display_uuid(display)
}

fn display_uuid(display: u32) -> String {
    let uuid = unsafe { CGDisplayCreateUUIDFromDisplayID(display) };
    if uuid.is_null() {
        return String::new();
    }
    let bytes = unsafe { CFUUIDGetUUIDBytes(uuid) }.bytes;
    unsafe { CFRelease(uuid) };
    uuid::Uuid::from_bytes(bytes).to_string()
}

// CoreGraphics display enumeration is thread-safe; settings never calls NSScreen off-main.
pub fn display_options() -> Result<Value> {
    let mut ids = [0_u32; 32];
    let mut count = 0;
    let status = unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) };
    anyhow::ensure!(status == 0, "无法读取显示器列表");
    let displays: Vec<Value> = ids.iter().take(count.min(ids.len() as u32) as usize).enumerate()
        .filter_map(|(index, &id)| {
            let uuid = display_uuid(id);
            if uuid.is_empty() { return None; }
            let bounds = unsafe { CGDisplayBounds(id) };
            let builtin = unsafe { CGDisplayIsBuiltin(id) } != 0;
            Some(json!({"id":uuid,"label":format!("{} · {} × {}", if builtin { "内建显示器".into() } else { format!("显示器 {}",index+1) }, bounds.size.width as u32, bounds.size.height as u32)}))
        }).collect();
    Ok(json!({"screens":displays,"nativeGlassAvailable":crate::native_backdrop::glass_available()}))
}

// Carbon event hotkeys use no global keyboard event tap and request no AX permission.
#[repr(C)]
struct EventType {
    class: u32,
    kind: u32,
}
#[repr(C)]
#[derive(Default)]
struct HotkeyId {
    signature: u32,
    id: u32,
}
type CarbonRef = *mut c_void;
type Handler = unsafe extern "C" fn(CarbonRef, CarbonRef, *mut c_void) -> i32;
#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn GetApplicationEventTarget() -> CarbonRef;
    fn InstallEventHandler(
        target: CarbonRef,
        handler: Handler,
        count: usize,
        types: *const EventType,
        data: *mut c_void,
        result: *mut CarbonRef,
    ) -> i32;
    fn RemoveEventHandler(handler: CarbonRef) -> i32;
    fn RegisterEventHotKey(
        key: u32,
        modifiers: u32,
        id: HotkeyId,
        target: CarbonRef,
        options: u32,
        result: *mut CarbonRef,
    ) -> i32;
    fn UnregisterEventHotKey(hotkey: CarbonRef) -> i32;
    fn GetEventParameter(
        event: CarbonRef,
        name: u32,
        kind: u32,
        actual: *mut u32,
        size: usize,
        actual_size: *mut usize,
        data: *mut c_void,
    ) -> i32;
}

struct Hotkey {
    reference: CarbonRef,
    handler: CarbonRef,
    _proxy: Box<EventLoopProxy<Message>>,
}
impl Hotkey {
    fn register(proxy: EventLoopProxy<Message>) -> std::result::Result<Self, String> {
        let mut hotkey = Self {
            reference: std::ptr::null_mut(),
            handler: std::ptr::null_mut(),
            _proxy: Box::new(proxy),
        };
        let target = unsafe { GetApplicationEventTarget() };
        let event = EventType {
            class: u32::from_be_bytes(*b"keyb"),
            kind: 5,
        };
        let status = unsafe {
            InstallEventHandler(
                target,
                hotkey_callback,
                1,
                &event,
                (&mut *hotkey._proxy as *mut EventLoopProxy<Message>).cast(),
                &mut hotkey.handler,
            )
        };
        if status != 0 {
            return Err(format!("Cmd+Shift+M handler unavailable ({status})"));
        }
        let id = HotkeyId {
            signature: u32::from_be_bytes(*b"CBMC"),
            id: 1,
        };
        // kVK_ANSI_M=46, cmdKey=1<<8, shiftKey=1<<9; Carbon reports conflicts as OSStatus.
        let status = unsafe {
            RegisterEventHotKey(
                46,
                (1 << 8) | (1 << 9),
                id,
                target,
                0,
                &mut hotkey.reference,
            )
        };
        if status != 0 {
            return Err(format!("Cmd+Shift+M registration failed ({status})"));
        }
        Ok(hotkey)
    }
}
impl Drop for Hotkey {
    fn drop(&mut self) {
        unsafe {
            if !self.reference.is_null() {
                UnregisterEventHotKey(self.reference);
            }
            if !self.handler.is_null() {
                RemoveEventHandler(self.handler);
            }
        }
    }
}

unsafe extern "C" fn hotkey_callback(_: CarbonRef, event: CarbonRef, data: *mut c_void) -> i32 {
    let mut id = HotkeyId::default();
    let status = unsafe {
        GetEventParameter(
            event,
            u32::from_be_bytes(*b"----"),
            u32::from_be_bytes(*b"hkid"),
            std::ptr::null_mut(),
            std::mem::size_of::<HotkeyId>(),
            std::ptr::null_mut(),
            (&mut id as *mut HotkeyId).cast(),
        )
    };
    if status != 0 || id.signature != u32::from_be_bytes(*b"CBMC") || id.id != 1 || data.is_null() {
        return -9874;
    }
    let proxy = unsafe { &*data.cast::<EventLoopProxy<Message>>() };
    let _ = proxy.send_event(Message::Hotkey);
    0
}
