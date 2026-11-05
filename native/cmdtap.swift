// cmdtap: tells ClearDay when a modifier key (⌘ by default) is pressed
// twice, from anywhere.
//
// A listen-only event tap on modifier changes and key presses. A "tap" is
// the key pressed and released on its own (no other key or modifier in
// between, under 0.35 s); two taps within 0.45 s print "double". Other lines:
//   "permission"  macOS hasn't allowed Input Monitoring yet (asked once)
//   "ready"       listening
// The key is "command", "option", "control" or "shift": "--key option" at
// launch, and a "key option" line on stdin to change it. It exits when
// ClearDay closes its stdin.
import Cocoa
import IOKit.hid

setvbuf(stdout, nil, _IOLBF, 0)

let maxPress: CFTimeInterval = 0.35
let maxGap: CFTimeInterval = 0.45
let keys: [String: CGEventFlags] = [
  "command": .maskCommand, "option": .maskAlternate, "control": .maskControl, "shift": .maskShift,
]
let allModifiers: CGEventFlags = [.maskCommand, .maskShift, .maskControl, .maskAlternate, .maskSecondaryFn]

var tap: CFMachPort?
var target: CGEventFlags = .maskCommand
var otherModifiers = allModifiers.subtracting(target)
var downAt: CFTimeInterval?
var keyWhileDown = false
var lastTap: CFTimeInterval = 0

// On the main thread, where the tap runs.
func use(_ name: String) {
  guard let flags = keys[name] else { return }
  target = flags
  otherModifiers = allModifiers.subtracting(flags)
  downAt = nil
  lastTap = 0
}

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
      downAt = nil
      lastTap = 0
      break
    }
    let now = CACurrentMediaTime()
    if flags.contains(target) {
      if downAt == nil { downAt = now; keyWhileDown = false }
    } else if let down = downAt {
      downAt = nil
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

let args = CommandLine.arguments
if let i = args.firstIndex(of: "--key"), i + 1 < args.count { use(args[i + 1]) }

// "key option" lines switch the key; ClearDay going away closes our stdin:
// leave with it.
Thread.detachNewThread {
  while let line = readLine() {
    if line.hasPrefix("key ") {
      let name = String(line.dropFirst(4))
      DispatchQueue.main.async { use(name) }
    }
  }
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
