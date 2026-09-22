// [INPUT]: NSScreen 的逻辑点快照、边缘、归一化位置与开合状态。
// [OUTPUT]: 贴合物理边缘的内容高度布局、精确点击/稳定悬停命中、多屏选择与可反向连续开合进度。
// [POS]: model_control_window 私有几何模块，不依赖 AppKit 或工作台。
// [PROTOCOL]: 接口变化时由集成任务同步 src/AGENTS.md。

pub const COMPACT_DEPTH: f64 = 10.;
pub const COMPACT_LENGTH: f64 = 80.;
pub const NOTCH_FLANK: f64 = 10.;

// Critically damped 0.42s response, inspired by Codenotch's unfold timing.
// One continuous value drives window bounds, native material and web contents.
#[derive(Default)]
pub struct Unfold {
    pub value: f64,
    velocity: f64,
}
impl Unfold {
    pub fn active(&self, expanded: bool) -> bool {
        (self.value - f64::from(expanded)).abs() > 0.0001 || self.velocity.abs() > 0.001
    }
    pub fn step(&mut self, expanded: bool, seconds: f64, reduced: bool) {
        let target = f64::from(expanded);
        if reduced {
            self.value = target;
            self.velocity = 0.;
            return;
        }
        let omega = std::f64::consts::TAU / 0.42;
        // The analytic spring is stable for a whole delayed frame; never discard elapsed time.
        let dt = seconds.max(0.);
        let distance = self.value - target;
        let c = self.velocity + omega * distance;
        let decay = (-omega * dt).exp();
        self.value = target + (distance + c * dt) * decay;
        self.velocity = (self.velocity - omega * c * dt) * decay;
        if (self.value - target).abs() < 0.001 && self.velocity.abs() < 0.02 {
            self.value = target;
            self.velocity = 0.;
        }
    }
    pub fn frame(&self, compact: Rect, expanded: Rect) -> Rect {
        let mix = |a: f64, b: f64| a + (b - a) * self.value.clamp(0., 1.);
        Rect {
            x: mix(compact.x, expanded.x),
            y: mix(compact.y, expanded.y),
            width: mix(compact.width, expanded.width),
            height: mix(compact.height, expanded.height),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn contains(self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Edge {
    Left,
    #[default]
    Right,
    Top,
}

impl Edge {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "left" => Some(Self::Left),
            "right" => Some(Self::Right),
            "top" => Some(Self::Top),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
            Self::Top => "top",
        }
    }
}

// Same quadratic contour as the CSS path, using page coordinates (top-left origin).
pub fn surface_contains(width: f64, height: f64, edge: Edge, x: f64, y: f64) -> bool {
    if x < 0. || y < 0. || x >= width || y >= height {
        return false;
    }
    let (a, b, x, y) = match edge {
        Edge::Right => (width, height, x, y),
        Edge::Left => (width, height, width - x, y),
        Edge::Top => (height, width, height - y, x),
    };
    let y = y.min(b - y);
    let lip = 8_f64.min(a / 2.).min(b / 4.);
    if y < lip {
        return x >= a - lip * (1. - (1. - y / lip).sqrt()).powi(2);
    }
    let radius = 18_f64.min(a - lip).min((b - 2. * lip) / 2.).max(0.);
    y >= lip + radius || x >= radius * (1. - ((y - lip) / radius).sqrt()).powi(2)
}

#[derive(Clone, Copy)]
pub struct SurfaceRegion {
    pub rect: Rect,
    pub edge: Edge,
}
impl SurfaceRegion {
    pub fn contains(self, x: f64, y: f64) -> bool {
        surface_contains(
            self.rect.width,
            self.rect.height,
            self.edge,
            x - self.rect.x,
            self.rect.y + self.rect.height - y,
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Screen {
    pub id: String,
    pub frame: Rect,
    // visibleFrame 与 frame inset(safeAreaInsets) 的交集。
    pub usable: Rect,
    pub notch_width: f64,
    pub notch_height: f64,
    pub notch_x: f64,
}

// Hover uses stable state bounds, while clicks retain the exact animated contour.
// Keeping the wake region in the open region prevents end-cap points from ejecting themselves.
#[derive(Clone, Copy)]
pub struct HoverArea {
    wake: Rect,
    hold: Rect,
    excluded: Rect,
    margin: f64,
}
impl HoverArea {
    pub fn contains(self, x: f64, y: f64) -> bool {
        let padded = |r: Rect| {
            Rect {
                x: r.x - self.margin,
                y: r.y - self.margin,
                width: r.width + self.margin * 2.,
                height: r.height + self.margin * 2.,
            }
            .contains(x, y)
        };
        !self.excluded.contains(x, y) && (padded(self.wake) || padded(self.hold))
    }
}
pub fn hover_area(
    screen: &Screen,
    edge: Edge,
    position: f64,
    expanded: bool,
    height: f64,
) -> HoverArea {
    let wake = layout(screen, edge, position, false);
    HoverArea {
        wake,
        hold: if expanded {
            layout_height(screen, edge, position, true, height)
        } else {
            wake
        },
        excluded: if edge == Edge::Top && screen.notch_width > 0. {
            Rect {
                x: screen.notch_x,
                y: screen.frame.y + screen.frame.height - screen.notch_height,
                width: screen.notch_width,
                height: screen.notch_height,
            }
        } else {
            Rect::default()
        },
        margin: if expanded { 8. } else { 0. },
    }
}

pub fn fraction(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0., 1.)
    } else {
        0.5
    }
}

// position 从上到下（左右边缘）、从左到右（顶部）变化；始终使用 AppKit 全局点坐标。
pub fn layout(screen: &Screen, edge: Edge, position: f64, expanded: bool) -> Rect {
    layout_height(screen, edge, position, expanded, 274.)
}

pub fn layout_height(
    screen: &Screen,
    edge: Edge,
    position: f64,
    expanded: bool,
    content_height: f64,
) -> Rect {
    let area = screen.usable;
    let expanded_height =
        content_height.clamp(144., 2000.) + content_offset(screen, edge, expanded);
    if edge == Edge::Top && screen.notch_width > 0. && screen.notch_height > 0. {
        let bounds = if expanded {
            Rect {
                height: screen.frame.y + screen.frame.height - area.y,
                ..area
            }
        } else {
            screen.frame
        };
        let width = if expanded {
            480.
        } else {
            screen.notch_width + 2. * NOTCH_FLANK
        }
        .min(bounds.width);
        let height = if expanded {
            expanded_height
        } else {
            screen.notch_height
        }
        .min(bounds.height);
        let center = screen.notch_x + screen.notch_width / 2.;
        return Rect {
            x: (center - width / 2.).clamp(bounds.x, bounds.x + bounds.width - width),
            y: bounds.y + bounds.height - height,
            width,
            height,
        };
    }
    let (width, height): (f64, f64) = if expanded {
        (480., expanded_height)
    } else if edge == Edge::Top {
        (COMPACT_LENGTH, COMPACT_DEPTH)
    } else {
        (COMPACT_DEPTH, COMPACT_LENGTH)
    };
    let width = width.min(area.width.max(1.)).floor();
    let height = height.min(area.height.max(1.)).floor();
    let position = fraction(position);
    let (x, y) = match edge {
        Edge::Left => (
            screen.frame.x,
            area.y + (area.height - height) * (1. - position),
        ),
        Edge::Right => (
            screen.frame.x + screen.frame.width - width,
            area.y + (area.height - height) * (1. - position),
        ),
        Edge::Top => (
            area.x + (area.width - width) * position,
            screen.frame.y + screen.frame.height - height,
        ),
    };
    Rect {
        x,
        y,
        width,
        height,
    }
}

// NSView 坐标（左下原点）；顶部两种形态都排除硬件，展开内容另留安全区。
pub fn excluded_notch(screen: &Screen, frame: Rect, edge: Edge, _expanded: bool) -> Rect {
    if edge != Edge::Top || screen.notch_width <= 0. || screen.notch_height <= 0. {
        return Rect::default();
    }
    Rect {
        x: screen.notch_x - frame.x,
        y: screen.frame.y + screen.frame.height - screen.notch_height - frame.y,
        width: screen.notch_width,
        height: screen.notch_height,
    }
}

pub fn content_offset(screen: &Screen, edge: Edge, expanded: bool) -> f64 {
    if expanded && edge == Edge::Top && screen.notch_width > 0. {
        (screen.frame.y + screen.frame.height - screen.usable.y - screen.usable.height)
            .max(screen.notch_height)
    } else {
        0.
    }
}

// 回退只决定当前显示位置；调用者不能把结果当作用户保存的显示器意图。
pub fn select_screen<'a>(
    screens: &'a [Screen],
    preferred: &str,
    current: &str,
    pointer: (f64, f64),
) -> Option<&'a Screen> {
    screens
        .iter()
        .find(|s| !preferred.is_empty() && s.id == preferred)
        .or_else(|| {
            screens
                .iter()
                .find(|s| !current.is_empty() && s.id == current)
        })
        .or_else(|| {
            screens
                .iter()
                .find(|s| s.frame.contains(pointer.0, pointer.1))
        })
        .or_else(|| screens.first())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(id: &str, x: f64, y: f64, width: f64, height: f64) -> Screen {
        let frame = Rect {
            x,
            y,
            width,
            height,
        };
        Screen {
            id: id.into(),
            frame,
            usable: frame,
            notch_width: 0.,
            notch_height: 0.,
            notch_x: 0.,
        }
    }

    #[test]
    fn unfold_is_continuous_reversible_and_respects_reduced_motion() {
        let mut motion = Unfold::default();
        motion.step(true, 1. / 60., false);
        assert!(motion.value > 0. && motion.value < 0.1);
        for _ in 0..8 {
            motion.step(true, 1. / 60., false);
        }
        let before = motion.value;
        motion.step(false, 1. / 60., false);
        assert!((motion.value - before).abs() < 0.12);
        for _ in 0..120 {
            motion.step(false, 1. / 60., false);
        }
        assert_eq!(motion.value, 0.);
        assert!(!motion.active(false));
        motion.step(true, 0., true);
        assert_eq!(motion.value, 1.);
        assert!(!motion.active(true));
    }
    #[test]
    fn delayed_frames_preserve_elapsed_motion_time() {
        let mut regular = Unfold::default();
        for _ in 0..20 {
            regular.step(true, 0.016, false);
        }
        let mut delayed = Unfold::default();
        for dt in [0.016, 0.064, 0.16, 0.08] {
            delayed.step(true, dt, false);
        }
        assert!((regular.value - delayed.value).abs() < 1e-10);
        assert!((regular.velocity - delayed.velocity).abs() < 1e-10);
        // A reversal keeps the same velocity and obeys the same wall-clock time.
        regular.step(false, 0.16, false);
        for _ in 0..10 {
            delayed.step(false, 0.016, false);
        }
        assert!((regular.value - delayed.value).abs() < 1e-10);
        delayed.step(true, 2., false);
        assert_eq!(delayed.value, 1.);
        assert!(!delayed.active(true));
    }

    #[test]
    fn opening_retains_every_wake_point_including_screen_end_caps() {
        let s = screen("main", 0., 0., 1440., 900.);
        for edge in [Edge::Left, Edge::Right, Edge::Top] {
            for position in [0., 0.1, 0.5, 0.9, 1.] {
                let closed = hover_area(&s, edge, position, false, 274.);
                let open = hover_area(&s, edge, position, true, 274.);
                let wake = layout(&s, edge, position, false);
                for xi in 0..wake.width as usize {
                    for yi in 0..wake.height as usize {
                        let (x, y) = (wake.x + xi as f64 + 0.25, wake.y + yi as f64 + 0.25);
                        assert!(closed.contains(x, y));
                        assert!(open.contains(x, y), "{edge:?} {position} {x} {y}");
                    }
                }
            }
        }
    }

    #[test]
    fn hover_exit_tolerance_and_frozen_area_do_not_expand_click_targets() {
        let s = screen("main", 0., 0., 1440., 900.);
        let open = hover_area(&s, Edge::Right, 0.5, true, 274.);
        let bounds = layout(&s, Edge::Right, 0.5, true);
        let y = bounds.y + bounds.height / 2.;
        // Small hand jitter cannot leave the hold or frozen suppression area.
        for dx in [-7., -3., 0., 3.] {
            assert!(open.contains(bounds.x + dx, y));
        }
        assert!(!open.contains(bounds.x - 9., y));
        assert!(
            !(SurfaceRegion {
                rect: bounds,
                edge: Edge::Right
            })
            .contains(bounds.x - 3., y)
        );
        let closed = hover_area(&s, Edge::Right, 0.5, false, 274.);
        assert!(!closed.contains(bounds.x, y));
        assert!(open.contains(bounds.x, y)); // Frozen until the pointer actually exits.
    }

    #[test]
    fn notch_hover_keeps_both_flanks_and_excludes_hardware() {
        let mut s = screen("notch", 0., 0., 1512., 982.);
        s.notch_width = 180.;
        s.notch_height = 32.;
        s.notch_x = 666.;
        s.usable.height -= 32.;
        for expanded in [false, true] {
            let area = hover_area(&s, Edge::Top, 0.5, expanded, 274.);
            assert!(area.contains(661., 965.));
            assert!(area.contains(851., 965.));
            assert!(!area.contains(756., 965.));
        }
    }

    #[test]
    fn unfold_keeps_the_screen_edge_attached() {
        let display = screen("main", 0., 0., 1440., 900.);
        let motion = Unfold {
            value: 0.4,
            velocity: 0.,
        };
        for edge in [Edge::Left, Edge::Right, Edge::Top] {
            let compact = layout(&display, edge, 0.5, false);
            let expanded = layout(&display, edge, 0.5, true);
            let shown = motion.frame(compact, expanded);
            assert!(shown.width > compact.width && shown.width < expanded.width);
            let anchor = |r: Rect| match edge {
                Edge::Left => r.x,
                Edge::Right => r.x + r.width,
                Edge::Top => r.y + r.height,
            };
            assert!((anchor(shown) - anchor(expanded)).abs() < 0.001);
        }
    }

    #[test]
    fn compact_frame_releases_the_expanded_hit_area() {
        let s = screen("main", 0., 0., 1440., 900.);
        for edge in [Edge::Left, Edge::Right] {
            let compact = layout(&s, edge, 0.5, false);
            assert_eq!(
                (compact.width, compact.height),
                (COMPACT_DEPTH, COMPACT_LENGTH)
            );
            let expanded = layout(&s, edge, 0.5, true);
            assert_eq!((expanded.width, expanded.height), (480., 274.));
            assert_eq!(
                compact.y + compact.height / 2.,
                expanded.y + expanded.height / 2.
            );
        }
    }

    #[test]
    fn top_notch_and_dock_are_excluded_from_every_frame() {
        let mut s = screen("notched", 0., 0., 1512., 982.);
        s.usable = Rect {
            x: 0.,
            y: 64.,
            width: 1512.,
            height: 886.,
        };
        s.notch_height = 32.;
        s.notch_width = 180.;
        s.notch_x = 666.;
        for edge in [Edge::Top, Edge::Left, Edge::Right] {
            for p in [0., 0.5, 1.] {
                for expanded in [false, true] {
                    let r = layout(&s, edge, p, expanded);
                    if edge == Edge::Top && !expanded {
                        assert_eq!(
                            r,
                            Rect {
                                x: 656.,
                                y: 950.,
                                width: 200.,
                                height: 32.
                            }
                        );
                    } else if edge != Edge::Top {
                        assert!(r.y >= 64. && r.y + r.height <= 950.);
                    } else {
                        assert_eq!(r.y + r.height, 982.);
                        assert!(r.y + r.height - content_offset(&s, edge, expanded) <= 950.);
                    }
                }
            }
        }
        let r = layout(&s, Edge::Top, 0.5, false);
        assert_eq!((r.width, r.height), (200., 32.));
        let exclusion = excluded_notch(&s, r, Edge::Top, false);
        assert!(exclusion.contains(100., 16.));
        assert!(!exclusion.contains(5., 16.));
        assert!(!exclusion.contains(195., 16.));
        let expanded = layout(&s, Edge::Top, 0., true);
        assert_eq!(expanded.x + expanded.width / 2., r.x + r.width / 2.);
        assert_eq!(excluded_notch(&s, expanded, Edge::Top, true).width, 180.);
        assert_eq!(content_offset(&s, Edge::Top, true), 32.);
    }

    #[test]
    fn negative_and_above_primary_coordinates_are_preserved() {
        for s in [
            screen("left", -1920., -200., 1920., 1080.),
            screen("above", 300., 900., 1280., 720.),
        ] {
            assert_eq!(layout(&s, Edge::Left, 1., false).y, s.frame.y);
            assert_eq!(layout(&s, Edge::Top, 0., false).x, s.frame.x);
            let r = layout(&s, Edge::Right, 0., true);
            assert_eq!(r.x + r.width, s.frame.x + s.frame.width);
            assert_eq!(r.y + r.height, s.frame.y + s.frame.height);
        }
    }

    #[test]
    fn tiny_screens_and_invalid_fractions_stay_bounded() {
        let s = screen("small", -200., 10., 320., 240.);
        for p in [f64::NAN, f64::INFINITY, -5., 9.] {
            let r = layout(&s, Edge::Right, p, true);
            assert_eq!(r, s.frame);
        }
        assert_eq!(fraction(f64::NAN), 0.5);
        assert_eq!(fraction(-1.), 0.);
        assert_eq!(fraction(2.), 1.);
    }

    #[test]
    fn unplug_and_replug_restore_saved_identity_without_overwriting_it() {
        let a = screen("saved-uuid", -1440., 0., 1440., 900.);
        let b = screen("fallback-uuid", 0., 0., 1920., 1080.);
        let preferred = a.id.clone();
        assert_eq!(
            select_screen(&[b.clone()], &preferred, "", (0., 0.))
                .unwrap()
                .id,
            b.id
        );
        assert_eq!(
            select_screen(&[b.clone(), a], &preferred, &b.id, (1., 1.))
                .unwrap()
                .id,
            preferred
        );
        assert!(select_screen(&[], &preferred, "", (0., 0.)).is_none());
    }

    #[test]
    fn contour_excludes_transparent_wings_and_round_corners() {
        assert!(!surface_contains(10., 80., Edge::Right, 5., 2.));
        assert!(surface_contains(10., 80., Edge::Right, 5., 40.));
        assert!(surface_contains(10., 80., Edge::Left, 5., 40.));
        assert!(surface_contains(80., 10., Edge::Top, 40., 5.));
        assert!(!surface_contains(80., 10., Edge::Top, 2., 5.));
        let plain_top = layout(&screen("top", 0., 0., 1440., 900.), Edge::Top, 0.5, false);
        assert_eq!((plain_top.width, plain_top.height), (80., 10.));
        assert_eq!(plain_top.y + plain_top.height, 900.);
        assert!(!surface_contains(480., 274., Edge::Right, 2., 10.));
        assert!(surface_contains(480., 274., Edge::Right, 479.9, 4.));
        for edge in [Edge::Left, Edge::Right, Edge::Top] {
            assert!(surface_contains(480., 274., edge, 240., 137.));
            assert!(!surface_contains(480., 274., edge, -1., 137.));
        }
        let s = screen("main", 0., 0., 1440., 900.);
        let compact = layout(&s, Edge::Right, 0.5, false);
        let expanded = layout_height(&s, Edge::Right, 0.5, true, 222.);
        assert_eq!(expanded.height, 222.);
        let frozen = SurfaceRegion {
            rect: expanded,
            edge: Edge::Right,
        };
        let pointer = (expanded.x + 240., expanded.y + 111.);
        assert!(frozen.contains(pointer.0, pointer.1));
        assert!(!compact.contains(pointer.0, pointer.1));
    }

    #[test]
    fn only_supported_edges_are_accepted() {
        for edge in [Edge::Left, Edge::Right, Edge::Top] {
            assert_eq!(Edge::parse(edge.as_str()), Some(edge));
        }
        assert_eq!(Edge::parse("bottom"), None);
    }
}
