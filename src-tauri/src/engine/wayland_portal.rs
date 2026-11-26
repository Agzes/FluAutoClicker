use std::collections::HashMap;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use futures_core::Stream;
use tauri::AppHandle;
use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};

use crate::engine::state::{HotkeyAction, RuntimeHotkeys};

const PORTAL_BUS_NAME: &str = "org.freedesktop.portal.Desktop";
const PORTAL_OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";
const GLOBAL_SHORTCUTS_IFACE: &str = "org.freedesktop.portal.GlobalShortcuts";
const REGISTRY_IFACE: &str = "org.freedesktop.portal.Registry";
const REQUEST_IFACE: &str = "org.freedesktop.portal.Request";
const SESSION_IFACE: &str = "org.freedesktop.portal.Session";
const APP_ID: &str = "io.github.agzes.fluautoclicker";

static PORTAL_SUPPORTED: OnceLock<bool> = OnceLock::new();
static PORTAL_VERSION: AtomicU32 = AtomicU32::new(0);
static PORTAL_CONNECTION: tokio::sync::OnceCell<zbus::Connection> =
    tokio::sync::OnceCell::const_new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static CURRENT_SESSION: Mutex<Option<String>> = Mutex::new(None);
static SESSION_BOUND: AtomicBool = AtomicBool::new(false);
static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(1);

async fn ensure_connection() -> Result<zbus::Connection, String> {
    PORTAL_CONNECTION
        .get_or_try_init(|| async {
            let connection = zbus::Connection::session()
                .await
                .map_err(|e| format!("Failed to connect to session D-Bus: {e}"))?;

            if let Ok(registry) = zbus::Proxy::new(
                &connection,
                PORTAL_BUS_NAME,
                PORTAL_OBJECT_PATH,
                REGISTRY_IFACE,
            )
            .await
            {
                let options: HashMap<&str, Value<'_>> = HashMap::new();
                if let Err(error) = registry.call_method("Register", &(APP_ID, options)).await {
                    log::debug!("XDG Portal Registry.Register skipped: {error}");
                }
            }

            Ok(connection)
        })
        .await
        .cloned()
}

fn next_token(prefix: &str) -> String {
    let id = TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("flu_{prefix}_{id}")
}

fn portal_supported() -> bool {
    *PORTAL_SUPPORTED.get_or_init(query_portal_supported)
}

fn query_portal_supported() -> bool {
    let Ok(connection) = zbus::blocking::Connection::session() else {
        log::debug!("Wayland portal hotkeys: failed to connect to session D-Bus");
        return false;
    };

    let Ok(proxy) = zbus::blocking::fdo::PropertiesProxy::builder(&connection)
        .destination(PORTAL_BUS_NAME)
        .and_then(|builder| builder.path(PORTAL_OBJECT_PATH))
        .map(|builder| builder.build())
    else {
        return false;
    };

    let Ok(proxy) = proxy else {
        return false;
    };

    let Ok(iface_name) = zbus::names::InterfaceName::try_from(GLOBAL_SHORTCUTS_IFACE) else {
        return false;
    };

    match proxy.get(iface_name, "version") {
        Ok(version) => {
            let ver = u32::try_from(&version).unwrap_or(1);
            PORTAL_VERSION.store(ver, Ordering::Relaxed);
            log::info!("XDG GlobalShortcuts portal detected (version: {ver})");
            true
        }
        Err(error) => {
            log::debug!("XDG GlobalShortcuts portal unavailable: {error}");
            false
        }
    }
}

pub fn is_active() -> bool {
    crate::is_wayland_session() && !crate::engine::hyprland::is_active() && portal_supported()
}

pub fn init(app: AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
    if !is_active() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        if let Err(error) = listen_portal_signals(app).await {
            log::warn!("XDG GlobalShortcuts signal listener stopped: {error}");
        }
    });
}

async fn listen_portal_signals(app: AppHandle) -> Result<(), String> {
    let connection = ensure_connection().await?;

    let proxy = zbus::Proxy::new(
        &connection,
        PORTAL_BUS_NAME,
        PORTAL_OBJECT_PATH,
        GLOBAL_SHORTCUTS_IFACE,
    )
    .await
    .map_err(|e| format!("Failed to create GlobalShortcuts proxy: {e}"))?;

    let mut signals = proxy
        .receive_all_signals()
        .await
        .map_err(|e| format!("Failed to subscribe to GlobalShortcuts signals: {e}"))?;

    while let Some(msg) = next_stream_item(&mut signals).await {
        let member = msg.header().member().map(|m| m.as_str().to_string());
        match member.as_deref() {
            Some("Activated") => handle_shortcut_signal(&app, &msg, true),
            Some("Deactivated") => handle_shortcut_signal(&app, &msg, false),
            _ => {}
        }
    }

    Ok(())
}

async fn next_stream_item<S: Stream + Unpin>(stream: &mut S) -> Option<S::Item> {
    std::future::poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)).await
}

fn handle_shortcut_signal(app: &AppHandle, msg: &zbus::Message, pressed: bool) {
    let Ok((session_handle, shortcut_id, _timestamp, _options)) =
        msg.body()
            .deserialize::<(OwnedObjectPath, String, u64, HashMap<String, OwnedValue>)>()
    else {
        return;
    };

    if let Ok(guard) = CURRENT_SESSION.lock() {
        if let Some(active_session) = guard.as_deref() {
            if session_handle.as_str() != active_session {
                return;
            }
        }
    }

    if let Some(action) = shortcut_id_to_action(&shortcut_id) {
        crate::dispatch_hotkey(app, action, pressed);
    }
}

fn shortcut_id_to_action(id: &str) -> Option<HotkeyAction> {
    HotkeyAction::ALL
        .into_iter()
        .find(|action| action.id() == id)
}

pub fn clear_binds() {
    SESSION_BOUND.store(false, Ordering::SeqCst);
    let previous = CURRENT_SESSION
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());

    if let Some(session_path) = previous {
        tauri::async_runtime::spawn(async move {
            let _ = close_session(&session_path).await;
        });
    }
}

pub fn sync_on_startup(hotkeys: RuntimeHotkeys) {
    if !is_active() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync_session_on_startup(&hotkeys).await {
            log::debug!("XDG GlobalShortcuts startup session skipped: {error}");
        }
    });
}

async fn sync_session_on_startup(hotkeys: &RuntimeHotkeys) -> Result<(), String> {
    let previous = CURRENT_SESSION
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    if let Some(prev_path) = previous {
        let _ = close_session(&prev_path).await;
    }

    let connection = ensure_connection().await?;

    let portal = zbus::Proxy::new(
        &connection,
        PORTAL_BUS_NAME,
        PORTAL_OBJECT_PATH,
        GLOBAL_SHORTCUTS_IFACE,
    )
    .await
    .map_err(|e| format!("Failed to create GlobalShortcuts proxy: {e}"))?;

    let handle_token = next_token("create");
    let session_token = next_token("session");
    let req_path = predicted_request_path(&connection, &handle_token)?;
    let responses = subscribe_request_response(&connection, &req_path).await?;
    let mut create_opts: HashMap<&str, Value<'_>> = HashMap::new();
    create_opts.insert("handle_token", Value::from(handle_token.as_str()));
    create_opts.insert("session_handle_token", Value::from(session_token.as_str()));

    let _: OwnedObjectPath = portal
        .call("CreateSession", &(create_opts,))
        .await
        .map_err(|e| format!("CreateSession failed: {e}"))?;

    let (response_code, results) = await_request_response(responses).await?;
    if response_code != 0 {
        return Err(format!("CreateSession rejected with code {response_code}"));
    }

    let session_handle = results
        .get("session_handle")
        .and_then(|value| <&str>::try_from(value).ok().map(str::to_string))
        .ok_or_else(|| "CreateSession response missing session_handle".to_string())?;

    if let Ok(mut guard) = CURRENT_SESSION.lock() {
        *guard = Some(session_handle.clone());
    }

    let list_token = next_token("list");
    let list_req_path = predicted_request_path(&connection, &list_token)?;
    let list_responses = subscribe_request_response(&connection, &list_req_path).await?;
    let mut list_opts: HashMap<&str, Value<'_>> = HashMap::new();
    list_opts.insert("handle_token", Value::from(list_token.as_str()));
    let session_obj = ObjectPath::try_from(session_handle.as_str())
        .map_err(|e| format!("Invalid session_handle path: {e}"))?;

    let _: OwnedObjectPath = portal
        .call("ListShortcuts", &(session_obj, list_opts))
        .await
        .map_err(|e| format!("ListShortcuts failed: {e}"))?;

    let (list_code, list_results) = await_request_response(list_responses).await?;
    let has_existing_shortcuts = list_code == 0
        && list_results
            .get("shortcuts")
            .and_then(|val| {
                <Vec<(String, HashMap<String, OwnedValue>)>>::try_from(val.clone()).ok()
            })
            .is_some_and(|list| !list.is_empty());

    if has_existing_shortcuts {
        bind_shortcuts_on_session(&connection, &portal, &session_handle, hotkeys).await?;
    }

    Ok(())
}

pub fn apply_hotkeys(hotkeys: &RuntimeHotkeys) -> Result<(), String> {
    if !is_active() {
        return Ok(());
    }

    let hotkeys = hotkeys.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = apply_hotkeys_async(&hotkeys).await {
            log::warn!("Failed to apply XDG GlobalShortcuts hotkeys: {error}");
        }
    });

    Ok(())
}

async fn close_session(session_path: &str) -> Result<(), String> {
    let connection = ensure_connection().await?;

    let proxy = zbus::Proxy::new(&connection, PORTAL_BUS_NAME, session_path, SESSION_IFACE)
        .await
        .map_err(|e| format!("Failed to create Session proxy: {e}"))?;

    proxy
        .call_method("Close", &())
        .await
        .map_err(|e| format!("Failed to close portal session: {e}"))?;

    Ok(())
}

fn predicted_request_path(
    connection: &zbus::Connection,
    handle_token: &str,
) -> Result<String, String> {
    let unique = connection
        .unique_name()
        .ok_or_else(|| "D-Bus connection has no unique name".to_string())?;
    let sender = unique.as_str().trim_start_matches(':').replace('.', "_");
    Ok(format!(
        "/org/freedesktop/portal/desktop/request/{sender}/{handle_token}"
    ))
}

async fn subscribe_request_response(
    connection: &zbus::Connection,
    request_path: &str,
) -> Result<zbus::proxy::SignalStream<'static>, String> {
    let proxy = zbus::Proxy::new(connection, PORTAL_BUS_NAME, request_path, REQUEST_IFACE)
        .await
        .map_err(|e| format!("Failed to create Request proxy: {e}"))?;

    proxy
        .receive_signal("Response")
        .await
        .map_err(|e| format!("Failed to listen for Request::Response: {e}"))
}

async fn await_request_response(
    mut responses: zbus::proxy::SignalStream<'static>,
) -> Result<(u32, HashMap<String, OwnedValue>), String> {
    let msg = next_stream_item(&mut responses)
        .await
        .ok_or_else(|| "Portal Request::Response stream closed".to_string())?;

    msg.body()
        .deserialize::<(u32, HashMap<String, OwnedValue>)>()
        .map_err(|e| format!("Failed to parse Request::Response: {e}"))
}

async fn bind_shortcuts_on_session(
    connection: &zbus::Connection,
    portal: &zbus::Proxy<'_>,
    session_handle: &str,
    hotkeys: &RuntimeHotkeys,
) -> Result<(), String> {
    let mut shortcuts: Vec<(&str, HashMap<&str, Value<'_>>)> = Vec::new();
    let mut owned_triggers: Vec<(&'static str, &'static str, String)> = Vec::new();

    let action = HotkeyAction::ToggleStartStop;
    let raw = action.shortcut(hotkeys).trim();
    if !raw.is_empty() {
        owned_triggers.push((action.id(), action.title(), to_xdg_trigger(raw)));
    }

    if owned_triggers.is_empty() {
        return Ok(());
    }

    for (id, desc, trigger) in &owned_triggers {
        let mut props: HashMap<&str, Value<'_>> = HashMap::new();
        props.insert("description", Value::from(*desc));
        props.insert("preferred_trigger", Value::from(trigger.as_str()));
        shortcuts.push((*id, props));
    }

    let bind_token = next_token("bind");
    let bind_req_path = predicted_request_path(connection, &bind_token)?;
    let bind_responses = subscribe_request_response(connection, &bind_req_path).await?;
    let mut bind_opts: HashMap<&str, Value<'_>> = HashMap::new();
    bind_opts.insert("handle_token", Value::from(bind_token.as_str()));

    let session_obj = ObjectPath::try_from(session_handle)
        .map_err(|e| format!("Invalid session_handle path: {e}"))?;

    let _: OwnedObjectPath = portal
        .call("BindShortcuts", &(session_obj, shortcuts, "", bind_opts))
        .await
        .map_err(|e| format!("BindShortcuts failed: {e}"))?;

    let (bind_code, _) = await_request_response(bind_responses).await?;
    if bind_code != 0 {
        return Err(
            "Shortcut setup was cancelled. You can enable it in System Settings -> Keyboard -> Shortcuts."
                .to_string(),
        );
    }

    SESSION_BOUND.store(true, Ordering::SeqCst);
    log::info!("XDG GlobalShortcuts bound successfully");
    Ok(())
}

async fn apply_hotkeys_async(hotkeys: &RuntimeHotkeys) -> Result<(), String> {
    SESSION_BOUND.store(false, Ordering::SeqCst);
    let previous = CURRENT_SESSION
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    if let Some(prev_path) = previous {
        let _ = close_session(&prev_path).await;
    }

    let connection = ensure_connection().await?;

    let portal = zbus::Proxy::new(
        &connection,
        PORTAL_BUS_NAME,
        PORTAL_OBJECT_PATH,
        GLOBAL_SHORTCUTS_IFACE,
    )
    .await
    .map_err(|e| format!("Failed to create GlobalShortcuts proxy: {e}"))?;

    let handle_token = next_token("create");
    let session_token = next_token("session");
    let req_path = predicted_request_path(&connection, &handle_token)?;
    let responses = subscribe_request_response(&connection, &req_path).await?;
    let mut create_opts: HashMap<&str, Value<'_>> = HashMap::new();
    create_opts.insert("handle_token", Value::from(handle_token.as_str()));
    create_opts.insert("session_handle_token", Value::from(session_token.as_str()));

    let _: OwnedObjectPath = portal
        .call("CreateSession", &(create_opts,))
        .await
        .map_err(|e| format!("CreateSession failed: {e}"))?;

    let (response_code, results) = await_request_response(responses).await?;
    if response_code != 0 {
        return Err(format!("CreateSession rejected with code {response_code}"));
    }

    let session_handle = results
        .get("session_handle")
        .and_then(|value| <&str>::try_from(value).ok().map(str::to_string))
        .ok_or_else(|| "CreateSession response missing session_handle".to_string())?;

    if let Ok(mut guard) = CURRENT_SESSION.lock() {
        *guard = Some(session_handle.clone());
    }

    bind_shortcuts_on_session(&connection, &portal, &session_handle, hotkeys).await
}

pub async fn configure_shortcuts(hotkeys: &RuntimeHotkeys) -> Result<(), String> {
    if !is_active() {
        return Ok(());
    }

    let existing_session = CURRENT_SESSION.lock().ok().and_then(|guard| guard.clone());

    if SESSION_BOUND.load(Ordering::SeqCst) {
        if let Some(session_handle) = existing_session {
            if PORTAL_VERSION.load(Ordering::Relaxed) >= 2 {
                let connection = ensure_connection().await?;

                let portal = zbus::Proxy::new(
                    &connection,
                    PORTAL_BUS_NAME,
                    PORTAL_OBJECT_PATH,
                    GLOBAL_SHORTCUTS_IFACE,
                )
                .await
                .map_err(|e| format!("Failed to create GlobalShortcuts proxy: {e}"))?;

                let session_obj = ObjectPath::try_from(session_handle.as_str())
                    .map_err(|e| format!("Invalid session_handle path: {e}"))?;
                let token = next_token("configure");
                let mut opts: HashMap<&str, Value<'_>> = HashMap::new();
                opts.insert("handle_token", Value::from(token.as_str()));

                portal
                    .call_noreply("ConfigureShortcuts", &(session_obj, "", opts))
                    .await
                    .map_err(|e| format!("ConfigureShortcuts failed: {e}"))?;
                log::info!("XDG GlobalShortcuts ConfigureShortcuts called");
                return Ok(());
            }
        }
    }

    apply_hotkeys_async(hotkeys).await
}

pub fn to_xdg_trigger(shortcut: &str) -> String {
    let mut modifiers = String::new();
    let mut main_key = String::new();

    for part in shortcut
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers.push_str("<Control>"),
            "shift" => modifiers.push_str("<Shift>"),
            "alt" => modifiers.push_str("<Alt>"),
            "win" | "super" | "meta" => modifiers.push_str("<Super>"),
            _ => {
                main_key = normalize_xdg_key(part);
            }
        }
    }

    format!("{modifiers}{main_key}")
}

fn normalize_xdg_key(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() == 1 {
        return trimmed.to_ascii_lowercase();
    }

    match trimmed.to_ascii_lowercase().as_str() {
        "enter" | "return" => "Return".to_string(),
        "esc" | "escape" => "Escape".to_string(),
        "space" => "space".to_string(),
        "tab" => "Tab".to_string(),
        "backspace" => "BackSpace".to_string(),
        "del" | "delete" => "Delete".to_string(),
        "ins" | "insert" => "Insert".to_string(),
        "home" => "Home".to_string(),
        "end" => "End".to_string(),
        "pgup" | "pageup" => "Page_Up".to_string(),
        "pgdn" | "pagedown" => "Page_Down".to_string(),
        "up" | "arrowup" => "Up".to_string(),
        "down" | "arrowdown" => "Down".to_string(),
        "left" | "arrowleft" => "Left".to_string(),
        "right" | "arrowright" => "Right".to_string(),
        "capslock" => "Caps_Lock".to_string(),
        "numlock" => "Num_Lock".to_string(),
        other if other.starts_with('f') && other[1..].chars().all(|c| c.is_ascii_digit()) => {
            other.to_ascii_uppercase()
        }
        _ => trimmed.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_shortcuts_to_xdg_trigger_format() {
        assert_eq!(to_xdg_trigger("F6"), "F6");
        assert_eq!(to_xdg_trigger("Ctrl+P"), "<Control>p");
        assert_eq!(to_xdg_trigger("Ctrl+Shift+R"), "<Control><Shift>r");
        assert_eq!(to_xdg_trigger("Alt+F1"), "<Alt>F1");
        assert_eq!(to_xdg_trigger("Win+Space"), "<Super>space");
        assert_eq!(to_xdg_trigger("PageUp"), "Page_Up");
    }

    #[test]
    fn maps_shortcut_ids_to_actions() {
        assert_eq!(
            shortcut_id_to_action("toggle_start_stop"),
            Some(HotkeyAction::ToggleStartStop)
        );
        assert_eq!(
            shortcut_id_to_action("pick_position"),
            Some(HotkeyAction::PickPosition)
        );
        assert_eq!(
            shortcut_id_to_action("toggle_macro_recording"),
            Some(HotkeyAction::ToggleMacroRecording)
        );
        assert_eq!(shortcut_id_to_action("unknown"), None);
    }
}
