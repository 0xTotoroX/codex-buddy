// [INPUT]: 开发版 NSWindow 编号、当前运动方向与形变强度、动态加载的 WindowServer 私有 ABI。
// [OUTPUT]: 整窗曲面收拢网格；失败停用并复位，正式构建不启用。
// [POS]: panel_window 的实验性合成后形变，不捕获屏幕、不读取聊天、不改变窗口命中或偏好。
// [PROTOCOL]: 变更时检查 src/AGENTS.md。

use objc2_foundation::NSRect;
use serde_json::{Value, json};
use std::ffi::{c_char, c_void};

#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct Point {
    x: f32,
    y: f32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct Vertex {
    local: Point,
    global: Point,
}
type Connection = unsafe extern "C" fn() -> i32;
type SetWarp = unsafe extern "C" fn(i32, i32, i32, i32, *const Vertex) -> i32;

#[link(name = "System")]
unsafe extern "C" {
    fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn dlclose(handle: *mut c_void) -> i32;
}

const GRID: usize = 21;

// 独立生成的收束曲线：靠近目的地的一边先变窄，中部弯曲，尾部保留宽度。
// x/y 使用 WindowServer 左上原点，所有顶点留在窗口范围内，避免负面积网格。
fn mesh(rect: NSRect, source: objc2_foundation::NSSize, bend: [f64; 2]) -> Vec<Vertex> {
    let horizontal = bend[0].abs() >= bend[1].abs();
    let amount = if horizontal { bend[0] } else { bend[1] };
    let strength = amount.abs().min(0.8);
    let mut vertices = Vec::with_capacity(GRID * GRID);
    for row in 0..GRID {
        for col in 0..GRID {
            let u = col as f64 / (GRID - 1) as f64;
            let v = row as f64 / (GRID - 1) as f64;
            let axis = if horizontal { u } else { v };
            let cross = if horizontal { v } else { u };
            let lead = if amount >= 0. { axis } else { 1. - axis };
            let curve = lead * lead * (3. - 2. * lead);
            let narrow = 1. - strength * (0.12 + 0.88 * curve);
            let cross = 0.5 + (cross - 0.5) * narrow;
            let advance = strength * 0.28 * lead * (1. - lead);
            let axis = axis + amount.signum() * advance;
            let (x, y) = if horizontal {
                (axis, cross)
            } else {
                (cross, axis)
            };
            vertices.push(Vertex {
                local: Point {
                    x: (u * source.width) as f32,
                    y: (v * source.height) as f32,
                },
                global: Point {
                    x: (rect.origin.x + x * rect.size.width) as f32,
                    y: (rect.origin.y + y * rect.size.height) as f32,
                },
            });
        }
    }
    vertices
}

pub(super) struct WindowWarp {
    handle: *mut c_void,
    connection: i32,
    window: i32,
    set: SetWarp,
    active: bool,
    failed: Option<i32>,
    frames: usize,
    peak: f64,
}

impl WindowWarp {
    pub fn load(window: i32, enabled: bool) -> Option<Self> {
        if !cfg!(debug_assertions) || !enabled {
            return None;
        }
        // ABI 的 float 网格与复位调用已对照 GenieWarpMesh/CGSPrivate；不静态链接私有符号。
        unsafe {
            let handle = dlopen(
                c"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight".as_ptr(),
                1,
            );
            if handle.is_null() {
                return None;
            }
            let connection = dlsym(handle, c"CGSMainConnectionID".as_ptr());
            let set = dlsym(handle, c"CGSSetWindowWarp".as_ptr());
            if connection.is_null() || set.is_null() {
                dlclose(handle);
                return None;
            }
            let connection: Connection = std::mem::transmute(connection);
            Some(Self {
                handle,
                connection: connection(),
                window,
                set: std::mem::transmute::<*mut c_void, SetWarp>(set),
                active: false,
                failed: None,
                frames: 0,
                peak: 0.,
            })
        }
    }

    pub fn available(&self) -> bool {
        self.failed.is_none()
    }

    pub fn apply(&mut self, rect: NSRect, source: objc2_foundation::NSSize, bend: [f64; 2]) {
        if self.failed.is_some() {
            return;
        }
        let strength = bend[0].abs().max(bend[1].abs());
        if rect.size.width <= 0. || rect.size.height <= 0. {
            self.disable(-1);
            return;
        }
        let vertices = mesh(rect, source, bend);
        let status = unsafe {
            (self.set)(
                self.connection,
                self.window,
                GRID as i32,
                GRID as i32,
                vertices.as_ptr(),
            )
        };
        if status != 0 {
            self.disable(status);
            return;
        }
        self.active = true;
        self.frames += 1;
        self.peak = self.peak.max(strength);
    }

    pub fn reset(&mut self) {
        if !self.active {
            return;
        }
        let status = unsafe { (self.set)(self.connection, self.window, 0, 0, std::ptr::null()) };
        if status == 0 {
            self.active = false;
        } else {
            self.failed = Some(status);
        }
    }

    fn disable(&mut self, error: i32) {
        self.reset();
        self.failed = Some(error);
        eprintln!("Genie warp unavailable ({error}); using spatial transition.");
    }

    pub fn status(&self) -> Value {
        json!({"supported":true,"active":self.active,"error":self.failed,"frames":self.frames,"peak":self.peak})
    }
}

impl Drop for WindowWarp {
    fn drop(&mut self) {
        self.reset();
        unsafe {
            dlclose(self.handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_foundation::{NSPoint, NSSize};
    #[test]
    fn endpoints_are_identity_and_four_directions_keep_order() {
        let r = NSRect::new(NSPoint::new(-120., 30.), NSSize::new(455., 625.));
        for bend in [[0., 0.], [0.74, 0.], [-0.74, 0.], [0., 0.74], [0., -0.74]] {
            let m = mesh(r, r.size, bend);
            for (i, p) in m.iter().enumerate() {
                assert!(p.global.x >= -120. && p.global.x <= 335.);
                assert!(p.global.y >= 30. && p.global.y <= 655.);
                if bend == [0., 0.] {
                    assert!((p.global.x - p.local.x + 120.).abs() < 0.001);
                    assert!((p.global.y - p.local.y - 30.).abs() < 0.001);
                }
                if i % GRID != GRID - 1 {
                    assert!(m[i + 1].global.x > p.global.x);
                }
                if i / GRID != GRID - 1 {
                    assert!(m[i + GRID].global.y > p.global.y);
                }
            }
        }
        let m = mesh(r, r.size, [0., 0.74]);
        let top = m[GRID - 1].global.x - m[0].global.x;
        let bottom = m[GRID * GRID - 1].global.x - m[GRID * (GRID - 1)].global.x;
        assert!(bottom < top * 0.35);
    }
}
