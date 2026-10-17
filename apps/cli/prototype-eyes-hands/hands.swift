// PROTOTYPE (#70), throwaway. Run with: swift hands.swift <command> ...
//   ax <title-substring>                          dump the AX tree of Live's window whose title contains it
//   pid-dclick-type <x> <y> <text>                CGEventPostToPid: double-click at global point, type text, Return (cursor untouched)
//   hid-dclick-type <x> <y> <text>                CGEventPost at HID tap: same, as a real mouse; cursor and front app restored after
//   pid-scroll <x> <y> <lines>  /  hid-scroll ...  one scroll-wheel event over a point
//   front                                          print the frontmost app and cursor position
import AppKit
import ApplicationServices

let args = CommandLine.arguments.dropFirst().map { $0 }
let live = NSRunningApplication.runningApplications(withBundleIdentifier: "com.ableton.live").first!
let pid = live.processIdentifier

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

func frame(_ el: AXUIElement) -> CGRect? {
    guard let v = attr(el, "AXFrame") else { return nil }
    var r = CGRect.zero
    AXValueGetValue(v as! AXValue, .cgRect, &r)
    return r
}

func dump(_ el: AXUIElement, _ depth: Int, _ count: inout Int) {
    if depth > 14 || count > 400 { return }
    count += 1
    var names: CFArray?
    AXUIElementCopyActionNames(el, &names)
    let f = frame(el).map { "[\(Int($0.minX)),\(Int($0.minY)) \(Int($0.width))x\(Int($0.height))]" } ?? ""
    let parts = ["AXRole", "AXTitle", "AXDescription", "AXValue", "AXHelp"].compactMap { n in attr(el, n).map { "\(n.dropFirst(2))=\($0)" } }
    print(String(repeating: "  ", count: depth) + parts.joined(separator: " ") + " " + f + " " + ((names as? [String]) ?? []).joined(separator: ","))
    for child in (attr(el, "AXChildren") as? [AXUIElement]) ?? [] { dump(child, depth + 1, &count) }
}

func post(_ e: CGEvent, hid: Bool) {
    if hid { e.post(tap: .cghidEventTap) } else { e.postToPid(pid) }
    usleep(30_000)
}

func click(_ p: CGPoint, count: Int, hid: Bool) {
    let src = CGEventSource(stateID: .hidSystemState)
    for n in 1...count {
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
            let e = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!
            e.setIntegerValueField(.mouseEventClickState, value: Int64(n))
            post(e, hid: hid)
        }
    }
}

func type(_ text: String, hid: Bool) {
    let src = CGEventSource(stateID: .hidSystemState)
    for ch in text.utf16 {
        for down in [true, false] {
            let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)!
            var c = ch
            e.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
            post(e, hid: hid)
        }
    }
    for down in [true, false] { post(CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: down)!, hid: hid) } // Return
}

func scroll(_ p: CGPoint, _ lines: Int32, hid: Bool) {
    let src = CGEventSource(stateID: .hidSystemState)
    let e = CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 1, wheel1: lines, wheel2: 0, wheel3: 0)!
    e.location = p
    post(e, hid: hid)
}

func front() -> String {
    let app = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
    let p = CGEvent(source: nil)!.location
    return "front=\(app) cursor=\(Int(p.x)),\(Int(p.y))"
}

switch args.first {
case "ax":
    let app = AXUIElementCreateApplication(pid)
    let wins = (attr(app, "AXWindows") as? [AXUIElement]) ?? []
    print("windows:", wins.map { (attr($0, "AXTitle") as? String) ?? "" })
    var n = 0
    if let w = wins.first(where: { ((attr($0, "AXTitle") as? String) ?? "").contains(args[1]) }) { dump(w, 0, &n) }
    print("elements:", n)
case "front":
    print(front())
case "pid-dclick-type", "hid-dclick-type":
    let hid = args[0].hasPrefix("hid")
    let p = CGPoint(x: Double(args[1])!, y: Double(args[2])!)
    let before = front()
    let previous = NSWorkspace.shared.frontmostApplication
    let cursor = CGEvent(source: nil)!.location
    if hid {
        let script = NSAppleScript(source: "tell application \"Ableton Live 12 Suite\" to activate")!
        script.executeAndReturnError(nil)
        usleep(600_000)
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { print("ABORT: Live is not in front: \(front())"); exit(1) }
    }
    click(p, count: 2, hid: hid)
    usleep(300_000)
    type(args[3], hid: hid)
    usleep(200_000)
    let during = front()
    if hid { CGWarpMouseCursorPosition(cursor); if let name = previous?.localizedName { NSAppleScript(source: "tell application \"\(name)\" to activate")?.executeAndReturnError(nil) } }
    usleep(200_000)
    print("before: \(before)\nduring: \(during)\nafter:  \(front())")
case "hid-hover-capture":
    // hid-hover-capture <x> <y> <windowId> <out.png>: real mouse move over a point, capture the window, restore
    let previous = NSWorkspace.shared.frontmostApplication
    let cursor = CGEvent(source: nil)!.location
    NSAppleScript(source: "tell application \"Ableton Live 12 Suite\" to activate")!.executeAndReturnError(nil)
    usleep(600_000)
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { print("ABORT: Live is not in front"); exit(1) }
    let p = CGPoint(x: Double(args[1])!, y: Double(args[2])!)
    for dx in [-6.0, -3.0, 0.0] { post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: p.x + dx, y: p.y), mouseButton: .left)!, hid: true) }
    usleep(700_000)
    let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture"); task.arguments = ["-x", "-o", "-l", args[3], args[4]]
    try! task.run(); task.waitUntilExit()
    CGWarpMouseCursorPosition(cursor)
    if let name = previous?.localizedName { NSAppleScript(source: "tell application \"\(name)\" to activate")?.executeAndReturnError(nil) }
    print("captured")
case "pid-scroll", "hid-scroll":
    let hid = args[0].hasPrefix("hid")
    let before = front()
    scroll(CGPoint(x: Double(args[1])!, y: Double(args[2])!), Int32(args[3])!, hid: hid)
    print("before: \(before)\nafter:  \(front())")
default:
    print("see the header")
}
