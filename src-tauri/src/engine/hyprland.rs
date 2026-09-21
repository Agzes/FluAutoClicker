use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::engine::state::{HotkeyAction, RuntimeHotkeys};

pub const APP_ID: &str = "fluautoclicker";

const MANAGER_INTERFACE: &str = "hyprland_global_shortcuts_manager_v1";

static APPLIED_BINDS: Mutex<Vec<String>> = Mutex::new(Vec::new());

static APPLY_LOCK: Mutex<()> = Mutex::new(());

static PROTOCOL_SUPPORTED: OnceLock<bool> = OnceLock::new();

mod protocol {
    #![allow(dead_code, unused_imports, non_snake_case, non_camel_case_types)]

    use wayland_client;

    pub mod __interfaces {
        use wayland_backend;
        use wayland_client::protocol::__interfaces::*;

        wayland_scanner::generate_interfaces!("./protocols/hyprland-global-shortcuts-v1.xml");
    }

    use self::__interfaces::*;

    wayland_scanner::generate_client_code!("./protocols/hyprland-global-shortcuts-v1.xml");
}

use protocol::hyprland_global_shortcut_v1::{self as shortcut_iface, HyprlandGlobalShortcutV1};
use protocol::hyprland_global_shortcuts_manager_v1::{
    self as manager_iface, HyprlandGlobalShortcutsManagerV1,
};

use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::wl_registry;
use wayland_client::{Connection, Dispatch, QueueHandle};

pub fn is_hyprland() -> bool {
    std::env::var("HYPRLAND_INSTANCE_SIGNATURE")
        .map(|signature| !signature.trim().is_empty())
        .unwrap_or(false)
}

pub fn protocol_supported() -> bool {
    *PROTOCOL_SUPPORTED.get_or_init(query_protocol_supported)
}

fn query_protocol_supported() -> bool {
    struct Probe;

    impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for Probe {
        fn event(
            _state: &mut Self,
            _proxy: &wl_registry::WlRegistry,
            _event: wl_registry::Event,
            _data: &GlobalListContents,
            _conn: &Connection,
            _qh: &QueueHandle<Self>,
        ) {
        }
    }

    let connection = match Connection::connect_to_env() {
        Ok(connection) => connection,
        Err(error) => {
            log::debug!("Hyprland hotkeys: cannot connect to Wayland: {error}");
            return false;
        }
    };

    let (globals, _queue) = match registry_queue_init::<Probe>(&connection) {
        Ok(globals) => globals,
        Err(error) => {
            log::debug!("Hyprland hotkeys: registry init failed: {error}");
            return false;
        }
    };

    globals.contents().with_list(|list| {
        list.iter()
            .any(|global| global.interface == MANAGER_INTERFACE)
    })
}

pub fn is_active() -> bool {
    is_hyprland() && protocol_supported()
}

pub fn init(app: AppHandle) {
    if !is_active() {
        return;
    }

    log::info!("Hyprland global shortcuts backend enabled");

    let wayland_app = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("hyprland-shortcuts".into())
        .spawn(move || loop {
            if let Err(session_error) = run_wayland_session(&wayland_app) {
                log::warn!("Hyprland global shortcuts session ended: {session_error}");
            }
            std::thread::sleep(Duration::from_secs(2));
        })
    {
        log::error!("Hyprland hotkeys: failed to spawn Wayland thread: {error}");
    }

    std::thread::Builder::new()
        .name("hyprland-config-watch".into())
        .spawn(move || watch_config_reloads(app))
        .ok();
}

struct WaylandState {
    app: AppHandle,
    _manager: Option<HyprlandGlobalShortcutsManagerV1>,
    _shortcuts: Vec<HyprlandGlobalShortcutV1>,
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for WaylandState {
    fn event(
        _state: &mut Self,
        _proxy: &wl_registry::WlRegistry,
        _event: wl_registry::Event,
        _data: &GlobalListContents,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<HyprlandGlobalShortcutsManagerV1, ()> for WaylandState {
    fn event(
        _state: &mut Self,
        _proxy: &HyprlandGlobalShortcutsManagerV1,
        _event: manager_iface::Event,
        _data: &(),
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<HyprlandGlobalShortcutV1, HotkeyAction> for WaylandState {
    fn event(
        state: &mut Self,
        _proxy: &HyprlandGlobalShortcutV1,
        event: shortcut_iface::Event,
        data: &HotkeyAction,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        match event {
            shortcut_iface::Event::Pressed { .. } => {
                crate::dispatch_hotkey(&state.app, *data, true);
            }
            shortcut_iface::Event::Released { .. } => {
                crate::dispatch_hotkey(&state.app, *data, false);
            }
        }
    }
}

fn run_wayland_session(app: &AppHandle) -> Result<(), String> {
    let connection = Connection::connect_to_env().map_err(|e| format!("connect failed: {e}"))?;
    let (globals, mut event_queue) = registry_queue_init::<WaylandState>(&connection)
        .map_err(|e| format!("registry init failed: {e}"))?;
    let queue_handle = event_queue.handle();

    let manager = globals
        .bind::<HyprlandGlobalShortcutsManagerV1, WaylandState, ()>(&queue_handle, 1..=1, ())
        .map_err(|e| format!("manager unavailable: {e}"))?;

    let hotkeys = current_hotkeys(app);
    let mut shortcuts = Vec::new();
    for action in HotkeyAction::ALL {
        let shortcut = manager.register_shortcut(
            action.id().to_string(),
            APP_ID.to_string(),
            action.title().to_string(),
            action.shortcut(&hotkeys).to_string(),
            &queue_handle,
            action,
        );
        shortcuts.push(shortcut);
    }
    log::info!("Hyprland hotkeys: registered {} shortcuts", shortcuts.len());

    let mut state = WaylandState {
        app: app.clone(),
        _manager: Some(manager),
        _shortcuts: shortcuts,
    };

    event_queue
        .roundtrip(&mut state)
        .map_err(|e| format!("flush failed: {e}"))?;

    let hotkeys = current_hotkeys(app);
    if let Err(error) = apply_hotkeys(&hotkeys) {
        log::warn!("Hyprland hotkeys: failed to apply binds: {error}");
    }

    loop {
        event_queue
            .blocking_dispatch(&mut state)
            .map_err(|e| format!("event dispatch failed: {e}"))?;
    }
}

fn current_hotkeys(app: &AppHandle) -> RuntimeHotkeys {
    match app.try_state::<Arc<crate::engine::state::AppState>>() {
        Some(state) => state.hotkeys.blocking_lock().clone(),
        None => RuntimeHotkeys::default(),
    }
}

pub fn apply_hotkeys(hotkeys: &RuntimeHotkeys) -> Result<(), String> {
    if !is_active() {
        return Ok(());
    }

    let _guard = APPLY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    apply_hotkeys_locked(hotkeys)
}

fn apply_hotkeys_locked(hotkeys: &RuntimeHotkeys) -> Result<(), String> {
    clear_binds_locked();

    for action in HotkeyAction::ALL {
        let shortcut = action.shortcut(hotkeys).trim();
        if shortcut.is_empty() {
            continue;
        }

        let (mods, key) = match shortcut_to_hyprland(shortcut) {
            Ok(parsed) => parsed,
            Err(error) => {
                log::warn!(
                    "Hyprland hotkeys: cannot bind `{shortcut}` for {}: {error}",
                    action.id()
                );
                continue;
            }
        };

        let trigger = bind_trigger(&mods, &key);
        let bind = format!("{trigger}, global, {APP_ID}:{}", action.id());
        hyprctl(&["keyword", "bind", &bind])?;
        if let Ok(mut applied) = APPLIED_BINDS.lock() {
            applied.push(trigger);
        }
    }

    Ok(())
}

pub fn clear_binds() {
    if !is_hyprland() {
        return;
    }

    let _guard = APPLY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_binds_locked();
}

fn clear_binds_locked() {
    let tracked: Vec<String> = APPLIED_BINDS
        .lock()
        .map(|mut applied| std::mem::take(&mut *applied))
        .unwrap_or_default();

    for trigger in tracked {
        let _ = hyprctl(&["keyword", "unbind", &trigger]);
    }

    for trigger in discover_stale_binds() {
        let _ = hyprctl(&["keyword", "unbind", &trigger]);
    }
}

fn bind_trigger(mods: &str, key: &str) -> String {
    format!("{mods}, {key}")
}

fn discover_stale_binds() -> Vec<String> {
    let output = match hyprctl(&["binds", "-j"]) {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };

    let binds: Vec<serde_json::Value> = match serde_json::from_str(&output) {
        Ok(binds) => binds,
        Err(_) => return Vec::new(),
    };

    let mut triggers = Vec::new();
    for bind in binds {
        let dispatcher = bind.get("dispatcher").and_then(|value| value.as_str());
        let arg = bind
            .get("arg")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let key = bind.get("key").and_then(|value| value.as_str());
        let modmask = bind.get("modmask").and_then(|value| value.as_i64());

        if dispatcher != Some("global") || !arg.starts_with(&format!("{APP_ID}:")) {
            continue;
        }

        if let (Some(key), Some(mask)) = (key, modmask) {
            triggers.push(bind_trigger(&mods_from_mask(mask), key));
        }
    }

    triggers
}

fn mods_from_mask(mask: i64) -> String {
    let mut parts = Vec::new();
    if mask & 1 != 0 {
        parts.push("SHIFT");
    }
    if mask & 4 != 0 {
        parts.push("CTRL");
    }
    if mask & 8 != 0 {
        parts.push("ALT");
    }
    if mask & 64 != 0 {
        parts.push("SUPER");
    }
    if mask & 2 != 0 {
        parts.push("CAPS");
    }
    if mask & 16 != 0 {
        parts.push("MOD2");
    }
    if mask & 32 != 0 {
        parts.push("MOD3");
    }
    if mask & 128 != 0 {
        parts.push("MOD5");
    }
    parts.join(" ")
}

fn hyprctl(args: &[&str]) -> Result<String, String> {
    let output = Command::new("hyprctl")
        .args(args)
        .output()
        .map_err(|error| format!("failed to run hyprctl: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "hyprctl {} failed: {}",
            args.join(" "),
            stderr.trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn shortcut_to_hyprland(shortcut: &str) -> Result<(String, String), String> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{Modifiers, Shortcut};

    let parsed = Shortcut::from_str(shortcut).map_err(|error| error.to_string())?;

    let mut mods = Vec::new();
    if parsed.mods.contains(Modifiers::SHIFT) {
        mods.push("SHIFT");
    }
    if parsed.mods.contains(Modifiers::CONTROL) {
        mods.push("CTRL");
    }
    if parsed.mods.contains(Modifiers::ALT) {
        mods.push("ALT");
    }
    if parsed.mods.contains(Modifiers::SUPER) {
        mods.push("SUPER");
    }

    let key = code_to_keysym(parsed.key)
        .ok_or_else(|| format!("`{}` has no Hyprland key equivalent", parsed.key))?;

    Ok((mods.join(" "), key.to_string()))
}

fn code_to_keysym(code: tauri_plugin_global_shortcut::Code) -> Option<&'static str> {
    use tauri_plugin_global_shortcut::Code::*;

    let keysym = match code {
        KeyA => "A",
        KeyB => "B",
        KeyC => "C",
        KeyD => "D",
        KeyE => "E",
        KeyF => "F",
        KeyG => "G",
        KeyH => "H",
        KeyI => "I",
        KeyJ => "J",
        KeyK => "K",
        KeyL => "L",
        KeyM => "M",
        KeyN => "N",
        KeyO => "O",
        KeyP => "P",
        KeyQ => "Q",
        KeyR => "R",
        KeyS => "S",
        KeyT => "T",
        KeyU => "U",
        KeyV => "V",
        KeyW => "W",
        KeyX => "X",
        KeyY => "Y",
        KeyZ => "Z",
        Digit0 => "0",
        Digit1 => "1",
        Digit2 => "2",
        Digit3 => "3",
        Digit4 => "4",
        Digit5 => "5",
        Digit6 => "6",
        Digit7 => "7",
        Digit8 => "8",
        Digit9 => "9",
        F1 => "F1",
        F2 => "F2",
        F3 => "F3",
        F4 => "F4",
        F5 => "F5",
        F6 => "F6",
        F7 => "F7",
        F8 => "F8",
        F9 => "F9",
        F10 => "F10",
        F11 => "F11",
        F12 => "F12",
        F13 => "F13",
        F14 => "F14",
        F15 => "F15",
        F16 => "F16",
        F17 => "F17",
        F18 => "F18",
        F19 => "F19",
        F20 => "F20",
        F21 => "F21",
        F22 => "F22",
        F23 => "F23",
        F24 => "F24",
        Space => "Space",
        Tab => "Tab",
        Enter => "Return",
        Escape => "Escape",
        Backspace => "BackSpace",
        Delete => "Delete",
        Insert => "Insert",
        Home => "Home",
        End => "End",
        PageUp => "Prior",
        PageDown => "Next",
        ArrowUp => "Up",
        ArrowDown => "Down",
        ArrowLeft => "Left",
        ArrowRight => "Right",
        CapsLock => "Caps_Lock",
        PrintScreen => "Print",
        ScrollLock => "Scroll_Lock",
        Pause => "Pause",
        NumLock => "Num_Lock",
        Backquote => "grave",
        Minus => "minus",
        Equal => "equal",
        BracketLeft => "bracketleft",
        BracketRight => "bracketright",
        Backslash => "backslash",
        Semicolon => "semicolon",
        Quote => "apostrophe",
        Comma => "comma",
        Period => "period",
        Slash => "slash",
        IntlBackslash => "less",
        Numpad0 => "KP_0",
        Numpad1 => "KP_1",
        Numpad2 => "KP_2",
        Numpad3 => "KP_3",
        Numpad4 => "KP_4",
        Numpad5 => "KP_5",
        Numpad6 => "KP_6",
        Numpad7 => "KP_7",
        Numpad8 => "KP_8",
        Numpad9 => "KP_9",
        NumpadAdd => "KP_Add",
        NumpadSubtract => "KP_Subtract",
        NumpadMultiply => "KP_Multiply",
        NumpadDivide => "KP_Divide",
        NumpadDecimal => "KP_Decimal",
        NumpadEnter => "KP_Enter",
        NumpadEqual => "KP_Equal",
        _ => return None,
    };

    Some(keysym)
}

fn watch_config_reloads(app: AppHandle) {
    loop {
        if let Some(path) = event_socket_path() {
            match std::os::unix::net::UnixStream::connect(&path) {
                Ok(stream) => {
                    use std::io::BufRead;
                    let reader = std::io::BufReader::new(stream);
                    for line in reader.lines() {
                        match line {
                            Ok(line) if line.starts_with("configreloaded") => {
                                reapply_after_reload(&app);
                            }
                            Ok(_) => {}
                            Err(_) => break,
                        }
                    }
                }
                Err(error) => {
                    log::debug!("Hyprland hotkeys: cannot watch config reloads: {error}");
                }
            }
        }

        std::thread::sleep(Duration::from_secs(2));
    }
}

fn reapply_after_reload(app: &AppHandle) {
    let state = match app.try_state::<Arc<crate::engine::state::AppState>>() {
        Some(state) => state,
        None => return,
    };

    if state.hotkeys_suspended.load(Ordering::SeqCst) {
        return;
    }

    let hotkeys = state.hotkeys.blocking_lock().clone();
    if let Err(error) = apply_hotkeys(&hotkeys) {
        log::warn!("Hyprland hotkeys: failed to re-apply binds after reload: {error}");
    }
}

fn event_socket_path() -> Option<PathBuf> {
    let signature = std::env::var("HYPRLAND_INSTANCE_SIGNATURE").ok()?;
    if signature.trim().is_empty() {
        return None;
    }

    if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
        let candidate = PathBuf::from(runtime_dir)
            .join("hypr")
            .join(&signature)
            .join(".socket2.sock");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let candidate = PathBuf::from("/tmp/hypr")
        .join(&signature)
        .join(".socket2.sock");
    if candidate.exists() {
        return Some(candidate);
    }

    None
}
