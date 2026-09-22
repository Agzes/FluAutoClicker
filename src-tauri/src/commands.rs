use crate::engine::config_store::{
    MAX_CPS, MAX_HOLD_DURATION, MAX_JIGGLER_DISTANCE, MAX_JIGGLER_INTERVAL_MS,
    MAX_MACRO_REPEAT_DURATION_MS, MAX_REPEAT_COUNT, MAX_VARIATION_MS, MIN_CPS, MIN_HOLD_DURATION,
    MIN_JIGGLER_DISTANCE, MIN_JIGGLER_INTERVAL_MS, MIN_MACRO_REPEAT_DURATION_MS, MIN_REPEAT_COUNT,
};
use crate::engine::state::{
    AppState, ClickMode, ClickType, HoldUnit, JigglerPattern, KeyboardModifier, MouseButton,
    PositionMode, RepeatMode, RepeatUnit, RuntimeHotkeys,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use enigo::{Enigo, Mouse, Settings};
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

fn fonts_dir() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("fluautoclicker")
        .join("fonts")
}

#[tauri::command]
pub async fn save_font_file(name: String, data: String) -> Result<String, String> {
    let dir = fonts_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create fonts dir: {e}"))?;

    let bytes = BASE64
        .decode(&data)
        .map_err(|e| format!("Invalid base64: {e}"))?;

    let path = dir.join(&name);
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| format!("Failed to write font: {e}"))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn load_font_file(name: String) -> Result<String, String> {
    let path = fonts_dir().join(&name);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read font: {e}"))?;
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub async fn import_font_file(source: String) -> Result<(String, String), String> {
    let src = std::path::PathBuf::from(&source);
    let file_name = src
        .file_name()
        .ok_or_else(|| "Invalid file path".to_string())?
        .to_string_lossy()
        .to_string();

    let dir = fonts_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create fonts dir: {e}"))?;

    let dest = dir.join(&file_name);
    tokio::fs::copy(&src, &dest)
        .await
        .map_err(|e| format!("Failed to copy font: {e}"))?;

    let bytes = tokio::fs::read(&dest)
        .await
        .map_err(|e| format!("Failed to read copied font: {e}"))?;
    let b64 = BASE64.encode(&bytes);

    Ok((file_name, b64))
}

const MIN_MACRO_ACTION_DURATION_MS: u32 = 1;
const MAX_MACRO_ACTION_DURATION_MS: u32 = 3_600_000;
fn clamp_u32(value: u32, min: u32, max: u32) -> u32 {
    value.clamp(min, max)
}

fn clamp_u64(value: u64, min: u64, max: u64) -> u64 {
    value.clamp(min, max)
}

#[cfg(target_os = "linux")]
fn clamp_mouse_runtime_cps(cps: u32) -> u32 {
    cps
}

#[cfg(not(target_os = "linux"))]
fn clamp_mouse_runtime_cps(cps: u32) -> u32 {
    clamp_u32(cps, MIN_CPS, MAX_CPS)
}

fn current_jiggler_pattern(state: &Arc<AppState>) -> JigglerPattern {
    state
        .jiggler_pattern
        .try_lock()
        .map(|pattern| *pattern)
        .unwrap_or(JigglerPattern::Random)
}

fn ozone_is_selected(state: &Arc<AppState>) -> bool {
    state.is_jiggler_active.load(Ordering::SeqCst)
        && current_jiggler_pattern(state) == JigglerPattern::OZone
}

pub(crate) fn set_ozone_anchor(state: &Arc<AppState>, app: &AppHandle, x: i32, y: i32) {
    state.ozone_center_x.store(x, Ordering::SeqCst);
    state.ozone_center_y.store(y, Ordering::SeqCst);
    state.ozone_anchor_ready.store(true, Ordering::SeqCst);
    state
        .ozone_wait_for_click_anchor
        .store(false, Ordering::SeqCst);

    let radius = state.jiggler_distance.load(Ordering::SeqCst);
    let _ = app.emit(
        "ozone-anchor-changed",
        serde_json::json!({ "x": x, "y": y, "radius": radius }),
    );
}

pub(crate) fn capture_pending_ozone_anchor(
    state: &Arc<AppState>,
    app: &AppHandle,
    position: Option<(i32, i32)>,
) {
    if !state
        .ozone_wait_for_click_anchor
        .swap(false, Ordering::SeqCst)
    {
        return;
    }

    if !state.is_running.load(Ordering::SeqCst) || !ozone_is_selected(state) {
        return;
    }

    if let Some((x, y)) = position.or_else(|| current_cursor_position().ok()) {
        set_ozone_anchor(state, app, x, y);
    }
}

pub(crate) fn prepare_ozone_for_clicker_start(
    state: &Arc<AppState>,
    app: &AppHandle,
    wait_for_click_anchor: bool,
) {
    if !ozone_is_selected(state) {
        state.ozone_anchor_ready.store(false, Ordering::SeqCst);
        state
            .ozone_wait_for_click_anchor
            .store(false, Ordering::SeqCst);
        return;
    }

    if wait_for_click_anchor {
        state.ozone_anchor_ready.store(false, Ordering::SeqCst);
        state
            .ozone_wait_for_click_anchor
            .store(true, Ordering::SeqCst);
        let _ = app.emit(
            "ozone-anchor-waiting",
            serde_json::json!({ "waiting": true }),
        );
        return;
    }

    if let Ok((x, y)) = current_cursor_position() {
        set_ozone_anchor(state, app, x, y);
    }
}

fn hotkey_field_mut<'a>(hotkeys: &'a mut RuntimeHotkeys, action: &str) -> Option<&'a mut String> {
    match action {
        "toggle_start_stop" | "toggle-start-stop" => Some(&mut hotkeys.toggle_start_stop),
        "pick_position" | "pick-position" => Some(&mut hotkeys.pick_position),
        "toggle_macro_recording" | "toggle-macro-recording" => {
            Some(&mut hotkeys.toggle_macro_recording)
        }
        _ => None,
    }
}

fn hotkey_entries(hotkeys: &RuntimeHotkeys) -> [(&'static str, &str); 3] {
    [
        ("toggle_start_stop", hotkeys.toggle_start_stop.as_str()),
        ("pick_position", hotkeys.pick_position.as_str()),
        (
            "toggle_macro_recording",
            hotkeys.toggle_macro_recording.as_str(),
        ),
    ]
}

fn hotkey_action_title(action: &str) -> &'static str {
    match action {
        "toggle_start_stop" => "Toggle Start/Stop",
        "pick_position" => "Pick Position",
        "toggle_macro_recording" => "Macro Recording",
        _ => "Unknown action",
    }
}

#[tauri::command]
pub async fn load_app_config() -> Result<crate::engine::config_store::AppConfigFile, String> {
    crate::engine::config_store::load_config().await
}

#[tauri::command]
pub async fn save_app_config(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    mut config: crate::engine::config_store::AppConfigFile,
) -> Result<(), String> {
    if !crate::system_startup_supported() {
        config.general.autostart = false;
    }

    set_system_startup_impl(&app, config.general.autostart)?;
    state
        .minimize_to_tray
        .store(config.general.minimize_to_tray, Ordering::SeqCst);
    crate::engine::config_store::save_config(&config).await
}

#[tauri::command]
pub async fn get_macro_settings(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::engine::config_store::MacroSettings, String> {
    let actions = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    let (repeat_mode, repeat_count, repeat_duration_ms) =
        crate::engine::config_store::MacroSettings::from_repeat_mode(&repeat_mode);

    Ok(crate::engine::config_store::MacroSettings {
        repeat_mode,
        repeat_count,
        repeat_duration_ms,
        recording_options,
        actions,
    })
}

#[tauri::command]
pub async fn import_app_config(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    mut config: crate::engine::config_store::AppConfigFile,
) -> Result<crate::engine::config_store::AppConfigFile, String> {
    if !crate::system_startup_supported() {
        config.general.autostart = false;
    }

    set_system_startup_impl(&app, config.general.autostart)?;
    let normalized = config.normalized_for_save();
    crate::persist_and_apply_config(&app, state.inner(), normalized.clone()).await?;
    let _ = app.emit(
        "profiles-updated",
        serde_json::json!({ "active_profile": normalized.active_profile }),
    );
    Ok(normalized)
}

#[tauri::command]
pub async fn save_export_file(path: String, contents: String) -> Result<(), String> {
    tokio::fs::write(path, contents)
        .await
        .map_err(|e| format!("Failed to save export file: {e}"))
}

#[tauri::command]
pub async fn list_profiles_cmd() -> Result<Vec<String>, String> {
    let config = crate::engine::config_store::load_config()
        .await
        .unwrap_or_default();
    crate::engine::config_store::ensure_default_profile(&config).await?;
    let mut profiles = crate::engine::config_store::list_profiles().await?;
    if !profiles.iter().any(|name| name == "default") {
        profiles.push("default".to_string());
        profiles.sort();
    }
    Ok(profiles)
}

#[tauri::command]
pub async fn save_profile_cmd(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    name: String,
    icon: Option<String>,
    config: crate::engine::config_store::AppConfigFile,
) -> Result<crate::engine::config_store::AppConfigFile, String> {
    let normalized_name = crate::validate_profile_name(&name)?;
    let mut next_config = config;
    next_config.active_profile = normalized_name.clone();
    crate::engine::config_store::save_profile(&normalized_name, &next_config, icon.as_deref())
        .await?;
    crate::persist_and_apply_config(&app, state.inner(), next_config.clone()).await?;
    let _ = app.emit(
        "profiles-updated",
        serde_json::json!({ "active_profile": normalized_name }),
    );
    Ok(next_config)
}

#[tauri::command]
pub async fn load_profile_cmd(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    name: String,
) -> Result<crate::engine::config_store::AppConfigFile, String> {
    let normalized_name = crate::validate_profile_name(&name)?;
    let profile = crate::load_and_activate_profile(&app, state.inner(), &normalized_name).await?;
    let _ = app.emit(
        "profiles-updated",
        serde_json::json!({ "active_profile": normalized_name }),
    );
    Ok(profile)
}

#[tauri::command]
pub async fn export_profile_cmd(
    name: String,
) -> Result<crate::engine::config_store::ProfileFile, String> {
    let normalized_name = crate::validate_profile_name(&name)?;
    if normalized_name == "default" {
        return crate::engine::config_store::load_profile_file("default").await;
    }

    crate::engine::config_store::load_profile_file(&normalized_name).await
}

#[tauri::command]
pub async fn import_profile_cmd(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    profile: crate::engine::config_store::ProfileFile,
) -> Result<crate::engine::config_store::AppConfigFile, String> {
    let normalized_name = crate::validate_profile_name(&profile.name)?;
    let mut config = profile.data.normalized_for_save();
    config.active_profile = normalized_name.clone();
    crate::engine::config_store::save_profile(&normalized_name, &config, profile.icon.as_deref())
        .await?;
    crate::persist_and_apply_config(&app, state.inner(), config.clone()).await?;
    let _ = app.emit(
        "profiles-updated",
        serde_json::json!({ "active_profile": normalized_name }),
    );
    Ok(config)
}

#[tauri::command]
pub async fn export_backup_cmd() -> Result<crate::engine::config_store::BackupFile, String> {
    let app_config = crate::engine::config_store::load_config()
        .await
        .unwrap_or_default();

    let profile_names = crate::engine::config_store::list_profiles()
        .await
        .unwrap_or_default();

    let mut profiles = Vec::new();
    for name in profile_names {
        if let Ok(profile_file) = crate::engine::config_store::load_profile_file(&name).await {
            profiles.push(profile_file);
        }
    }

    if !profiles.iter().any(|p| p.name == "default") {
        if let Ok(default_profile) = crate::engine::config_store::load_profile_file("default").await
        {
            profiles.push(default_profile);
        } else {
            profiles.push(crate::engine::config_store::ProfileFile::new(
                "default".to_string(),
                crate::engine::config_store::load_profile("default")
                    .await
                    .unwrap_or_else(|_| crate::engine::config_store::AppConfigFile::default()),
            ));
        }
    }

    Ok(crate::engine::config_store::BackupFile::new(
        app_config, profiles,
    ))
}

#[tauri::command]
pub async fn import_backup_cmd(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    backup: crate::engine::config_store::BackupFile,
) -> Result<crate::engine::config_store::AppConfigFile, String> {
    for profile in backup.profiles {
        if let Ok(normalized_name) = crate::validate_profile_name(&profile.name) {
            let config = profile.data.normalized_for_save();
            let _ = crate::engine::config_store::save_profile(
                &normalized_name,
                &config,
                profile.icon.as_deref(),
            )
            .await;
        }
    }

    let mut config = backup.app_config;
    if !crate::system_startup_supported() {
        config.general.autostart = false;
    }

    set_system_startup_impl(&app, config.general.autostart)?;
    let normalized = config.normalized_for_save();
    crate::persist_and_apply_config(&app, state.inner(), normalized.clone()).await?;
    let _ = app.emit(
        "profiles-updated",
        serde_json::json!({ "active_profile": normalized.active_profile }),
    );
    Ok(normalized)
}

#[tauri::command]
pub async fn rename_profile_cmd(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    old_name: String,
    new_name: String,
) -> Result<Vec<String>, String> {
    let old_name = crate::validate_profile_name(&old_name)?;
    let new_name = crate::validate_profile_name(&new_name)?;
    if old_name == "default" {
        return Err("The default profile cannot be renamed.".to_string());
    }
    if old_name == new_name {
        return Err("The new profile name must be different.".to_string());
    }

    let profiles = crate::engine::config_store::list_profiles().await?;
    if !profiles.iter().any(|name| name == &old_name) {
        return Err(format!("Profile `{old_name}` does not exist."));
    }
    if profiles.iter().any(|name| name == &new_name) {
        return Err(format!("Profile `{new_name}` already exists."));
    }

    crate::engine::config_store::rename_profile(&old_name, &new_name).await?;

    let mut config = crate::engine::config_store::load_config()
        .await
        .unwrap_or_default();
    if config.active_profile == old_name {
        config.active_profile = new_name.clone();
        crate::persist_and_apply_config(&app, state.inner(), config).await?;
    }

    let updated = list_profiles_cmd().await?;
    let _ = app.emit(
        "profiles-updated",
        serde_json::json!({ "active_profile": new_name }),
    );
    Ok(updated)
}

#[tauri::command]
pub async fn delete_profile_cmd(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    name: String,
) -> Result<Vec<String>, String> {
    let normalized_name = crate::validate_profile_name(&name)?;
    if normalized_name == "default" {
        return Err("The default profile cannot be deleted.".to_string());
    }

    crate::engine::config_store::delete_profile(&normalized_name).await?;

    let config = crate::engine::config_store::load_config()
        .await
        .unwrap_or_default();
    if config.active_profile == normalized_name {
        crate::load_and_activate_profile(&app, state.inner(), "default").await?;
    }

    let updated = list_profiles_cmd().await?;
    let active_profile = crate::engine::config_store::load_config()
        .await
        .unwrap_or_default()
        .active_profile;
    let _ = app.emit(
        "profiles-updated",
        serde_json::json!({ "active_profile": active_profile }),
    );
    Ok(updated)
}

#[tauri::command]
pub fn toggle_clicker(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    source: Option<String>,
) -> bool {
    let current_running = state.is_running.load(Ordering::SeqCst);
    let new_state = !current_running;

    state.is_running.store(new_state, Ordering::SeqCst);
    if new_state {
        prepare_ozone_for_clicker_start(state.inner(), &app, source.as_deref() == Some("button"));
    } else {
        state.ozone_anchor_ready.store(false, Ordering::SeqCst);
        state
            .ozone_wait_for_click_anchor
            .store(false, Ordering::SeqCst);
    }
    let _ = app.emit(
        "status-changed",
        serde_json::json!({ "running": new_state }),
    );
    new_state
}

#[tauri::command]
pub fn set_active_app_mode(state: State<'_, Arc<AppState>>, mode: String) -> Result<(), String> {
    match mode.as_str() {
        "mouse" | "keyboard" | "macro" => {
            let mut active_mode = state
                .active_mode
                .lock()
                .map_err(|_| "Failed to lock active mode.".to_string())?;
            *active_mode = mode;
            Ok(())
        }
        _ => Err("Unknown app mode.".to_string()),
    }
}

#[tauri::command]
pub async fn get_runtime_status(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mouse_running = state.is_running.load(Ordering::SeqCst);
    let keyboard_running = state.kb_is_running.load(Ordering::SeqCst);
    let macro_player_state = state.macro_engine.player_state.lock().await.clone();
    let macro_state = match macro_player_state {
        MacroPlayerState::Stopped => "stopped",
        MacroPlayerState::Playing => "playing",
        MacroPlayerState::Recording => "recording",
    };
    let macro_running = macro_state == "playing";
    let running_mode = if mouse_running {
        Some("mouse")
    } else if keyboard_running {
        Some("keyboard")
    } else if macro_running {
        Some("macro")
    } else {
        None
    };

    Ok(serde_json::json!({
        "mouse_running": mouse_running,
        "keyboard_running": keyboard_running,
        "macro_state": macro_state,
        "running": mouse_running || keyboard_running || macro_running,
        "running_mode": running_mode,
    }))
}

#[tauri::command]
pub fn set_cps(state: State<'_, Arc<AppState>>, cps: u32) {
    state
        .cps
        .store(clamp_mouse_runtime_cps(cps), Ordering::SeqCst);
}

#[tauri::command]
pub fn toggle_jiggler(state: State<'_, Arc<AppState>>, app: AppHandle) -> bool {
    let new_val = !state.is_jiggler_active.load(Ordering::SeqCst);
    state.is_jiggler_active.store(new_val, Ordering::SeqCst);
    if !new_val {
        state.ozone_anchor_ready.store(false, Ordering::SeqCst);
        state
            .ozone_wait_for_click_anchor
            .store(false, Ordering::SeqCst);
    } else if state.is_running.load(Ordering::SeqCst)
        && current_jiggler_pattern(state.inner()) == JigglerPattern::OZone
    {
        prepare_ozone_for_clicker_start(state.inner(), &app, false);
    }
    new_val
}

#[tauri::command]
pub fn set_jiggler_distance(state: State<'_, Arc<AppState>>, distance: u32) {
    state.jiggler_distance.store(
        clamp_u32(distance, MIN_JIGGLER_DISTANCE, MAX_JIGGLER_DISTANCE),
        Ordering::SeqCst,
    );
}

#[tauri::command]
pub fn set_jiggler_interval(state: State<'_, Arc<AppState>>, interval: u32) {
    state.jiggler_interval.store(
        clamp_u32(interval, MIN_JIGGLER_INTERVAL_MS, MAX_JIGGLER_INTERVAL_MS),
        Ordering::SeqCst,
    );
}

#[tauri::command]
pub async fn set_jiggler_pattern(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
    pattern: String,
) -> Result<(), String> {
    let jiggler_pattern = match pattern.as_str() {
        "rnd" => JigglerPattern::Random,
        "lin" => JigglerPattern::Linear,
        "cir" => JigglerPattern::Circle,
        "ozn" => JigglerPattern::OZone,
        _ => JigglerPattern::Random,
    };
    *state.jiggler_pattern.lock().await = jiggler_pattern;
    if jiggler_pattern != JigglerPattern::OZone {
        state.ozone_anchor_ready.store(false, Ordering::SeqCst);
        state
            .ozone_wait_for_click_anchor
            .store(false, Ordering::SeqCst);
    } else if state.is_running.load(Ordering::SeqCst) {
        prepare_ozone_for_clicker_start(state.inner(), &app, false);
    }
    Ok(())
}

#[tauri::command]
pub fn set_minimize_to_tray(state: State<'_, Arc<AppState>>, enabled: bool) {
    state.minimize_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub fn minimize_main_window(state: State<'_, Arc<AppState>>, app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found.".to_string())?;

    if state.minimize_to_tray.load(Ordering::SeqCst) {
        window
            .hide()
            .map_err(|e| format!("Failed to hide window: {e}"))
    } else {
        window
            .minimize()
            .map_err(|e| format!("Failed to minimize window: {e}"))
    }
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    crate::reveal_main_window(&app)
}

#[tauri::command]
pub fn quit_app(state: State<'_, Arc<AppState>>, app: AppHandle) {
    state.is_quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
pub fn set_start_on_system_startup(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled && !crate::system_startup_supported() {
        return Err("Start on system startup is not supported on this desktop.".to_string());
    }

    set_system_startup_impl(&app, enabled)
}

#[tauri::command]
pub fn get_start_on_system_startup(app: AppHandle) -> Result<bool, String> {
    get_system_startup_impl(&app)
}

#[cfg(target_os = "windows")]
fn startup_command(app: &AppHandle) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Failed to resolve app path: {e}"))?;
    let exe = exe
        .to_str()
        .ok_or_else(|| "App path contains invalid unicode.".to_string())?;
    let _ = app;
    Ok(format!("\"{exe}\""))
}

#[cfg(target_os = "windows")]
fn set_system_startup_impl(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .map_err(|e| format!("Failed to open startup registry key: {e}"))?;

    if enabled {
        run_key
            .set_value("FluAutoClicker", &startup_command(app)?)
            .map_err(|e| format!("Failed to enable startup launch: {e}"))?;
    } else {
        match run_key.delete_value("FluAutoClicker") {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Failed to disable startup launch: {error}")),
        }
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_system_startup_impl(_app: &AppHandle, _enabled: bool) -> Result<(), String> {
    if _enabled {
        Err("Start on system startup is only implemented on Windows.".to_string())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn get_system_startup_impl(app: &AppHandle) -> Result<bool, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .map_err(|e| format!("Failed to open startup registry key: {e}"))?;
    let expected = startup_command(app)?;
    let actual: Result<String, _> = run_key.get_value("FluAutoClicker");

    Ok(actual
        .map(|value| value.eq_ignore_ascii_case(&expected))
        .unwrap_or(false))
}

#[cfg(not(target_os = "windows"))]
fn get_system_startup_impl(_app: &AppHandle) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub async fn set_mouse_button(
    state: tauri::State<'_, Arc<AppState>>,
    button: String,
) -> Result<(), String> {
    let btn = match button.as_str() {
        "left" => MouseButton::Left,
        "middle" => MouseButton::Middle,
        "right" => MouseButton::Right,
        "front" => MouseButton::Front,
        "back" => MouseButton::Back,
        _ => MouseButton::Left,
    };
    *state.mouse_button.lock().await = btn;
    Ok(())
}

#[tauri::command]
pub async fn set_click_mode(
    state: tauri::State<'_, Arc<AppState>>,
    mode: String,
) -> Result<(), String> {
    let click_mode = match mode.as_str() {
        "press" => ClickMode::Press,
        "hold" => ClickMode::Hold,
        _ => ClickMode::Press,
    };
    *state.click_mode.lock().await = click_mode;
    Ok(())
}

#[tauri::command]
pub async fn set_click_type(
    state: tauri::State<'_, Arc<AppState>>,
    click_type: String,
) -> Result<(), String> {
    let parsed = match click_type.as_str() {
        "double" => ClickType::Double,
        "triple" => ClickType::Triple,
        _ => ClickType::Single,
    };
    *state.click_type.lock().await = parsed;
    Ok(())
}

#[tauri::command]
pub fn set_hold_duration(state: State<'_, Arc<AppState>>, duration: u32) {
    state.hold_duration.store(
        clamp_u32(duration, MIN_HOLD_DURATION, MAX_HOLD_DURATION),
        Ordering::SeqCst,
    );
}

#[tauri::command]
pub async fn set_hold_unit(
    state: tauri::State<'_, Arc<AppState>>,
    unit: String,
) -> Result<(), String> {
    let hold_unit = match unit.as_str() {
        "ms" => HoldUnit::Milliseconds,
        "s" => HoldUnit::Seconds,
        _ => HoldUnit::Milliseconds,
    };
    *state.hold_unit.lock().await = hold_unit;
    Ok(())
}

#[tauri::command]
pub async fn set_repeat_mode(
    state: tauri::State<'_, Arc<AppState>>,
    mode: String,
) -> Result<(), String> {
    let repeat_mode = match mode.as_str() {
        "infinite" => RepeatMode::Infinite,
        "finite" => RepeatMode::Finite,
        _ => RepeatMode::Infinite,
    };
    *state.repeat_mode.lock().await = repeat_mode;
    Ok(())
}

#[tauri::command]
pub fn set_repeat_count(state: State<'_, Arc<AppState>>, count: u32) {
    state.repeat_count.store(
        clamp_u32(count, MIN_REPEAT_COUNT, MAX_REPEAT_COUNT),
        Ordering::SeqCst,
    );
}

#[tauri::command]
pub async fn set_repeat_unit(
    state: tauri::State<'_, Arc<AppState>>,
    unit: String,
) -> Result<(), String> {
    let repeat_unit = match unit.as_str() {
        "times" => RepeatUnit::Times,
        "seconds" => RepeatUnit::Seconds,
        _ => RepeatUnit::Times,
    };
    *state.repeat_unit.lock().await = repeat_unit;
    Ok(())
}

#[tauri::command]
pub async fn set_position_mode(
    state: tauri::State<'_, Arc<AppState>>,
    mode: String,
) -> Result<(), String> {
    let position_mode = match mode.as_str() {
        "current" => PositionMode::Current,
        "custom" => PositionMode::Custom,
        _ => PositionMode::Current,
    };
    *state.position_mode.lock().await = position_mode;
    Ok(())
}

#[tauri::command]
pub fn set_position(state: State<'_, Arc<AppState>>, x: i32, y: i32) {
    state.coord_x.store(x, Ordering::SeqCst);
    state.coord_y.store(y, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_variation_ms(state: State<'_, Arc<AppState>>, variation: u32) {
    state
        .variation_ms
        .store(variation.min(MAX_VARIATION_MS), Ordering::SeqCst);
}

#[tauri::command]
pub async fn get_hotkeys(state: State<'_, Arc<AppState>>) -> Result<RuntimeHotkeys, String> {
    Ok(state.hotkeys.lock().await.clone())
}

#[tauri::command]
pub fn get_platform_capabilities() -> serde_json::Value {
    serde_json::json!({
        "window_acrylic": crate::window_acrylic_supported(),
        "system_startup": crate::system_startup_supported(),
        "global_hotkeys": crate::global_hotkeys_supported(),
        "hotkey_backend": crate::hotkey_backend(),
        "extended_mouse_buttons": !cfg!(target_os = "macos"),
        "wayland": crate::is_wayland_session(),
        "os": std::env::consts::OS,
        "uinput_available": linux_uinput_available(),
        "macro_playback_backend": macro_playback_backend(),
        "recording_backend": macro_recording_backend(),
        "session_type": std::env::var("XDG_SESSION_TYPE").ok(),
        "desktop_environment": std::env::var("XDG_CURRENT_DESKTOP")
            .or_else(|_| std::env::var("DESKTOP_SESSION"))
            .ok(),
        "wayland_compositor": std::env::var("WAYLAND_DISPLAY").ok(),
        "window_manager": linux_window_manager_hint(),
        "webview_devtools": env!("CARGO_PKG_VERSION").contains("beta")
            && (cfg!(debug_assertions) || cfg!(feature = "beta-devtools")),
    })
}

#[cfg(target_os = "linux")]
fn linux_uinput_available() -> bool {
    std::fs::OpenOptions::new()
        .write(true)
        .open("/dev/uinput")
        .is_ok()
}

#[cfg(not(target_os = "linux"))]
fn linux_uinput_available() -> bool {
    true
}

fn macro_playback_backend() -> &'static str {
    if cfg!(target_os = "linux") {
        "uinput"
    } else {
        "enigo"
    }
}

fn macro_recording_backend() -> &'static str {
    if cfg!(target_os = "linux") && crate::is_wayland_session() {
        "unsupported_wayland"
    } else if cfg!(target_os = "linux") {
        "rdev_x11"
    } else {
        "rdev"
    }
}

fn linux_window_manager_hint() -> Option<&'static str> {
    if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok() {
        Some("hyprland")
    } else if std::env::var("SWAYSOCK").is_ok() {
        Some("sway")
    } else if std::env::var("KDE_FULL_SESSION").is_ok() {
        Some("kde")
    } else if std::env::var("GNOME_DESKTOP_SESSION_ID").is_ok() {
        Some("gnome")
    } else {
        None
    }
}

#[tauri::command]
pub fn suspend_hotkeys(state: State<'_, Arc<AppState>>, app: AppHandle) -> Result<(), String> {
    state.hotkeys_suspended.store(true, Ordering::SeqCst);

    if let Ok(mut press_state) = state.toggle_hotkey_press_state.lock() {
        *press_state = None;
    }

    crate::unregister_all_hotkeys(&app)?;

    Ok(())
}

#[tauri::command]
pub async fn resume_hotkeys(state: State<'_, Arc<AppState>>, app: AppHandle) -> Result<(), String> {
    if !crate::global_hotkeys_supported() {
        state.hotkeys_suspended.store(true, Ordering::SeqCst);
        let _ = app.global_shortcut().unregister_all();
        return Err("Global hotkeys are not supported on Wayland sessions.".to_string());
    }

    state.hotkeys_suspended.store(false, Ordering::SeqCst);
    let hotkeys = state.hotkeys.lock().await.clone();

    if let Err(error) = crate::register_runtime_hotkeys(&app, &hotkeys) {
        state.hotkeys_suspended.store(true, Ordering::SeqCst);
        return Err(error);
    }

    Ok(())
}

#[tauri::command]
pub async fn set_hotkey(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    action: String,
    shortcut: String,
) -> Result<RuntimeHotkeys, String> {
    if !crate::global_hotkeys_supported() {
        return Err("Global hotkeys are not supported on Wayland sessions.".to_string());
    }

    let normalized_action = action.trim().to_lowercase();
    let parsed_shortcut =
        Shortcut::from_str(shortcut.trim()).map_err(|e| format!("Invalid shortcut: {e}"))?;
    let canonical_shortcut = parsed_shortcut.to_string();

    let previous_hotkeys;
    let next_hotkeys;
    {
        let mut hotkeys = state.hotkeys.lock().await;
        previous_hotkeys = hotkeys.clone();
        let snapshot = hotkeys.clone();

        for (existing_action, existing_shortcut) in hotkey_entries(&snapshot) {
            if existing_action == normalized_action {
                continue;
            }

            let conflicts = Shortcut::from_str(existing_shortcut)
                .map(|existing| existing == parsed_shortcut)
                .unwrap_or_else(|_| existing_shortcut.eq_ignore_ascii_case(&canonical_shortcut));

            if conflicts {
                return Err(format!(
                    "Shortcut `{}` is already used by {}",
                    canonical_shortcut,
                    hotkey_action_title(existing_action)
                ));
            }
        }

        let target = hotkey_field_mut(&mut hotkeys, normalized_action.as_str())
            .ok_or_else(|| format!("Unknown hotkey action `{}`", normalized_action))?;
        *target = canonical_shortcut;
        next_hotkeys = hotkeys.clone();
    }

    let register_result = if state.hotkeys_suspended.load(Ordering::SeqCst) {
        crate::unregister_all_hotkeys(&app)
    } else {
        crate::register_runtime_hotkeys(&app, &next_hotkeys)
    };

    if let Err(register_error) = register_result {
        let mut hotkeys = state.hotkeys.lock().await;
        *hotkeys = previous_hotkeys.clone();
        if state.hotkeys_suspended.load(Ordering::SeqCst) {
            let _ = crate::unregister_all_hotkeys(&app);
        } else {
            let _ = crate::register_runtime_hotkeys(&app, &previous_hotkeys);
        }
        return Err(register_error);
    }

    let mut config = crate::engine::config_store::load_config()
        .await
        .unwrap_or_default();
    config.hotkeys.toggle_start_stop = next_hotkeys.toggle_start_stop.clone();
    config.hotkeys.pick_position = next_hotkeys.pick_position.clone();
    config.hotkeys.toggle_macro_recording = next_hotkeys.toggle_macro_recording.clone();
    crate::engine::config_store::save_config(&config).await?;

    let _ = app.emit(
        "hotkeys-updated",
        serde_json::json!({
            "hotkeys": next_hotkeys.clone()
        }),
    );

    Ok(next_hotkeys)
}

#[tauri::command]
pub fn check_uinput_permissions() -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        match std::fs::OpenOptions::new().write(true).open("/dev/uinput") {
            Ok(_) => Ok(true),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    Ok(false)
                } else if e.kind() == std::io::ErrorKind::NotFound {
                    Err("/dev/uinput is missing. Load the uinput kernel module or install a package that enables it.".to_string())
                } else {
                    Err(format!("Cannot access /dev/uinput: {}", e))
                }
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(true)
    }
}

#[tauri::command]
pub async fn request_uinput_permissions(_app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let output = Command::new("pkexec")
            .arg("sh")
            .arg("-c")
            .arg("modprobe uinput 2>/dev/null || true; chmod 666 /dev/uinput")
            .output();

        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(true)
                } else {
                    let stderr = String::from_utf8_lossy(&result.stderr);
                    Err(format!("pkexec failed: {}", stderr))
                }
            }
            Err(e) => Err(format!("pkexec not available: {}", e)),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(true)
    }
}

#[tauri::command]
pub async fn install_uinput_udev_rule() -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let username = std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .map_err(|_| "Could not detect the current Linux user.".to_string())?;

        if username.trim().is_empty()
            || !username
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        {
            return Err("Could not safely use the current Linux user name.".to_string());
        }

        let script = r#"set -eu
groupadd -f uinput
usermod -aG uinput "$1"
printf '%s\n' 'KERNEL=="uinput", MODE="0660", GROUP="uinput", OPTIONS+="static_node=uinput"' > /etc/udev/rules.d/99-fluautoclicker-uinput.rules
modprobe uinput 2>/dev/null || true
udevadm control --reload-rules
udevadm trigger --subsystem-match=misc --sysname-match=uinput 2>/dev/null || udevadm trigger
chgrp uinput /dev/uinput 2>/dev/null || true
chmod 660 /dev/uinput 2>/dev/null || true
"#;

        let output = Command::new("pkexec")
            .arg("sh")
            .arg("-c")
            .arg(script)
            .arg("fluautoclicker-uinput-setup")
            .arg(username)
            .output();

        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(true)
                } else {
                    let stderr = String::from_utf8_lossy(&result.stderr);
                    Err(format!("uinput setup failed: {}", stderr.trim()))
                }
            }
            Err(e) => Err(format!("pkexec not available: {}", e)),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(true)
    }
}

#[tauri::command]
pub fn toggle_keyboard_clicker(state: State<'_, Arc<AppState>>, app: AppHandle) -> bool {
    let current_running = state.kb_is_running.load(Ordering::SeqCst);
    let new_state = !current_running;

    state.kb_is_running.store(new_state, Ordering::SeqCst);
    let _ = app.emit(
        "keyboard-status-changed",
        serde_json::json!({ "running": new_state }),
    );
    new_state
}

#[tauri::command]
pub async fn set_keyboard_key(
    state: tauri::State<'_, Arc<AppState>>,
    key: String,
) -> Result<(), String> {
    *state.keyboard_key.lock().await = key;
    Ok(())
}

#[tauri::command]
pub async fn set_keyboard_modifiers(
    state: tauri::State<'_, Arc<AppState>>,
    modifiers: String,
) -> Result<(), String> {
    let mod_enum = KeyboardModifier::from_str(&modifiers);
    *state.keyboard_modifiers.lock().await = mod_enum;
    Ok(())
}

#[tauri::command]
pub async fn set_keyboard_click_mode(
    state: tauri::State<'_, Arc<AppState>>,
    mode: String,
) -> Result<(), String> {
    let click_mode = match mode.as_str() {
        "press" => ClickMode::Press,
        "hold" => ClickMode::Hold,
        _ => ClickMode::Press,
    };
    *state.kb_click_mode.lock().await = click_mode;
    Ok(())
}

#[tauri::command]
pub fn set_keyboard_hold_duration(state: State<'_, Arc<AppState>>, duration: u32) {
    state.kb_hold_duration.store(
        clamp_u32(duration, MIN_HOLD_DURATION, MAX_HOLD_DURATION),
        Ordering::SeqCst,
    );
}

#[tauri::command]
pub async fn set_keyboard_hold_unit(
    state: tauri::State<'_, Arc<AppState>>,
    unit: String,
) -> Result<(), String> {
    let hold_unit = match unit.as_str() {
        "ms" => HoldUnit::Milliseconds,
        "s" => HoldUnit::Seconds,
        _ => HoldUnit::Milliseconds,
    };
    *state.kb_hold_unit.lock().await = hold_unit;
    Ok(())
}

#[tauri::command]
pub async fn set_keyboard_repeat_mode(
    state: tauri::State<'_, Arc<AppState>>,
    mode: String,
) -> Result<(), String> {
    let repeat_mode = match mode.as_str() {
        "infinite" => RepeatMode::Infinite,
        "finite" => RepeatMode::Finite,
        _ => RepeatMode::Infinite,
    };
    *state.kb_repeat_mode.lock().await = repeat_mode;
    Ok(())
}

#[tauri::command]
pub fn set_keyboard_repeat_count(state: State<'_, Arc<AppState>>, count: u32) {
    state.kb_repeat_count.store(
        clamp_u32(count, MIN_REPEAT_COUNT, MAX_REPEAT_COUNT),
        Ordering::SeqCst,
    );
}

#[tauri::command]
pub async fn set_keyboard_repeat_unit(
    state: tauri::State<'_, Arc<AppState>>,
    unit: String,
) -> Result<(), String> {
    let repeat_unit = match unit.as_str() {
        "times" => RepeatUnit::Times,
        "seconds" => RepeatUnit::Seconds,
        _ => RepeatUnit::Times,
    };
    *state.kb_repeat_unit.lock().await = repeat_unit;
    Ok(())
}

#[tauri::command]
pub fn set_keyboard_cps(state: State<'_, Arc<AppState>>, cps: u32) {
    state
        .kb_cps
        .store(clamp_u32(cps, MIN_CPS, MAX_CPS), Ordering::SeqCst);
}

#[tauri::command]
pub fn set_keyboard_interval_ms(state: State<'_, Arc<AppState>>, interval_ms: u32) {
    state.kb_interval_ms.store(
        interval_ms.min(MAX_MACRO_ACTION_DURATION_MS),
        Ordering::SeqCst,
    );
}

#[tauri::command]
pub fn set_keyboard_variation_ms(state: State<'_, Arc<AppState>>, variation: u32) {
    state
        .kb_variation_ms
        .store(variation.min(MAX_VARIATION_MS), Ordering::SeqCst);
}

use crate::engine::macro_engine::storage;
use crate::engine::macro_engine::types::{
    MacroAction, MacroActionConfig, MacroKeyboardAction, MacroMouseAction, MacroMouseButton,
    MacroMoveStyle, MacroPlayerState, MacroRecordingOptions, MacroRepeatMode,
};

fn macro_supported_mouse_buttons() -> Vec<&'static str> {
    let mut buttons = vec!["left", "middle", "right"];
    #[cfg(not(target_os = "macos"))]
    {
        buttons.push("front");
        buttons.push("back");
    }
    buttons
}

fn current_cursor_position() -> Result<(i32, i32), String> {
    let enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to initialize input bridge: {e}"))?;
    enigo
        .location()
        .map_err(|e| format!("Failed to read cursor position: {e}"))
}

fn sanitize_macro_action_config(config: &mut MacroActionConfig) {
    match config {
        MacroActionConfig::Mouse {
            clicks,
            action: MacroMouseAction::Hold { duration_ms },
            ..
        } => {
            *clicks = (*clicks).clamp(1, 3);
            *duration_ms = clamp_u32(
                *duration_ms,
                MIN_MACRO_ACTION_DURATION_MS,
                MAX_MACRO_ACTION_DURATION_MS,
            );
        }
        MacroActionConfig::Mouse { clicks, .. } => {
            *clicks = (*clicks).clamp(1, 3);
        }
        MacroActionConfig::Keyboard {
            action: MacroKeyboardAction::Hold { duration_ms },
            ..
        } => {
            *duration_ms = clamp_u32(
                *duration_ms,
                MIN_MACRO_ACTION_DURATION_MS,
                MAX_MACRO_ACTION_DURATION_MS,
            );
        }
        MacroActionConfig::Move {
            style:
                MacroMoveStyle::Linear { duration_ms } | MacroMoveStyle::Smooth { duration_ms, .. },
            ..
        } => {
            *duration_ms = clamp_u32(
                *duration_ms,
                MIN_MACRO_ACTION_DURATION_MS,
                MAX_MACRO_ACTION_DURATION_MS,
            );
        }
        MacroActionConfig::Sleep { duration_ms } => {
            *duration_ms = clamp_u32(
                *duration_ms,
                MIN_MACRO_ACTION_DURATION_MS,
                MAX_MACRO_ACTION_DURATION_MS,
            );
        }
        _ => {}
    }
}

#[tauri::command]
pub fn set_window_acrylic(
    window: Window,
    enabled: bool,
    focused: Option<bool>,
    state: State<'_, Arc<AppState>>,
) -> bool {
    state.acrylic_enabled.store(enabled, Ordering::SeqCst);

    if enabled {
        crate::apply_window_acrylic(&window, focused)
    } else {
        crate::clear_window_acrylic(&window)
    }
}

#[tauri::command]
pub async fn add_macro_action(
    state: State<'_, Arc<AppState>>,
    action_json: String,
) -> Result<(), String> {
    let mut config: MacroActionConfig =
        serde_json::from_str(&action_json).map_err(|e| format!("Failed to parse action: {}", e))?;
    sanitize_macro_action_config(&mut config);

    let id = state
        .macro_engine
        .action_id_counter
        .fetch_add(1, Ordering::SeqCst);

    let action = MacroAction {
        id,
        timestamp_ms: 0,
        config,
    };

    let mut actions = state.macro_engine.actions.lock().await;
    actions.push(action);

    drop(actions);

    let actions_clone = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn update_macro_action(
    state: State<'_, Arc<AppState>>,
    action_id: u64,
    action_json: String,
) -> Result<(), String> {
    let mut config: MacroActionConfig =
        serde_json::from_str(&action_json).map_err(|e| format!("Failed to parse action: {}", e))?;
    sanitize_macro_action_config(&mut config);

    let mut actions = state.macro_engine.actions.lock().await;
    if let Some(action) = actions.iter_mut().find(|a| a.id == action_id) {
        action.config = config;
    } else {
        return Err("Action not found".to_string());
    }
    drop(actions);

    let actions_clone = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn remove_macro_action(
    state: State<'_, Arc<AppState>>,
    action_id: u64,
) -> Result<(), String> {
    let mut actions = state.macro_engine.actions.lock().await;
    actions.retain(|a| a.id != action_id);
    drop(actions);

    let actions_clone = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn duplicate_macro_action(
    state: State<'_, Arc<AppState>>,
    action_id: u64,
) -> Result<(), String> {
    let mut actions = state.macro_engine.actions.lock().await;
    let Some(index) = actions.iter().position(|action| action.id == action_id) else {
        return Err("Macro action was not found.".to_string());
    };

    let id = state
        .macro_engine
        .action_id_counter
        .fetch_add(1, Ordering::SeqCst);
    let mut duplicated = actions[index].clone();
    duplicated.id = id;
    actions.insert(index + 1, duplicated);
    drop(actions);

    let actions_clone = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn reorder_macro_actions(
    state: State<'_, Arc<AppState>>,
    action_ids: Vec<u64>,
) -> Result<(), String> {
    let mut actions = state.macro_engine.actions.lock().await;

    if action_ids.len() != actions.len() {
        return Err("Macro action list changed. Refresh and try again.".to_string());
    }

    let existing_ids: HashSet<u64> = actions.iter().map(|action| action.id).collect();
    let requested_ids: HashSet<u64> = action_ids.iter().copied().collect();

    if requested_ids.len() != action_ids.len() || requested_ids != existing_ids {
        return Err("Macro action order does not match the current action list.".to_string());
    }

    let mut actions_by_id: HashMap<u64, MacroAction> = actions
        .drain(..)
        .map(|action| (action.id, action))
        .collect();

    *actions = action_ids
        .into_iter()
        .filter_map(|id| actions_by_id.remove(&id))
        .collect();

    drop(actions);

    let actions_clone = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn clear_macros(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut actions = state.macro_engine.actions.lock().await;
    actions.clear();
    drop(actions);

    *state.macro_engine.player_state.lock().await = MacroPlayerState::Stopped;
    state
        .macro_engine
        .cancel_playback
        .store(true, Ordering::SeqCst);
    state
        .macro_engine
        .recording_active
        .store(false, Ordering::SeqCst);
    if let Ok(mut context) = state.macro_engine.recording_context.lock() {
        context.reset(None);
    }

    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    storage::save_macro(&[], &repeat_mode, &recording_options).await?;

    Ok(())
}

#[tauri::command]
pub async fn toggle_macro_player(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<bool, String> {
    let current_state = state.macro_engine.player_state.lock().await.clone();

    match current_state {
        MacroPlayerState::Playing => {
            drop(state.macro_engine.player_state.lock().await);
            crate::engine::macro_engine::playback::stop_playback(&state.macro_engine, app).await;
            Ok(false)
        }
        MacroPlayerState::Recording => {
            Err("Stop macro recording before starting playback.".to_string())
        }
        MacroPlayerState::Stopped => {
            drop(state.macro_engine.player_state.lock().await);
            crate::engine::macro_engine::playback::start_playback(&state.macro_engine, app).await?;
            Ok(true)
        }
    }
}

#[tauri::command]
pub async fn set_macro_repeat_mode(
    state: State<'_, Arc<AppState>>,
    mode: String,
) -> Result<(), String> {
    let repeat_mode = match mode.as_str() {
        "infinite" => MacroRepeatMode::Infinite,
        "finite_times" => MacroRepeatMode::FiniteTimes { count: 1 },
        "finite_seconds" => MacroRepeatMode::FiniteSeconds { duration_ms: 10000 },
        _ => MacroRepeatMode::Infinite,
    };

    *state.macro_engine.repeat_mode.lock().await = repeat_mode;

    let actions_clone = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn set_macro_repeat_count(
    state: State<'_, Arc<AppState>>,
    count: u32,
) -> Result<(), String> {
    let mut repeat_mode = state.macro_engine.repeat_mode.lock().await;

    if let MacroRepeatMode::FiniteTimes { .. } = *repeat_mode {
        *repeat_mode = MacroRepeatMode::FiniteTimes {
            count: clamp_u32(count, MIN_REPEAT_COUNT, MAX_REPEAT_COUNT),
        };
    }

    drop(repeat_mode);

    let actions_clone = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn set_macro_repeat_duration(
    state: State<'_, Arc<AppState>>,
    duration_ms: u64,
) -> Result<(), String> {
    let mut repeat_mode = state.macro_engine.repeat_mode.lock().await;

    if let MacroRepeatMode::FiniteSeconds { .. } = *repeat_mode {
        *repeat_mode = MacroRepeatMode::FiniteSeconds {
            duration_ms: clamp_u64(
                duration_ms,
                MIN_MACRO_REPEAT_DURATION_MS,
                MAX_MACRO_REPEAT_DURATION_MS,
            ),
        };
    }

    drop(repeat_mode);

    let actions_clone = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions_clone, &repeat_mode, &recording_options).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn load_macro(state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let (actions, repeat_mode, recording_options) = storage::load_macro().await?;

    let mut state_actions = state.macro_engine.actions.lock().await;
    *state_actions = actions.clone();
    drop(state_actions);

    let mut state_repeat_mode = state.macro_engine.repeat_mode.lock().await;
    *state_repeat_mode = repeat_mode.clone();
    drop(state_repeat_mode);

    let mut state_recording_options = state.macro_engine.recording_options.lock().await;
    *state_recording_options = recording_options;
    drop(state_recording_options);

    let max_id = actions.iter().map(|a| a.id).max().unwrap_or(0);
    state
        .macro_engine
        .action_id_counter
        .store(max_id + 1, Ordering::SeqCst);

    Ok(serde_json::json!({
        "actions": actions.len(),
        "repeat_mode": match repeat_mode {
            MacroRepeatMode::Infinite => "infinite".to_string(),
            MacroRepeatMode::FiniteTimes { count } => format!("finite_times_{}", count),
            MacroRepeatMode::FiniteSeconds { duration_ms } => format!("finite_seconds_{}", duration_ms),
        }
    }))
}

#[tauri::command]
pub async fn save_macro_cmd(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let actions = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let recording_options = state.macro_engine.recording_options.lock().await.clone();

    storage::save_macro(&actions, &repeat_mode, &recording_options).await
}

#[tauri::command]
pub async fn get_macro_player_state(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let player_state = state.macro_engine.player_state.lock().await.clone();
    Ok(match player_state {
        MacroPlayerState::Stopped => "stopped".to_string(),
        MacroPlayerState::Playing => "playing".to_string(),
        MacroPlayerState::Recording => "recording".to_string(),
    })
}

#[tauri::command]
pub async fn get_macro_actions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<serde_json::Value>, String> {
    let actions = state.macro_engine.actions.lock().await.clone();

    let result: Vec<serde_json::Value> = actions.iter().map(|action| {
        serde_json::json!({
            "id": action.id,
            "timestamp_ms": action.timestamp_ms,
            "config": match &action.config {
                MacroActionConfig::Mouse { button, action: mouse_action, position, clicks } => {
                    serde_json::json!({
                        "type": "mouse",
                        "button": match button {
                            MacroMouseButton::Left => "left",
                            MacroMouseButton::Middle => "middle",
                            MacroMouseButton::Right => "right",
                            MacroMouseButton::Front => "front",
                            MacroMouseButton::Back => "back",
                        },
                        "action": match mouse_action {
                            MacroMouseAction::Press => "press".to_string(),
                            MacroMouseAction::Hold { duration_ms } => format!("hold_{}", duration_ms),
                            MacroMouseAction::Down => "down".to_string(),
                            MacroMouseAction::Up => "up".to_string(),
                        },
                        "position": position.map(|(x, y)| format!("{},{}", x, y)),
                        "clicks": *clicks,
                    })
                }
                MacroActionConfig::Move { x, y, style } => {
                    serde_json::json!({
                        "type": "move",
                        "x": x,
                        "y": y,
                        "style": match style {
                            MacroMoveStyle::Instant => "instant".to_string(),
                            MacroMoveStyle::Linear { duration_ms } => format!("linear_{}", duration_ms),
                            MacroMoveStyle::Smooth { path, duration_ms } => {
                                format!("smooth_{}_{}", duration_ms, path.len())
                            }
                        },
                    })
                }
                MacroActionConfig::Keyboard { key, text, modifiers, action } => {
                    serde_json::json!({
                        "type": "keyboard",
                        "key": key,
                        "text": text,
                        "modifiers": modifiers.join("+"),
                        "action": match action {
                            MacroKeyboardAction::Press => "press".to_string(),
                            MacroKeyboardAction::Hold { duration_ms } => format!("hold_{}", duration_ms),
                            MacroKeyboardAction::Down => "down".to_string(),
                            MacroKeyboardAction::Up => "up".to_string(),
                        },
                    })
                }
                MacroActionConfig::Sleep { duration_ms } => {
                    serde_json::json!({
                        "type": "sleep",
                        "duration_ms": duration_ms,
                    })
                }
                MacroActionConfig::Scroll { clicks } => {
                    serde_json::json!({
                        "type": "scroll",
                        "clicks": clicks,
                    })
                }
                MacroActionConfig::RawMove { points } => {
                    let duration_ms = points
                        .first()
                        .and_then(|first| points.last().map(|last| (last.2.saturating_sub(first.2)) as u32))
                        .unwrap_or(0);
                    serde_json::json!({
                        "type": "raw_move",
                        "points": points.len(),
                        "duration_ms": duration_ms,
                        "start": points.first().map(|(x, y, _)| format!("{}, {}", x, y)),
                        "end": points.last().map(|(x, y, _)| format!("{}, {}", x, y)),
                    })
                }
            }
        })
    }).collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_macro_capabilities(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let supported = state
        .macro_engine
        .recording_supported
        .load(Ordering::SeqCst);
    let recording_error = state
        .macro_engine
        .recording_error
        .lock()
        .ok()
        .and_then(|guard| guard.clone());

    Ok(serde_json::json!({
        "supported_mouse_buttons": macro_supported_mouse_buttons(),
        "recording_supported": supported,
        "recording_reason": recording_error,
        "playback_backend": macro_playback_backend(),
        "recording_backend": macro_recording_backend(),
        "pick_delay_ms": 5000u64,
        "smooth_move_supported": true,
        "cursor_pick_supported": true
    }))
}

#[tauri::command]
pub async fn get_macro_recording_options(
    state: State<'_, Arc<AppState>>,
) -> Result<MacroRecordingOptions, String> {
    Ok(state.macro_engine.recording_options.lock().await.clone())
}

#[tauri::command]
pub async fn set_macro_recording_options(
    state: State<'_, Arc<AppState>>,
    options_json: String,
) -> Result<MacroRecordingOptions, String> {
    let options: MacroRecordingOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Failed to parse recording options: {}", e))?;

    {
        let mut state_options = state.macro_engine.recording_options.lock().await;
        *state_options = options.clone();
    }

    let actions = state.macro_engine.actions.lock().await.clone();
    let repeat_mode = state.macro_engine.repeat_mode.lock().await.clone();
    let persisted_options = options.clone();
    tokio::spawn(async move {
        let _ = storage::save_macro(&actions, &repeat_mode, &persisted_options).await;
    });

    Ok(options)
}

#[tauri::command]
pub async fn pick_cursor_position(delay_ms: Option<u64>) -> Result<serde_json::Value, String> {
    let delay_ms = delay_ms.unwrap_or(0).min(15_000);
    if delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }

    let (x, y) = current_cursor_position()?;
    Ok(serde_json::json!({
        "x": x,
        "y": y
    }))
}

#[tauri::command]
pub async fn start_macro_recording(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), String> {
    crate::engine::macro_engine::recording::start_recording(&state.macro_engine, app).await
}

#[tauri::command]
pub async fn stop_macro_recording(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), String> {
    crate::engine::macro_engine::recording::stop_recording(&state.macro_engine, app).await
}

#[tauri::command]
pub fn check_hyprland() -> bool {
    #[cfg(target_os = "linux")]
    {
        crate::engine::hyprland::is_hyprland()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[tauri::command]
pub fn get_system_accent_color() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let dwm = hkcu
            .open_subkey("Software\\Microsoft\\Windows\\DWM")
            .map_err(|e| format!("Failed to read Windows DWM accent key: {e}"))?;

        let accent: u32 = dwm
            .get_value("AccentColor")
            .or_else(|_| dwm.get_value("ColorizationColor"))
            .map_err(|e| format!("Failed to read Windows accent color: {e}"))?;

        let red = accent & 0xFF;
        let green = (accent >> 8) & 0xFF;
        let blue = (accent >> 16) & 0xFF;

        Ok(format!("#{red:02X}{green:02X}{blue:02X}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("System accent color is only available on Windows.".to_string())
    }
}

#[tauri::command]
pub async fn set_macro_speed_multiplier(
    state: State<'_, Arc<AppState>>,
    multiplier: f64,
) -> Result<(), String> {
    if multiplier <= 0.0 {
        return Err("Multiplier must be greater than zero".to_string());
    }
    *state.macro_engine.speed_multiplier.lock().await = multiplier;
    Ok(())
}

#[tauri::command]
pub async fn get_macro_speed_multiplier(state: State<'_, Arc<AppState>>) -> Result<f64, String> {
    Ok(*state.macro_engine.speed_multiplier.lock().await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_clamps_keep_values_in_runtime_ranges() {
        assert_eq!(clamp_u32(0, MIN_CPS, MAX_CPS), MIN_CPS);
        assert_eq!(clamp_u32(u32::MAX, MIN_CPS, MAX_CPS), MAX_CPS);
        assert_eq!(
            clamp_u64(
                u64::MAX,
                MIN_MACRO_REPEAT_DURATION_MS,
                MAX_MACRO_REPEAT_DURATION_MS,
            ),
            MAX_MACRO_REPEAT_DURATION_MS
        );
    }

    #[test]
    fn macro_action_sanitizer_clamps_embedded_durations() {
        let mut action = MacroActionConfig::Sleep { duration_ms: 0 };
        sanitize_macro_action_config(&mut action);
        assert!(matches!(
            action,
            MacroActionConfig::Sleep {
                duration_ms: MIN_MACRO_ACTION_DURATION_MS
            }
        ));

        let mut action = MacroActionConfig::Keyboard {
            key: "A".to_string(),
            text: None,
            modifiers: Vec::new(),
            action: MacroKeyboardAction::Hold {
                duration_ms: u32::MAX,
            },
        };
        sanitize_macro_action_config(&mut action);
        assert!(matches!(
            action,
            MacroActionConfig::Keyboard {
                action: MacroKeyboardAction::Hold {
                    duration_ms: MAX_MACRO_ACTION_DURATION_MS
                },
                ..
            }
        ));
    }
}
