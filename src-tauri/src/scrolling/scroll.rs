//! Scroll controller.
//!
//! The controller only ever *requests* movement. How far the view really moved
//! is measured from the pixels by the overlap detector and fed back here, which
//! is what lets the request adapt to zoom level, per-app line height and the
//! user's wheel settings without ever being used to crop an image.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScrollMode {
    Wheel,
    /// Fallback for surfaces that ignore injected wheel messages.
    Keyboard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollRequest {
    pub mode: ScrollMode,
    /// Wheel notches, or key presses in keyboard mode.
    pub steps: u32,
}

pub trait ScrollController {
    /// Asks the target to scroll down by roughly `target_px`.
    fn scroll_down(&mut self, target_px: u32) -> Result<ScrollRequest, String>;
    /// Reports how far the content actually moved for that request.
    fn observe(&mut self, request: ScrollRequest, measured_px: u32);
    /// Current estimate of pixels per wheel notch, for logging.
    fn pixels_per_step(&self) -> f32;
    fn mode(&self) -> ScrollMode;
}

/// Shared calibration used by every controller implementation.
///
/// A fresh capture starts from a rough guess and converges within one or two
/// frames; the estimate is smoothed so one bad measurement (a lazy load, a
/// bounce animation) cannot swing the next request wildly.
#[derive(Debug, Clone)]
pub struct ScrollCalibration {
    pixels_per_step: f32,
    min_pixels_per_step: f32,
    max_pixels_per_step: f32,
    smoothing: f32,
    max_steps: u32,
    dead_requests: u32,
    calibrated: bool,
}

impl Default for ScrollCalibration {
    fn default() -> Self {
        Self {
            pixels_per_step: 100.0,
            min_pixels_per_step: 8.0,
            max_pixels_per_step: 600.0,
            smoothing: 0.35,
            max_steps: 40,
            dead_requests: 0,
            calibrated: false,
        }
    }
}

impl ScrollCalibration {
    /// Steps to request for `target_px`.
    ///
    /// The very first request is always a single step, whatever the target: how
    /// far one step moves depends on the app, the zoom level and the user's
    /// wheel settings, and guessing high would scroll straight past a whole
    /// viewport and lose content that can never be recovered. One step is
    /// measured, then every later request is sized from that measurement.
    pub fn steps_for(&self, target_px: u32) -> u32 {
        if !self.calibrated {
            return 1;
        }
        ((target_px as f32 / self.pixels_per_step).round() as u32).clamp(1, self.max_steps)
    }

    pub fn pixels_per_step(&self) -> f32 {
        self.pixels_per_step
    }

    /// Number of consecutive requests that moved nothing.
    pub fn dead_requests(&self) -> u32 {
        self.dead_requests
    }

    pub fn observe(&mut self, steps: u32, measured_px: u32) {
        if steps == 0 {
            return;
        }
        if measured_px == 0 {
            self.dead_requests += 1;
            return;
        }
        self.dead_requests = 0;
        let sample = measured_px as f32 / steps as f32;
        self.pixels_per_step = if self.calibrated {
            self.pixels_per_step * (1.0 - self.smoothing) + sample * self.smoothing
        } else {
            // Nothing to smooth against yet: adopt the probe outright.
            self.calibrated = true;
            sample
        }
        .clamp(self.min_pixels_per_step, self.max_pixels_per_step);
    }
}

#[cfg(windows)]
pub use windows_impl::InputScrollController;

#[cfg(windows)]
mod windows_impl {
    use super::{ScrollCalibration, ScrollController, ScrollMode, ScrollRequest};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
        MOUSEEVENTF_WHEEL, MOUSEINPUT, VK_NEXT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{SetCursorPos, SetForegroundWindow};

    const WHEEL_DELTA: i32 = 120;
    /// Wheel notches sent per SendInput call. Large single deltas make smooth
    /// scrolling engines overshoot, tiny ones make the capture crawl.
    const NOTCHES_PER_BURST: u32 = 3;
    /// After this many requests that moved nothing, fall back to PageDown.
    const DEAD_REQUESTS_BEFORE_FALLBACK: u32 = 2;

    pub struct InputScrollController {
        target: HWND,
        cursor: (i32, i32),
        calibration: ScrollCalibration,
        keyboard_calibration: ScrollCalibration,
        mode: ScrollMode,
    }

    // Only used from the capture worker thread; the HWND is never dereferenced.
    unsafe impl Send for InputScrollController {}

    impl InputScrollController {
        pub fn new(target: HWND, cursor: (i32, i32)) -> Self {
            Self {
                target,
                cursor,
                calibration: ScrollCalibration::default(),
                keyboard_calibration: ScrollCalibration {
                    // One PageDown moves close to a viewport.
                    pixels_per_step: 600.0,
                    max_steps: 3,
                    ..ScrollCalibration::default()
                },
                mode: ScrollMode::Wheel,
            }
        }

        fn focus_target(&self) {
            unsafe {
                if !self.target.0.is_null() {
                    let _ = SetForegroundWindow(self.target);
                }
                let _ = SetCursorPos(self.cursor.0, self.cursor.1);
            }
        }

        fn send_wheel(&self, notches: u32) {
            let mut remaining = notches;
            while remaining > 0 {
                let burst = remaining.min(NOTCHES_PER_BURST);
                remaining -= burst;
                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            // Negative scrolls down.
                            mouseData: (-(burst as i32) * WHEEL_DELTA) as u32,
                            dwFlags: MOUSEEVENTF_WHEEL,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                unsafe {
                    SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }

        fn send_page_down(&self, presses: u32) {
            for _ in 0..presses {
                let down = INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VK_NEXT,
                            ..Default::default()
                        },
                    },
                };
                let up = INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VK_NEXT,
                            dwFlags: KEYEVENTF_KEYUP,
                            ..Default::default()
                        },
                    },
                };
                unsafe {
                    SendInput(&[down, up], std::mem::size_of::<INPUT>() as i32);
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }

        fn active_calibration(&mut self) -> &mut ScrollCalibration {
            match self.mode {
                ScrollMode::Wheel => &mut self.calibration,
                ScrollMode::Keyboard => &mut self.keyboard_calibration,
            }
        }
    }

    impl ScrollController for InputScrollController {
        fn scroll_down(&mut self, target_px: u32) -> Result<ScrollRequest, String> {
            let mode = self.mode;
            let steps = self.active_calibration().steps_for(target_px);
            self.focus_target();
            match mode {
                ScrollMode::Wheel => self.send_wheel(steps),
                ScrollMode::Keyboard => self.send_page_down(steps),
            }
            Ok(ScrollRequest { mode, steps })
        }

        fn observe(&mut self, request: ScrollRequest, measured_px: u32) {
            if request.mode != self.mode {
                return;
            }
            self.active_calibration().observe(request.steps, measured_px);
            if self.mode == ScrollMode::Wheel
                && self.calibration.dead_requests() >= DEAD_REQUESTS_BEFORE_FALLBACK
            {
                // Some surfaces (remote desktop clients, custom canvases) drop
                // injected wheel messages but honour PageDown.
                self.mode = ScrollMode::Keyboard;
            }
        }

        fn pixels_per_step(&self) -> f32 {
            match self.mode {
                ScrollMode::Wheel => self.calibration.pixels_per_step(),
                ScrollMode::Keyboard => self.keyboard_calibration.pixels_per_step(),
            }
        }

        fn mode(&self) -> ScrollMode {
            self.mode
        }
    }
}

#[cfg(test)]
pub mod test_support {
    use super::{ScrollCalibration, ScrollController, ScrollMode, ScrollRequest};
    use crate::scrolling::capture::test_support::ScriptedCapture;

    /// Drives a `ScriptedCapture` forward instead of touching the desktop.
    pub struct ScriptedScroll<'a> {
        capture: &'a ScriptedCapture,
        calibration: ScrollCalibration,
        pub requests: Vec<ScrollRequest>,
    }

    impl<'a> ScriptedScroll<'a> {
        pub fn new(capture: &'a ScriptedCapture) -> Self {
            Self {
                capture,
                calibration: ScrollCalibration::default(),
                requests: Vec::new(),
            }
        }
    }

    impl<'a> ScrollController for ScriptedScroll<'a> {
        fn scroll_down(&mut self, target_px: u32) -> Result<ScrollRequest, String> {
            let request = ScrollRequest {
                mode: ScrollMode::Wheel,
                steps: self.calibration.steps_for(target_px),
            };
            self.requests.push(request);
            self.capture.advance();
            Ok(request)
        }

        fn observe(&mut self, request: ScrollRequest, measured_px: u32) {
            self.calibration.observe(request.steps, measured_px);
        }

        fn pixels_per_step(&self) -> f32 {
            self.calibration.pixels_per_step()
        }

        fn mode(&self) -> ScrollMode {
            ScrollMode::Wheel
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converges_on_the_real_pixels_per_notch() {
        let mut calibration = ScrollCalibration::default();
        for _ in 0..12 {
            let steps = calibration.steps_for(700);
            calibration.observe(steps, steps * 57);
        }
        assert!(
            (calibration.pixels_per_step() - 57.0).abs() < 2.0,
            "estimate was {}",
            calibration.pixels_per_step()
        );
    }

    #[test]
    fn asks_for_more_steps_when_each_step_is_small() {
        let mut calibration = ScrollCalibration::default();
        for _ in 0..10 {
            let steps = calibration.steps_for(600);
            calibration.observe(steps, steps * 20);
        }
        assert!(calibration.steps_for(600) >= 20);
    }

    #[test]
    fn counts_requests_that_moved_nothing() {
        let mut calibration = ScrollCalibration::default();
        calibration.observe(4, 0);
        calibration.observe(4, 0);
        assert_eq!(calibration.dead_requests(), 2);
        calibration.observe(4, 320);
        assert_eq!(calibration.dead_requests(), 0);
    }

    #[test]
    fn probes_with_a_single_step_before_it_is_calibrated() {
        let mut calibration = ScrollCalibration::default();
        assert_eq!(calibration.steps_for(900), 1);
        calibration.observe(1, 400);
        // 400px per step measured, so 900px needs two steps, not nine.
        assert_eq!(calibration.steps_for(900), 2);
    }

    #[test]
    fn adopts_the_first_measurement_without_smoothing() {
        let mut calibration = ScrollCalibration::default();
        calibration.observe(1, 37);
        assert!((calibration.pixels_per_step() - 37.0).abs() < 0.01);
    }

    #[test]
    fn never_requests_zero_steps() {
        let calibration = ScrollCalibration::default();
        assert_eq!(calibration.steps_for(0), 1);
    }
}
