//! Scrolling (panoramic) capture.
//!
//! The pipeline is split into components that can be reasoned about - and
//! tested - on their own:
//!
//! | Component | File | Responsibility |
//! |---|---|---|
//! | Capture Service | [`capture`] | Turns a screen rectangle into frames |
//! | Scroll Controller | [`scroll`] | Requests movement, self-calibrates |
//! | Frame Stability | [`stability`] | Waits out lazy loading and animation |
//! | Fixed Region Detector | [`fixed_region`] | Finds sticky headers/footers |
//! | Overlap Detector | [`overlap`] | Measures the real scroll offset |
//! | Image Stitcher | [`stitcher`] | Appends only new rows, streaming |
//! | End Detector | [`end_detect`] | Decides when the page is exhausted |
//! | Engine | [`engine`] | Drives the loop and reports progress |
//!
//! The rule the whole design is built around: the requested scroll distance is
//! never used to crop an image. Every row that reaches the output was proved to
//! be new by matching the pixels of two consecutive frames.

pub mod capture;
pub mod end_detect;
pub mod engine;
pub mod fixed_region;
pub mod frame;
pub mod logger;
pub mod overlap;
pub mod scroll;
pub mod stability;
pub mod stitcher;

#[cfg(test)]
pub mod testing;

pub use capture::{CaptureRegion, CaptureService};
pub use end_detect::StopReason;
pub use engine::{CaptureOutput, CaptureProgress, EngineConfig, ScrollingCaptureEngine};
pub use frame::Frame;
pub use logger::CaptureLogger;
pub use overlap::{FixedRegions, OverlapMatch};
pub use scroll::{ScrollController, ScrollMode};

#[cfg(windows)]
pub use capture::DesktopRegionCapture;
#[cfg(windows)]
pub use scroll::InputScrollController;
