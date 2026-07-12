#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>

static const void *TokenUsageClearGlassKey = &TokenUsageClearGlassKey;
static const void *TokenUsageStandardGlassKey = &TokenUsageStandardGlassKey;
static const void *TokenUsageGlassHostKey = &TokenUsageGlassHostKey;
// The clear lens sits close enough to the clipping host for the native corner
// reflections to remain visible. The standard fill is pushed farther outside
// so changing blur strength cannot alter the visible edge treatment.
static const CGFloat TokenUsageLensOverscan = 1.5;
static const CGFloat TokenUsageFillOverscan = 6.0;

// Compile against older macOS SDKs used by CI while resolving the macOS 26
// implementation dynamically at runtime.
@interface TokenUsageGlassEffectView : NSView
@property CGFloat cornerRadius;
@property NSInteger style;
@property(nullable, copy) NSColor *tintColor;
@end

static bool token_usage_apply_liquid_glass_impl(void *view_pointer,
                                                double corner_radius,
                                                double glass_level) {
  Class glass_class = NSClassFromString(@"NSGlassEffectView");
  if (glass_class == Nil) {
    return false;
  }

  NSView *content = (__bridge NSView *)view_pointer;
  NSWindow *window = content.window;
  if (window == nil) {
    return false;
  }

  TokenUsageGlassEffectView *clear_glass =
      objc_getAssociatedObject(window, TokenUsageClearGlassKey);
  TokenUsageGlassEffectView *standard_glass =
      objc_getAssociatedObject(window, TokenUsageStandardGlassKey);
  NSView *host = objc_getAssociatedObject(window, TokenUsageGlassHostKey);
  if (clear_glass != nil &&
      (standard_glass == nil || host == nil || window.contentView != host ||
       clear_glass.superview != host || standard_glass.superview != host)) {
    objc_setAssociatedObject(window, TokenUsageClearGlassKey, nil,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, TokenUsageStandardGlassKey, nil,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, TokenUsageGlassHostKey, nil,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    clear_glass = nil;
    standard_glass = nil;
    host = nil;
  }

  if (clear_glass == nil) {
    NSView *window_content = window.contentView;
    if (window_content == nil) {
      return false;
    }

    host = [[NSView alloc] initWithFrame:window_content.bounds];
    host.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    host.wantsLayer = YES;
    host.layer.backgroundColor = NSColor.clearColor.CGColor;
    host.layer.masksToBounds = YES;
    host.layer.allowsEdgeAntialiasing = NO;

    NSRect clear_frame = NSInsetRect(host.bounds, -TokenUsageLensOverscan,
                                    -TokenUsageLensOverscan);
    NSRect standard_frame = NSInsetRect(host.bounds, -TokenUsageFillOverscan,
                                       -TokenUsageFillOverscan);
    clear_glass =
        (TokenUsageGlassEffectView *)[[glass_class alloc] initWithFrame:clear_frame];
    standard_glass =
        (TokenUsageGlassEffectView *)[[glass_class alloc] initWithFrame:standard_frame];
    clear_glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    standard_glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    // NSGlassEffectView.Style: regular = 0, clear = 1.
    clear_glass.style = 1;
    standard_glass.style = 0;

    NSView *content_host = [[NSView alloc] initWithFrame:host.bounds];
    content_host.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    content_host.wantsLayer = YES;
    content_host.layer.backgroundColor = NSColor.clearColor.CGColor;
    window_content.frame = content_host.bounds;
    window_content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [content_host addSubview:window_content];

    [host addSubview:standard_glass];
    [host addSubview:clear_glass];
    [host addSubview:content_host];
    window.contentView = host;

    objc_setAssociatedObject(window, TokenUsageClearGlassKey, clear_glass,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, TokenUsageStandardGlassKey, standard_glass,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, TokenUsageGlassHostKey, host,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }

  if (host == nil || standard_glass == nil) {
    return false;
  }

  clear_glass.frame = NSInsetRect(host.bounds, -TokenUsageLensOverscan,
                                  -TokenUsageLensOverscan);
  standard_glass.frame = NSInsetRect(host.bounds, -TokenUsageFillOverscan,
                                     -TokenUsageFillOverscan);
  clear_glass.cornerRadius = corner_radius + TokenUsageLensOverscan;
  standard_glass.cornerRadius = corner_radius + TokenUsageFillOverscan;

  CGFloat level = MAX(0.0, MIN(1.0, glass_level));
  // Keep the lens geometry constant without letting the active-window
  // highlight stack into an overly bright white surface.
  clear_glass.alphaValue = 0.58;
  standard_glass.alphaValue = level * 0.48;
  clear_glass.hidden = NO;
  standard_glass.hidden = level <= 0.001;
  clear_glass.tintColor =
      [NSColor colorWithWhite:0.35 alpha:0.025];
  standard_glass.tintColor =
      [NSColor colorWithWhite:0.32 alpha:0.04];

  host.layer.cornerRadius = corner_radius;
  host.layer.cornerCurve = kCACornerCurveContinuous;
  host.layer.borderWidth = 0;
  host.layer.borderColor = NSColor.clearColor.CGColor;
  host.layer.allowsEdgeAntialiasing = NO;
  content.wantsLayer = YES;
  content.layer.backgroundColor = NSColor.clearColor.CGColor;

  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  window.hasShadow = NO;
  return true;
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
  CGFloat tint_alpha = 0.006 + level * 0.025;
  content.wantsLayer = YES;
  content.layer.backgroundColor =
      [NSColor colorWithWhite:0.38 alpha:tint_alpha].CGColor;
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
