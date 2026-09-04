use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use enigo::{Enigo, Mouse, Settings};
use rdev::{listen, Button as RdevButton, Event, EventType, Key as RdevKey};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::engine::state::AppState;

use super::state::MacroEngineState;
use super::storage;
use super::types::{
    MacroAction, MacroActionConfig, MacroKeyboardAction, MacroMouseAction, MacroMouseButton,
    MacroMoveStyle, MacroPlayerState, MacroRecordMouseMovesMode, MacroRecordingOptions,
};

const MIN_SLEEP_MS: u64 = 25;
const MOVE_THRESHOLD_PX: i32 = 2;
const MOVE_MERGE_WINDOW_MS: u64 = 125;
const SMOOTH_MOVE_MERGE_WINDOW_MS: u64 = 500;
const HOLD_THRESHOLD_MS: u64 = 160;

#[derive(Clone)]
struct PressSnapshot {
    started_at: SystemTime,
    position: Option<(i32, i32)>,
    modifiers: Vec<String>,
    text: Option<String>,
}

#[derive(Default)]
pub struct MacroRecordingContext {
    recording_started_at: Option<SystemTime>,
    last_recorded_at: Option<SystemTime>,
    last_persisted_at: Option<SystemTime>,
    last_pointer: Option<(i32, i32)>,
    last_move_action_id: Option<u64>,
    last_move_recorded_at: Option<SystemTime>,
    last_move_start_time: Option<SystemTime>,
    active_modifiers: BTreeSet<String>,
    pressed_mouse: HashMap<MacroMouseButton, PressSnapshot>,
    pressed_keys: HashMap<String, PressSnapshot>,
}

impl MacroRecordingContext {
    pub fn reset(&mut self, cursor_position: Option<(i32, i32)>) {
        self.recording_started_at = Some(SystemTime::now());
        self.last_recorded_at = None;
        self.last_persisted_at = None;
        self.last_pointer = cursor_position;
        self.last_move_action_id = None;
        self.last_move_recorded_at = None;
        self.last_move_start_time = None;
        self.active_modifiers.clear();
        self.pressed_mouse.clear();
        self.pressed_keys.clear();
    }
}

pub fn spawn_global_listener(state: MacroEngineState, app_state: Arc<AppState>, app: AppHandle) {
    #[cfg(target_os = "linux")]
    {
        let session_type = std::env::var("XDG_SESSION_TYPE")
            .unwrap_or_default()
            .to_lowercase();
        if session_type == "wayland" {
            state.recording_supported.store(false, Ordering::SeqCst);
            if let Ok(mut guard) = state.recording_error.lock() {
                *guard = Some(
                    "Live macro recording is not available on Wayland in this version.".to_string(),
                );
            }
            let _ = app.emit(
                "macro-recording-availability",
                serde_json::json!({
                    "supported": false,
                    "reason": "Live macro recording is not available on Wayland in this version."
                }),
            );
            return;
        }
    }

    std::thread::spawn(move || {
        let state_for_listener = state.clone();
        let app_state_for_listener = app_state.clone();
        let app_for_listener = app.clone();

        if let Err(error) = listen(move |event| {
            handle_recording_event(
                &state_for_listener,
                &app_state_for_listener,
                &app_for_listener,
                event,
            );
        }) {
            state.recording_supported.store(false, Ordering::SeqCst);
            if let Ok(mut guard) = state.recording_error.lock() {
                *guard = Some(format!(
                    "Live macro recording could not start. Check input permissions and try again. Details: {error:?}"
                ));
            }
            let _ = app.emit(
                "macro-recording-availability",
                serde_json::json!({
                    "supported": false,
                    "reason": format!("Live macro recording could not start. Check input permissions and try again. Details: {error:?}")
                }),
            );
        }
    });
}

pub async fn start_recording(state: &MacroEngineState, app: AppHandle) -> Result<(), String> {
    if !state.recording_supported.load(Ordering::SeqCst) {
        let reason = state
            .recording_error
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .unwrap_or_else(|| "Live macro recording is not available on this system.".to_string());
        return Err(reason);
    }

    let player_state = state.player_state.lock().await.clone();
    if player_state == MacroPlayerState::Playing {
        return Err("Stop macro playback before starting a recording.".to_string());
    }

    let cursor_position = current_cursor_position().ok();
    if let Ok(mut context) = state.recording_context.lock() {
        context.reset(cursor_position);
    }

    state.cancel_playback.store(true, Ordering::SeqCst);
    state.recording_active.store(true, Ordering::SeqCst);
    *state.player_state.lock().await = MacroPlayerState::Recording;

    let _ = app.emit(
        "macro-status-changed",
        serde_json::json!({
            "state": "recording"
        }),
    );
    Ok(())
}

pub async fn stop_recording(state: &MacroEngineState, app: AppHandle) -> Result<(), String> {
    state.recording_active.store(false, Ordering::SeqCst);
    if let Ok(mut context) = state.recording_context.lock() {
        context.pressed_mouse.clear();
        context.pressed_keys.clear();
        context.active_modifiers.clear();
        context.last_move_action_id = None;
        context.last_move_recorded_at = None;
        context.last_move_start_time = None;
    }

    *state.player_state.lock().await = MacroPlayerState::Stopped;

    let mut actions = state.actions.lock().await;

    let hotkey_string = if let Some(app_state) = app.try_state::<Arc<AppState>>() {
        let hotkeys = app_state.hotkeys.lock().await;
        Some(hotkeys.toggle_macro_recording.clone())
    } else {
        None
    };

    if let Some(hotkey_str) = hotkey_string {
        if !hotkey_str.trim().is_empty() {
            let hotkey_keys = parse_hotkey_to_keys(&hotkey_str);
            if !hotkey_keys.is_empty() {
                let mut start_idx = 0;
                while start_idx < actions.len() {
                    let should_remove = match &actions[start_idx].config {
                        MacroActionConfig::Sleep { .. } => true,
                        MacroActionConfig::Keyboard { key, action, .. } => {
                            matches!(action, MacroKeyboardAction::Up) && hotkey_keys.contains(key)
                        }
                        _ => false,
                    };
                    if should_remove {
                        start_idx += 1;
                    } else {
                        break;
                    }
                }
                if start_idx > 0 {
                    actions.drain(0..start_idx);
                }

                while !actions.is_empty() {
                    let last_idx = actions.len() - 1;
                    let should_remove = match &actions[last_idx].config {
                        MacroActionConfig::Sleep { .. } => true,
                        MacroActionConfig::Keyboard { key, action, .. } => {
                            (matches!(action, MacroKeyboardAction::Down)
                                || matches!(action, MacroKeyboardAction::Up))
                                && hotkey_keys.contains(key)
                        }
                        _ => false,
                    };
                    if should_remove {
                        actions.pop();
                    } else {
                        break;
                    }
                }
            }
        }
    }

    let actions_clone = actions.clone();
    drop(actions);

    let repeat_mode = state.repeat_mode.lock().await.clone();
    let recording_options = state.recording_options.lock().await.clone();
    let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;

    let _ = app.emit(
        "macro-actions-changed",
        serde_json::json!({
            "count": actions_clone.len()
        }),
    );

    let _ = app.emit(
        "macro-status-changed",
        serde_json::json!({
            "state": "stopped"
        }),
    );
    Ok(())
}

fn parse_hotkey_to_keys(hotkey: &str) -> std::collections::BTreeSet<String> {
    let mut keys = std::collections::BTreeSet::new();
    for part in hotkey.split('+') {
        let part_lower = part.trim().to_lowercase();
        match part_lower.as_str() {
            "ctrl" | "control" | "ctl" | "commandorcontrol" | "cmdorctrl" => {
                keys.insert("ctrl".to_string());
            }
            "shift" | "shft" => {
                keys.insert("shift".to_string());
            }
            "alt" | "option" | "opt" => {
                keys.insert("alt".to_string());
            }
            "command" | "cmd" | "win" | "meta" | "super" => {
                keys.insert("win".to_string());
            }
            other => {
                if !other.is_empty() {
                    keys.insert(other.to_string());
                }
            }
        }
    }
    keys
}

fn get_event_key_name(key: &RdevKey) -> Option<String> {
    if let Some(modifier) = rdev_modifier_name(*key) {
        Some(modifier.to_string())
    } else {
        rdev_key_to_macro(key)
    }
}

fn handle_recording_event(
    state: &MacroEngineState,
    app_state: &Arc<AppState>,
    app: &AppHandle,
    event: Event,
) {
    if matches!(event.event_type, EventType::ButtonPress(_)) {
        crate::commands::capture_pending_ozone_anchor(
            app_state,
            app,
            current_cursor_position().ok(),
        );
    }

    if !state.recording_active.load(Ordering::SeqCst) {
        return;
    }

    let recording_options = state.recording_options.blocking_lock().clone();
    let event_time = SystemTime::now();
    let Ok(mut context) = state.recording_context.lock() else {
        return;
    };
    let is_raw_mode = recording_options.record_mouse_moves == MacroRecordMouseMovesMode::Raw;

    match event.event_type {
        EventType::MouseMove { x, y } => {
            let x = x.round() as i32;
            let y = y.round() as i32;
            let previous_pointer = context.last_pointer;
            context.last_pointer = Some((x, y));

            if recording_options.record_mouse_moves == MacroRecordMouseMovesMode::Off {
                return;
            }

            if !is_raw_mode {
                let threshold =
                    if recording_options.record_mouse_moves == MacroRecordMouseMovesMode::Smooth {
                        MOVE_THRESHOLD_PX
                    } else {
                        MOVE_THRESHOLD_PX
                    };
                if let Some((prev_x, prev_y)) = previous_pointer {
                    let delta_x = (prev_x - x).abs();
                    let delta_y = (prev_y - y).abs();
                    if delta_x <= threshold && delta_y <= threshold {
                        return;
                    }
                }
            }

            if is_raw_mode {
                append_raw_move_point(state, &mut context, x, y, event_time);
                persist_and_emit_if_needed(state, app, &mut context, event_time);
                return;
            }

            let merge_window_ms =
                if recording_options.record_mouse_moves == MacroRecordMouseMovesMode::Smooth {
                    SMOOTH_MOVE_MERGE_WINDOW_MS
                } else {
                    MOVE_MERGE_WINDOW_MS
                };

            let should_merge = context
                .last_move_recorded_at
                .and_then(|last| event_time.duration_since(last).ok())
                .map(|elapsed| elapsed <= Duration::from_millis(merge_window_ms))
                .unwrap_or(false);

            if should_merge {
                if let Some(action_id) = context.last_move_action_id {
                    let mut actions = state.actions.blocking_lock();
                    if let Some(action) = actions.iter_mut().find(|action| action.id == action_id) {
                        let style = match recording_options.record_mouse_moves {
                            MacroRecordMouseMovesMode::Instant => MacroMoveStyle::Instant,
                            MacroRecordMouseMovesMode::Linear => {
                                let start_time = context.last_move_start_time.unwrap_or(event_time);
                                let duration_ms = event_time
                                    .duration_since(start_time)
                                    .unwrap_or_default()
                                    .as_millis()
                                    .max(50)
                                    .min(u32::MAX as u128)
                                    as u32;
                                MacroMoveStyle::Linear { duration_ms }
                            }
                            MacroRecordMouseMovesMode::Smooth => {
                                let start_time = context.last_move_start_time.unwrap_or(event_time);
                                let duration_ms = event_time
                                    .duration_since(start_time)
                                    .unwrap_or_default()
                                    .as_millis()
                                    .max(50)
                                    .min(u32::MAX as u128)
                                    as u32;
                                let mut path = match &action.config {
                                    MacroActionConfig::Move {
                                        style: MacroMoveStyle::Smooth { path, .. },
                                        ..
                                    } => path.clone(),
                                    _ => Vec::new(),
                                };
                                path.push((x, y));
                                MacroMoveStyle::Smooth { path, duration_ms }
                            }
                            MacroRecordMouseMovesMode::Raw | MacroRecordMouseMovesMode::Off => {
                                MacroMoveStyle::Instant
                            }
                        };
                        action.config = MacroActionConfig::Move { x, y, style };
                        context.last_pointer = Some((x, y));
                        context.last_recorded_at = Some(event_time);
                        context.last_move_recorded_at = Some(event_time);
                        drop(actions);
                        persist_and_emit_if_needed(state, app, &mut context, event_time);
                        return;
                    }
                }
            }

            push_sleep_if_needed(state, &recording_options, &mut context, event_time);

            let style = match recording_options.record_mouse_moves {
                MacroRecordMouseMovesMode::Instant => {
                    context.last_move_start_time = None;
                    MacroMoveStyle::Instant
                }
                MacroRecordMouseMovesMode::Linear => {
                    context.last_move_start_time = Some(event_time);
                    MacroMoveStyle::Linear { duration_ms: 50 }
                }
                MacroRecordMouseMovesMode::Smooth => {
                    context.last_move_start_time = Some(event_time);
                    MacroMoveStyle::Smooth {
                        path: vec![(x, y)],
                        duration_ms: 50,
                    }
                }
                MacroRecordMouseMovesMode::Raw | MacroRecordMouseMovesMode::Off => {
                    context.last_move_start_time = None;
                    MacroMoveStyle::Instant
                }
            };

            append_action(
                state,
                MacroActionConfig::Move { x, y, style },
                Some(&mut context),
                event_time,
                false,
            );
            persist_and_emit_if_needed(state, app, &mut context, event_time);
        }
        EventType::ButtonPress(button) => {
            if !recording_options.record_mouse_clicks {
                return;
            }
            if let Some(button) = rdev_button_to_macro(button) {
                if context.pressed_mouse.contains_key(&button) {
                    return;
                }
                let snapshot = PressSnapshot {
                    started_at: event_time,
                    position: context.last_pointer,
                    modifiers: Vec::new(),
                    text: None,
                };
                context.pressed_mouse.insert(button.clone(), snapshot);

                push_sleep_if_needed(state, &recording_options, &mut context, event_time);
                append_action(
                    state,
                    MacroActionConfig::Mouse {
                        button,
                        action: MacroMouseAction::Down,
                        position: if recording_options.record_click_position {
                            context.last_pointer
                        } else {
                            None
                        },
                        clicks: 1,
                    },
                    Some(&mut context),
                    event_time,
                    is_raw_mode,
                );
                persist_and_emit_if_needed(state, app, &mut context, event_time);
            }
        }
        EventType::ButtonRelease(button) => {
            if !recording_options.record_mouse_clicks {
                return;
            }
            if let Some(button) = rdev_button_to_macro(button) {
                if context.pressed_mouse.remove(&button).is_some() {
                    push_sleep_if_needed(state, &recording_options, &mut context, event_time);
                    append_action(
                        state,
                        MacroActionConfig::Mouse {
                            button,
                            action: MacroMouseAction::Up,
                            position: if recording_options.record_click_position {
                                context.last_pointer
                            } else {
                                None
                            },
                            clicks: 1,
                        },
                        Some(&mut context),
                        event_time,
                        is_raw_mode,
                    );
                    persist_and_emit_if_needed(state, app, &mut context, event_time);
                }
            }
        }
        EventType::KeyPress(key) => {
            if !recording_options.record_keyboard {
                return;
            }
            if let Some(key_name) = get_event_key_name(&key) {
                if context.pressed_keys.contains_key(&key_name) {
                    return;
                }
                let snapshot = PressSnapshot {
                    started_at: event_time,
                    position: None,
                    modifiers: Vec::new(),
                    text: None,
                };
                context.pressed_keys.insert(key_name.clone(), snapshot);

                push_sleep_if_needed(state, &recording_options, &mut context, event_time);
                append_action(
                    state,
                    MacroActionConfig::Keyboard {
                        key: key_name,
                        text: None,
                        modifiers: Vec::new(),
                        action: MacroKeyboardAction::Down,
                    },
                    Some(&mut context),
                    event_time,
                    is_raw_mode,
                );
                persist_and_emit_if_needed(state, app, &mut context, event_time);
            }
        }
        EventType::KeyRelease(key) => {
            if !recording_options.record_keyboard {
                return;
            }
            if let Some(key_name) = get_event_key_name(&key) {
                if context.pressed_keys.remove(&key_name).is_some() {
                    push_sleep_if_needed(state, &recording_options, &mut context, event_time);
                    append_action(
                        state,
                        MacroActionConfig::Keyboard {
                            key: key_name,
                            text: None,
                            modifiers: Vec::new(),
                            action: MacroKeyboardAction::Up,
                        },
                        Some(&mut context),
                        event_time,
                        is_raw_mode,
                    );
                    persist_and_emit_if_needed(state, app, &mut context, event_time);
                }
            }
        }
        EventType::Wheel { delta_y, .. } => {
            if delta_y != 0 {
                push_sleep_if_needed(state, &recording_options, &mut context, event_time);
                append_action(
                    state,
                    MacroActionConfig::Scroll {
                        clicks: delta_y as i32,
                    },
                    Some(&mut context),
                    event_time,
                    is_raw_mode,
                );
                persist_and_emit_if_needed(state, app, &mut context, event_time);
            }
        }
    }
}

fn append_raw_move_point(
    state: &MacroEngineState,
    context: &mut MacroRecordingContext,
    x: i32,
    y: i32,
    recorded_at: SystemTime,
) {
    let timestamp_ms = context
        .recording_started_at
        .and_then(|started| recorded_at.duration_since(started).ok())
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);

    let mut actions = state.actions.blocking_lock();
    if let Some(last_action) = actions.last_mut() {
        if let MacroActionConfig::RawMove { points } = &mut last_action.config {
            points.push((x, y, timestamp_ms));
            last_action.timestamp_ms = timestamp_ms;
            drop(actions);
            context.last_recorded_at = Some(recorded_at);
            return;
        }
    }
    drop(actions);

    append_action(
        state,
        MacroActionConfig::RawMove {
            points: vec![(x, y, timestamp_ms)],
        },
        Some(context),
        recorded_at,
        true,
    );
}

fn append_action(
    state: &MacroEngineState,
    config: MacroActionConfig,
    context: Option<&mut MacroRecordingContext>,
    recorded_at: SystemTime,
    use_timestamp: bool,
) {
    let is_move = matches!(config, MacroActionConfig::Move { .. });
    let id = state.action_id_counter.fetch_add(1, Ordering::SeqCst);
    let timestamp_ms = if use_timestamp {
        context
            .as_ref()
            .and_then(|ctx| ctx.recording_started_at)
            .and_then(|started| recorded_at.duration_since(started).ok())
            .map(|elapsed| elapsed.as_millis() as u64)
            .unwrap_or(0)
    } else {
        0
    };
    let mut actions = state.actions.blocking_lock();
    actions.push(MacroAction {
        id,
        timestamp_ms,
        config,
    });
    drop(actions);

    if let Some(context) = context {
        context.last_recorded_at = Some(recorded_at);
        context.last_move_action_id = if is_move { Some(id) } else { None };
        context.last_move_recorded_at = context.last_move_action_id.map(|_| recorded_at);
        if context.last_move_action_id.is_none() {
            context.last_move_recorded_at = None;
        }
    }
}

fn persist_and_emit_if_needed(
    state: &MacroEngineState,
    app: &AppHandle,
    context: &mut MacroRecordingContext,
    event_time: SystemTime,
) {
    let recording_options = state.recording_options.blocking_lock().clone();
    if !recording_options.record_live_preview {
        return;
    }

    let should_persist = match context.last_persisted_at {
        None => true,
        Some(last) => event_time
            .duration_since(last)
            .map(|elapsed| elapsed >= Duration::from_secs(1))
            .unwrap_or(true),
    };

    if should_persist {
        context.last_persisted_at = Some(event_time);

        let actions = state.actions.blocking_lock().clone();
        let action_count = actions.len();
        let repeat_mode = state.repeat_mode.blocking_lock().clone();

        tauri::async_runtime::spawn(async move {
            let _ = storage::save_macro(&actions, &repeat_mode, &recording_options).await;
        });

        let _ = app.emit(
            "macro-actions-changed",
            serde_json::json!({
                "count": action_count
            }),
        );
    }
}

fn current_cursor_position() -> Result<(i32, i32), String> {
    let enigo = Enigo::new(&Settings::default())
        .map_err(|error| format!("Failed to initialize input bridge: {error}"))?;
    enigo
        .location()
        .map_err(|error| format!("Failed to read cursor position: {error}"))
}

fn rdev_button_to_macro(button: RdevButton) -> Option<MacroMouseButton> {
    match button {
        RdevButton::Left => Some(MacroMouseButton::Left),
        RdevButton::Middle => Some(MacroMouseButton::Middle),
        RdevButton::Right => Some(MacroMouseButton::Right),
        _ => None,
    }
}

fn rdev_modifier_name(key: RdevKey) -> Option<&'static str> {
    match key {
        RdevKey::ControlLeft | RdevKey::ControlRight => Some("ctrl"),
        RdevKey::ShiftLeft | RdevKey::ShiftRight => Some("shift"),
        RdevKey::Alt | RdevKey::AltGr => Some("alt"),
        RdevKey::MetaLeft | RdevKey::MetaRight => Some("win"),
        _ => None,
    }
}

fn rdev_key_to_macro(key: &RdevKey) -> Option<String> {
    let key = match key {
        RdevKey::KeyA => "a",
        RdevKey::KeyB => "b",
        RdevKey::KeyC => "c",
        RdevKey::KeyD => "d",
        RdevKey::KeyE => "e",
        RdevKey::KeyF => "f",
        RdevKey::KeyG => "g",
        RdevKey::KeyH => "h",
        RdevKey::KeyI => "i",
        RdevKey::KeyJ => "j",
        RdevKey::KeyK => "k",
        RdevKey::KeyL => "l",
        RdevKey::KeyM => "m",
        RdevKey::KeyN => "n",
        RdevKey::KeyO => "o",
        RdevKey::KeyP => "p",
        RdevKey::KeyQ => "q",
        RdevKey::KeyR => "r",
        RdevKey::KeyS => "s",
        RdevKey::KeyT => "t",
        RdevKey::KeyU => "u",
        RdevKey::KeyV => "v",
        RdevKey::KeyW => "w",
        RdevKey::KeyX => "x",
        RdevKey::KeyY => "y",
        RdevKey::KeyZ => "z",
        RdevKey::Num0 => "0",
        RdevKey::Num1 => "1",
        RdevKey::Num2 => "2",
        RdevKey::Num3 => "3",
        RdevKey::Num4 => "4",
        RdevKey::Num5 => "5",
        RdevKey::Num6 => "6",
        RdevKey::Num7 => "7",
        RdevKey::Num8 => "8",
        RdevKey::Num9 => "9",
        RdevKey::F1 => "f1",
        RdevKey::F2 => "f2",
        RdevKey::F3 => "f3",
        RdevKey::F4 => "f4",
        RdevKey::F5 => "f5",
        RdevKey::F6 => "f6",
        RdevKey::F7 => "f7",
        RdevKey::F8 => "f8",
        RdevKey::F9 => "f9",
        RdevKey::F10 => "f10",
        RdevKey::F11 => "f11",
        RdevKey::F12 => "f12",
        RdevKey::Space => "space",
        RdevKey::Return => "enter",
        RdevKey::Tab => "tab",
        RdevKey::Backspace => "backspace",
        RdevKey::Escape => "escape",
        RdevKey::Delete => "delete",
        RdevKey::Home => "home",
        RdevKey::End => "end",
        RdevKey::PageUp => "pageup",
        RdevKey::PageDown => "pagedown",
        RdevKey::UpArrow => "up",
        RdevKey::DownArrow => "down",
        RdevKey::LeftArrow => "left",
        RdevKey::RightArrow => "right",
        RdevKey::Insert => "insert",
        RdevKey::BackQuote => "`",
        RdevKey::Minus => "-",
        RdevKey::Equal => "=",
        RdevKey::LeftBracket => "[",
        RdevKey::RightBracket => "]",
        RdevKey::BackSlash => "\\",
        RdevKey::SemiColon => ";",
        RdevKey::Quote => "'",
        RdevKey::Comma => ",",
        RdevKey::Dot => ".",
        RdevKey::Slash => "/",
        RdevKey::CapsLock => "capslock",
        RdevKey::Kp0 => "numpad0",
        RdevKey::Kp1 => "numpad1",
        RdevKey::Kp2 => "numpad2",
        RdevKey::Kp3 => "numpad3",
        RdevKey::Kp4 => "numpad4",
        RdevKey::Kp5 => "numpad5",
        RdevKey::Kp6 => "numpad6",
        RdevKey::Kp7 => "numpad7",
        RdevKey::Kp8 => "numpad8",
        RdevKey::Kp9 => "numpad9",
        RdevKey::KpMinus => "-",
        RdevKey::KpPlus => "+",
        RdevKey::KpMultiply => "*",
        RdevKey::KpDivide => "/",
        RdevKey::KpDelete => ".",
        RdevKey::KpReturn => "enter",
        _ => return None,
    };

    Some(key.to_string())
}

fn normalize_recorded_text(raw: Option<&str>) -> Option<String> {
    let text = raw?.trim_matches('\0').trim();
    if text.is_empty() || text.chars().any(|ch| ch.is_control()) {
        return None;
    }
    Some(text.to_string())
}

fn normalize_recorded_modifiers(modifiers: &[String], text: Option<&str>) -> Vec<String> {
    let _ = text;
    modifiers.to_vec()
}

fn push_sleep_if_needed(
    state: &MacroEngineState,
    recording_options: &MacroRecordingOptions,
    context: &mut MacroRecordingContext,
    event_time: SystemTime,
) {
    if !recording_options.record_delays {
        return;
    }

    if recording_options.record_mouse_moves == MacroRecordMouseMovesMode::Raw {
        return;
    }

    let Some(last_recorded_at) = context.last_recorded_at else {
        return;
    };

    let elapsed_ms = event_time
        .duration_since(last_recorded_at)
        .unwrap_or_default()
        .as_millis() as u64;

    if elapsed_ms < MIN_SLEEP_MS {
        return;
    }

    append_action(
        state,
        MacroActionConfig::Sleep {
            duration_ms: elapsed_ms.min(u32::MAX as u64) as u32,
        },
        Some(context),
        event_time,
        false,
    );
}

fn string_to_macro_button(btn: &str) -> Option<MacroMouseButton> {
    match btn.to_lowercase().as_str() {
        "left" => Some(MacroMouseButton::Left),
        "middle" => Some(MacroMouseButton::Middle),
        "right" => Some(MacroMouseButton::Right),
        "front" => Some(MacroMouseButton::Front),
        "back" => Some(MacroMouseButton::Back),
        _ => None,
    }
}

#[tauri::command]
pub async fn record_local_macro_event(
    state: State<'_, Arc<AppState>>,
    _app: AppHandle,
    event_type: String,
    button: Option<String>,
    key: Option<String>,
    _x: Option<i32>,
    _y: Option<i32>,
) -> Result<(), String> {
    let macro_state = &state.macro_engine;
    if !macro_state.recording_active.load(Ordering::SeqCst) {
        return Ok(());
    }

    let recording_options = macro_state.recording_options.lock().await.clone();
    let event_time = SystemTime::now();

    let (cx, cy) = current_cursor_position().unwrap_or((0, 0));

    let (should_merge_id, main_action, sleep_config) = {
        let mut context = macro_state
            .recording_context
            .lock()
            .map_err(|e| e.to_string())?;

        let previous_pointer = context.last_pointer;
        if event_type == "mouse_move" || event_type == "mouse_down" || event_type == "mouse_up" {
            context.last_pointer = Some((cx, cy));
        }
        let last_pointer = context.last_pointer;

        let mut sleep_config = None;
        let mut main_action = None;
        let mut should_merge_id = None;

        match event_type.as_str() {
            "mouse_move" => {
                if recording_options.record_mouse_moves != MacroRecordMouseMovesMode::Off {
                    let x = cx;
                    let y = cy;

                    let mut delta_ok = true;
                    if let Some((prev_x, prev_y)) = previous_pointer {
                        let delta_x = (prev_x - x).abs();
                        let delta_y = (prev_y - y).abs();
                        if delta_x < MOVE_THRESHOLD_PX && delta_y < MOVE_THRESHOLD_PX {
                            delta_ok = false;
                        }
                    }

                    if delta_ok {
                        let should_merge = context
                            .last_move_recorded_at
                            .and_then(|last| event_time.duration_since(last).ok())
                            .map(|elapsed| elapsed <= Duration::from_millis(MOVE_MERGE_WINDOW_MS))
                            .unwrap_or(false);

                        if should_merge {
                            if let Some(action_id) = context.last_move_action_id {
                                should_merge_id = Some(action_id);
                            }
                        }

                        if should_merge_id.is_none() {
                            let style = match recording_options.record_mouse_moves {
                                MacroRecordMouseMovesMode::Instant => {
                                    context.last_move_start_time = None;
                                    MacroMoveStyle::Instant
                                }
                                MacroRecordMouseMovesMode::Linear => {
                                    context.last_move_start_time = Some(event_time);
                                    MacroMoveStyle::Linear { duration_ms: 50 }
                                }
                                MacroRecordMouseMovesMode::Smooth => {
                                    context.last_move_start_time = Some(event_time);
                                    MacroMoveStyle::Smooth {
                                        path: vec![(x, y)],
                                        duration_ms: 50,
                                    }
                                }
                                MacroRecordMouseMovesMode::Raw | MacroRecordMouseMovesMode::Off => {
                                    context.last_move_start_time = None;
                                    MacroMoveStyle::Instant
                                }
                            };
                            main_action = Some(MacroActionConfig::Move { x, y, style });
                        }
                    }
                }
            }
            "mouse_down" => {
                if recording_options.record_mouse_clicks {
                    if let Some(btn_str) = button {
                        if let Some(button) = string_to_macro_button(&btn_str) {
                            if !context.pressed_mouse.contains_key(&button) {
                                let snapshot = PressSnapshot {
                                    started_at: event_time,
                                    position: last_pointer,
                                    modifiers: Vec::new(),
                                    text: None,
                                };
                                context.pressed_mouse.insert(button.clone(), snapshot);

                                main_action = Some(MacroActionConfig::Mouse {
                                    button,
                                    action: MacroMouseAction::Down,
                                    position: if recording_options.record_click_position {
                                        last_pointer
                                    } else {
                                        None
                                    },
                                    clicks: 1,
                                });
                            }
                        }
                    }
                }
            }
            "mouse_up" => {
                if recording_options.record_mouse_clicks {
                    if let Some(btn_str) = button {
                        if let Some(button) = string_to_macro_button(&btn_str) {
                            if context.pressed_mouse.remove(&button).is_some() {
                                main_action = Some(MacroActionConfig::Mouse {
                                    button,
                                    action: MacroMouseAction::Up,
                                    position: if recording_options.record_click_position {
                                        last_pointer
                                    } else {
                                        None
                                    },
                                    clicks: 1,
                                });
                            }
                        }
                    }
                }
            }
            "key_down" => {
                if recording_options.record_keyboard {
                    if let Some(key_name) = key {
                        if !context.pressed_keys.contains_key(&key_name) {
                            let snapshot = PressSnapshot {
                                started_at: event_time,
                                position: None,
                                modifiers: Vec::new(),
                                text: None,
                            };
                            context.pressed_keys.insert(key_name.clone(), snapshot);

                            main_action = Some(MacroActionConfig::Keyboard {
                                key: key_name,
                                text: None,
                                modifiers: Vec::new(),
                                action: MacroKeyboardAction::Down,
                            });
                        }
                    }
                }
            }
            "key_up" => {
                if recording_options.record_keyboard {
                    if let Some(key_name) = key {
                        if context.pressed_keys.remove(&key_name).is_some() {
                            main_action = Some(MacroActionConfig::Keyboard {
                                key: key_name,
                                text: None,
                                modifiers: Vec::new(),
                                action: MacroKeyboardAction::Up,
                            });
                        }
                    }
                }
            }
            _ => {}
        }

        if main_action.is_some() || should_merge_id.is_some() {
            if recording_options.record_delays {
                if let Some(last_recorded_at) = context.last_recorded_at {
                    let elapsed_ms = event_time
                        .duration_since(last_recorded_at)
                        .unwrap_or_default()
                        .as_millis() as u64;

                    if elapsed_ms >= MIN_SLEEP_MS
                        && recording_options.record_mouse_moves != MacroRecordMouseMovesMode::Raw
                    {
                        let duration_ms = elapsed_ms.min(u32::MAX as u64) as u32;
                        sleep_config = Some(MacroActionConfig::Sleep { duration_ms });
                    }
                }
            }
        }

        (should_merge_id, main_action, sleep_config)
    };

    if let Some(action_id) = should_merge_id {
        let mut actions = macro_state.actions.lock().await;
        if let Some(action) = actions.iter_mut().find(|action| action.id == action_id) {
            {
                let mut context = macro_state
                    .recording_context
                    .lock()
                    .map_err(|e| e.to_string())?;

                let style = match recording_options.record_mouse_moves {
                    MacroRecordMouseMovesMode::Instant => MacroMoveStyle::Instant,
                    MacroRecordMouseMovesMode::Linear => {
                        let start_time = context.last_move_start_time.unwrap_or(event_time);
                        let duration_ms = event_time
                            .duration_since(start_time)
                            .unwrap_or_default()
                            .as_millis()
                            .max(50)
                            .min(u32::MAX as u128) as u32;
                        MacroMoveStyle::Linear { duration_ms }
                    }
                    MacroRecordMouseMovesMode::Smooth => {
                        let start_time = context.last_move_start_time.unwrap_or(event_time);
                        let duration_ms = event_time
                            .duration_since(start_time)
                            .unwrap_or_default()
                            .as_millis()
                            .max(50)
                            .min(u32::MAX as u128) as u32;
                        let mut path = match &action.config {
                            MacroActionConfig::Move {
                                style: MacroMoveStyle::Smooth { path, .. },
                                ..
                            } => path.clone(),
                            _ => Vec::new(),
                        };
                        path.push((cx, cy));
                        MacroMoveStyle::Smooth { path, duration_ms }
                    }
                    MacroRecordMouseMovesMode::Raw | MacroRecordMouseMovesMode::Off => {
                        MacroMoveStyle::Instant
                    }
                };

                action.config = MacroActionConfig::Move {
                    x: cx,
                    y: cy,
                    style,
                };

                context.last_pointer = Some((cx, cy));
                context.last_recorded_at = Some(event_time);
                context.last_move_recorded_at = Some(event_time);
            }

            drop(actions);
        }
    } else if let Some(main_config) = main_action {
        let mut actions = macro_state.actions.lock().await;

        let use_timestamp = recording_options.record_mouse_moves == MacroRecordMouseMovesMode::Raw;
        let timestamp_ms = if use_timestamp {
            let context = macro_state
                .recording_context
                .lock()
                .map_err(|e| e.to_string())?;
            context
                .recording_started_at
                .and_then(|started| event_time.duration_since(started).ok())
                .map(|elapsed| elapsed.as_millis() as u64)
                .unwrap_or(0)
        } else {
            0
        };

        if let Some(sleep_cfg) = sleep_config {
            let sleep_id = macro_state.action_id_counter.fetch_add(1, Ordering::SeqCst);
            actions.push(MacroAction {
                id: sleep_id,
                timestamp_ms: 0,
                config: sleep_cfg,
            });
        }

        let main_id = macro_state.action_id_counter.fetch_add(1, Ordering::SeqCst);
        let main_is_move = matches!(main_config, MacroActionConfig::Move { .. });
        actions.push(MacroAction {
            id: main_id,
            timestamp_ms,
            config: main_config,
        });
        let last_id = Some(main_id);
        let last_is_move = main_is_move;

        drop(actions);

        let mut context = macro_state
            .recording_context
            .lock()
            .map_err(|e| e.to_string())?;
        context.last_recorded_at = Some(event_time);
        if let Some(id) = last_id {
            context.last_move_action_id = if last_is_move { Some(id) } else { None };
            context.last_move_recorded_at = context.last_move_action_id.map(|_| event_time);
        }
    }

    let should_persist = {
        let mut context = macro_state
            .recording_context
            .lock()
            .map_err(|e| e.to_string())?;

        if !recording_options.record_live_preview {
            false
        } else {
            let should = match context.last_persisted_at {
                None => true,
                Some(last) => event_time
                    .duration_since(last)
                    .map(|elapsed| elapsed >= Duration::from_secs(1))
                    .unwrap_or(true),
            };
            if should {
                context.last_persisted_at = Some(event_time);
            }
            should
        }
    };

    if should_persist {
        let actions = macro_state.actions.lock().await.clone();
        let repeat_mode = macro_state.repeat_mode.lock().await.clone();
        let _ = storage::save_macro(&actions, &repeat_mode, &recording_options).await;
        let _ = _app.emit(
            "macro-actions-changed",
            serde_json::json!({
                "count": actions.len()
            }),
        );
    }

    Ok(())
}
