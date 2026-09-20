// [INPUT]: 合成窗口验收命令；仅操作明确给定的测试坐标。
// [OUTPUT]: 前台应用/屏幕安全区/事件投递权限，以及可选真实鼠标事件。
// [POS]: model-control-native.mjs 的辅助；窗口几何复用 native-probe.swift。
// [PROTOCOL]: 由集成任务同步 tests/AGENTS.md。
import AppKit
import Foundation

let args = CommandLine.arguments
func emit(_ value: Any) {
    print(String(data: try! JSONSerialization.data(withJSONObject: value), encoding: .utf8)!)
}
switch args[1] {
case "state":
    let top = NSScreen.screens.first?.frame.maxY ?? 0
    emit([
        "frontmost": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
        "canPostEvents": CGPreflightPostEventAccess(),
        "screens": NSScreen.screens.map { s -> [String: Any] in
            let notch = (s.auxiliaryTopLeftArea != nil && s.auxiliaryTopRightArea != nil)
                ? s.frame.width - s.auxiliaryTopLeftArea!.width - s.auxiliaryTopRightArea!.width : 0
            return ["x": s.frame.minX, "y": top - s.frame.maxY, "width": s.frame.width,
                    "height": s.frame.height, "notchWidth": notch, "notchHeight": s.safeAreaInsets.top]
        }
    ])
case "move", "click":
    guard CGPreflightPostEventAccess() else { fputs("Event posting unavailable; no permission requested\n", stderr); exit(2) }
    let p = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    if args[1] == "click" {
        usleep(50000)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(50000)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    }
default:
    fatalError("Unknown probe command")
}
