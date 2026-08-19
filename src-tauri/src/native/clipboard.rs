#[cfg(windows)]
use windows::Win32::Foundation::HWND;
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{BITMAPINFOHEADER, BI_RGB};
#[cfg(windows)]
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
#[cfg(windows)]
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

pub fn copy_rgba_to_clipboard(width: u32, height: u32, rgba_data: &[u8]) -> Result<(), String> {
    if width == 0 || height == 0 || rgba_data.len() < (width * height * 4) as usize {
        return Err("Invalid image dimensions or buffer size".to_string());
    }

    #[cfg(windows)]
    unsafe {
        // Open clipboard
        if OpenClipboard(HWND(std::ptr::null_mut())).is_err() {
            return Err("Failed to open Windows clipboard".to_string());
        }

        let _ = EmptyClipboard();

        let header_size = std::mem::size_of::<BITMAPINFOHEADER>();
        let row_stride = (width * 4) as usize;
        let image_data_size = row_stride * (height as usize);
        let total_size = header_size + image_data_size;

        let h_mem = match GlobalAlloc(GMEM_MOVEABLE, total_size) {
            Ok(handle) => handle,
            Err(e) => {
                let _ = CloseClipboard();
                return Err(format!("GlobalAlloc failed: {}", e));
            }
        };

        let p_mem = GlobalLock(h_mem) as *mut u8;
        if p_mem.is_null() {
            let _ = CloseClipboard();
            return Err("GlobalLock failed".to_string());
        }

        // Fill BITMAPINFOHEADER
        let header = BITMAPINFOHEADER {
            biSize: header_size as u32,
            biWidth: width as i32,
            biHeight: height as i32, // Positive = bottom-up (standard for CF_DIB)
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: image_data_size as u32,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };

        std::ptr::copy_nonoverlapping(
            &header as *const _ as *const u8,
            p_mem,
            header_size,
        );

        let dest_pixels = p_mem.add(header_size);

        // Convert RGBA top-down to BGRA bottom-up
        for y in 0..height {
            let src_row = y as usize;
            let dst_row = (height - 1 - y) as usize;

            let src_offset = src_row * (width as usize) * 4;
            let dst_offset = dst_row * (width as usize) * 4;

            for x in 0..(width as usize) {
                let s_idx = src_offset + x * 4;
                let d_idx = dst_offset + x * 4;

                let r = rgba_data[s_idx];
                let g = rgba_data[s_idx + 1];
                let b = rgba_data[s_idx + 2];
                let a = rgba_data[s_idx + 3];

                *dest_pixels.add(d_idx) = b;
                *dest_pixels.add(d_idx + 1) = g;
                *dest_pixels.add(d_idx + 2) = r;
                *dest_pixels.add(d_idx + 3) = a;
            }
        }

        let _ = GlobalUnlock(h_mem);

        // 8 is CF_DIB
        if let Err(e) = SetClipboardData(8, windows::Win32::Foundation::HANDLE(h_mem.0)) {
            let _ = CloseClipboard();
            return Err(format!("SetClipboardData failed: {}", e));
        }

        let _ = CloseClipboard();
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err("Clipboard copy not supported on non-Windows platform".to_string())
    }
}
