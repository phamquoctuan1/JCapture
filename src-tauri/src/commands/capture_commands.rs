use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::models::{AppSettings, CaptureRecord};
use crate::native::{copy_rgba_to_clipboard, open_capture_overlay};
use crate::storage::{read_project_json, save_project_json, AppPaths, Database};

pub struct AppState {
    pub paths: Arc<AppPaths>,
    pub db: Arc<Database>,
}

#[tauri::command]
pub async fn trigger_capture(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let app_handle = app.clone();
    let paths = Arc::clone(&state.paths);
    let db = Arc::clone(&state.db);

    let callback = Arc::new(move |record: CaptureRecord| {
        use tauri::Manager;
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.emit("capture:new", &record);
        }
        let _ = app_handle.emit("capture:new", &record);
    });

    open_capture_overlay(paths, db, callback)
}

#[tauri::command]
pub async fn trigger_fullscreen_capture(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri::Manager;
    let app_handle = app.clone();
    let paths = Arc::clone(&state.paths);
    let db = Arc::clone(&state.db);

    // Hide workspace window briefly to capture clean screen
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));

        match crate::native::ScreenSnapshot::capture_virtual_screen() {
            Ok(snap) => {
                let _ = copy_rgba_to_clipboard(snap.width, snap.height, &snap.rgba_data);

                let capture_id = uuid::Uuid::new_v4().to_string();
                if let Ok(record) = crate::storage::persist_capture(
                    &db,
                    &paths,
                    &capture_id,
                    "fullscreen",
                    snap.width,
                    snap.height,
                    &snap.rgba_data,
                ) {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window.emit("capture:new", &record);
                    }
                    let _ = app_handle.emit("capture:new", &record);
                }
            }
            Err(e) => {
                eprintln!("Fullscreen capture failed: {}", e);
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn create_blank_canvas(
    state: State<'_, AppState>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<CaptureRecord, String> {
    let w = width.unwrap_or(1600);
    let h = height.unwrap_or(900);
    let total_pixels = (w * h) as usize;

    // Clean pure white canvas background (#FFFFFF)
    let mut rgba_data = Vec::with_capacity(total_pixels * 4);
    for _ in 0..total_pixels {
        rgba_data.push(255);
        rgba_data.push(255);
        rgba_data.push(255);
        rgba_data.push(255);
    }

    let capture_id = uuid::Uuid::new_v4().to_string();
    crate::storage::persist_capture(
        &state.db,
        &state.paths,
        &capture_id,
        "blank",
        w,
        h,
        &rgba_data,
    )
}

#[tauri::command]
pub fn get_recent_captures(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<CaptureRecord>, String> {
    state.db.get_recent_captures(limit.unwrap_or(100))
}

#[tauri::command]
pub fn toggle_pin_capture(
    state: State<'_, AppState>,
    id: String,
    is_pinned: bool,
) -> Result<(), String> {
    state.db.toggle_pin(&id, is_pinned)
}

#[tauri::command]
pub fn close_capture(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.db.close_capture(&id)
}

#[tauri::command]
pub fn delete_capture(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    if let Some((orig, thumb, proj)) = state.db.delete_capture(&id)? {
        let _ = std::fs::remove_file(orig);
        let _ = std::fs::remove_file(thumb);
        if let Some(p) = proj {
            let _ = std::fs::remove_file(p);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_annotation_project(
    state: State<'_, AppState>,
    capture_id: String,
    json_content: String,
) -> Result<String, String> {
    save_project_json(&state.paths, &state.db, &capture_id, &json_content)
}

#[tauri::command]
pub fn load_annotation_project(
    project_path: String,
) -> Result<String, String> {
    read_project_json(&project_path)
}

#[tauri::command]
pub fn overwrite_capture_image(
    state: State<'_, AppState>,
    id: String,
    base64_data: String,
    width: u32,
    height: u32,
) -> Result<CaptureRecord, String> {
    let raw_b64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };
    let bytes = base64_decode(raw_b64).map_err(|e| format!("Base64 decode error: {}", e))?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;

    if let Some((orig_path, thumb_path)) = state.db.update_capture_image(&id, width, height)? {
        // 1. Overwrite original on disk
        let _ = img.save(&orig_path);

        // 2. Overwrite thumbnail on disk
        let thumb = img.thumbnail(240, 160);
        let _ = thumb.save(&thumb_path);
    }

    if let Some(record) = state.db.get_capture_by_id(&id)? {
        Ok(record)
    } else {
        Err("Capture record not found".to_string())
    }
}

#[tauri::command]
pub fn read_image_base64(file_path: String) -> Result<String, String> {
    let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let mime = if file_path.ends_with(".jpg") || file_path.ends_with(".jpeg") {
        "image/jpeg"
    } else {
        "image/png"
    };
    
    // Simple base64 encode using std/custom to avoid extra dependency
    let b64 = base64_encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub fn copy_image_base64_to_clipboard(base64_data: String) -> Result<(), String> {
    // Strip data:image/...;base64, if present
    let raw_b64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = base64_decode(raw_b64).map_err(|e| format!("Base64 decode error: {}", e))?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = img.dimensions();
    copy_rgba_to_clipboard(w, h, &img.into_raw())
}

#[tauri::command]
pub fn open_in_explorer(file_path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let path = std::path::Path::new(&file_path);
        let arg = if path.exists() {
            format!("/select,\"{}\"", file_path)
        } else {
            format!("\"{}\"", path.parent().unwrap_or(path).to_string_lossy())
        };
        std::process::Command::new("explorer")
            .arg(arg)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    if let Some(json_val) = state.db.get_setting("app_settings")? {
        serde_json::from_str(&json_val).map_err(|e| e.to_string())
    } else {
        Ok(AppSettings::default())
    }
}

#[tauri::command]
pub fn save_app_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    let json_str = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    state.db.set_setting("app_settings", &json_str)?;
    crate::native::hotkey::update_global_hotkeys(&settings.hotkey_capture, &settings.hotkey_record);
    Ok(())
}

#[tauri::command]
pub fn export_image_as_dialog(base64_data: String, default_name: Option<String>) -> Result<Option<String>, String> {
    #[cfg(windows)]
    unsafe {
        use windows::core::PWSTR;
        use windows::Win32::UI::Controls::Dialogs::{GetSaveFileNameW, OPENFILENAMEW, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST};

        let raw_b64 = if let Some(idx) = base64_data.find(',') {
            &base64_data[idx + 1..]
        } else {
            &base64_data
        };
        let bytes = base64_decode(raw_b64).map_err(|e| format!("Decode error: {}", e))?;

        let fname = default_name.unwrap_or_else(|| format!("Capture_{}.png", chrono::Local::now().format("%Y%m%d_%H%M%S")));
        let mut file_buf = [0u16; 512];
        let fname_wide: Vec<u16> = fname.encode_utf16().collect();
        let copy_len = fname_wide.len().min(510);
        file_buf[..copy_len].copy_from_slice(&fname_wide[..copy_len]);

        let filter = windows::core::w!("PNG Image (*.png)\0*.png\0JPEG Image (*.jpg)\0*.jpg\0All Files (*.*)\0*.*\0\0");
        let def_ext = windows::core::w!("png");

        let mut ofn = OPENFILENAMEW {
            lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
            hwndOwner: windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            lpstrFilter: filter,
            lpstrFile: PWSTR(file_buf.as_mut_ptr()),
            nMaxFile: 512,
            lpstrDefExt: def_ext,
            Flags: OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST,
            ..Default::default()
        };

        if GetSaveFileNameW(&mut ofn).as_bool() {
            let len = file_buf.iter().position(|&c| c == 0).unwrap_or(file_buf.len());
            let path_str = String::from_utf16_lossy(&file_buf[..len]);
            std::fs::write(&path_str, bytes).map_err(|e| e.to_string())?;
            Ok(Some(path_str))
        } else {
            Ok(None)
        }
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    download_url: String,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let is_portable = download_url.contains("Portable") || !download_url.contains("setup");
    let downloaded_file = if is_portable {
        temp_dir.join("JCapture_new.exe")
    } else {
        temp_dir.join("JCapture_setup_update.exe")
    };
    let dest_str = downloaded_file.to_string_lossy().to_string();

    // 1. Try native curl.exe with -L for seamless GitHub / S3 redirects
    let curl_res = std::process::Command::new("curl.exe")
        .args([
            "-L", // Follow HTTP 302 / 307 redirects to AWS S3
            "-f", // Fail on HTTP 4xx / 5xx
            "-s", // Silent
            "-S", // Show errors if any
            "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) JCapture-Updater",
            "-o", &dest_str,
            &download_url,
        ])
        .output();

    let mut download_succeeded = false;
    if let Ok(out) = curl_res {
        if out.status.success() && downloaded_file.exists() {
            if let Ok(meta) = std::fs::metadata(&downloaded_file) {
                if meta.len() > 1024 * 500 {
                    download_succeeded = true;
                }
            }
        }
    }

    // 2. Fallback: PowerShell Invoke-WebRequest with TLS 1.2 / TLS 1.3
    if !download_succeeded {
        let ps_cmd = format!(
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; Invoke-WebRequest -Uri '{}' -OutFile '{}' -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' -MaximumRedirection 10",
            download_url, dest_str
        );
        let ps_res = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .output();

        if let Ok(out) = ps_res {
            if out.status.success() && downloaded_file.exists() {
                if let Ok(meta) = std::fs::metadata(&downloaded_file) {
                    if meta.len() > 1024 * 500 {
                        download_succeeded = true;
                    }
                }
            }
        }
    }

    if !download_succeeded {
        return Err("Could not download update directly. Please click 'Open GitHub Download Page in Browser'.".to_string());
    }

    // Perform seamless in-place upgrade and close old instance
    if is_portable {
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Failed to get current exe path: {}", e))?
            .to_string_lossy()
            .to_string();
        let current_pid = std::process::id();

        // Use a hidden background powershell process to wait for exit, overwrite executable, and relaunch
        let ps_updater = format!(
            "$pidToWait = {}; $src = '{}'; $dst = '{}'; \
             Start-Sleep -Milliseconds 400; \
             while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {{ Start-Sleep -Milliseconds 200 }}; \
             Copy-Item -LiteralPath $src -Destination $dst -Force; \
             Start-Process -FilePath $dst; \
             Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue;",
            current_pid,
            dest_str.replace('\'', "''"),
            current_exe.replace('\'', "''")
        );

        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps_updater])
            .spawn();

        // Gracefully exit current process so destination binary can be overwritten
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(500));
            std::process::exit(0);
        });
    } else {
        // Setup installer execution
        let _ = std::process::Command::new(&downloaded_file).spawn();
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(500));
            std::process::exit(0);
        });
    }

    Ok(dest_str)
}

use base64::Engine;

fn base64_encode(input: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(input)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(input.trim())
        .map_err(|e| e.to_string())
}
