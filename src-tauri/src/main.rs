// Release builds are desktop GUI applications. Without this attribute Windows
// also creates a console host, which can look like an extra PowerShell window.
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

fn main() {
    token_usage_lib::run();
}
