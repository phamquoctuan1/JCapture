#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreatePen,
    CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, EndPaint, FillRect,
    GetStockObject, NULL_BRUSH, BACKGROUND_MODE, SelectObject, SetBkMode, SetTextColor,
    DT_CENTER, DT_SINGLELINE, DT_VCENTER, FW_SEMIBOLD, PAINTSTRUCT, PS_SOLID, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW,
    LoadCursorW, PostQuitMessage, RegisterClassW, SetCursor, ShowWindow,
    TranslateMessage, HCURSOR, HICON, IDC_CROSS, SW_SHOW, SW_HIDE,
    WM_DESTROY, WM_ERASEBKGND, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
    WM_PAINT, WM_SETCURSOR, WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use crate::models::CaptureRecord;
use crate::native::clipboard::copy_rgba_to_clipboard;
use crate::native::screen_grab::ScreenSnapshot;
use crate::storage::db::Database;
use crate::storage::paths::AppPaths;
use crate::storage::persistence::persist_capture;

static OVERLAY_ACTIVE: AtomicBool = AtomicBool::new(false);

#[inline]
fn rgb(r: u8, g: u8, b: u8) -> COLORREF {
    COLORREF((r as u32) | ((g as u32) << 8) | ((b as u32) << 16))
}

pub fn is_overlay_open() -> bool {
    OVERLAY_ACTIVE.load(Ordering::SeqCst)
}

pub fn open_capture_overlay(
    paths: Arc<AppPaths>,
    db: Arc<Database>,
    callback: Arc<dyn Fn(CaptureRecord) + Send + Sync + 'static>,
) -> Result<(), String> {
    if OVERLAY_ACTIVE.swap(true, Ordering::SeqCst) {
        return Ok(()); // Already active
    }

    std::thread::spawn(move || {
        let _guard = ScopeExit::new(|| {
            OVERLAY_ACTIVE.store(false, Ordering::SeqCst);
        });

        let log_file = paths.root_dir.join("debug.log");
        let _ = std::fs::write(&log_file, format!("[{}] Starting capture...\n", chrono::Local::now()));

        // 1. Snapshot all screens before showing overlay
        let snapshot = match ScreenSnapshot::capture_virtual_screen() {
            Ok(s) => {
                let _ = std::fs::OpenOptions::new().append(true).open(&log_file).map(|mut f| {
                    use std::io::Write;
                    let _ = writeln!(f, "[{}] Snapshot OK: {}x{} at ({},{})", chrono::Local::now(), s.width, s.height, s.x, s.y);
                });
                Arc::new(s)
            },
            Err(e) => {
                let _ = std::fs::OpenOptions::new().append(true).open(&log_file).map(|mut f| {
                    use std::io::Write;
                    let _ = writeln!(f, "[{}] Snapshot ERROR: {}", chrono::Local::now(), e);
                });
                return;
            }
        };

        #[cfg(windows)]
        unsafe {
            run_overlay_window(snapshot, paths, db, callback);
        }
    });

    Ok(())
}

struct ScopeExit<F: FnOnce()>(Option<F>);
impl<F: FnOnce()> ScopeExit<F> {
    fn new(f: F) -> Self {
        Self(Some(f))
    }
}
impl<F: FnOnce()> Drop for ScopeExit<F> {
    fn drop(&mut self) {
        if let Some(f) = self.0.take() {
            f();
        }
    }
}

#[cfg(windows)]
struct OverlayState {
    snapshot: Arc<ScreenSnapshot>,
    paths: Arc<AppPaths>,
    db: Arc<Database>,
    callback: Arc<dyn Fn(CaptureRecord) + Send + Sync>,
    is_dragging: bool,
    start_pt: POINT,
    current_pt: POINT,
    h_bg_bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
}

#[cfg(windows)]
unsafe fn run_overlay_window(
    snapshot: Arc<ScreenSnapshot>,
    paths: Arc<AppPaths>,
    db: Arc<Database>,
    callback: Arc<dyn Fn(CaptureRecord) + Send + Sync>,
) {
    let class_name = w!("JCapture_SelectionOverlay");

    let h_instance: HINSTANCE = windows::Win32::System::LibraryLoader::GetModuleHandleW(PCWSTR::null())
        .unwrap_or_default()
        .into();

    let wc = WNDCLASSW {
        style: windows::Win32::UI::WindowsAndMessaging::WNDCLASS_STYLES(0),
        lpfnWndProc: Some(overlay_wndproc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: h_instance,
        hIcon: HICON(std::ptr::null_mut()),
        hCursor: LoadCursorW(None, IDC_CROSS).unwrap_or(HCURSOR(std::ptr::null_mut())),
        hbrBackground: windows::Win32::Graphics::Gdi::HBRUSH(std::ptr::null_mut()),
        lpszMenuName: PCWSTR::null(),
        lpszClassName: class_name,
    };

    let _ = RegisterClassW(&wc);

    // Create GDI Bitmap from snapshot for fast BitBlt rendering
    let hdc_screen = windows::Win32::Graphics::Gdi::GetDC(HWND(std::ptr::null_mut()));
    let hdc_mem = CreateCompatibleDC(hdc_screen);
    let h_bg_bitmap = CreateCompatibleBitmap(hdc_screen, snapshot.width as i32, snapshot.height as i32);

    let mut bmi = windows::Win32::Graphics::Gdi::BITMAPINFO {
        bmiHeader: windows::Win32::Graphics::Gdi::BITMAPINFOHEADER {
            biSize: std::mem::size_of::<windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32,
            biWidth: snapshot.width as i32,
            biHeight: -(snapshot.height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: windows::Win32::Graphics::Gdi::BI_RGB.0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default()],
    };

    // Convert RGBA back to BGRA buffer for GDI SetDIBits
    let mut bgra_buf = snapshot.rgba_data.clone();
    for chunk in bgra_buf.chunks_exact_mut(4) {
        let r = chunk[0];
        let b = chunk[2];
        chunk[0] = b;
        chunk[2] = r;
    }

    windows::Win32::Graphics::Gdi::SetDIBits(
        hdc_mem,
        h_bg_bitmap,
        0,
        snapshot.height,
        bgra_buf.as_ptr() as *const _,
        &mut bmi,
        windows::Win32::Graphics::Gdi::DIB_RGB_COLORS,
    );

    let _ = DeleteDC(hdc_mem);
    let _ = windows::Win32::Graphics::Gdi::ReleaseDC(HWND(std::ptr::null_mut()), hdc_screen);

    let sx = snapshot.x;
    let sy = snapshot.y;
    let sw = snapshot.width as i32;
    let sh = snapshot.height as i32;

    let state = Box::new(OverlayState {
        snapshot,
        paths,
        db,
        callback,
        is_dragging: false,
        start_pt: POINT { x: 0, y: 0 },
        current_pt: POINT { x: 0, y: 0 },
        h_bg_bitmap,
    });

    let state_ptr = Box::into_raw(state);

    let hwnd = match CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        class_name,
        w!("JCapture Overlay"),
        WS_POPUP,
        sx,
        sy,
        sw,
        sh,
        HWND(std::ptr::null_mut()),
        None,
        h_instance,
        Some(state_ptr as *const _),
    ) {
        Ok(h) => h,
        Err(_) => {
            let _ = Box::from_raw(state_ptr);
            return;
        }
    };

    let _ = windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
        hwnd,
        windows::Win32::UI::WindowsAndMessaging::HWND_TOPMOST,
        sx,
        sy,
        sw,
        sh,
        windows::Win32::UI::WindowsAndMessaging::SWP_SHOWWINDOW,
    );
    let _ = ShowWindow(hwnd, SW_SHOW);
    let _ = windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(hwnd);

    let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
    while GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0).as_bool() {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

#[cfg(windows)]
unsafe extern "system" fn overlay_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let state_ptr = windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
        hwnd,
        windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA,
    ) as *mut OverlayState;

    match msg {
        windows::Win32::UI::WindowsAndMessaging::WM_NCCREATE => {
            let create_struct = lparam.0 as *const windows::Win32::UI::WindowsAndMessaging::CREATESTRUCTW;
            if !create_struct.is_null() && !(*create_struct).lpCreateParams.is_null() {
                let state_ptr = (*create_struct).lpCreateParams as *mut OverlayState;
                windows::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
                    hwnd,
                    windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA,
                    state_ptr as isize,
                );
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        windows::Win32::UI::WindowsAndMessaging::WM_CREATE => {
            LRESULT(0)
        }
        WM_ERASEBKGND => LRESULT(1), // Prevent flicker
        WM_SETCURSOR => {
            if let Ok(cur) = LoadCursorW(None, IDC_CROSS) {
                SetCursor(cur);
            }
            LRESULT(1)
        }
        WM_KEYDOWN => {
            if wparam.0 == 0x1B { // VK_ESCAPE
                let _ = windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture();
                let _ = DestroyWindow(hwnd);
            }
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            windows::Win32::UI::Input::KeyboardAndMouse::SetCapture(hwnd);
            if !state_ptr.is_null() {
                let state = &mut *state_ptr;
                let mut pt = POINT::default();
                let _ = GetCursorPos(&mut pt);
                state.is_dragging = true;
                state.start_pt = pt;
                state.current_pt = pt;

                let log_file = state.paths.root_dir.join("debug.log");
                let _ = std::fs::OpenOptions::new().append(true).open(&log_file).map(|mut f| {
                    use std::io::Write;
                    let _ = writeln!(f, "[{}] MouseDown at ({}, {})", chrono::Local::now(), pt.x, pt.y);
                });

                let _ = windows::Win32::Graphics::Gdi::InvalidateRect(hwnd, None, false);
            }
            LRESULT(0)
        }
        WM_MOUSEMOVE => {
            if !state_ptr.is_null() {
                let state = &mut *state_ptr;
                let mut pt = POINT::default();
                let _ = GetCursorPos(&mut pt);
                state.current_pt = pt;
                let _ = windows::Win32::Graphics::Gdi::InvalidateRect(hwnd, None, false);
            }
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            let _ = windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture();
            if !state_ptr.is_null() {
                let state = &mut *state_ptr;
                if state.is_dragging {
                    state.is_dragging = false;
                    let mut pt = POINT::default();
                    let _ = GetCursorPos(&mut pt);
                    state.current_pt = pt;

                    let sel_left = state.start_pt.x.min(state.current_pt.x);
                    let sel_top = state.start_pt.y.min(state.current_pt.y);
                    let sel_right = state.start_pt.x.max(state.current_pt.x);
                    let sel_bottom = state.start_pt.y.max(state.current_pt.y);

                    let sel_w = (sel_right - sel_left) as u32;
                    let sel_h = (sel_bottom - sel_top) as u32;

                    let log_file = state.paths.root_dir.join("debug.log");
                    let _ = std::fs::OpenOptions::new().append(true).open(&log_file).map(|mut f| {
                        use std::io::Write;
                        let _ = writeln!(f, "[{}] MouseUp at ({}, {}), selection: {}x{}", chrono::Local::now(), pt.x, pt.y, sel_w, sel_h);
                    });

                    if sel_w >= 4 && sel_h >= 4 {
                        let _ = ShowWindow(hwnd, SW_HIDE);

                        // 1. Crop snapshot
                        match state.snapshot.crop(sel_left, sel_top, sel_w, sel_h) {
                            Ok(cropped) => {
                                // 2. High priority: Clipboard copy immediate (< 10ms)
                                let _ = copy_rgba_to_clipboard(cropped.width, cropped.height, &cropped.rgba_data);

                                // 3. Persist to disk & DB
                                let capture_id = uuid::Uuid::new_v4().to_string();
                                match persist_capture(
                                    &state.db,
                                    &state.paths,
                                    &capture_id,
                                    "region",
                                    cropped.width,
                                    cropped.height,
                                    &cropped.rgba_data,
                                ) {
                                    Ok(record) => {
                                        let _ = std::fs::OpenOptions::new().append(true).open(&log_file).map(|mut f| {
                                            use std::io::Write;
                                            let _ = writeln!(f, "[{}] Persisted capture: {}, invoking callback...", chrono::Local::now(), record.id);
                                        });
                                        (state.callback)(record);
                                    }
                                    Err(e) => {
                                        let _ = std::fs::OpenOptions::new().append(true).open(&log_file).map(|mut f| {
                                            use std::io::Write;
                                            let _ = writeln!(f, "[{}] Persist failed: {}", chrono::Local::now(), e);
                                        });
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = std::fs::OpenOptions::new().append(true).open(&log_file).map(|mut f| {
                                    use std::io::Write;
                                    let _ = writeln!(f, "[{}] Crop failed: {}", chrono::Local::now(), e);
                                });
                            }
                        }
                    }
                }
            }
            let _ = DestroyWindow(hwnd);
            LRESULT(0)
        }
        WM_PAINT => {
            if !state_ptr.is_null() {
                let state = &*state_ptr;
                let mut ps = PAINTSTRUCT::default();
                let hdc = BeginPaint(hwnd, &mut ps);

                let w = state.snapshot.width as i32;
                let h = state.snapshot.height as i32;

                // Double buffer DC
                let mem_dc = CreateCompatibleDC(hdc);
                let mem_bmp = CreateCompatibleBitmap(hdc, w, h);
                let old_bmp = SelectObject(mem_dc, mem_bmp);

                // Source image DC
                let src_dc = CreateCompatibleDC(hdc);
                let old_src = SelectObject(src_dc, state.h_bg_bitmap);

                // 1. Copy frozen desktop background
                let _ = BitBlt(mem_dc, 0, 0, w, h, src_dc, 0, 0, SRCCOPY);

                // 2. Calculate selection in client coordinates
                let sel_rect = if state.is_dragging {
                    let c_start_x = state.start_pt.x - state.snapshot.x;
                    let c_start_y = state.start_pt.y - state.snapshot.y;
                    let c_curr_x = state.current_pt.x - state.snapshot.x;
                    let c_curr_y = state.current_pt.y - state.snapshot.y;

                    let left = c_start_x.min(c_curr_x);
                    let top = c_start_y.min(c_curr_y);
                    let right = c_start_x.max(c_curr_x);
                    let bottom = c_start_y.max(c_curr_y);

                    Some(RECT { left, top, right, bottom })
                } else {
                    None
                };

                // 3. Draw dark overlay outside selection
                let mask_brush = CreateSolidBrush(COLORREF(0x00000000)); // Black brush
                let blend_dc = CreateCompatibleDC(hdc);
                let blend_bmp = CreateCompatibleBitmap(hdc, w, h);
                let old_blend_bmp = SelectObject(blend_dc, blend_bmp);

                let full_rc = RECT { left: 0, top: 0, right: w, bottom: h };
                let _ = FillRect(blend_dc, &full_rc, mask_brush);

                let blend_fn = windows::Win32::Graphics::Gdi::BLENDFUNCTION {
                    BlendOp: windows::Win32::Graphics::Gdi::AC_SRC_OVER as u8,
                    BlendFlags: 0,
                    SourceConstantAlpha: 110, // ~43% dim opacity
                    AlphaFormat: 0,
                };

                if let Some(sel) = sel_rect {
                    // Dim top
                    if sel.top > 0 {
                        let _ = windows::Win32::Graphics::Gdi::GdiAlphaBlend(
                            mem_dc, 0, 0, w, sel.top, blend_dc, 0, 0, w, sel.top, blend_fn,
                        );
                    }
                    // Dim bottom
                    if sel.bottom < h {
                        let _ = windows::Win32::Graphics::Gdi::GdiAlphaBlend(
                            mem_dc, 0, sel.bottom, w, h - sel.bottom, blend_dc, 0, sel.bottom, w, h - sel.bottom, blend_fn,
                        );
                    }
                    // Dim left
                    if sel.left > 0 && sel.bottom > sel.top {
                        let _ = windows::Win32::Graphics::Gdi::GdiAlphaBlend(
                            mem_dc, 0, sel.top, sel.left, sel.bottom - sel.top, blend_dc, 0, sel.top, sel.left, sel.bottom - sel.top, blend_fn,
                        );
                    }
                    // Dim right
                    if sel.right < w && sel.bottom > sel.top {
                        let _ = windows::Win32::Graphics::Gdi::GdiAlphaBlend(
                            mem_dc, sel.right, sel.top, w - sel.right, sel.bottom - sel.top, blend_dc, 0, sel.top, sel.right, sel.bottom - sel.top, blend_fn,
                        );
                    }

                    // 4. Draw selection border (Cyan/Blue)
                    let border_color = rgb(14, 165, 233);
                    let border_pen = CreatePen(PS_SOLID, 2, border_color);
                    let old_pen = SelectObject(mem_dc, border_pen);
                    let old_brush = SelectObject(mem_dc, GetStockObject(NULL_BRUSH));

                    let _ = windows::Win32::Graphics::Gdi::Rectangle(
                        mem_dc, sel.left, sel.top, sel.right, sel.bottom
                    );

                    let sel_w = sel.right - sel.left;
                    let sel_h = sel.bottom - sel.top;

                    // 5. Draw size badge (e.g., "1920 × 1080")
                    if sel_w > 60 && sel_h > 25 {
                        let size_text = format!("{} × {}", sel_w, sel_h);
                        let mut wide_text: Vec<u16> = size_text.encode_utf16().chain(std::iter::once(0)).collect();

                        let badge_w = 110;
                        let badge_h = 24;
                        let badge_x = sel.left + 8;
                        let badge_y = if sel.top > 32 { sel.top - 28 } else { sel.top + 8 };

                        let badge_rc = RECT {
                            left: badge_x,
                            top: badge_y,
                            right: badge_x + badge_w,
                            bottom: badge_y + badge_h,
                        };

                        let bg_badge_brush = CreateSolidBrush(rgb(24, 24, 27));
                        let _ = FillRect(mem_dc, &badge_rc, bg_badge_brush);
                        let _ = DeleteObject(bg_badge_brush);

                        let font = CreateFontW(
                            14, 0, 0, 0, FW_SEMIBOLD.0 as i32, 0, 0, 0, 0, 0, 0, 0, 0, w!("Segoe UI")
                        );
                        let old_font = SelectObject(mem_dc, font);
                        let _ = SetBkMode(mem_dc, BACKGROUND_MODE(1)); // TRANSPARENT
                        let _ = SetTextColor(mem_dc, rgb(244, 244, 245));

                        let mut text_rc = badge_rc;
                        let text_len = wide_text.len();
                        let _ = DrawTextW(
                            mem_dc,
                            &mut wide_text[..text_len - 1],
                            &mut text_rc,
                            DT_CENTER | DT_VCENTER | DT_SINGLELINE,
                        );

                        let _ = SelectObject(mem_dc, old_font);
                        let _ = DeleteObject(font);
                    }

                    let _ = SelectObject(mem_dc, old_brush);
                    let _ = SelectObject(mem_dc, old_pen);
                    let _ = DeleteObject(border_pen);
                } else {
                    // Full dimming before first click
                    let _ = windows::Win32::Graphics::Gdi::GdiAlphaBlend(
                        mem_dc, 0, 0, w, h, blend_dc, 0, 0, w, h, blend_fn,
                    );
                }

                // Blit memory buffer to screen
                let _ = BitBlt(hdc, 0, 0, w, h, mem_dc, 0, 0, SRCCOPY);

                // Cleanup
                let _ = DeleteObject(mask_brush);
                let _ = SelectObject(blend_dc, old_blend_bmp);
                let _ = DeleteObject(blend_bmp);
                let _ = DeleteDC(blend_dc);

                let _ = SelectObject(src_dc, old_src);
                let _ = DeleteDC(src_dc);

                let _ = SelectObject(mem_dc, old_bmp);
                let _ = DeleteObject(mem_bmp);
                let _ = DeleteDC(mem_dc);

                let _ = EndPaint(hwnd, &ps);
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            if !state_ptr.is_null() {
                let state = Box::from_raw(state_ptr);
                let _ = DeleteObject(state.h_bg_bitmap);
            }
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}
