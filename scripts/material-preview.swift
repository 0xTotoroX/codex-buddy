// [INPUT]: AppKit 14 种传统材质、外观/焦点选择和相同的对照背景。
// [OUTPUT]: 不透明标题栏与同步切换的原生材质卡片；--check 检查材质映射、几何与全部控制组合。
// [POS]: 开发专用对照工具，由 material-preview.mjs 构建；不读写产品配置。
// [PROTOCOL]: 变更时检查 scripts/AGENTS.md。

import AppKit

let materials: [(String, String, NSVisualEffectView.Material)] = [
    ("titlebar", "标题栏", .titlebar), ("selection", "选中区域（强调）", .selection),
    ("menu", "菜单", .menu), ("popover", "弹出面板", .popover),
    ("sidebar", "侧栏", .sidebar), ("headerView", "内容标题", .headerView),
    ("sheet", "附属面板", .sheet), ("windowBackground", "窗口背景", .windowBackground),
    ("hudWindow", "浮动工具面板 · 当前使用", .hudWindow), ("fullScreenUI", "全屏界面", .fullScreenUI),
    ("toolTip", "文字提示", .toolTip), ("contentBackground", "内容背景", .contentBackground),
    ("underWindowBackground", "窗口下方", .underWindowBackground),
    ("underPageBackground", "页面下方", .underPageBackground),
]

final class Canvas: NSView {
    override var isFlipped: Bool { true }
}

// 只覆盖标题栏，卡片所在的内容窗口继续透明；不拦截拖动和系统按钮。
final class TitlebarFill: NSView {
    var color = NSColor.white { didSet { needsDisplay = true } }
    override var isOpaque: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        bounds.fill()
    }
}

// 每张卡片下面画同一个背景；使用独立窗口，确保 BehindWindow 真正采样窗外内容。
final class Background: NSView {
    override var isFlipped: Bool { true }
    var mode = 0
    var cards: [NSRect] = []
    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        bounds.fill()
        for rect in cards {
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: rect, xRadius: 18, yRadius: 18).addClip()
            let colors: [NSColor] = [.white, NSColor(white: 0.5, alpha: 1), NSColor(white: 0.08, alpha: 1)]
            (mode < 3 ? colors[mode] : .white).setFill()
            rect.fill()
            if mode == 3 {
                let stripes: [NSColor] = [.systemBlue, .systemGreen, .systemYellow, .systemOrange, .systemPink]
                for (i, color) in stripes.enumerated() {
                    color.setFill()
                    NSRect(x: rect.minX + CGFloat(i) * rect.width / 5, y: rect.minY,
                           width: rect.width / 5 + 1, height: rect.height).fill()
                }
            }
            if mode == 4 {
                for i in 0..<7 {
                    let text = i.isMultiple(of: 2) ? "背景文字  Aa  123" : "观察模糊与文字清晰度"
                    (text as NSString).draw(at: NSPoint(x: rect.minX + 10, y: rect.minY + CGFloat(i) * 25),
                        withAttributes: [.font: NSFont.systemFont(ofSize: 17), .foregroundColor: NSColor.black])
                }
            }
            NSGraphicsContext.restoreGraphicsState()
        }
    }
}

final class BackgroundWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class Preview: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 790),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    let backgroundWindow = BackgroundWindow(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: false)
    let titlebarFill = TitlebarFill()
    let canvas = Canvas()
    let background = Background()
    let backdropPicker = NSPopUpButton()
    let appearancePicker = NSSegmentedControl(labels: ["跟随系统", "浅色", "深色"], trackingMode: .selectOne, target: nil, action: nil)
    let focusPicker = NSSegmentedControl(labels: ["跟随焦点", "保持激活", "模拟失焦"], trackingMode: .selectOne, target: nil, action: nil)
    let status = NSTextField(labelWithString: "")
    var effects: [NSVisualEffectView] = []
    var boundaries: [NSView] = []
    var headings: [NSTextField] = []
    var samples: [[NSTextField]] = []
    var toolbar: NSView!
    var appearanceObservation: NSKeyValueObservation?

    func label(_ text: String, size: CGFloat, bold: Bool = false) -> NSTextField {
        let view = NSTextField(labelWithString: text)
        view.font = .systemFont(ofSize: size, weight: bold ? .semibold : .regular)
        view.lineBreakMode = .byTruncatingTail
        return view
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window.title = "CodexBuddy · 原生材质对照"
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.delegate = self
        window.contentMinSize = NSSize(width: 900, height: 620)
        window.contentView = canvas
        // 应用自己的底色放在系统标题栏下方，不改 AppKit 私有玻璃层。
        window.titlebarAppearsTransparent = true
        canvas.superview?.addSubview(titlebarFill, positioned: .below, relativeTo: nil)
        if let screen = NSScreen.main {
            let size = screen.visibleFrame.size
            window.setContentSize(NSSize(width: min(1180, size.width - 60), height: min(790, size.height - 90)))
        }
        window.center()
        backgroundWindow.contentView = background
        backgroundWindow.ignoresMouseEvents = true
        backgroundWindow.hasShadow = false
        backgroundWindow.isReleasedWhenClosed = false
        window.addChildWindow(backgroundWindow, ordered: .below)
        makeToolbar()
        appearanceObservation = window.observe(\.effectiveAppearance) { [weak self] _, _ in
            self?.refreshColors()
        }
        for (name, title, material) in materials {
            let heading = label("\(name)  ·  \(title)", size: 11, bold: true)
            headings.append(heading)
            canvas.addSubview(heading)
            let boundary = Canvas()
            boundary.wantsLayer = true
            boundary.layer?.cornerRadius = 18
            boundary.layer?.masksToBounds = true
            boundary.clipsToBounds = true
            canvas.addSubview(boundary)
            boundaries.append(boundary)
            let effect = NSVisualEffectView()
            effect.material = material
            effect.isEmphasized = material == .selection
            effect.blendingMode = .behindWindow
            effect.state = .followsWindowActiveState
            boundary.addSubview(effect)
            effects.append(effect)
            // 相同文字前景，独立于材质；与产品的透明网页前景层次对应。
            let titleLabel = label("文字与背景", size: 21, bold: true)
            let detail = label("比较底色、模糊与清晰度", size: 12)
            let hint = label("Aa  0123456789", size: 14)
            for view in [titleLabel, detail, hint] { boundary.addSubview(view) }
            samples.append([titleLabel, detail, hint])
        }
        layout()
        update()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if CommandLine.arguments.contains("--check") {
            DispatchQueue.main.async { self.check(); NSApp.terminate(nil) }
        }
    }

    func makeToolbar() {
        toolbar = Canvas()
        canvas.addSubview(toolbar)
        let title = label("传统磨砂 · 14 种原生材质", size: 22, bold: true)
        title.frame = NSRect(x: 18, y: 12, width: 470, height: 30)
        toolbar.addSubview(title)
        let subtitle = label("每格使用相同背景；控制项同步作用于全部卡片。", size: 12)
        subtitle.frame = NSRect(x: 18, y: 47, width: 680, height: 20)
        toolbar.addSubview(subtitle)
        backdropPicker.addItems(withTitles: ["背景：纯白", "背景：中灰", "背景：深黑", "背景：彩色条纹", "背景：文字", "背景：真实桌面"])
        backdropPicker.frame = NSRect(x: 18, y: 78, width: 175, height: 26)
        appearancePicker.frame = NSRect(x: 215, y: 78, width: 250, height: 26)
        focusPicker.frame = NSRect(x: 485, y: 78, width: 305, height: 26)
        appearancePicker.selectedSegment = 1
        focusPicker.selectedSegment = 0
        for control: NSControl in [backdropPicker, appearancePicker, focusPicker] {
            control.target = self
            control.action = #selector(update)
            toolbar.addSubview(control)
        }
        status.font = .systemFont(ofSize: 11)
        canvas.addSubview(status)
    }

    func layout() {
        guard toolbar != nil else { return }
        if let frame = canvas.superview {
            let content = canvas.convert(canvas.bounds, to: frame)
            let height = frame.isFlipped ? content.minY : frame.bounds.height - content.maxY
            titlebarFill.frame = NSRect(x: 0, y: frame.isFlipped ? 0 : content.maxY,
                                       width: frame.bounds.width, height: max(0, height))
        }
        let size = canvas.bounds.size
        toolbar.frame = NSRect(x: 0, y: 0, width: size.width, height: 118)
        status.frame = NSRect(x: 18, y: size.height - 28, width: size.width - 36, height: 20)
        let width = (size.width - 36 - 4 * 12) / 5
        let height = (size.height - 158 - 2 * 14) / 3
        for i in effects.indices {
            let origin = NSPoint(x: 18 + CGFloat(i % 5) * (width + 12), y: 124 + CGFloat(i / 5) * (height + 14))
            headings[i].frame = NSRect(origin: origin, size: NSSize(width: width, height: 28))
            let rect = NSRect(x: origin.x, y: origin.y + 29, width: width, height: height - 29)
            boundaries[i].frame = rect
            effects[i].frame = NSRect(origin: .zero, size: rect.size)
            for (j, label) in samples[i].enumerated() {
                label.frame = NSRect(x: 14, y: 18 + CGFloat(j) * 32, width: width - 28, height: 28)
            }
        }
        background.cards = boundaries.map(\.frame)
        backgroundWindow.setFrame(window.convertToScreen(canvas.bounds), display: true)
        background.needsDisplay = true
    }

    @objc func update() {
        guard toolbar != nil else { return }
        let names: [NSAppearance.Name?] = [nil, .aqua, .darkAqua]
        let appearance = names[appearancePicker.selectedSegment].flatMap { NSAppearance(named: $0) }
        window.appearance = appearance
        backgroundWindow.appearance = appearance
        let states: [NSVisualEffectView.State] = [.followsWindowActiveState, .active, .inactive]
        for effect in effects { effect.state = states[focusPicker.selectedSegment] }
        background.mode = backdropPicker.indexOfSelectedItem
        if background.mode == 5 { backgroundWindow.orderOut(nil) }
        else { backgroundWindow.order(.below, relativeTo: window.windowNumber) }
        background.needsDisplay = true
        refreshColors()
        status.stringValue = "\(window.isKeyWindow ? "窗口已激活" : "窗口未激活") · \(focusPicker.label(forSegment: focusPicker.selectedSegment) ?? "") · 真实桌面模式可拖到其他窗口上对比；不改变系统设置或产品主题。"
    }

    func refreshColors() {
        guard toolbar != nil else { return }
        // 窗外背景负责材质采样；界面标签始终由本窗口的外观决定。
        let dark = window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        for views in samples {
            for view in views { view.textColor = dark ? .white : .black }
        }
        toolbar.wantsLayer = true
        let chrome = dark ? NSColor(white: 0.14, alpha: 1) : .white
        toolbar.layer?.backgroundColor = chrome.cgColor
        titlebarFill.color = chrome
        for label in headings + [status] {
            label.drawsBackground = true
            label.backgroundColor = chrome
        }
    }

    func windowDidResize(_ notification: Notification) { layout() }
    func windowDidMove(_ notification: Notification) { layout() }
    func windowDidBecomeKey(_ notification: Notification) { update() }
    func windowDidResignKey(_ notification: Notification) { update() }
    func windowWillClose(_ notification: Notification) { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func check() {
        precondition(effects.count == 14 && Set(materials.map { $0.2.rawValue }).count == 14)
        for (i, effect) in effects.enumerated() {
            precondition(effect.material == materials[i].2 && effect.blendingMode == .behindWindow)
            precondition(effect.isEmphasized == (materials[i].2 == .selection))
            precondition(effect.bounds.width > 100 && effect.bounds.height > 80)
            precondition(background.cards[i] == boundaries[i].frame)
        }
        for theme in 0..<3 { for state in 0..<3 { for backdrop in 0..<6 {
            appearancePicker.selectedSegment = theme
            focusPicker.selectedSegment = state
            backdropPicker.selectItem(at: backdrop)
            update()
            precondition(titlebarFill.color.alphaComponent == 1 && titlebarFill.frame.height > 0)
            precondition(titlebarFill.frame.width == canvas.superview?.bounds.width)
            precondition(effects.allSatisfy { $0.state == [.followsWindowActiveState, .active, .inactive][state] })
            precondition(backgroundWindow.isVisible == (backdrop != 5))
            if theme != 0 {
                precondition(window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == (theme == 1 ? .aqua : .darkAqua))
            }
        } } }
        print("PASS 14 native materials; identical background geometry; 54 synchronized appearance/focus/background combinations")
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Preview()
app.delegate = delegate
let menu = NSMenu()
let appItem = NSMenuItem()
let appMenu = NSMenu()
appMenu.addItem(withTitle: "退出材质对照", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu
menu.addItem(appItem)
app.mainMenu = menu
app.run()
