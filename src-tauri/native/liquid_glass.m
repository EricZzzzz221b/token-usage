#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>

static const void *TokenUsageGlassKey = &TokenUsageGlassKey;
static const void *TokenUsageGlassHostKey = &TokenUsageGlassHostKey;
static const CGFloat TokenUsageGlassOverscan = 3.0;

// Compile against older macOS SDKs used by CI while resolving the macOS 26
// implementation dynamically at runtime.
@interface TokenUsageGlassEffectView : NSView
@property(nullable, strong) NSView *contentView;
@property CGFloat cornerRadius;
@property NSInteger style;
@property(nullable, copy) NSColor *tintColor;
@end

static bool token_usage_apply_liquid_glass_impl(void *view_pointer,
                                                int style,
                                                double corner_radius,
                                                double opacity) {
  Class glass_class = NSClassFromString(@"NSGlassEffectView");
  if (glass_class != Nil) {
    NSView *content = (__bridge NSView *)view_pointer;
    NSWindow *window = content.window;
    if (window == nil) {
      return false;
    }

    TokenUsageGlassEffectView *glass =
        objc_getAssociatedObject(window, TokenUsageGlassKey);
    NSView *host = objc_getAssociatedObject(window, TokenUsageGlassHostKey);
    if (glass != nil &&
        (host == nil || window.contentView != host || glass.superview != host)) {
      objc_setAssociatedObject(window, TokenUsageGlassKey, nil,
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      objc_setAssociatedObject(window, TokenUsageGlassHostKey, nil,
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      glass = nil;
      host = nil;
    }
    if (glass == nil) {
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

      NSRect glass_frame = NSInsetRect(host.bounds, -TokenUsageGlassOverscan,
                                      -TokenUsageGlassOverscan);
      glass =
          (TokenUsageGlassEffectView *)[[glass_class alloc] initWithFrame:glass_frame];
      glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

      NSView *content_host = [[NSView alloc] initWithFrame:glass.bounds];
      content_host.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      content_host.wantsLayer = YES;
      content_host.layer.backgroundColor = NSColor.clearColor.CGColor;
      window_content.frame = NSInsetRect(content_host.bounds,
                                         TokenUsageGlassOverscan,
                                         TokenUsageGlassOverscan);
      window_content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [content_host addSubview:window_content];
      glass.contentView = content_host;
      [host addSubview:glass];
      window.contentView = host;

      objc_setAssociatedObject(window, TokenUsageGlassKey, glass,
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      objc_setAssociatedObject(window, TokenUsageGlassHostKey, host,
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    if (host == nil) {
      return false;
    }

    glass.frame = NSInsetRect(host.bounds, -TokenUsageGlassOverscan,
                             -TokenUsageGlassOverscan);
    glass.cornerRadius = corner_radius + TokenUsageGlassOverscan;
    // NSGlassEffectView.Style: regular = 0, clear = 1.
    glass.style = style == 0 ? 1 : 0;

    CGFloat normalized = MAX(0.0, MIN(1.0, (opacity - 0.55) / 0.45));
    CGFloat tint_alpha = style == 0 ? normalized * 0.045
                                    : 0.025 + normalized * 0.095;
    glass.tintColor = tint_alpha > 0.001
                          ? [NSColor colorWithWhite:0.72 alpha:tint_alpha]
                          : nil;

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

  return false;
}

bool token_usage_apply_liquid_glass(void *view_pointer,
                                    int style,
                                    double corner_radius,
                                    double opacity) {
  if ([NSThread isMainThread]) {
    return token_usage_apply_liquid_glass_impl(view_pointer, style,
                                               corner_radius, opacity);
  }

  __block bool applied = false;
  dispatch_sync(dispatch_get_main_queue(), ^{
    applied = token_usage_apply_liquid_glass_impl(
        view_pointer, style, corner_radius, opacity);
  });
  return applied;
}

static void token_usage_apply_fallback_tint_impl(void *view_pointer,
                                                 int style,
                                                 double opacity) {
  NSView *content = (__bridge NSView *)view_pointer;
  CGFloat normalized = MAX(0.0, MIN(1.0, (opacity - 0.55) / 0.45));
  CGFloat tint_alpha = style == 0 ? normalized * 0.025
                                  : 0.018 + normalized * 0.07;
  content.wantsLayer = YES;
  content.layer.backgroundColor =
      [NSColor colorWithWhite:style == 0 ? 0.86 : 0.72
                        alpha:tint_alpha]
          .CGColor;
  content.layer.borderWidth = 0;
  content.layer.borderColor = NSColor.clearColor.CGColor;
}

void token_usage_apply_fallback_tint(void *view_pointer,
                                     int style,
                                     double opacity) {
  if ([NSThread isMainThread]) {
    token_usage_apply_fallback_tint_impl(view_pointer, style, opacity);
    return;
  }

  dispatch_sync(dispatch_get_main_queue(), ^{
    token_usage_apply_fallback_tint_impl(view_pointer, style, opacity);
  });
}
