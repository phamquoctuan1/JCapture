#[cfg(windows)]
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreatePen,
    CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, EndPaint, FillRect,
    GetStockObject, NULL_BRUSH, BACKGROUND_MODE, SelectObject, SetBkMode, SetTextColor,
    DT_CENTER, DT_LEFT, DT_SINGLELINE, DT_VCENTER, FW_SEMIBOLD, PAINTSTRUCT, PS_SOLID, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW,
    LoadCursorW, PostQuitMessage, RegisterClassW, SetCursor, ShowWindow,
    TranslateMessage, PostThreadMessageW, HCURSOR, HICON, IDC_CROSS, SW_SHOW, SW_HIDE, WM_USER,
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
#[cfg(windows)]
static OVERLAY_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static OVERLAY_THREAD_ID: AtomicU32 = AtomicU32::new(0);
#[cfg(windows)]
const WM_CANCEL_OVERLAY: u32 = WM_USER + 202;

#[inline]
fn rgb(r: u8, g: u8, b: u8) -> COLORREF {
    COLORREF((r as u32) | ((g as u32) << 8) | ((b as u32) << 16))
}

/// A region the user picked for scrolling capture, plus the window that owns
/// it.
///
/// Scrolling capture needs the rectangle itself, not a saved screenshot: the
/// engine re-captures that rectangle many times and tracks the window to notice
/// when it moves. Reporting it directly also removes the old brute force search
/// that used to hunt the saved selection back down on screen.
#[derive(Debug, Clone, Copy)]
pub struct SelectedRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Raw HWND value of the window under the selection, or 0 when unknown.
    pub target: isize,
}

pub type RegionCallback = Arc<dyn Fn(SelectedRegion) + Send + Sync + 'static>;

pub fn is_overlay_open() -> bool {
    OVERLAY_ACTIVE.load(Ordering::SeqCst)
}

/// Requests cancellation of the active native selection overlay. The overlay
/// owns its message loop, so a thread message wakes it immediately instead of
/// waiting for another mouse or keyboard event.
pub fn cancel_capture_overlay() {
    #[cfg(windows)]
    {
        OVERLAY_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
        let thread_id = OVERLAY_THREAD_ID.load(Ordering::SeqCst);
        if thread_id != 0 {
            unsafe {
                let _ = PostThreadMessageW(
                    thread_id,
                    WM_CANCEL_OVERLAY,
                    windows::Win32::Foundation::WPARAM(0),
                    windows::Win32::Foundation::LPARAM(0),
                );
            }
        }
    }
}

pub fn open_capture_overlay(
    paths: Arc<AppPaths>,
    db: Arc<Database>,
    callback: Arc<dyn Fn(CaptureRecord) + Send + Sync + 'static>,
) -> Result<(), String> {
    open_capture_overlay_with_cancel(paths, db, callback, Arc::new(|| {}))
}

pub fn open_capture_overlay_with_cancel(
    paths: Arc<AppPaths>,
    db: Arc<Database>,
    callback: Arc<dyn Fn(CaptureRecord) + Send + Sync + 'static>,
    on_cancel: Arc<dyn Fn() + Send + Sync + 'static>,
) -> Result<(), String> {
    open_overlay(paths, db, callback, on_cancel, None)
}

/// Opens the same selection overlay but reports the chosen rectangle instead of
/// saving a capture.
pub fn open_region_selection_overlay(
    paths: Arc<AppPaths>,
    db: Arc<Database>,
    on_region: RegionCallback,
    on_cancel: Arc<dyn Fn() + Send + Sync + 'static>,
) -> Result<(), String> {
    open_overlay(paths, db, Arc::new(|_| {}), on_cancel, Some(on_region))
}

fn open_overlay(
    paths: Arc<AppPaths>,
    db: Arc<Database>,
    callback: Arc<dyn Fn(CaptureRecord) + Send + Sync + 'static>,
    on_cancel: Arc<dyn Fn() + Send + Sync + 'static>,
    region_callback: Option<RegionCallback>,
) -> Result<(), String> {
    if OVERLAY_ACTIVE.swap(true, Ordering::SeqCst) {
        return Ok(()); // Already active
    }
    #[cfg(windows)]
    OVERLAY_CANCEL_REQUESTED.store(false, Ordering::SeqCst);

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
                (on_cancel)();
                return;
            }
        };

        #[cfg(windows)]
        unsafe {
            run_overlay_window(snapshot, paths, db, callback, on_cancel, region_callback);
        }
        #[cfg(not(windows))]
        {
            (on_cancel)();
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
    on_cancel: Arc<dyn Fn() + Send + Sync>,
    /// Set for scrolling capture: report the rectangle, save nothing.
    region_callback: Option<RegionCallback>,
    is_dragging: bool,
    start_pt: POINT,
    current_pt: POINT,
    h_bg_bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    h_dimmed_bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
}

#[cfg(windows)]
unsafe fn run_overlay_window(
    snapshot: Arc<ScreenSnapshot>,
    paths: Arc<AppPaths>,
    db: Arc<Database>,
    callback: Arc<dyn Fn(CaptureRecord) + Send + Sync>,
    on_cancel: Arc<dyn Fn() + Send + Sync>,
    region_callback: Option<RegionCallback>,
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

    let hdc_screen = windows::Win32::Graphics::Gdi::GetDC(HWND(std::ptr::null_mut()));
    let hdc_mem = CreateCompatibleDC(hdc_screen);
    let h_bg_bitmap = CreateCompatibleBitmap(hdc_screen, snapshot.width as i32, snapshot.height as i32);
    let h_dimmed_bitmap = CreateCompatibleBitmap(hdc_screen, snapshot.width as i32, snapshot.height as i32);

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

    // 1. Prepare original BGRA buffer
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

    // 2. Pre-dim BGRA buffer for instant zero-cpu dim rendering
    let mut dimmed_buf = bgra_buf;
    for chunk in dimmed_buf.chunks_exact_mut(4) {
        chunk[0] = ((chunk[0] as u16 * 55) / 100) as u8;
        chunk[1] = ((chunk[1] as u16 * 55) / 100) as u8;
        chunk[2] = ((chunk[2] as u16 * 55) / 100) as u8;
    }

    windows::Win32::Graphics::Gdi::SetDIBits(
        hdc_mem,
        h_dimmed_bitmap,
        0,
        snapshot.height,
        dimmed_buf.as_ptr() as *const _,
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
        on_cancel: Arc::clone(&on_cancel),
        region_callback,
        is_dragging: false,
        start_pt: POINT { x: 0, y: 0 },
        current_pt: POINT { x: 0, y: 0 },
        h_bg_bitmap,
        h_dimmed_bitmap,
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
            (on_cancel)();
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

    OVERLAY_THREAD_ID.store(
        windows::Win32::System::Threading::GetCurrentThreadId(),
        Ordering::SeqCst,
    );
    if OVERLAY_CANCEL_REQUESTED.load(Ordering::SeqCst) {
        (on_cancel)();
        let _ = DestroyWindow(hwnd);
    }

    let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
    while GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0).as_bool() {
        if msg.message == WM_CANCEL_OVERLAY {
            (on_cancel)();
            let _ = DestroyWindow(hwnd);
            break;
        }
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    OVERLAY_THREAD_ID.store(0, Ordering::SeqCst);
}

#[cfg(windows)]
unsafe fn find_target_rect(pt: POINT, snapshot: &ScreenSnapshot, hwnd_overlay: HWND) -> (i32, i32, u32, u32, bool) {
    // 1. Check if there's a specific visible window or control under the cursor
    let hwnd_under = windows::Win32::UI::WindowsAndMessaging::WindowFromPoint(pt);
    if !hwnd_under.0.is_null() && hwnd_under != hwnd_overlay {
        let root = windows::Win32::UI::WindowsAndMessaging::GetAncestor(
            hwnd_under,
            windows::Win32::UI::WindowsAndMessaging::GA_ROOT,
        );
        let target_hwnd = if !root.0.is_null() && root != hwnd_overlay && windows::Win32::UI::WindowsAndMessaging::IsWindowVisible(root).as_bool() {
            root
        } else {
            hwnd_under
        };

        let mut rc = RECT::default();
        if windows::Win32::UI::WindowsAndMessaging::GetWindowRect(target_hwnd, &mut rc).is_ok() {
            let win_x = rc.left;
            let win_y = rc.top;
            let win_w = (rc.right - rc.left) as u32;
            let win_h = (rc.bottom - rc.top) as u32;

            // Check if within virtual screen bounds and not full screen
            if win_w >= 40 && win_h >= 40 && (win_w < snapshot.width || win_h < snapshot.height) {
                return (win_x, win_y, win_w, win_h, true);
            }
        }
    }

    // 2. Default to active monitor
    let h_mon = windows::Win32::Graphics::Gdi::MonitorFromPoint(
        pt,
        windows::Win32::Graphics::Gdi::MONITOR_DEFAULTTONEAREST,
    );
    let mut minfo = windows::Win32::Graphics::Gdi::MONITORINFOEXW::default();
    minfo.monitorInfo.cbSize = std::mem::size_of::<windows::Win32::Graphics::Gdi::MONITORINFOEXW>() as u32;
    if windows::Win32::Graphics::Gdi::GetMonitorInfoW(
        h_mon,
        &mut minfo.monitorInfo as *mut _ as *mut _,
    ).as_bool() {
        let rc = minfo.monitorInfo.rcMonitor;
        let mon_x = rc.left;
        let mon_y = rc.top;
        let mon_w = (rc.right - rc.left) as u32;
        let mon_h = (rc.bottom - rc.top) as u32;
        return (mon_x, mon_y, mon_w, mon_h, false);
    }

    (snapshot.x, snapshot.y, snapshot.width, snapshot.height, false)
}

#[inline]
fn get_pixel_color(snapshot: &ScreenSnapshot, pt: POINT) -> (u8, u8, u8) {
    let rel_x = pt.x - snapshot.x;
    let rel_y = pt.y - snapshot.y;
    if rel_x >= 0 && rel_x < snapshot.width as i32 && rel_y >= 0 && rel_y < snapshot.height as i32 {
        let idx = ((rel_y as usize * snapshot.width as usize) + rel_x as usize) * 4;
        if idx + 3 < snapshot.rgba_data.len() {
            return (snapshot.rgba_data[idx], snapshot.rgba_data[idx + 1], snapshot.rgba_data[idx + 2]);
        }
    }
    (0, 0, 0)
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
                if !state_ptr.is_null() {
                    ((*state_ptr).on_cancel)();
                }
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

                    if let Some(report) = state.region_callback.clone() {
                        // A scrolling capture needs a viewport, so a stray click
                        // snaps to the window under the cursor instead of
                        // producing a region too small to match.
                        // Hidden first: both the window snap and the target
                        // lookup below use WindowFromPoint, which would
                        // otherwise just find this overlay.
                        let _ = ShowWindow(hwnd, SW_HIDE);
                        let (region_x, region_y, region_w, region_h) = if sel_w >= 80 && sel_h >= 120 {
                            (sel_left, sel_top, sel_w, sel_h)
                        } else {
                            let (x, y, w, h, _) = find_target_rect(pt, &state.snapshot, hwnd);
                            (x, y, w, h)
                        };
                        let center = POINT {
                            x: region_x + (region_w / 2) as i32,
                            y: region_y + (region_h / 2) as i32,
                        };
                        let under = windows::Win32::UI::WindowsAndMessaging::WindowFromPoint(center);
                        let root = windows::Win32::UI::WindowsAndMessaging::GetAncestor(
                            under,
                            windows::Win32::UI::WindowsAndMessaging::GA_ROOT,
                        );
                        let target = if !root.0.is_null() { root } else { under };
                        report(SelectedRegion {
                            x: region_x,
                            y: region_y,
                            width: region_w,
                            height: region_h,
                            target: target.0 as isize,
                        });
                        let _ = DestroyWindow(hwnd);
                        return LRESULT(0);
                    }

                    if sel_w >= 6 && sel_h >= 6 {
                        let _ = ShowWindow(hwnd, SW_HIDE);

                        match state.snapshot.crop(sel_left, sel_top, sel_w, sel_h) {
                            Ok(cropped) => {
                                let _ = copy_rgba_to_clipboard(cropped.width, cropped.height, &cropped.rgba_data);

                                let capture_id = uuid::Uuid::new_v4().to_string();
                                if let Ok(record) = persist_capture(
                                    &state.db,
                                    &state.paths,
                                    &capture_id,
                                    "region",
                                    cropped.width,
                                    cropped.height,
                                    &cropped.rgba_data,
                                ) {
                                    (state.callback)(record);
                                }
                            }
                            Err(e) => {
                                eprintln!("Crop failed: {}", e);
                            }
                        }
                    } else {
                        // User clicked without dragging -> Auto snap to Window or Active Monitor!
                        let (target_x, target_y, target_w, target_h, is_window) = find_target_rect(pt, &state.snapshot, hwnd);

                        let _ = ShowWindow(hwnd, SW_HIDE);
                        match state.snapshot.crop(target_x, target_y, target_w, target_h) {
                            Ok(cropped) => {
                                let _ = copy_rgba_to_clipboard(cropped.width, cropped.height, &cropped.rgba_data);

                                let capture_id = uuid::Uuid::new_v4().to_string();
                                if let Ok(record) = persist_capture(
                                    &state.db,
                                    &state.paths,
                                    &capture_id,
                                    if is_window { "window" } else { "fullscreen" },
                                    cropped.width,
                                    cropped.height,
                                    &cropped.rgba_data,
                                ) {
                                    (state.callback)(record);
                                }
                            }
                            Err(e) => {
                                eprintln!("Target crop failed: {}", e);
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

                // Dimmed background DC
                let dim_dc = CreateCompatibleDC(hdc);
                let old_dim = SelectObject(dim_dc, state.h_dimmed_bitmap);

                // 1. Instant copy of pre-rendered dimmed screen (0ms)
                let _ = BitBlt(mem_dc, 0, 0, w, h, dim_dc, 0, 0, SRCCOPY);

                let cur_screen_x = state.current_pt.x - state.snapshot.x;
                let cur_screen_y = state.current_pt.y - state.snapshot.y;

                if state.is_dragging {
                    let c_start_x = state.start_pt.x - state.snapshot.x;
                    let c_start_y = state.start_pt.y - state.snapshot.y;
                    let c_curr_x = cur_screen_x;
                    let c_curr_y = cur_screen_y;

                    let left = c_start_x.min(c_curr_x);
                    let top = c_start_y.min(c_curr_y);
                    let right = c_start_x.max(c_curr_x);
                    let bottom = c_start_y.max(c_curr_y);
                    let sel_w = right - left;
                    let sel_h = bottom - top;

                    if sel_w > 0 && sel_h > 0 {
                        // 2. Instant copy of bright region from original screenshot
                        let src_dc = CreateCompatibleDC(hdc);
                        let old_src = SelectObject(src_dc, state.h_bg_bitmap);
                        let _ = BitBlt(mem_dc, left, top, sel_w, sel_h, src_dc, left, top, SRCCOPY);
                        let _ = SelectObject(src_dc, old_src);
                        let _ = DeleteDC(src_dc);

                        // 3. Draw clean cyan/blue border
                        let border_pen = CreatePen(PS_SOLID, 2, rgb(56, 189, 248));
                        let old_pen = SelectObject(mem_dc, border_pen);
                        let old_brush = SelectObject(mem_dc, GetStockObject(NULL_BRUSH));

                        let _ = windows::Win32::Graphics::Gdi::Rectangle(mem_dc, left, top, right, bottom);

                        // 4. Draw dimension badge
                        if sel_w > 50 && sel_h > 20 {
                            let size_text = format!("{} × {}", sel_w, sel_h);
                            let mut wide_text: Vec<u16> = size_text.encode_utf16().chain(std::iter::once(0)).collect();

                            let badge_w = 110;
                            let badge_h = 24;
                            let badge_x = left + 6;
                            let badge_y = if top > 30 { top - 28 } else { top + 6 };

                            let badge_rc = RECT {
                                left: badge_x,
                                top: badge_y,
                                right: badge_x + badge_w,
                                bottom: badge_y + badge_h,
                            };

                            let bg_badge_brush = CreateSolidBrush(rgb(15, 23, 42));
                            let _ = FillRect(mem_dc, &badge_rc, bg_badge_brush);
                            let _ = DeleteObject(bg_badge_brush);

                            let font = CreateFontW(
                                13, 0, 0, 0, FW_SEMIBOLD.0 as i32, 0, 0, 0, 0, 0, 0, 0, 0, w!("Segoe UI")
                            );
                            let old_font = SelectObject(mem_dc, font);
                            let _ = SetBkMode(mem_dc, BACKGROUND_MODE(1));
                            let _ = SetTextColor(mem_dc, rgb(255, 255, 255));

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
                    }
                } else {
                    // Not dragging: ShareX-Style Auto Window/Element Snapping + Crosshair Guide Lines!
                    let (target_x, target_y, target_w, target_h, is_window) = find_target_rect(state.current_pt, &state.snapshot, hwnd);
                    let target_rel_x = target_x - state.snapshot.x;
                    let target_rel_y = target_y - state.snapshot.y;

                    if target_w > 0 && target_h > 0 {
                        // Copy bright region for target window / monitor
                        let src_dc = CreateCompatibleDC(hdc);
                        let old_src = SelectObject(src_dc, state.h_bg_bitmap);
                        let _ = BitBlt(mem_dc, target_rel_x, target_rel_y, target_w as i32, target_h as i32, src_dc, target_rel_x, target_rel_y, SRCCOPY);
                        let _ = SelectObject(src_dc, old_src);
                        let _ = DeleteDC(src_dc);

                        // Draw glowing glowing cyan / orange border
                        let snap_pen = CreatePen(PS_SOLID, 2, if is_window { rgb(243, 111, 33) } else { rgb(56, 189, 248) });
                        let old_pen = SelectObject(mem_dc, snap_pen);
                        let old_brush = SelectObject(mem_dc, GetStockObject(NULL_BRUSH));

                        let _ = windows::Win32::Graphics::Gdi::Rectangle(
                            mem_dc,
                            target_rel_x,
                            target_rel_y,
                            target_rel_x + target_w as i32,
                            target_rel_y + target_h as i32,
                        );

                        // Draw top pill status badge
                        let label_prefix = if is_window { "🪟 Window" } else { "🖥️ Screen" };
                        let hint_text = format!("{} {} × {}  •  Click to capture  •  Drag to select region", label_prefix, target_w, target_h);
                        let mut wide_hint: Vec<u16> = hint_text.encode_utf16().chain(std::iter::once(0)).collect();

                        let badge_w = 460;
                        let badge_h = 30;
                        let badge_x = target_rel_x + (target_w as i32 - badge_w) / 2;
                        let badge_y = (target_rel_y + 16).max(12);

                        let badge_rc = RECT {
                            left: badge_x,
                            top: badge_y,
                            right: badge_x + badge_w,
                            bottom: badge_y + badge_h,
                        };

                        let bg_brush = CreateSolidBrush(rgb(15, 23, 42));
                        let _ = FillRect(mem_dc, &badge_rc, bg_brush);
                        let _ = DeleteObject(bg_brush);

                        let border_badge_pen = CreatePen(PS_SOLID, 1, if is_window { rgb(243, 111, 33) } else { rgb(56, 189, 248) });
                        let old_badge_pen = SelectObject(mem_dc, border_badge_pen);
                        let _ = windows::Win32::Graphics::Gdi::Rectangle(
                            mem_dc,
                            badge_x,
                            badge_y,
                            badge_x + badge_w,
                            badge_y + badge_h,
                        );
                        let _ = SelectObject(mem_dc, old_badge_pen);
                        let _ = DeleteObject(border_badge_pen);

                        let font = CreateFontW(
                            13, 0, 0, 0, FW_SEMIBOLD.0 as i32, 0, 0, 0, 0, 0, 0, 0, 0, w!("Segoe UI")
                        );
                        let old_font = SelectObject(mem_dc, font);
                        let _ = SetBkMode(mem_dc, BACKGROUND_MODE(1));
                        let _ = SetTextColor(mem_dc, rgb(255, 255, 255));

                        let mut text_rc = badge_rc;
                        let text_len = wide_hint.len();
                        let _ = DrawTextW(
                            mem_dc,
                            &mut wide_hint[..text_len - 1],
                            &mut text_rc,
                            DT_CENTER | DT_VCENTER | DT_SINGLELINE,
                        );

                        let _ = SelectObject(mem_dc, old_font);
                        let _ = DeleteObject(font);

                        let _ = SelectObject(mem_dc, old_brush);
                        let _ = SelectObject(mem_dc, old_pen);
                        let _ = DeleteObject(snap_pen);
                    }
                }

                // 4. ShareX-Style Full-Screen Magnetic Crosshair Lines
                let crosshair_pen = CreatePen(PS_SOLID, 1, rgb(56, 189, 248));
                let old_cross_pen = SelectObject(mem_dc, crosshair_pen);

                // Horizontal crosshair line
                let _ = windows::Win32::Graphics::Gdi::MoveToEx(mem_dc, 0, cur_screen_y, None);
                let _ = windows::Win32::Graphics::Gdi::LineTo(mem_dc, w, cur_screen_y);

                // Vertical crosshair line
                let _ = windows::Win32::Graphics::Gdi::MoveToEx(mem_dc, cur_screen_x, 0, None);
                let _ = windows::Win32::Graphics::Gdi::LineTo(mem_dc, cur_screen_x, h);

                let _ = SelectObject(mem_dc, old_cross_pen);
                let _ = DeleteObject(crosshair_pen);

                // 5. Pixel Loupe / Color HUD beside cursor
                let (r, g, b) = get_pixel_color(&state.snapshot, state.current_pt);
                let loupe_text = format!("X: {}  Y: {}\n#{:02X}{:02X}{:02X}", state.current_pt.x, state.current_pt.y, r, g, b);
                let mut wide_loupe: Vec<u16> = loupe_text.encode_utf16().chain(std::iter::once(0)).collect();

                let loupe_w = 120;
                let loupe_h = 42;
                let loupe_x = if cur_screen_x + 18 + loupe_w < w { cur_screen_x + 18 } else { cur_screen_x - loupe_w - 18 };
                let loupe_y = if cur_screen_y + 18 + loupe_h < h { cur_screen_y + 18 } else { cur_screen_y - loupe_h - 18 };

                let loupe_rc = RECT {
                    left: loupe_x,
                    top: loupe_y,
                    right: loupe_x + loupe_w,
                    bottom: loupe_y + loupe_h,
                };

                let bg_loupe = CreateSolidBrush(rgb(15, 23, 42));
                let _ = FillRect(mem_dc, &loupe_rc, bg_loupe);
                let _ = DeleteObject(bg_loupe);

                // Color swatch inside loupe
                let swatch_rc = RECT {
                    left: loupe_x + 6,
                    top: loupe_y + 6,
                    right: loupe_x + 22,
                    bottom: loupe_y + 22,
                };
                let swatch_brush = CreateSolidBrush(rgb(r, g, b));
                let _ = FillRect(mem_dc, &swatch_rc, swatch_brush);
                let _ = DeleteObject(swatch_brush);

                let loupe_border_pen = CreatePen(PS_SOLID, 1, rgb(56, 189, 248));
                let old_l_pen = SelectObject(mem_dc, loupe_border_pen);
                let old_l_brush = SelectObject(mem_dc, GetStockObject(NULL_BRUSH));
                let _ = windows::Win32::Graphics::Gdi::Rectangle(mem_dc, loupe_x, loupe_y, loupe_x + loupe_w, loupe_y + loupe_h);
                let _ = windows::Win32::Graphics::Gdi::Rectangle(mem_dc, swatch_rc.left, swatch_rc.top, swatch_rc.right, swatch_rc.bottom);
                let _ = SelectObject(mem_dc, old_l_brush);
                let _ = SelectObject(mem_dc, old_l_pen);
                let _ = DeleteObject(loupe_border_pen);

                let font_loupe = CreateFontW(
                    12, 0, 0, 0, FW_SEMIBOLD.0 as i32, 0, 0, 0, 0, 0, 0, 0, 0, w!("Segoe UI")
                );
                let old_l_font = SelectObject(mem_dc, font_loupe);
                let _ = SetBkMode(mem_dc, BACKGROUND_MODE(1));
                let _ = SetTextColor(mem_dc, rgb(255, 255, 255));

                let mut text_l_rc = RECT {
                    left: loupe_x + 28,
                    top: loupe_y + 4,
                    right: loupe_x + loupe_w - 4,
                    bottom: loupe_y + loupe_h - 4,
                };
                let text_l_len = wide_loupe.len();
                let _ = DrawTextW(
                    mem_dc,
                    &mut wide_loupe[..text_l_len - 1],
                    &mut text_l_rc,
                    DT_LEFT | DT_VCENTER,
                );

                let _ = SelectObject(mem_dc, old_l_font);
                let _ = DeleteObject(font_loupe);

                // 6. Final blit to screen (smooth 240Hz zero-flicker)
                let _ = BitBlt(hdc, 0, 0, w, h, mem_dc, 0, 0, SRCCOPY);

                let _ = SelectObject(dim_dc, old_dim);
                let _ = DeleteDC(dim_dc);

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
                let _ = DeleteObject(state.h_dimmed_bitmap);
            }
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}
