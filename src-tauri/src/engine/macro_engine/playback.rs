#[cfg(not(target_os = "linux"))]
use enigo::{Axis, Button, Coordinate, Enigo, Key as KeyCode, Keyboard, Mouse, Settings};
#[cfg(target_os = "linux")]
use enigo::{Enigo, Mouse, Settings};
#[cfg(target_os = "linux")]
use evdev::{EventType, InputEvent, KeyCode, RelativeAxisCode};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::time::sleep;

use super::state::MacroEngineState;
use super::types::{
    MacroAction, MacroActionConfig, MacroKeyboardAction, MacroMouseAction, MacroMoveStyle,
    MacroPlayerState,
};

const INTRA_CLICK_GAP_MS: f64 = 25.0;

fn intra_click_gap_ms(multiplier: f64) -> u64 {
    (INTRA_CLICK_GAP_MS / multiplier).round().max(1.0) as u64
}

#[cfg(not(target_os = "linux"))]
async fn execute_action(
    enigo: &mut Enigo,
    action: &MacroAction,
    multiplier: f64,
) -> Result<(), String> {
    match &action.config {
        MacroActionConfig::Mouse {
            button,
            action: mouse_action,
            position,
            clicks,
        } => {
            if let Some((x, y)) = position {
                enigo
                    .move_mouse(*x, *y, Coordinate::Abs)
                    .map_err(|e| format!("Could not move the mouse. Details: {}", e))?;

                sleep(Duration::from_millis(
                    (10.0 / multiplier).round().max(1.0) as u64
                ))
                .await;
            }

            match mouse_action {
                MacroMouseAction::Press => {
                    let btn = macro_button_to_enigo(button)?;
                    let total = (*clicks).clamp(1, 3) as u32;
                    for attempt in 0..total {
                        if attempt > 0 {
                            sleep(Duration::from_millis(intra_click_gap_ms(multiplier))).await;
                        }
                        enigo.button(btn, enigo::Direction::Press).map_err(|e| {
                            format!("Could not press the mouse button. Details: {}", e)
                        })?;
                        sleep(Duration::from_millis(
                            (50.0 / multiplier).round().max(1.0) as u64
                        ))
                        .await;
                        enigo.button(btn, enigo::Direction::Release).map_err(|e| {
                            format!("Could not release the mouse button. Details: {}", e)
                        })?;
                    }
                }
                MacroMouseAction::Hold { duration_ms } => {
                    let btn = macro_button_to_enigo(button)?;
                    enigo
                        .button(btn, enigo::Direction::Press)
                        .map_err(|e| format!("Could not press the mouse button. Details: {}", e))?;
                    sleep(Duration::from_millis(
                        (*duration_ms as f64 / multiplier).round() as u64,
                    ))
                    .await;
                    enigo.button(btn, enigo::Direction::Release).map_err(|e| {
                        format!("Could not release the mouse button. Details: {}", e)
                    })?;
                }
                MacroMouseAction::Down => {
                    let btn = macro_button_to_enigo(button)?;
                    enigo
                        .button(btn, enigo::Direction::Press)
                        .map_err(|e| format!("Could not press the mouse button. Details: {}", e))?;
                }
                MacroMouseAction::Up => {
                    let btn = macro_button_to_enigo(button)?;
                    enigo.button(btn, enigo::Direction::Release).map_err(|e| {
                        format!("Could not release the mouse button. Details: {}", e)
                    })?;
                }
            }
        }
        MacroActionConfig::Move { x, y, style } => match style {
            MacroMoveStyle::Instant => {
                enigo
                    .move_mouse(*x, *y, Coordinate::Abs)
                    .map_err(|e| format!("Could not move the mouse. Details: {}", e))?;
            }
            MacroMoveStyle::Linear { duration_ms } => {
                linear_move_to(
                    enigo,
                    *x,
                    *y,
                    (*duration_ms as f64 / multiplier).round() as u32,
                )
                .await?;
            }
            MacroMoveStyle::Smooth { path, duration_ms } => {
                play_smooth_path(
                    enigo,
                    path,
                    (*duration_ms as f64 / multiplier).round() as u32,
                )
                .await?;
            }
        },
        MacroActionConfig::RawMove { points } => {
            play_raw_move(enigo, points, multiplier).await?;
        }
        MacroActionConfig::Keyboard {
            key,
            text,
            modifiers,
            action,
        } => {
            if let Some(recorded_text) = text.as_deref() {
                if modifiers.is_empty() && matches!(action, MacroKeyboardAction::Press) {
                    enigo
                        .text(recorded_text)
                        .map_err(|e| format!("Could not type the recorded text. Details: {}", e))?;
                    return Ok(());
                }
            }

            for modifier in modifiers {
                if let Some(key_code) = modifier_to_key(modifier) {
                    enigo
                        .key(key_code, enigo::Direction::Press)
                        .map_err(|e| format!("Could not hold a shortcut key. Details: {}", e))?;
                }
            }

            let key_code = if modifiers.is_empty() {
                str_to_key(key)
            } else {
                str_to_combo_key(key)
            };

            match action {
                MacroKeyboardAction::Press => {
                    enigo
                        .key(key_code, enigo::Direction::Click)
                        .map_err(|e| format!("Could not press the key. Details: {}", e))?;
                }
                MacroKeyboardAction::Hold { duration_ms } => {
                    enigo
                        .key(key_code, enigo::Direction::Press)
                        .map_err(|e| format!("Could not press the key. Details: {}", e))?;
                    sleep(Duration::from_millis(
                        (*duration_ms as f64 / multiplier).round() as u64,
                    ))
                    .await;
                    enigo
                        .key(key_code, enigo::Direction::Release)
                        .map_err(|e| format!("Could not release the key. Details: {}", e))?;
                }
                MacroKeyboardAction::Down => {
                    enigo
                        .key(key_code, enigo::Direction::Press)
                        .map_err(|e| format!("Could not press the key. Details: {}", e))?;
                }
                MacroKeyboardAction::Up => {
                    enigo
                        .key(key_code, enigo::Direction::Release)
                        .map_err(|e| format!("Could not release the key. Details: {}", e))?;
                }
            }

            for modifier in modifiers.iter().rev() {
                if let Some(key_code) = modifier_to_key(modifier) {
                    enigo
                        .key(key_code, enigo::Direction::Release)
                        .map_err(|e| format!("Could not release a shortcut key. Details: {}", e))?;
                }
            }
        }
        MacroActionConfig::Sleep { duration_ms } => {
            sleep(Duration::from_millis(
                (*duration_ms as f64 / multiplier).round() as u64,
            ))
            .await;
        }
        MacroActionConfig::Scroll { clicks } => {
            enigo
                .scroll(-*clicks, Axis::Vertical)
                .map_err(|e| format!("Could not scroll mouse wheel. Details: {}", e))?;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
struct LinuxPlaybackBackend {
    mouse: evdev::uinput::VirtualDevice,
    keyboard: evdev::uinput::VirtualDevice,
}

#[cfg(target_os = "linux")]
impl LinuxPlaybackBackend {
    fn new() -> Result<Self, String> {
        let mouse = crate::engine::uinput::setup_uinput().ok_or_else(uinput_error)?;
        let keyboard =
            crate::engine::keyboard_uinput::setup_keyboard_uinput().ok_or_else(uinput_error)?;

        Ok(Self { mouse, keyboard })
    }

    fn emit_key(
        device: &mut evdev::uinput::VirtualDevice,
        key: KeyCode,
        pressed: bool,
    ) -> Result<(), String> {
        device
            .emit(&[
                InputEvent::new(EventType::KEY.0, key.0, i32::from(pressed)),
                InputEvent::new(EventType::SYNCHRONIZATION.0, 0, 0),
            ])
            .map_err(|e| format!("Could not emit input event. Details: {e}"))
    }

    fn move_mouse(&mut self, x: i32, y: i32) -> Result<(), String> {
        self.mouse
            .emit(&[
                InputEvent::new(EventType::ABSOLUTE.0, evdev::AbsoluteAxisCode::ABS_X.0, x),
                InputEvent::new(EventType::ABSOLUTE.0, evdev::AbsoluteAxisCode::ABS_Y.0, y),
                InputEvent::new(EventType::SYNCHRONIZATION.0, 0, 0),
            ])
            .map_err(|e| format!("Could not move the mouse. Details: {e}"))
    }

    async fn click_mouse(
        &mut self,
        button: &crate::engine::macro_engine::types::MacroMouseButton,
        action: &MacroMouseAction,
        clicks: u8,
        multiplier: f64,
    ) -> Result<(), String> {
        let key = macro_button_to_evdev(button);
        match action {
            MacroMouseAction::Press => {
                let total = clicks.clamp(1, 3) as u32;
                for attempt in 0..total {
                    if attempt > 0 {
                        sleep(Duration::from_millis(intra_click_gap_ms(multiplier))).await;
                    }
                    Self::emit_key(&mut self.mouse, key, true)?;
                    sleep(Duration::from_millis(
                        (50.0 / multiplier).round().max(1.0) as u64
                    ))
                    .await;
                    Self::emit_key(&mut self.mouse, key, false)?;
                }
                Ok(())
            }
            MacroMouseAction::Hold { duration_ms } => {
                Self::emit_key(&mut self.mouse, key, true)?;
                sleep(Duration::from_millis(
                    (*duration_ms as f64 / multiplier).round() as u64,
                ))
                .await;
                Self::emit_key(&mut self.mouse, key, false)
            }
            MacroMouseAction::Down => Self::emit_key(&mut self.mouse, key, true),
            MacroMouseAction::Up => Self::emit_key(&mut self.mouse, key, false),
        }
    }

    fn press_keyboard_key(&mut self, key: KeyCode) -> Result<(), String> {
        Self::emit_key(&mut self.keyboard, key, true)?;
        Self::emit_key(&mut self.keyboard, key, false)
    }

    fn scroll_mouse(&mut self, clicks: i32) -> Result<(), String> {
        self.mouse
            .emit(&[
                InputEvent::new(EventType::RELATIVE.0, RelativeAxisCode::REL_WHEEL.0, -clicks),
                InputEvent::new(EventType::SYNCHRONIZATION.0, 0, 0),
            ])
            .map_err(|e| format!("Could not scroll mouse. Details: {e}"))
    }
}

#[cfg(target_os = "linux")]
fn uinput_error() -> String {
    "Could not initialize Linux virtual input devices. Make sure /dev/uinput exists and is writable for your user, then try again.".to_string()
}

#[cfg(target_os = "linux")]
async fn execute_action(
    backend: &mut LinuxPlaybackBackend,
    action: &MacroAction,
    multiplier: f64,
) -> Result<(), String> {
    match &action.config {
        MacroActionConfig::Mouse {
            button,
            action: mouse_action,
            position,
            clicks,
        } => {
            if let Some((x, y)) = position {
                backend.move_mouse(*x, *y)?;
                sleep(Duration::from_millis(
                    (10.0 / multiplier).round().max(1.0) as u64
                ))
                .await;
            }

            backend
                .click_mouse(button, mouse_action, *clicks, multiplier)
                .await?;
        }
        MacroActionConfig::Move { x, y, style } => match style {
            MacroMoveStyle::Instant => backend.move_mouse(*x, *y)?,
            MacroMoveStyle::Linear { duration_ms } => {
                linear_move_to(
                    backend,
                    *x,
                    *y,
                    (*duration_ms as f64 / multiplier).round() as u32,
                )
                .await?;
            }
            MacroMoveStyle::Smooth { path, duration_ms } => {
                play_smooth_path(
                    backend,
                    path,
                    (*duration_ms as f64 / multiplier).round() as u32,
                )
                .await?;
            }
        },
        MacroActionConfig::RawMove { points } => {
            play_raw_move(backend, points, multiplier).await?;
        }
        MacroActionConfig::Keyboard {
            key,
            text,
            modifiers,
            action,
        } => {
            if let Some(recorded_text) = text.as_deref() {
                if modifiers.is_empty() && matches!(action, MacroKeyboardAction::Press) {
                    type_text(backend, recorded_text).await?;
                    return Ok(());
                }
            }

            let modifier_keys = modifiers_to_evdev(modifiers)?;
            for &modifier_key in &modifier_keys {
                LinuxPlaybackBackend::emit_key(&mut backend.keyboard, modifier_key, true)?;
            }

            let key_code = str_to_evdev_key(key).ok_or_else(|| {
                format!("The key `{key}` is not supported by Linux macro playback.")
            })?;

            match action {
                MacroKeyboardAction::Press => {
                    backend.press_keyboard_key(key_code)?;
                }
                MacroKeyboardAction::Hold { duration_ms } => {
                    LinuxPlaybackBackend::emit_key(&mut backend.keyboard, key_code, true)?;
                    sleep(Duration::from_millis(
                        (*duration_ms as f64 / multiplier).round() as u64,
                    ))
                    .await;
                    LinuxPlaybackBackend::emit_key(&mut backend.keyboard, key_code, false)?;
                }
                MacroKeyboardAction::Down => {
                    LinuxPlaybackBackend::emit_key(&mut backend.keyboard, key_code, true)?;
                }
                MacroKeyboardAction::Up => {
                    LinuxPlaybackBackend::emit_key(&mut backend.keyboard, key_code, false)?;
                }
            }

            for &modifier_key in modifier_keys.iter().rev() {
                LinuxPlaybackBackend::emit_key(&mut backend.keyboard, modifier_key, false)?;
            }
        }
        MacroActionConfig::Sleep { duration_ms } => {
            sleep(Duration::from_millis(
                (*duration_ms as f64 / multiplier).round() as u64,
            ))
            .await;
        }
        MacroActionConfig::Scroll { clicks } => {
            backend.scroll_mouse(*clicks)?;
        }
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn macro_button_to_enigo(
    button: &crate::engine::macro_engine::types::MacroMouseButton,
) -> Result<Button, String> {
    match button {
        crate::engine::macro_engine::types::MacroMouseButton::Left => Ok(Button::Left),
        crate::engine::macro_engine::types::MacroMouseButton::Middle => Ok(Button::Middle),
        crate::engine::macro_engine::types::MacroMouseButton::Right => Ok(Button::Right),
        crate::engine::macro_engine::types::MacroMouseButton::Front => map_extended_button("front"),
        crate::engine::macro_engine::types::MacroMouseButton::Back => map_back_button(),
    }
}

#[cfg(target_os = "linux")]
fn macro_button_to_evdev(button: &crate::engine::macro_engine::types::MacroMouseButton) -> KeyCode {
    match button {
        crate::engine::macro_engine::types::MacroMouseButton::Left => KeyCode::BTN_LEFT,
        crate::engine::macro_engine::types::MacroMouseButton::Middle => KeyCode::BTN_MIDDLE,
        crate::engine::macro_engine::types::MacroMouseButton::Right => KeyCode::BTN_RIGHT,
        crate::engine::macro_engine::types::MacroMouseButton::Front => KeyCode::BTN_SIDE,
        crate::engine::macro_engine::types::MacroMouseButton::Back => KeyCode::BTN_EXTRA,
    }
}

#[cfg(not(target_os = "linux"))]
#[cfg(target_os = "macos")]
fn map_extended_button(_name: &str) -> Result<Button, String> {
    Err("Front and back mouse buttons are not supported on macOS in this build.".to_string())
}

#[cfg(not(target_os = "linux"))]
#[cfg(not(target_os = "macos"))]
fn map_extended_button(_name: &str) -> Result<Button, String> {
    Ok(Button::Forward)
}

#[cfg(not(target_os = "linux"))]
#[cfg(target_os = "macos")]
fn map_back_button() -> Result<Button, String> {
    Err("Front and back mouse buttons are not supported on macOS in this build.".to_string())
}

#[cfg(not(target_os = "linux"))]
#[cfg(not(target_os = "macos"))]
fn map_back_button() -> Result<Button, String> {
    Ok(Button::Back)
}

#[cfg(not(target_os = "linux"))]
fn modifier_to_key(modifier: &str) -> Option<KeyCode> {
    match modifier.to_lowercase().as_str() {
        "ctrl" => Some(KeyCode::Control),
        "shift" => Some(KeyCode::Shift),
        "alt" => Some(KeyCode::Alt),
        "win" => Some(KeyCode::Meta),
        _ => None,
    }
}

#[cfg(not(target_os = "linux"))]
fn str_to_key(key: &str) -> KeyCode {
    match key.to_lowercase().as_str() {
        "a" => return KeyCode::A,
        "b" => return KeyCode::B,
        "c" => return KeyCode::C,
        "d" => return KeyCode::D,
        "e" => return KeyCode::E,
        "f" => return KeyCode::F,
        "g" => return KeyCode::G,
        "h" => return KeyCode::H,
        "i" => return KeyCode::I,
        "j" => return KeyCode::J,
        "k" => return KeyCode::K,
        "l" => return KeyCode::L,
        "m" => return KeyCode::M,
        "n" => return KeyCode::N,
        "o" => return KeyCode::O,
        "p" => return KeyCode::P,
        "q" => return KeyCode::Q,
        "r" => return KeyCode::R,
        "s" => return KeyCode::S,
        "t" => return KeyCode::T,
        "u" => return KeyCode::U,
        "v" => return KeyCode::V,
        "w" => return KeyCode::W,
        "x" => return KeyCode::X,
        "y" => return KeyCode::Y,
        "z" => return KeyCode::Z,
        "0" => return KeyCode::Num0,
        "1" => return KeyCode::Num1,
        "2" => return KeyCode::Num2,
        "3" => return KeyCode::Num3,
        "4" => return KeyCode::Num4,
        "5" => return KeyCode::Num5,
        "6" => return KeyCode::Num6,
        "7" => return KeyCode::Num7,
        "8" => return KeyCode::Num8,
        "9" => return KeyCode::Num9,
        "space" => return KeyCode::Space,
        "enter" => return KeyCode::Return,
        "tab" => return KeyCode::Tab,
        "backspace" => return KeyCode::Backspace,
        "escape" => return KeyCode::Escape,
        "delete" => return KeyCode::Delete,
        "insert" => return KeyCode::Insert,
        "home" => return KeyCode::Home,
        "end" => return KeyCode::End,
        "pageup" => return KeyCode::PageUp,
        "pagedown" => return KeyCode::PageDown,
        "up" => return KeyCode::UpArrow,
        "down" => return KeyCode::DownArrow,
        "left" => return KeyCode::LeftArrow,
        "right" => return KeyCode::RightArrow,
        "f1" => return KeyCode::F1,
        "f2" => return KeyCode::F2,
        "f3" => return KeyCode::F3,
        "f4" => return KeyCode::F4,
        "f5" => return KeyCode::F5,
        "f6" => return KeyCode::F6,
        "f7" => return KeyCode::F7,
        "f8" => return KeyCode::F8,
        "f9" => return KeyCode::F9,
        "f10" => return KeyCode::F10,
        "f11" => return KeyCode::F11,
        "f12" => return KeyCode::F12,
        "numpad0" => return KeyCode::Num0,
        "numpad1" => return KeyCode::Num1,
        "numpad2" => return KeyCode::Num2,
        "numpad3" => return KeyCode::Num3,
        "numpad4" => return KeyCode::Num4,
        "numpad5" => return KeyCode::Num5,
        "numpad6" => return KeyCode::Num6,
        "numpad7" => return KeyCode::Num7,
        "numpad8" => return KeyCode::Num8,
        "numpad9" => return KeyCode::Num9,
        "ctrl" | "control" => return KeyCode::Control,
        "shift" => return KeyCode::Shift,
        "alt" => return KeyCode::Alt,
        "win" | "meta" | "super" => return KeyCode::Meta,
        _ => {}
    }

    if key.len() == 1 {
        let c = key.chars().next().unwrap();
        return KeyCode::Unicode(c);
    }

    KeyCode::Unicode(key.chars().next().unwrap_or('a'))
}

#[cfg(not(target_os = "linux"))]
fn str_to_combo_key(key: &str) -> KeyCode {
    str_to_key(key)
}

#[cfg(target_os = "linux")]
fn str_to_evdev_key(key: &str) -> Option<KeyCode> {
    match key.to_lowercase().as_str() {
        "a" => Some(KeyCode::KEY_A),
        "b" => Some(KeyCode::KEY_B),
        "c" => Some(KeyCode::KEY_C),
        "d" => Some(KeyCode::KEY_D),
        "e" => Some(KeyCode::KEY_E),
        "f" => Some(KeyCode::KEY_F),
        "g" => Some(KeyCode::KEY_G),
        "h" => Some(KeyCode::KEY_H),
        "i" => Some(KeyCode::KEY_I),
        "j" => Some(KeyCode::KEY_J),
        "k" => Some(KeyCode::KEY_K),
        "l" => Some(KeyCode::KEY_L),
        "m" => Some(KeyCode::KEY_M),
        "n" => Some(KeyCode::KEY_N),
        "o" => Some(KeyCode::KEY_O),
        "p" => Some(KeyCode::KEY_P),
        "q" => Some(KeyCode::KEY_Q),
        "r" => Some(KeyCode::KEY_R),
        "s" => Some(KeyCode::KEY_S),
        "t" => Some(KeyCode::KEY_T),
        "u" => Some(KeyCode::KEY_U),
        "v" => Some(KeyCode::KEY_V),
        "w" => Some(KeyCode::KEY_W),
        "x" => Some(KeyCode::KEY_X),
        "y" => Some(KeyCode::KEY_Y),
        "z" => Some(KeyCode::KEY_Z),
        "0" => Some(KeyCode::KEY_0),
        "1" => Some(KeyCode::KEY_1),
        "2" => Some(KeyCode::KEY_2),
        "3" => Some(KeyCode::KEY_3),
        "4" => Some(KeyCode::KEY_4),
        "5" => Some(KeyCode::KEY_5),
        "6" => Some(KeyCode::KEY_6),
        "7" => Some(KeyCode::KEY_7),
        "8" => Some(KeyCode::KEY_8),
        "9" => Some(KeyCode::KEY_9),
        "f1" => Some(KeyCode::KEY_F1),
        "f2" => Some(KeyCode::KEY_F2),
        "f3" => Some(KeyCode::KEY_F3),
        "f4" => Some(KeyCode::KEY_F4),
        "f5" => Some(KeyCode::KEY_F5),
        "f6" => Some(KeyCode::KEY_F6),
        "f7" => Some(KeyCode::KEY_F7),
        "f8" => Some(KeyCode::KEY_F8),
        "f9" => Some(KeyCode::KEY_F9),
        "f10" => Some(KeyCode::KEY_F10),
        "f11" => Some(KeyCode::KEY_F11),
        "f12" => Some(KeyCode::KEY_F12),
        "escape" | "esc" => Some(KeyCode::KEY_ESC),
        "space" => Some(KeyCode::KEY_SPACE),
        "enter" | "return" => Some(KeyCode::KEY_ENTER),
        "tab" => Some(KeyCode::KEY_TAB),
        "backspace" | "back" => Some(KeyCode::KEY_BACKSPACE),
        "delete" | "del" => Some(KeyCode::KEY_DELETE),
        "insert" | "ins" => Some(KeyCode::KEY_INSERT),
        "home" => Some(KeyCode::KEY_HOME),
        "end" => Some(KeyCode::KEY_END),
        "pageup" | "page_up" | "pgup" => Some(KeyCode::KEY_PAGEUP),
        "pagedown" | "page_down" | "pgdn" => Some(KeyCode::KEY_PAGEDOWN),
        "arrowup" | "up" => Some(KeyCode::KEY_UP),
        "arrowdown" | "down" => Some(KeyCode::KEY_DOWN),
        "arrowleft" | "left" => Some(KeyCode::KEY_LEFT),
        "arrowright" | "right" => Some(KeyCode::KEY_RIGHT),
        "grave" | "`" => Some(KeyCode::KEY_GRAVE),
        "minus" | "-" => Some(KeyCode::KEY_MINUS),
        "equal" | "=" => Some(KeyCode::KEY_EQUAL),
        "leftbrace" | "[" => Some(KeyCode::KEY_LEFTBRACE),
        "rightbrace" | "]" => Some(KeyCode::KEY_RIGHTBRACE),
        "backslash" | "\\" => Some(KeyCode::KEY_BACKSLASH),
        "semicolon" | ";" => Some(KeyCode::KEY_SEMICOLON),
        "apostrophe" | "'" => Some(KeyCode::KEY_APOSTROPHE),
        "comma" | "," => Some(KeyCode::KEY_COMMA),
        "dot" | "." => Some(KeyCode::KEY_DOT),
        "slash" | "/" => Some(KeyCode::KEY_SLASH),
        "kp0" | "numpad0" => Some(KeyCode::KEY_KP0),
        "kp1" | "numpad1" => Some(KeyCode::KEY_KP1),
        "kp2" | "numpad2" => Some(KeyCode::KEY_KP2),
        "kp3" | "numpad3" => Some(KeyCode::KEY_KP3),
        "kp4" | "numpad4" => Some(KeyCode::KEY_KP4),
        "kp5" | "numpad5" => Some(KeyCode::KEY_KP5),
        "kp6" | "numpad6" => Some(KeyCode::KEY_KP6),
        "kp7" | "numpad7" => Some(KeyCode::KEY_KP7),
        "kp8" | "numpad8" => Some(KeyCode::KEY_KP8),
        "kp9" | "numpad9" => Some(KeyCode::KEY_KP9),
        "kpenter" | "numpad_enter" => Some(KeyCode::KEY_KPENTER),
        "kpplus" | "kp+" | "numpad_+" => Some(KeyCode::KEY_KPPLUS),
        "kpminus" | "kp-" | "numpad_-" => Some(KeyCode::KEY_KPMINUS),
        "kpasterisk" | "kp*" | "numpad_*" => Some(KeyCode::KEY_KPASTERISK),
        "kpdot" | "kp." | "numpad_." => Some(KeyCode::KEY_KPDOT),
        "kpslash" | "kp/" | "numpad_/" => Some(KeyCode::KEY_KPSLASH),
        "numlock" | "num_lock" => Some(KeyCode::KEY_NUMLOCK),
        "capslock" | "caps" => Some(KeyCode::KEY_CAPSLOCK),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn modifiers_to_evdev(modifiers: &[String]) -> Result<Vec<KeyCode>, String> {
    let mut keys = Vec::new();
    for modifier in modifiers {
        match modifier.to_lowercase().as_str() {
            "ctrl" | "control" => keys.push(KeyCode::KEY_LEFTCTRL),
            "shift" => keys.push(KeyCode::KEY_LEFTSHIFT),
            "alt" => keys.push(KeyCode::KEY_LEFTALT),
            "win" | "meta" | "super" => keys.push(KeyCode::KEY_LEFTMETA),
            "" => {}
            other => {
                return Err(format!(
                    "The modifier `{other}` is not supported by Linux macro playback."
                ))
            }
        }
    }
    Ok(keys)
}

#[cfg(target_os = "linux")]
fn char_to_evdev(ch: char) -> Option<(KeyCode, bool)> {
    let lower = ch.to_ascii_lowercase();
    let needs_shift = ch.is_ascii_uppercase()
        || matches!(
            ch,
            '!' | '@'
                | '#'
                | '$'
                | '%'
                | '^'
                | '&'
                | '*'
                | '('
                | ')'
                | '_'
                | '+'
                | '{'
                | '}'
                | '|'
                | ':'
                | '"'
                | '<'
                | '>'
                | '?'
        );

    let key = match lower {
        'a'..='z' | '0'..='9' => str_to_evdev_key(&lower.to_string())?,
        ' ' => KeyCode::KEY_SPACE,
        '\n' => KeyCode::KEY_ENTER,
        '\t' => KeyCode::KEY_TAB,
        '!' => KeyCode::KEY_1,
        '@' => KeyCode::KEY_2,
        '#' => KeyCode::KEY_3,
        '$' => KeyCode::KEY_4,
        '%' => KeyCode::KEY_5,
        '^' => KeyCode::KEY_6,
        '&' => KeyCode::KEY_7,
        '*' => KeyCode::KEY_8,
        '(' => KeyCode::KEY_9,
        ')' => KeyCode::KEY_0,
        '`' | '~' => KeyCode::KEY_GRAVE,
        '-' | '_' => KeyCode::KEY_MINUS,
        '=' | '+' => KeyCode::KEY_EQUAL,
        '[' | '{' => KeyCode::KEY_LEFTBRACE,
        ']' | '}' => KeyCode::KEY_RIGHTBRACE,
        '\\' | '|' => KeyCode::KEY_BACKSLASH,
        ';' | ':' => KeyCode::KEY_SEMICOLON,
        '\'' | '"' => KeyCode::KEY_APOSTROPHE,
        ',' | '<' => KeyCode::KEY_COMMA,
        '.' | '>' => KeyCode::KEY_DOT,
        '/' | '?' => KeyCode::KEY_SLASH,
        _ => return None,
    };

    Some((key, needs_shift))
}

#[cfg(target_os = "linux")]
async fn type_text(backend: &mut LinuxPlaybackBackend, text: &str) -> Result<(), String> {
    for ch in text.chars() {
        let (key, needs_shift) = char_to_evdev(ch).ok_or_else(|| {
            format!("The character `{ch}` is not supported by Linux macro playback.")
        })?;
        if needs_shift {
            LinuxPlaybackBackend::emit_key(&mut backend.keyboard, KeyCode::KEY_LEFTSHIFT, true)?;
        }
        backend.press_keyboard_key(key)?;
        if needs_shift {
            LinuxPlaybackBackend::emit_key(&mut backend.keyboard, KeyCode::KEY_LEFTSHIFT, false)?;
        }
        sleep(Duration::from_millis(3)).await;
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
async fn linear_move_to(
    enigo: &mut Enigo,
    target_x: i32,
    target_y: i32,
    duration_ms: u32,
) -> Result<(), String> {
    let (start_x, start_y) = enigo
        .location()
        .map_err(|e| format!("Could not read the cursor position. Details: {}", e))?;

    let duration_ms = duration_ms.max(16);
    let step_count = ((duration_ms as f32 / 12.0).ceil() as u32).clamp(2, 120);

    for step in 1..=step_count {
        let progress = step as f32 / step_count as f32;
        let next_x = start_x + ((target_x - start_x) as f32 * progress).round() as i32;
        let next_y = start_y + ((target_y - start_y) as f32 * progress).round() as i32;

        enigo
            .move_mouse(next_x, next_y, Coordinate::Abs)
            .map_err(|e| format!("Could not move the mouse. Details: {}", e))?;

        sleep(Duration::from_millis(
            (duration_ms / step_count.max(1)) as u64,
        ))
        .await;
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
async fn play_smooth_path(
    enigo: &mut Enigo,
    path: &[(i32, i32)],
    duration_ms: u32,
) -> Result<(), String> {
    if path.is_empty() {
        return Ok(());
    }
    if path.len() == 1 {
        let (x, y) = path[0];
        enigo
            .move_mouse(x, y, Coordinate::Abs)
            .map_err(|e| format!("Could not move mouse to ({}, {}): {}", x, y, e))?;
        return Ok(());
    }

    let mut segment_lengths = Vec::with_capacity(path.len() - 1);
    let mut total_length = 0.0f32;
    for i in 1..path.len() {
        let dx = (path[i].0 - path[i - 1].0) as f32;
        let dy = (path[i].1 - path[i - 1].1) as f32;
        let len = (dx * dx + dy * dy).sqrt();
        segment_lengths.push(len);
        total_length += len;
    }

    if total_length <= 0.0 {
        let (x, y) = path[0];
        enigo
            .move_mouse(x, y, Coordinate::Abs)
            .map_err(|e| format!("Could not move mouse to ({}, {}): {}", x, y, e))?;
        return Ok(());
    }

    let duration_ms = duration_ms.max(1);

    for i in 1..path.len() {
        let (start_x, start_y) = path[i - 1];
        let (target_x, target_y) = path[i];
        let segment_duration =
            (duration_ms as f32 * segment_lengths[i - 1] / total_length).max(8.0) as u32;
        let step_count = ((segment_duration as f32 / 8.0).ceil() as u32).clamp(2, 60);

        for step in 1..=step_count {
            let progress = step as f32 / step_count as f32;
            let x = start_x + ((target_x - start_x) as f32 * progress).round() as i32;
            let y = start_y + ((target_y - start_y) as f32 * progress).round() as i32;
            enigo
                .move_mouse(x, y, Coordinate::Abs)
                .map_err(|e| format!("Could not move the mouse. Details: {}", e))?;
            sleep(Duration::from_millis(
                (segment_duration / step_count.max(1)) as u64,
            ))
            .await;
        }
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
async fn play_raw_move(
    enigo: &mut Enigo,
    points: &[(i32, i32, u64)],
    multiplier: f64,
) -> Result<(), String> {
    if points.is_empty() {
        return Ok(());
    }
    let mut prev_ts = points[0].2;
    for &(x, y, ts) in points {
        enigo
            .move_mouse(x, y, Coordinate::Abs)
            .map_err(|e| format!("Could not move the mouse. Details: {}", e))?;
        if ts > prev_ts {
            let delay_ms = ((ts - prev_ts) as f64 / multiplier).round() as u64;
            if delay_ms > 0 {
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }
        prev_ts = ts;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
async fn linear_move_to(
    backend: &mut LinuxPlaybackBackend,
    target_x: i32,
    target_y: i32,
    duration_ms: u32,
) -> Result<(), String> {
    let (start_x, start_y) = current_cursor_position().unwrap_or((target_x, target_y));
    let duration_ms = duration_ms.max(16);
    let step_count = ((duration_ms as f32 / 12.0).ceil() as u32).clamp(2, 120);

    for step in 1..=step_count {
        let progress = step as f32 / step_count as f32;
        let next_x = start_x + ((target_x - start_x) as f32 * progress).round() as i32;
        let next_y = start_y + ((target_y - start_y) as f32 * progress).round() as i32;

        backend.move_mouse(next_x, next_y)?;

        sleep(Duration::from_millis(
            (duration_ms / step_count.max(1)) as u64,
        ))
        .await;
    }

    Ok(())
}

#[cfg(target_os = "linux")]
async fn play_smooth_path(
    backend: &mut LinuxPlaybackBackend,
    path: &[(i32, i32)],
    duration_ms: u32,
) -> Result<(), String> {
    if path.is_empty() {
        return Ok(());
    }
    if path.len() == 1 {
        let (x, y) = path[0];
        backend.move_mouse(x, y)?;
        return Ok(());
    }

    let mut segment_lengths = Vec::with_capacity(path.len() - 1);
    let mut total_length = 0.0f32;
    for i in 1..path.len() {
        let dx = (path[i].0 - path[i - 1].0) as f32;
        let dy = (path[i].1 - path[i - 1].1) as f32;
        let len = (dx * dx + dy * dy).sqrt();
        segment_lengths.push(len);
        total_length += len;
    }

    if total_length <= 0.0 {
        let (x, y) = path[0];
        backend.move_mouse(x, y)?;
        return Ok(());
    }

    let duration_ms = duration_ms.max(1);

    for i in 1..path.len() {
        let (start_x, start_y) = path[i - 1];
        let (target_x, target_y) = path[i];
        let segment_duration =
            (duration_ms as f32 * segment_lengths[i - 1] / total_length).max(8.0) as u32;
        let step_count = ((segment_duration as f32 / 8.0).ceil() as u32).clamp(2, 60);

        for step in 1..=step_count {
            let progress = step as f32 / step_count as f32;
            let x = start_x + ((target_x - start_x) as f32 * progress).round() as i32;
            let y = start_y + ((target_y - start_y) as f32 * progress).round() as i32;
            backend.move_mouse(x, y)?;
            sleep(Duration::from_millis(
                (segment_duration / step_count.max(1)) as u64,
            ))
            .await;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
async fn play_raw_move(
    backend: &mut LinuxPlaybackBackend,
    points: &[(i32, i32, u64)],
    multiplier: f64,
) -> Result<(), String> {
    if points.is_empty() {
        return Ok(());
    }
    let mut prev_ts = points[0].2;
    for &(x, y, ts) in points {
        backend.move_mouse(x, y)?;
        if ts > prev_ts {
            let delay_ms = ((ts - prev_ts) as f64 / multiplier).round() as u64;
            if delay_ms > 0 {
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }
        prev_ts = ts;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn current_cursor_position() -> Result<(i32, i32), String> {
    let enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Could not initialize cursor reader. Details: {e}"))?;
    enigo
        .location()
        .map_err(|e| format!("Could not read the cursor position. Details: {e}"))
}

pub async fn start_playback(
    state: &MacroEngineState,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let actions = state.actions.lock().await;

    if actions.is_empty() {
        let _ = app_handle.emit(
            "macro-status-changed",
            serde_json::json!({
                "state": "stopped",
                "error": "Add at least one macro action before starting playback."
            }),
        );
        return Err("Add at least one macro action before starting playback.".to_string());
    }

    let mut player_state_guard = state.player_state.lock().await;
    if *player_state_guard == MacroPlayerState::Playing {
        return Ok(());
    }
    *player_state_guard = MacroPlayerState::Playing;
    drop(player_state_guard);

    state
        .cancel_playback
        .store(false, std::sync::atomic::Ordering::SeqCst);

    let _ = app_handle.emit(
        "macro-status-changed",
        serde_json::json!({
            "state": "playing"
        }),
    );

    let actions_clone = actions.clone();
    let repeat_mode = state.repeat_mode.lock().await.clone();
    let cancel_flag = state.cancel_playback.clone();

    drop(actions);

    tokio::spawn({
        let state = state.clone();
        let app_handle = app_handle.clone();
        let repeat_mode = repeat_mode.clone();
        async move {
            playback_loop(
                &actions_clone,
                &repeat_mode,
                cancel_flag,
                &state,
                app_handle,
            )
            .await;
        }
    });

    Ok(())
}

async fn playback_loop(
    actions: &[MacroAction],
    repeat_mode: &crate::engine::macro_engine::types::MacroRepeatMode,
    cancel_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
    state: &MacroEngineState,
    app_handle: tauri::AppHandle,
) {
    #[cfg(not(target_os = "linux"))]
    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(enigo) => enigo,
        Err(error) => {
            let _ = app_handle.emit(
                "macro-status-changed",
                serde_json::json!({
                    "state": "error",
                    "error": format!("The app could not control your mouse or keyboard. Check system permissions and try again. Details: {}", error)
                }),
            );
            *state.player_state.lock().await = MacroPlayerState::Stopped;
            return;
        }
    };

    #[cfg(target_os = "linux")]
    let mut linux_backend = match LinuxPlaybackBackend::new() {
        Ok(backend) => backend,
        Err(error) => {
            let _ = app_handle.emit(
                "macro-status-changed",
                serde_json::json!({
                    "state": "error",
                    "error": error
                }),
            );
            *state.player_state.lock().await = MacroPlayerState::Stopped;
            return;
        }
    };
    let start_time = Instant::now();
    let speed_multiplier = *state.speed_multiplier.lock().await;

    let max_iterations = match repeat_mode {
        crate::engine::macro_engine::types::MacroRepeatMode::Infinite => None,
        crate::engine::macro_engine::types::MacroRepeatMode::FiniteTimes { count } => {
            Some(*count as u64)
        }
        crate::engine::macro_engine::types::MacroRepeatMode::FiniteSeconds { duration_ms } => {
            let total_action_time = estimate_actions_duration(actions);
            if total_action_time > 0 {
                let scaled_time = (total_action_time as f64 / speed_multiplier).round() as u64;
                Some((duration_ms / scaled_time.max(1)).max(1))
            } else {
                Some(1)
            }
        }
    };

    let mut iteration = 0;

    loop {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }

        if let Some(max) = max_iterations {
            if iteration >= max {
                break;
            }
        }

        if let crate::engine::macro_engine::types::MacroRepeatMode::FiniteSeconds { duration_ms } =
            repeat_mode
        {
            if start_time.elapsed().as_millis() as u64 >= *duration_ms {
                break;
            }
        }

        for (action_index, action) in actions.iter().enumerate() {
            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }

            let _ = app_handle.emit(
                "macro-step-changed",
                serde_json::json!({
                    "action_id": action.id,
                    "action_index": action_index,
                    "total_actions": actions.len(),
                    "iteration": iteration
                }),
            );

            #[cfg(not(target_os = "linux"))]
            let action_result = execute_action(&mut enigo, action, speed_multiplier).await;

            #[cfg(target_os = "linux")]
            let action_result = execute_action(&mut linux_backend, action, speed_multiplier).await;

            if let Err(e) = action_result {
                log::error!("Macro playback error: {}", e);
                let _ = app_handle.emit(
                    "macro-status-changed",
                    serde_json::json!({
                        "state": "error",
                        "error": format!("Macro playback stopped because an action could not be completed. {}", e)
                    }),
                );
                cancel_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                break;
            }

            let wait_ms = if let Some(next_action) = actions.get(action_index + 1) {
                if action.timestamp_ms > 0
                    && next_action.timestamp_ms > 0
                    && next_action.timestamp_ms >= action.timestamp_ms
                {
                    let elapsed = next_action.timestamp_ms - action.timestamp_ms;
                    (elapsed as f64 / speed_multiplier).round() as u64
                } else {
                    ((5.0 / speed_multiplier).round() as u64).max(1)
                }
            } else {
                0
            };

            if wait_ms > 0 {
                sleep(Duration::from_millis(wait_ms)).await;
            }
        }

        iteration += 1;
    }

    *state.player_state.lock().await = MacroPlayerState::Stopped;
    let _ = app_handle.emit(
        "macro-step-changed",
        serde_json::json!({
            "action_id": serde_json::Value::Null
        }),
    );
    let _ = app_handle.emit(
        "macro-status-changed",
        serde_json::json!({
            "state": "stopped"
        }),
    );
}

pub async fn stop_playback(state: &MacroEngineState, app_handle: tauri::AppHandle) {
    state
        .cancel_playback
        .store(true, std::sync::atomic::Ordering::SeqCst);
    *state.player_state.lock().await = MacroPlayerState::Stopped;
    let _ = app_handle.emit(
        "macro-step-changed",
        serde_json::json!({
            "action_id": serde_json::Value::Null
        }),
    );
    let _ = app_handle.emit(
        "macro-status-changed",
        serde_json::json!({
            "state": "stopped"
        }),
    );
}

fn estimate_actions_duration(actions: &[MacroAction]) -> u64 {
    let mut total = 0u64;

    for action in actions {
        match &action.config {
            MacroActionConfig::Mouse {
                action: MacroMouseAction::Hold { duration_ms },
                ..
            } => {
                total += *duration_ms as u64 + 50;
            }
            MacroActionConfig::Mouse { clicks, .. } => {
                let extra_clicks = ((*clicks).clamp(1, 3) as u64).saturating_sub(1);
                total += 60 + extra_clicks * (25 + 50);
            }
            MacroActionConfig::Move { style, .. } => match style {
                MacroMoveStyle::Instant => {
                    total += 10;
                }
                MacroMoveStyle::Linear { duration_ms } => {
                    total += *duration_ms as u64;
                }
                MacroMoveStyle::Smooth { duration_ms, .. } => {
                    total += *duration_ms as u64;
                }
            },
            MacroActionConfig::Keyboard {
                action: MacroKeyboardAction::Hold { duration_ms },
                ..
            } => {
                total += *duration_ms as u64 + 50;
            }
            MacroActionConfig::Keyboard { .. } => {
                total += 60;
            }
            MacroActionConfig::Sleep { duration_ms } => {
                total += *duration_ms as u64;
            }
            MacroActionConfig::Scroll { .. } => {
                total += 50;
            }
            MacroActionConfig::RawMove { points } => {
                if points.len() >= 2 {
                    total += points.last().map(|p| p.2).unwrap_or(0)
                        - points.first().map(|p| p.2).unwrap_or(0);
                }
                total += 10;
            }
        }
    }

    total
}
