// pointer: tells ClearDay where the pointer is while it's over ClearDay's
// window and nothing else is in front of it there (the window a click at that
// spot would reach). ClearDay uses it to keep hover working while another app
// is active, when macOS sends its window no pointer moves.
//
// stdin:  "watch <window number>"   start (the number from getMediaSourceId)
//         "stop"                    stop
// stdout: "move <x> <y>"   the pointer, in screen points from the top left,
//                          each time it moves over the window
//         "away"           it left the window, or something now covers it
// Needs no permission. It exits when ClearDay closes its stdin.
import Cocoa

setvbuf(stdout, nil, _IOLBF, 0)

// AppKit has to be up for windowNumber(at:); no Dock icon, no menu.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

var target = 0
var over = false
var last = ""

func say(_ line: String) { print(line); fflush(stdout) }

func check() {
  guard target != 0 else { return }
  let hit = NSWindow.windowNumber(at: NSEvent.mouseLocation, belowWindowWithWindowNumber: 0) == target
  let p = CGEvent(source: nil)?.location ?? .zero   // top-left origin, as Electron counts
  let spot = "\(Int(p.x.rounded())) \(Int(p.y.rounded()))"
  if hit {
    if !over || spot != last { say("move \(spot)") }
    over = true
    last = spot
  } else if over {
    over = false
    say("away")
  }
}

_ = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { _ in check() }
// A window can also slide over a pointer that's standing still.
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in check() }

Thread.detachNewThread {
  while let line = readLine() {
    DispatchQueue.main.async {
      if line.hasPrefix("watch "), let n = Int(line.dropFirst(6)) {
        target = n
        over = false
        last = ""
        check()
      } else if line == "stop" {
        target = 0
        over = false
      }
    }
  }
  exit(0)
}

app.run()
