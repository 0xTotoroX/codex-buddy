// [INPUT]: Wry 所属 NSWindow、原生背景几何与共享材质偏好。
// [OUTPUT]: 哑光关闭背景、HUDWindow 磨砂及 macOS 26+ Regular/Clear 液态。
// [POS]: panel_window 与 model_control_window 共用的 AppKit 背景层。
// [PROTOCOL]: 共享材质保持窗口无关；控制条可选边缘裁切，工作台仍用圆角矩形。

use objc2::{MainThreadMarker, MainThreadOnly, rc::Retained, runtime::AnyClass};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSGlassEffectView, NSGlassEffectViewStyle, NSView,
    NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView,
    NSWindow,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::{CALayer, CATransaction};
use serde_json::Value;
use std::ffi::c_void;

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
    pub fn new(window: &NSWindow) -> Self {
        let mtm = MainThreadMarker::new().expect("window main thread");
        let root = window.contentView().expect("Wry content view");
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

    // Optional edge contour for the model control. Workbench keeps its rounded rectangle.
    pub fn clip_edge(&self, width: f64, height: f64, edge: &str) {
        let Some(layer) = self.boundary.layer() else {
            return;
        };
        let Some(class) = AnyClass::get(c"CAShapeLayer") else {
            return;
        };
        let mask: Retained<CALayer> = unsafe { objc2::msg_send![class, new] };
        let (a, b) = if edge == "top" {
            (height, width)
        } else {
            (width, height)
        };
        let lip = 8_f64.min(a / 2.).min(b / 4.);
        let r = 18_f64.min(a - lip).min((b - 2. * lip) / 2.);
        let p = |x: f64, y: f64| match edge {
            "left" => (width - x, height - y),
            "top" => (y, x),
            _ => (x, height - y),
        };
        unsafe {
            let path = CGPathCreateMutable();
            if path.is_null() {
                return;
            }
            let start = p(a, 0.);
            CGPathMoveToPoint(path, std::ptr::null(), start.0, start.1);
            for (control, end) in [
                (Some(p(a, lip)), p(a - lip, lip)),
                (None, p(r, lip)),
                (Some(p(0., lip)), p(0., lip + r)),
                (None, p(0., b - lip - r)),
                (Some(p(0., b - lip)), p(r, b - lip)),
                (None, p(a - lip, b - lip)),
                (Some(p(a, b - lip)), p(a, b)),
            ] {
                if let Some(c) = control {
                    CGPathAddQuadCurveToPoint(path, std::ptr::null(), c.0, c.1, end.0, end.1);
                } else {
                    CGPathAddLineToPoint(path, std::ptr::null(), end.0, end.1);
                }
            }
            CGPathCloseSubpath(path);
            let _: () = objc2::msg_send![&*mask, setPath: path];
            layer.setMask(Some(&mask));
            CGPathRelease(path);
        }
    }

    pub fn resize_viewport(&self, window: &NSWindow, interactive: bool) {
        let root = window.contentView().expect("Wry content view");
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

    pub fn update(&self, window: &NSWindow, message: &Value) {
        let root = window.contentView().expect("Wry content view");
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
        let use_glass = visible && message["material"] == "native-glass" && self.glass.is_some();
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
        // 先呈现新材质，再撤掉旧材质；同一无动画事务避免切换时出现透明空帧。
        self.boundary.setHidden(!use_glass && !use_frosted);
        if use_glass && let Some(glass) = &self.glass {
            glass.setHidden(false);
        }
        if use_frosted {
            self.frosted.setHidden(false);
        }
        if !use_glass && let Some(glass) = &self.glass {
            glass.setHidden(true);
        }
        if !use_frosted {
            self.frosted.setHidden(true);
        }
        CATransaction::commit();
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPathCreateMutable() -> *mut c_void;
    fn CGPathMoveToPoint(path: *mut c_void, transform: *const c_void, x: f64, y: f64);
    fn CGPathAddLineToPoint(path: *mut c_void, transform: *const c_void, x: f64, y: f64);
    fn CGPathAddQuadCurveToPoint(
        path: *mut c_void,
        transform: *const c_void,
        cx: f64,
        cy: f64,
        x: f64,
        y: f64,
    );
    fn CGPathCloseSubpath(path: *mut c_void);
    fn CGPathRelease(path: *mut c_void);
}
