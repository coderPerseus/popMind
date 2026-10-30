// popMind native library for the myGo build: the selection bridge of the Electron app
// (native/selection_bridge.mm) with its N-API layer replaced by a C ABI (pm_* below),
// loaded from Go through purego. Built without ARC, like the original.
#include <stdlib.h>
#include <string.h>

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#if __has_include(<ScreenCaptureKit/ScreenCaptureKit.h>)
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#endif
#import <QuartzCore/QuartzCore.h>
#import <Vision/Vision.h>
#import <objc/message.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <limits>
#include <mutex>
#include <string>
#include <unistd.h>
#include <unordered_set>
#include <vector>

namespace {

enum class SelectionScene {
  kNone = 0,
  kBoxSelect = 1,
  kMultiClickSelect = 2,
  kGestureDismiss = 3,
  kOtherClickDismiss = 4,
  kAppFocusDismiss = 5,
  kKeyDismiss = 6,
  kWindowFrameDismiss = 7
};

const char* SceneToString(SelectionScene s) {
  switch (s) {
    case SelectionScene::kBoxSelect: return "box_select";
    case SelectionScene::kMultiClickSelect: return "multi_click_select";
    case SelectionScene::kGestureDismiss: return "gesture_dismiss";
    case SelectionScene::kOtherClickDismiss: return "other_click_dismiss";
    case SelectionScene::kAppFocusDismiss: return "app_focus_dismiss";
    case SelectionScene::kKeyDismiss: return "key_dismiss";
    case SelectionScene::kWindowFrameDismiss: return "window_frame_dismiss";
    default: return "none";
  }
}

SelectionScene SceneFromString(const std::string& v) {
  if (v == "box_select") return SelectionScene::kBoxSelect;
  if (v == "multi_click_select") return SelectionScene::kMultiClickSelect;
  if (v == "gesture_dismiss") return SelectionScene::kGestureDismiss;
  if (v == "other_click_dismiss") return SelectionScene::kOtherClickDismiss;
  if (v == "app_focus_dismiss") return SelectionScene::kAppFocusDismiss;
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
id gUserInputKeyMonitor = nil;
id gGlobalKeyMonitor = nil;
id gLocalKeyMonitor = nil;
id gActiveSpaceObserver = nil;
id gAppActivatedObserver = nil;
id gAppDeactivatedObserver = nil;
AXObserverRef gFocusedWindowObserver = nullptr;
AXUIElementRef gObservedApp = nullptr;
AXUIElementRef gObservedWindow = nullptr;
CGRect gLastObservedWindowFrame = CGRectZero;
bool gHasLastObservedWindowFrame = false;
typedef void (*PMEventCallback)(int64_t kind, const char* json);
PMEventCallback gEventCallback = nullptr;
bool gActionMonitorActive = false;
std::mutex gMonitorMutex;
std::mutex gClipboardFallbackMutex;
std::atomic<uint64_t> gUserInputGeneration{0};
std::atomic<bool> gClipboardFallbackActive{false};
std::unordered_set<NSInteger> gBubbleWindowNumbers;

bool gIsLeftMouseDown = false;
bool gLeftMouseDownOnBubble = false;
bool gLeftMouseDownNearFocusedWindowEdge = false;
// Window under (or right next to) the pointer at mouseDown. If its frame
// changes before mouseUp, the drag moved/resized a window instead of
// selecting text.
CGWindowID gMouseDownWindowId = 0;
CGRect gMouseDownWindowBounds = CGRectNull;
NSPoint gMouseDownPoint = NSZeroPoint;
NSPoint gLastActionPoint = NSZeroPoint;
CFAbsoluteTime gLastMouseUpAt = 0;
CFAbsoluteTime gLastMouseDownAt = 0;
NSInteger gDragPasteboardChangeCountOnMouseDown = -1;
NSInteger gClipboardChangeCountOnMouseDown = -1;


static constexpr double kScrollGestureDeltaThreshold = 4.0;
static constexpr double kDragThreshold = 3.0;
static constexpr double kWindowResizeHandleMargin = 14.0;
static constexpr int64_t kSimulatedKeyboardEventTag = 0x504F504D494E44;
// Keep in sync with POPMIND_PASTEBOARD_MARKER in lib/clipboard/types.ts.
static NSString* const kPopMindPasteboardMarkerType = @"app.popmind.clipboard.writeback";
static NSString* const kTextPickerRestoreMarker = @"text-picker-restore";

void HandleKeyEvent(NSEvent* event);
bool RaiseWindowAtPoint(pid_t pid, NSPoint point);
void PostCmdCToPid(pid_t pid);
CGPoint CocoaPointToAXPoint(NSPoint point);
std::string GetSelectedTextByClipboardFallback(AXUIElementRef app);

std::string ToStdString(NSString* value) {
  if (value == nil) return "";
  const char* utf8 = [value UTF8String];
  return utf8 ? std::string(utf8) : "";
}

void RunOnMainThreadSync(dispatch_block_t task) {
  if (!task) return;
  if ([NSThread isMainThread]) {
    task();
  } else {
    dispatch_sync(dispatch_get_main_queue(), task);
  }
}

bool IsPointInsideBubbleWindow(NSPoint point) {
  if (gBubbleWindowNumbers.empty()) return false;

  for (NSWindow* window in NSApp.windows) {
    if (gBubbleWindowNumbers.find(window.windowNumber) == gBubbleWindowNumbers.end()) {
      continue;
    }

    if ([window isVisible] && NSPointInRect(point, [window frame])) {
      return true;
    }
  }

  return false;
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

std::string GetAXRoleDebug(AXUIElementRef el) {
  if (!el) return "";

  std::string role;
  std::string subrole;
  GetAXStringAttr(el, kAXRoleAttribute, &role);
  GetAXStringAttr(el, kAXSubroleAttribute, &subrole);

  if (!subrole.empty()) {
    return role + "/" + subrole;
  }

  return role;
}

bool IsWindowRoleDebug(const std::string& roleDebug) {
  return roleDebug == "AXWindow" || roleDebug == "AXWindow/AXStandardWindow";
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

bool GetAXCGPointAttr(AXUIElementRef el, CFStringRef attr, CGPoint* out) {
  if (!el || !out) return false;

  CFTypeRef val = nullptr;
  if (AXUIElementCopyAttributeValue(el, attr, &val) != kAXErrorSuccess || !val) {
    return false;
  }

  bool ok = false;
  if (CFGetTypeID(val) == AXValueGetTypeID()) {
    AXValueRef axValue = (AXValueRef)val;
    if (AXValueGetType(axValue) == kAXValueTypeCGPoint) {
      ok = AXValueGetValue(axValue, kAXValueTypeCGPoint, out);
    }
  }

  CFRelease(val);
  return ok;
}

bool GetAXCGSizeAttr(AXUIElementRef el, CFStringRef attr, CGSize* out) {
  if (!el || !out) return false;

  CFTypeRef val = nullptr;
  if (AXUIElementCopyAttributeValue(el, attr, &val) != kAXErrorSuccess || !val) {
    return false;
  }

  bool ok = false;
  if (CFGetTypeID(val) == AXValueGetTypeID()) {
    AXValueRef axValue = (AXValueRef)val;
    if (AXValueGetType(axValue) == kAXValueTypeCGSize) {
      ok = AXValueGetValue(axValue, kAXValueTypeCGSize, out);
    }
  }

  CFRelease(val);
  return ok;
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

bool GetFocusedWindowFrame(CGRect* outFrame) {
  if (!outFrame) return false;

  AXUIElementRef sys = AXUIElementCreateSystemWide();
  if (!sys) return false;

  bool ok = false;
  CFTypeRef appVal = nullptr;
  if (AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute, &appVal) == kAXErrorSuccess &&
      appVal && CFGetTypeID(appVal) == AXUIElementGetTypeID()) {
    AXUIElementRef app = (AXUIElementRef)appVal;
    CFTypeRef windowVal = nullptr;
    if (AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &windowVal) == kAXErrorSuccess &&
        windowVal && CFGetTypeID(windowVal) == AXUIElementGetTypeID()) {
      AXUIElementRef window = (AXUIElementRef)windowVal;
      CGPoint origin;
      CGSize size;
      if (GetAXCGPointAttr(window, kAXPositionAttribute, &origin) &&
          GetAXCGSizeAttr(window, kAXSizeAttribute, &size)) {
        *outFrame = CGRectMake(origin.x, origin.y, size.width, size.height);
        ok = true;
      }
      CFRelease(windowVal);
    } else if (windowVal) {
      CFRelease(windowVal);
    }
    CFRelease(appVal);
  } else if (appVal) {
    CFRelease(appVal);
  }

  CFRelease(sys);
  return ok;
}

CGImageRef CopyFrontmostWindowImageByPid(pid_t requestedPid);

#if __has_include(<ScreenCaptureKit/ScreenCaptureKit.h>)
SCWindow* CopyBestShareableWindowForPid(NSArray<SCWindow*>* windows, pid_t appPid) API_AVAILABLE(macos(12.3)) {
  if (appPid <= 0 || windows.count == 0) {
    return nil;
  }

  SCWindow* bestWindow = nil;
  double bestScore = -1.0;
  for (SCWindow* window in windows) {
    SCRunningApplication* owningApplication = window.owningApplication;
    if (!owningApplication || owningApplication.processID != appPid || !window.isOnScreen) {
      continue;
    }

    if (window.windowLayer != 0) {
      continue;
    }

    const CGRect frame = window.frame;
    if (CGRectIsEmpty(frame) || frame.size.width < 2.0 || frame.size.height < 2.0) {
      continue;
    }

    double score = frame.size.width * frame.size.height;
    if (@available(macOS 13.1, *)) {
      if (window.isActive) {
        score += 1e12;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestWindow = window;
    }
  }

  return bestWindow ? [bestWindow retain] : nil;
}

CGImageRef CopyWindowImageWithScreenCaptureKit(pid_t requestedPid) {
  if (@available(macOS 14.0, *)) {
    if (requestedPid <= 0) {
      return nullptr;
    }

    if (!CGPreflightScreenCaptureAccess()) {
      NSLog(@"[selection_bridge] sck capture skipped: no screen capture access pid=%d", requestedPid);
      return nullptr;
    }

    __block CGImageRef capturedImage = nullptr;
    __block NSError* captureError = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

    [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                               onScreenWindowsOnly:YES
                                                 completionHandler:^(SCShareableContent* _Nullable shareableContent,
                                                                     NSError* _Nullable error) {
      if (error || !shareableContent) {
        captureError = [error retain];
        dispatch_semaphore_signal(semaphore);
        return;
      }

      SCWindow* targetWindow = CopyBestShareableWindowForPid(shareableContent.windows, requestedPid);
      if (!targetWindow) {
        NSLog(@"[selection_bridge] sck capture no target window pid=%d windows=%lu",
              requestedPid,
              (unsigned long)shareableContent.windows.count);
        dispatch_semaphore_signal(semaphore);
        return;
      }

      NSLog(@"[selection_bridge] sck capture target pid=%d windowID=%u title=%@ frame=(%.1f %.1f %.1f %.1f)",
            requestedPid,
            targetWindow.windowID,
            targetWindow.title ?: @"",
            targetWindow.frame.origin.x,
            targetWindow.frame.origin.y,
            targetWindow.frame.size.width,
            targetWindow.frame.size.height);

      SCContentFilter* filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:targetWindow];
      [targetWindow release];

      SCStreamConfiguration* config = [[SCStreamConfiguration alloc] init];
      config.showsCursor = NO;
      config.scalesToFit = YES;
      if (@available(macOS 14.0, *)) {
        config.ignoreShadowsSingleWindow = YES;
      }

      const CGRect contentRect = filter.contentRect;
      const float pointPixelScale = filter.pointPixelScale > 0.0f ? filter.pointPixelScale : 2.0f;
      config.width = static_cast<size_t>(std::max(1.0, std::ceil(contentRect.size.width * pointPixelScale)));
      config.height = static_cast<size_t>(std::max(1.0, std::ceil(contentRect.size.height * pointPixelScale)));

      [SCScreenshotManager captureImageWithFilter:filter
                                    configuration:config
                                completionHandler:^(CGImageRef _Nullable image, NSError* _Nullable imageError) {
        if (image) {
          capturedImage = CGImageRetain(image);
        } else if (imageError) {
          captureError = [imageError retain];
        }

        [filter release];
        [config release];
        dispatch_semaphore_signal(semaphore);
      }];
    }];

    const int64_t timeoutNs = 3LL * NSEC_PER_SEC;
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, timeoutNs)) != 0) {
      NSLog(@"[selection_bridge] sck capture timed out pid=%d", requestedPid);
      if (captureError) {
        [captureError release];
      }
      return nullptr;
    }

    if (captureError) {
      NSLog(@"[selection_bridge] sck capture failed pid=%d error=%@", requestedPid, captureError.localizedDescription);
      [captureError release];
    }

    return capturedImage;
  }

  return nullptr;
}
#endif

CGImageRef CopyFrontmostWindowImageByPid(pid_t requestedPid) {
  // Silent: without the Screen Recording permission nothing is captured, so the system never asks mid-explain.
  if (!CGPreflightScreenCaptureAccess()) {
    return nullptr;
  }
  pid_t appPid = requestedPid;
  if (appPid <= 0) {
    NSRunningApplication* frontApp = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!frontApp) return nullptr;
    appPid = frontApp.processIdentifier;
  }

#if __has_include(<ScreenCaptureKit/ScreenCaptureKit.h>)
  if (@available(macOS 14.0, *)) {
    CGImageRef screenCaptureKitImage = CopyWindowImageWithScreenCaptureKit(appPid);
    if (screenCaptureKitImage) {
      return screenCaptureKitImage;
    }
  }
#endif

  NSRunningApplication* frontApp = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!frontApp) return nullptr;

  CFArrayRef windowInfoList =
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly |
                                     kCGWindowListExcludeDesktopElements,
                                 kCGNullWindowID);
  if (!windowInfoList) return nullptr;

  CGImageRef image = nullptr;
  CGRect fallbackBounds = CGRectNull;
  NSArray* windows = (__bridge NSArray*)windowInfoList;
  for (id rawWindow in windows) {
    if (![rawWindow isKindOfClass:[NSDictionary class]]) {
      continue;
    }

    NSDictionary* window = (NSDictionary*)rawWindow;
    NSNumber* ownerPid = window[(id)kCGWindowOwnerPID];
    NSNumber* layer = window[(id)kCGWindowLayer];
    NSNumber* windowNumber = window[(id)kCGWindowNumber];
    NSNumber* alpha = window[(id)kCGWindowAlpha];
    NSNumber* sharingState = window[(id)kCGWindowSharingState];
    NSDictionary* boundsDict = window[(id)kCGWindowBounds];

    if (![ownerPid isKindOfClass:[NSNumber class]] ||
        ownerPid.intValue != appPid) {
      continue;
    }

    if ([layer isKindOfClass:[NSNumber class]] && layer.intValue != 0) {
      continue;
    }

    if ([alpha isKindOfClass:[NSNumber class]] && alpha.doubleValue <= 0.0) {
      continue;
    }

    CGRect bounds = CGRectNull;
    if (![boundsDict isKindOfClass:[NSDictionary class]] ||
        !CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)boundsDict,
                                                &bounds) ||
        CGRectIsEmpty(bounds) || bounds.size.width < 2 || bounds.size.height < 2) {
      continue;
    }

    if (![windowNumber isKindOfClass:[NSNumber class]]) {
      continue;
    }

    fallbackBounds = bounds;

    if ([sharingState isKindOfClass:[NSNumber class]] &&
        sharingState.intValue == kCGWindowSharingNone) {
      break;
    }

    image = CGWindowListCreateImage(CGRectNull,
                                    kCGWindowListOptionIncludingWindow,
                                    (CGWindowID)windowNumber.unsignedIntValue,
                                    kCGWindowImageBoundsIgnoreFraming |
                                        kCGWindowImageBestResolution);
    if (image) {
      break;
    }

    break;
  }

  CFRelease(windowInfoList);

  if (!image && !CGRectIsNull(fallbackBounds) && !CGRectIsEmpty(fallbackBounds)) {
    image = CGWindowListCreateImage(fallbackBounds,
                                    kCGWindowListOptionOnScreenOnly,
                                    kCGNullWindowID,
                                    kCGWindowImageBestResolution);
  }

  return image;
}

bool IsPointNearFocusedWindowEdge(NSPoint point) {
  static constexpr double kResizeEdgeThreshold = 14.0;

  CGRect frame;
  if (!GetFocusedWindowFrame(&frame) || CGRectIsEmpty(frame)) {
    return false;
  }

  const CGRect edgeArea = CGRectInset(frame, -kResizeEdgeThreshold, -kResizeEdgeThreshold);
  const auto isNearEdge = [&](CGPoint candidate) {
    if (!CGRectContainsPoint(edgeArea, candidate)) return false;

    const double minXDist = std::min(std::abs(candidate.x - CGRectGetMinX(frame)),
                                     std::abs(candidate.x - CGRectGetMaxX(frame)));
    const double minYDist = std::min(std::abs(candidate.y - CGRectGetMinY(frame)),
                                     std::abs(candidate.y - CGRectGetMaxY(frame)));
    return minXDist <= kResizeEdgeThreshold || minYDist <= kResizeEdgeThreshold;
  };

  // Accessibility window frames use top-left screen coordinates, while NSEvent
  // mouse locations use Cocoa's bottom-left coordinates. Accept both because
  // multi-display arrangements can expose either representation through AX.
  return isNearEdge(CGPointMake(point.x, point.y)) || isNearEdge(CocoaPointToAXPoint(point));
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

bool FillRect(AXUIElementRef el, CGRect* outRect) {
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
        *outRect = rect;
        ok = true;
      }
    }
  }

  CFRelease(bv);
  return ok;
}

bool GetSelectionBounds(AXUIElementRef el, CGRect* outRect) {
  if (!el || !outRect) return false;

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
        *outRect = rect;
        ok = true;
      }
    }
  }

  CFRelease(bv);
  return ok;
}

bool SelectionRectNearCursor(CGRect rect, NSPoint cocoaPoint) {
  if (CGRectIsEmpty(rect) || rect.size.width < 0.5 || rect.size.height < 0.5) {
    return false;
  }

  const CGPoint axPoint = CocoaPointToAXPoint(cocoaPoint);
  const CGRect inflated = CGRectInset(rect, -140.0, -140.0);
  if (CGRectContainsPoint(inflated, axPoint) ||
      CGRectContainsPoint(inflated, CGPointMake(cocoaPoint.x, cocoaPoint.y))) {
    return true;
  }

  const CGPoint center = CGPointMake(rect.origin.x + rect.size.width / 2.0,
                                     rect.origin.y + rect.size.height / 2.0);
  const double axDist = std::hypot(center.x - axPoint.x, center.y - axPoint.y);
  const double cocoaDist = std::hypot(center.x - cocoaPoint.x, center.y - cocoaPoint.y);
  return axDist < 520.0 || cocoaDist < 520.0;
}

struct RecognizedTextFragment {
  std::string text;
  double top = 0.0;
  double bottom = 0.0;
  double left = 0.0;
  double right = 0.0;
  double width = 0.0;
  double height = 0.0;
  double centerY = 0.0;
};

struct OCRMergedLine {
  std::vector<RecognizedTextFragment> fragments;
  double top = 0.0;
  double bottom = 0.0;
  double left = 0.0;
  double right = 0.0;
  double avgHeight = 0.0;
};

std::string TrimAsciiWhitespace(const std::string& input) {
  size_t start = 0;
  while (start < input.size() && std::isspace(static_cast<unsigned char>(input[start]))) {
    start++;
  }

  size_t end = input.size();
  while (end > start && std::isspace(static_cast<unsigned char>(input[end - 1]))) {
    end--;
  }

  return input.substr(start, end - start);
}

bool IsSentenceBreakChar(char c) {
  switch (c) {
    case '.':
    case '!':
    case '?':
    case ':':
    case ';':
      return true;
    default:
      return false;
  }
}

bool ContainsCJKCharacter(const std::string& text) {
  NSString* nsText = [NSString stringWithUTF8String:text.c_str()];
  if (!nsText) return false;

  for (NSUInteger i = 0; i < nsText.length; i++) {
    unichar ch = [nsText characterAtIndex:i];
    if ((ch >= 0x4E00 && ch <= 0x9FFF) || (ch >= 0x3400 && ch <= 0x4DBF) ||
        (ch >= 0x3040 && ch <= 0x30FF) || (ch >= 0xAC00 && ch <= 0xD7AF) ||
        (ch >= 0xF900 && ch <= 0xFAFF)) {
      return true;
    }
  }

  return false;
}

bool StartsWithLatinLower(const std::string& text) {
  for (char c : text) {
    if (std::isspace(static_cast<unsigned char>(c))) {
      continue;
    }
    return std::islower(static_cast<unsigned char>(c)) != 0;
  }
  return false;
}

double VerticalOverlapRatio(const RecognizedTextFragment& a, const RecognizedTextFragment& b) {
  const double overlap = std::max(0.0, std::min(a.bottom, b.bottom) - std::max(a.top, b.top));
  const double minHeight = std::max(0.0001, std::min(a.height, b.height));
  return overlap / minHeight;
}

bool ShouldBelongToSameLine(const OCRMergedLine& line, const RecognizedTextFragment& fragment) {
  const double lineCenterY = (line.top + line.bottom) / 2.0;
  const double centerDiff = std::abs(lineCenterY - fragment.centerY);
  const double heightRef = std::max(line.avgHeight, fragment.height);

  if (centerDiff <= heightRef * 0.6) {
    return true;
  }

  for (const auto& existing : line.fragments) {
    if (VerticalOverlapRatio(existing, fragment) >= 0.35) {
      return true;
    }
  }

  return false;
}

void UpdateMergedLineMetrics(OCRMergedLine* line) {
  if (!line || line->fragments.empty()) return;

  double top = line->fragments.front().top;
  double bottom = line->fragments.front().bottom;
  double left = line->fragments.front().left;
  double right = line->fragments.front().right;
  double totalHeight = 0.0;

  for (const auto& fragment : line->fragments) {
    top = std::min(top, fragment.top);
    bottom = std::max(bottom, fragment.bottom);
    left = std::min(left, fragment.left);
    right = std::max(right, fragment.right);
    totalHeight += fragment.height;
  }

  line->top = top;
  line->bottom = bottom;
  line->left = left;
  line->right = right;
  line->avgHeight = totalHeight / static_cast<double>(line->fragments.size());
}

bool ShouldJoinWithoutSpace(const std::string& lhs, const std::string& rhs, double gap,
                            double avgHeight) {
  if (lhs.empty() || rhs.empty()) return true;

  const bool lhsHasCJK = ContainsCJKCharacter(lhs);
  const bool rhsHasCJK = ContainsCJKCharacter(rhs);
  if (lhsHasCJK || rhsHasCJK) {
    return true;
  }

  const char last = lhs.back();
  const char first = rhs.front();

  if (std::ispunct(static_cast<unsigned char>(first)) || std::ispunct(static_cast<unsigned char>(last))) {
    return true;
  }

  return gap <= std::max(0.008, avgHeight * 0.14);
}

// The last and the first UTF-8 character of a string.
std::string LastCodepoint(const std::string& s) {
  size_t i = s.size();
  while (i > 0 && (static_cast<unsigned char>(s[i - 1]) & 0xC0) == 0x80) i--;
  return i > 0 ? s.substr(i - 1) : s;
}

std::string FirstCodepoint(const std::string& s) {
  if (s.empty()) return s;
  size_t n = 1;
  while (n < s.size() && (static_cast<unsigned char>(s[n]) & 0xC0) == 0x80) n++;
  return s.substr(0, n);
}

// Two lines of one paragraph join with a space between Latin words, and without one where either side
// of the break is CJK (Chinese and Japanese run on across lines).
bool ShouldJoinLinesWithoutSpace(const std::string& lhs, const std::string& rhs) {
  if (lhs.empty() || rhs.empty()) return true;
  return ContainsCJKCharacter(LastCodepoint(lhs)) || ContainsCJKCharacter(FirstCodepoint(rhs));
}

std::string JoinLineFragments(const OCRMergedLine& line) {
  if (line.fragments.empty()) return "";

  std::vector<RecognizedTextFragment> fragments = line.fragments;
  std::sort(fragments.begin(), fragments.end(), [](const RecognizedTextFragment& a,
                                                   const RecognizedTextFragment& b) {
    if (std::abs(a.left - b.left) > 0.002) {
      return a.left < b.left;
    }
    return a.top < b.top;
  });

  std::string merged = TrimAsciiWhitespace(fragments.front().text);
  for (size_t i = 1; i < fragments.size(); i++) {
    const auto& previous = fragments[i - 1];
    const auto& current = fragments[i];
    std::string currentText = TrimAsciiWhitespace(current.text);
    if (currentText.empty()) continue;

    const double gap = std::max(0.0, current.left - previous.right);
    if (!merged.empty() && merged.back() == '-' && StartsWithLatinLower(currentText)) {
      merged.pop_back();
      merged += currentText;
      continue;
    }

    if (ShouldJoinWithoutSpace(merged, currentText, gap, line.avgHeight)) {
      merged += currentText;
    } else {
      merged += " ";
      merged += currentText;
    }
  }

  return merged;
}

std::string NormalizeMergedOCRText(const std::string& text) {
  NSString* nsText = [NSString stringWithUTF8String:text.c_str()];
  if (!nsText) return text;

  NSError* error = nil;
  NSRegularExpression* collapseSpaces =
      [NSRegularExpression regularExpressionWithPattern:@"[ \\t]+" options:0 error:&error];
  NSString* normalized = error ? nsText : [collapseSpaces stringByReplacingMatchesInString:nsText
                                                                                     options:0
                                                                                       range:NSMakeRange(0, nsText.length)
                                                                                withTemplate:@" "];

  error = nil;
  NSRegularExpression* trimLineSpaces =
      [NSRegularExpression regularExpressionWithPattern:@" *\\n *" options:0 error:&error];
  normalized = error ? normalized : [trimLineSpaces stringByReplacingMatchesInString:normalized
                                                                              options:0
                                                                                range:NSMakeRange(0, normalized.length)
                                                                         withTemplate:@"\n"];

  error = nil;
  NSRegularExpression* collapseBlankLines =
      [NSRegularExpression regularExpressionWithPattern:@"\\n{3,}" options:0 error:&error];
  normalized = error ? normalized : [collapseBlankLines stringByReplacingMatchesInString:normalized
                                                                                  options:0
                                                                                    range:NSMakeRange(0, normalized.length)
                                                                             withTemplate:@"\n\n"];

  return TrimAsciiWhitespace(ToStdString(normalized));
}

// `languages == nullptr` keeps the legacy language list; `fast` selects the fast recognition level;
// `autoLanguage` lets Vision detect the language of each text (macOS 13+): more accurate on English than a
// list that starts with Chinese, which also turns English commas into Chinese ones.
bool RecognizeTextFromImagePath(const std::string& imagePath, std::string* outText,
                                std::string* outError,
                                const std::vector<std::string>* languages = nullptr,
                                bool fast = false, bool autoLanguage = false) {
  if (!outText || !outError) return false;

  *outText = "";
  *outError = "";

  @autoreleasepool {
    NSString* nsImagePath = [NSString stringWithUTF8String:imagePath.c_str()];
    if (!nsImagePath || ![[NSFileManager defaultManager] fileExistsAtPath:nsImagePath]) {
      *outError = "image_not_found";
      return false;
    }

    __block std::vector<RecognizedTextFragment> fragments;
    __block NSString* requestErrorMessage = nil;

    VNRecognizeTextRequest* request =
        [[[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(
            VNRequest* _Nonnull req, NSError* _Nullable error) {
          if (error) {
            requestErrorMessage = error.localizedDescription ?: @"ocr_request_failed";
            return;
          }

          NSArray<VNRecognizedTextObservation*>* observations =
              req.results ? (NSArray<VNRecognizedTextObservation*>*)req.results : @[];
          for (VNRecognizedTextObservation* observation in observations) {
            VNRecognizedText* candidate = [[observation topCandidates:1] firstObject];
            NSString* recognized = candidate.string;
            if (!recognized || recognized.length == 0) {
              continue;
            }

            CGRect box = observation.boundingBox;
            RecognizedTextFragment fragment;
            fragment.text = ToStdString(recognized);
            fragment.top = 1.0 - (box.origin.y + box.size.height);
            fragment.bottom = 1.0 - box.origin.y;
            fragment.left = box.origin.x;
            fragment.right = box.origin.x + box.size.width;
            fragment.width = box.size.width;
            fragment.height = box.size.height;
            fragment.centerY = (fragment.top + fragment.bottom) / 2.0;
            fragments.push_back(std::move(fragment));
          }
        }] autorelease];

    request.recognitionLevel =
        fast ? VNRequestTextRecognitionLevelFast : VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = fast ? NO : YES;
    if (autoLanguage) {
      if (@available(macOS 13.0, *)) request.automaticallyDetectsLanguage = YES;
    }
    if (languages && !languages->empty()) {
      NSMutableArray<NSString*>* languageList = [NSMutableArray arrayWithCapacity:languages->size()];
      for (const auto& language : *languages) {
        NSString* value = [NSString stringWithUTF8String:language.c_str()];
        if (value.length > 0) [languageList addObject:value];
      }
      request.recognitionLanguages = languageList;
    } else {
      request.recognitionLanguages = @[ @"zh-Hans", @"zh-Hant", @"en-US", @"ja-JP", @"ko-KR" ];
    }

    NSError* handlerError = nil;
    NSData* imageData = [NSData dataWithContentsOfFile:nsImagePath options:0 error:&handlerError];
    if (!imageData || handlerError) {
      *outError = ToStdString(handlerError.localizedDescription ?: @"ocr_image_read_failed");
      return false;
    }

    VNImageRequestHandler* handler =
        [[[VNImageRequestHandler alloc] initWithData:imageData options:@{}] autorelease];
    if (handlerError) {
      *outError = ToStdString(handlerError.localizedDescription ?: @"ocr_handler_init_failed");
      return false;
    }

    BOOL ok = [handler performRequests:@[ request ] error:&handlerError];
    if (!ok || handlerError) {
      *outError = ToStdString(handlerError.localizedDescription ?: @"ocr_perform_failed");
      return false;
    }

    if (requestErrorMessage) {
      *outError = ToStdString(requestErrorMessage);
      return false;
    }

    std::sort(fragments.begin(), fragments.end(), [](const RecognizedTextFragment& a,
                                                     const RecognizedTextFragment& b) {
      const double rowDiff = std::abs(a.top - b.top);
      if (rowDiff > 0.018) {
        return a.top < b.top;
      }
      return a.left < b.left;
    });

    std::vector<OCRMergedLine> mergedLines;
    for (const auto& fragment : fragments) {
      if (TrimAsciiWhitespace(fragment.text).empty()) continue;

      bool appended = false;
      for (auto& line : mergedLines) {
        if (ShouldBelongToSameLine(line, fragment)) {
          line.fragments.push_back(fragment);
          UpdateMergedLineMetrics(&line);
          appended = true;
          break;
        }
      }

      if (!appended) {
        OCRMergedLine newLine;
        newLine.fragments.push_back(fragment);
        UpdateMergedLineMetrics(&newLine);
        mergedLines.push_back(std::move(newLine));
      }
    }

    std::sort(mergedLines.begin(), mergedLines.end(), [](const OCRMergedLine& a,
                                                         const OCRMergedLine& b) {
      const double rowDiff = std::abs(a.top - b.top);
      if (rowDiff > 0.018) {
        return a.top < b.top;
      }
      return a.left < b.left;
    });

    std::string joined;
    double previousBottom = 0.0;
    double previousHeight = 0.0;
    double previousLeft = 0.0;
    std::string previousLineText;
    bool hasPreviousLine = false;

    for (const auto& line : mergedLines) {
        const std::string mergedLineText = JoinLineFragments(line);
        if (mergedLineText.empty()) continue;

      if (!hasPreviousLine) {
        joined = mergedLineText;
      } else {
        const double verticalGap = std::max(0.0, line.top - previousBottom);
        const double heightRef = std::max(previousHeight, line.avgHeight);
        const bool forceParagraphBreak = verticalGap > heightRef * 0.9;
        const bool shouldKeepLineBreak =
            forceParagraphBreak || std::abs(line.left - previousLeft) > heightRef * 1.2 ||
            (!previousLineText.empty() &&
             IsSentenceBreakChar(previousLineText.back()));

        if (!previousLineText.empty() && previousLineText.back() == '-' &&
            StartsWithLatinLower(mergedLineText)) {
          joined.pop_back();
          joined += mergedLineText;
        } else if (shouldKeepLineBreak) {
          joined += forceParagraphBreak ? "\n\n" : "\n";
          joined += mergedLineText;
        } else if (ShouldJoinLinesWithoutSpace(previousLineText, mergedLineText)) {
          joined += mergedLineText;
        } else {
          joined += " ";
          joined += mergedLineText;
        }
      }

      hasPreviousLine = true;
      previousBottom = line.bottom;
      previousHeight = line.avgHeight;
      previousLeft = line.left;
      previousLineText = mergedLineText;
    }

    *outText = NormalizeMergedOCRText(joined);
    return true;
  }
}

NSArray* SavePasteboardItems() {
  NSPasteboard* pb = [NSPasteboard generalPasteboard];
  NSArray<NSPasteboardItem*>* pasteboardItems = [pb pasteboardItems];
  if (!pasteboardItems.count) return @[];

  NSMutableArray* snapshot = [NSMutableArray arrayWithCapacity:pasteboardItems.count];
  for (NSPasteboardItem* item in pasteboardItems) {
    if (!item) continue;

    NSMutableDictionary* itemSnapshot = [NSMutableDictionary dictionary];
    for (NSPasteboardType type in item.types) {
      if (!type) continue;

      NSData* data = [item dataForType:type];
      if (data) {
        itemSnapshot[type] = [data copy];
      }
    }

    [snapshot addObject:[itemSnapshot copy]];
  }

  return [snapshot copy];
}

// `marker` (optional) is written as kPopMindPasteboardMarkerType on the first restored item so the
// clipboard history recognises the restore as popMind's own write.
void RestorePasteboardItems(NSArray* snapshot, NSString* marker = nil) {
  NSPasteboard* pb = [NSPasteboard generalPasteboard];
  [pb clearContents];

  if (![snapshot isKindOfClass:[NSArray class]] || [snapshot count] == 0) {
    return;
  }

  NSMutableArray<NSPasteboardItem*>* restoredItems =
      [NSMutableArray arrayWithCapacity:[snapshot count]];
  for (id rawItemSnapshot in snapshot) {
    if (![rawItemSnapshot isKindOfClass:[NSDictionary class]]) {
      continue;
    }

    NSDictionary* itemSnapshot = (NSDictionary*)rawItemSnapshot;
    NSPasteboardItem* restoredItem = [[[NSPasteboardItem alloc] init] autorelease];
    bool hasData = false;

    for (id rawType in itemSnapshot) {
      if (![rawType isKindOfClass:[NSString class]]) {
        continue;
      }

      id rawData = itemSnapshot[rawType];
      if (![rawData isKindOfClass:[NSData class]]) {
        continue;
      }

      if ([restoredItem setData:(NSData*)rawData forType:(NSPasteboardType)rawType]) {
        hasData = true;
      }
    }

    if (hasData) {
      if (marker.length > 0 && restoredItems.count == 0) {
        [restoredItem setString:marker forType:kPopMindPasteboardMarkerType];
      }
      [restoredItems addObject:restoredItem];
    }
  }

  if (restoredItems.count > 0) {
    [pb writeObjects:restoredItems];
  }
}

void PostKeyboardEvent(CGEventSourceRef source, CGKeyCode keyCode, bool isKeyDown,
                       CGEventFlags flags, pid_t pid = -1) {
  CGEventRef event = CGEventCreateKeyboardEvent(source, keyCode, isKeyDown);
  if (!event) return;

  CGEventSetFlags(event, flags);
  CGEventSetIntegerValueField(event, kCGEventSourceUserData, kSimulatedKeyboardEventTag);
  if (pid > 0) {
    CGEventPostToPid(pid, event);
  } else {
    CGEventPost(kCGHIDEventTap, event);
  }
  CFRelease(event);
}

void PostCmdCToPid(pid_t pid) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  if (!source) return;

  const CGEventFlags commandFlags = kCGEventFlagMaskCommand;
  PostKeyboardEvent(source, kVK_Command, true, commandFlags, pid);
  PostKeyboardEvent(source, kVK_ANSI_C, true, commandFlags, pid);
  PostKeyboardEvent(source, kVK_ANSI_C, false, commandFlags, pid);
  PostKeyboardEvent(source, kVK_Command, false, 0, pid);

  CFRelease(source);
}

void PostCmdV() {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  if (!source) return;

  const CGEventFlags commandFlags = kCGEventFlagMaskCommand;
  PostKeyboardEvent(source, kVK_Command, true, commandFlags);
  PostKeyboardEvent(source, kVK_ANSI_V, true, commandFlags);
  PostKeyboardEvent(source, kVK_ANSI_V, false, commandFlags);
  PostKeyboardEvent(source, kVK_Command, false, 0);

  CFRelease(source);
}

bool IsCopyMenuItem(AXUIElementRef item) {
  if (!item) return false;

  std::string role;
  if (!GetAXStringAttr(item, kAXRoleAttribute, &role) ||
      role != ToStdString((__bridge NSString*)kAXMenuItemRole)) {
    return false;
  }

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

enum class MenuCopyResult {
  kTriggered,
  // The app has a Copy menu item but it is disabled: nothing is selected, so
  // neither the menu action nor a simulated Cmd+C would copy anything.
  kDisabled,
  // No usable Copy menu item (no menu bar, custom menus, press failed).
  kUnavailable,
};

const char* MenuCopyResultToString(MenuCopyResult r) {
  switch (r) {
    case MenuCopyResult::kTriggered: return "triggered";
    case MenuCopyResult::kDisabled: return "disabled";
    default: return "unavailable";
  }
}

MenuCopyResult TriggerMenuCopyWithResult(AXUIElementRef app) {
  if (!app) return MenuCopyResult::kUnavailable;

  CFTypeRef mb = nullptr;
  if (AXUIElementCopyAttributeValue(app, kAXMenuBarAttribute, &mb) != kAXErrorSuccess || !mb) {
    return MenuCopyResult::kUnavailable;
  }

  MenuCopyResult result = MenuCopyResult::kUnavailable;
  if (CFGetTypeID(mb) == AXUIElementGetTypeID()) {
    AXUIElementRef item = nullptr;
    if (FindCopyDFS((AXUIElementRef)mb, 0, &item) && item) {
      if (!GetAXBoolAttr(item, kAXEnabledAttribute, true)) {
        result = MenuCopyResult::kDisabled;
      } else if (AXUIElementPerformAction(item, kAXPressAction) == kAXErrorSuccess) {
        result = MenuCopyResult::kTriggered;
      }
      CFRelease(item);
    }
  }

  CFRelease(mb);
  return result;
}

bool TriggerMenuCopy(AXUIElementRef app) {
  return TriggerMenuCopyWithResult(app) == MenuCopyResult::kTriggered;
}

// Seconds since the last real (HID) key press. Unlike the NSEvent monitor this
// is updated by the window server immediately, so it cannot lag behind a Cmd+C
// the user presses while the clipboard fallback is running. Events we post
// with CGEventPostToPid do not go through the HID system and are not counted.
double SecondsSinceLastHardwareKeyDown() {
  return CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateHIDSystemState, kCGEventKeyDown);
}

std::string GetSelectedTextByClipboardFallback(AXUIElementRef app) {
  std::lock_guard<std::mutex> lock(gClipboardFallbackMutex);
  struct ActivityGuard {
    ActivityGuard() { gClipboardFallbackActive.store(true, std::memory_order_release); }
    ~ActivityGuard() { gClipboardFallbackActive.store(false, std::memory_order_release); }
  } activityGuard;

  @autoreleasepool {
    __block NSInteger changeCountBefore = -1;
    __block NSArray* savedItems = nil;
    __block pid_t pid = -1;
    __block uint64_t inputGenerationBeforeCopy = 0;
    __block bool ready = false;
    __block double fallbackStartedAt = 0;
    // True once the user pressed any key after the fallback started, e.g. a
    // quick Cmd+C followed by switching Spaces. From then on the clipboard
    // belongs to the user: never simulate a copy or restore the old content.
    std::string copiedOnSelect;
    std::string* copiedOnSelectOut = &copiedOnSelect;
    bool (^userTypedSinceStart)(void) = ^bool {
      if (gUserInputGeneration.load(std::memory_order_relaxed) != inputGenerationBeforeCopy) return true;
      return SecondsSinceLastHardwareKeyDown() < CFAbsoluteTimeGetCurrent() - fallbackStartedAt;
    };

    RunOnMainThreadSync(^{
      NSPasteboard* pb = [NSPasteboard generalPasteboard];
      if (!pb) return;
      if (!gUserInputKeyMonitor) {
        NSLog(@"[selection_bridge] clipboard fallback blocked: user input monitor unavailable");
        return;
      }

      changeCountBefore = [pb changeCount];
      if (gClipboardChangeCountOnMouseDown >= 0 &&
          changeCountBefore != gClipboardChangeCountOnMouseDown) {
        // The clipboard changed during the selection gesture without any key
        // press: the app copies on select by itself (iTerm2, some terminals
        // and X11 apps). Its clipboard already holds the selection, so use it
        // as-is instead of simulating another copy.
        const double lastKeyDownAgo = SecondsSinceLastHardwareKeyDown();
        const double mouseDownAgo = CFAbsoluteTimeGetCurrent() - gLastMouseDownAt;
        if (gLastMouseDownAt > 0 && lastKeyDownAgo > mouseDownAgo) {
          *copiedOnSelectOut = ToStdString([pb stringForType:NSPasteboardTypeString]);
          NSLog(@"[selection_bridge] app copied on select, reuse clipboard len=%lu pre=%ld now=%ld",
                (unsigned long)copiedOnSelectOut->size(), (long)gClipboardChangeCountOnMouseDown,
                (long)changeCountBefore);
          return;
        }
        NSLog(@"[selection_bridge] clipboard text changed, skip simulated key pre=%ld now=%ld",
              (long)gClipboardChangeCountOnMouseDown, (long)changeCountBefore);
        return;
      }

      if (app) {
        AXUIElementGetPid(app, &pid);
      }

      // The selection was made in the frontmost app. If it is no longer
      // frontmost the user already moved on (another app or Space); copying
      // from it now would need to re-activate it and yank the user back.
      NSRunningApplication* frontApp = NSWorkspace.sharedWorkspace.frontmostApplication;
      if (pid <= 0 || !frontApp || frontApp.processIdentifier != pid) {
        NSLog(@"[selection_bridge] clipboard fallback blocked: pid=%d is no longer frontmost (front=%d)", pid,
              frontApp ? frontApp.processIdentifier : -1);
        return;
      }

      const double lastKeyDownAgo = SecondsSinceLastHardwareKeyDown();
      const double mouseUpAgo = CFAbsoluteTimeGetCurrent() - gLastMouseUpAt;
      if (gLastMouseUpAt > 0 && lastKeyDownAgo < mouseUpAgo) {
        NSLog(@"[selection_bridge] clipboard fallback blocked: key pressed after selection (%.3fs ago)",
              lastKeyDownAgo);
        return;
      }

      // Keep the clipboard only in memory and restore it after reading the
      // user-triggered selection. Sensitive pasteboards are filtered from
      // clipboard history by the main process.
      savedItems = SavePasteboardItems();
      inputGenerationBeforeCopy = gUserInputGeneration.load(std::memory_order_relaxed);
      fallbackStartedAt = CFAbsoluteTimeGetCurrent();
      ready = true;
    });

    if (!ready) return copiedOnSelect;

    const NSInteger expectedChangeCount = changeCountBefore;

    NSLog(@"[selection_bridge] Copy pasteboard item start pid=%d", pid);

    NSInteger changeCountAfterCopy = changeCountBefore;
    __block MenuCopyResult menuCopyResult = MenuCopyResult::kUnavailable;
    __block bool userTypedBeforeCopy = false;
    RunOnMainThreadSync(^{
      if (userTypedSinceStart()) {
        userTypedBeforeCopy = true;
        return;
      }
      menuCopyResult = app ? TriggerMenuCopyWithResult(app) : MenuCopyResult::kUnavailable;
    });
    const bool menuCopyTriggered = menuCopyResult == MenuCopyResult::kTriggered;
    NSLog(@"[selection_bridge] menu copy result=%s userTyped=%d", MenuCopyResultToString(menuCopyResult),
          userTypedBeforeCopy);

    if (userTypedBeforeCopy || menuCopyResult == MenuCopyResult::kDisabled) {
      // Disabled Copy menu: the app itself reports there is no selection.
      // Skip the simulated Cmd+C entirely (same approach as Easydict).
      return "";
    }

    auto waitForPasteboardChange = [&](int tries, NSInteger* after) {
      for (int i = 0; i < tries; i++) {
        if (userTypedSinceStart()) {
          return false;
        }
        [NSThread sleepForTimeInterval:0.02];
        if (userTypedSinceStart()) {
          return false;
        }
        __block NSInteger now = expectedChangeCount;
        RunOnMainThreadSync(^{
          NSPasteboard* pb = [NSPasteboard generalPasteboard];
          if (pb) now = [pb changeCount];
        });
        if (now != expectedChangeCount) {
          if (after) *after = now;
          return true;
        }
      }
      return false;
    };

    // A pressed Copy menu item copies on its own; give slow apps time instead
    // of stacking a second, simulated Cmd+C on top of it.
    bool copied =
        menuCopyTriggered && waitForPasteboardChange(16, &changeCountAfterCopy);

    if (!copied && !menuCopyTriggered && !userTypedSinceStart()) {
      RunOnMainThreadSync(^{
        if (!userTypedSinceStart()) {
          NSLog(@"[selection_bridge] no usable Copy menu item, simulate Cmd+C pid=%d", pid);
          PostCmdCToPid(pid);
        }
      });
      copied = waitForPasteboardChange(10, &changeCountAfterCopy);
    }

    std::string text;
    std::string* textOut = &text;
    RunOnMainThreadSync(^{
      NSPasteboard* pb = [NSPasteboard generalPasteboard];
      if (!pb) return;

      if (userTypedSinceStart()) {
        NSLog(@"[selection_bridge] user input changed during clipboard fallback, skip result");
        return;
      }

      if (!copied) {
        NSLog(@"[selection_bridge] timeout, but pasteboard not change, skip. (%ld)",
              (long)expectedChangeCount);
      }

      const NSInteger now = [pb changeCount];
      if (copied && now == changeCountAfterCopy) {
        *textOut = ToStdString([pb stringForType:NSPasteboardTypeString]);
        RestorePasteboardItems(savedItems, kTextPickerRestoreMarker);
      } else if (copied && now != changeCountAfterCopy) {
        NSLog(@"[selection_bridge] pasteboard change count not equal, pre: %ld now=%ld skip restore",
              (long)changeCountAfterCopy, (long)now);
      }
    });

    NSLog(@"[selection_bridge] Copy pasteboard item complete. len=%lu copied=%d",
          (unsigned long)text.size(), copied);
    return text;
  }
}

std::string GetTextByClipboard(bool useMenu, AXUIElementRef app) {
  (void)useMenu;
  return GetSelectedTextByClipboardFallback(app);
}

bool CopySelection(bool useMenu, AXUIElementRef app, NSString* expectedText) {
  @autoreleasepool {
    NSPasteboard* pb = [NSPasteboard generalPasteboard];
    NSInteger changeCountBefore = [pb changeCount];
    pid_t pid = -1;
    if (app) {
      AXUIElementGetPid(app, &pid);
    }

    NSPoint point = NSEqualPoints(gLastActionPoint, NSZeroPoint) ? [NSEvent mouseLocation]
                                                                 : gLastActionPoint;
    RaiseWindowAtPoint(pid, point);
    [NSThread sleepForTimeInterval:0.06];

    if (useMenu) {
      if (!TriggerMenuCopy(app)) {
        PostCmdCToPid(pid);
      }
    } else {
      PostCmdCToPid(pid);
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

bool ElementHasSelection(AXUIElementRef el) {
  if (!el) return false;
  if (HasNonEmptyRange(el)) return true;

  std::string text;
  if (GetAXSelectedText(el, &text) && !text.empty()) return true;
  if (GetTextByRange(el, &text) && !text.empty()) return true;
  return false;
}

CGPoint CocoaPointToAXPoint(NSPoint point) {
  NSArray<NSScreen*>* screens = [NSScreen screens];
  if (screens.count == 0) {
    return CGPointMake(point.x, point.y);
  }

  return CGPointMake(point.x, NSMaxY(screens[0].frame) - point.y);
}

bool AXFrameContainsCocoaPoint(CGRect axFrame, NSPoint cocoaPoint) {
  if (CGRectIsEmpty(axFrame)) return false;
  if (CGRectContainsPoint(axFrame, CGPointMake(cocoaPoint.x, cocoaPoint.y))) return true;
  return CGRectContainsPoint(axFrame, CocoaPointToAXPoint(cocoaPoint));
}

bool CopyAXFocusedElement(AXUIElementRef container, AXUIElementRef* outElem) {
  if (!container || !outElem) return false;

  CFTypeRef val = nullptr;
  if (AXUIElementCopyAttributeValue(container, kAXFocusedUIElementAttribute, &val) !=
          kAXErrorSuccess ||
      !val) {
    return false;
  }

  if (CFGetTypeID(val) == AXUIElementGetTypeID()) {
    *outElem = (AXUIElementRef)val;
    return true;
  }

  CFRelease(val);
  return false;
}

bool CopySelectionElementWalkingUp(AXUIElementRef start, AXUIElementRef* outElem) {
  if (!start || !outElem) return false;

  AXUIElementRef current = start;
  CFRetain(current);

  for (int depth = 0; depth < 12 && current; depth++) {
    if (ElementHasSelection(current)) {
      *outElem = current;
      return true;
    }

    CFTypeRef parentVal = nullptr;
    if (AXUIElementCopyAttributeValue(current, kAXParentAttribute, &parentVal) != kAXErrorSuccess ||
        !parentVal) {
      break;
    }

    CFRelease(current);
    if (CFGetTypeID(parentVal) != AXUIElementGetTypeID()) {
      CFRelease(parentVal);
      current = nullptr;
      break;
    }

    current = (AXUIElementRef)parentVal;
  }

  if (current) CFRelease(current);
  return false;
}

int WakeAXWindows(AXUIElementRef app) {
  if (!app) return 0;

  CFTypeRef windowsVal = nullptr;
  if (AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, &windowsVal) != kAXErrorSuccess ||
      !windowsVal) {
    return 0;
  }

  int count = 0;
  if (CFGetTypeID(windowsVal) == CFArrayGetTypeID()) {
    CFArrayRef windows = (CFArrayRef)windowsVal;
    count = static_cast<int>(CFArrayGetCount(windows));
    for (CFIndex i = 0; i < CFArrayGetCount(windows); i++) {
      CFTypeRef item = CFArrayGetValueAtIndex(windows, i);
      if (!item || CFGetTypeID(item) != AXUIElementGetTypeID()) continue;

      AXUIElementRef window = (AXUIElementRef)item;
      std::string role;
      std::string title;
      GetAXStringAttr(window, kAXRoleAttribute, &role);
      GetAXStringAttr(window, kAXTitleAttribute, &title);
      (void)role;
      (void)title;

      CFTypeRef children = nullptr;
      if (AXUIElementCopyAttributeValue(window, kAXChildrenAttribute, &children) ==
              kAXErrorSuccess &&
          children) {
        CFRelease(children);
      }

      CFTypeRef focused = nullptr;
      if (AXUIElementCopyAttributeValue(window, kAXFocusedUIElementAttribute, &focused) ==
              kAXErrorSuccess &&
          focused) {
        CFRelease(focused);
      }
    }
  }

  CFRelease(windowsVal);
  return count;
}

bool CopyWindowFrame(AXUIElementRef window, CGRect* outFrame) {
  if (!window || !outFrame) return false;

  CGPoint origin;
  CGSize size;
  if (!GetAXCGPointAttr(window, kAXPositionAttribute, &origin) ||
      !GetAXCGSizeAttr(window, kAXSizeAttribute, &size)) {
    return false;
  }

  *outFrame = CGRectMake(origin.x, origin.y, size.width, size.height);
  return !CGRectIsEmpty(*outFrame);
}

struct ScreenWindowHit {
  pid_t pid = -1;
  CGWindowID windowId = 0;
  CGRect bounds = CGRectNull;
  std::string owner;
};

bool CopyTopmostWindowAtPoint(NSPoint cocoaPoint, ScreenWindowHit* out, double margin = 0) {
  if (!out) return false;

  CFArrayRef infoList =
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
                                 kCGNullWindowID);
  if (!infoList) return false;

  const CGPoint quartzPoint = CocoaPointToAXPoint(cocoaPoint);
  const pid_t selfPid = getpid();
  bool found = false;
  NSArray* windows = (__bridge NSArray*)infoList;
  for (id rawWindow in windows) {
    if (![rawWindow isKindOfClass:[NSDictionary class]]) continue;
    NSDictionary* window = (NSDictionary*)rawWindow;
    NSNumber* layer = window[(id)kCGWindowLayer];
    NSNumber* ownerPid = window[(id)kCGWindowOwnerPID];
    NSNumber* windowNumber = window[(id)kCGWindowNumber];
    NSNumber* alpha = window[(id)kCGWindowAlpha];
    NSDictionary* boundsDict = window[(id)kCGWindowBounds];

    if (![ownerPid isKindOfClass:[NSNumber class]] || ownerPid.intValue == selfPid) continue;
    if ([layer isKindOfClass:[NSNumber class]] && layer.intValue != 0) continue;
    if ([alpha isKindOfClass:[NSNumber class]] && alpha.doubleValue <= 0.05) continue;
    if ([windowNumber isKindOfClass:[NSNumber class]] &&
        gBubbleWindowNumbers.find(windowNumber.integerValue) != gBubbleWindowNumbers.end()) {
      continue;
    }

    CGRect bounds = CGRectNull;
    if (![boundsDict isKindOfClass:[NSDictionary class]] ||
        !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDict, &bounds) ||
        CGRectIsEmpty(bounds)) {
      continue;
    }

    // Resize handles sit slightly outside the visible frame, so callers can
    // widen the hit area to catch drags that start on a window border.
    const CGRect hitBounds = margin > 0 ? CGRectInset(bounds, -margin, -margin) : bounds;
    if (!CGRectContainsPoint(hitBounds, quartzPoint) &&
        !CGRectContainsPoint(hitBounds, CGPointMake(cocoaPoint.x, cocoaPoint.y))) {
      continue;
    }

    out->pid = ownerPid.intValue;
    out->windowId = windowNumber ? (CGWindowID)windowNumber.unsignedIntValue : 0;
    out->bounds = bounds;
    NSString* ownerName = window[(id)kCGWindowOwnerName];
    out->owner = ToStdString([ownerName isKindOfClass:[NSString class]] ? ownerName : @"");
    found = true;
    break;
  }

  CFRelease(infoList);
  return found;
}

bool CopyWindowBounds(CGWindowID windowId, CGRect* outBounds) {
  if (!windowId || !outBounds) return false;

  CFArrayRef infoList = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId);
  if (!infoList) return false;

  bool ok = false;
  NSArray* windows = (__bridge NSArray*)infoList;
  for (id rawWindow in windows) {
    if (![rawWindow isKindOfClass:[NSDictionary class]]) continue;
    NSDictionary* window = (NSDictionary*)rawWindow;
    NSNumber* windowNumber = window[(id)kCGWindowNumber];
    NSDictionary* boundsDict = window[(id)kCGWindowBounds];
    if (![windowNumber isKindOfClass:[NSNumber class]] ||
        (CGWindowID)windowNumber.unsignedIntValue != windowId ||
        ![boundsDict isKindOfClass:[NSDictionary class]]) {
      continue;
    }
    ok = CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDict, outBounds);
    break;
  }

  CFRelease(infoList);
  return ok;
}

bool DidMouseDownWindowFrameChange() {
  if (!gMouseDownWindowId || CGRectIsNull(gMouseDownWindowBounds)) return false;

  CGRect now = CGRectNull;
  if (!CopyWindowBounds(gMouseDownWindowId, &now)) return false;

  return std::abs(now.origin.x - gMouseDownWindowBounds.origin.x) >= 1.0 ||
         std::abs(now.origin.y - gMouseDownWindowBounds.origin.y) >= 1.0 ||
         std::abs(now.size.width - gMouseDownWindowBounds.size.width) >= 1.0 ||
         std::abs(now.size.height - gMouseDownWindowBounds.size.height) >= 1.0;
}

AXUIElementRef CopyWindowContainingPoint(AXUIElementRef app, NSPoint cocoaPoint) {
  if (!app) return nullptr;

  CFTypeRef windowsVal = nullptr;
  if (AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, &windowsVal) != kAXErrorSuccess ||
      !windowsVal) {
    return nullptr;
  }

  AXUIElementRef best = nullptr;
  double bestScore = std::numeric_limits<double>::infinity();
  ScreenWindowHit hit;
  const bool hasHit = CopyTopmostWindowAtPoint(cocoaPoint, &hit);

  if (CFGetTypeID(windowsVal) == CFArrayGetTypeID()) {
    CFArrayRef windows = (CFArrayRef)windowsVal;
    for (CFIndex i = 0; i < CFArrayGetCount(windows); i++) {
      CFTypeRef item = CFArrayGetValueAtIndex(windows, i);
      if (!item || CFGetTypeID(item) != AXUIElementGetTypeID()) continue;

      AXUIElementRef window = (AXUIElementRef)item;
      CGRect frame;
      if (!CopyWindowFrame(window, &frame) || !AXFrameContainsCocoaPoint(frame, cocoaPoint)) {
        continue;
      }

      double score = std::max(1.0, frame.size.width * frame.size.height);
      if (hasHit && !CGRectIsNull(hit.bounds)) {
        const double dx = (frame.origin.x + frame.size.width / 2.0) -
                          (hit.bounds.origin.x + hit.bounds.size.width / 2.0);
        const double dy = (frame.origin.y + frame.size.height / 2.0) -
                          (hit.bounds.origin.y + hit.bounds.size.height / 2.0);
        score = std::hypot(dx, dy);
      }

      if (score < bestScore) {
        if (best) CFRelease(best);
        best = window;
        CFRetain(best);
        bestScore = score;
      }
    }
  }

  CFRelease(windowsVal);
  return best;
}

bool RaiseWindowAtPoint(pid_t pid, NSPoint point) {
  if (pid <= 0) return false;

  NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  BOOL activated = NO;
  if (running) {
    activated = [running activateWithOptions:NSApplicationActivateIgnoringOtherApps];
  }

  AXUIElementRef axApp = AXUIElementCreateApplication(pid);
  if (!axApp) {
    NSLog(@"[selection_bridge] raise window pid=%d activated=%d axApp=0", pid, activated);
    return activated;
  }

  AXUIElementRef window = CopyWindowContainingPoint(axApp, point);
  if (window) {
    std::string title;
    GetAXStringAttr(window, kAXTitleAttribute, &title);
    const AXError raiseErr = AXUIElementPerformAction(window, kAXRaiseAction);
    const AXError focusErr =
        AXUIElementSetAttributeValue(axApp, kAXFocusedWindowAttribute, window);
    NSLog(@"[selection_bridge] raise window pid=%d activated=%d title=%s raise=%d focus=%d",
          pid, activated, title.c_str(), raiseErr, focusErr);
    CFRelease(window);
  } else {
    NSLog(@"[selection_bridge] raise window pid=%d activated=%d no AX window at point", pid,
          activated);
  }

  CFRelease(axApp);
  return true;
}

bool FindSelectionInDescendants(AXUIElementRef start, AXUIElementRef* outElem) {
  if (!start || !outElem) return false;

  std::vector<AXUIElementRef> queue;
  CFRetain(start);
  queue.push_back(start);
  size_t index = 0;
  int visited = 0;
  const int kMaxNodes = 48;

  while (index < queue.size() && visited < kMaxNodes) {
    AXUIElementRef current = queue[index++];
    visited++;

    if (current != start && ElementHasSelection(current)) {
      *outElem = current;
      CFRetain(current);
      for (AXUIElementRef item : queue) {
        CFRelease(item);
      }
      return true;
    }

    if (visited > 1) {
      const std::string role = GetAXRoleDebug(current);
      if (IsWindowRoleDebug(role) && current != start) {
        continue;
      }
    }

    CFTypeRef childrenVal = nullptr;
    if (AXUIElementCopyAttributeValue(current, kAXChildrenAttribute, &childrenVal) !=
            kAXErrorSuccess ||
        !childrenVal) {
      continue;
    }

    if (CFGetTypeID(childrenVal) == CFArrayGetTypeID()) {
      CFArrayRef children = (CFArrayRef)childrenVal;
      const CFIndex count = std::min(CFArrayGetCount(children), static_cast<CFIndex>(12));
      for (CFIndex i = 0; i < count; i++) {
        CFTypeRef child = CFArrayGetValueAtIndex(children, i);
        if (!child || CFGetTypeID(child) != AXUIElementGetTypeID()) continue;
        CFRetain(child);
        queue.push_back((AXUIElementRef)child);
      }
    }

    CFRelease(childrenVal);
  }

  for (AXUIElementRef item : queue) {
    CFRelease(item);
  }
  return false;
}

AXUIElementRef CopyElementAtCocoaPoint(NSPoint cocoaPoint) {
  AXUIElementRef sys = AXUIElementCreateSystemWide();
  if (!sys) return nullptr;

  AXUIElementRef elem = nullptr;
  AXError err =
      AXUIElementCopyElementAtPosition(sys, static_cast<float>(cocoaPoint.x),
                                       static_cast<float>(cocoaPoint.y), &elem);
  if (err != kAXErrorSuccess || !elem) {
    if (elem) {
      CFRelease(elem);
      elem = nullptr;
    }

    const CGPoint axPoint = CocoaPointToAXPoint(cocoaPoint);
    err = AXUIElementCopyElementAtPosition(sys, static_cast<float>(axPoint.x),
                                           static_cast<float>(axPoint.y), &elem);
    if (err != kAXErrorSuccess || !elem) {
      if (elem) CFRelease(elem);
      elem = nullptr;
    }
  }

  CFRelease(sys);
  return elem;
}

bool GetSelectionTarget(NSPoint cocoaPoint, AXUIElementRef* outApp, AXUIElementRef* outElem,
                        std::string* debug) {
  if (outApp) *outApp = nullptr;
  if (outElem) *outElem = nullptr;

  AXUIElementRef app = nullptr;
  AXUIElementRef focusedElem = nullptr;
  GetFocused(&app, &focusedElem);

  ScreenWindowHit hit;
  const bool hasHit = CopyTopmostWindowAtPoint(cocoaPoint, &hit);
  if (hasHit && hit.pid > 0) {
    pid_t focusedPid = -1;
    if (app) {
      AXUIElementGetPid(app, &focusedPid);
    }
    if (focusedPid != hit.pid) {
      if (app) CFRelease(app);
      if (focusedElem) {
        CFRelease(focusedElem);
        focusedElem = nullptr;
      }
      app = AXUIElementCreateApplication(hit.pid);
      CopyAXFocusedElement(app, &focusedElem);
      if (debug) {
        *debug += "retargetPid=" + std::to_string(hit.pid) + " ";
      }
    }
  }

  if (outApp) *outApp = app;

  if (debug && hasHit) {
    *debug += "cgWin=" + std::to_string(hit.windowId) + "/" + hit.owner + " ";
  }

  AXUIElementRef atPoint = CopyElementAtCocoaPoint(cocoaPoint);
  if (atPoint) {
    if (debug) {
      *debug += "pointRole=" + GetAXRoleDebug(atPoint) + " ";
    }

    AXUIElementRef selected = nullptr;
    if (CopySelectionElementWalkingUp(atPoint, &selected)) {
      if (debug) *debug += "strategy=point_walk ";
      if (focusedElem) CFRelease(focusedElem);
      CFRelease(atPoint);
      if (outElem) *outElem = selected;
      return true;
    }
  }

  if (focusedElem) {
    AXUIElementRef selected = nullptr;
    if (CopySelectionElementWalkingUp(focusedElem, &selected)) {
      if (debug) *debug += "strategy=app_focus_walk ";
      if (atPoint) CFRelease(atPoint);
      CFRelease(focusedElem);
      if (outElem) *outElem = selected;
      return true;
    }
  }

  const int windowCount = WakeAXWindows(app);
  if (debug) {
    *debug += "windows=" + std::to_string(windowCount) + " ";
  }

  if (atPoint) {
    AXUIElementRef selected = nullptr;
    if (FindSelectionInDescendants(atPoint, &selected)) {
      if (debug) *debug += "strategy=point_desc ";
      if (focusedElem) CFRelease(focusedElem);
      CFRelease(atPoint);
      if (outElem) *outElem = selected;
      return true;
    }
  }

  if (app) {
    AXUIElementRef window = CopyWindowContainingPoint(app, cocoaPoint);
    if (window) {
      if (debug) {
        std::string title;
        GetAXStringAttr(window, kAXTitleAttribute, &title);
        *debug += "hitWindow=" + (title.empty() ? GetAXRoleDebug(window) : title) + " ";
      }

      AXUIElementRef windowFocused = nullptr;
      if (CopyAXFocusedElement(window, &windowFocused)) {
        AXUIElementRef selected = nullptr;
        if (CopySelectionElementWalkingUp(windowFocused, &selected)) {
          if (debug) *debug += "strategy=window_focus_walk ";
          if (focusedElem) CFRelease(focusedElem);
          if (atPoint) CFRelease(atPoint);
          CFRelease(windowFocused);
          CFRelease(window);
          if (outElem) *outElem = selected;
          return true;
        }

        if (!focusedElem) {
          focusedElem = windowFocused;
        } else {
          CFRelease(windowFocused);
        }
      }

      AXUIElementRef windowSelected = nullptr;
      if (FindSelectionInDescendants(window, &windowSelected)) {
        if (debug) *debug += "strategy=window_desc ";
        if (focusedElem) CFRelease(focusedElem);
        if (atPoint) CFRelease(atPoint);
        CFRelease(window);
        if (outElem) *outElem = windowSelected;
        return true;
      }

      CFRelease(window);
    }
  }

  if (focusedElem) {
    AXUIElementRef selected = nullptr;
    if (CopySelectionElementWalkingUp(focusedElem, &selected)) {
      if (debug) *debug += "strategy=app_focus_walk ";
      if (atPoint) CFRelease(atPoint);
      CFRelease(focusedElem);
      if (outElem) *outElem = selected;
      return true;
    }
  }

  if (atPoint) {
    if (debug) *debug += "strategy=point_raw ";
    if (focusedElem) CFRelease(focusedElem);
    if (outElem) *outElem = atPoint;
    return true;
  }

  if (debug) *debug += "strategy=app_focus_raw ";
  if (outElem) *outElem = focusedElem;
  return app != nullptr || focusedElem != nullptr;
}

bool ShouldClipboardFallback(NSString* bundleId, SelectionScene scene, bool axGotFocusedElement,
                             bool hasNonEmptyRange) {
  if (scene == SelectionScene::kNone) {
    NSLog(@"[selection_bridge] clipboard fallback blocked: scene=none");
    return false;
  }

  if (bundleId && ([bundleId isEqualToString:@"com.github.Electron"] ||
                   [bundleId hasPrefix:@"com.github.electron"])) {
    NSLog(@"[selection_bridge] clipboard fallback blocked: electron bundle=%@", bundleId);
    return false;
  }

  NSLog(@"[selection_bridge] clipboard fallback allowed: scene=%s bundle=%@ focused=%d hasNonEmpty=%d",
        SceneToString(scene), bundleId ?: @"", axGotFocusedElement, hasNonEmptyRange);
  return true;
}

bool DragPasteboardHasFilePayload() {
  NSPasteboard* dragPasteboard = [NSPasteboard pasteboardWithName:NSPasteboardNameDrag];
  if (!dragPasteboard) return false;

  NSArray<NSPasteboardType>* types = [dragPasteboard types];
  if (!types || types.count == 0) return false;

  for (NSPasteboardType type in types) {
    if ([type isEqualToString:NSPasteboardTypeFileURL] ||
        [type isEqualToString:NSFilenamesPboardType] ||
        [type isEqualToString:@"public.file-url"] ||
        [type isEqualToString:@"com.apple.pasteboard.promised-file-url"] ||
        [type isEqualToString:@"com.apple.finder.pboard"]) {
      return true;
    }
  }

  return false;
}

NSInteger GetDragPasteboardChangeCount() {
  NSPasteboard* dragPasteboard = [NSPasteboard pasteboardWithName:NSPasteboardNameDrag];
  if (!dragPasteboard) return -1;
  return dragPasteboard.changeCount;
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
  if ([event clickCount] >= 2) {
    NSLog(@"[selection_bridge] multi-click mouseUp clickCount=%ld", (long)[event clickCount]);
    return SelectionScene::kMultiClickSelect;
  }

  double dx = loc.x - gMouseDownPoint.x;
  double dy = loc.y - gMouseDownPoint.y;
  double dist = sqrt(dx * dx + dy * dy);
  if (dist <= kDragThreshold) return SelectionScene::kNone;

  // Keep gesture detection separate from selection retrieval. Some apps do
  // not publish their AX selection until after mouseUp, so probing AX here can
  // discard a valid drag before the delayed snapshot and clipboard fallback
  // get a chance to run.
  const bool mouseUpNearFocusedWindowEdge = IsPointNearFocusedWindowEdge(loc);
  const bool nearFocusedWindowEdge =
      gLeftMouseDownNearFocusedWindowEdge || mouseUpNearFocusedWindowEdge;
  // The focused-window edge check misses drags on a background window's
  // border (the app is only activated after mouseDown). A window whose frame
  // changed during the drag was moved or resized, never text-selected.
  const bool mouseDownWindowFrameChanged = DidMouseDownWindowFrameChange();
  const NSInteger dragPasteboardChangeCount = GetDragPasteboardChangeCount();
  const bool hasFreshFileDragPayload =
      dragPasteboardChangeCount >= 0 &&
      gDragPasteboardChangeCountOnMouseDown >= 0 &&
      dragPasteboardChangeCount != gDragPasteboardChangeCountOnMouseDown &&
      DragPasteboardHasFilePayload();

  const SelectionScene scene =
      !hasFreshFileDragPayload && !nearFocusedWindowEdge && !mouseDownWindowFrameChanged
          ? SelectionScene::kBoxSelect
          : SelectionScene::kNone;

  NSLog(@"[selection_bridge] drag mouseUp dist=%.2f mouseDownNearFocusedWindowEdge=%d mouseUpNearFocusedWindowEdge=%d mouseDownWindowFrameChanged=%d mouseDownWindowId=%u hasFreshFileDragPayload=%d dragPasteboardChangeCount=%ld mouseDownDragPasteboardChangeCount=%ld scene=%s",
        dist, gLeftMouseDownNearFocusedWindowEdge, mouseUpNearFocusedWindowEdge, mouseDownWindowFrameChanged,
        gMouseDownWindowId, hasFreshFileDragPayload,
        (long)dragPasteboardChangeCount, (long)gDragPasteboardChangeCountOnMouseDown,
        SceneToString(scene));

  return scene;
}

void EmitEvent(int64_t kind, NSDictionary* payload);

void EmitAction(SelectionScene scene, NSPoint pt) {
  {
    std::lock_guard<std::mutex> lock(gMonitorMutex);
    if (!gActionMonitorActive) return;
  }
  EmitEvent(1, @{@"scene" : @(SceneToString(scene)), @"x" : @(pt.x), @"y" : @(pt.y)});
}

void UnobserveWindow() {
  if (gFocusedWindowObserver && gObservedWindow) {
    AXObserverRemoveNotification(gFocusedWindowObserver, gObservedWindow, kAXMovedNotification);
    AXObserverRemoveNotification(gFocusedWindowObserver, gObservedWindow, kAXResizedNotification);
  }

  if (gObservedWindow) {
    CFRelease(gObservedWindow);
    gObservedWindow = nullptr;
  }

  gHasLastObservedWindowFrame = false;
  gLastObservedWindowFrame = CGRectZero;
}

void ObserveFocusedWindow(AXUIElementRef app) {
  UnobserveWindow();
  if (!app || !gFocusedWindowObserver) return;

  CFTypeRef windowVal = nullptr;
  if (AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &windowVal) != kAXErrorSuccess ||
      !windowVal) {
    return;
  }

  if (CFGetTypeID(windowVal) != AXUIElementGetTypeID()) {
    CFRelease(windowVal);
    return;
  }

  gObservedWindow = (AXUIElementRef)windowVal;
  AXObserverAddNotification(gFocusedWindowObserver, gObservedWindow, kAXMovedNotification, nullptr);
  AXObserverAddNotification(gFocusedWindowObserver, gObservedWindow, kAXResizedNotification, nullptr);
  gHasLastObservedWindowFrame = CopyWindowFrame(gObservedWindow, &gLastObservedWindowFrame);
}

void StopWindowObserver() {
  UnobserveWindow();

  if (gFocusedWindowObserver && gObservedApp) {
    AXObserverRemoveNotification(gFocusedWindowObserver, gObservedApp, kAXFocusedWindowChangedNotification);
    AXObserverRemoveNotification(gFocusedWindowObserver, gObservedApp, kAXWindowCreatedNotification);
  }

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

void OnWindowFrameChanged(AXObserverRef, AXUIElementRef, CFStringRef notification, void*) {
  const bool isWindowCreated = notification && CFEqual(notification, kAXWindowCreatedNotification);
  const bool isFocusedWindowChanged =
      notification && CFEqual(notification, kAXFocusedWindowChangedNotification);

  if (isWindowCreated || isFocusedWindowChanged) {
    ObserveFocusedWindow(gObservedApp);
    const int windowCount = WakeAXWindows(gObservedApp);
    NSLog(@"[selection_bridge] window event created=%d focusedChanged=%d windows=%d mouseDown=%d",
          isWindowCreated, isFocusedWindowChanged, windowCount, gIsLeftMouseDown);
  }

  if (gIsLeftMouseDown) {
    // Drag-selecting in a newly focused / created window must not be treated as
    // a window-frame dismiss. That path cancels the pending bubble.
    return;
  }

  if (isWindowCreated) {
    // Opening another window should enable AX for it, not dismiss a pending
    // selection in the previous or next gesture.
    return;
  }

  if (!isFocusedWindowChanged && gObservedWindow && gHasLastObservedWindowFrame) {
    CGRect nextFrame = CGRectZero;
    if (CopyWindowFrame(gObservedWindow, &nextFrame) &&
        std::abs(nextFrame.origin.x - gLastObservedWindowFrame.origin.x) < 1.0 &&
        std::abs(nextFrame.origin.y - gLastObservedWindowFrame.origin.y) < 1.0 &&
        std::abs(nextFrame.size.width - gLastObservedWindowFrame.size.width) < 1.0 &&
        std::abs(nextFrame.size.height - gLastObservedWindowFrame.size.height) < 1.0) {
      return;
    }
    gLastObservedWindowFrame = nextFrame;
    gHasLastObservedWindowFrame = true;
  }

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

  AXObserverAddNotification(observer, app, kAXFocusedWindowChangedNotification, nullptr);
  AXObserverAddNotification(observer, app, kAXWindowCreatedNotification, nullptr);

  CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer),
                     kCFRunLoopDefaultMode);

  gFocusedWindowObserver = observer;
  gObservedApp = app;
  ObserveFocusedWindow(app);
  WakeAXWindows(app);
}

void RemoveMonitorsLocked() {
  if (gGlobalMouseMonitor) {
    [NSEvent removeMonitor:gGlobalMouseMonitor];
    gGlobalMouseMonitor = nil;
  }

  if (gUserInputKeyMonitor) {
    [NSEvent removeMonitor:gUserInputKeyMonitor];
    gUserInputKeyMonitor = nil;
  }

  if (gGlobalKeyMonitor) {
    [NSEvent removeMonitor:gGlobalKeyMonitor];
    gGlobalKeyMonitor = nil;
  }

  if (gLocalKeyMonitor) {
    [NSEvent removeMonitor:gLocalKeyMonitor];
    gLocalKeyMonitor = nil;
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

  gActionMonitorActive = false;
}

bool IsKeyWindowABubbleSurface() {
  NSWindow* keyWindow = NSApp.keyWindow;
  if (!keyWindow) {
    return false;
  }

  return gBubbleWindowNumbers.find(keyWindow.windowNumber) != gBubbleWindowNumbers.end();
}

void InstallUserInputKeyMonitorLocked() {
  if (gUserInputKeyMonitor) return;

  gUserInputKeyMonitor = [NSEvent
      addGlobalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                     handler:^(NSEvent* event) {
    CGEventRef cgEvent = event.CGEvent;
    const int64_t eventTag =
        cgEvent ? CGEventGetIntegerValueField(cgEvent, kCGEventSourceUserData) : 0;
    if (eventTag != kSimulatedKeyboardEventTag) {
      gUserInputGeneration.fetch_add(1, std::memory_order_relaxed);
    }
  }];
}

void InstallKeyMonitorLocked() {
  if (!gGlobalKeyMonitor) {
    gGlobalKeyMonitor = [NSEvent
        addGlobalMonitorForEventsMatchingMask:
            (NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged)
                                   handler:^(NSEvent* event) {
      HandleKeyEvent(event);
    }];
  }

  if (!gLocalKeyMonitor) {
    gLocalKeyMonitor = [NSEvent
        addLocalMonitorForEventsMatchingMask:
            (NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged)
                                  handler:^NSEvent*(NSEvent* event) {
      // Keys already headed at our own editable surfaces (ask/translate
      // inputs) must not dismiss those windows.
      if (!IsKeyWindowABubbleSurface()) {
        HandleKeyEvent(event);
      }
      return event;
    }];
  }
}

void RemoveKeyMonitorLocked() {
  if (gGlobalKeyMonitor) {
    [NSEvent removeMonitor:gGlobalKeyMonitor];
    gGlobalKeyMonitor = nil;
  }

  if (gLocalKeyMonitor) {
    [NSEvent removeMonitor:gLocalKeyMonitor];
    gLocalKeyMonitor = nil;
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

void HandleKeyEvent(NSEvent* event) {
  if (event.type == NSEventTypeKeyDown) {
    NSEventModifierFlags flags = event.modifierFlags;
    unsigned short kc = event.keyCode;

    if ((flags & NSEventModifierFlagCommand) && kc == kVK_ANSI_C) {
      return;
    }

    EmitAction(SelectionScene::kKeyDismiss, [NSEvent mouseLocation]);
  }
}

// ---------- C ABI helpers ----------

std::mutex gEventCallbackMutex;

void EmitEvent(int64_t kind, NSDictionary* payload) {
  PMEventCallback cb = nullptr;
  {
    std::lock_guard<std::mutex> lock(gEventCallbackMutex);
    cb = gEventCallback;
  }
  if (!cb) return;
  @autoreleasepool {
    NSData* data = [NSJSONSerialization dataWithJSONObject:payload ?: @{} options:0 error:nil];
    std::string json = data ? std::string((const char*)data.bytes, data.length) : std::string("{}");
    cb(kind, json.c_str());
  }
}

char* DupString(const std::string& value) {
  char* out = (char*)malloc(value.size() + 1);
  if (!out) return nullptr;
  memcpy(out, value.data(), value.size());
  out[value.size()] = 0;
  return out;
}

char* DupJson(id object) {
  NSData* data = object ? [NSJSONSerialization dataWithJSONObject:object options:0 error:nil] : nil;
  if (!data) return DupString("null");
  return DupString(std::string((const char*)data.bytes, data.length));
}

id ParseJson(const char* json) {
  if (!json || !*json) return nil;
  NSData* data = [NSData dataWithBytes:json length:strlen(json)];
  return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}

NSString* NSStringFromC(const char* value) {
  if (!value) return @"";
  return [NSString stringWithUTF8String:value] ?: @"";
}

NSDictionary* RectDictionary(CGRect rect) {
  return @{@"x" : @(rect.origin.x), @"y" : @(rect.origin.y), @"width" : @(rect.size.width),
           @"height" : @(rect.size.height)};
}

// ---------- Selection ----------

NSDictionary* SelectionSnapshot(SelectionScene scene) {
  NSMutableDictionary* result = [NSMutableDictionary dictionary];
  result[@"text"] = @"";
  result[@"sourceApp"] = @"";
  result[@"sourceBundleId"] = @"";
  result[@"scene"] = @(SceneToString(scene));
  result[@"hasRect"] = @NO;
  result[@"strategy"] = @"none";
  result[@"targetDebug"] = @"";

  if (!IsTrusted(false)) {
    result[@"error"] = @"accessibility_permission_denied";
    return result;
  }

  NSRunningApplication* frontApp = NSWorkspace.sharedWorkspace.frontmostApplication;
  NSString* bundleId = frontApp.bundleIdentifier ?: @"";
  NSString* appName = frontApp.localizedName ?: @"";
  NSPoint loc = NSEqualPoints(gLastActionPoint, NSZeroPoint) ? [NSEvent mouseLocation]
                                                             : gLastActionPoint;
  ScreenWindowHit hit;
  if (CopyTopmostWindowAtPoint(loc, &hit) && hit.pid > 0) {
    NSRunningApplication* ownerApp =
        [NSRunningApplication runningApplicationWithProcessIdentifier:hit.pid];
    if (ownerApp) {
      bundleId = ownerApp.bundleIdentifier ?: bundleId;
      appName = ownerApp.localizedName ?: appName;
    } else if (!hit.owner.empty()) {
      appName = @(hit.owner.c_str());
    }
    result[@"sourceAppPid"] = @(hit.pid);
  } else {
    result[@"sourceAppPid"] = @(frontApp ? frontApp.processIdentifier : -1);
  }
  result[@"sourceApp"] = appName;
  result[@"sourceBundleId"] = bundleId;

  AXUIElementRef focusedApp = nullptr;
  AXUIElementRef focusedElem = nullptr;
  std::string targetDebug;
  std::string text;
  bool gotFocusedElement = false;
  bool hasNonEmpty = false;

  for (int attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      [NSThread sleepForTimeInterval:0.025];
    }

    ReleaseAX(&focusedElem);
    ReleaseAX(&focusedApp);
    targetDebug.clear();
    NSLog(@"[popmind_native] Try use AXAPI get user selected text attempt=%d", attempt);
    GetSelectionTarget(loc, &focusedApp, &focusedElem, &targetDebug);
    gotFocusedElement = focusedElem != nullptr;
    hasNonEmpty = focusedElem && HasNonEmptyRange(focusedElem);

    if (!focusedElem) {
      NSLog(@"[popmind_native] AXAPI get user selected element failed, error = missing");
      continue;
    }

    if (GetAXSelectedText(focusedElem, &text) && !text.empty()) {
      result[@"strategy"] = @"ax_selected_text";
    } else if (GetTextByRange(focusedElem, &text) && !text.empty()) {
      result[@"strategy"] = @"ax_range_string";
    }

    if (text.empty()) {
      NSLog(@"[popmind_native] AXAPI get user selected text empty, continue");
      continue;
    }

    CGRect selectionRect = CGRectNull;
    const bool hasRect = GetSelectionBounds(focusedElem, &selectionRect);
    if (hasRect && (selectionRect.size.width < 0.5 || selectionRect.size.height < 0.5)) {
      NSLog(@"[popmind_native] selected text area has 0 width/height, invalid");
    }
    if (hasRect && !SelectionRectNearCursor(selectionRect, loc)) {
      NSLog(@"[popmind_native] selected text area faraway from cursor, invalid");
      text.clear();
      continue;
    }

    CGRect rect = CGRectNull;
    if (FillRect(focusedElem, &rect)) {
      result[@"rect"] = RectDictionary(rect);
      result[@"hasRect"] = @YES;
    }
    break;
  }
  result[@"targetDebug"] = @(targetDebug.c_str());

  if (text.empty() &&
      ShouldClipboardFallback(bundleId, scene, gotFocusedElement, hasNonEmpty)) {
    pid_t pid = -1;
    if (focusedApp) {
      AXUIElementGetPid(focusedApp, &pid);
    }
    // See the Electron bridge: only fall back for the frontmost app, so the fallback never
    // activates some other window under the pointer.
    NSRunningApplication* currentFrontApp = NSWorkspace.sharedWorkspace.frontmostApplication;
    const pid_t frontPid = currentFrontApp ? currentFrontApp.processIdentifier : -1;
    if (pid > 0 && pid == frontPid) {
      result[@"needsClipboardFallback"] = @YES;
      result[@"fallbackAppPid"] = @(pid);
    } else {
      NSLog(@"[popmind_native] skip clipboard fallback: target pid=%d is not frontmost pid=%d", pid,
            frontPid);
      targetDebug += "fallbackSkipped=notFrontmost ";
      result[@"targetDebug"] = @(targetDebug.c_str());
    }
  }

  result[@"text"] = [NSString stringWithUTF8String:text.c_str()] ?: @"";
  NSLog(@"[popmind_native] snapshot scene=%s app=%@ bundle=%@ focused=%d hasNonEmpty=%d textLen=%lu strategy=%@ fallback=%d hasRect=%@ target=[%s]",
        SceneToString(scene), appName, bundleId, gotFocusedElement, hasNonEmpty,
        (unsigned long)text.size(), result[@"strategy"], result[@"needsClipboardFallback"] != nil,
        result[@"hasRect"], targetDebug.c_str());
  ReleaseAX(&focusedElem);
  ReleaseAX(&focusedApp);
  return result;
}

// ---------- Installed applications ----------

NSString* NormalizeLocaleKey(NSString* locale) {
  return [[locale stringByReplacingOccurrencesOfString:@"-" withString:@"_"] lowercaseString];
}

NSString* BundleNameFromDictionary(id value) {
  if (![value isKindOfClass:[NSDictionary class]]) return nil;
  NSDictionary* dict = (NSDictionary*)value;
  id name = dict[@"CFBundleDisplayName"] ?: dict[@"CFBundleName"];
  if ([name isKindOfClass:[NSString class]] && [(NSString*)name length] > 0) return (NSString*)name;
  return nil;
}

NSDictionary* ReadApplicationInfo(NSString* path, NSSet<NSString*>* wantedLocales) {
  NSMutableDictionary* record = [NSMutableDictionary dictionary];
  record[@"path"] = path;
  NSString* contentsPath = [path stringByAppendingPathComponent:@"Contents"];
  // Read Info.plist directly: NSBundle caches instances and would miss app updates.
  NSDictionary* info =
      [NSDictionary dictionaryWithContentsOfFile:[contentsPath stringByAppendingPathComponent:@"Info.plist"]];
  for (NSString* key in @[ @"CFBundleIdentifier", @"CFBundleName", @"CFBundleDisplayName", @"CFBundleExecutable" ]) {
    id value = info[key];
    NSString* field = [key isEqualToString:@"CFBundleIdentifier"]  ? @"bundleId"
                      : [key isEqualToString:@"CFBundleName"]      ? @"name"
                      : [key isEqualToString:@"CFBundleDisplayName"] ? @"displayName"
                                                                     : @"executable";
    record[field] = [value isKindOfClass:[NSString class]] ? value : @"";
  }

  NSString* fileDisplayName = [[NSFileManager defaultManager] displayNameAtPath:path];
  if ([[fileDisplayName pathExtension] caseInsensitiveCompare:@"app"] == NSOrderedSame) {
    fileDisplayName = [fileDisplayName stringByDeletingPathExtension];
  }
  record[@"fileDisplayName"] = fileDisplayName ?: @"";

  NSMutableDictionary* localizedNames = [NSMutableDictionary dictionary];
  NSString* resourcesPath = [contentsPath stringByAppendingPathComponent:@"Resources"];
  NSMutableSet<NSString*>* seenLocales = [NSMutableSet set];
  // macOS 14+ system apps keep every localization in a single loctable.
  NSDictionary* loctable =
      [NSDictionary dictionaryWithContentsOfFile:[resourcesPath stringByAppendingPathComponent:@"InfoPlist.loctable"]];
  for (NSString* locale in loctable) {
    if (![locale isKindOfClass:[NSString class]]) continue;
    NSString* key = NormalizeLocaleKey(locale);
    if (![wantedLocales containsObject:key]) continue;
    NSString* localizedName = BundleNameFromDictionary(loctable[locale]);
    if (!localizedName) continue;
    [seenLocales addObject:key];
    localizedNames[locale] = localizedName;
  }
  NSArray<NSString*>* entries = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:resourcesPath error:nil];
  for (NSString* entry in entries) {
    if (![[entry pathExtension] isEqualToString:@"lproj"]) continue;
    NSString* locale = [entry stringByDeletingPathExtension];
    NSString* key = NormalizeLocaleKey(locale);
    if (![wantedLocales containsObject:key] || [seenLocales containsObject:key]) continue;
    NSString* stringsPath =
        [[resourcesPath stringByAppendingPathComponent:entry] stringByAppendingPathComponent:@"InfoPlist.strings"];
    NSString* localizedName = BundleNameFromDictionary([NSDictionary dictionaryWithContentsOfFile:stringsPath]);
    if (!localizedName) continue;
    [seenLocales addObject:key];
    localizedNames[locale] = localizedName;
  }
  record[@"localizedNames"] = localizedNames;
  return record;
}

bool WriteApplicationIconPng(NSString* path, NSString* output, int size) {
  NSImage* icon = [[NSWorkspace sharedWorkspace] iconForFile:path];
  if (!icon) return false;

  NSBitmapImageRep* bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL
                                                                    pixelsWide:size
                                                                    pixelsHigh:size
                                                                 bitsPerSample:8
                                                               samplesPerPixel:4
                                                                      hasAlpha:YES
                                                                      isPlanar:NO
                                                                colorSpaceName:NSDeviceRGBColorSpace
                                                                   bytesPerRow:0
                                                                  bitsPerPixel:0];
  if (!bitmap) return false;

  bool ok = false;
  NSGraphicsContext* context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
  if (context) {
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:context];
    context.imageInterpolation = NSImageInterpolationHigh;
    [icon drawInRect:NSMakeRect(0, 0, size, size)
            fromRect:NSZeroRect
           operation:NSCompositingOperationCopy
            fraction:1.0];
    [context flushGraphics];
    [NSGraphicsContext restoreGraphicsState];

    NSData* png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    ok = png.length > 0 && [png writeToFile:output atomically:YES];
  }
  [bitmap release];
  return ok;
}

// ---------- Pasteboard ----------

// Finder copies file *reference* URLs (file:///.file/id=…), which only the OS can map to a path.
NSData* ResolveFileReferenceURLData(NSData* data) {
  NSString* raw = [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] autorelease];
  if (![raw hasPrefix:@"file:///.file/id="]) return data;

  NSURL* url = [NSURL URLWithString:[raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]];
  NSURL* pathURL = url.filePathURL;
  if (!pathURL.absoluteString.length) {
    NSLog(@"[popmind_native] unresolved file reference url");
    return data;
  }
  return [pathURL.absoluteString dataUsingEncoding:NSUTF8StringEncoding];
}

NSDictionary* ReadPasteboardDictionary(NSDictionary* options) {
  NSMutableSet<NSString*>* allowSet = [NSMutableSet set];
  double maxBytes = 20.0 * 1024.0 * 1024.0;
  if ([options isKindOfClass:[NSDictionary class]]) {
    for (id entry in options[@"allowTypes"]) {
      if ([entry isKindOfClass:[NSString class]] && [entry length] > 0) [allowSet addObject:entry];
    }
    if ([options[@"maxBytes"] isKindOfClass:[NSNumber class]]) maxBytes = [options[@"maxBytes"] doubleValue];
  }
  double maxImageBytes = maxBytes;
  if ([options[@"maxImageBytes"] isKindOfClass:[NSNumber class]]) {
    maxImageBytes = [options[@"maxImageBytes"] doubleValue];
  }

  NSPasteboard* pb = [NSPasteboard generalPasteboard];
  // Taken before reading: if the clipboard changes mid-read the next poll sees a newer count.
  const NSInteger changeCount = pb.changeCount;
  NSArray<NSPasteboardItem*>* pasteboardItems = [pb pasteboardItems] ?: @[];

  NSMutableOrderedSet<NSString*>* allTypes = [NSMutableOrderedSet orderedSet];
  for (NSPasteboardItem* item in pasteboardItems) {
    for (NSPasteboardType type in item.types) {
      if (type.length > 0) [allTypes addObject:type];
    }
  }

  NSString* marker = nil;
  NSString* sourceBundleId = nil;
  for (NSPasteboardItem* item in pasteboardItems) {
    NSArray<NSPasteboardType>* itemTypes = item.types;
    if (!marker && [itemTypes containsObject:kPopMindPasteboardMarkerType]) {
      marker = [item stringForType:kPopMindPasteboardMarkerType] ?: @"";
    }
    if (!sourceBundleId && [itemTypes containsObject:@"org.nspasteboard.source"]) {
      sourceBundleId = [item stringForType:@"org.nspasteboard.source"];
    }
  }

  NSSet<NSString*>* imageTypes =
      [NSSet setWithObjects:@"public.png", @"public.tiff", @"public.jpeg", @"public.heic", nil];
  NSSet<NSString*>* compressedImageTypes = [NSSet setWithObjects:@"public.png", @"public.jpeg", @"public.heic", nil];
  double dataBytes = 0;
  double imageBytes = 0;
  bool tooLarge = false;
  NSMutableArray* items = [NSMutableArray array];

  for (NSPasteboardItem* item in pasteboardItems) {
    NSMutableArray* representations = [NSMutableArray array];
    NSArray<NSPasteboardType>* itemTypes = item.types;
    bool hasCompressedImage = false;
    for (NSPasteboardType type in itemTypes) {
      if ([compressedImageTypes containsObject:type] && [allowSet containsObject:type]) hasCompressedImage = true;
    }
    for (NSPasteboardType type in itemTypes) {
      if (![allowSet containsObject:type]) continue;
      // A screenshot usually carries PNG plus an uncompressed TIFF that can be 10x larger.
      if (hasCompressedImage && [type isEqualToString:@"public.tiff"]) continue;
      NSData* data = [item dataForType:type];
      if (!data) continue;
      if ([type isEqualToString:@"public.file-url"]) data = ResolveFileReferenceURLData(data);
      const bool isImage = [imageTypes containsObject:type];
      double& budgetUsed = isImage ? imageBytes : dataBytes;
      budgetUsed += static_cast<double>(data.length);
      if (budgetUsed > (isImage ? maxImageBytes : maxBytes)) {
        tooLarge = true;
        break;
      }
      [representations addObject:@{@"type" : type, @"data" : [data base64EncodedStringWithOptions:0]}];
    }
    if (tooLarge) break;
    if (representations.count > 0) [items addObject:@{@"representations" : representations}];
  }

  NSMutableDictionary* result = [NSMutableDictionary dictionary];
  result[@"changeCount"] = @(changeCount);
  result[@"items"] = tooLarge ? @[] : items;
  result[@"allTypes"] = allTypes.array;
  result[@"flags"] = @{
    @"concealed" : @([allTypes containsObject:@"org.nspasteboard.ConcealedType"]),
    @"transient" : @([allTypes containsObject:@"org.nspasteboard.TransientType"] ||
                     [allTypes containsObject:@"de.petermaurer.TransientPasteboardType"]),
    @"autoGenerated" : @([allTypes containsObject:@"org.nspasteboard.AutoGeneratedType"]),
    @"remote" : @([allTypes containsObject:@"com.apple.is-remote-clipboard"]),
  };
  if (marker) result[@"popMindMarker"] = marker;
  if (sourceBundleId) result[@"sourceBundleId"] = sourceBundleId;
  result[@"tooLarge"] = @(tooLarge);
  result[@"totalBytes"] = @(dataBytes + imageBytes);
  return result;
}

// Looks for the key that types `wanted` in `source`'s layout at the given UCKeyTranslate modifier state.
bool FindKeyCodeForCharacter(TISInputSourceRef source, UniChar wanted, UInt32 modifierKeyState,
                             CGKeyCode* outKeyCode) {
  if (!source) return false;
  CFDataRef layoutData =
      (CFDataRef)TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
  if (!layoutData) return false;

  const UCKeyboardLayout* layout =
      reinterpret_cast<const UCKeyboardLayout*>(CFDataGetBytePtr(layoutData));
  const UInt32 keyboardType = LMGetKbdType();
  for (CGKeyCode code = 0; code < 128; ++code) {
    UInt32 deadKeyState = 0;
    UniChar chars[4] = {0, 0, 0, 0};
    UniCharCount length = 0;
    const OSStatus status = UCKeyTranslate(layout, code, kUCKeyActionDown, modifierKeyState,
                                           keyboardType, kUCKeyTranslateNoDeadKeysBit,
                                           &deadKeyState, 4, &length, chars);
    if (status == noErr && length == 1 && chars[0] == wanted) {
      *outKeyCode = code;
      return true;
    }
  }
  return false;
}

// Virtual key code that produces "v" in the current keyboard layout (⌘ level first, as the
// system matches key equivalents against it).
CGKeyCode ResolvePasteKeyCode(std::string* outVia = nullptr) {
  __block CGKeyCode result = kVK_ANSI_V;
  __block std::string via = "fallback";

  RunOnMainThreadSync(^{
    const UInt32 commandState = (cmdKey >> 8) & 0xFF;
    TISInputSourceRef current = TISCopyCurrentKeyboardLayoutInputSource();
    TISInputSourceRef ascii = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();

    if (current) {
      CFStringRef sourceId = (CFStringRef)TISGetInputSourceProperty(current, kTISPropertyInputSourceID);
      NSString* identifier = sourceId ? (__bridge NSString*)sourceId : @"";
      if ([[identifier uppercaseString] hasSuffix:@"QWERTYCMD"]) {
        via = "qwerty-cmd-layout";
        CFRelease(current);
        if (ascii) CFRelease(ascii);
        return;
      }
    }

    CGKeyCode code = kVK_ANSI_V;
    if (FindKeyCodeForCharacter(current, 'v', commandState, &code)) {
      result = code;
      via = "current-layout-cmd";
    } else if (FindKeyCodeForCharacter(current, 'v', 0, &code)) {
      result = code;
      via = "current-layout";
    } else if (FindKeyCodeForCharacter(ascii, 'v', commandState, &code)) {
      result = code;
      via = "ascii-layout-cmd";
    } else if (FindKeyCodeForCharacter(ascii, 'v', 0, &code)) {
      result = code;
      via = "ascii-layout";
    }

    if (current) CFRelease(current);
    if (ascii) CFRelease(ascii);
  });

  if (outVia) *outVia = via;
  return result;
}

NSVisualEffectView* FindVisualEffectView(NSView* view, int depth) {
  if (!view || depth > 4) return nil;
  if ([view isKindOfClass:[NSVisualEffectView class]]) return (NSVisualEffectView*)view;
  for (NSView* subview in view.subviews) {
    NSVisualEffectView* found = FindVisualEffectView(subview, depth + 1);
    if (found) return found;
  }
  return nil;
}

// ---------- Physical ⌘V monitor ----------

id gPasteMonitor = nil;
std::mutex gPasteMonitorMutex;
// Key code of a physical ⌘V key-down awaiting its key-up. Only touched on the main thread.
int gPendingPasteKeyCode = -1;

void RemovePasteMonitorLocked() {
  if (gPasteMonitor) {
    [NSEvent removeMonitor:gPasteMonitor];
    gPasteMonitor = nil;
  }
  gPendingPasteKeyCode = -1;
}

void HandlePasteMonitorEvent(NSEvent* event) {
  CGEventRef cgEvent = event.CGEvent;
  const int64_t eventTag =
      cgEvent ? CGEventGetIntegerValueField(cgEvent, kCGEventSourceUserData) : 0;
  if (eventTag == kSimulatedKeyboardEventTag) return;

  if (event.type == NSEventTypeKeyDown) {
    if (event.isARepeat) return;
    const NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    if (!(flags & NSEventModifierFlagCommand) || (flags & NSEventModifierFlagControl)) return;
    gPendingPasteKeyCode = (event.keyCode == ResolvePasteKeyCode()) ? (int)event.keyCode : -1;
    return;
  }

  if (event.type == NSEventTypeKeyUp) {
    // Key-up of the paste key completes the paste even if ⌘ was released first.
    if (gPendingPasteKeyCode >= 0 && event.keyCode == gPendingPasteKeyCode) {
      gPendingPasteKeyCode = -1;
      EmitEvent(2, @{@"type" : @"user-paste", @"timestamp" : @([[NSDate date] timeIntervalSince1970] * 1000.0)});
    }
  }
}

bool InstallActionMonitorsLocked() {
  if (gGlobalMouseMonitor) {
    InstallUserInputKeyMonitorLocked();
    gActionMonitorActive = true;
    return gUserInputKeyMonitor != nil;
  }

  gActionMonitorActive = true;
  InstallUserInputKeyMonitorLocked();

  gGlobalMouseMonitor = [NSEvent
      addGlobalMonitorForEventsMatchingMask:
          (NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown |
           NSEventMaskRightMouseUp | NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged |
           NSEventMaskRightMouseDragged | NSEventMaskScrollWheel | NSEventMaskOtherMouseDown |
           NSEventMaskOtherMouseUp | NSEventMaskOtherMouseDragged | NSEventMaskCursorUpdate)
                                 handler:^(NSEvent* event) {
    if (event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown ||
        event.type == NSEventTypeOtherMouseDown) {
      gUserInputGeneration.fetch_add(1, std::memory_order_relaxed);
    }

    if (event.type == NSEventTypeRightMouseDown || event.type == NSEventTypeRightMouseUp ||
        event.type == NSEventTypeOtherMouseDown || event.type == NSEventTypeOtherMouseUp) {
      if (IsPointInsideBubbleWindow([NSEvent mouseLocation])) return;
      EmitAction(SelectionScene::kOtherClickDismiss, [NSEvent mouseLocation]);
      return;
    }

    if (event.type == NSEventTypeScrollWheel) {
      NSPoint loc = [NSEvent mouseLocation];
      if (IsPointInsideBubbleWindow(loc)) return;

      const bool precise = [event hasPreciseScrollingDeltas];
      const NSEventPhase phase = [event phase];
      const double dx = std::abs([event scrollingDeltaX]);
      const double dy = std::abs([event scrollingDeltaY]);
      if (precise && (phase == NSEventPhaseBegan || phase == NSEventPhaseChanged) &&
          (dx > kScrollGestureDeltaThreshold || dy > kScrollGestureDeltaThreshold)) {
        EmitAction(SelectionScene::kGestureDismiss, loc);
      }
      return;
    }

    if (event.type == NSEventTypeLeftMouseDown) {
      NSPoint loc = [NSEvent mouseLocation];
      if (IsPointInsideBubbleWindow(loc)) {
        gLeftMouseDownOnBubble = true;
        gIsLeftMouseDown = false;
        gLeftMouseDownNearFocusedWindowEdge = false;
        return;
      }

      gLeftMouseDownOnBubble = false;
      gIsLeftMouseDown = true;
      gMouseDownPoint = loc;
      gLastMouseDownAt = CFAbsoluteTimeGetCurrent();
      gLeftMouseDownNearFocusedWindowEdge = IsPointNearFocusedWindowEdge(loc);
      ScreenWindowHit downHit;
      if (CopyTopmostWindowAtPoint(loc, &downHit, kWindowResizeHandleMargin)) {
        gMouseDownWindowId = downHit.windowId;
        gMouseDownWindowBounds = downHit.bounds;
      } else {
        gMouseDownWindowId = 0;
        gMouseDownWindowBounds = CGRectNull;
      }
      gDragPasteboardChangeCountOnMouseDown = GetDragPasteboardChangeCount();
      NSPasteboard* generalPasteboard = [NSPasteboard generalPasteboard];
      gClipboardChangeCountOnMouseDown = generalPasteboard ? generalPasteboard.changeCount : -1;
      // Dismiss as soon as the pointer goes down outside our surfaces.
      EmitAction(SelectionScene::kNone, loc);
      return;
    }

    if (event.type == NSEventTypeLeftMouseUp) {
      if (gLeftMouseDownOnBubble) {
        gLeftMouseDownOnBubble = false;
        gIsLeftMouseDown = false;
        gLeftMouseDownNearFocusedWindowEdge = false;
        return;
      }

      NSPoint loc = [NSEvent mouseLocation];
      gLastActionPoint = loc;
      gLastMouseUpAt = CFAbsoluteTimeGetCurrent();
      SelectionScene scene = DetectMouseUpScene(event, loc);
      gIsLeftMouseDown = false;
      gLeftMouseDownNearFocusedWindowEdge = false;
      gMouseDownWindowId = 0;
      gMouseDownWindowBounds = CGRectNull;
      gDragPasteboardChangeCountOnMouseDown = -1;
      EmitAction(scene, loc);
    }
  }];

  NSNotificationCenter* workspaceNC = [NSWorkspace.sharedWorkspace notificationCenter];
  gActiveSpaceObserver = [workspaceNC addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification
                                                  object:nil
                                                   queue:[NSOperationQueue mainQueue]
                                              usingBlock:^(__unused NSNotification*) {
    EmitAction(SelectionScene::kAppFocusDismiss, [NSEvent mouseLocation]);
  }];

  gAppActivatedObserver = [workspaceNC addObserverForName:NSWorkspaceDidActivateApplicationNotification
                                                   object:nil
                                                    queue:[NSOperationQueue mainQueue]
                                               usingBlock:^(NSNotification* note) {
    NSRunningApplication* activatedApp = note.userInfo[NSWorkspaceApplicationKey];
    if (activatedApp &&
        activatedApp.processIdentifier == NSRunningApplication.currentApplication.processIdentifier) {
      return;
    }
    StartWindowObserver();
    EmitAction(SelectionScene::kAppFocusDismiss, [NSEvent mouseLocation]);
  }];

  gAppDeactivatedObserver = [workspaceNC addObserverForName:NSWorkspaceDidDeactivateApplicationNotification
                                                     object:nil
                                                      queue:[NSOperationQueue mainQueue]
                                                 usingBlock:^(__unused NSNotification*) {
    EmitAction(SelectionScene::kAppFocusDismiss, [NSEvent mouseLocation]);
  }];

  StartWindowObserver();

  if (!gGlobalMouseMonitor || !gUserInputKeyMonitor) {
    RemoveMonitorsLocked();
    return false;
  }
  return true;
}

}  // namespace

// ---------- C ABI ----------

extern "C" {

__attribute__((visibility("default"))) void pm_free(char* value) { free(value); }

__attribute__((visibility("default"))) void pm_set_event_callback(PMEventCallback cb) {
  std::lock_guard<std::mutex> lock(gEventCallbackMutex);
  gEventCallback = cb;
}

__attribute__((visibility("default"))) int pm_check_permission(int prompt) {
  @autoreleasepool {
    return IsTrusted(prompt != 0) ? 1 : 0;
  }
}

__attribute__((visibility("default"))) char* pm_get_selection_snapshot(const char* scene) {
  @autoreleasepool {
    return DupJson(SelectionSnapshot(SceneFromString(scene ? scene : "")));
  }
}

// Blocking: sends ⌘C (or the Copy menu item) to the app and reads the result back. Call off the main thread.
__attribute__((visibility("default"))) char* pm_get_text_by_clipboard(int useMenu, int pid) {
  @autoreleasepool {
    AXUIElementRef app = nullptr;
    if (useMenu && pid > 0) app = AXUIElementCreateApplication(pid);
    std::string text = GetTextByClipboard(useMenu != 0, app);
    if (app) CFRelease(app);
    return DupString(text);
  }
}

__attribute__((visibility("default"))) int pm_copy_selection(int useMenu, int pid, const char* expectedText) {
  __block bool copied = false;
  std::string expected = expectedText ? expectedText : "";
  RunOnMainThreadSync(^{
    @autoreleasepool {
      AXUIElementRef app = nullptr;
      if (useMenu && pid > 0) app = AXUIElementCreateApplication(pid);
      copied = CopySelection(useMenu != 0, app, expected.empty() ? nil : @(expected.c_str()));
      if (app) CFRelease(app);
    }
  });
  return copied ? 1 : 0;
}

// {"png": base64} or null.
// Window appearance animation: pm_prepare_window_in hides the window's pixels before it is shown, so the first
// frame never flashes at full opacity; pm_animate_window_in then fades it in over ms and, with dy, slides it up
// into place from dy points below (the clipboard panel). Reduce Motion keeps the fade and drops the slide.
__attribute__((visibility("default"))) void pm_prepare_window_in(void* window) {
  if (!window) return;
  RunOnMainThreadSync(^{
    NSWindow* w = (__bridge NSWindow*)window;
    if (!w.isVisible) w.alphaValue = 0.0;
  });
}

__attribute__((visibility("default"))) void pm_animate_window_in(void* window, int ms, int dy) {
  if (!window) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow* w = (__bridge NSWindow*)window;
    const int slide = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion ? 0 : dy;
    NSRect target = w.frame;
    if (slide > 0) {
      NSRect start = target;
      start.origin.y -= slide;
      [w setFrame:start display:NO];
    }
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext* ctx) {
      ctx.duration = ms / 1000.0;
      ctx.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
      w.animator.alphaValue = 1.0;
      if (slide > 0) [w.animator setFrame:target display:YES];
    } completionHandler:nil];
  });
}

// Screen Recording permission: 1 when granted. With prompt, asks for it (once; the system remembers a refusal).
__attribute__((visibility("default"))) int pm_screen_capture_access(int prompt) {
  if (CGPreflightScreenCaptureAccess()) return 1;
  if (prompt) {
    __block bool ok = false;
    RunOnMainThreadSync(^{
      ok = CGRequestScreenCaptureAccess();
    });
    return ok ? 1 : 0;
  }
  return 0;
}

__attribute__((visibility("default"))) char* pm_capture_frontmost_window_png(int pid) {
  @autoreleasepool {
    CGImageRef image = CopyFrontmostWindowImageByPid(pid);
    if (!image) return DupJson(nil);
    NSBitmapImageRep* bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
    NSData* pngData = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    [bitmap release];
    CGImageRelease(image);
    if (!pngData.length) return DupJson(nil);
    return DupJson(@{@"png" : [pngData base64EncodedStringWithOptions:0]});
  }
}

// options: {"languages": [...], "fast": bool}. Returns {"text"} or {"error"}.
__attribute__((visibility("default"))) char* pm_recognize_text(const char* imagePath, const char* optionsJson) {
  @autoreleasepool {
    std::vector<std::string> languages;
    bool fast = false, autoLanguage = false;
    NSDictionary* options = ParseJson(optionsJson);
    if ([options isKindOfClass:[NSDictionary class]]) {
      for (id entry in options[@"languages"]) {
        if ([entry isKindOfClass:[NSString class]]) languages.push_back(ToStdString(entry));
      }
      fast = [options[@"fast"] boolValue];
      autoLanguage = [options[@"auto"] boolValue];
    }
    if (languages.empty()) languages = {"zh-Hans", "zh-Hant", "en-US"};
    std::string text, error;
    if (!RecognizeTextFromImagePath(imagePath ? imagePath : "", &text, &error, &languages, fast, autoLanguage)) {
      return DupJson(@{@"error" : @(error.empty() ? "ocr_failed" : error.c_str())});
    }
    return DupJson(@{@"text" : [NSString stringWithUTF8String:text.c_str()] ?: @""});
  }
}

__attribute__((visibility("default"))) int pm_start_action_monitor(void) {
  if (!IsTrusted(false)) return 0;
  __block bool ok = false;
  RunOnMainThreadSync(^{
    std::lock_guard<std::mutex> lock(gMonitorMutex);
    ok = InstallActionMonitorsLocked();
  });
  return ok ? 1 : 0;
}

__attribute__((visibility("default"))) void pm_stop_action_monitor(void) { RemoveMonitors(); }

__attribute__((visibility("default"))) int pm_set_key_monitor_enabled(int enabled) {
  __block bool ok = false;
  RunOnMainThreadSync(^{
    std::lock_guard<std::mutex> lock(gMonitorMutex);
    if (!gActionMonitorActive) return;
    if (enabled) {
      InstallKeyMonitorLocked();
    } else {
      RemoveKeyMonitorLocked();
    }
    ok = enabled ? (gGlobalKeyMonitor != nil && gLocalKeyMonitor != nil)
                 : (gGlobalKeyMonitor == nil && gLocalKeyMonitor == nil);
  });
  return ok ? 1 : 0;
}

// Cocoa coordinates (origin bottom-left of the primary screen).
__attribute__((visibility("default"))) char* pm_get_cursor_position(void) {
  @autoreleasepool {
    NSPoint loc = [NSEvent mouseLocation];
    return DupJson(@{@"x" : @(loc.x), @"y" : @(loc.y)});
  }
}

__attribute__((visibility("default"))) char* pm_get_frontmost_app(void) {
  @autoreleasepool {
    NSRunningApplication* app = NSWorkspace.sharedWorkspace.frontmostApplication;
    return DupJson(@{
      @"bundleId" : app.bundleIdentifier ?: @"",
      @"name" : app.localizedName ?: @"",
      @"pid" : @(app ? app.processIdentifier : -1),
      @"path" : app.bundleURL.path ?: @"",
    });
  }
}

// On-screen normal-layer windows of the app, front to back, in global top-left coordinates.
__attribute__((visibility("default"))) char* pm_get_app_windows_bounds(int pid) {
  @autoreleasepool {
    NSMutableArray* list = [NSMutableArray array];
    CFArrayRef infoList = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (!infoList) return DupJson(list);
    for (id rawWindow in (__bridge NSArray*)infoList) {
      if (![rawWindow isKindOfClass:[NSDictionary class]]) continue;
      NSDictionary* window = (NSDictionary*)rawWindow;
      NSNumber* ownerPid = window[(id)kCGWindowOwnerPID];
      NSNumber* layer = window[(id)kCGWindowLayer];
      NSDictionary* boundsDict = window[(id)kCGWindowBounds];
      if (![ownerPid isKindOfClass:[NSNumber class]] || ownerPid.intValue != pid) continue;
      if ([layer isKindOfClass:[NSNumber class]] && layer.intValue != 0) continue;
      CGRect bounds = CGRectNull;
      if (![boundsDict isKindOfClass:[NSDictionary class]] ||
          !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDict, &bounds) ||
          CGRectIsEmpty(bounds) || bounds.size.width < 100 || bounds.size.height < 100) {
        continue;
      }
      [list addObject:RectDictionary(bounds)];
      if (list.count >= 16) break;
    }
    CFRelease(infoList);
    return DupJson(list);
  }
}

__attribute__((visibility("default"))) int64_t pm_clipboard_change_count(void) {
  @autoreleasepool {
    NSPasteboard* pb = [NSPasteboard generalPasteboard];
    return pb ? (int64_t)pb.changeCount : -1;
  }
}

__attribute__((visibility("default"))) int pm_is_clipboard_fallback_active(void) {
  return gClipboardFallbackActive.load(std::memory_order_acquire) ? 1 : 0;
}

// Blocking (~140 ms on the main thread): activates the app and sends ⌘V. Call off the main thread.
__attribute__((visibility("default"))) int pm_activate_app_and_paste(int pid) {
  if (pid <= 0) return 0;
  __block BOOL activated = NO;
  RunOnMainThreadSync(^{
    NSRunningApplication* target = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    if (!target) return;
    activated = [target activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    if (!activated) return;
    [NSThread sleepForTimeInterval:0.14];
    PostCmdV();
  });
  return activated ? 1 : 0;
}

__attribute__((visibility("default"))) int pm_activate_app(int pid) {
  if (pid <= 0) return 0;
  __block BOOL activated = NO;
  RunOnMainThreadSync(^{
    NSRunningApplication* target = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    activated = target ? [target activateWithOptions:NSApplicationActivateIgnoringOtherApps] : NO;
  });
  return activated ? 1 : 0;
}

// myGo's views track the pointer only while popMind is the active app (NSTrackingActiveInActiveApp), which it
// never is while the bubble shows over the app the text is in: hovering a button showed nothing until a click
// activated popMind. A second tracking area, active always, on each of the window's myGo views (marked by its
// userInfo, added once) sends them the pointer's moves without taking the focus from that app.
static void TrackPointerAlways(NSView* view) {
  if (!view) return;
  if ([NSStringFromClass([view class]) isEqualToString:@"MyGoSurfaceView"]) {
    BOOL has = NO;
    for (NSTrackingArea* area in view.trackingAreas) {
      if ([area.userInfo objectForKey:@"popmind"]) {
        has = YES;
        break;
      }
    }
    if (!has) {
      NSTrackingArea* area = [[NSTrackingArea alloc]
          initWithRect:NSZeroRect
               options:NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved | NSTrackingActiveAlways |
                       NSTrackingInVisibleRect
                 owner:view
              userInfo:@{@"popmind" : @YES}];
      [view addTrackingArea:area];
      [area release];
    }
  }
  for (NSView* sub in view.subviews) TrackPointerAlways(sub);
}

// window: NSWindow* (myGo's Window.NativeHandle()). Registers it as a bubble surface: clicks in it are
// not treated as clicks elsewhere, and it floats at the pop-up menu level on every Space.
__attribute__((visibility("default"))) int pm_configure_bubble_window(void* window, int level) {
  if (!window) return 0;
  RunOnMainThreadSync(^{
    NSWindow* nsWindow = (__bridge NSWindow*)window;
    gBubbleWindowNumbers.insert(nsWindow.windowNumber);
    [nsWindow setIgnoresMouseEvents:NO];
    [nsWindow setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
                                   NSWindowCollectionBehaviorFullScreenAuxiliary |
                                   NSWindowCollectionBehaviorStationary];
    [nsWindow setLevel:level > 0 ? level : NSPopUpMenuWindowLevel];
    [nsWindow setHidesOnDeactivate:NO];
    [nsWindow setAcceptsMouseMovedEvents:YES];
    TrackPointerAlways(nsWindow.contentView);
    NSLog(@"[popmind_native] configureBubbleWindow class=%@ windowNumber=%ld styleMask=0x%lx level=%ld",
          NSStringFromClass([nsWindow class]), (long)nsWindow.windowNumber,
          (unsigned long)[nsWindow styleMask], (long)[nsWindow level]);
  });
  return 1;
}

// Registers a popMind window as one of its own surfaces: keys typed in it and clicks on it never count as
// the user leaving the selection (the chat composer, the launcher's field).
__attribute__((visibility("default"))) void pm_register_surface_window(void* window) {
  if (!window) return;
  RunOnMainThreadSync(^{
    gBubbleWindowNumbers.insert(((__bridge NSWindow*)window).windowNumber);
  });
}

// Window numbers change when AppKit re-creates the window server window; refresh after showing.
__attribute__((visibility("default"))) void pm_refresh_bubble_window(void* window) {
  if (!window) return;
  RunOnMainThreadSync(^{
    gBubbleWindowNumbers.insert(((__bridge NSWindow*)window).windowNumber);
  });
}

__attribute__((visibility("default"))) int pm_order_window_front(void* window) {
  if (!window) return 0;
  RunOnMainThreadSync(^{
    NSWindow* nsWindow = (__bridge NSWindow*)window;
    [nsWindow setIgnoresMouseEvents:NO];
    [nsWindow orderFrontRegardless];
  });
  return 1;
}

// Shows a panel above other apps and makes it key without activating popMind.
__attribute__((visibility("default"))) int pm_present_panel_without_activation(void* window) {
  if (!window) return 0;
  RunOnMainThreadSync(^{
    NSWindow* nsWindow = (__bridge NSWindow*)window;
    if ([nsWindow isKindOfClass:[NSPanel class]] && !([nsWindow styleMask] & NSWindowStyleMaskNonactivatingPanel)) {
      [nsWindow setStyleMask:[nsWindow styleMask] | NSWindowStyleMaskNonactivatingPanel];
      SEL preventsActivation = NSSelectorFromString(@"_setPreventsActivation:");
      if ([nsWindow respondsToSelector:preventsActivation]) {
        ((void (*)(id, SEL, BOOL))objc_msgSend)(nsWindow, preventsActivation, YES);
      }
    }
    [nsWindow setIgnoresMouseEvents:NO];
    [nsWindow setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
                                   NSWindowCollectionBehaviorFullScreenAuxiliary |
                                   NSWindowCollectionBehaviorStationary];
    [nsWindow setLevel:NSScreenSaverWindowLevel];
    [nsWindow setHidesOnDeactivate:NO];
    [nsWindow orderFrontRegardless];
    [nsWindow makeKeyWindow];
    NSLog(@"[popmind_native] presentPanelWithoutActivation class=%@ isKey=%d appActive=%d",
          NSStringFromClass([nsWindow class]), [nsWindow isKeyWindow], [NSApp isActive]);
  });
  return 1;
}

// mode: "dark" | "light" | anything else = inherit.
__attribute__((visibility("default"))) int pm_set_window_appearance(void* window, const char* mode) {
  if (!window) return 0;
  std::string value = mode ? mode : "";
  RunOnMainThreadSync(^{
    NSWindow* nsWindow = (__bridge NSWindow*)window;
    if (value == "dark") {
      nsWindow.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    } else if (value == "light") {
      nsWindow.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
    } else {
      nsWindow.appearance = nil;
    }
  });
  return 1;
}

// Rounds only the top corners of the window's vibrancy view (0 removes the mask).
__attribute__((visibility("default"))) int pm_set_vibrancy_top_corner_radius(void* window, int radiusValue) {
  if (!window) return 0;
  const CGFloat radius = std::max(0, radiusValue);
  __block bool ok = false;
  RunOnMainThreadSync(^{
    NSWindow* nsWindow = (__bridge NSWindow*)window;
    NSView* root = nsWindow.contentView.superview ?: nsWindow.contentView;
    NSVisualEffectView* effectView = FindVisualEffectView(root, 0);
    if (!effectView) return;
    if (radius <= 0) {
      effectView.maskImage = nil;
      ok = true;
      return;
    }
    const CGFloat side = radius * 2 + 1;
    NSImage* mask = [NSImage imageWithSize:NSMakeSize(side, side)
                                   flipped:NO
                            drawingHandler:^BOOL(NSRect rect) {
                              NSBezierPath* path = [NSBezierPath bezierPath];
                              [path moveToPoint:NSMakePoint(NSMinX(rect), NSMinY(rect))];
                              [path lineToPoint:NSMakePoint(NSMaxX(rect), NSMinY(rect))];
                              [path appendBezierPathWithArcFromPoint:NSMakePoint(NSMaxX(rect), NSMaxY(rect))
                                                             toPoint:NSMakePoint(NSMinX(rect), NSMaxY(rect))
                                                              radius:radius];
                              [path appendBezierPathWithArcFromPoint:NSMakePoint(NSMinX(rect), NSMaxY(rect))
                                                             toPoint:NSMakePoint(NSMinX(rect), NSMinY(rect))
                                                              radius:radius];
                              [path closePath];
                              [[NSColor blackColor] setFill];
                              [path fill];
                              return YES;
                            }];
    mask.capInsets = NSEdgeInsetsMake(radius, radius, radius, radius);
    mask.resizingMode = NSImageResizingModeStretch;
    effectView.maskImage = mask;
    ok = true;
  });
  return ok ? 1 : 0;
}

// Rounds a borderless panel: its content layer is clipped and its vibrancy view masked, so the material and
// what the view draws share the rounded shape; the window shadow follows it.
__attribute__((visibility("default"))) int pm_set_window_corner_radius(void* window, int radiusValue) {
  if (!window) return 0;
  const CGFloat radius = std::max(0, radiusValue);
  RunOnMainThreadSync(^{
    NSWindow* nsWindow = (__bridge NSWindow*)window;
    [nsWindow setOpaque:NO];
    [nsWindow setBackgroundColor:[NSColor clearColor]];
    NSView* content = nsWindow.contentView;
    for (NSView* view = content; view; view = view == content ? content.superview : nil) {
      view.wantsLayer = YES;
      view.layer.cornerRadius = radius;
      view.layer.cornerCurve = kCACornerCurveContinuous;
      view.layer.masksToBounds = radius > 0;
    }
    NSVisualEffectView* effectView = FindVisualEffectView(content.superview ?: content, 0);
    if (effectView) {
      if (radius <= 0) {
        effectView.maskImage = nil;
      } else {
        const CGFloat side = radius * 2 + 1;
        NSImage* mask = [NSImage imageWithSize:NSMakeSize(side, side)
                                       flipped:NO
                                drawingHandler:^BOOL(NSRect rect) {
                                  [[NSColor blackColor] setFill];
                                  [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius] fill];
                                  return YES;
                                }];
        mask.capInsets = NSEdgeInsetsMake(radius, radius, radius, radius);
        mask.resizingMode = NSImageResizingModeStretch;
        effectView.maskImage = mask;
      }
    }
    [nsWindow invalidateShadow];
  });
  return 1;
}

// input: {"paths": [...], "locales": [...]}. Returns an array of application records.
__attribute__((visibility("default"))) char* pm_read_applications_info(const char* inputJson) {
  @autoreleasepool {
    NSDictionary* input = ParseJson(inputJson);
    NSMutableSet<NSString*>* wanted = [NSMutableSet set];
    for (id locale in input[@"locales"]) {
      if ([locale isKindOfClass:[NSString class]]) [wanted addObject:NormalizeLocaleKey(locale)];
    }
    NSMutableArray* records = [NSMutableArray array];
    for (id path in input[@"paths"]) {
      if (![path isKindOfClass:[NSString class]]) continue;
      @autoreleasepool {
        [records addObject:ReadApplicationInfo(path, wanted)];
      }
    }
    return DupJson(records);
  }
}

// input: {"items": [{"appPath", "outputPath"}], "size": 64}. Returns an array of booleans.
__attribute__((visibility("default"))) char* pm_write_application_icons(const char* inputJson) {
  @autoreleasepool {
    NSDictionary* input = ParseJson(inputJson);
    int size = 64;
    if ([input[@"size"] isKindOfClass:[NSNumber class]]) size = std::max(16, std::min(512, [input[@"size"] intValue]));
    NSMutableArray* results = [NSMutableArray array];
    for (id item in input[@"items"]) {
      @autoreleasepool {
        NSString* appPath = [item isKindOfClass:[NSDictionary class]] ? item[@"appPath"] : nil;
        NSString* outputPath = [item isKindOfClass:[NSDictionary class]] ? item[@"outputPath"] : nil;
        bool ok = [appPath isKindOfClass:[NSString class]] && [outputPath isKindOfClass:[NSString class]] &&
                  WriteApplicationIconPng(appPath, outputPath, size);
        [results addObject:@(ok)];
      }
    }
    return DupJson(results);
  }
}

// Decodes any ImageIO format (TIFF, HEIC…) and re-encodes it as PNG. Returns {"png", "width", "height"} or null.
__attribute__((visibility("default"))) char* pm_convert_image_to_png(const uint8_t* bytes, int64_t length) {
  @autoreleasepool {
    if (!bytes || length <= 0) return DupJson(nil);
    NSData* output = nil;
    size_t width = 0, height = 0;
    CFDataRef inputData = CFDataCreateWithBytesNoCopy(nullptr, bytes, (CFIndex)length, kCFAllocatorNull);
    CGImageSourceRef source = inputData ? CGImageSourceCreateWithData(inputData, nullptr) : nullptr;
    CGImageRef image = source ? CGImageSourceCreateImageAtIndex(source, 0, nullptr) : nullptr;
    if (image) {
      width = CGImageGetWidth(image);
      height = CGImageGetHeight(image);
      CFMutableDataRef outputData = CFDataCreateMutable(nullptr, 0);
      CGImageDestinationRef destination = CGImageDestinationCreateWithData(outputData, CFSTR("public.png"), 1, nullptr);
      if (destination) {
        CGImageDestinationAddImage(destination, image, nullptr);
        if (CGImageDestinationFinalize(destination)) output = [[(__bridge NSData*)outputData copy] autorelease];
        CFRelease(destination);
      }
      CFRelease(outputData);
      CGImageRelease(image);
    }
    if (source) CFRelease(source);
    if (inputData) CFRelease(inputData);
    if (!output.length) return DupJson(nil);
    return DupJson(@{@"png" : [output base64EncodedStringWithOptions:0], @"width" : @(width), @"height" : @(height)});
  }
}

// options: {"allowTypes": [...], "maxBytes", "maxImageBytes"}. Representation data is base64.
__attribute__((visibility("default"))) char* pm_read_pasteboard(const char* optionsJson) {
  @autoreleasepool {
    return DupJson(ReadPasteboardDictionary(ParseJson(optionsJson)));
  }
}

// items: [{"representations": [{"type", "data" (base64)}]}]. The marker goes on the first item.
__attribute__((visibility("default"))) int pm_write_pasteboard(const char* itemsJson, const char* markerValue) {
  @autoreleasepool {
    NSArray* items = ParseJson(itemsJson);
    NSString* marker = markerValue ? NSStringFromC(markerValue) : nil;
    NSMutableArray<NSPasteboardItem*>* pasteboardItems = [NSMutableArray array];
    if ([items isKindOfClass:[NSArray class]]) {
      for (id itemValue in items) {
        if (![itemValue isKindOfClass:[NSDictionary class]]) continue;
        NSPasteboardItem* pasteboardItem = [[[NSPasteboardItem alloc] init] autorelease];
        bool hasData = false;
        for (id record in itemValue[@"representations"]) {
          if (![record isKindOfClass:[NSDictionary class]]) continue;
          NSString* type = record[@"type"];
          NSString* encoded = record[@"data"];
          if (![type isKindOfClass:[NSString class]] || !type.length || ![encoded isKindOfClass:[NSString class]]) continue;
          NSData* data = [[[NSData alloc] initWithBase64EncodedString:encoded options:0] autorelease];
          if (data && [pasteboardItem setData:data forType:type]) hasData = true;
        }
        if (hasData) [pasteboardItems addObject:pasteboardItem];
      }
    }
    bool ok = false;
    // Validate before clearing so a malformed request never wipes the user's clipboard.
    if (pasteboardItems.count > 0) {
      if (marker.length > 0) [pasteboardItems[0] setString:marker forType:kPopMindPasteboardMarkerType];
      NSPasteboard* pb = [NSPasteboard generalPasteboard];
      [pb clearContents];
      ok = [pb writeObjects:pasteboardItems];
    }
    NSLog(@"[popmind_native] writePasteboard ok=%d marker=%@", ok, marker ?: @"(none)");
    return ok ? 1 : 0;
  }
}

// Synthetic ⌘V for the frontmost app. Returns {"ok", "reason"?}.
__attribute__((visibility("default"))) char* pm_post_paste_keystroke(void) {
  @autoreleasepool {
    if (!AXIsProcessTrusted()) {
      NSLog(@"[popmind_native] postPasteKeystroke skipped: accessibility permission missing");
      return DupJson(@{@"ok" : @NO, @"reason" : @"no_permission"});
    }
    if (IsSecureEventInputEnabled()) {
      NSLog(@"[popmind_native] postPasteKeystroke skipped: secure event input is enabled");
      return DupJson(@{@"ok" : @NO, @"reason" : @"secure_input"});
    }
    std::string via;
    const CGKeyCode keyCode = ResolvePasteKeyCode(&via);
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
    if (!source) return DupJson(@{@"ok" : @NO});
    // Keep the user's still-held keys from mixing into the synthetic paste.
    CGEventSourceSetLocalEventsFilterDuringSuppressionState(
        source, (kCGEventFilterMaskPermitLocalMouseEvents | kCGEventFilterMaskPermitSystemDefinedEvents),
        kCGEventSuppressionStateSuppressionInterval);
    // 0x000008 is the left-⌘ device bit; some apps ignore ⌘ without it.
    const CGEventFlags flags = static_cast<CGEventFlags>(kCGEventFlagMaskCommand | 0x000008);
    bool posted = true;
    for (const bool isKeyDown : {true, false}) {
      CGEventRef event = CGEventCreateKeyboardEvent(source, keyCode, isKeyDown);
      if (!event) {
        posted = false;
        continue;
      }
      CGEventSetFlags(event, flags);
      CGEventSetIntegerValueField(event, kCGEventSourceUserData, kSimulatedKeyboardEventTag);
      CGEventPost(kCGSessionEventTap, event);
      CFRelease(event);
    }
    CFRelease(source);
    NSLog(@"[popmind_native] postPasteKeystroke ok=%d keyCode=%d via=%s", posted, (int)keyCode, via.c_str());
    return DupJson(@{@"ok" : @(posted)});
  }
}

__attribute__((visibility("default"))) int pm_resolve_paste_key_code(void) {
  @autoreleasepool {
    return (int)ResolvePasteKeyCode();
  }
}

__attribute__((visibility("default"))) int pm_is_secure_input_enabled(void) { return IsSecureEventInputEnabled() ? 1 : 0; }

__attribute__((visibility("default"))) int pm_start_paste_monitor(void) {
  if (!IsTrusted(false)) return 0;
  __block bool ok = false;
  RunOnMainThreadSync(^{
    std::lock_guard<std::mutex> lock(gPasteMonitorMutex);
    RemovePasteMonitorLocked();
    gPasteMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:(NSEventMaskKeyDown | NSEventMaskKeyUp)
                                                           handler:^(NSEvent* event) {
      HandlePasteMonitorEvent(event);
    }];
    ok = gPasteMonitor != nil;
  });
  return ok ? 1 : 0;
}

__attribute__((visibility("default"))) void pm_stop_paste_monitor(void) {
  RunOnMainThreadSync(^{
    std::lock_guard<std::mutex> lock(gPasteMonitorMutex);
    RemovePasteMonitorLocked();
  });
}

__attribute__((visibility("default"))) char* pm_resolve_app_path_by_bundle_id(const char* bundleIdValue) {
  @autoreleasepool {
    NSString* bundleId = NSStringFromC(bundleIdValue);
    if (!bundleId.length) return DupString("");
    NSURL* url = [[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:bundleId];
    return DupString(ToStdString(url.path ?: @""));
  }
}

// Opens System Settings at Privacy & Security → Accessibility.
__attribute__((visibility("default"))) void pm_open_accessibility_settings(void) {
  @autoreleasepool {
    NSURL* url = [NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"];
    [[NSWorkspace sharedWorkspace] openURL:url];
  }
}

}  // extern "C"
