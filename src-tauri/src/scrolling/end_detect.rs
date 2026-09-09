//! End-of-scroll detection.
//!
//! One repeated frame is not enough to declare the end of a page: a slow
//! renderer or a lazily loaded list produces identical frames in the middle of
//! a capture. The detector therefore counts consecutive frames that failed to
//! contribute content and only stops after several in a row.

#[derive(Debug, Clone, Copy)]
pub struct EndOfScrollConfig {
    /// Fewer new rows than this counts as "no progress".
    pub min_new_rows: u32,
    /// How many consecutive no-progress frames end the capture.
    pub stall_limit: u32,
    /// Hard ceiling on captured frames.
    pub max_frames: u32,
}

impl Default for EndOfScrollConfig {
    fn default() -> Self {
        Self {
            min_new_rows: 6,
            stall_limit: 3,
            max_frames: 200,
        }
    }
}

/// Why the capture loop stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    EndOfContent,
    Cancelled,
    MaxFrames,
    OutputFull,
    WindowChanged,
}

impl StopReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            StopReason::EndOfContent => "end-of-content",
            StopReason::Cancelled => "cancelled",
            StopReason::MaxFrames => "max-frames",
            StopReason::OutputFull => "output-full",
            StopReason::WindowChanged => "window-changed",
        }
    }
}

pub struct EndOfScrollDetector {
    config: EndOfScrollConfig,
    stalled_frames: u32,
    frames: u32,
}

impl EndOfScrollDetector {
    pub fn new(config: EndOfScrollConfig) -> Self {
        Self {
            config,
            stalled_frames: 0,
            frames: 0,
        }
    }

    pub fn stalled_frames(&self) -> u32 {
        self.stalled_frames
    }

    pub fn frames(&self) -> u32 {
        self.frames
    }

    /// Records one capture attempt. `new_rows` is what the stitcher actually
    /// accepted, so a frame rejected for low similarity counts as no progress
    /// and is retried rather than ending the capture immediately.
    pub fn observe(&mut self, new_rows: u32) -> Option<StopReason> {
        self.frames += 1;
        if new_rows < self.config.min_new_rows {
            self.stalled_frames += 1;
        } else {
            self.stalled_frames = 0;
        }
        if self.stalled_frames >= self.config.stall_limit {
            return Some(StopReason::EndOfContent);
        }
        if self.frames >= self.config.max_frames {
            return Some(StopReason::MaxFrames);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detector(stall_limit: u32, max_frames: u32) -> EndOfScrollDetector {
        EndOfScrollDetector::new(EndOfScrollConfig {
            min_new_rows: 6,
            stall_limit,
            max_frames,
        })
    }

    #[test]
    fn a_single_identical_frame_does_not_end_the_capture() {
        let mut detector = detector(3, 100);
        assert_eq!(detector.observe(0), None);
        assert_eq!(detector.stalled_frames(), 1);
    }

    #[test]
    fn ends_after_the_configured_stall_streak() {
        let mut detector = detector(3, 100);
        assert_eq!(detector.observe(0), None);
        assert_eq!(detector.observe(2), None);
        assert_eq!(detector.observe(0), Some(StopReason::EndOfContent));
    }

    #[test]
    fn progress_resets_the_streak() {
        let mut detector = detector(3, 100);
        detector.observe(0);
        detector.observe(0);
        detector.observe(400);
        assert_eq!(detector.stalled_frames(), 0);
        assert_eq!(detector.observe(0), None);
    }

    #[test]
    fn stops_at_the_frame_ceiling() {
        let mut detector = detector(10, 3);
        assert_eq!(detector.observe(100), None);
        assert_eq!(detector.observe(100), None);
        assert_eq!(detector.observe(100), Some(StopReason::MaxFrames));
    }
}
