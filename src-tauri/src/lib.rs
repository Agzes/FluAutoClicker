mod commands;
mod engine;

use std::str::FromStr;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use crate::commands::*;
use crate::engine::config_store::AppConfigFile;
use crate::engine::macro_engine::recording::record_local_macro_event;
use crate::engine::macro_engine::types::MacroPlayerState;
use crate::engine::state::{
    AppState, ClickMode, ClickType, HoldUnit, HotkeyAction, JigglerPattern, KeyboardModifier,
    MouseButton, PositionMode, RepeatMode, RepeatUnit, RuntimeHotkeys,
};
use tauri::menu::MenuBuilder;
use tauri::tray::{
    MouseButton as TrayMouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent,
};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_cli::CliExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use log::{debug, error, info, warn, LevelFilter};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

#[cfg(target_os = "windows")]
mod raw_acrylic {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::sync::OnceLock;

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct WinCompatAttrData {
        attribute: u32,
        pv_data: *const AccentPolicy,
        cb_data: u32,
    }

    const WCA_ACCENT_POLICY: u32 = 19;
    const ACCENT_DISABLED: u32 = 0;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;

    type SetWindowCompositionAttributeFn =
        unsafe extern "system" fn(*mut std::ffi::c_void, *mut WinCompatAttrData) -> i32;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleA(name: *const u8) -> *mut std::ffi::c_void;
        fn GetProcAddress(
            module: *mut std::ffi::c_void,
            name: *const u8,
        ) -> Option<unsafe extern "system" fn()>;
    }

    fn get_swca() -> Option<SetWindowCompositionAttributeFn> {
        static SWCA: OnceLock<Option<SetWindowCompositionAttributeFn>> = OnceLock::new();
        let cached = SWCA.get();
        if let Some(result) = cached {
            return *result;
        }

        unsafe {
            let user32 = GetModuleHandleA(b"user32.dll\0".as_ptr() as *const u8);
            if user32.is_null() {
                let _ = SWCA.set(None);
                return None;
            }

            let ptr = GetProcAddress(
                user32,
                b"SetWindowCompositionAttribute\0".as_ptr() as *const u8,
            );

            let func: Option<SetWindowCompositionAttributeFn> = ptr.map(|p| std::mem::transmute(p));

            let _ = SWCA.set(func);
            func
        }
    }

    fn hwnd_from_window(window: &(impl HasWindowHandle + ?Sized)) -> Option<*mut std::ffi::c_void> {
        let handle = window.window_handle().ok()?;
        match handle.as_raw() {
            RawWindowHandle::Win32(w) => Some(w.hwnd.get() as *mut std::ffi::c_void),
            _ => None,
        }
    }

    pub fn apply_acrylic(
        window: &(impl HasWindowHandle + ?Sized),
        color: (u8, u8, u8, u8),
    ) -> bool {
        let func = match get_swca() {
            Some(f) => f,
            None => return false,
        };

        let hwnd = match hwnd_from_window(window) {
            Some(h) => h,
            None => return false,
        };

        let (r, g, b, a) = color;
        let gradient_color =
            ((a as u32) << 24) | ((b as u32) << 16) | ((g as u32) << 8) | (r as u32);

        let accent = AccentPolicy {
            accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
            accent_flags: 0,
            gradient_color,
            animation_id: 0,
        };

        let mut data = WinCompatAttrData {
            attribute: WCA_ACCENT_POLICY,
            pv_data: &accent,
            cb_data: std::mem::size_of::<AccentPolicy>() as u32,
        };

        unsafe { func(hwnd, &mut data) != 0 }
    }

    pub fn clear_acrylic(window: &(impl HasWindowHandle + ?Sized)) -> bool {
        let func = match get_swca() {
            Some(f) => f,
            None => return false,
        };

        let hwnd = match hwnd_from_window(window) {
            Some(h) => h,
            None => return false,
        };

        let accent = AccentPolicy {
            accent_state: ACCENT_DISABLED,
            accent_flags: 0,
            gradient_color: 0,
            animation_id: 0,
        };

        let mut data = WinCompatAttrData {
            attribute: WCA_ACCENT_POLICY,
            pv_data: &accent,
            cb_data: std::mem::size_of::<AccentPolicy>() as u32,
        };

        unsafe { func(hwnd, &mut data) != 0 }
    }
}

#[cfg(target_os = "windows")]
fn apply_window_acrylic_impl<W: raw_window_handle::HasWindowHandle + ?Sized>(
    window: &W,
    _focused: Option<bool>,
) -> bool {
    let color = (18, 22, 29, 22);

    raw_acrylic::apply_acrylic(window, color) || {
        use window_vibrancy::{apply_acrylic, apply_blur};
        apply_acrylic(window, Some(color))
            .or_else(|_| apply_blur(window, Some(color)))
            .is_ok()
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_window_acrylic_impl<W: raw_window_handle::HasWindowHandle + ?Sized>(
    _window: &W,
    _: Option<bool>,
) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn clear_window_acrylic_impl<W: raw_window_handle::HasWindowHandle + ?Sized>(window: &W) -> bool {
    raw_acrylic::clear_acrylic(window) || {
        use window_vibrancy::{clear_acrylic, clear_blur};
        clear_acrylic(window)
            .or_else(|_| clear_blur(window))
            .is_ok()
    }
}

#[cfg(not(target_os = "windows"))]
fn clear_window_acrylic_impl<W: raw_window_handle::HasWindowHandle + ?Sized>(_window: &W) -> bool {
    false
}

pub(crate) fn window_acrylic_supported() -> bool {
    cfg!(target_os = "windows")
}

pub(crate) fn system_startup_supported() -> bool {
    cfg!(target_os = "windows")
}

#[cfg(target_os = "linux")]
pub(crate) fn is_wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|session| session.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var("WAYLAND_DISPLAY")
            .map(|display| !display.trim().is_empty())
            .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn is_wayland_session() -> bool {
    false
}

pub(crate) fn global_hotkeys_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        if is_wayland_session() {
            return crate::engine::hyprland::is_active();
        }
    }
    true
}

pub(crate) fn hotkey_backend() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        if is_wayland_session() {
            return if crate::engine::hyprland::is_active() {
                "hyprland"
            } else {
                "unsupported"
            };
        }
    }
    "native"
}

pub(crate) fn apply_window_acrylic<W: raw_window_handle::HasWindowHandle + ?Sized>(
    window: &W,
    focused: Option<bool>,
) -> bool {
    apply_window_acrylic_impl(window, focused)
}

pub(crate) fn clear_window_acrylic<W: raw_window_handle::HasWindowHandle + ?Sized>(
    window: &W,
) -> bool {
    clear_window_acrylic_impl(window)
}

fn handle_cli_matches(app: &AppHandle, state: &Arc<AppState>) {
    if let Ok(matches) = app.cli().matches() {
        if let Some(arg) = matches.args.get("toggle") {
            if arg.occurrences > 0 {
                let val = !state.is_running.load(Ordering::SeqCst);
                state.is_running.store(val, Ordering::SeqCst);
                let _ = app.emit("status-changed", serde_json::json!({ "running": val }));
            }
        }
        if let Some(arg) = matches.args.get("start") {
            if arg.occurrences > 0 {
                state.is_running.store(true, Ordering::SeqCst);
                let _ = app.emit("status-changed", serde_json::json!({ "running": true }));
            }
        }
        if let Some(arg) = matches.args.get("stop") {
            if arg.occurrences > 0 {
                state.is_running.store(false, Ordering::SeqCst);
                let _ = app.emit("status-changed", serde_json::json!({ "running": false }));
            }
        }
        if let Some(arg) = matches.args.get("exit") {
            if arg.occurrences > 0 {
                app.exit(0);
            }
        }
    }
}

fn matches_hotkey(shortcut: &Shortcut, expected: &str) -> bool {
    Shortcut::from_str(expected)
        .map(|parsed| parsed == *shortcut)
        .unwrap_or(false)
}

fn hotkeys_from_state(state: &Arc<AppState>) -> RuntimeHotkeys {
    state.hotkeys.blocking_lock().clone()
}

fn set_clicker_running(app: &AppHandle, state: &Arc<AppState>, running: bool) {
    debug!(
        "Mouse clicker {}",
        if running { "started" } else { "stopped" }
    );
    state.is_running.store(running, Ordering::SeqCst);
    if running {
        crate::commands::prepare_ozone_for_clicker_start(state, app, false);
    } else {
        state.ozone_anchor_ready.store(false, Ordering::SeqCst);
        state
            .ozone_wait_for_click_anchor
            .store(false, Ordering::SeqCst);
    }
    let _ = app.emit("status-changed", serde_json::json!({ "running": running }));
}

fn active_mode_from_state(state: &Arc<AppState>) -> String {
    state
        .active_mode
        .lock()
        .map(|mode| mode.clone())
        .unwrap_or_else(|_| "mouse".to_string())
}

fn running_mode_from_state(state: &Arc<AppState>) -> Option<String> {
    if state.is_running.load(Ordering::SeqCst) {
        return Some("mouse".to_string());
    }
    if state.kb_is_running.load(Ordering::SeqCst) {
        return Some("keyboard".to_string());
    }
    if matches!(
        *state.macro_engine.player_state.blocking_lock(),
        MacroPlayerState::Playing
    ) {
        return Some("macro".to_string());
    }
    None
}

async fn set_mode_running(app: AppHandle, state: Arc<AppState>, mode: String, running: bool) {
    debug!(
        "Mode '{}' {}",
        mode,
        if running {
            "start requested"
        } else {
            "stop requested"
        }
    );
    match mode.as_str() {
        "keyboard" => {
            state.kb_is_running.store(running, Ordering::SeqCst);
            let _ = app.emit(
                "keyboard-status-changed",
                serde_json::json!({ "running": running }),
            );
        }
        "macro" => {
            if running {
                if let Err(error) = crate::engine::macro_engine::playback::start_playback(
                    &state.macro_engine,
                    app.clone(),
                )
                .await
                {
                    let _ = app.emit(
                        "macro-status-changed",
                        serde_json::json!({ "state": "error", "error": error }),
                    );
                }
            } else {
                crate::engine::macro_engine::playback::stop_playback(&state.macro_engine, app)
                    .await;
            }
        }
        _ => {
            set_clicker_running(&app, &state, running);
        }
    }
}

const TRAY_SHOW_ID: &str = "show";
const TRAY_QUIT_ID: &str = "quit";

pub(crate) fn reveal_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found.".to_string())?;
    window
        .show()
        .map_err(|e| format!("Failed to show window: {e}"))?;
    let _ = window.unminimize();
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus window: {e}"))
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = MenuBuilder::new(app)
        .text(TRAY_SHOW_ID, "Show FluAutoClicker")
        .separator()
        .text(TRAY_QUIT_ID, "Quit")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("FluAutoClicker")
        .on_menu_event(|app, event| match event.id().0.as_str() {
            TRAY_SHOW_ID => {
                let _ = reveal_main_window(app);
            }
            TRAY_QUIT_ID => {
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    state.is_quitting.store(true, Ordering::SeqCst);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::DoubleClick {
                button: TrayMouseButton::Left,
                ..
            }
            | TrayIconEvent::Click {
                button: TrayMouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                let _ = reveal_main_window(tray.app_handle());
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

pub(crate) fn validate_profile_name(name: &str) -> Result<String, String> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err("Profile name cannot be empty.".to_string());
    }
    if normalized.len() > 32 {
        return Err("Profile name must be 32 characters or fewer.".to_string());
    }
    if !normalized
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '_')
    {
        return Err("Use only letters, numbers, spaces, '-' or '_' in profile names.".to_string());
    }
    Ok(normalized.to_string())
}

pub(crate) async fn apply_config_to_state(state: &Arc<AppState>, config: &AppConfigFile) {
    state.cps.store(config.mouse.cps.max(1), Ordering::SeqCst);
    state
        .variation_ms
        .store(config.mouse.variation_ms, Ordering::SeqCst);
    state
        .hold_duration
        .store(config.mouse.hold_duration.max(1), Ordering::SeqCst);
    state
        .repeat_count
        .store(config.mouse.repeat_count.max(1), Ordering::SeqCst);
    state.coord_x.store(config.mouse.coord_x, Ordering::SeqCst);
    state.coord_y.store(config.mouse.coord_y, Ordering::SeqCst);

    state
        .kb_cps
        .store(config.keyboard.cps.max(1), Ordering::SeqCst);
    state
        .kb_interval_ms
        .store((1000 / config.keyboard.cps.max(1)).max(1), Ordering::SeqCst);
    state
        .kb_variation_ms
        .store(config.keyboard.variation_ms, Ordering::SeqCst);
    state
        .kb_hold_duration
        .store(config.keyboard.hold_duration.max(1), Ordering::SeqCst);
    state
        .kb_repeat_count
        .store(config.keyboard.repeat_count.max(1), Ordering::SeqCst);

    state
        .is_jiggler_active
        .store(config.jiggler.active, Ordering::SeqCst);
    state
        .jiggler_distance
        .store(config.jiggler.distance.max(1), Ordering::SeqCst);
    state
        .jiggler_interval
        .store(config.jiggler.interval_ms.max(100), Ordering::SeqCst);

    state
        .minimize_to_tray
        .store(config.general.minimize_to_tray, Ordering::SeqCst);
    state.stop_on_custom_position_move.store(
        config.general.stop_on_custom_position_move,
        Ordering::SeqCst,
    );

    *state.mouse_button.lock().await = match config.mouse.button.as_str() {
        "middle" => MouseButton::Middle,
        "right" => MouseButton::Right,
        "front" => MouseButton::Front,
        "back" => MouseButton::Back,
        _ => MouseButton::Left,
    };
    *state.click_mode.lock().await = match config.mouse.click_mode.as_str() {
        "hold" => ClickMode::Hold,
        _ => ClickMode::Press,
    };
    *state.click_type.lock().await = match config.mouse.click_type.as_str() {
        "double" => ClickType::Double,
        "triple" => ClickType::Triple,
        _ => ClickType::Single,
    };
    *state.hold_unit.lock().await = match config.mouse.hold_unit.as_str() {
        "s" => HoldUnit::Seconds,
        _ => HoldUnit::Milliseconds,
    };
    *state.repeat_mode.lock().await = match config.mouse.repeat_mode.as_str() {
        "finite" => RepeatMode::Finite,
        _ => RepeatMode::Infinite,
    };
    *state.repeat_unit.lock().await = match config.mouse.repeat_unit.as_str() {
        "seconds" => RepeatUnit::Seconds,
        _ => RepeatUnit::Times,
    };
    *state.position_mode.lock().await = match config.mouse.position_mode.as_str() {
        "custom" => PositionMode::Custom,
        _ => PositionMode::Current,
    };

    *state.keyboard_key.lock().await = config.keyboard.key.clone();
    *state.keyboard_modifiers.lock().await =
        KeyboardModifier::from_str(config.keyboard.modifiers.as_str());
    *state.kb_click_mode.lock().await = match config.keyboard.click_mode.as_str() {
        "hold" => ClickMode::Hold,
        _ => ClickMode::Press,
    };
    *state.kb_hold_unit.lock().await = match config.keyboard.hold_unit.as_str() {
        "s" => HoldUnit::Seconds,
        _ => HoldUnit::Milliseconds,
    };
    *state.kb_repeat_mode.lock().await = match config.keyboard.repeat_mode.as_str() {
        "finite" => RepeatMode::Finite,
        _ => RepeatMode::Infinite,
    };
    *state.kb_repeat_unit.lock().await = match config.keyboard.repeat_unit.as_str() {
        "seconds" => RepeatUnit::Seconds,
        _ => RepeatUnit::Times,
    };

    *state.jiggler_pattern.lock().await = match config.jiggler.pattern.as_str() {
        "lin" => JigglerPattern::Linear,
        "cir" => JigglerPattern::Circle,
        "ozn" => JigglerPattern::OZone,
        _ => JigglerPattern::Random,
    };

    *state.hotkeys.lock().await = RuntimeHotkeys {
        toggle_start_stop: config.hotkeys.toggle_start_stop.clone(),
        pick_position: config.hotkeys.pick_position.clone(),
        toggle_macro_recording: config.hotkeys.toggle_macro_recording.clone(),
    };

    *state.macro_engine.actions.lock().await = config.macro_settings.actions.clone();
    *state.macro_engine.repeat_mode.lock().await = config.macro_settings.to_repeat_mode();
    *state.macro_engine.recording_options.lock().await =
        config.macro_settings.recording_options.clone();

    let next_action_id = config
        .macro_settings
        .actions
        .iter()
        .map(|action| action.id)
        .max()
        .unwrap_or(0)
        + 1;
    state
        .macro_engine
        .action_id_counter
        .store(next_action_id, Ordering::SeqCst);
}

pub(crate) async fn persist_and_apply_config(
    app: &AppHandle,
    state: &Arc<AppState>,
    config: AppConfigFile,
) -> Result<(), String> {
    crate::engine::config_store::save_config(&config).await?;
    apply_config_to_state(state, &config).await;
    crate::engine::macro_engine::storage::save_macro(
        &config.macro_settings.actions,
        &config.macro_settings.to_repeat_mode(),
        &config.macro_settings.recording_options,
    )
    .await?;
    register_runtime_hotkeys(app, &state.hotkeys.lock().await.clone())?;
    let _ = app.emit("settings-applied", &config);
    let _ = app.emit("macro-actions-changed", serde_json::json!({}));
    Ok(())
}

pub(crate) async fn load_and_activate_profile(
    app: &AppHandle,
    state: &Arc<AppState>,
    name: &str,
) -> Result<AppConfigFile, String> {
    let mut config = if name == "default" {
        crate::engine::config_store::load_profile("default")
            .await
            .unwrap_or_else(|_| AppConfigFile::default())
    } else {
        crate::engine::config_store::load_profile(name).await?
    };
    config.active_profile = name.to_string();
    persist_and_apply_config(app, state, config.clone()).await?;
    Ok(config)
}

pub(crate) fn unregister_all_hotkeys(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if crate::engine::hyprland::is_active() {
            crate::engine::hyprland::clear_binds();
            return Ok(());
        }
    }

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("failed to clear hotkeys: {e}"))
}

pub(crate) fn register_runtime_hotkeys(
    app: &AppHandle,
    hotkeys: &RuntimeHotkeys,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if crate::engine::hyprland::is_active() {
            return crate::engine::hyprland::apply_hotkeys(hotkeys);
        }
    }

    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|e| format!("failed to clear hotkeys: {e}"))?;

    if !global_hotkeys_supported() {
        return Ok(());
    }

    for action in HotkeyAction::ALL {
        let key = action.shortcut(hotkeys);
        if key.trim().is_empty() {
            continue;
        }
        let shortcut =
            Shortcut::from_str(key).map_err(|e| format!("invalid hotkey `{key}`: {e}"))?;
        manager
            .register(shortcut)
            .map_err(|e| format!("failed to register hotkey `{key}`: {e}"))?;
    }

    Ok(())
}

async fn toggle_macro_recording_from_hotkey(app: AppHandle, state: Arc<AppState>) {
    let player_state = state.macro_engine.player_state.lock().await.clone();
    debug!(
        "Macro recording hotkey toggled (player_state: {:?})",
        player_state
    );
    let result = if player_state == MacroPlayerState::Recording {
        crate::engine::macro_engine::recording::stop_recording(&state.macro_engine, app.clone())
            .await
    } else {
        crate::engine::macro_engine::recording::start_recording(&state.macro_engine, app.clone())
            .await
    };

    if let Err(error) = result {
        let _ = app.emit(
            "macro-status-changed",
            serde_json::json!({ "state": "error", "error": error }),
        );
    }
}

fn hotkey_action_for(shortcut: &Shortcut, hotkeys: &RuntimeHotkeys) -> Option<HotkeyAction> {
    HotkeyAction::ALL
        .into_iter()
        .find(|action| matches_hotkey(shortcut, action.shortcut(hotkeys)))
}

pub(crate) fn dispatch_hotkey(app: &AppHandle, action: HotkeyAction, pressed: bool) {
    debug!("Global hotkey {:?} (pressed: {pressed})", action);
    let state = app.state::<Arc<AppState>>().inner().clone();
    if state.hotkeys_suspended.load(Ordering::SeqCst) {
        return;
    }

    match action {
        HotkeyAction::ToggleStartStop => {
            if pressed {
                let running_mode = running_mode_from_state(&state);
                let was_running_before_press = running_mode.is_some();
                let mode = running_mode.unwrap_or_else(|| active_mode_from_state(&state));
                if let Ok(mut press_state) = state.toggle_hotkey_press_state.lock() {
                    *press_state = Some(crate::engine::state::ToggleHotkeyPressState {
                        started_at: std::time::Instant::now(),
                        was_running_before_press,
                        mode: mode.clone(),
                    });
                }

                if !was_running_before_press {
                    let app_handle = app.clone();
                    let state = state.clone();
                    tauri::async_runtime::spawn(async move {
                        set_mode_running(app_handle, state, mode, true).await;
                    });
                }
            } else {
                let press_snapshot = state
                    .toggle_hotkey_press_state
                    .lock()
                    .ok()
                    .and_then(|mut guard| guard.take());

                if let Some(press_state) = press_snapshot {
                    let held_long_enough = press_state.started_at.elapsed().as_millis() >= 250;
                    let should_stop = if held_long_enough {
                        !press_state.was_running_before_press
                    } else {
                        press_state.was_running_before_press
                    };

                    if should_stop {
                        let app_handle = app.clone();
                        let state = state.clone();
                        tauri::async_runtime::spawn(async move {
                            set_mode_running(app_handle, state, press_state.mode, false).await;
                        });
                    }
                }
            }
        }
        HotkeyAction::PickPosition => {
            if !pressed {
                return;
            }
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
                match crate::commands::pick_cursor_position(Some(0)).await {
                    Ok(position) => {
                        let _ = app_handle.emit("cursor-position-picked", position);
                    }
                    Err(error) => {
                        let _ = app_handle.emit(
                            "cursor-position-pick-failed",
                            serde_json::json!({ "error": error }),
                        );
                    }
                }
            });
        }
        HotkeyAction::ToggleMacroRecording => {
            if !pressed {
                return;
            }
            let app_handle = app.clone();
            let state = state.clone();
            tauri::async_runtime::spawn(async move {
                toggle_macro_recording_from_hotkey(app_handle, state).await;
            });
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(AppState::default());
    let state_clone = state.clone();

    let log_dir = crate::engine::config_store::app_config_root().join("logs");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Folder {
                        path: log_dir,
                        file_name: Some("fluautoclicker".into()),
                    }),
                ])
                .level(if cfg!(debug_assertions) {
                    LevelFilter::Debug
                } else {
                    LevelFilter::Info
                })
                .rotation_strategy(RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    let state = app.state::<Arc<AppState>>().inner().clone();
                    let hotkeys = hotkeys_from_state(&state);
                    if let Some(action) = hotkey_action_for(&shortcut, &hotkeys) {
                        dispatch_hotkey(app, action, event.state == ShortcutState::Pressed);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let s = app.state::<Arc<AppState>>();
            let _ = app.emit("cli-event", &args);
            handle_cli_matches(app, s.inner());
        }))
        .manage(state_clone)
        .on_window_event(|window, event| {
            let state = window.state::<Arc<AppState>>();
            if let WindowEvent::Focused(focused) = event {
                let label = window.label();
                if label == "main" {
                    state.is_main_focused.store(*focused, Ordering::SeqCst);
                    if state.acrylic_enabled.load(Ordering::SeqCst) {
                        let window = window.clone();
                        let focused = *focused;
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                            let _ = crate::apply_window_acrylic(&window, Some(focused));
                        });
                    }
                } else if label == "cps-test" {
                    state.is_cps_test_focused.store(*focused, Ordering::SeqCst);
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && state.minimize_to_tray.load(Ordering::SeqCst)
                    && !state.is_quitting.load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            toggle_clicker,
            set_active_app_mode,
            get_runtime_status,
            load_app_config,
            save_app_config,
            get_macro_settings,
            import_app_config,
            save_export_file,
            list_profiles_cmd,
            save_profile_cmd,
            load_profile_cmd,
            export_profile_cmd,
            import_profile_cmd,
            export_backup_cmd,
            import_backup_cmd,
            rename_profile_cmd,
            delete_profile_cmd,
            set_cps,
            toggle_jiggler,
            set_jiggler_distance,
            set_jiggler_interval,
            set_jiggler_pattern,
            set_minimize_to_tray,
            minimize_main_window,
            show_main_window,
            quit_app,
            set_start_on_system_startup,
            get_start_on_system_startup,
            set_mouse_button,
            set_click_mode,
            set_click_type,
            set_hold_duration,
            set_hold_unit,
            set_repeat_mode,
            set_repeat_count,
            set_repeat_unit,
            set_position_mode,
            set_position,
            set_variation_ms,
            check_uinput_permissions,
            request_uinput_permissions,
            install_uinput_udev_rule,
            toggle_keyboard_clicker,
            set_keyboard_key,
            set_keyboard_modifiers,
            set_keyboard_click_mode,
            set_keyboard_hold_duration,
            set_keyboard_hold_unit,
            set_keyboard_repeat_mode,
            set_keyboard_repeat_count,
            set_keyboard_repeat_unit,
            set_keyboard_cps,
            set_keyboard_interval_ms,
            set_keyboard_variation_ms,
            add_macro_action,
            update_macro_action,
            remove_macro_action,
            duplicate_macro_action,
            reorder_macro_actions,
            clear_macros,
            toggle_macro_player,
            set_macro_repeat_mode,
            set_macro_repeat_count,
            set_macro_repeat_duration,
            load_macro,
            save_macro_cmd,
            get_macro_player_state,
            get_macro_actions,
            get_macro_capabilities,
            get_macro_recording_options,
            set_macro_recording_options,
            pick_cursor_position,
            start_macro_recording,
            stop_macro_recording,
            record_local_macro_event,
            get_hotkeys,
            get_platform_capabilities,
            suspend_hotkeys,
            resume_hotkeys,
            set_hotkey,
            check_hyprland,
            get_system_accent_color,
            set_window_acrylic,
            set_macro_speed_multiplier,
            get_macro_speed_multiplier,
            save_font_file,
            load_font_file,
            import_font_file
        ])
        .setup(move |app| {
            let state = app.state::<Arc<AppState>>().inner().clone();
            handle_cli_matches(app.handle(), &state);

            if let Some(main_window) = app.get_webview_window("main") {
                let _ = apply_window_acrylic(&main_window, Some(true));
            }
            if let Err(error) = setup_tray(app) {
                error!("FluAutoClicker: failed to initialize tray icon: {error}");
            }

            let loaded_config = tauri::async_runtime::block_on(async {
                match crate::engine::config_store::load_config().await {
                    Ok(config) => config,
                    Err(load_error) => {
                        error!("Failed to load app config, using defaults: {load_error}");
                        Default::default()
                    }
                }
            });
            info!("App config loaded (version {})", loaded_config.version);
            tauri::async_runtime::block_on(apply_config_to_state(&state, &loaded_config));
            tauri::async_runtime::block_on(async {
                match crate::engine::macro_engine::storage::load_macro().await {
                    Ok((actions, repeat_mode, recording_options)) => {
                        let max_id = actions.iter().map(|action| action.id).max().unwrap_or(0);

                        *state.macro_engine.actions.lock().await = actions;
                        *state.macro_engine.repeat_mode.lock().await = repeat_mode;
                        *state.macro_engine.recording_options.lock().await = recording_options;
                        state
                            .macro_engine
                            .action_id_counter
                            .store(max_id + 1, Ordering::SeqCst);
                    }
                    Err(load_error) => {
                        warn!("Failed to load macro file: {load_error}");
                    }
                }
            });
            state
                .minimize_to_tray
                .store(loaded_config.general.minimize_to_tray, Ordering::SeqCst);
            let loaded_hotkeys = RuntimeHotkeys {
                toggle_start_stop: loaded_config.hotkeys.toggle_start_stop.clone(),
                pick_position: loaded_config.hotkeys.pick_position.clone(),
                toggle_macro_recording: loaded_config.hotkeys.toggle_macro_recording.clone(),
            };

            #[cfg(target_os = "linux")]
            {
                if let Some(device) = crate::engine::uinput::setup_uinput() {
                    let mut device_guard = state.uinput_device.blocking_lock();
                    *device_guard = Some(device);
                    info!("Virtual mouse device initialized");
                } else {
                    error!("Failed to initialize virtual mouse device - permission denied");
                    warn!("Run 'sudo chmod 666 /dev/uinput' or configure udev rules");
                }

                if let Some(kb_device) = crate::engine::keyboard_uinput::setup_keyboard_uinput() {
                    let mut kb_device_guard = state.keyboard_uinput_device.blocking_lock();
                    *kb_device_guard = Some(kb_device);
                    info!("Virtual keyboard device initialized");
                } else {
                    error!("Failed to initialize virtual keyboard device - permission denied");
                    warn!("Run 'sudo chmod 666 /dev/uinput' or configure udev rules");
                }
            }

            let state_click = state.clone();
            let app_handle_click = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                crate::engine::clicker::click_task(state_click, app_handle_click).await;
            });

            let state_kb = state.clone();
            let app_handle_kb = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                crate::engine::keyboard_clicker::keyboard_clicker_task(state_kb, app_handle_kb)
                    .await;
            });

            let state_jig = state.clone();
            tauri::async_runtime::spawn(async move {
                crate::engine::jiggler::jiggler_task(state_jig).await;
            });

            crate::engine::macro_engine::recording::spawn_global_listener(
                state.macro_engine.clone(),
                state.clone(),
                app.handle().clone(),
            );

            #[cfg(target_os = "linux")]
            crate::engine::hyprland::init(app.handle().clone());

            if register_runtime_hotkeys(app.handle(), &loaded_hotkeys).is_err() {
                warn!("Failed to register runtime hotkeys, falling back to defaults");
                let fallback_hotkeys = RuntimeHotkeys::default();
                {
                    let mut state_hotkeys = state.hotkeys.blocking_lock();
                    *state_hotkeys = fallback_hotkeys.clone();
                }
                let _ = register_runtime_hotkeys(app.handle(), &fallback_hotkeys);
            }
            info!("FluAutoClicker startup complete");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(target_os = "linux")]
                crate::engine::hyprland::clear_binds();
            }
        });
}
