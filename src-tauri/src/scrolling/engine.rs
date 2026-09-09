//! Scrolling capture engine.
//!
//! Orchestrates the components in the order that keeps every decision grounded
//! in pixels:
//!
//! ```text
//! capture -> scroll -> wait until stable -> capture
//!         -> detect fixed regions -> detect overlap -> validate
//!         -> append only the measured new rows -> repeat
//! ```
//!
//! The requested scroll distance is never used to crop. It only decides how
//! much movement to ask for; how much actually happened is measured every
//! single frame and fed back into the scroll estimate.

use super::capture::CaptureService;
use super::end_detect::{EndOfScrollConfig, EndOfScrollDetector, StopReason};
use super::fixed_region::{FixedRegionConfig, FixedRegionDetector};
use super::frame::Frame;
use super::logger::CaptureLogger;
use super::overlap::{OverlapConfig, OverlapDetector, OverlapMatch};
use super::scroll::ScrollController;
use super::stability::{mean_difference, FrameStabilityDetector, StabilityConfig};
use super::stitcher::ImageStitcher;

#[derive(Debug, Clone, Copy)]
pub struct EngineConfig {
    pub overlap: OverlapConfig,
    pub fixed_region: FixedRegionConfig,
    pub stability: StabilityConfig,
    pub end_of_scroll: EndOfScrollConfig,
    /// Share of the scrollable height to request per step. Staying below 1.0
    /// leaves the overlap the matcher needs to lock onto.
    pub scroll_ratio: f32,
    /// Height ceiling for the stitched image.
    pub max_output_rows: u32,
    /// Extra captures taken when a match looks untrustworthy.
    pub retries_per_frame: u32,
    /// Similarity below which a frame is dropped rather than stitched.
    pub low_confidence_floor: f32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            overlap: OverlapConfig::default(),
            fixed_region: FixedRegionConfig::default(),
            stability: StabilityConfig::default(),
            end_of_scroll: EndOfScrollConfig::default(),
            scroll_ratio: 0.72,
            max_output_rows: 20_000,
            retries_per_frame: 1,
            low_confidence_floor: 0.6,
        }
    }
}

/// Reported after every frame so the UI can show live progress.
#[derive(Debug, Clone, Copy)]
pub struct CaptureProgress {
    pub frames: u32,
    pub captured_rows: u32,
    pub last_offset: u32,
    pub similarity: f32,
}

pub struct CaptureOutput {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub frames: u32,
    pub stop_reason: StopReason,
}

pub struct ScrollingCaptureEngine {
    config: EngineConfig,
    logger: CaptureLogger,
}

impl ScrollingCaptureEngine {
    pub fn new(config: EngineConfig, logger: CaptureLogger) -> Self {
        Self { config, logger }
    }

    /// Runs a capture to completion and returns the stitched image.
    ///
    /// Cancellation and a moved target window are not errors: whatever has been
    /// stitched so far is returned, which is what Stop is expected to do.
    pub fn run(
        &mut self,
        capture: &dyn CaptureService,
        scroll: &mut dyn ScrollController,
        cancelled: &dyn Fn() -> bool,
        progress: &dyn Fn(CaptureProgress),
    ) -> Result<CaptureOutput, String> {
        let stability = FrameStabilityDetector::new(self.config.stability);
        let overlap = OverlapDetector::new(self.config.overlap);
        let mut fixed_detector = FixedRegionDetector::new(self.config.fixed_region);
        let mut end_detector = EndOfScrollDetector::new(self.config.end_of_scroll);

        let (first, _) = stability.wait_until_stable(|| capture.capture(), cancelled)?;
        let width = first.width;
        let height = first.height;
        self.logger.line(&format!(
            "Region: {}x{} at ({}, {})",
            width,
            height,
            capture.region().x,
            capture.region().y
        ));

        let mut stitcher = ImageStitcher::new(width, height, self.config.max_output_rows);
        stitcher.initialize(first.clone());
        let mut previous = first;

        let stop_reason = loop {
            if cancelled() {
                break StopReason::Cancelled;
            }
            if !capture.target_is_stable() {
                break StopReason::WindowChanged;
            }

            let fixed = fixed_detector.current();
            let content_height = height
                .saturating_sub(fixed.top + fixed.bottom)
                .max(1);
            let target_px = ((content_height as f32 * self.config.scroll_ratio) as u32).max(1);
            let request = scroll.scroll_down(target_px)?;

            let Some((matched, frame)) =
                self.best_match(capture, &stability, &overlap, &mut fixed_detector, &mut stitcher, &previous, cancelled)?
            else {
                break StopReason::Cancelled;
            };

            let mut new_rows = 0u32;
            let mut saturated = false;
            let accepted = matched.similarity >= self.config.low_confidence_floor;
            if accepted && matched.offset > 0 {
                let outcome = stitcher.append(&frame, matched.offset)?;
                new_rows = outcome.rows_added;
                saturated = outcome.saturated;
            }

            // An unmatchable frame that clearly changed means the scroll jumped
            // past the whole viewport. Feeding the content height back as a
            // lower bound shrinks the next request instead of overshooting
            // again; feeding the unusable offset would corrupt the estimate.
            let overshot = !accepted
                && mean_difference(&previous, &frame) > self.config.stability.tolerance;
            let measured = if accepted {
                matched.offset
            } else if overshot {
                content_height
            } else {
                0
            };
            scroll.observe(request, measured);

            self.logger.line(&format!(
                "Frame {:>3} | requested {:>5}px ({} steps @ {:.0}px) | offset {:>5}px | overlap {:>5}px | similarity {:.3} | variance {:.0} | new {:>5}px | total {}px{}",
                end_detector.frames() + 2,
                target_px,
                request.steps,
                scroll.pixels_per_step(),
                matched.offset,
                matched.overlap_rows,
                matched.similarity,
                matched.variance,
                new_rows,
                stitcher.total_rows(),
                if matched.confident {
                    ""
                } else if overshot {
                    " | OVERSHOT, reducing scroll step"
                } else {
                    " | LOW CONFIDENCE"
                },
            ));

            progress(CaptureProgress {
                frames: end_detector.frames() + 2,
                captured_rows: stitcher.total_rows(),
                last_offset: matched.offset,
                similarity: matched.similarity,
            });

            if accepted {
                previous = frame;
            }

            if saturated || stitcher.is_full() {
                break StopReason::OutputFull;
            }
            if let Some(reason) = end_detector.observe(new_rows) {
                break reason;
            }
        };

        let frames = end_detector.frames() + 1;
        let (out_width, out_height, rgba) = stitcher.finish(&previous)?;
        self.logger.line(&format!(
            "Stopped: {} after {} frames, {}x{}px",
            stop_reason.as_str(),
            frames,
            out_width,
            out_height
        ));
        Ok(CaptureOutput {
            width: out_width,
            height: out_height,
            rgba,
            frames,
            stop_reason,
        })
    }

    /// Captures, then re-captures while the match looks untrustworthy.
    ///
    /// A poor match is usually a frame caught mid-render, so taking another one
    /// costs a few milliseconds and is far cheaper than stitching a wrong seam.
    /// Returns `None` only when the run was cancelled mid-wait.
    #[allow(clippy::too_many_arguments)]
    fn best_match(
        &mut self,
        capture: &dyn CaptureService,
        stability: &FrameStabilityDetector,
        overlap: &OverlapDetector,
        fixed_detector: &mut FixedRegionDetector,
        stitcher: &mut ImageStitcher,
        previous: &Frame,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Option<(OverlapMatch, Frame)>, String> {
        let mut best: Option<(OverlapMatch, Frame)> = None;
        for attempt in 0..=self.config.retries_per_frame {
            if cancelled() && attempt > 0 {
                break;
            }
            let (current, _) = stability.wait_until_stable(|| capture.capture(), cancelled)?;
            let fixed = fixed_detector.observe(previous, &current);
            stitcher.set_fixed_regions(fixed);
            let Some(matched) = overlap.detect(previous, &current, fixed) else {
                continue;
            };
            let better = best
                .as_ref()
                .map(|(existing, _)| matched.similarity > existing.similarity)
                .unwrap_or(true);
            if better {
                best = Some((matched, current));
            }
            if matched.confident {
                break;
            }
        }
        Ok(best)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scrolling::capture::test_support::ScriptedCapture;
    use crate::scrolling::scroll::test_support::ScriptedScroll;
    use crate::scrolling::stability::StabilityConfig;
    use crate::scrolling::testing::{scroll_view, synthetic_page, with_sticky_top};

    fn fast_config() -> EngineConfig {
        EngineConfig {
            stability: StabilityConfig {
                min_delay_ms: 0,
                poll_interval_ms: 0,
                timeout_ms: 20,
                tolerance: 1.2,
            },
            retries_per_frame: 0,
            ..EngineConfig::default()
        }
    }

    fn run(frames: Vec<Frame>, config: EngineConfig) -> CaptureOutput {
        let capture = ScriptedCapture::new(frames);
        let mut scroll = ScriptedScroll::new(&capture);
        let mut engine = ScrollingCaptureEngine::new(config, CaptureLogger::silent());
        engine
            .run(&capture, &mut scroll, &|| false, &|_| {})
            .expect("capture succeeds")
    }

    #[test]
    fn stitches_a_scrolling_page_back_together() {
        let page = synthetic_page(200, 1400, 23);
        let view_height = 400u32;
        let steps = [0u32, 250, 500, 750, 1000, 1000, 1000];
        let frames: Vec<Frame> = steps
            .iter()
            .map(|scroll_y| scroll_view(&page, *scroll_y, view_height))
            .collect();

        let output = run(frames, fast_config());
        assert_eq!(output.stop_reason, StopReason::EndOfContent);
        assert_eq!(output.width, 200);
        // 1000 rows scrolled plus the height of the last viewport.
        assert_eq!(output.height, 1000 + view_height);
        let stride = 200usize * 4;
        for y in 0..output.height as usize {
            assert_eq!(
                &output.rgba[y * stride..(y + 1) * stride],
                &page.rgba_row(y as u32)[..],
                "row {} does not match the source page",
                y
            );
        }
    }

    #[test]
    fn keeps_a_sticky_header_once_end_to_end() {
        let page = synthetic_page(200, 1400, 29);
        let banner = synthetic_page(200, 50, 91);
        let steps = [0u32, 250, 500, 500, 500];
        let frames: Vec<Frame> = steps
            .iter()
            .map(|scroll_y| with_sticky_top(&scroll_view(&page, *scroll_y, 400), &banner, 50))
            .collect();

        let output = run(frames, fast_config());
        let stride = 200usize * 4;
        let banner_row = &banner.rgba_row(0)[..];
        assert_eq!(&output.rgba[..stride], banner_row);
        let mut repeats = 0;
        for y in 1..output.height as usize {
            if &output.rgba[y * stride..(y + 1) * stride] == banner_row {
                repeats += 1;
            }
        }
        assert_eq!(repeats, 0, "sticky banner was stitched more than once");
    }

    #[test]
    fn stops_immediately_when_cancelled() {
        let page = synthetic_page(200, 1400, 31);
        let frames: Vec<Frame> = [0u32, 250, 500]
            .iter()
            .map(|scroll_y| scroll_view(&page, *scroll_y, 400))
            .collect();
        let capture = ScriptedCapture::new(frames);
        let mut scroll = ScriptedScroll::new(&capture);
        let mut engine = ScrollingCaptureEngine::new(fast_config(), CaptureLogger::silent());
        let output = engine
            .run(&capture, &mut scroll, &|| true, &|_| {})
            .expect("cancelled capture still returns the first frame");
        assert_eq!(output.stop_reason, StopReason::Cancelled);
        assert_eq!(output.height, 400);
    }

    #[test]
    fn stops_when_the_target_window_moves() {
        let page = synthetic_page(200, 1400, 37);
        let frames: Vec<Frame> = [0u32, 250, 500]
            .iter()
            .map(|scroll_y| scroll_view(&page, *scroll_y, 400))
            .collect();
        let capture = ScriptedCapture::new(frames);
        *capture.stable.borrow_mut() = false;
        let mut scroll = ScriptedScroll::new(&capture);
        let mut engine = ScrollingCaptureEngine::new(fast_config(), CaptureLogger::silent());
        let output = engine.run(&capture, &mut scroll, &|| false, &|_| {}).unwrap();
        assert_eq!(output.stop_reason, StopReason::WindowChanged);
    }

    #[test]
    fn stops_at_the_output_height_limit() {
        let page = synthetic_page(200, 2000, 41);
        let frames: Vec<Frame> = (0..6)
            .map(|step| scroll_view(&page, step * 250, 400))
            .collect();
        let config = EngineConfig {
            max_output_rows: 700,
            ..fast_config()
        };
        let output = run(frames, config);
        assert_eq!(output.stop_reason, StopReason::OutputFull);
        assert_eq!(output.height, 700);
    }

    #[test]
    fn reports_progress_for_every_frame() {
        let page = synthetic_page(200, 1400, 43);
        let frames: Vec<Frame> = [0u32, 250, 500, 500, 500]
            .iter()
            .map(|scroll_y| scroll_view(&page, *scroll_y, 400))
            .collect();
        let capture = ScriptedCapture::new(frames);
        let mut scroll = ScriptedScroll::new(&capture);
        let mut engine = ScrollingCaptureEngine::new(fast_config(), CaptureLogger::silent());
        let seen = std::cell::RefCell::new(Vec::new());
        engine
            .run(&capture, &mut scroll, &|| false, &|progress| {
                seen.borrow_mut().push(progress.captured_rows);
            })
            .unwrap();
        let seen = seen.into_inner();
        assert!(seen.len() >= 3);
        assert!(
            seen.windows(2).all(|pair| pair[1] >= pair[0]),
            "captured height went backwards: {:?}",
            seen
        );
    }
}
