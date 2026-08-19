use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub hotkey_capture: String,
    pub hotkey_record: String,
    pub auto_start_with_windows: bool,
    pub copy_to_clipboard_on_capture: bool,
    pub open_editor_on_capture: bool,
    pub save_directory: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hotkey_capture: "Ctrl+Shift+A".to_string(),
            hotkey_record: "Ctrl+Shift+R".to_string(),
            auto_start_with_windows: false,
            copy_to_clipboard_on_capture: true,
            open_editor_on_capture: false,
            save_directory: "".to_string(),
        }
    }
}
