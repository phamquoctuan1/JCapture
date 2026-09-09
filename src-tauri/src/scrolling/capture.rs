//! Capture service: turns a screen rectangle into frames.
//!
//! The engine only ever talks to the `CaptureService` trait, which keeps the
//! matching and stitching pipeline testable off Windows and makes the desktop
//! grab replaceable later (per-window capture, DXGI, ...).

use super::frame::Frame;

/// A rectangle on the virtual desktop, in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl CaptureRegion {
    pub fn center(&self) -> (i32, i32) {
        (
            self.x + (self.width / 2) as i32,
            self.y + (self.height / 2) as i32,
        )
    }
}

pub trait CaptureService {
    fn region(&self) -> CaptureRegion;
    fn capture(&self) -> Result<Frame, String>;
    /// False once the tracked window moved, resized, was minimised or hidden.
    /// The engine then stops and keeps what it already stitched.
    fn target_is_stable(&self) -> bool;
}

#[cfg(windows)]
pub use windows_impl::DesktopRegionCapture;

#[cfg(windows)]
mod windows_impl {
    use super::{CaptureRegion, CaptureService, Frame};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::DwmFlush;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic, IsWindowVisible};

    pub struct DesktopRegionCapture {
        region: CaptureRegion,
        target: HWND,
        target_rect: Option<RECT>,
    }

    // The raw HWND is only read (rect / visibility checks) and the engine owns
    // this value on a single worker thread.
    unsafe impl Send for DesktopRegionCapture {}

    impl DesktopRegionCapture {
        pub fn new(region: CaptureRegion, target: HWND) -> Self {
            let target_rect = unsafe {
                let mut rect = RECT::default();
                if !target.0.is_null() && GetWindowRect(target, &mut rect).is_ok() {
                    Some(rect)
                } else {
                    None
                }
            };
            Self {
                region,
                target,
                target_rect,
            }
        }
    }

    impl CaptureService for DesktopRegionCapture {
        fn region(&self) -> CaptureRegion {
            self.region
        }

        fn capture(&self) -> Result<Frame, String> {
            // Waiting for the compositor keeps half-drawn browser surfaces out
            // of the matcher, which would otherwise look like content changes.
            unsafe {
                let _ = DwmFlush();
            }
            let snapshot = crate::native::ScreenSnapshot::capture_region(
                self.region.x,
                self.region.y,
                self.region.width,
                self.region.height,
            )?;
            Frame::new(snapshot.width, snapshot.height, snapshot.rgba_data)
        }

        fn target_is_stable(&self) -> bool {
            let Some(expected) = self.target_rect else {
                return true;
            };
            unsafe {
                if self.target.0.is_null() {
                    return true;
                }
                if !IsWindowVisible(self.target).as_bool() || IsIconic(self.target).as_bool() {
                    return false;
                }
                let mut rect = RECT::default();
                if GetWindowRect(self.target, &mut rect).is_err() {
                    return false;
                }
                rect.left == expected.left
                    && rect.top == expected.top
                    && rect.right == expected.right
                    && rect.bottom == expected.bottom
            }
        }
    }
}

#[cfg(test)]
pub mod test_support {
    use super::{CaptureRegion, CaptureService, Frame};
    use std::cell::RefCell;

    /// Replays a scripted list of frames, so the engine can be driven without a
    /// desktop. The last frame repeats once the script runs out, which is what
    /// a real page does at the bottom.
    pub struct ScriptedCapture {
        frames: RefCell<Vec<Frame>>,
        index: RefCell<usize>,
        pub stable: RefCell<bool>,
    }

    impl ScriptedCapture {
        pub fn new(frames: Vec<Frame>) -> Self {
            assert!(!frames.is_empty());
            Self {
                frames: RefCell::new(frames),
                index: RefCell::new(0),
                stable: RefCell::new(true),
            }
        }

        /// Advances to the next scripted frame. The scroll controller calls
        /// this so the capture reflects the scroll that was requested.
        pub fn advance(&self) {
            let mut index = self.index.borrow_mut();
            if *index + 1 < self.frames.borrow().len() {
                *index += 1;
            }
        }
    }

    impl CaptureService for ScriptedCapture {
        fn region(&self) -> CaptureRegion {
            let frames = self.frames.borrow();
            CaptureRegion {
                x: 0,
                y: 0,
                width: frames[0].width,
                height: frames[0].height,
            }
        }

        fn capture(&self) -> Result<Frame, String> {
            let frames = self.frames.borrow();
            Ok(frames[*self.index.borrow()].clone())
        }

        fn target_is_stable(&self) -> bool {
            *self.stable.borrow()
        }
    }
}
