use image::{ImageBuffer, Rgba, imageops::FilterType};
use std::path::Path;
use crate::models::CaptureRecord;
use crate::storage::db::Database;
use crate::storage::paths::AppPaths;

pub fn persist_capture(
    db: &Database,
    paths: &AppPaths,
    id: &str,
    capture_type: &str,
    width: u32,
    height: u32,
    rgba_data: &[u8],
) -> Result<CaptureRecord, String> {
    let original_filename = format!("{}.png", id);
    let original_path = paths.captures_dir.join(&original_filename);

    let thumbnail_filename = format!("{}.jpg", id);
    let thumbnail_path = paths.thumbnails_dir.join(&thumbnail_filename);

    // 1. Create ImageBuffer from RGBA
    let img: ImageBuffer<Rgba<u8>, _> = ImageBuffer::from_raw(width, height, rgba_data.to_vec())
        .ok_or_else(|| "Failed to create ImageBuffer from raw data".to_string())?;

    // 2. Save original PNG
    img.save(&original_path).map_err(|e| e.to_string())?;

    // 3. Generate thumbnail (target max dimension 240px)
    let thumb_max_dim = 240.0f32;
    let scale = (thumb_max_dim / width as f32).min(thumb_max_dim / height as f32).min(1.0);
    let thumb_w = ((width as f32 * scale).round() as u32).max(1);
    let thumb_h = ((height as f32 * scale).round() as u32).max(1);

    let thumb_img = image::imageops::resize(&img, thumb_w, thumb_h, FilterType::Triangle);
    // Convert to RGB for JPEG saving
    let rgb_thumb: image::RgbImage = image::DynamicImage::ImageRgba8(thumb_img).to_rgb8();
    rgb_thumb.save(&thumbnail_path).map_err(|e| e.to_string())?;

    // 4. Save metadata to DB
    let now = chrono::Utc::now().timestamp_millis();
    let record = CaptureRecord {
        id: id.to_string(),
        capture_type: capture_type.to_string(),
        original_path: original_path.to_string_lossy().to_string(),
        thumbnail_path: thumbnail_path.to_string_lossy().to_string(),
        project_path: None,
        width,
        height,
        monitor_id: None,
        is_pinned: false,
        is_closed: false,
        created_at: now,
        updated_at: now,
        last_opened_at: Some(now),
    };

    db.insert_capture(&record)?;

    Ok(record)
}

pub fn save_project_json(
    paths: &AppPaths,
    db: &Database,
    capture_id: &str,
    json_content: &str,
) -> Result<String, String> {
    let project_filename = format!("{}.json", capture_id);
    let project_path = paths.projects_dir.join(&project_filename);

    std::fs::write(&project_path, json_content).map_err(|e| e.to_string())?;
    let path_str = project_path.to_string_lossy().to_string();
    db.update_project_path(capture_id, &path_str)?;

    Ok(path_str)
}

pub fn read_project_json(path_str: &str) -> Result<String, String> {
    let path = Path::new(path_str);
    if path.exists() {
        std::fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        Err("Project file not found".to_string())
    }
}
