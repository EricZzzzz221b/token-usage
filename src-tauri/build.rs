fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=native/liquid_glass.m");
        cc::Build::new()
            .file("native/liquid_glass.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=13.0")
            .compile("token_usage_liquid_glass");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
    }
    tauri_build::build()
}
