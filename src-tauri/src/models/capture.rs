use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRecord {
    pub id: String,
    pub capture_type: String, // "region", "window", "fullscreen"
    pub original_path: String,
    pub thumbnail_path: String,
    pub project_path: Option<String>,
    pub width: u32,
    pub height: u32,
    pub monitor_id: Option<String>,
    pub is_pinned: bool,
    pub is_closed: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub image_data_url: Option<String>,
    pub original_path: String,
    pub thumbnail_path: String,
}
