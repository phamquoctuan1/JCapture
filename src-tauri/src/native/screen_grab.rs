#[cfg(windows)]
use windows::Win32::Foundation::{BOOL, LPARAM, RECT, HWND};
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
    GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    SRCCOPY, HDC, HMONITOR, EnumDisplayMonitors, MONITORINFOEXW, GetMonitorInfoW,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

#[derive(Debug, Clone)]
pub struct ScreenSnapshot {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub rgba_data: Vec<u8>,
}

#[cfg(windows)]
struct MonitorContext {
    hdc_mem: HDC,
    vir_x: i32,
    vir_y: i32,
}

#[cfg(windows)]
unsafe extern "system" fn enum_monitor_callback(
    hmon: HMONITOR,
    hdc_mon: HDC,
    _rect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut MonitorContext);
    let mut minfo = MONITORINFOEXW::default();
    minfo.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(hmon, &mut minfo.monitorInfo as *mut _ as *mut _).as_bool() {
        let rc = minfo.monitorInfo.rcMonitor;
        let mon_w = rc.right - rc.left;
        let mon_h = rc.bottom - rc.top;
        let dest_x = rc.left - ctx.vir_x;
        let dest_y = rc.top - ctx.vir_y;

        let _ = BitBlt(ctx.hdc_mem, dest_x, dest_y, mon_w, mon_h, hdc_mon, rc.left, rc.top, SRCCOPY);
    }
    BOOL(1)
}

impl ScreenSnapshot {
    pub fn capture_virtual_screen() -> Result<Self, String> {
        #[cfg(windows)]
        unsafe {
            let _ = windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(
                windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            );

            let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);

            if w <= 0 || h <= 0 {
                return Err("Failed to obtain virtual screen bounds".to_string());
            }

            let width = w as u32;
            let height = h as u32;

            let hdc_screen = GetDC(HWND(std::ptr::null_mut()));
            if hdc_screen.0.is_null() {
                return Err("Failed to get screen DC".to_string());
            }

            let hdc_mem = CreateCompatibleDC(hdc_screen);
            if hdc_mem.0.is_null() {
                let _ = ReleaseDC(HWND(std::ptr::null_mut()), hdc_screen);
                return Err("Failed to create compatible DC".to_string());
            }

            let h_bitmap = CreateCompatibleBitmap(hdc_screen, w, h);
            if h_bitmap.0.is_null() {
                let _ = DeleteDC(hdc_mem);
                let _ = ReleaseDC(HWND(std::ptr::null_mut()), hdc_screen);
                return Err("Failed to create compatible bitmap".to_string());
            }

            let old_obj = SelectObject(hdc_mem, h_bitmap);

            let mut ctx = MonitorContext {
                hdc_mem,
                vir_x: x,
                vir_y: y,
            };

            let _ = EnumDisplayMonitors(
                hdc_screen,
                None,
                Some(enum_monitor_callback),
                LPARAM(&mut ctx as *mut _ as isize),
            );

            // Prepare BITMAPINFO for GetDIBits (top-down with -height)
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // Negative for top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default()],
            };

            let pixel_count = (width * height) as usize;
            let mut buffer = vec![0u8; pixel_count * 4];

            let lines = GetDIBits(
                hdc_mem,
                h_bitmap,
                0,
                height,
                Some(buffer.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            // Cleanup GDI objects
            let _ = SelectObject(hdc_mem, old_obj);
            let _ = DeleteObject(h_bitmap);
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(HWND(std::ptr::null_mut()), hdc_screen);

            if lines == 0 {
                return Err("GetDIBits failed to extract pixel data".to_string());
            }

            // Convert BGRA to RGBA and set Alpha to 255
            for chunk in buffer.chunks_exact_mut(4) {
                let b = chunk[0];
                let r = chunk[2];
                chunk[0] = r;
                chunk[2] = b;
                chunk[3] = 255;
            }

            Ok(ScreenSnapshot {
                x,
                y,
                width,
                height,
                rgba_data: buffer,
            })
        }

        #[cfg(not(windows))]
        {
            Err("Screen capture only supported on Windows".to_string())
        }
    }

    pub fn crop(&self, crop_x: i32, crop_y: i32, crop_w: u32, crop_h: u32) -> Result<Self, String> {
        if crop_w == 0 || crop_h == 0 {
            return Err("Invalid crop dimensions".to_string());
        }

        // Relative coordinates to snapshot
        let rel_x = (crop_x - self.x).max(0) as u32;
        let rel_y = (crop_y - self.y).max(0) as u32;

        if rel_x >= self.width || rel_y >= self.height {
            return Err("Crop starting position outside screen".to_string());
        }

        let actual_w = crop_w.min(self.width.saturating_sub(rel_x));
        let actual_h = crop_h.min(self.height.saturating_sub(rel_y));

        if actual_w == 0 || actual_h == 0 {
            return Err("Actual crop size is 0".to_string());
        }

        let mut cropped_buffer = vec![0u8; (actual_w * actual_h * 4) as usize];
        let src_stride = (self.width * 4) as usize;
        let dst_stride = (actual_w * 4) as usize;

        for row in 0..actual_h {
            let src_offset = ((rel_y as usize + row as usize) * src_stride) + (rel_x as usize * 4);
            let dst_offset = row as usize * dst_stride;

            cropped_buffer[dst_offset..dst_offset + dst_stride]
                .copy_from_slice(&self.rgba_data[src_offset..src_offset + dst_stride]);
        }

        Ok(ScreenSnapshot {
            x: crop_x,
            y: crop_y,
            width: actual_w,
            height: actual_h,
            rgba_data: cropped_buffer,
        })
    }
}
