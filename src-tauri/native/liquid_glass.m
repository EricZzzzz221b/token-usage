#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>

static const void *TokenUsageGlassKey = &TokenUsageGlassKey;

// Compile against older macOS deployment targets while resolving the macOS 26
// implementation dynamically at runtime.
@interface TokenUsageGlassEffectView : NSView
@property(nullable, strong) __kindof NSView *contentView;
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

  NSView *webview = (__bridge NSView *)view_pointer;
  NSWindow *window = webview.window;
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

    glass =
        (TokenUsageGlassEffectView *)[[glass_class alloc] initWithFrame:window_content.bounds];
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    glass.wantsLayer = YES;
    glass.layer.masksToBounds = YES;
    glass.layer.allowsEdgeAntialiasing = NO;

    window_content.frame = glass.bounds;
    window_content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

    // Apple explicitly requires custom content to be assigned through
    // contentView. Placing glass behind the WebView as a sibling prevents the
    // adaptive appearance and legibility treatment from reaching web content.
    glass.contentView = window_content;
    window.contentView = glass;

    objc_setAssociatedObject(window, TokenUsageGlassKey, glass,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }

  CGFloat level = MAX(0.0, MIN(1.0, glass_level));
  // NSGlassEffectView exposes two semantic styles rather than a continuous
  // strength value. Keep the slider useful by choosing the nearest style and
  // continuously varying only the neutral tint.
  glass.style = level < 0.5 ? 1 : 0; // clear = 1, regular = 0
  glass.tintColor =
      [NSColor colorWithWhite:0.78 alpha:0.008 + level * 0.105];
  glass.cornerRadius = corner_radius;
  glass.layer.cornerRadius = corner_radius;
  glass.layer.cornerCurve = kCACornerCurveContinuous;
  glass.layer.borderWidth = 0;
  glass.layer.borderColor = NSColor.clearColor.CGColor;

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

static bool token_usage_appearance_is_dark(NSAppearance *appearance) {
  if (appearance == nil) {
    return false;
  }
  NSAppearanceName match = [appearance
      bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua,
                                           NSAppearanceNameDarkAqua,
                                           NSAppearanceNameVibrantLight,
                                           NSAppearanceNameVibrantDark ]];
  return [match isEqualToString:NSAppearanceNameDarkAqua] ||
         [match isEqualToString:NSAppearanceNameVibrantDark];
}

static bool token_usage_backdrop_is_dark_impl(void *view_pointer) {
  @autoreleasepool {
    if (view_pointer == NULL) {
      return false;
    }

    NSView *content = (__bridge NSView *)view_pointer;
    NSWindow *window = content.window;
    if (window == nil) {
      return false;
    }

    TokenUsageGlassEffectView *glass =
        objc_getAssociatedObject(window, TokenUsageGlassKey);

    // Liquid Glass communicates its adaptive local appearance through the
    // content-view hierarchy. This is the supported, permission-free signal
    // for matching foreground colors to the material's current appearance.
    NSAppearance *appearance = glass.contentView.effectiveAppearance;
    if (appearance == nil) {
      appearance = glass.effectiveAppearance ?: content.effectiveAppearance;
    }
    return token_usage_appearance_is_dark(appearance);
  }
}

bool token_usage_backdrop_is_dark(void *view_pointer) {
  if ([NSThread isMainThread]) {
    return token_usage_backdrop_is_dark_impl(view_pointer);
  }

  __block bool dark = false;
  dispatch_sync(dispatch_get_main_queue(), ^{
    dark = token_usage_backdrop_is_dark_impl(view_pointer);
  });
  return dark;
}

static void token_usage_apply_fallback_tint_impl(void *view_pointer,
                                                 double glass_level) {
  NSView *content = (__bridge NSView *)view_pointer;
  CGFloat level = MAX(0.0, MIN(1.0, glass_level));
  CGFloat tint_alpha = 0.008 + level * 0.09;
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
