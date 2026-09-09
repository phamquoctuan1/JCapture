//! Per-run capture log.
//!
//! Scrolling capture fails in ways a screenshot cannot show: an offset locked
//! onto the wrong seam, a page that stopped loading, a wheel event nobody
//! consumed. Every frame therefore records what was requested and what was
//! measured, so a bad stitch can be diagnosed after the fact.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;

pub struct CaptureLogger {
    file: Option<File>,
    echo: bool,
}

impl CaptureLogger {
    /// Opens (and truncates) the log for a new run. Logging never fails the
    /// capture: if the file cannot be opened the lines still go to stderr.
    pub fn new(path: &Path) -> Self {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)
            .ok();
        Self { file, echo: true }
    }

    pub fn silent() -> Self {
        Self {
            file: None,
            echo: false,
        }
    }

    pub fn line(&mut self, text: &str) {
        if self.echo {
            eprintln!("[scrolling] {}", text);
        }
        if let Some(file) = self.file.as_mut() {
            let _ = writeln!(file, "{}", text);
            let _ = file.flush();
        }
    }
}
