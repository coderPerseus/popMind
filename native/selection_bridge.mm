#include <napi.h>

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <Vision/Vision.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <mutex>
#include <string>
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
id gGlobalKeyMonitor = nil;
id gActiveSpaceObserver = nil;
id gAppActivatedObserver = nil;
id gAppDeactivatedObserver = nil;
AXObserverRef gFocusedWindowObserver = nullptr;
AXUIElementRef gObservedApp = nullptr;
Napi::ThreadSafeFunction* gActionTsfn = nullptr;
std::mutex gMonitorMutex;
std::unordered_set<NSInteger> gBubbleWindowNumbers;

bool gIsLeftMouseDown = false;
bool gLeftMouseDownOnBubble = false;
NSPoint gMouseDownPoint = NSZeroPoint;
NSInteger gDragPasteboardChangeCountOnMouseDown = -1;


static constexpr double kScrollGestureDeltaThreshold = 4.0;
static constexpr double kDragThreshold = 3.0;

std::string ToStdString(NSString* value) {
  if (value == nil) return "";
  const char* utf8 = [value UTF8String];
  return utf8 ? std::string(utf8) : "";
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

void PostKeyboardEvent(CGEventSourceRef source, CGKeyCode keyCode, bool isKeyDown,
                       CGEventFlags flags) {
  CGEventRef event = CGEventCreateKeyboardEvent(source, keyCode, isKeyDown);
  if (!event) return;

  CGEventSetFlags(event, flags);
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
}

void PostCmdC() {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  if (!source) return;

  const CGEventFlags commandFlags = kCGEventFlagMaskCommand;
  PostKeyboardEvent(source, kVK_Command, true, commandFlags);
  PostKeyboardEvent(source, kVK_ANSI_C, true, commandFlags);
  PostKeyboardEvent(source, kVK_ANSI_C, false, commandFlags);
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

std::string GetTextByClipboard(bool useMenu, AXUIElementRef app) {
  @autoreleasepool {
    NSPasteboard* pb = [NSPasteboard generalPasteboard];
    NSArray* savedItems = SavePasteboardItems();
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
      RestorePasteboardItems(savedItems);
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

bool HasTextSelectionForDrag(AXUIElementRef focusedElem) {
  if (!focusedElem) return false;
  if (HasNonEmptyRange(focusedElem)) return true;

  std::string text;
  if (GetAXSelectedText(focusedElem, &text) && !text.empty()) {
    return true;
  }

  return GetTextByRange(focusedElem, &text) && !text.empty();
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
  // same selection signals that the snapshot path understands.
  AXUIElementRef sysWide = AXUIElementCreateSystemWide();
  AXUIElementRef focusedElem = nullptr;
  AXUIElementRef focusedApp = nullptr;
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

  if (sysWide) {
    AXUIElementCopyAttributeValue(sysWide, kAXFocusedApplicationAttribute, (CFTypeRef*)&focusedApp);
    if (focusedApp) {
      AXUIElementCopyAttributeValue(focusedApp, kAXFocusedUIElementAttribute, (CFTypeRef*)&focusedElem);
    }
    CFRelease(sysWide);
  }

  if (focusedElem) {
    hasFocusedElem = true;
    roleDebug = GetAXRoleDebug(focusedElem);
    const bool editable = GetAXBoolAttr(focusedElem, CFSTR("AXEditable"), false);
    hasSelection = HasTextSelectionForDrag(focusedElem);
    NSLog(@"[selection_bridge] drag focused role=%s editable=%d", roleDebug.c_str(), editable);
    CFRelease(focusedElem);
  }
  if (focusedApp) CFRelease(focusedApp);

  SelectionScene scene = SelectionScene::kNone;
  if (hasSelection) {
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

  NSLog(@"[selection_bridge] drag mouseUp dist=%.2f bundle=%@ hasFocusedElem=%d role=%s hasSelection=%d nearFocusedWindowEdge=%d hasFreshFileDragPayload=%d dragPasteboardChangeCount=%ld mouseDownDragPasteboardChangeCount=%ld scene=%s",
        dist, frontBundleId, hasFocusedElem, roleDebug.c_str(), hasSelection, nearFocusedWindowEdge, hasFreshFileDragPayload,
        (long)dragPasteboardChangeCount, (long)gDragPasteboardChangeCountOnMouseDown, SceneToString(scene));

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

  std::string strategy = "none";
  if (result.Has("strategy") && result.Get("strategy").IsString()) {
    strategy = result.Get("strategy").As<Napi::String>().Utf8Value();
  }

  result.Set("text", text);
  NSLog(@"[selection_bridge] snapshot scene=%s app=%@ bundle=%@ focused=%d hasNonEmpty=%d textLen=%lu strategy=%s fallback=%d hasRect=%d",
        SceneToString(scene),
        appName,
        bundleId,
        gotFocusedElement,
        hasNonEmpty,
        (unsigned long)text.size(),
        strategy.c_str(),
        result.Has("needsClipboardFallback"),
        result.Get("hasRect").As<Napi::Boolean>().Value());
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
        gDragPasteboardChangeCountOnMouseDown = -1;
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
  exports.Set("recognizeTextInImageAsync", Napi::Function::New(env, RecognizeTextInImageAsync));
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
