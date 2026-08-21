#include <napi.h>

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#if __has_include(<ScreenCaptureKit/ScreenCaptureKit.h>)
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#endif
#import <Vision/Vision.h>

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
Napi::ThreadSafeFunction* gActionTsfn = nullptr;
std::mutex gMonitorMutex;
std::mutex gClipboardFallbackMutex;
std::atomic<uint64_t> gUserInputGeneration{0};
std::unordered_set<NSInteger> gBubbleWindowNumbers;

bool gIsLeftMouseDown = false;
bool gLeftMouseDownOnBubble = false;
NSPoint gMouseDownPoint = NSZeroPoint;
NSPoint gLastActionPoint = NSZeroPoint;
NSInteger gDragPasteboardChangeCountOnMouseDown = -1;
NSInteger gClipboardChangeCountOnMouseDown = -1;


static constexpr double kScrollGestureDeltaThreshold = 4.0;
static constexpr double kDragThreshold = 3.0;
static constexpr int64_t kSimulatedKeyboardEventTag = 0x504F504D494E44;

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

bool BundleIdEquals(NSString* bundleId, const char* expected) {
  if (!bundleId || !expected) return false;
  return [bundleId isEqualToString:@(expected)];
}

bool IsVSCodeBundleId(NSString* bundleId) {
  if (!bundleId) return false;
  return [bundleId hasPrefix:@"com.microsoft.VSCode"];
}

bool IsObsidianBundleId(NSString* bundleId) {
  if (!bundleId) return false;
  return [bundleId isEqualToString:@"md.obsidian"];
}

bool IsZedBundleId(NSString* bundleId) {
  if (!bundleId) return false;
  return [bundleId isEqualToString:@"dev.zed.Zed"];
}

bool AllowsLooseSelectionFallback(NSString* bundleId) {
  return IsVSCodeBundleId(bundleId) || IsObsidianBundleId(bundleId) || IsZedBundleId(bundleId);
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
  if (!GetFocusedWindowFrame(&frame) || CGRectIsEmpty(frame) || !CGRectContainsPoint(frame, point)) {
    return false;
  }

  const double minXDist = std::min(std::abs(point.x - CGRectGetMinX(frame)),
                                   std::abs(point.x - CGRectGetMaxX(frame)));
  const double minYDist = std::min(std::abs(point.y - CGRectGetMinY(frame)),
                                   std::abs(point.y - CGRectGetMaxY(frame)));
  return minXDist <= kResizeEdgeThreshold || minYDist <= kResizeEdgeThreshold;
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

bool PasteboardLooksSensitive(NSPasteboard* pb) {
  if (!pb) return false;
  NSArray<NSPasteboardType>* types = [pb types];
  if (!types) return false;
  return [types containsObject:@"org.nspasteboard.ConcealedType"] ||
         [types containsObject:@"org.nspasteboard.AutoGeneratedType"];
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

bool RecognizeTextFromImagePath(const std::string& imagePath, std::string* outText,
                                std::string* outError) {
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
        [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(
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
        }];

    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    request.recognitionLanguages = @[ @"zh-Hans", @"zh-Hant", @"en-US", @"ja-JP", @"ko-KR" ];

    NSError* handlerError = nil;
    NSData* imageData = [NSData dataWithContentsOfFile:nsImagePath options:0 error:&handlerError];
    if (!imageData || handlerError) {
      *outError = ToStdString(handlerError.localizedDescription ?: @"ocr_image_read_failed");
      return false;
    }

    VNImageRequestHandler* handler =
        [[VNImageRequestHandler alloc] initWithData:imageData options:@{}];
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
        } else if (ShouldJoinWithoutSpace(previousLineText, mergedLineText, 0.0, heightRef)) {
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

void RestorePasteboardItems(NSArray* snapshot) {
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
    NSPasteboardItem* restoredItem = [[NSPasteboardItem alloc] init];
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
      [restoredItems addObject:restoredItem];
    }
  }

  if (restoredItems.count > 0) {
    [pb writeObjects:restoredItems];
  }
}

Napi::Array ClipboardSnapshotToNapi(Napi::Env env, NSArray* snapshot) {
  Napi::Array result = Napi::Array::New(env, snapshot ? snapshot.count : 0);
  if (![snapshot isKindOfClass:[NSArray class]]) {
    return result;
  }

  NSUInteger itemIndex = 0;
  for (id rawItemSnapshot in snapshot) {
    Napi::Object itemObject = Napi::Object::New(env);
    Napi::Array typeArray = Napi::Array::New(env);
    uint32_t typeIndex = 0;

    if ([rawItemSnapshot isKindOfClass:[NSDictionary class]]) {
      NSDictionary* itemSnapshot = (NSDictionary*)rawItemSnapshot;
      for (id rawType in itemSnapshot) {
        if (![rawType isKindOfClass:[NSString class]]) {
          continue;
        }

        id rawData = itemSnapshot[rawType];
        if (![rawData isKindOfClass:[NSData class]]) {
          continue;
        }

        NSString* type = (NSString*)rawType;
        NSData* data = (NSData*)rawData;
        Napi::Object typeRecord = Napi::Object::New(env);
        typeRecord.Set("type", ToStdString(type));
        typeRecord.Set("data", Napi::Buffer<uint8_t>::Copy(
                                   env,
                                   static_cast<const uint8_t*>(data.bytes),
                                   data.length));
        typeArray.Set(typeIndex++, typeRecord);
      }
    }

    itemObject.Set("types", typeArray);
    result.Set(itemIndex++, itemObject);
  }

  return result;
}

NSArray* ClipboardSnapshotFromNapi(const Napi::Array& items) {
  NSMutableArray* snapshot = [NSMutableArray arrayWithCapacity:items.Length()];

  for (uint32_t itemIndex = 0; itemIndex < items.Length(); ++itemIndex) {
    Napi::Value itemValue = items.Get(itemIndex);
    if (!itemValue.IsObject()) {
      continue;
    }

    Napi::Object itemObject = itemValue.As<Napi::Object>();
    Napi::Value typesValue = itemObject.Get("types");
    if (!typesValue.IsArray()) {
      continue;
    }

    Napi::Array typeArray = typesValue.As<Napi::Array>();
    NSMutableDictionary* itemSnapshot = [NSMutableDictionary dictionary];

    for (uint32_t typeIndex = 0; typeIndex < typeArray.Length(); ++typeIndex) {
      Napi::Value typeValue = typeArray.Get(typeIndex);
      if (!typeValue.IsObject()) {
        continue;
      }

      Napi::Object typeRecord = typeValue.As<Napi::Object>();
      Napi::Value rawType = typeRecord.Get("type");
      Napi::Value rawData = typeRecord.Get("data");
      if (!rawType.IsString() || !rawData.IsBuffer()) {
        continue;
      }

      std::string type = rawType.As<Napi::String>().Utf8Value();
      auto buffer = rawData.As<Napi::Buffer<uint8_t>>();
      NSData* data = [NSData dataWithBytes:buffer.Data() length:buffer.Length()];
      NSString* typeString = [NSString stringWithUTF8String:type.c_str()];
      if (!typeString) {
        continue;
      }
      itemSnapshot[typeString] = data;
    }

    [snapshot addObject:[itemSnapshot copy]];
  }

  return [snapshot copy];
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

std::string GetSelectedTextByClipboardFallback(AXUIElementRef app) {
  std::lock_guard<std::mutex> lock(gClipboardFallbackMutex);
  @autoreleasepool {
    __block NSInteger changeCountBefore = -1;
    __block NSArray* savedItems = nil;
    __block pid_t pid = -1;
    __block uint64_t inputGenerationBeforeCopy = 0;
    __block bool ready = false;

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
        NSLog(@"[selection_bridge] clipboard text changed, skip simulated key pre=%ld now=%ld",
              (long)gClipboardChangeCountOnMouseDown, (long)changeCountBefore);
        return;
      }

      if (PasteboardLooksSensitive(pb)) {
        NSLog(@"[selection_bridge] clipboard fallback blocked: concealed pasteboard");
        return;
      }

      savedItems = SavePasteboardItems();
      if (app) {
        AXUIElementGetPid(app, &pid);
      }

      NSPoint point = NSEqualPoints(gLastActionPoint, NSZeroPoint) ? [NSEvent mouseLocation]
                                                                   : gLastActionPoint;
      RaiseWindowAtPoint(pid, point);
      inputGenerationBeforeCopy = gUserInputGeneration.load(std::memory_order_relaxed);
      ready = true;
    });

    if (!ready) return "";

    const NSInteger expectedChangeCount = changeCountBefore;
    const uint64_t expectedInputGeneration = inputGenerationBeforeCopy;
    [NSThread sleepForTimeInterval:0.05];

    NSLog(@"[selection_bridge] Copy pasteboard item start pid=%d", pid);

    NSInteger changeCountAfterCopy = changeCountBefore;
    __block bool menuCopyTriggered = false;
    RunOnMainThreadSync(^{
      if (gUserInputGeneration.load(std::memory_order_relaxed) == expectedInputGeneration) {
        menuCopyTriggered = app && TriggerMenuCopy(app);
      }
    });

    auto waitForPasteboardChange = [&](int tries, NSInteger* after) {
      for (int i = 0; i < tries; i++) {
        if (gUserInputGeneration.load(std::memory_order_relaxed) != expectedInputGeneration) {
          return false;
        }
        [NSThread sleepForTimeInterval:0.02];
        if (gUserInputGeneration.load(std::memory_order_relaxed) != expectedInputGeneration) {
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

    bool copied =
        menuCopyTriggered && waitForPasteboardChange(6, &changeCountAfterCopy);

    if (!copied &&
        gUserInputGeneration.load(std::memory_order_relaxed) == expectedInputGeneration) {
      RunOnMainThreadSync(^{
        if (gUserInputGeneration.load(std::memory_order_relaxed) == expectedInputGeneration) {
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

      if (gUserInputGeneration.load(std::memory_order_relaxed) != expectedInputGeneration) {
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
        RestorePasteboardItems(savedItems);
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

bool CopyTopmostWindowAtPoint(NSPoint cocoaPoint, ScreenWindowHit* out) {
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

    if (!CGRectContainsPoint(bounds, quartzPoint) &&
        !CGRectContainsPoint(bounds, CGPointMake(cocoaPoint.x, cocoaPoint.y))) {
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

  // Distinguish text drag-selection from file/icon drag-and-drop using the
  // same selection signals that the snapshot path understands. Resolve the
  // element from the window under the pointer so a newly opened / second
  // window is not ignored just because AX still reports the previous window.
  AXUIElementRef focusedElem = nullptr;
  AXUIElementRef focusedApp = nullptr;
  std::string targetDebug;
  GetSelectionTarget(loc, &focusedApp, &focusedElem, &targetDebug);

  bool hasFocusedElem = false;
  bool hasSelection = false;
  std::string roleDebug;
  const bool nearFocusedWindowEdge = IsPointNearFocusedWindowEdge(loc);
  const NSInteger dragPasteboardChangeCount = GetDragPasteboardChangeCount();
  const bool hasFreshFileDragPayload =
      dragPasteboardChangeCount >= 0 &&
      gDragPasteboardChangeCountOnMouseDown >= 0 &&
      dragPasteboardChangeCount != gDragPasteboardChangeCountOnMouseDown &&
      DragPasteboardHasFilePayload();
  NSRunningApplication* frontApp = NSWorkspace.sharedWorkspace.frontmostApplication;
  NSString* frontBundleId = frontApp.bundleIdentifier ?: @"";

  if (focusedElem) {
    hasFocusedElem = true;
    roleDebug = GetAXRoleDebug(focusedElem);
    hasSelection = ElementHasSelection(focusedElem);
  }

  SelectionScene scene = SelectionScene::kNone;
  if (hasSelection) {
    scene = SelectionScene::kBoxSelect;
  } else if (AllowsLooseSelectionFallback(frontBundleId) &&
             !hasFreshFileDragPayload &&
             !nearFocusedWindowEdge) {
    // Some editors keep AX focus on an element that exposes no selected-range
    // metadata on mouseUp. Still allow the later snapshot + clipboard fallback
    // path to recover the selection text.
    scene = SelectionScene::kBoxSelect;
  } else if (BundleIdEquals(frontBundleId, "org.zotero.zotero") &&
             hasFocusedElem &&
             IsWindowRoleDebug(roleDebug) &&
             !hasFreshFileDragPayload &&
             !nearFocusedWindowEdge) {
    // Zotero can leave AX focus on the reader window itself on mouseUp even
    // when text is selected. Let the snapshot path recover the text via
    // clipboard fallback instead of dropping the gesture here.
    scene = SelectionScene::kBoxSelect;
  } else if (!hasFocusedElem && !hasFreshFileDragPayload && !nearFocusedWindowEdge) {
    // Some Chromium/native editors lose the focused AX element on mouseUp, but
    // the later snapshot/clipboard fallback can still recover selected text.
    scene = SelectionScene::kBoxSelect;
  }

  NSLog(@"[selection_bridge] drag mouseUp dist=%.2f bundle=%@ hasFocusedElem=%d role=%s hasSelection=%d nearFocusedWindowEdge=%d hasFreshFileDragPayload=%d dragPasteboardChangeCount=%ld mouseDownDragPasteboardChangeCount=%ld target=[%s] scene=%s",
        dist, frontBundleId, hasFocusedElem, roleDebug.c_str(), hasSelection, nearFocusedWindowEdge, hasFreshFileDragPayload,
        (long)dragPasteboardChangeCount, (long)gDragPasteboardChangeCountOnMouseDown, targetDebug.c_str(), SceneToString(scene));

  if (focusedElem) CFRelease(focusedElem);
  if (focusedApp) CFRelease(focusedApp);

  return scene;
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

  if (gActionTsfn) {
    gActionTsfn->Release();
    delete gActionTsfn;
    gActionTsfn = nullptr;
  }
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
  result.Set("targetDebug", "");

  if (!IsTrusted(false)) {
    result.Set("error", "accessibility_permission_denied");
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
    result.Set("sourceApp", ToStdString(appName));
    result.Set("sourceBundleId", ToStdString(bundleId));
    result.Set("sourceAppPid", (double)hit.pid);
  } else {
    result.Set("sourceApp", ToStdString(appName));
    result.Set("sourceBundleId", ToStdString(bundleId));
    result.Set("sourceAppPid", frontApp ? (double)frontApp.processIdentifier : -1.0);
  }

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
    NSLog(@"[selection_bridge] Try use AXAPI get user selected text attempt=%d", attempt);
    GetSelectionTarget(loc, &focusedApp, &focusedElem, &targetDebug);
    gotFocusedElement = focusedElem != nullptr;
    hasNonEmpty = focusedElem && HasNonEmptyRange(focusedElem);

    if (!focusedElem) {
      NSLog(@"[selection_bridge] AXAPI get user selected element failed, error = missing");
      continue;
    }

    if (GetAXSelectedText(focusedElem, &text) && !text.empty()) {
      result.Set("strategy", "ax_selected_text");
    } else if (GetTextByRange(focusedElem, &text) && !text.empty()) {
      result.Set("strategy", "ax_range_string");
    }

    if (text.empty()) {
      NSLog(@"[selection_bridge] AXAPI get user selected text empty, continue");
      continue;
    }

    CGRect selectionRect = CGRectNull;
    const bool hasRect = GetSelectionBounds(focusedElem, &selectionRect);
    if (hasRect && (selectionRect.size.width < 0.5 || selectionRect.size.height < 0.5)) {
      NSLog(@"[selection_bridge] selected text area has 0 width/height, invalid");
    }
    if (hasRect && !SelectionRectNearCursor(selectionRect, loc)) {
      NSLog(@"[selection_bridge] selected text area faraway from cursor, invalid");
      text.clear();
      continue;
    }

    NSLog(@"[selection_bridge] AXAPI get user selected text has result");
    FillRect(focusedElem, &result, env);
    break;
  }
  result.Set("targetDebug", targetDebug);

  if (text.empty() &&
      ShouldClipboardFallback(bundleId, scene, gotFocusedElement, hasNonEmpty)) {
    result.Set("needsClipboardFallback", true);
    pid_t pid = -1;
    if (focusedApp) {
      AXUIElementGetPid(focusedApp, &pid);
    }
    result.Set("fallbackAppPid", (double)pid);
  }

  std::string strategy = "none";
  if (result.Has("strategy") && result.Get("strategy").IsString()) {
    strategy = result.Get("strategy").As<Napi::String>().Utf8Value();
  }

  result.Set("text", text);
  NSLog(@"[selection_bridge] snapshot scene=%s app=%@ bundle=%@ focused=%d hasNonEmpty=%d textLen=%lu strategy=%s fallback=%d hasRect=%d target=[%s]",
        SceneToString(scene),
        appName,
        bundleId,
        gotFocusedElement,
        hasNonEmpty,
        (unsigned long)text.size(),
        strategy.c_str(),
        result.Has("needsClipboardFallback"),
        result.Get("hasRect").As<Napi::Boolean>().Value(),
        targetDebug.c_str());
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
    RunOnMainThreadSync(^{
      @autoreleasepool {
        AXUIElementRef app = nullptr;
        if (useMenu_ && appPid_ > 0) {
          app = AXUIElementCreateApplication(appPid_);
        }

        NSString* expected = expectedText_.empty() ? nil : @(expectedText_.c_str());
        copied_ = CopySelection(useMenu_, app, expected);

        if (app) CFRelease(app);
      }
    });
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

class RecognizeTextInImageWorker : public Napi::AsyncWorker {
public:
  RecognizeTextInImageWorker(Napi::Promise::Deferred deferred, std::string imagePath)
    : Napi::AsyncWorker(deferred.Env()),
      deferred_(deferred),
      imagePath_(std::move(imagePath)) {}

  void Execute() override {
    if (!RecognizeTextFromImagePath(imagePath_, &recognizedText_, &errorMessage_)) {
      if (errorMessage_.empty()) {
        errorMessage_ = "ocr_failed";
      }
      SetError(errorMessage_);
    }
  }

  void OnOK() override {
    deferred_.Resolve(Napi::String::New(Env(), recognizedText_));
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

private:
  Napi::Promise::Deferred deferred_;
  std::string imagePath_;
  std::string recognizedText_;
  std::string errorMessage_;
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

Napi::Value RecognizeTextInImageAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "imagePath required").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker =
      new RecognizeTextInImageWorker(deferred, info[0].As<Napi::String>().Utf8Value());
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
      InstallUserInputKeyMonitorLocked();
      ok = gUserInputKeyMonitor != nil;
      return;
    }

    auto tsfn = Napi::ThreadSafeFunction::New(env, cb, "ActionMonitor", 0, 1);
    gActionTsfn = new Napi::ThreadSafeFunction(std::move(tsfn));
    InstallUserInputKeyMonitorLocked();

    gGlobalMouseMonitor = [NSEvent
        addGlobalMonitorForEventsMatchingMask:
            (NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown |
             NSEventMaskRightMouseUp | NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged |
             NSEventMaskRightMouseDragged | NSEventMaskScrollWheel | NSEventMaskOtherMouseDown |
             NSEventMaskOtherMouseUp | NSEventMaskOtherMouseDragged |
             NSEventMaskCursorUpdate)
                                   handler:^(NSEvent* event) {
      if (event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown ||
          event.type == NSEventTypeOtherMouseDown) {
        gUserInputGeneration.fetch_add(1, std::memory_order_relaxed);
      }

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
        NSPoint loc = [NSEvent mouseLocation];
        const bool insideBubble = IsPointInsideBubbleWindow(loc);
        if (insideBubble) {
          return;
        }

        const bool precise = [event hasPreciseScrollingDeltas];
        const NSEventPhase phase = [event phase];
        const double dx = std::abs([event scrollingDeltaX]);
        const double dy = std::abs([event scrollingDeltaY]);
        if (precise &&
            (phase == NSEventPhaseBegan || phase == NSEventPhaseChanged) &&
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
          return;
        }

        gLeftMouseDownOnBubble = false;
        gIsLeftMouseDown = true;
        gMouseDownPoint = loc;
        gDragPasteboardChangeCountOnMouseDown = GetDragPasteboardChangeCount();
        NSPasteboard* generalPasteboard = [NSPasteboard generalPasteboard];
        gClipboardChangeCountOnMouseDown = generalPasteboard ? generalPasteboard.changeCount : -1;
        // Dismiss as soon as the pointer goes down outside our surfaces.
        // Waiting for mouseUp made click-to-dismiss feel unresponsive.
        EmitAction(SelectionScene::kNone, loc);
        return;
      }

      if (event.type == NSEventTypeLeftMouseUp) {
        if (gLeftMouseDownOnBubble) {
          gLeftMouseDownOnBubble = false;
          gIsLeftMouseDown = false;
          return;
        }

        NSPoint loc = [NSEvent mouseLocation];
        gLastActionPoint = loc;
        SelectionScene scene = DetectMouseUpScene(event, loc);
        gIsLeftMouseDown = false;
        gDragPasteboardChangeCountOnMouseDown = -1;
        EmitAction(scene, loc);

        return;
      }
    }];

    NSNotificationCenter* workspaceNC = [NSWorkspace.sharedWorkspace notificationCenter];
    gActiveSpaceObserver = [workspaceNC
        addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification
                    object:nil
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(__unused NSNotification*) {
      EmitAction(SelectionScene::kAppFocusDismiss, [NSEvent mouseLocation]);
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
      EmitAction(SelectionScene::kAppFocusDismiss, [NSEvent mouseLocation]);
    }];

    gAppDeactivatedObserver = [workspaceNC
        addObserverForName:NSWorkspaceDidDeactivateApplicationNotification
                    object:nil
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(__unused NSNotification*) {
      EmitAction(SelectionScene::kAppFocusDismiss, [NSEvent mouseLocation]);
    }];

    StartWindowObserver();

    if (!gGlobalMouseMonitor || !gUserInputKeyMonitor) {
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

Napi::Value SetKeyMonitorEnabled(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const bool enabled =
      info.Length() >= 1 && info[0].IsBoolean() && info[0].As<Napi::Boolean>().Value();
  bool ok = false;

  auto task = [&]() {
    std::lock_guard<std::mutex> lock(gMonitorMutex);
    if (!gActionTsfn) {
      ok = false;
      return;
    }

    if (enabled) {
      InstallKeyMonitorLocked();
    } else {
      RemoveKeyMonitorLocked();
    }

    ok = enabled ? (gGlobalKeyMonitor != nil && gLocalKeyMonitor != nil)
                 : (gGlobalKeyMonitor == nil && gLocalKeyMonitor == nil);
  };

  if ([NSThread isMainThread]) {
    task();
  } else {
    dispatch_sync(dispatch_get_main_queue(), task);
  }

  return Napi::Boolean::New(env, ok);
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

Napi::Value GetClipboardChangeCount(const Napi::CallbackInfo& info) {
  NSPasteboard* pb = [NSPasteboard generalPasteboard];
  return Napi::Number::New(info.Env(), pb ? pb.changeCount : -1);
}

Napi::Value GetClipboardSnapshot(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSArray* snapshot = SavePasteboardItems();
  return ClipboardSnapshotToNapi(env, snapshot);
}

Napi::Value RestoreClipboardSnapshotValue(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    return Napi::Boolean::New(env, false);
  }

  NSArray* snapshot = ClipboardSnapshotFromNapi(info[0].As<Napi::Array>());
  RestorePasteboardItems(snapshot);
  return Napi::Boolean::New(env, true);
}

Napi::Value ActivateAppAndPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    return Napi::Boolean::New(env, false);
  }

  pid_t pid = info[0].As<Napi::Number>().Int32Value();
  if (pid <= 0) {
    return Napi::Boolean::New(env, false);
  }

  __block BOOL activated = NO;
  auto task = ^{
    NSRunningApplication* target = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    if (!target) {
      activated = NO;
      return;
    }

    activated = [target activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    if (!activated) {
      return;
    }

    [NSThread sleepForTimeInterval:0.14];
    PostCmdV();
  };

  if ([NSThread isMainThread]) {
    task();
  } else {
    dispatch_sync(dispatch_get_main_queue(), task);
  }

  return Napi::Boolean::New(env, activated);
}

Napi::Value CaptureFrontmostWindowImage(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  pid_t requestedPid = -1;
  if (info.Length() >= 1 && info[0].IsNumber()) {
    requestedPid = info[0].As<Napi::Number>().Int32Value();
  }

  CGImageRef image = CopyFrontmostWindowImageByPid(requestedPid);
  if (!image) {
    return env.Null();
  }

  Napi::Value result = env.Null();
  @autoreleasepool {
    NSBitmapImageRep* bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
    NSData* pngData = [bitmap representationUsingType:NSBitmapImageFileTypePNG
                                           properties:@{}];
    if (pngData && pngData.length > 0) {
      result = Napi::Buffer<uint8_t>::Copy(
          env, static_cast<const uint8_t*>(pngData.bytes), pngData.length);
    }
    [bitmap release];
  }
  CGImageRelease(image);

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
  gBubbleWindowNumbers.insert(nsWindow.windowNumber);

  [nsWindow setIgnoresMouseEvents:NO];
  [nsWindow setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
                                 NSWindowCollectionBehaviorFullScreenAuxiliary |
                                 NSWindowCollectionBehaviorStationary];
  [nsWindow setLevel:NSPopUpMenuWindowLevel];
  NSLog(@"[selection_bridge] configureBubbleWindow class=%@ windowNumber=%ld ignoresMouse=%d styleMask=0x%lx level=%ld",
        NSStringFromClass([nsWindow class]),
        (long)nsWindow.windowNumber,
        [nsWindow ignoresMouseEvents],
        (unsigned long)[nsWindow styleMask],
        (long)[nsWindow level]);

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

  [nsWindow setIgnoresMouseEvents:NO];
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
  exports.Set("captureFrontmostWindowImage", Napi::Function::New(env, CaptureFrontmostWindowImage));
  exports.Set("recognizeTextInImageAsync", Napi::Function::New(env, RecognizeTextInImageAsync));
  exports.Set("startActionMonitor", Napi::Function::New(env, StartActionMonitor));
  exports.Set("stopActionMonitor", Napi::Function::New(env, StopActionMonitor));
  exports.Set("setKeyMonitorEnabled", Napi::Function::New(env, SetKeyMonitorEnabled));
  exports.Set("getCursorPosition", Napi::Function::New(env, GetCursorPosition));
  exports.Set("getFrontmostAppInfo", Napi::Function::New(env, GetFrontmostAppInfo));
  exports.Set("getClipboardChangeCount", Napi::Function::New(env, GetClipboardChangeCount));
  exports.Set("getClipboardSnapshot", Napi::Function::New(env, GetClipboardSnapshot));
  exports.Set("restoreClipboardSnapshot", Napi::Function::New(env, RestoreClipboardSnapshotValue));
  exports.Set("activateAppAndPaste", Napi::Function::New(env, ActivateAppAndPaste));
  exports.Set("configureBubbleWindow", Napi::Function::New(env, ConfigureBubbleWindow));
  exports.Set("orderBubbleFront", Napi::Function::New(env, OrderBubbleFront));
  exports.Set("setActivationPolicy", Napi::Function::New(env, SetActivationPolicy));
  env.AddCleanupHook([]() { RemoveMonitors(); });
  return exports;
}

}  // namespace

NODE_API_MODULE(selection_bridge, Init)
