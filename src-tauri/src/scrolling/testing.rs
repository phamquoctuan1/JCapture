//! Deterministic frame fixtures shared by the scrolling capture unit tests.

use super::frame::Frame;

/// Builds a tall page whose rows are unique, so a matcher that locks onto the
/// wrong seam produces a visibly wrong offset instead of an accidental pass.
pub fn synthetic_page(width: u32, height: u32, seed: u32) -> Frame {
    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    for y in 0..height {
        // Rows alternate between "text like" high contrast runs and calmer
        // background bands, mirroring a document layout.
        let band = ((y / 17 + seed) % 3) as u8;
        for x in 0..width {
            let noise = hash(x.wrapping_mul(2654435761), y.wrapping_add(seed).wrapping_mul(40503));
            let base = match band {
                0 => 235u8,
                1 => 120u8,
                _ => 40u8,
            };
            let value = base.wrapping_add((noise % 61) as u8);
            let index = (y as usize * width as usize + x as usize) * 4;
            rgba[index] = value;
            rgba[index + 1] = value.wrapping_add((noise >> 3) as u8 % 13);
            rgba[index + 2] = value.wrapping_sub((noise >> 5) as u8 % 17);
            rgba[index + 3] = 255;
        }
    }
    Frame::new(width, height, rgba).expect("synthetic page is well formed")
}

/// Crops a viewport-sized window out of `page` at scroll position `scroll_y`.
pub fn scroll_view(page: &Frame, scroll_y: u32, view_height: u32) -> Frame {
    let stride = page.width as usize * 4;
    let start = scroll_y as usize * stride;
    let end = start + view_height as usize * stride;
    assert!(end <= page.rgba.len(), "scroll view exceeds the page");
    Frame::new(page.width, view_height, page.rgba[start..end].to_vec())
        .expect("scroll view is well formed")
}

/// Overwrites the top `height` rows of `frame` with a constant sticky banner.
pub fn with_sticky_top(frame: &Frame, banner: &Frame, height: u32) -> Frame {
    let stride = frame.width as usize * 4;
    let mut rgba = frame.rgba.clone();
    let rows = height as usize * stride;
    rgba[..rows].copy_from_slice(&banner.rgba[..rows]);
    Frame::new(frame.width, frame.height, rgba).expect("sticky frame is well formed")
}

fn hash(a: u32, b: u32) -> u32 {
    let mut value = a ^ b.wrapping_mul(0x9E37_79B9);
    value ^= value >> 15;
    value = value.wrapping_mul(0x85EB_CA6B);
    value ^= value >> 13;
    value
}
