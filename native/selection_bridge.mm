#include <napi.h>

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>

#include <cmath>
#include <mutex>
#include <string>

namespace {

enum class SelectionScene {
  kNone = 0,
  kBoxSelect = 1,
  kMultiClickSelect = 2,
  kShiftArrowSelect = 3,
  kShiftMouseClick = 4,
  kCtrlASelect = 5,
  kManualTrigger = 6,
  kGestureDismiss = 7,
  kOtherClickDismiss = 8,
  kKeyDismiss = 9,
  kWindowFrameDismiss = 10
};

const char* SceneToString(SelectionScene s) {
  switch (s) {
    case SelectionScene::kBoxSelect: return "box_select";
    case SelectionScene::kMultiClickSelect: return "multi_click_select";
    case SelectionScene::kShiftArrowSelect: return "shift_arrow_select";
    case SelectionScene::kShiftMouseClick: return "shift_mouse_click";
    case SelectionScene::kCtrlASelect: return "ctrl_a_select";
    case SelectionScene::kManualTrigger: return "manual_trigger";
    case SelectionScene::kGestureDismiss: return "gesture_dismiss";
    case SelectionScene::kOtherClickDismiss: return "other_click_dismiss";
    case SelectionScene::kKeyDismiss: return "key_dismiss";
    case SelectionScene::kWindowFrameDismiss: return "window_frame_dismiss";
    default: return "none";
  }
}

SelectionScene SceneFromString(const std::string& v) {
  if (v == "box_select") return SelectionScene::kBoxSelect;
  if (v == "multi_click_select") return SelectionScene::kMultiClickSelect;
  if (v == "shift_arrow_select") return SelectionScene::kShiftArrowSelect;
  if (v == "shift_mouse_click") return SelectionScene::kShiftMouseClick;
  if (v == "ctrl_a_select") return SelectionScene::kCtrlASelect;
  if (v == "manual_trigger") return SelectionScene::kManualTrigger;
  if (v == "gesture_dismiss") return SelectionScene::kGestureDismiss;
  if (v == "other_click_dismiss") return SelectionScene::kOtherClickDismiss;
  if (v == "key_dismiss") return SelectionScene::kKeyDismiss;
  if (v == "window_frame_dismiss") return SelectionScene::kWindowFrameDismiss;
  return SelectionScene::kNone;
}

struct ActionEvent {
  SelectionScene scene;
  double x;
  double y;
};

id gGlobalMouseMonitor = nil;
id gGlobalKeyMonitor = nil;
id gActiveSpaceObserver = nil;
id gAppActivatedObserver = nil;
id gAppDeactivatedObserver = nil;
AXObserverRef gFocusedWindowObserver = nullptr;
AXUIElementRef gObservedApp = nullptr;
Napi::ThreadSafeFunction* gActionTsfn = nullptr;
std::mutex gMonitorMutex;
NSInteger gBubbleWindowNumber = -1;

bool gIsLeftMouseDown = false;
bool gLeftMouseDownOnBubble = false;
NSPoint gMouseDownPoint = NSZeroPoint;
bool gShiftHeldOnMouseDown = false;

bool gShiftKeyDown = false;
bool gArrowAfterShift = false;

static constexpr double kScrollGestureDeltaThreshold = 4.0;
static constexpr double kDragThreshold = 3.0;

std::string ToStdString(NSString* value) {
  if (value == nil) return "";
  const char* utf8 = [value UTF8String];
  return utf8 ? std::string(utf8) : "";
}

NSWindow* GetBubbleWindow() {
  if (gBubbleWindowNumber < 0) return nil;

  for (NSWindow* window in NSApp.windows) {
    if (window.windowNumber == gBubbleWindowNumber) {
      return window;
    }
  }

  return nil;
}

bool IsPointInsideBubbleWindow(NSPoint point) {
  NSWindow* bubbleWindow = GetBubbleWindow();
  if (!bubbleWindow || ![bubbleWindow isVisible]) {
    return false;
  }

  return NSPointInRect(point, [bubbleWindow frame]);
}

bool GetAXStringAttr(AXUIElementRef el, CFStringRef attr, std::string* out) {
  if (!el || !out) return false;
  out->clear();
  CFTypeRef val = nullptr;
  if (AXUIElementCopyAttributeValue(el, attr, &val) != kAXErrorSuccess || !val) return false;

  bool ok = false;
  if (CFGetTypeID(val) == CFStringGetTypeID()) {
    *out = ToStdString((__bridge NSString*)val);
    ok = true;
  }
  CFRelease(val);
  return ok;
}

bool GetAXBoolAttr(AXUIElementRef el, CFStringRef attr, bool def) {
  if (!el) return def;
  CFTypeRef val = nullptr;
  if (AXUIElementCopyAttributeValue(el, attr, &val) != kAXErrorSuccess || !val) return def;

  bool result = def;
  if (CFGetTypeID(val) == CFBooleanGetTypeID()) {
    result = CFBooleanGetValue(static_cast<CFBooleanRef>(val));
  }

  CFRelease(val);
  return result;
}

void ReleaseAX(AXUIElementRef* el) {
  if (el && *el) {
    CFRelease(*el);
    *el = nullptr;
  }
}

bool GetFocused(AXUIElementRef* outApp, AXUIElementRef* outElem) {
  *outApp = nullptr;
  *outElem = nullptr;

  AXUIElementRef sys = AXUIElementCreateSystemWide();
  if (!sys) return false;

  CFTypeRef appVal = nullptr;
  AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute, &appVal);

  if (appVal && CFGetTypeID(appVal) == AXUIElementGetTypeID()) {
    *outApp = (AXUIElementRef)appVal;

    CFTypeRef elemVal = nullptr;
    AXUIElementCopyAttributeValue(*outApp, kAXFocusedUIElementAttribute, &elemVal);
    if (elemVal && CFGetTypeID(elemVal) == AXUIElementGetTypeID()) {
      *outElem = (AXUIElementRef)elemVal;
    } else if (elemVal) {
      CFRelease(elemVal);
    }
  } else if (appVal) {
    CFRelease(appVal);
  }

  if (!*outElem) {
    CFTypeRef sysElem = nullptr;
    AXUIElementCopyAttributeValue(sys, kAXFocusedUIElementAttribute, &sysElem);
    if (sysElem && CFGetTypeID(sysElem) == AXUIElementGetTypeID()) {
      *outElem = (AXUIElementRef)sysElem;
    } else if (sysElem) {
      CFRelease(sysElem);
    }
  }

  CFRelease(sys);
  return *outApp || *outElem;
}

bool GetAXSelectedText(AXUIElementRef el, std::string* out) {
  if (!el) return false;

  CFTypeRef val = nullptr;
  AXError err = AXUIElementCopyAttributeValue(el, kAXSelectedTextAttribute, &val);
  if (err != kAXErrorSuccess || !val) return false;

  bool ok = false;
  if (CFGetTypeID(val) == CFStringGetTypeID()) {
    *out = ToStdString((__bridge NSString*)val);
    ok = !out->empty();
  }

  CFRelease(val);
  return ok;
}

bool GetFirstRange(AXUIElementRef el, CFTypeRef* outRange) {
  *outRange = nullptr;

  CFTypeRef rv = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute, &rv) == kAXErrorSuccess &&
      rv) {
    *outRange = rv;
    return true;
  }

  CFTypeRef ranges = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXSelectedTextRangesAttribute, &ranges) !=
          kAXErrorSuccess ||
      !ranges) {
    return false;
  }

  if (CFGetTypeID(ranges) != CFArrayGetTypeID()) {
    CFRelease(ranges);
    return false;
  }

  CFArrayRef arr = (CFArrayRef)ranges;
  if (CFArrayGetCount(arr) <= 0) {
    CFRelease(ranges);
    return false;
  }

  CFTypeRef first = CFArrayGetValueAtIndex(arr, 0);
  if (first) {
    CFRetain(first);
    *outRange = first;
  }

  CFRelease(ranges);
  return *outRange != nullptr;
}

bool HasNonEmptyRange(AXUIElementRef el) {
  CFTypeRef rv = nullptr;
  if (!GetFirstRange(el, &rv) || !rv) return false;

  bool nonEmpty = false;
  if (CFGetTypeID(rv) == AXValueGetTypeID()) {
    AXValueRef axv = (AXValueRef)rv;
    if (AXValueGetType(axv) == kAXValueTypeCFRange) {
      CFRange range;
      if (AXValueGetValue(axv, kAXValueTypeCFRange, &range)) {
        nonEmpty = range.length > 0;
      }
    }
  }

  CFRelease(rv);
  return nonEmpty;
}

bool GetTextByRange(AXUIElementRef el, std::string* out) {
  CFTypeRef rv = nullptr;
  if (!GetFirstRange(el, &rv) || !rv) return false;

  CFTypeRef textVal = nullptr;
  AXError err =
      AXUIElementCopyParameterizedAttributeValue(el, kAXStringForRangeParameterizedAttribute, rv,
                                                 &textVal);
  CFRelease(rv);
  if (err != kAXErrorSuccess || !textVal) return false;

  bool ok = false;
  if (CFGetTypeID(textVal) == CFStringGetTypeID()) {
    *out = ToStdString((__bridge NSString*)textVal);
    ok = !out->empty();
  }

  CFRelease(textVal);
  return ok;
}

bool FillRect(AXUIElementRef el, Napi::Object* result, Napi::Env env) {
  CFTypeRef rv = nullptr;
  if (!GetFirstRange(el, &rv) || !rv) return false;

  CFTypeRef bv = nullptr;
  AXError err =
      AXUIElementCopyParameterizedAttributeValue(el, kAXBoundsForRangeParameterizedAttribute, rv,
                                                 &bv);
  CFRelease(rv);
  if (err != kAXErrorSuccess || !bv) return false;

  bool ok = false;
  if (CFGetTypeID(bv) == AXValueGetTypeID()) {
    AXValueRef axb = (AXValueRef)bv;
    if (AXValueGetType(axb) == kAXValueTypeCGRect) {
      CGRect rect;
      if (AXValueGetValue(axb, kAXValueTypeCGRect, &rect)) {
        Napi::Object r = Napi::Object::New(env);
        r.Set("x", rect.origin.x);
        r.Set("y", rect.origin.y);
        r.Set("width", rect.size.width);
        r.Set("height", rect.size.height);
        result->Set("rect", r);
        result->Set("hasRect", true);
        ok = true;
      }
    }
  }

  CFRelease(bv);
  return ok;
}

NSString* SavePasteboardText() {
  NSPasteboard* pb = [NSPasteboard generalPasteboard];
  return [pb stringForType:NSPasteboardTypeString];
}

void PostCmdC() {
  CGEventRef down = CGEventCreateKeyboardEvent(nullptr, kVK_ANSI_C, true);
  if (down) {
    CGEventSetFlags(down, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, down);
    CFRelease(down);
  }

  CGEventRef up = CGEventCreateKeyboardEvent(nullptr, kVK_ANSI_C, false);
  if (up) {
    CGEventSetFlags(up, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(up);
  }
}

bool IsCopyMenuItem(AXUIElementRef item) {
  if (!item) return false;

  std::string role;
  if (!GetAXStringAttr(item, kAXRoleAttribute, &role) ||
      role != ToStdString((__bridge NSString*)kAXMenuItemRole)) {
    return false;
  }

  if (!GetAXBoolAttr(item, kAXEnabledAttribute, true)) return false;

  std::string ident;
  if (GetAXStringAttr(item, kAXIdentifierAttribute, &ident)) {
    if ([[@(ident.c_str()) lowercaseString] hasSuffix:@"copy:"]) return true;
  }

  std::string cmd;
  std::string title;
  GetAXStringAttr(item, kAXMenuItemCmdCharAttribute, &cmd);
  GetAXStringAttr(item, kAXTitleAttribute, &title);

  if (!cmd.empty() && !title.empty()) {
    bool isC = [[@(cmd.c_str()) lowercaseString] isEqualToString:@"c"];
    if (isC) {
      NSString* t = @(title.c_str());
      NSString* low = [t lowercaseString];
      if ([low containsString:@"copy"] || [t containsString:@"复制"]) return true;
    }
  }

  return false;
}

bool FindCopyDFS(AXUIElementRef root, int depth, AXUIElementRef* out) {
  if (!root || !out || depth > 14) return false;

  if (IsCopyMenuItem(root)) {
    *out = root;
    CFRetain(root);
    return true;
  }

  CFTypeRef children = nullptr;
  if (AXUIElementCopyAttributeValue(root, kAXChildrenAttribute, &children) != kAXErrorSuccess ||
      !children) {
    return false;
  }

  bool found = false;
  if (CFGetTypeID(children) == CFArrayGetTypeID()) {
    CFArrayRef arr = (CFArrayRef)children;
    for (CFIndex i = 0; i < CFArrayGetCount(arr); i++) {
      CFTypeRef ch = CFArrayGetValueAtIndex(arr, i);
      if (ch && CFGetTypeID(ch) == AXUIElementGetTypeID()) {
        if (FindCopyDFS((AXUIElementRef)const_cast<void*>(ch), depth + 1, out)) {
          found = true;
          break;
        }
      }
    }
  }

  CFRelease(children);
  return found;
}

bool TriggerMenuCopy(AXUIElementRef app) {
  if (!app) return false;

  CFTypeRef mb = nullptr;
  if (AXUIElementCopyAttributeValue(app, kAXMenuBarAttribute, &mb) != kAXErrorSuccess || !mb) {
    return false;
  }

  bool ok = false;
  if (CFGetTypeID(mb) == AXUIElementGetTypeID()) {
    AXUIElementRef item = nullptr;
    if (FindCopyDFS((AXUIElementRef)mb, 0, &item) && item) {
      ok = AXUIElementPerformAction(item, kAXPressAction) == kAXErrorSuccess;
      CFRelease(item);
    }
  }

  CFRelease(mb);
  return ok;
}

std::string GetTextByClipboard(bool useMenu, AXUIElementRef app) {
  @autoreleasepool {
    NSPasteboard* pb = [NSPasteboard generalPasteboard];
    NSString* savedText = SavePasteboardText();
    NSInteger changeCountBefore = [pb changeCount];

    if (useMenu) {
      if (!TriggerMenuCopy(app)) return "";
    } else {
      PostCmdC();
    }

    NSString* result = nil;
    NSInteger changeCountAfterCopy = changeCountBefore;
    for (int i = 0; i < 24; i++) {
      [NSThread sleepForTimeInterval:0.025];
      if ([pb changeCount] != changeCountBefore) {
        changeCountAfterCopy = [pb changeCount];
        result = [pb stringForType:NSPasteboardTypeString];
        break;
      }
    }

    if (changeCountAfterCopy != changeCountBefore && [pb changeCount] == changeCountAfterCopy) {
      [pb clearContents];
      if (savedText) {
        [pb setString:savedText forType:NSPasteboardTypeString];
      }
    }

    return ToStdString(result);
  }
}

bool CopySelection(bool useMenu, AXUIElementRef app, NSString* expectedText) {
  @autoreleasepool {
    NSPasteboard* pb = [NSPasteboard generalPasteboard];
    NSInteger changeCountBefore = [pb changeCount];

    if (useMenu) {
      if (!TriggerMenuCopy(app)) return false;
    } else {
      PostCmdC();
    }

    for (int i = 0; i < 24; i++) {
      [NSThread sleepForTimeInterval:0.025];

      if ([pb changeCount] != changeCountBefore) {
        return true;
      }

      if (expectedText) {
        NSString* currentText = [pb stringForType:NSPasteboardTypeString];
        if (currentText && [currentText isEqualToString:expectedText]) {
          return true;
        }
      }
    }

    return false;
  }
}

bool ShouldClipboardFallback(NSString* bundleId, SelectionScene scene, bool axGotFocusedElement,
                             bool hasNonEmptyRange) {
  if (scene == SelectionScene::kNone) return false;

  if (bundleId && ([bundleId isEqualToString:@"com.github.Electron"] ||
                   [bundleId hasPrefix:@"com.github.electron"])) {
    return false;
  }

  if (scene == SelectionScene::kManualTrigger) return true;
  if (!axGotFocusedElement) return true;
  if (hasNonEmptyRange) return true;

  // AX found a focused element but could not read selection text or range
  // (e.g. Canvas-based content like VS Code's xterm.js terminal).
  // Attempt clipboard fallback for real selection actions as a last resort.
  return true;
}

bool IsTrusted(bool prompt) {
  if (!prompt) return AXIsProcessTrustedWithOptions(nullptr);

  const void* keys[] = {kAXTrustedCheckOptionPrompt};
  const void* values[] = {kCFBooleanTrue};
  CFDictionaryRef opts =
      CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1,
                         &kCFCopyStringDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  bool trusted = AXIsProcessTrustedWithOptions(opts);
  CFRelease(opts);
  return trusted;
}

SelectionScene DetectMouseUpScene(NSEvent* event, NSPoint loc) {
  if (!gIsLeftMouseDown) return SelectionScene::kNone;
  if (gShiftHeldOnMouseDown) return SelectionScene::kShiftMouseClick;
  if ([event clickCount] >= 2) return SelectionScene::kMultiClickSelect;

  double dx = loc.x - gMouseDownPoint.x;
  double dy = loc.y - gMouseDownPoint.y;
  if (sqrt(dx * dx + dy * dy) > kDragThreshold) return SelectionScene::kBoxSelect;

  return SelectionScene::kNone;
}

void EmitAction(SelectionScene scene, NSPoint pt) {
  std::lock_guard<std::mutex> lock(gMonitorMutex);
  if (!gActionTsfn) return;

  auto* ev = new ActionEvent{scene, pt.x, pt.y};
  auto status = gActionTsfn->NonBlockingCall(ev, [](Napi::Env env, Napi::Function cb,
                                                    ActionEvent* event) {
    Napi::Object payload = Napi::Object::New(env);
    payload.Set("scene", Napi::String::New(env, SceneToString(event->scene)));
    payload.Set("x", event->x);
    payload.Set("y", event->y);
    cb.Call({payload});
    delete event;
  });

  if (status != napi_ok) {
    delete ev;
  }
}

void StopWindowObserver() {
  if (gFocusedWindowObserver) {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(gFocusedWindowObserver),
                          kCFRunLoopDefaultMode);
    CFRelease(gFocusedWindowObserver);
    gFocusedWindowObserver = nullptr;
  }

  if (gObservedApp) {
    CFRelease(gObservedApp);
    gObservedApp = nullptr;
  }
}

void OnWindowFrameChanged(AXObserverRef, AXUIElementRef, CFStringRef, void*) {
  EmitAction(SelectionScene::kWindowFrameDismiss, [NSEvent mouseLocation]);
}

void StartWindowObserver() {
  StopWindowObserver();

  NSRunningApplication* frontApp = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!frontApp) return;

  pid_t pid = frontApp.processIdentifier;
  AXObserverRef observer = nullptr;
  if (AXObserverCreate(pid, OnWindowFrameChanged, &observer) != kAXErrorSuccess || !observer) {
    return;
  }

  AXUIElementRef app = AXUIElementCreateApplication(pid);
  if (!app) {
    CFRelease(observer);
    return;
  }

  AXObserverAddNotification(observer, app, kAXMovedNotification, nullptr);
  AXObserverAddNotification(observer, app, kAXResizedNotification, nullptr);
  AXObserverAddNotification(observer, app, kAXFocusedWindowChangedNotification, nullptr);

  CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer),
                     kCFRunLoopDefaultMode);

  gFocusedWindowObserver = observer;
  gObservedApp = app;
}

void RemoveMonitorsLocked() {
  if (gGlobalMouseMonitor) {
    [NSEvent removeMonitor:gGlobalMouseMonitor];
    gGlobalMouseMonitor = nil;
  }

  if (gGlobalKeyMonitor) {
    [NSEvent removeMonitor:gGlobalKeyMonitor];
    gGlobalKeyMonitor = nil;
  }

  StopWindowObserver();

  NSNotificationCenter* workspaceNC = [NSWorkspace.sharedWorkspace notificationCenter];
  if (gActiveSpaceObserver) {
    [workspaceNC removeObserver:gActiveSpaceObserver];
    gActiveSpaceObserver = nil;
  }

  if (gAppActivatedObserver) {
    [workspaceNC removeObserver:gAppActivatedObserver];
    gAppActivatedObserver = nil;
  }

  if (gAppDeactivatedObserver) {
    [workspaceNC removeObserver:gAppDeactivatedObserver];
    gAppDeactivatedObserver = nil;
  }

  if (gActionTsfn) {
    gActionTsfn->Release();
    delete gActionTsfn;
    gActionTsfn = nullptr;
  }
}

void RemoveMonitors() {
  if ([NSThread isMainThread]) {
    std::lock_guard<std::mutex> lock(gMonitorMutex);
    RemoveMonitorsLocked();
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      std::lock_guard<std::mutex> lock(gMonitorMutex);
      RemoveMonitorsLocked();
    });
  }
}

bool IsArrowKey(unsigned short kc) {
  return kc == kVK_LeftArrow || kc == kVK_RightArrow || kc == kVK_UpArrow ||
         kc == kVK_DownArrow || kc == kVK_Home || kc == kVK_End;
}

void HandleKeyEvent(NSEvent* event) {
  if (event.type == NSEventTypeFlagsChanged) {
    bool shiftNow = (event.modifierFlags & NSEventModifierFlagShift) != 0;

    if (shiftNow && !gShiftKeyDown) {
      gShiftKeyDown = true;
      gArrowAfterShift = false;
    } else if (!shiftNow && gShiftKeyDown) {
      gShiftKeyDown = false;
      if (gArrowAfterShift) {
        gArrowAfterShift = false;
        EmitAction(SelectionScene::kShiftArrowSelect, [NSEvent mouseLocation]);
      }
    }
    return;
  }

  if (event.type == NSEventTypeKeyDown) {
    NSEventModifierFlags flags = event.modifierFlags;
    unsigned short kc = event.keyCode;

    if ((flags & NSEventModifierFlagShift) && IsArrowKey(kc)) {
      gArrowAfterShift = true;
      return;
    }

    if ((flags & NSEventModifierFlagCommand) && kc == kVK_ANSI_A) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(150 * NSEC_PER_MSEC)),
                     dispatch_get_main_queue(), ^{
        EmitAction(SelectionScene::kCtrlASelect, [NSEvent mouseLocation]);
      });
      return;
    }

    if ((flags & NSEventModifierFlagCommand) && kc == kVK_ANSI_C) {
      return;
    }

    EmitAction(SelectionScene::kKeyDismiss, [NSEvent mouseLocation]);
  }
}

Napi::Value CheckPermission(const Napi::CallbackInfo& info) {
  bool prompt = info.Length() >= 1 && info[0].IsBoolean() &&
                info[0].As<Napi::Boolean>().Value();
  return Napi::Boolean::New(info.Env(), IsTrusted(prompt));
}

Napi::Value GetSelectionSnapshot(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  SelectionScene scene = SelectionScene::kNone;
  if (info.Length() >= 1) {
    if (info[0].IsString()) {
      scene = SceneFromString(info[0].As<Napi::String>().Utf8Value());
    } else if (info[0].IsObject()) {
      Napi::Object opts = info[0].As<Napi::Object>();
      if (opts.Has("scene") && opts.Get("scene").IsString()) {
        scene = SceneFromString(opts.Get("scene").As<Napi::String>().Utf8Value());
      }
    }
  }

  result.Set("text", "");
  result.Set("sourceApp", "");
  result.Set("sourceBundleId", "");
  result.Set("scene", SceneToString(scene));
  result.Set("hasRect", false);
  result.Set("strategy", "none");

  if (!IsTrusted(false)) {
    result.Set("error", "accessibility_permission_denied");
    return result;
  }

  NSRunningApplication* frontApp = NSWorkspace.sharedWorkspace.frontmostApplication;
  NSString* bundleId = frontApp.bundleIdentifier ?: @"";
  NSString* appName = frontApp.localizedName ?: @"";
  result.Set("sourceApp", ToStdString(appName));
  result.Set("sourceBundleId", ToStdString(bundleId));
  result.Set("sourceAppPid", frontApp ? (double)frontApp.processIdentifier : -1.0);

  AXUIElementRef focusedApp = nullptr;
  AXUIElementRef focusedElem = nullptr;
  GetFocused(&focusedApp, &focusedElem);

  std::string text;
  bool gotFocusedElement = focusedElem != nullptr;
  bool hasNonEmpty = false;

  if (focusedElem) {
    if (GetAXSelectedText(focusedElem, &text)) {
      result.Set("strategy", "ax_selected_text");
    }

    hasNonEmpty = HasNonEmptyRange(focusedElem);

    if (text.empty() && GetTextByRange(focusedElem, &text)) {
      result.Set("strategy", "ax_range_string");
    }

    FillRect(focusedElem, &result, env);
  }

  if (text.empty() &&
      ShouldClipboardFallback(bundleId, scene, gotFocusedElement, hasNonEmpty)) {
    result.Set("needsClipboardFallback", true);
    pid_t pid = frontApp ? frontApp.processIdentifier : -1;
    result.Set("fallbackAppPid", (double)pid);
  }

  result.Set("text", text);
  ReleaseAX(&focusedElem);
  ReleaseAX(&focusedApp);
  return result;
}

class ClipboardFallbackWorker : public Napi::AsyncWorker {
public:
  ClipboardFallbackWorker(Napi::Promise::Deferred deferred, bool useMenu, pid_t appPid)
    : Napi::AsyncWorker(deferred.Env()), deferred_(deferred), useMenu_(useMenu), appPid_(appPid) {}

  void Execute() override {
    @autoreleasepool {
      AXUIElementRef app = nullptr;
      if (useMenu_ && appPid_ > 0) {
        app = AXUIElementCreateApplication(appPid_);
      }
      result_ = GetTextByClipboard(useMenu_, app);
      if (app) CFRelease(app);
    }
  }

  void OnOK() override {
    deferred_.Resolve(Napi::String::New(Env(), result_));
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

private:
  Napi::Promise::Deferred deferred_;
  bool useMenu_;
  pid_t appPid_;
  std::string result_;
};

class CopySelectionWorker : public Napi::AsyncWorker {
public:
  CopySelectionWorker(Napi::Promise::Deferred deferred, bool useMenu, pid_t appPid,
                      std::string expectedText)
    : Napi::AsyncWorker(deferred.Env()),
      deferred_(deferred),
      useMenu_(useMenu),
      appPid_(appPid),
      expectedText_(std::move(expectedText)) {}

  void Execute() override {
    @autoreleasepool {
      AXUIElementRef app = nullptr;
      if (useMenu_ && appPid_ > 0) {
        app = AXUIElementCreateApplication(appPid_);
      }

      NSString* expected = expectedText_.empty() ? nil : @(expectedText_.c_str());
      copied_ = CopySelection(useMenu_, app, expected);

      if (app) CFRelease(app);
    }
  }

  void OnOK() override {
    deferred_.Resolve(Napi::Boolean::New(Env(), copied_));
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

private:
  Napi::Promise::Deferred deferred_;
  bool useMenu_;
  pid_t appPid_;
  std::string expectedText_;
  bool copied_ = false;
};

Napi::Value GetTextByClipboardAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool useMenu = info.Length() >= 1 && info[0].IsBoolean() && info[0].As<Napi::Boolean>().Value();
  pid_t pid = -1;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    pid = info[1].As<Napi::Number>().Int32Value();
  }

  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new ClipboardFallbackWorker(deferred, useMenu, pid);
  worker->Queue();
  return deferred.Promise();
}

Napi::Value CopySelectionAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool useMenu = info.Length() >= 1 && info[0].IsBoolean() && info[0].As<Napi::Boolean>().Value();
  pid_t pid = -1;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    pid = info[1].As<Napi::Number>().Int32Value();
  }

  std::string expectedText;
  if (info.Length() >= 3 && info[2].IsString()) {
    expectedText = info[2].As<Napi::String>().Utf8Value();
  }

  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new CopySelectionWorker(deferred, useMenu, pid, expectedText);
  worker->Queue();
  return deferred.Promise();
}

Napi::Value StartActionMonitor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "callback required").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (!IsTrusted(false)) return Napi::Boolean::New(env, false);

  Napi::Function cb = info[0].As<Napi::Function>();
  __block bool ok = false;

  auto task = ^{
    std::lock_guard<std::mutex> lock(gMonitorMutex);
    if (gGlobalMouseMonitor) {
      ok = true;
      return;
    }

    auto tsfn = Napi::ThreadSafeFunction::New(env, cb, "ActionMonitor", 0, 1);
    gActionTsfn = new Napi::ThreadSafeFunction(std::move(tsfn));

    gGlobalMouseMonitor = [NSEvent
        addGlobalMonitorForEventsMatchingMask:
            (NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown |
             NSEventMaskRightMouseUp | NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged |
             NSEventMaskRightMouseDragged | NSEventMaskScrollWheel | NSEventMaskOtherMouseDown |
             NSEventMaskOtherMouseUp | NSEventMaskOtherMouseDragged |
             NSEventMaskCursorUpdate)
                                   handler:^(NSEvent* event) {
      if (event.type == NSEventTypeRightMouseDown || event.type == NSEventTypeRightMouseUp) {
        if (IsPointInsideBubbleWindow([NSEvent mouseLocation])) {
          return;
        }
        EmitAction(SelectionScene::kOtherClickDismiss, [NSEvent mouseLocation]);
        return;
      }

      if (event.type == NSEventTypeOtherMouseDown || event.type == NSEventTypeOtherMouseUp) {
        if (IsPointInsideBubbleWindow([NSEvent mouseLocation])) {
          return;
        }
        EmitAction(SelectionScene::kOtherClickDismiss, [NSEvent mouseLocation]);
        return;
      }

      if (event.type == NSEventTypeScrollWheel) {
        const bool precise = [event hasPreciseScrollingDeltas];
        const NSEventPhase phase = [event phase];
        const double dx = std::abs([event scrollingDeltaX]);
        const double dy = std::abs([event scrollingDeltaY]);
        if (precise &&
            (phase == NSEventPhaseBegan || phase == NSEventPhaseChanged) &&
            (dx > kScrollGestureDeltaThreshold || dy > kScrollGestureDeltaThreshold)) {
          EmitAction(SelectionScene::kGestureDismiss, [NSEvent mouseLocation]);
        }
        return;
      }

      if (event.type == NSEventTypeLeftMouseDown) {
        NSPoint loc = [NSEvent mouseLocation];
        if (IsPointInsideBubbleWindow(loc)) {
          gLeftMouseDownOnBubble = true;
          gIsLeftMouseDown = false;
          gShiftHeldOnMouseDown = false;
          return;
        }

        gLeftMouseDownOnBubble = false;
        gIsLeftMouseDown = true;
        gMouseDownPoint = loc;
        gShiftHeldOnMouseDown = (event.modifierFlags & NSEventModifierFlagShift) != 0;
        return;
      }

      if (event.type == NSEventTypeLeftMouseUp) {
        if (gLeftMouseDownOnBubble) {
          gLeftMouseDownOnBubble = false;
          gIsLeftMouseDown = false;
          return;
        }

        NSPoint loc = [NSEvent mouseLocation];
        SelectionScene scene = DetectMouseUpScene(event, loc);
        gIsLeftMouseDown = false;
        EmitAction(scene, loc);
        return;
      }
    }];

    gGlobalKeyMonitor = [NSEvent
        addGlobalMonitorForEventsMatchingMask:
            (NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged)
                                   handler:^(NSEvent* event) {
      HandleKeyEvent(event);
    }];

    NSNotificationCenter* workspaceNC = [NSWorkspace.sharedWorkspace notificationCenter];
    gActiveSpaceObserver = [workspaceNC
        addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification
                    object:nil
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(__unused NSNotification*) {
      EmitAction(SelectionScene::kGestureDismiss, [NSEvent mouseLocation]);
    }];

    gAppActivatedObserver = [workspaceNC
        addObserverForName:NSWorkspaceDidActivateApplicationNotification
                    object:nil
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(NSNotification* note) {
      NSDictionary* userInfo = note.userInfo;
      NSRunningApplication* activatedApp = userInfo[NSWorkspaceApplicationKey];
      if (activatedApp &&
          activatedApp.processIdentifier ==
              NSRunningApplication.currentApplication.processIdentifier) {
        return;
      }
      StartWindowObserver();
      EmitAction(SelectionScene::kGestureDismiss, [NSEvent mouseLocation]);
    }];

    gAppDeactivatedObserver = [workspaceNC
        addObserverForName:NSWorkspaceDidDeactivateApplicationNotification
                    object:nil
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(__unused NSNotification*) {
      EmitAction(SelectionScene::kGestureDismiss, [NSEvent mouseLocation]);
    }];

    StartWindowObserver();

    if (!gGlobalMouseMonitor) {
      RemoveMonitorsLocked();
      ok = false;
      return;
    }

    ok = true;
  };

  if ([NSThread isMainThread]) {
    task();
  } else {
    dispatch_sync(dispatch_get_main_queue(), task);
  }

  return Napi::Boolean::New(env, ok);
}

Napi::Value StopActionMonitor(const Napi::CallbackInfo& info) {
  RemoveMonitors();
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value GetCursorPosition(const Napi::CallbackInfo& info) {
  NSPoint loc = [NSEvent mouseLocation];
  Napi::Object result = Napi::Object::New(info.Env());
  result.Set("x", loc.x);
  result.Set("y", loc.y);
  return result;
}

Napi::Value GetFrontmostAppInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);
  NSRunningApplication* app = NSWorkspace.sharedWorkspace.frontmostApplication;
  result.Set("bundleId", ToStdString(app.bundleIdentifier ?: @""));
  result.Set("name", ToStdString(app.localizedName ?: @""));
  result.Set("pid", app ? (double)app.processIdentifier : -1.0);
  return result;
}

Napi::Value ConfigureBubbleWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    return Napi::Boolean::New(env, false);
  }

  auto buf = info[0].As<Napi::Buffer<void*>>();
  if (buf.ByteLength() < sizeof(void*)) {
    return Napi::Boolean::New(env, false);
  }

  void* viewPtr = *reinterpret_cast<void**>(buf.Data());
  if (!viewPtr) return Napi::Boolean::New(env, false);

  NSView* nsView = (__bridge NSView*)viewPtr;
  NSWindow* nsWindow = [nsView window];
  if (!nsWindow) return Napi::Boolean::New(env, false);
  gBubbleWindowNumber = nsWindow.windowNumber;

  [nsWindow setStyleMask:([nsWindow styleMask] | NSWindowStyleMaskNonactivatingPanel)];
  [nsWindow setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
                                 NSWindowCollectionBehaviorFullScreenAuxiliary |
                                 NSWindowCollectionBehaviorStationary];
  [nsWindow setLevel:NSPopUpMenuWindowLevel];

  return Napi::Boolean::New(env, true);
}

Napi::Value OrderBubbleFront(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    return Napi::Boolean::New(env, false);
  }

  auto buf = info[0].As<Napi::Buffer<void*>>();
  if (buf.ByteLength() < sizeof(void*)) {
    return Napi::Boolean::New(env, false);
  }

  void* viewPtr = *reinterpret_cast<void**>(buf.Data());
  if (!viewPtr) return Napi::Boolean::New(env, false);

  NSView* nsView = (__bridge NSView*)viewPtr;
  NSWindow* nsWindow = [nsView window];
  if (!nsWindow) return Napi::Boolean::New(env, false);

  [nsWindow orderFrontRegardless];
  return Napi::Boolean::New(env, true);
}

Napi::Value SetActivationPolicy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int policy = 0;
  if (info.Length() >= 1 && info[0].IsNumber()) {
    policy = info[0].As<Napi::Number>().Int32Value();
  }

  NSApplicationActivationPolicy p =
      policy == 1 ? NSApplicationActivationPolicyAccessory
                  : NSApplicationActivationPolicyRegular;
  [[NSApplication sharedApplication] setActivationPolicy:p];
  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("checkPermission", Napi::Function::New(env, CheckPermission));
  exports.Set("getSelectionSnapshot", Napi::Function::New(env, GetSelectionSnapshot));
  exports.Set("getTextByClipboardAsync", Napi::Function::New(env, GetTextByClipboardAsync));
  exports.Set("copySelectionAsync", Napi::Function::New(env, CopySelectionAsync));
  exports.Set("startActionMonitor", Napi::Function::New(env, StartActionMonitor));
  exports.Set("stopActionMonitor", Napi::Function::New(env, StopActionMonitor));
  exports.Set("getCursorPosition", Napi::Function::New(env, GetCursorPosition));
  exports.Set("getFrontmostAppInfo", Napi::Function::New(env, GetFrontmostAppInfo));
  exports.Set("configureBubbleWindow", Napi::Function::New(env, ConfigureBubbleWindow));
  exports.Set("orderBubbleFront", Napi::Function::New(env, OrderBubbleFront));
  exports.Set("setActivationPolicy", Napi::Function::New(env, SetActivationPolicy));
  env.AddCleanupHook([]() { RemoveMonitors(); });
  return exports;
}

}  // namespace

NODE_API_MODULE(selection_bridge, Init)
