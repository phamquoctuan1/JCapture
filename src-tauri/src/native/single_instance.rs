#[cfg(windows)]
use windows::{
    core::w,
    Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS},
    Win32::System::Threading::CreateMutexW,
    Win32::UI::WindowsAndMessaging::{FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE},
};

#[cfg(windows)]
static mut _SINGLE_INSTANCE_MUTEX: Option<windows::Win32::Foundation::HANDLE> = None;

/// Ensures only one instance of JCapture runs at a time.
/// Returns `true` if this is the first/primary instance, or `false` if another instance is already running.
pub fn enforce_single_instance() -> bool {
    #[cfg(windows)]
    unsafe {
        let mutex_name = w!("Global\\JCapture_SingleInstance_Mutex_Lock_0x2026");
        let handle = CreateMutexW(None, true, mutex_name);

        if GetLastError() == ERROR_ALREADY_EXISTS {
            // Another instance is already running! Bring its window to focus
            if let Ok(hwnd) = FindWindowW(None, w!("JCapture")) {
                if !hwnd.0.is_null() {
                    let _ = ShowWindow(hwnd, SW_RESTORE);
                    let _ = SetForegroundWindow(hwnd);
                }
            }
            return false;
        }

        if let Ok(h) = handle {
            _SINGLE_INSTANCE_MUTEX = Some(h);
        }
        true
    }
    #[cfg(not(windows))]
    {
        true
    }
}
