#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <QuartzCore/QuartzCore.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>

static const void *TokenUsageGlassKey = &TokenUsageGlassKey;
#define TOKEN_USAGE_SAMPLE_SIZE 40

// Use runtime discovery to retain compatibility with SDKs before macOS 26.
@interface TokenUsageGlassEffectView : NSView
@property(nullable, strong) NSView *contentView;
@property CGFloat cornerRadius;
@property NSInteger style;
@property(nullable, copy) NSColor *tintColor;
@end

static bool token_usage_apply_liquid_glass_impl(void *view_pointer,
                                                double corner_radius,
                                                double glass_level) {
  Class glass_class = NSClassFromString(@"NSGlassEffectView");
  if (glass_class == Nil || view_pointer == NULL) {
    return false;
  }
  NSView *content = (__bridge NSView *)view_pointer;
  NSWindow *window = content.window;
  if (window == nil) {
    return false;
  }

  TokenUsageGlassEffectView *glass =
      objc_getAssociatedObject(window, TokenUsageGlassKey);
  if (glass != nil && window.contentView != glass) {
    objc_setAssociatedObject(window, TokenUsageGlassKey, nil,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    glass = nil;
  }
  if (glass == nil) {
    NSView *window_content = window.contentView;
    if (window_content == nil) {
      return false;
    }
    glass = (TokenUsageGlassEffectView *)[[glass_class alloc]
        initWithFrame:window_content.bounds];
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    window_content.frame = glass.bounds;
    window_content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    // Only contentView is guaranteed to be embedded inside the glass material.
    glass.contentView = window_content;
    window.contentView = glass;
    objc_setAssociatedObject(window, TokenUsageGlassKey, glass,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }

  // Regular glass provides the native legibility treatment without requiring
  // screen capture permission. Do not alpha-blend two glass effects.
  glass.style = 0; // NSGlassEffectViewStyleRegular
  glass.alphaValue = 1.0;
  glass.hidden = NO;
  glass.tintColor = nil;
  glass.cornerRadius = corner_radius;
  glass.wantsLayer = YES;
  glass.layer.cornerRadius = corner_radius;
  glass.layer.cornerCurve = kCACornerCurveContinuous;
  glass.layer.masksToBounds = YES;
  content.wantsLayer = YES;
  content.layer.backgroundColor = NSColor.clearColor.CGColor;
  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  window.hasShadow = NO;
  (void)glass_level; // Preserve the legacy call contract; material is standard.
  return true;
}

static bool token_usage_sync_surface_tone_impl(void *view_pointer, bool dark) {
  if (view_pointer == NULL) return false;
  NSView *content = (__bridge NSView *)view_pointer;
  NSWindow *window = content.window;
  if (window == nil) return false;
  TokenUsageGlassEffectView *glass =
      objc_getAssociatedObject(window, TokenUsageGlassKey);
  // Keep the system appearance independent from the optional backdrop tone.
  // Otherwise forcing the window dark also changes WKWebView matchMedia and
  // the permission-denied fallback can get stuck on that sampled appearance.
  window.appearance = nil;
  content.appearance = NSApp.effectiveAppearance;
  glass.appearance = [NSAppearance appearanceNamed:
      dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
  return glass != nil && window.contentView == glass &&
      glass.contentView != nil &&
      !workspace.accessibilityDisplayShouldReduceTransparency &&
      !workspace.accessibilityDisplayShouldIncreaseContrast;
}

bool token_usage_sync_surface_tone(void *view_pointer, bool dark) {
  if ([NSThread isMainThread]) {
    return token_usage_sync_surface_tone_impl(view_pointer, dark);
  }
  __block bool ready = false;
  dispatch_sync(dispatch_get_main_queue(), ^{
    ready = token_usage_sync_surface_tone_impl(view_pointer, dark);
  });
  return ready;
}

bool token_usage_apply_liquid_glass(void *view_pointer,
                                    double corner_radius,
                                    double glass_level) {
  if ([NSThread isMainThread]) {
    return token_usage_apply_liquid_glass_impl(view_pointer, corner_radius,
                                               glass_level);
  }

  __block bool applied = false;
  dispatch_sync(dispatch_get_main_queue(), ^{
    applied = token_usage_apply_liquid_glass_impl(
        view_pointer, corner_radius, glass_level);
  });
  return applied;
}

static void token_usage_apply_fallback_tint_impl(void *view_pointer,
                                                 double glass_level) {
  NSView *content = (__bridge NSView *)view_pointer;
  CGFloat level = MAX(0.0, MIN(1.0, glass_level));
  CGFloat tint_alpha = level * 0.085;
  content.wantsLayer = YES;
  content.layer.backgroundColor =
      [NSColor colorWithWhite:0.76 alpha:tint_alpha].CGColor;
  content.layer.borderWidth = 0;
  content.layer.borderColor = NSColor.clearColor.CGColor;
}

void token_usage_apply_fallback_tint(void *view_pointer,
                                     double glass_level) {
  if ([NSThread isMainThread]) {
    token_usage_apply_fallback_tint_impl(view_pointer, glass_level);
    return;
  }

  dispatch_sync(dispatch_get_main_queue(), ^{
    token_usage_apply_fallback_tint_impl(view_pointer, glass_level);
  });
}

static double token_usage_sample_backdrop_luminance_impl(void *view_pointer) {
  // Preflight only: never prompt, even if a caller bypasses the frontend gate.
  if (view_pointer == NULL || !CGPreflightScreenCaptureAccess()) {
    return -1.0;
  }
  NSView *content = (__bridge NSView *)view_pointer;
  NSWindow *window = content.window;
  NSScreen *screen = window.screen ?: NSScreen.mainScreen;
  if (window == nil || screen == nil || !window.isVisible) {
    return -1.0;
  }

  NSNumber *screen_number = screen.deviceDescription[@"NSScreenNumber"];
  CGDirectDisplayID display_id = screen_number.unsignedIntValue;
  if (display_id == 0) {
    display_id = CGMainDisplayID();
  }

  // AppKit uses a bottom-left origin while Quartz window-list rectangles use
  // a top-left origin. Convert the window frame within its current display.
  NSRect window_frame = window.frame;
  NSRect screen_frame = screen.frame;
  CGRect display_bounds = CGDisplayBounds(display_id);
  CGRect capture_rect = CGRectMake(
      display_bounds.origin.x + (window_frame.origin.x - screen_frame.origin.x),
      display_bounds.origin.y + (NSMaxY(screen_frame) - NSMaxY(window_frame)),
      window_frame.size.width,
      window_frame.size.height);
  if (capture_rect.size.width < 2.0 || capture_rect.size.height < 2.0) {
    return -1.0;
  }

  CGWindowImageOption image_options =
      kCGWindowImageBoundsIgnoreFraming | kCGWindowImageNominalResolution;
  CGImageRef image = CGWindowListCreateImage(
      capture_rect, kCGWindowListOptionOnScreenBelowWindow,
      (CGWindowID)window.windowNumber, image_options);
  if (image == nil) {
    return -1.0;
  }

  const size_t sample_size = TOKEN_USAGE_SAMPLE_SIZE;
  const size_t bytes_per_row = sample_size * 4;
  uint8_t pixels[TOKEN_USAGE_SAMPLE_SIZE * TOKEN_USAGE_SAMPLE_SIZE * 4];
  CGColorSpaceRef color_space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
      pixels, sample_size, sample_size, 8, bytes_per_row, color_space,
      kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(color_space);
  if (context == nil) {
    CGImageRelease(image);
    return -1.0;
  }

  CGContextSetBlendMode(context, kCGBlendModeCopy);
  CGContextDrawImage(context,
                     CGRectMake(0.0, 0.0, sample_size, sample_size), image);
  CGContextRelease(context);
  CGImageRelease(image);

  double luminance_sum = 0.0;
  size_t sample_count = 0;
  for (size_t index = 0; index < sample_size * sample_size; index += 2) {
    const uint8_t *pixel = pixels + index * 4;
    const double alpha = (double)pixel[3] / 255.0;
    if (alpha < 0.05) {
      continue;
    }
    const double red = (double)pixel[0] / 255.0;
    const double green = (double)pixel[1] / 255.0;
    const double blue = (double)pixel[2] / 255.0;
    luminance_sum += (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    sample_count += 1;
  }
  return sample_count == 0 ? -1.0 : luminance_sum / (double)sample_count;
}

double token_usage_sample_backdrop_luminance(void *view_pointer) {
  if ([NSThread isMainThread]) {
    return token_usage_sample_backdrop_luminance_impl(view_pointer);
  }

  __block double luminance = -1.0;
  dispatch_sync(dispatch_get_main_queue(), ^{
    luminance = token_usage_sample_backdrop_luminance_impl(view_pointer);
  });
  return luminance;
}

bool token_usage_screen_capture_allowed(void) {
  if (@available(macOS 10.15, *)) {
    return CGPreflightScreenCaptureAccess();
  }
  return true;
}
