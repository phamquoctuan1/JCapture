//! Overlap detection between two consecutive frames.
//!
//! The detector answers one question: how many pixel rows did the *content*
//! actually move between `previous` and `current`? Nothing in the pipeline is
//! allowed to assume the requested scroll distance was honoured, so this is the
//! only source of truth for how much new content a frame contributed.
//!
//! Strategy, cheapest stage first:
//!
//! 1. Restrict matching to a horizontal band (default 20%-80% of the width) so
//!    scrollbars, sidebars and floating buttons cannot dominate the score, and
//!    to the rows outside any detected sticky header/footer.
//! 2. Coarse pass on a 1/4 grayscale pyramid level, scoring every candidate
//!    offset with zero-mean normalised cross correlation (ZNCC).
//! 3. Keep the strongest local peaks instead of only the global maximum -
//!    repeated cards or table rows create several near-equal peaks and the
//!    global one is not always the real seam.
//! 4. Verify each peak at full resolution, then refine the winner row by row.
//!
//! ZNCC is used rather than raw absolute difference because it is invariant to
//! brightness changes and produces a bounded 0..1 similarity that the caller
//! can threshold. A flat region correlates with everything, so the sample
//! variance is returned alongside and low-variance matches are never trusted.

use super::frame::Frame;

#[derive(Debug, Clone, Copy)]
pub struct OverlapConfig {
    /// Left edge of the matching band as a fraction of frame width.
    pub band_start_ratio: f32,
    /// Right edge of the matching band as a fraction of frame width.
    pub band_end_ratio: f32,
    /// Smallest share of the content height that must stay overlapped.
    pub min_overlap_ratio: f32,
    /// Downscale factor used by the coarse pass.
    pub coarse_factor: u32,
    /// How many coarse peaks are verified at full resolution.
    pub candidate_count: usize,
    /// ZNCC below this value is reported as not confident.
    pub min_similarity: f32,
    /// Pixel variance below this value means the sampled area is too flat to
    /// trust, regardless of the correlation value.
    pub min_variance: f32,
}

impl Default for OverlapConfig {
    fn default() -> Self {
        Self {
            band_start_ratio: 0.2,
            band_end_ratio: 0.8,
            min_overlap_ratio: 0.15,
            coarse_factor: 4,
            candidate_count: 3,
            min_similarity: 0.82,
            min_variance: 8.0,
        }
    }
}

/// Result of matching two consecutive frames.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OverlapMatch {
    /// Rows the content moved up. Equals the amount of new content.
    pub offset: u32,
    /// ZNCC of the overlapping area, 0..1.
    pub similarity: f32,
    /// Rows shared by both frames inside the content region.
    pub overlap_rows: u32,
    /// Pixel variance of the sampled area, used to reject flat matches.
    pub variance: f32,
    /// True when the match passed both the similarity and variance gates.
    pub confident: bool,
}

/// Rows at the top and bottom of a frame that do not scroll.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FixedRegions {
    pub top: u32,
    pub bottom: u32,
}

impl FixedRegions {
    pub const NONE: Self = Self { top: 0, bottom: 0 };
}

/// Vertical slice of a frame that scrolls, plus the horizontal match band.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ContentRegion {
    pub top: u32,
    pub bottom: u32,
    pub left: u32,
    pub right: u32,
}

impl ContentRegion {
    pub fn height(&self) -> u32 {
        self.bottom.saturating_sub(self.top)
    }
    pub fn width(&self) -> u32 {
        self.right.saturating_sub(self.left)
    }
    /// Same region expressed on a `1 / factor` pyramid level.
    fn scaled(&self, factor: u32) -> Self {
        Self {
            top: self.top / factor,
            bottom: self.bottom / factor,
            left: self.left / factor,
            right: self.right / factor,
        }
    }
}

pub struct OverlapDetector {
    config: OverlapConfig,
}

/// Borrowed grayscale plane so the coarse and fine passes share one scorer.
struct GrayView<'a> {
    data: &'a [u8],
    width: u32,
    height: u32,
}

impl OverlapDetector {
    pub fn new(config: OverlapConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &OverlapConfig {
        &self.config
    }

    /// Content region of a frame given the detected fixed regions.
    pub(crate) fn content_region(&self, frame: &Frame, fixed: FixedRegions) -> ContentRegion {
        let top = fixed.top.min(frame.height);
        let bottom = frame.height.saturating_sub(fixed.bottom).max(top);
        let left = (frame.width as f32 * self.config.band_start_ratio) as u32;
        let right = ((frame.width as f32 * self.config.band_end_ratio) as u32)
            .min(frame.width)
            .max(left + 1);
        ContentRegion {
            top,
            bottom,
            left,
            right,
        }
    }

    /// Finds how far the content moved between two frames of equal size.
    ///
    /// Returns `None` only when the frames are too small or mismatched to
    /// compare at all. A poor match still returns a value with
    /// `confident == false` so the caller can retry or stop deliberately.
    pub fn detect(
        &self,
        previous: &Frame,
        current: &Frame,
        fixed: FixedRegions,
    ) -> Option<OverlapMatch> {
        if previous.width != current.width || previous.height != current.height {
            return None;
        }
        let region = self.content_region(previous, fixed);
        let content_height = region.height();
        if content_height < 32 || region.width() < 8 {
            return None;
        }

        let min_overlap = ((content_height as f32 * self.config.min_overlap_ratio) as u32).max(16);
        let max_offset = content_height.saturating_sub(min_overlap);
        if max_offset == 0 {
            return None;
        }

        let previous_view = GrayView {
            data: &previous.gray,
            width: previous.width,
            height: previous.height,
        };
        let current_view = GrayView {
            data: &current.gray,
            width: current.width,
            height: current.height,
        };

        let candidates = self.coarse_candidates(previous, current, region, max_offset);

        // Verify every coarse peak at full resolution before trusting it.
        let factor = self.config.coarse_factor.max(1);
        let verify_radius = factor * 2;
        let col_step = (region.width() / 96).max(1);
        let mut best: Option<Scored> = None;
        for candidate in candidates {
            let start = candidate.saturating_sub(verify_radius);
            let end = (candidate + verify_radius).min(max_offset);
            for offset in start..=end {
                let scored = score_offset(
                    &previous_view,
                    &current_view,
                    region,
                    offset,
                    2,
                    col_step,
                );
                best = Some(pick_better(best, scored));
            }
        }

        // Row-exact refinement so a one pixel seam cannot survive the join.
        let coarse_best = best?;
        let refine_start = coarse_best.offset.saturating_sub(3);
        let refine_end = (coarse_best.offset + 3).min(max_offset);
        let mut refined = coarse_best;
        for offset in refine_start..=refine_end {
            let scored = score_offset(&previous_view, &current_view, region, offset, 1, col_step);
            refined = pick_better(Some(refined), scored);
        }

        let overlap_rows = content_height.saturating_sub(refined.offset);
        let confident = refined.similarity >= self.config.min_similarity
            && refined.variance >= self.config.min_variance;
        Some(OverlapMatch {
            offset: refined.offset,
            similarity: refined.similarity,
            overlap_rows,
            variance: refined.variance,
            confident,
        })
    }

    /// Scores every offset on the 1/factor pyramid level and returns the
    /// strongest local peaks mapped back to full resolution.
    fn coarse_candidates(
        &self,
        previous: &Frame,
        current: &Frame,
        region: ContentRegion,
        max_offset: u32,
    ) -> Vec<u32> {
        let factor = self.config.coarse_factor.max(1);
        let small_region = region.scaled(factor);
        let max_offset_small = max_offset / factor;
        if factor == 1 || max_offset_small < 4 || small_region.height() < 16 {
            // Frame is too short for a pyramid; let the verification pass scan
            // the whole range instead.
            return vec![0, max_offset / 2, max_offset];
        }

        let previous_small = previous.gray_downscaled(factor);
        let current_small = current.gray_downscaled(factor);
        let previous_view = GrayView {
            data: &previous_small.data,
            width: previous_small.width,
            height: previous_small.height,
        };
        let current_view = GrayView {
            data: &current_small.data,
            width: current_small.width,
            height: current_small.height,
        };
        let col_step = (small_region.width() / 128).max(1);

        let mut scores = Vec::with_capacity(max_offset_small as usize + 1);
        for offset in 0..=max_offset_small {
            let scored = score_offset(
                &previous_view,
                &current_view,
                small_region,
                offset,
                1,
                col_step,
            );
            scores.push(scored.similarity);
        }

        let mut peaks: Vec<(f32, u32)> = Vec::new();
        for index in 0..scores.len() {
            let value = scores[index];
            let left_ok = index == 0 || scores[index - 1] <= value;
            let right_ok = index + 1 == scores.len() || scores[index + 1] <= value;
            if left_ok && right_ok {
                peaks.push((value, index as u32));
            }
        }
        peaks.sort_by(|a, b| b.0.total_cmp(&a.0));

        let mut selected: Vec<u32> = Vec::new();
        for (_, index) in peaks {
            if selected.iter().any(|kept| kept.abs_diff(index) < 2) {
                continue;
            }
            selected.push(index);
            if selected.len() >= self.config.candidate_count {
                break;
            }
        }
        // Offset 0 is how "the view did not move" is recognised, so it is always
        // verified even when it is not among the strongest peaks.
        if !selected.contains(&0) {
            selected.push(0);
        }
        selected.into_iter().map(|index| index * factor).collect()
    }
}

#[derive(Debug, Clone, Copy)]
struct Scored {
    offset: u32,
    similarity: f32,
    variance: f32,
}

/// Prefers the higher correlation, but on a near-tie prefers the more textured
/// evidence and then the larger movement. Uniform areas correlate equally well
/// at many offsets; texture is what actually pins the seam down.
fn pick_better(current: Option<Scored>, candidate: Scored) -> Scored {
    let Some(current) = current else {
        return candidate;
    };
    let delta = candidate.similarity - current.similarity;
    if delta > 0.002 {
        return candidate;
    }
    if delta < -0.002 {
        return current;
    }
    if candidate.variance > current.variance * 1.05 {
        return candidate;
    }
    if current.variance > candidate.variance * 1.05 {
        return current;
    }
    if candidate.offset > current.offset {
        candidate
    } else {
        current
    }
}

/// ZNCC between `previous` rows shifted up by `offset` and `current` rows.
fn score_offset(
    previous: &GrayView,
    current: &GrayView,
    region: ContentRegion,
    offset: u32,
    row_step: u32,
    col_step: u32,
) -> Scored {
    let content_height = region.height();
    if offset >= content_height {
        return Scored {
            offset,
            similarity: 0.0,
            variance: 0.0,
        };
    }
    let compare_rows = content_height - offset;
    let row_step = row_step.max(1);
    let col_step = col_step.max(1);

    let mut sum_a = 0f64;
    let mut sum_b = 0f64;
    let mut sum_aa = 0f64;
    let mut sum_bb = 0f64;
    let mut sum_ab = 0f64;
    let mut count = 0f64;

    let mut row = 0u32;
    while row < compare_rows {
        let previous_y = region.top + offset + row;
        let current_y = region.top + row;
        if previous_y >= previous.height || current_y >= current.height {
            break;
        }
        let previous_row = previous.row(previous_y);
        let current_row = current.row(current_y);
        let mut x = region.left;
        while x < region.right {
            let a = previous_row[x as usize] as f64;
            let b = current_row[x as usize] as f64;
            sum_a += a;
            sum_b += b;
            sum_aa += a * a;
            sum_bb += b * b;
            sum_ab += a * b;
            count += 1.0;
            x += col_step;
        }
        row += row_step;
    }

    if count < 16.0 {
        return Scored {
            offset,
            similarity: 0.0,
            variance: 0.0,
        };
    }

    let var_a = (sum_aa - sum_a * sum_a / count) / count;
    let var_b = (sum_bb - sum_b * sum_b / count) / count;
    let covariance = (sum_ab - sum_a * sum_b / count) / count;
    let denominator = (var_a * var_b).sqrt();
    let similarity = if denominator <= f64::EPSILON {
        // Both areas are perfectly flat. Identical flat areas are a match, but
        // an unreliable one, so it is reported with zero variance and will not
        // pass the confidence gate on its own.
        if (sum_a / count - sum_b / count).abs() < 1.0 {
            1.0
        } else {
            0.0
        }
    } else {
        (covariance / denominator).clamp(-1.0, 1.0)
    };

    Scored {
        offset,
        similarity: similarity as f32,
        variance: var_a.min(var_b) as f32,
    }
}

impl<'a> GrayView<'a> {
    #[inline]
    fn row(&self, y: u32) -> &[u8] {
        let start = y as usize * self.width as usize;
        &self.data[start..start + self.width as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scrolling::testing::{scroll_view, synthetic_page};

    fn detector() -> OverlapDetector {
        OverlapDetector::new(OverlapConfig::default())
    }

    #[test]
    fn detects_exact_scroll_offset() {
        let page = synthetic_page(320, 1200, 11);
        let previous = scroll_view(&page, 0, 400);
        let current = scroll_view(&page, 137, 400);
        let result = detector()
            .detect(&previous, &current, FixedRegions::NONE)
            .expect("frames are comparable");
        assert_eq!(result.offset, 137);
        assert!(result.confident, "similarity {}", result.similarity);
        assert!(result.similarity > 0.99);
    }

    #[test]
    fn detects_large_scroll_offset() {
        let page = synthetic_page(320, 1600, 3);
        let previous = scroll_view(&page, 0, 400);
        let current = scroll_view(&page, 288, 400);
        let result = detector()
            .detect(&previous, &current, FixedRegions::NONE)
            .unwrap();
        assert_eq!(result.offset, 288);
        assert!(result.confident);
    }

    #[test]
    fn reports_zero_offset_when_view_did_not_move() {
        let page = synthetic_page(320, 900, 5);
        let frame = scroll_view(&page, 60, 400);
        let result = detector()
            .detect(&frame, &frame, FixedRegions::NONE)
            .unwrap();
        assert_eq!(result.offset, 0);
        assert!(result.similarity > 0.999);
    }

    #[test]
    fn ignores_sidebar_noise_outside_the_band() {
        let page = synthetic_page(320, 1200, 21);
        let previous = scroll_view(&page, 0, 400);
        let mut current = scroll_view(&page, 150, 400);
        // Simulate a sidebar that changes independently of the scroll.
        for y in 0..current.height {
            for x in 0..40u32 {
                let index = (y as usize * current.width as usize + x as usize) * 4;
                current.rgba[index] = 255;
                current.rgba[index + 1] = 0;
                current.rgba[index + 2] = 0;
            }
        }
        let current = Frame::new(current.width, current.height, current.rgba).unwrap();
        let result = detector()
            .detect(&previous, &current, FixedRegions::NONE)
            .unwrap();
        assert_eq!(result.offset, 150);
        assert!(result.confident);
    }

    #[test]
    fn skips_sticky_header_rows_when_matching() {
        let page = synthetic_page(320, 1200, 9);
        let header = synthetic_page(320, 60, 77);
        let mut previous = scroll_view(&page, 0, 400);
        let mut current = scroll_view(&page, 180, 400);
        for frame in [&mut previous, &mut current] {
            let stride = frame.width as usize * 4;
            frame.rgba[..60 * stride].copy_from_slice(&header.rgba[..60 * stride]);
        }
        let previous = Frame::new(previous.width, previous.height, previous.rgba).unwrap();
        let current = Frame::new(current.width, current.height, current.rgba).unwrap();
        let fixed = FixedRegions { top: 60, bottom: 0 };
        let result = detector().detect(&previous, &current, fixed).unwrap();
        assert_eq!(result.offset, 180);
        assert!(result.confident);
    }

    #[test]
    fn flat_frames_are_never_confident() {
        let blank = Frame::new(320, 400, vec![255u8; 320 * 400 * 4]).unwrap();
        let result = detector()
            .detect(&blank, &blank, FixedRegions::NONE)
            .unwrap();
        assert!(!result.confident);
    }

    #[test]
    fn rejects_frames_with_different_sizes() {
        let a = Frame::new(320, 400, vec![0u8; 320 * 400 * 4]).unwrap();
        let b = Frame::new(320, 401, vec![0u8; 320 * 401 * 4]).unwrap();
        assert!(detector().detect(&a, &b, FixedRegions::NONE).is_none());
    }
}
