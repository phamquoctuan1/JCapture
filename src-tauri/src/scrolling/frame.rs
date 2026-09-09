//! Frame representation shared by every scrolling capture component.
//!
//! A frame keeps the original RGBA pixels for stitching and a grayscale copy
//! for matching. Matching never touches RGBA: grayscale is smaller, cheaper to
//! scan, and removes colour noise from subpixel text rendering.

/// A single captured viewport frame.
#[derive(Clone)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    /// Original pixels, 4 bytes per pixel, row major.
    pub rgba: Vec<u8>,
    /// Luma copy, 1 byte per pixel, row major.
    pub gray: Vec<u8>,
}

impl std::fmt::Debug for Frame {
    /// Printed by size only: a frame holds megabytes of pixels and a test
    /// failure message should stay readable.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "Frame({}x{})", self.width, self.height)
    }
}

impl Frame {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>) -> Result<Self, String> {
        let expected = width as usize * height as usize * 4;
        if width == 0 || height == 0 {
            return Err("Frame size must not be zero".into());
        }
        if rgba.len() != expected {
            return Err(format!(
                "Frame buffer is {} bytes but {}x{} needs {}",
                rgba.len(),
                width,
                height,
                expected
            ));
        }
        let gray = rgba_to_gray(&rgba);
        Ok(Self {
            width,
            height,
            rgba,
            gray,
        })
    }

    #[inline]
    pub fn gray_row(&self, y: u32) -> &[u8] {
        let start = y as usize * self.width as usize;
        &self.gray[start..start + self.width as usize]
    }

    #[inline]
    pub fn rgba_row(&self, y: u32) -> &[u8] {
        let stride = self.width as usize * 4;
        let start = y as usize * stride;
        &self.rgba[start..start + stride]
    }

    /// Copies `count` RGBA rows starting at `from_y` into `out`.
    pub fn append_rgba_rows(&self, from_y: u32, count: u32, out: &mut Vec<u8>) {
        let stride = self.width as usize * 4;
        let start = from_y as usize * stride;
        let end = start + count as usize * stride;
        out.extend_from_slice(&self.rgba[start..end]);
    }

    /// Box-filtered grayscale copy at `1 / factor` resolution.
    ///
    /// Downscaling before the coarse offset search cuts the search cost by
    /// `factor^3` while keeping enough structure for text and UI edges.
    pub fn gray_downscaled(&self, factor: u32) -> GrayImage {
        downscale_gray(&self.gray, self.width, self.height, factor)
    }
}

/// A plain grayscale buffer used by the coarse matching pass.
#[derive(Clone)]
pub struct GrayImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl GrayImage {
    #[inline]
    pub fn row(&self, y: u32) -> &[u8] {
        let start = y as usize * self.width as usize;
        &self.data[start..start + self.width as usize]
    }
}

fn rgba_to_gray(rgba: &[u8]) -> Vec<u8> {
    let mut gray = Vec::with_capacity(rgba.len() / 4);
    for pixel in rgba.chunks_exact(4) {
        // Integer BT.601 luma. Keeps the conversion allocation free and
        // deterministic across platforms.
        let value = (pixel[0] as u32 * 77 + pixel[1] as u32 * 150 + pixel[2] as u32 * 29) >> 8;
        gray.push(value as u8);
    }
    gray
}

fn downscale_gray(gray: &[u8], width: u32, height: u32, factor: u32) -> GrayImage {
    let factor = factor.max(1);
    if factor == 1 {
        return GrayImage {
            width,
            height,
            data: gray.to_vec(),
        };
    }
    let out_width = (width / factor).max(1);
    let out_height = (height / factor).max(1);
    let mut data = vec![0u8; out_width as usize * out_height as usize];
    for out_y in 0..out_height {
        for out_x in 0..out_width {
            let mut sum = 0u32;
            for dy in 0..factor {
                let src_y = out_y * factor + dy;
                let row_start = src_y as usize * width as usize;
                for dx in 0..factor {
                    let src_x = out_x * factor + dx;
                    sum += gray[row_start + src_x as usize] as u32;
                }
            }
            data[out_y as usize * out_width as usize + out_x as usize] =
                (sum / (factor * factor)) as u8;
        }
    }
    GrayImage {
        width: out_width,
        height: out_height,
        data,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, value: u8) -> Frame {
        let rgba = vec![value; width as usize * height as usize * 4];
        Frame::new(width, height, rgba).unwrap()
    }

    #[test]
    fn rejects_buffer_with_wrong_length() {
        let error = Frame::new(4, 4, vec![0; 10]).unwrap_err();
        assert!(error.contains("needs"));
    }

    #[test]
    fn converts_rgba_to_luma() {
        let frame = Frame::new(1, 1, vec![255, 255, 255, 255]).unwrap();
        assert!(frame.gray[0] >= 250);
        let black = Frame::new(1, 1, vec![0, 0, 0, 255]).unwrap();
        assert_eq!(black.gray[0], 0);
    }

    #[test]
    fn downscale_averages_blocks() {
        let mut frame = solid(8, 8, 0);
        for y in 0..4 {
            for x in 0..8 {
                let index = (y * 8 + x) * 4;
                frame.rgba[index] = 255;
                frame.rgba[index + 1] = 255;
                frame.rgba[index + 2] = 255;
            }
        }
        let frame = Frame::new(8, 8, frame.rgba).unwrap();
        let small = frame.gray_downscaled(4);
        assert_eq!(small.width, 2);
        assert_eq!(small.height, 2);
        assert!(small.row(0)[0] > 200);
        assert_eq!(small.row(1)[0], 0);
    }

    #[test]
    fn appends_requested_rgba_rows() {
        let frame = solid(2, 4, 7);
        let mut out = Vec::new();
        frame.append_rgba_rows(1, 2, &mut out);
        assert_eq!(out.len(), 2 * 2 * 4);
    }
}
