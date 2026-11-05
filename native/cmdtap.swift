// cmdtap: tells ClearDay when a key (⌘ by default) is pressed twice, from
// anywhere.
//
// A listen-only event tap on modifier changes and key presses. A "tap" is
// the key pressed and released on its own (no other key or modifier in
// between, under 0.35 s); two taps within 0.45 s print "double". Other lines:
//   "permission"  macOS hasn't allowed Input Monitoring yet (asked once)
//   "ready"       listening
// The key is a modifier ("command", "option", "control", "shift", "fn") or
// any other key by its macOS key code ("code:17" is T); "none" listens for
// nothing. "--key option" at launch, and a "key option" line on stdin to
// change it. It exits when ClearDay closes its stdin.
import Cocoa
import IOKit.hid

setvbuf(stdout, nil, _IOLBF, 0)

let maxPress: CFTimeInterval = 0.35
let maxGap: CFTimeInterval = 0.45
let modifiers: [String: CGEventFlags] = [
  "command": .maskCommand, "option": .maskAlternate, "control": .maskControl, "shift": .maskShift,
  "fn": .maskSecondaryFn,
]
let allModifiers: CGEventFlags = [.maskCommand, .maskShift, .maskControl, .maskAlternate, .maskSecondaryFn]
// fn rides along with arrows and F-keys on a laptop, so a plain key ignores it.
let plainModifiers: CGEventFlags = [.maskCommand, .maskShift, .maskControl, .maskAlternate]

enum Target { case modifier(CGEventFlags), key(Int64), none }

var tap: CFMachPort?
var target = Target.modifier(.maskCommand)
var downAt: CFTimeInterval?
var keyWhileDown = false
var lastTap: CFTimeInterval = 0

// On the main thread, where the tap runs.
func use(_ spec: String) {
  if let flags = modifiers[spec] {
    target = .modifier(flags)
  } else if spec.hasPrefix("code:"), let code = Int64(spec.dropFirst(5)) {
    target = .key(code)
  } else {
    target = .none
  }
  downAt = nil
  lastTap = 0
}

func say(_ line: String) { print(line); fflush(stdout) }

func released(after down: CFTimeInterval, at now: CFTimeInterval) {
  if now - down < maxPress {
    if lastTap > 0 && now - lastTap < maxGap { say("double"); lastTap = 0 } else { lastTap = now }
  } else {
    lastTap = 0
  }
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  let now = CACurrentMediaTime()
  let keycode = event.getIntegerValueField(.keyboardEventKeycode)
  switch (type, target) {
  case (.tapDisabledByTimeout, _), (.tapDisabledByUserInput, _):
    if let t = tap { CGEvent.tapEnable(tap: t, enable: true) }

  // A modifier on its own
  case (.keyDown, .modifier):
    keyWhileDown = true
    lastTap = 0
  case (.flagsChanged, .modifier(let flags)):
    if !event.flags.intersection(allModifiers.subtracting(flags)).isEmpty {
      downAt = nil
      lastTap = 0
    } else if event.flags.contains(flags) {
      if downAt == nil { downAt = now; keyWhileDown = false }
    } else if let down = downAt {
      downAt = nil
      if keyWhileDown { lastTap = 0 } else { released(after: down, at: now) }
    }

  // Any other key
  case (.keyDown, .key(let code)):
    if keycode == code && event.flags.intersection(plainModifiers).isEmpty {
      if downAt == nil && event.getIntegerValueField(.keyboardEventAutorepeat) == 0 { downAt = now }
    } else {
      downAt = nil
      lastTap = 0
    }
  case (.keyUp, .key(let code)):
    if keycode == code, let down = downAt {
      downAt = nil
      released(after: down, at: now)
    }
  case (.flagsChanged, .key):
    if !event.flags.intersection(plainModifiers).isEmpty {
      downAt = nil
      lastTap = 0
    }

  default:
    break
  }
  return Unmanaged.passUnretained(event)
}

func startTap() -> Bool {
  let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
    | (1 << CGEventType.keyUp.rawValue)
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
