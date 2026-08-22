use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

pub mod commands;
pub mod models;
pub mod native;
pub mod storage;

use commands::*;
use models::CaptureRecord;
use native::{enforce_single_instance, init_dpi_awareness, open_capture_overlay, start_hotkey_listener};
use storage::{AppPaths, Database};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !enforce_single_instance() {
        // Another instance is already running and has been brought to foreground
        std::process::exit(0);
    }

    init_dpi_awareness();

    let paths = Arc::new(AppPaths::init().expect("Failed to initialize AppPaths"));
    let db = Arc::new(Database::new(&paths.db_path).expect("Failed to initialize SQLite Database"));

    let state = AppState {
        paths: Arc::clone(&paths),
        db: Arc::clone(&db),
    };

    let app_paths_clone = Arc::clone(&paths);
    let db_clone = Arc::clone(&db);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .setup(move |app| {
            let handle = app.handle().clone();

            // Setup System Tray
            let capture_item = MenuItem::with_id(app, "capture", "Capture Region (Ctrl+Shift+A)", true, None::<&str>)?;
            let workspace_item = MenuItem::with_id(app, "workspace", "Recent Workspace", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Exit JCapture", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture_item, &workspace_item, &quit_item])?;

            let paths_for_tray = Arc::clone(&app_paths_clone);
            let db_for_tray = Arc::clone(&db_clone);

            let tray_icon = if let Some(icon) = app.default_window_icon() {
                icon.clone()
            } else {
                tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap()
            };

            let _tray = TrayIconBuilder::with_id("jcapture_tray")
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app_handle, event| {
                    match event.id.as_ref() {
                        "capture" => {
                            let h = app_handle.clone();
                            let cb = Arc::new(move |record: CaptureRecord| {
                                if let Some(window) = h.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                    let _ = window.emit("capture:new", &record);
                                }
                                let _ = h.emit("capture:new", &record);
                            });
                            let _ = open_capture_overlay(Arc::clone(&paths_for_tray), Arc::clone(&db_for_tray), cb);
                        }
                        "workspace" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Start global hotkey listener
            let handle_for_hotkey = handle.clone();
            let paths_for_hotkey = Arc::clone(&app_paths_clone);
            let db_for_hotkey = Arc::clone(&db_clone);

            let initial_settings: models::AppSettings = db_clone
                .get_setting("app_settings")
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            let h_capture = handle_for_hotkey.clone();
            let h_fullscreen = handle_for_hotkey.clone();
            let h_record = handle_for_hotkey.clone();
            let paths_for_fullscreen = Arc::clone(&app_paths_clone);
            let db_for_fullscreen = Arc::clone(&db_clone);

            start_hotkey_listener(
                initial_settings.hotkey_capture,
                initial_settings.hotkey_fullscreen,
                initial_settings.hotkey_record,
                Arc::new(move || {
                    let h = h_capture.clone();
                    let cb = Arc::new(move |record: CaptureRecord| {
                        if let Some(window) = h.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("capture:new", &record);
                        }
                        let _ = h.emit("capture:new", &record);
                    });
                    let _ = open_capture_overlay(
                        Arc::clone(&paths_for_hotkey),
                        Arc::clone(&db_for_hotkey),
                        cb,
                    );
                }),
                Arc::new(move || {
                    let h = h_fullscreen.clone();
                    let paths = Arc::clone(&paths_for_fullscreen);
                    let db = Arc::clone(&db_for_fullscreen);

                    if let Some(window) = h.get_webview_window("main") {
                        let _ = window.hide();
                    }

                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(150));

                        match crate::native::ScreenSnapshot::capture_virtual_screen() {
                            Ok(snap) => {
                                let _ = crate::native::copy_rgba_to_clipboard(snap.width, snap.height, &snap.rgba_data);

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
                                    if let Some(window) = h.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                        let _ = window.emit("capture:new", &record);
                                    }
                                    let _ = h.emit("capture:new", &record);
                                }
                            }
                            Err(e) => {
                                eprintln!("Fullscreen hotkey capture failed: {}", e);
                                if let Some(window) = h.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    });
                }),
                Arc::new(move || {
                    if let Some(window) = h_record.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window.emit("record:start", ());
                    }
                    let _ = h_record.emit("record:start", ());
                }),
            );

            // Handle window close -> hide to tray instead of exiting
            if let Some(window) = app.get_webview_window("main") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            trigger_capture,
            trigger_fullscreen_capture,
            create_blank_canvas,
            get_recent_captures,
            toggle_pin_capture,
            close_capture,
            delete_capture,
            save_annotation_project,
            load_annotation_project,
            read_image_base64,
            overwrite_capture_image,
            copy_image_base64_to_clipboard,
            open_in_explorer,
            get_app_settings,
            save_app_settings,
            export_image_as_dialog,
            save_video_recording,
            save_video_recording_bytes,
            export_video_file,
            export_video_as_dialog,
            get_app_version,
            download_and_install_update
        ])
        .run(tauri::generate_context!())
        .expect("Error while running JCapture");
}
