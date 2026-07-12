#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static const void *TokenUsageGlassKey = &TokenUsageGlassKey;

bool token_usage_apply_liquid_glass(void *view_pointer,
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

    NSGlassEffectView *glass = objc_getAssociatedObject(window, TokenUsageGlassKey);
    if (glass == nil) {
      NSView *window_content = window.contentView;
      if (window_content == nil) {
        return false;
      }

      glass = [[glass_class alloc] initWithFrame:window_content.bounds];
      glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      window.contentView = glass;
      glass.contentView = window_content;
      objc_setAssociatedObject(window, TokenUsageGlassKey, glass,
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    glass.frame = window.contentView.bounds;
    glass.cornerRadius = corner_radius;
    glass.style = style == 0 ? NSGlassEffectViewStyleClear
                             : NSGlassEffectViewStyleRegular;

    CGFloat normalized = MAX(0.0, MIN(1.0, (opacity - 0.55) / 0.45));
    CGFloat tint_alpha = style == 0 ? normalized * 0.045
                                    : 0.025 + normalized * 0.095;
    glass.tintColor = tint_alpha > 0.001
                          ? [NSColor colorWithWhite:0.72 alpha:tint_alpha]
                          : nil;

    window.opaque = NO;
    window.backgroundColor = NSColor.clearColor;
    window.hasShadow = NO;
    return true;
  }

  return false;
}
