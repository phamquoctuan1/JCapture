#[cfg(windows)]
use windows::Win32::Foundation::HWND;
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, PostThreadMessageW, TranslateMessage, MSG, WM_HOTKEY, WM_USER,
};

use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use lazy_static::lazy_static;
use parking_lot::Mutex;

pub const HOTKEY_ID_CAPTURE: i32 = 1001;
pub const HOTKEY_ID_RECORD: i32 = 1002;
const WM_RELOAD_HOTKEYS: u32 = WM_USER + 101;

lazy_static! {
    static ref HOTKEY_SENDER: Mutex<Option<(Sender<(String, String)>, u32)>> = Mutex::new(None);
}

pub fn parse_hotkey(s: &str) -> Option<(HOT_KEY_MODIFIERS, u32)> {
    let mut mods = MOD_NOREPEAT.0;
    let mut vk: Option<u32> = None;

    for part in s.split('+') {
        let p = part.trim().to_uppercase();
        match p.as_str() {
            "CTRL" | "CONTROL" => mods |= MOD_CONTROL.0,
            "SHIFT" => mods |= MOD_SHIFT.0,
            "ALT" => mods |= MOD_ALT.0,
            "WIN" | "SUPER" => mods |= MOD_WIN.0,
            "PRINTSCREEN" | "PRTSCN" | "PRINT" => vk = Some(0x2C),
            "F1" => vk = Some(0x70),
            "F2" => vk = Some(0x71),
            "F3" => vk = Some(0x72),
            "F4" => vk = Some(0x73),
            "F5" => vk = Some(0x74),
            "F6" => vk = Some(0x75),
            "F7" => vk = Some(0x76),
            "F8" => vk = Some(0x77),
            "F9" => vk = Some(0x78),
            "F10" => vk = Some(0x79),
            "F11" => vk = Some(0x7A),
            "F12" => vk = Some(0x7B),
            "SPACE" => vk = Some(0x20),
            "INSERT" => vk = Some(0x2D),
            "DELETE" => vk = Some(0x2E),
            single if single.len() == 1 => {
                let ch = single.chars().next().unwrap();
                if ch.is_ascii_alphanumeric() {
                    vk = Some(ch as u32);
                }
            }
            _ => {}
        }
    }

    vk.map(|k| (HOT_KEY_MODIFIERS(mods), k))
}

pub fn update_global_hotkeys(capture_shortcut: &str, record_shortcut: &str) {
    let lock = HOTKEY_SENDER.lock();
    if let Some((ref sender, thread_id)) = *lock {
        let _ = sender.send((capture_shortcut.to_string(), record_shortcut.to_string()));
        #[cfg(windows)]
        unsafe {
            let _ = PostThreadMessageW(thread_id, WM_RELOAD_HOTKEYS, windows::Win32::Foundation::WPARAM(0), windows::Win32::Foundation::LPARAM(0));
        }
    }
}

pub fn start_hotkey_listener(
    initial_capture: String,
    initial_record: String,
    on_capture_press: Arc<dyn Fn() + Send + Sync + 'static>,
    on_record_press: Arc<dyn Fn() + Send + Sync + 'static>,
) {
    let (tx, rx) = channel::<(String, String)>();

    std::thread::spawn(move || {
        #[cfg(windows)]
        unsafe {
            let thread_id = windows::Win32::System::Threading::GetCurrentThreadId();
            {
                let mut lock = HOTKEY_SENDER.lock();
                *lock = Some((tx, thread_id));
            }

            let mut current_cap = initial_capture;
            let mut current_rec = initial_record;

            let register_keys = |cap: &str, rec: &str| {
                let _ = UnregisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID_CAPTURE);
                let _ = UnregisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID_RECORD);

                // Try registering user capture hotkey
                if let Some((mods, vk)) = parse_hotkey(cap) {
                    if let Err(e) = RegisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID_CAPTURE, mods, vk) {
                        eprintln!("Warning: Failed to register hotkey '{}': {}", cap, e);
                        // Try fallback to Alt+A if Ctrl+Shift+A was occupied
                        if cap.eq_ignore_ascii_case("Ctrl+Shift+A") {
                            if let Some((alt_mods, alt_vk)) = parse_hotkey("Alt+A") {
                                let _ = RegisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID_CAPTURE, alt_mods, alt_vk);
                                println!("Registered fallback hotkey: Alt+A");
                            }
                        }
                    } else {
                        println!("Successfully registered capture hotkey: {}", cap);
                    }
                }

                // Try registering user record hotkey
                if let Some((mods, vk)) = parse_hotkey(rec) {
                    if let Err(e) = RegisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID_RECORD, mods, vk) {
                        eprintln!("Warning: Failed to register record hotkey '{}': {}", rec, e);
                    } else {
                        println!("Successfully registered record hotkey: {}", rec);
                    }
                }
            };

            register_keys(&current_cap, &current_rec);

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0).as_bool() {
                if msg.message == WM_HOTKEY {
                    let id = msg.wParam.0 as i32;
                    if id == HOTKEY_ID_CAPTURE {
                        on_capture_press();
                    } else if id == HOTKEY_ID_RECORD {
                        on_record_press();
                    }
                } else if msg.message == WM_RELOAD_HOTKEYS {
                    while let Ok((new_cap, new_rec)) = rx.try_recv() {
                        current_cap = new_cap;
                        current_rec = new_rec;
                    }
                    register_keys(&current_cap, &current_rec);
                }

                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            let _ = UnregisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID_CAPTURE);
            let _ = UnregisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID_RECORD);
        }
    });
}
