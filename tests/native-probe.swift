// [INPUT]: 合成背景颜色文件，或指定测试进程的窗口信息/测试截图。
// [OUTPUT]: 原生背景窗口、指定 PID 的窗口几何/透明度轨迹及截图平均颜色。
// [POS]: native-check.mjs 的 macOS 验收辅助程序，仅编译到临时目录。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

import AppKit
import Foundation
if CommandLine.arguments[1] == "drag" {
    if !CGPreflightPostEventAccess() { fatalError("Native drag test requires event posting access") }
    if CommandLine.arguments.count > 6, let pid = Int32(CommandLine.arguments[6]) {
        NSRunningApplication(processIdentifier: pid)?.activate(options: [])
        usleep(300000)
    }
    let x1 = Double(CommandLine.arguments[2])!, y1 = Double(CommandLine.arguments[3])!
    let x2 = Double(CommandLine.arguments[4])!, y2 = Double(CommandLine.arguments[5])!
    func send(_ type: CGEventType, _ x: Double, _ y: Double) {
        CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x:x,y:y), mouseButton: .left)?.post(tap: .cghidEventTap)
    }
    send(.mouseMoved, x1, y1); usleep(80000)
    send(.leftMouseDown, x1, y1); usleep(80000)
    for i in 1...18 {
        let t = Double(i) / 18
        send(.leftMouseDragged, x1 + (x2-x1)*t, y1 + (y2-y1)*t); usleep(16000)
    }
    send(.leftMouseUp, x2, y2)
} else if CommandLine.arguments[1] == "screens" {
    let top = NSScreen.screens.first!.frame.maxY
    let rows = NSScreen.screens.map { s in ["x": s.frame.minX, "y": top - s.frame.maxY,
        "width": s.frame.width, "height": s.frame.height, "scale": s.backingScaleFactor] }
    print(String(data: try! JSONSerialization.data(withJSONObject: rows), encoding: .utf8)!)
} else if CommandLine.arguments[1] == "sample" {
    let bitmap = NSBitmapImageRep(data: try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))!
    var rgb = [Double](repeating: 0, count: 3); var count = 0.0
    let x0 = Int(Double(bitmap.pixelsWide) * 0.25), x1 = Int(Double(bitmap.pixelsWide) * 0.75)
    let y0 = Int(Double(bitmap.pixelsHigh) * 0.35), y1 = Int(Double(bitmap.pixelsHigh) * 0.55)
    for y in stride(from:y0,to:y1,by:3) { for x in stride(from:x0,to:x1,by:3) {
        let c = bitmap.colorAt(x:x,y:y)!.usingColorSpace(.deviceRGB)!
        rgb[0] += c.redComponent; rgb[1] += c.greenComponent; rgb[2] += c.blueComponent; count += 1
    }}
    print(String(data:try! JSONSerialization.data(withJSONObject:rgb.map{$0/count}),encoding:.utf8)!)
} else if CommandLine.arguments[1] == "motion" {
    let pid = Int(CommandLine.arguments[2])!
    var previous = ""
    let timer = Timer.scheduledTimer(withTimeInterval: 0.008, repeats: true) { _ in
        let rows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
        let own = rows.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid }
        func area(_ row: [String: Any]) -> Double {
            let bounds = row[kCGWindowBounds as String] as? [String: Double] ?? [:]
            return (bounds["Width"] ?? 0) * (bounds["Height"] ?? 0)
        }
        let main = own.max { area($0) < area($1) }
        let alpha = main?[kCGWindowAlpha as String] as? Double ?? 0
        let bounds = main?[kCGWindowBounds as String] as? [String: Double] ?? [:]
        let signature = "\(alpha):\(bounds["X"] ?? 0):\(bounds["Y"] ?? 0):\(bounds["Width"] ?? 0):\(bounds["Height"] ?? 0)"
        if signature != previous {
            previous = signature
            let row: [String: Any] = ["at": Date().timeIntervalSince1970 * 1000, "alpha": alpha, "bounds": bounds,
                "reduceMotion": NSWorkspace.shared.accessibilityDisplayShouldReduceMotion]
            let data = try! JSONSerialization.data(withJSONObject: row)
            FileHandle.standardOutput.write(data + Data([10]))
        }
    }
    RunLoop.main.add(timer, forMode: .common)
    RunLoop.main.run()
} else if CommandLine.arguments[1] == "windows" {
    let pid = Int(CommandLine.arguments[2])!
    let rows = CGWindowListCopyWindowInfo(.optionOnScreenOnly,kCGNullWindowID) as! [[String:Any]]
    let own = rows.filter{($0[kCGWindowOwnerPID as String] as? Int)==pid}
    print(String(data:try! JSONSerialization.data(withJSONObject:own),encoding:.utf8)!)
} else {
    let control=CommandLine.arguments[2], app=NSApplication.shared
    app.setActivationPolicy(.accessory)
    let screen=NSScreen.screens[0].frame
    let height=min(screen.height,850)
    let window=NSWindow(contentRect:NSRect(x:100,y:screen.height-height,width:800,height:height), styleMask:[.borderless], backing:.buffered,defer:false)
    window.title="CodexBuddy background test"; window.level=NSWindow.Level(rawValue:1)
    window.backgroundColor = .red; window.orderFrontRegardless()
    var previous=""
    let timer=Timer.scheduledTimer(withTimeInterval:0.02,repeats:true){_ in
        let color=(try? String(contentsOfFile:control,encoding:.utf8)) ?? "red"
        if color != previous {
            previous=color
            switch color {
            case "gray": window.backgroundColor=NSColor(srgbRed:0.5,green:0.5,blue:0.5,alpha:1)
            case "red": window.backgroundColor=NSColor(srgbRed:1,green:0.08,blue:0.08,alpha:1)
            default: window.backgroundColor=NSColor(srgbRed:0.08,green:0.08,blue:1,alpha:1)
            }
            window.displayIfNeeded()
        }
    }
    RunLoop.main.add(timer,forMode:.common); app.run()
}
