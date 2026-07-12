fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("native/liquid_glass.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=13.0")
            .flag("-Wno-unguarded-availability-new")
            .compile("token_usage_liquid_glass");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
    tauri_build::build()
}
