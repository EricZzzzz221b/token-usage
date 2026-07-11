#[tauri::command]
fn app_phase() -> &'static str {
    "phase-0"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_phase])
        .run(tauri::generate_context!())
        .expect("error while running Token Usage");
}

#[cfg(test)]
mod tests {
    #[test]
    fn reports_phase_zero() {
        assert_eq!(super::app_phase(), "phase-0");
    }
}
