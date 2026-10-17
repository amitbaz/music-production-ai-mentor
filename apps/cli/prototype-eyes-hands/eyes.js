// PROTOTYPE (#70), JXA via osascript -l JavaScript. Throwaway.
// windows                       -> JSON list of Live's layer-0 windows {id, title, bounds, onscreen}
// capture <windowId> <out.png>  -> PNG of that one window at full (Retina) resolution, prints {ms, w, h}
// ax <title-substring>          -> JSON dump of the AX tree of Live's window whose title contains it
ObjC.import("CoreGraphics");
ObjC.import("AppKit");
ObjC.import("ApplicationServices");

function livePid() {
    const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.ableton.live");
    return apps.count > 0 ? apps.objectAtIndex(0).processIdentifier : 0;
}

function windows() {
    const pid = livePid();
    const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID)));
    return all
        .filter((w) => w.kCGWindowOwnerPID === pid && (w.kCGWindowLayer === 0 || w.kCGWindowLayer === 3) && w.kCGWindowAlpha > 0)
        .map((w) => ({ id: w.kCGWindowNumber, title: w.kCGWindowName || "", bounds: w.kCGWindowBounds, onscreen: !!w.kCGWindowIsOnscreen }));
}

function capture(id, out) {
    const t = Date.now();
    const img = $.CGWindowListCreateImage($.CGRectNull, $.kCGWindowListOptionIncludingWindow, id, $.kCGWindowImageBoundsIgnoreFraming);
    if (!img || img.isNil?.()) return { error: "no image" };
    const rep = $.NSBitmapImageRep.alloc.initWithCGImage(img);
    rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({})).writeToFileAtomically(out, true);
    return { ms: Date.now() - t, w: rep.pixelsWide, h: rep.pixelsHigh };
}

function attr(el, name) {
    const ref = Ref();
    if ($.AXUIElementCopyAttributeValue(el, $(name), ref) !== 0) return undefined;
    return ref[0];
}

function str(v) {
    if (v === undefined) return undefined;
    try { const o = ObjC.castRefToObject(v); const u = ObjC.deepUnwrap(o); return typeof u === "object" ? JSON.stringify(u) : u; } catch (e) { return String(v); }
}

function frame(el) {
    const p = attr(el, "AXFrame");
    if (!p) return undefined;
    const r = Ref();
    $.AXValueGetValue(p, $.kAXValueCGRectType, r);
    const f = r[0];
    return [Math.round(f.origin.x), Math.round(f.origin.y), Math.round(f.size.width), Math.round(f.size.height)];
}

function actions(el) {
    const ref = Ref();
    if ($.AXUIElementCopyActionNames(el, ref) !== 0) return [];
    return ObjC.deepUnwrap(ObjC.castRefToObject(ref[0])) || [];
}

function walk(el, depth, out) {
    if (depth > 12 || out.length > 600) return;
    const node = {
        depth,
        role: str(attr(el, "AXRole")),
        title: str(attr(el, "AXTitle")),
        desc: str(attr(el, "AXDescription")),
        value: str(attr(el, "AXValue")),
        frame: frame(el),
        actions: actions(el),
    };
    out.push(node);
    const kids = attr(el, "AXChildren");
    if (!kids) return;
    const arr = ObjC.castRefToObject(kids);
    for (let i = 0; i < arr.count; i++) walk(arr.objectAtIndex(i), depth + 1, out);
}

function ax(sub) {
    const app = $.AXUIElementCreateApplication(livePid());
    const wins = attr(app, "AXWindows");
    if (!wins) return { error: "no AXWindows" };
    const arr = ObjC.castRefToObject(wins);
    const titles = [];
    for (let i = 0; i < arr.count; i++) {
        const w = arr.objectAtIndex(i);
        const title = str(attr(w, "AXTitle")) || "";
        titles.push(title);
        if (title.includes(sub)) { const out = []; walk(w, 0, out); return out; }
    }
    return { error: "no window matched", titles };
}

function run(argv) {
    const [cmd, a, b] = argv;
    if (cmd === "windows") return JSON.stringify(windows());
    if (cmd === "capture") return JSON.stringify(capture(Number(a), b));
    if (cmd === "ax") return JSON.stringify(ax(a));
    return "usage: windows | capture <id> <out.png> | ax <title>";
}
