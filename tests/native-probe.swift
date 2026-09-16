// [INPUT]: 合成背景颜色文件，或指定测试进程的窗口信息/测试截图。
// [OUTPUT]: 原生背景窗口、指定 PID 的窗口几何及截图平均颜色。
// [POS]: native-check.mjs 的 macOS 验收辅助程序，仅编译到临时目录。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

import AppKit
import Foundation
if CommandLine.arguments[1] == "sample" {
    let bitmap = NSBitmapImageRep(data: try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))!
    var rgb = [Double](repeating: 0, count: 3); var count = 0.0
    let x0 = Int(Double(bitmap.pixelsWide) * 0.25), x1 = Int(Double(bitmap.pixelsWide) * 0.75)
    let y0 = Int(Double(bitmap.pixelsHigh) * 0.35), y1 = Int(Double(bitmap.pixelsHigh) * 0.55)
    for y in stride(from:y0,to:y1,by:3) { for x in stride(from:x0,to:x1,by:3) {
        let c = bitmap.colorAt(x:x,y:y)!.usingColorSpace(.deviceRGB)!
        rgb[0] += c.redComponent; rgb[1] += c.greenComponent; rgb[2] += c.blueComponent; count += 1
    }}
    print(String(data:try! JSONSerialization.data(withJSONObject:rgb.map{$0/count}),encoding:.utf8)!)
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
