//! Sticky header / fixed footer detection.
//!
//! A sticky header stays pixel identical while the rest of the viewport moves.
//! Without special handling it would be matched as content and repeated once
//! per frame in the stitched output. The detector therefore looks for the run
//! of identical rows anchored at the top (and at the bottom) of a frame pair
//! whose middle rows changed.
//!
//! Only pairs where the viewport actually moved are inspected: before the first
//! scroll every row is identical, which says nothing about stickiness.

use super::frame::Frame;
use super::overlap::FixedRegions;

#[derive(Debug, Clone, Copy)]
pub struct FixedRegionConfig {
    /// Mean absolute grayscale difference below which a row counts as unchanged.
    pub row_tolerance: f32,
    /// Row variance a row needs before it can anchor a fixed region. Blank rows
    /// are identical everywhere and must not extend the region on their own.
    pub min_row_variance: f32,
    /// Upper bound for a single fixed band, as a fraction of frame height.
    pub max_band_ratio: f32,
    /// Matching band, mirroring `OverlapConfig`, so a moving scrollbar thumb
    /// cannot mask a header.
    pub band_start_ratio: f32,
    pub band_end_ratio: f32,
}

impl Default for FixedRegionConfig {
    fn default() -> Self {
        Self {
            row_tolerance: 2.5,
            min_row_variance: 6.0,
            max_band_ratio: 0.4,
            band_start_ratio: 0.2,
            band_end_ratio: 0.8,
        }
    }
}

pub struct FixedRegionDetector {
    config: FixedRegionConfig,
    observed: Option<FixedRegions>,
}

impl FixedRegionDetector {
    pub fn new(config: FixedRegionConfig) -> Self {
        Self {
            config,
            observed: None,
        }
    }

    /// Fixed regions agreed on by every observed frame pair so far.
    pub fn current(&self) -> FixedRegions {
        self.observed.unwrap_or(FixedRegions::NONE)
    }

    /// Feeds one frame pair to the detector and returns the updated estimate.
    ///
    /// Pairs where the viewport did not move are skipped: before the first
    /// scroll every row is identical, which says nothing about stickiness. The
    /// check is made on the middle of the frame so it does not depend on the
    /// measured offset - the offset is what this estimate feeds into.
    ///
    /// Pairs are combined with a minimum: a band has to hold across every pair
    /// to be treated as fixed, so one accidentally repeated row cannot start
    /// eating real content.
    pub fn observe(&mut self, previous: &Frame, current: &Frame) -> FixedRegions {
        if previous.width != current.width
            || previous.height != current.height
            || !self.viewport_moved(previous, current)
        {
            return self.current();
        }
        let measured = self.measure(previous, current);
        self.observed = Some(match self.observed {
            Some(existing) => FixedRegions {
                top: existing.top.min(measured.top),
                bottom: existing.bottom.min(measured.bottom),
            },
            None => measured,
        });
        self.current()
    }

    /// True when the middle of the viewport changed, which is where content
    /// lives regardless of how tall the sticky bands turn out to be.
    fn viewport_moved(&self, previous: &Frame, current: &Frame) -> bool {
        let width = previous.width;
        let left = (width as f32 * self.config.band_start_ratio) as u32;
        let right = ((width as f32 * self.config.band_end_ratio) as u32)
            .min(width)
            .max(left + 1);
        let first = (previous.height as f32 * 0.45) as u32;
        let last = ((previous.height as f32 * 0.55) as u32).max(first + 1);
        for y in first..last.min(previous.height) {
            if !self.rows_match(previous, current, y, y, left, right) {
                return true;
            }
        }
        false
    }

    fn measure(&self, previous: &Frame, current: &Frame) -> FixedRegions {
        let width = previous.width;
        let height = previous.height;
        let left = (width as f32 * self.config.band_start_ratio) as u32;
        let right = ((width as f32 * self.config.band_end_ratio) as u32)
            .min(width)
            .max(left + 1);
        let max_band = (height as f32 * self.config.max_band_ratio) as u32;

        let mut top = 0u32;
        let mut top_anchor = 0u32;
        while top < max_band {
            if !self.rows_match(previous, current, top, top, left, right) {
                break;
            }
            top += 1;
            if self.row_variance(current, top - 1, left, right) >= self.config.min_row_variance {
                top_anchor = top;
            }
        }

        let mut bottom = 0u32;
        let mut bottom_anchor = 0u32;
        while bottom < max_band {
            let y = height - 1 - bottom;
            if !self.rows_match(previous, current, y, y, left, right) {
                break;
            }
            bottom += 1;
            if self.row_variance(current, y, left, right) >= self.config.min_row_variance {
                bottom_anchor = bottom;
            }
        }

        // Never let the fixed bands swallow the scrollable area.
        if top_anchor + bottom_anchor > (height as f32 * 0.7) as u32 {
            return FixedRegions::NONE;
        }
        FixedRegions {
            top: top_anchor,
            bottom: bottom_anchor,
        }
    }

    fn rows_match(
        &self,
        previous: &Frame,
        current: &Frame,
        previous_y: u32,
        current_y: u32,
        left: u32,
        right: u32,
    ) -> bool {
        let previous_row = previous.gray_row(previous_y);
        let current_row = current.gray_row(current_y);
        let mut sum = 0u32;
        let mut count = 0u32;
        for x in left..right {
            sum += previous_row[x as usize].abs_diff(current_row[x as usize]) as u32;
            count += 1;
        }
        if count == 0 {
            return false;
        }
        (sum as f32 / count as f32) <= self.config.row_tolerance
    }

    fn row_variance(&self, frame: &Frame, y: u32, left: u32, right: u32) -> f32 {
        let row = frame.gray_row(y);
        let mut sum = 0f64;
        let mut sum_squares = 0f64;
        let mut count = 0f64;
        for x in left..right {
            let value = row[x as usize] as f64;
            sum += value;
            sum_squares += value * value;
            count += 1.0;
        }
        if count == 0.0 {
            return 0.0;
        }
        ((sum_squares - sum * sum / count) / count) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scrolling::testing::{scroll_view, synthetic_page, with_sticky_top};

    #[test]
    fn detects_a_sticky_header() {
        let page = synthetic_page(320, 1200, 4);
        let banner = synthetic_page(320, 64, 88);
        let previous = with_sticky_top(&scroll_view(&page, 0, 400), &banner, 64);
        let current = with_sticky_top(&scroll_view(&page, 200, 400), &banner, 64);
        let mut detector = FixedRegionDetector::new(FixedRegionConfig::default());
        let fixed = detector.observe(&previous, &current);
        assert_eq!(fixed.top, 64);
        assert_eq!(fixed.bottom, 0);
    }

    #[test]
    fn reports_nothing_when_the_whole_viewport_scrolls() {
        let page = synthetic_page(320, 1200, 6);
        let previous = scroll_view(&page, 0, 400);
        let current = scroll_view(&page, 220, 400);
        let mut detector = FixedRegionDetector::new(FixedRegionConfig::default());
        assert_eq!(
            detector.observe(&previous, &current),
            FixedRegions::NONE
        );
    }

    #[test]
    fn ignores_pairs_that_did_not_scroll() {
        let page = synthetic_page(320, 900, 2);
        let frame = scroll_view(&page, 0, 400);
        let mut detector = FixedRegionDetector::new(FixedRegionConfig::default());
        assert_eq!(detector.observe(&frame, &frame), FixedRegions::NONE);
    }

    #[test]
    fn keeps_the_smallest_band_seen_across_pairs() {
        let page = synthetic_page(320, 1600, 8);
        let banner = synthetic_page(320, 80, 15);
        let mut detector = FixedRegionDetector::new(FixedRegionConfig::default());
        let a = with_sticky_top(&scroll_view(&page, 0, 400), &banner, 80);
        let b = with_sticky_top(&scroll_view(&page, 200, 400), &banner, 80);
        assert_eq!(detector.observe(&a, &b).top, 80);

        // A later pair only shares the first 40 rows: the header shrank.
        let c = with_sticky_top(&scroll_view(&page, 400, 400), &banner, 40);
        let d = with_sticky_top(&scroll_view(&page, 600, 400), &banner, 40);
        assert_eq!(detector.observe(&c, &d).top, 40);
    }

    #[test]
    fn blank_rows_alone_do_not_create_a_fixed_band() {
        let page = synthetic_page(320, 1200, 12);
        let blank = Frame::new(320, 64, vec![255u8; 320 * 64 * 4]).unwrap();
        let previous = with_sticky_top(&scroll_view(&page, 0, 400), &blank, 64);
        let current = with_sticky_top(&scroll_view(&page, 200, 400), &blank, 64);
        let mut detector = FixedRegionDetector::new(FixedRegionConfig::default());
        assert_eq!(detector.observe(&previous, &current).top, 0);
    }
}
