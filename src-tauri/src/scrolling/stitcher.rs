//! Streaming image stitcher.
//!
//! The stitcher never keeps the captured frames around. It holds the output
//! buffer plus, briefly, the first frame - the first frame cannot be written
//! until the fixed regions are known, which only happens once a second frame
//! exists. Everything after that is appended row by row and dropped.
//!
//! Layout of the finished image:
//!
//! ```text
//! [ sticky header      ]  once, from the first frame
//! [ content of frame 1 ]
//! [ new rows of frame 2]  only the rows the overlap detector proved are new
//! [ new rows of frame 3]
//! ...
//! [ sticky footer      ]  once, from the last frame
//! ```

use super::frame::Frame;
use super::overlap::FixedRegions;

/// What an append actually contributed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppendOutcome {
    pub rows_added: u32,
    /// True when the output hit its height limit and the frame was clipped.
    pub saturated: bool,
}

pub struct ImageStitcher {
    width: u32,
    frame_height: u32,
    max_rows: u32,
    fixed: FixedRegions,
    pending_first: Option<Frame>,
    buffer: Vec<u8>,
    rows: u32,
}

impl ImageStitcher {
    pub fn new(width: u32, frame_height: u32, max_rows: u32) -> Self {
        Self {
            width,
            frame_height,
            max_rows: max_rows.max(frame_height),
            fixed: FixedRegions::NONE,
            pending_first: None,
            buffer: Vec::new(),
            rows: 0,
        }
    }

    /// Seeds the output with the first captured frame.
    pub fn initialize(&mut self, frame: Frame) {
        self.pending_first = Some(frame);
        self.buffer.clear();
        self.rows = 0;
    }

    /// Records the fixed regions. Ignored once the first frame has been
    /// flushed, because by then the header is already part of the output.
    pub fn set_fixed_regions(&mut self, fixed: FixedRegions) {
        if self.pending_first.is_some() {
            self.fixed = fixed;
        }
    }

    /// Total rows written so far, including the not yet flushed first frame.
    pub fn total_rows(&self) -> u32 {
        if let Some(frame) = &self.pending_first {
            frame.height.saturating_sub(self.fixed.bottom)
        } else {
            self.rows
        }
    }

    pub fn is_full(&self) -> bool {
        self.total_rows() >= self.max_rows
    }

    /// Appends the `offset` rows of `frame` that the overlap detector proved
    /// are new content. Nothing else from the frame is copied, so duplicated
    /// area is removed by construction rather than by cropping a scroll amount.
    pub fn append(&mut self, frame: &Frame, offset: u32) -> Result<AppendOutcome, String> {
        if frame.width != self.width || frame.height != self.frame_height {
            return Err("Kích thước khung chụp thay đổi giữa chừng".into());
        }
        self.flush_first()?;
        let content_bottom = frame.height.saturating_sub(self.fixed.bottom);
        let content_height = content_bottom.saturating_sub(self.fixed.top);
        let mut rows_added = offset.min(content_height);
        if rows_added == 0 {
            return Ok(AppendOutcome {
                rows_added: 0,
                saturated: self.is_full(),
            });
        }
        let remaining = self.max_rows.saturating_sub(self.rows);
        let saturated = rows_added >= remaining;
        rows_added = rows_added.min(remaining);
        if rows_added > 0 {
            frame.append_rgba_rows(content_bottom - rows_added, rows_added, &mut self.buffer);
            self.rows += rows_added;
        }
        Ok(AppendOutcome {
            rows_added,
            saturated,
        })
    }

    /// Writes the sticky footer from the last frame and returns the image.
    pub fn finish(mut self, last_frame: &Frame) -> Result<(u32, u32, Vec<u8>), String> {
        self.flush_first()?;
        if self.fixed.bottom > 0
            && last_frame.width == self.width
            && last_frame.height == self.frame_height
        {
            let start = last_frame.height - self.fixed.bottom;
            last_frame.append_rgba_rows(start, self.fixed.bottom, &mut self.buffer);
            self.rows += self.fixed.bottom;
        }
        if self.rows == 0 {
            return Err("Không có nội dung nào được ghép".into());
        }
        Ok((self.width, self.rows, self.buffer))
    }

    /// Writes the header and the whole scrollable area of the first frame.
    fn flush_first(&mut self) -> Result<(), String> {
        let Some(frame) = self.pending_first.take() else {
            return Ok(());
        };
        let content_bottom = frame.height.saturating_sub(self.fixed.bottom);
        if content_bottom == 0 {
            return Err("Vùng cuộn rỗng sau khi loại bỏ vùng cố định".into());
        }
        frame.append_rgba_rows(0, content_bottom, &mut self.buffer);
        self.rows += content_bottom;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scrolling::testing::{scroll_view, synthetic_page, with_sticky_top};

    fn row_bytes(image: &(u32, u32, Vec<u8>), y: u32) -> &[u8] {
        let stride = image.0 as usize * 4;
        let start = y as usize * stride;
        &image.2[start..start + stride]
    }

    #[test]
    fn reproduces_the_original_page_from_overlapping_frames() {
        // A B C D / C D E F must stitch back to A B C D E F.
        let page = synthetic_page(64, 600, 5);
        let mut stitcher = ImageStitcher::new(64, 200, 10_000);
        stitcher.initialize(scroll_view(&page, 0, 200));
        for step in 1..=3 {
            let scroll_y = step * 120;
            let frame = scroll_view(&page, scroll_y, 200);
            let outcome = stitcher.append(&frame, 120).unwrap();
            assert_eq!(outcome.rows_added, 120);
        }
        let last = scroll_view(&page, 360, 200);
        let image = stitcher.finish(&last).unwrap();
        assert_eq!(image.1, 560);
        for y in 0..560 {
            assert_eq!(
                row_bytes(&image, y),
                &page.rgba_row(y)[..],
                "row {} does not match the source page",
                y
            );
        }
    }

    #[test]
    fn keeps_a_sticky_header_only_once() {
        let page = synthetic_page(64, 800, 7);
        let banner = synthetic_page(64, 40, 31);
        let mut stitcher = ImageStitcher::new(64, 200, 10_000);
        stitcher.initialize(with_sticky_top(&scroll_view(&page, 0, 200), &banner, 40));
        stitcher.set_fixed_regions(FixedRegions { top: 40, bottom: 0 });
        let second = with_sticky_top(&scroll_view(&page, 100, 200), &banner, 40);
        stitcher.append(&second, 100).unwrap();
        let image = stitcher.finish(&second).unwrap();

        assert_eq!(image.1, 300);
        // The banner appears once, at the top.
        assert_eq!(row_bytes(&image, 0), &banner.rgba_row(0)[..]);
        for y in 40..300u32 {
            assert_ne!(
                row_bytes(&image, y),
                &banner.rgba_row(0)[..],
                "banner repeated at row {}",
                y
            );
        }
    }

    #[test]
    fn appends_a_sticky_footer_from_the_last_frame() {
        let page = synthetic_page(64, 800, 13);
        let footer = synthetic_page(64, 30, 41);
        let stride = 64 * 4usize;
        let make = |scroll_y: u32| {
            let base = scroll_view(&page, scroll_y, 200);
            let mut rgba = base.rgba.clone();
            rgba[(200 - 30) * stride..].copy_from_slice(&footer.rgba[..30 * stride]);
            Frame::new(64, 200, rgba).unwrap()
        };
        let mut stitcher = ImageStitcher::new(64, 200, 10_000);
        stitcher.initialize(make(0));
        stitcher.set_fixed_regions(FixedRegions { top: 0, bottom: 30 });
        let second = make(100);
        stitcher.append(&second, 100).unwrap();
        let image = stitcher.finish(&second).unwrap();

        // 170 content rows from frame one, 100 new rows, 30 footer rows.
        assert_eq!(image.1, 300);
        assert_eq!(row_bytes(&image, 299), &footer.rgba_row(29)[..]);
    }

    #[test]
    fn stops_growing_at_the_row_limit() {
        let page = synthetic_page(64, 800, 17);
        let mut stitcher = ImageStitcher::new(64, 200, 260);
        stitcher.initialize(scroll_view(&page, 0, 200));
        let outcome = stitcher.append(&scroll_view(&page, 100, 200), 100).unwrap();
        assert_eq!(outcome.rows_added, 60);
        assert!(outcome.saturated);
        assert!(stitcher.is_full());
    }

    #[test]
    fn rejects_a_frame_whose_size_changed() {
        let page = synthetic_page(64, 800, 19);
        let mut stitcher = ImageStitcher::new(64, 200, 10_000);
        stitcher.initialize(scroll_view(&page, 0, 200));
        let odd = scroll_view(&page, 100, 180);
        assert!(stitcher.append(&odd, 100).is_err());
    }
}
