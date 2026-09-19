#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <dispatch/dispatch.h>
#import <math.h>
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

static bool token_usage_appearance_is_dark(NSWindow *window) {
  NSAppearanceName match = [window.effectiveAppearance
      bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua,
                                           NSAppearanceNameDarkAqua ]];
  return [match isEqualToString:NSAppearanceNameDarkAqua];
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

    NSScreen *screen = window.screen ?: NSScreen.mainScreen;
    NSURL *wallpaper_url = screen == nil
                               ? nil
                               : [[NSWorkspace sharedWorkspace]
                                     desktopImageURLForScreen:screen];
    static NSURL *cached_wallpaper_url = nil;
    static NSImage *cached_wallpaper = nil;
    if (wallpaper_url != nil && ![wallpaper_url isEqual:cached_wallpaper_url]) {
      cached_wallpaper_url = wallpaper_url;
      cached_wallpaper =
          [[NSImage alloc] initWithContentsOfURL:cached_wallpaper_url];
    }
    NSImage *wallpaper = wallpaper_url == nil ? nil : cached_wallpaper;
    if (screen == nil || wallpaper == nil || wallpaper.size.width <= 0.0 ||
        wallpaper.size.height <= 0.0) {
      return token_usage_appearance_is_dark(window);
    }

    // macOS normally displays desktop pictures using aspect fill. Map the
    // widget's current screen position back into that visible image region so
    // moving the widget also updates its foreground contrast.
    NSRect screen_frame = screen.frame;
    NSRect window_frame = window.frame;
    CGFloat scale = MAX(NSWidth(screen_frame) / wallpaper.size.width,
                        NSHeight(screen_frame) / wallpaper.size.height);
    if (!isfinite(scale) || scale <= 0.0) {
      return token_usage_appearance_is_dark(window);
    }
    NSSize displayed = NSMakeSize(wallpaper.size.width * scale,
                                  wallpaper.size.height * scale);
    CGFloat displayed_x = NSMinX(screen_frame) +
                          (NSWidth(screen_frame) - displayed.width) / 2.0;
    CGFloat displayed_y = NSMinY(screen_frame) +
                          (NSHeight(screen_frame) - displayed.height) / 2.0;
    CGFloat center_x = (NSMidX(window_frame) - displayed_x) / scale;
    CGFloat center_y = (NSMidY(window_frame) - displayed_y) / scale;
    CGFloat sample_width = MAX(NSWidth(window_frame) / scale, 1.0);
    CGFloat sample_height = MAX(NSHeight(window_frame) / scale, 1.0);
    NSRect source = NSMakeRect(center_x - sample_width / 2.0,
                               center_y - sample_height / 2.0,
                               sample_width, sample_height);
    source = NSIntersectionRect(source,
                                NSMakeRect(0.0, 0.0, wallpaper.size.width,
                                           wallpaper.size.height));
    if (NSIsEmptyRect(source)) {
      return token_usage_appearance_is_dark(window);
    }

    const NSInteger pixels = 28;
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:NULL
                      pixelsWide:pixels
                      pixelsHigh:pixels
                   bitsPerSample:8
                 samplesPerPixel:4
                        hasAlpha:YES
                        isPlanar:NO
                  colorSpaceName:NSDeviceRGBColorSpace
                     bytesPerRow:0
                    bitsPerPixel:0];
    NSGraphicsContext *context =
        [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    if (bitmap == nil || context == nil) {
      return token_usage_appearance_is_dark(window);
    }

    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:context];
    context.imageInterpolation = NSImageInterpolationHigh;
    [wallpaper drawInRect:NSMakeRect(0.0, 0.0, pixels, pixels)
                 fromRect:source
                operation:NSCompositingOperationCopy
                 fraction:1.0
           respectFlipped:NO
                    hints:nil];
    [context flushGraphics];
    [NSGraphicsContext restoreGraphicsState];

    NSColorSpace *sRGB = NSColorSpace.sRGBColorSpace;
    double total_luminance = 0.0;
    NSUInteger sampled = 0;
    for (NSInteger y = 0; y < pixels; y++) {
      for (NSInteger x = 0; x < pixels; x++) {
        NSColor *color = [[bitmap colorAtX:x y:y] colorUsingColorSpace:sRGB];
        if (color == nil || color.alphaComponent <= 0.01) {
          continue;
        }
        total_luminance += 0.2126 * color.redComponent +
                           0.7152 * color.greenComponent +
                           0.0722 * color.blueComponent;
        sampled++;
      }
    }
    if (sampled == 0) {
      return token_usage_appearance_is_dark(window);
    }

    return total_luminance / sampled < 0.50;
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
