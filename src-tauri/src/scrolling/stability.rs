//! Frame stability detection for lazily loaded content.
//!
//! Sleeping a fixed amount after every scroll is either too slow on a static
//! page or too fast on one that streams content in. Instead the capture waits
//! a short minimum, then keeps re-capturing until two consecutive captures look
//! the same, giving up at a timeout so an animation or video cannot stall the
//! run forever.

use std::time::{Duration, Instant};

use super::frame::Frame;

#[derive(Debug, Clone, Copy)]
pub struct StabilityConfig {
    /// Always waited after a scroll before the first capture.
    pub min_delay_ms: u64,
    /// Gap between stability probes.
    pub poll_interval_ms: u64,
    /// Give up waiting after this long and use the latest capture.
    pub timeout_ms: u64,
    /// Mean grayscale difference below which two captures count as the same.
    pub tolerance: f32,
}

impl Default for StabilityConfig {
    fn default() -> Self {
        Self {
            min_delay_ms: 90,
            poll_interval_ms: 70,
            timeout_ms: 1_200,
            tolerance: 1.2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stability {
    /// Two consecutive captures matched.
    Stable,
    /// The timeout expired while the view was still changing.
    TimedOut,
}

pub struct FrameStabilityDetector {
    config: StabilityConfig,
}

impl FrameStabilityDetector {
    pub fn new(config: StabilityConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &StabilityConfig {
        &self.config
    }

    /// Waits for the viewport to settle and returns the settled frame.
    ///
    /// `capture` is called repeatedly; `cancelled` aborts the wait between
    /// probes so Stop stays responsive during a long lazy load.
    pub fn wait_until_stable(
        &self,
        mut capture: impl FnMut() -> Result<Frame, String>,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<(Frame, Stability), String> {
        std::thread::sleep(Duration::from_millis(self.config.min_delay_ms));
        let started = Instant::now();
        let mut latest = capture()?;
        loop {
            if cancelled() {
                return Ok((latest, Stability::TimedOut));
            }
            if started.elapsed() >= Duration::from_millis(self.config.timeout_ms) {
                return Ok((latest, Stability::TimedOut));
            }
            std::thread::sleep(Duration::from_millis(self.config.poll_interval_ms));
            let probe = capture()?;
            let difference = mean_difference(&latest, &probe);
            latest = probe;
            if difference <= self.config.tolerance {
                return Ok((latest, Stability::Stable));
            }
        }
    }
}

/// Mean absolute grayscale difference over a sparse sample of both frames.
///
/// Sampling keeps the probe cheap enough to run several times per scroll step,
/// and averaging means a blinking cursor or a small spinner cannot by itself
/// push the value over a sane tolerance.
pub fn mean_difference(a: &Frame, b: &Frame) -> f32 {
    if a.width != b.width || a.height != b.height {
        return f32::MAX;
    }
    let mut sum = 0u64;
    let mut count = 0u64;
    let mut y = 0u32;
    while y < a.height {
        let row_a = a.gray_row(y);
        let row_b = b.gray_row(y);
        let mut x = 0u32;
        while x < a.width {
            sum += row_a[x as usize].abs_diff(row_b[x as usize]) as u64;
            count += 1;
            x += 3;
        }
        y += 3;
    }
    if count == 0 {
        return f32::MAX;
    }
    sum as f32 / count as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scrolling::testing::{scroll_view, synthetic_page};

    #[test]
    fn identical_frames_have_no_difference() {
        let page = synthetic_page(64, 400, 3);
        let frame = scroll_view(&page, 0, 200);
        assert_eq!(mean_difference(&frame, &frame), 0.0);
    }

    #[test]
    fn scrolled_frames_differ() {
        let page = synthetic_page(64, 600, 3);
        let a = scroll_view(&page, 0, 200);
        let b = scroll_view(&page, 90, 200);
        assert!(mean_difference(&a, &b) > 5.0);
    }

    #[test]
    fn mismatched_sizes_report_maximum_difference() {
        let page = synthetic_page(64, 600, 3);
        let a = scroll_view(&page, 0, 200);
        let b = scroll_view(&page, 0, 180);
        assert_eq!(mean_difference(&a, &b), f32::MAX);
    }

    #[test]
    fn returns_the_first_settled_capture() {
        let page = synthetic_page(64, 600, 9);
        let frames = vec![
            scroll_view(&page, 10, 200),
            scroll_view(&page, 20, 200),
            scroll_view(&page, 20, 200),
        ];
        let mut index = 0usize;
        let detector = FrameStabilityDetector::new(StabilityConfig {
            min_delay_ms: 0,
            poll_interval_ms: 0,
            timeout_ms: 500,
            tolerance: 1.2,
        });
        let (frame, stability) = detector
            .wait_until_stable(
                || {
                    let frame = frames[index.min(frames.len() - 1)].clone();
                    index += 1;
                    Ok(frame)
                },
                &|| false,
            )
            .unwrap();
        assert_eq!(stability, Stability::Stable);
        assert_eq!(mean_difference(&frame, &frames[2]), 0.0);
    }

    #[test]
    fn gives_up_when_the_view_never_settles() {
        let page = synthetic_page(64, 900, 9);
        let mut offset = 0u32;
        let detector = FrameStabilityDetector::new(StabilityConfig {
            min_delay_ms: 0,
            poll_interval_ms: 1,
            timeout_ms: 40,
            tolerance: 1.2,
        });
        let (_, stability) = detector
            .wait_until_stable(
                || {
                    offset = (offset + 40) % 400;
                    Ok(scroll_view(&page, offset, 200))
                },
                &|| false,
            )
            .unwrap();
        assert_eq!(stability, Stability::TimedOut);
    }
}
