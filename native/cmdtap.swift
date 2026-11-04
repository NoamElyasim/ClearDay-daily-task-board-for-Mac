// cmdtap: tells ClearDay when ⌘ is pressed twice, from anywhere.
//
// A listen-only event tap on modifier changes and key presses. A "tap" is
// ⌘ pressed and released on its own (no other key or modifier in between,
// under 0.35 s); two taps within 0.45 s print "double". Other lines:
//   "permission"  macOS hasn't allowed Input Monitoring yet (asked once)
//   "ready"       listening
// It exits when ClearDay closes its stdin.
import Cocoa
import IOKit.hid

setvbuf(stdout, nil, _IOLBF, 0)

let maxPress: CFTimeInterval = 0.35
let maxGap: CFTimeInterval = 0.45
let otherModifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskSecondaryFn]

var tap: CFMachPort?
var cmdDownAt: CFTimeInterval?
var keyWhileDown = false
var lastTap: CFTimeInterval = 0

func say(_ line: String) { print(line); fflush(stdout) }

let callback: CGEventTapCallBack = { _, type, event, _ in
  switch type {
  case .tapDisabledByTimeout, .tapDisabledByUserInput:
    if let t = tap { CGEvent.tapEnable(tap: t, enable: true) }
  case .keyDown:
    keyWhileDown = true
    lastTap = 0
  case .flagsChanged:
    let flags = event.flags
    if !flags.intersection(otherModifiers).isEmpty {
      cmdDownAt = nil
      lastTap = 0
      break
    }
    let now = CACurrentMediaTime()
    if flags.contains(.maskCommand) {
      if cmdDownAt == nil { cmdDownAt = now; keyWhileDown = false }
    } else if let down = cmdDownAt {
      cmdDownAt = nil
      if !keyWhileDown && now - down < maxPress {
        if lastTap > 0 && now - lastTap < maxGap { say("double"); lastTap = 0 } else { lastTap = now }
      } else {
        lastTap = 0
      }
    }
  default:
    break
  }
  return Unmanaged.passUnretained(event)
}

func startTap() -> Bool {
  let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
  guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                  eventsOfInterest: CGEventMask(mask), callback: callback, userInfo: nil) else { return false }
  tap = t
  let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
  CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
  CGEvent.tapEnable(tap: t, enable: true)
  say("ready")
  return true
}

// ClearDay going away closes our stdin: leave with it.
Thread.detachNewThread {
  while readLine() != nil {}
  exit(0)
}

if IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) != kIOHIDAccessTypeGranted {
  say("permission")
  _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
}
if !startTap() {
  // Not allowed yet: try again until the switch in System Settings is on.
  Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { timer in
    if startTap() { timer.invalidate() }
  }
}
RunLoop.main.run()
