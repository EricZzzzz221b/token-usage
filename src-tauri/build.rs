fn main() {
    // Keep every Objective-C source and Apple framework outside non-macOS builds.
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=native/liquid_glass.m");
        cc::Build::new()
            .file("native/liquid_glass.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=13.0")
            .compile("token_usage_liquid_glass");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
    }
    println!("cargo:rerun-if-env-changed=TOKEN_USAGE_ENABLE_UPDATER");
    println!("cargo:rerun-if-env-changed=TOKEN_USAGE_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=TOKEN_USAGE_UPDATER_RELEASE_MODE");
    if std::env::var("TOKEN_USAGE_ENABLE_UPDATER").as_deref() == Ok("1") {
        let key = std::env::var("TOKEN_USAGE_UPDATER_PUBLIC_KEY")
            .expect("updater requires a real public key");
        assert!(
            !key.contains(['\n', '\r']) && !key.is_empty(),
            "invalid updater public key"
        );
        let mode = std::env::var("TOKEN_USAGE_UPDATER_RELEASE_MODE")
            .unwrap_or_else(|_| "notarized".into());
        assert!(
            matches!(mode.as_str(), "notarized" | "github-ad-hoc"),
            "invalid macOS release mode"
        );
        println!("cargo:rustc-env=TOKEN_USAGE_UPDATER_RELEASE_MODE={mode}");
        println!("cargo:rustc-env=TOKEN_USAGE_UPDATER_ENABLED=1");
        // Public verification material only, never read the signing private key here.
        println!("cargo:rustc-env=TOKEN_USAGE_UPDATER_PUBLIC_KEY={key}");
    }
    tauri_build::build()
}
