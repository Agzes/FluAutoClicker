use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32};
#[cfg(target_os = "linux")]
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::Instant;
use tokio::sync::Mutex;

#[cfg(target_os = "linux")]
use evdev::uinput::VirtualDevice;
#[cfg(target_os = "linux")]
use evdev::Key;

use super::macro_engine::state::MacroEngineState;

#[derive(Clone, Copy, Default, PartialEq)]
pub enum MouseButton {
    #[default]
    Left,
    Middle,
    Right,
    Front,
    Back,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum ClickMode {
    #[default]
    Press,
    Hold,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum ClickType {
    #[default]
    Single,
    Double,
    Triple,
}

impl ClickType {
    pub fn clicks_per_cycle(self) -> u32 {
        match self {
            ClickType::Single => 1,
            ClickType::Double => 2,
            ClickType::Triple => 3,
        }
    }
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum RepeatMode {
    #[default]
    Infinite,
    Finite,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum RepeatUnit {
    #[default]
    Times,
    Seconds,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum PositionMode {
    #[default]
    Current,
    Custom,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum HoldUnit {
    #[default]
    Milliseconds,
    Seconds,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum JigglerPattern {
    #[default]
    Random,

    Linear,

    Circle,

    OZone,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum KeyboardModifier {
    #[default]
    None,
    Ctrl,
    Shift,
    Alt,
    Win,
    CtrlShift,
    CtrlAlt,
    CtrlWin,
    ShiftAlt,
    ShiftWin,
    AltWin,
    CtrlShiftAlt,
    CtrlShiftWin,
    CtrlAltWin,
    ShiftAltWin,
    CtrlShiftAltWin,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RuntimeHotkeys {
    pub toggle_start_stop: String,
    pub pick_position: String,
    pub toggle_macro_recording: String,
}

impl Default for RuntimeHotkeys {
    fn default() -> Self {
        Self {
            toggle_start_stop: "F6".to_string(),
            pick_position: "Ctrl+P".to_string(),
            toggle_macro_recording: "Ctrl+Shift+R".to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HotkeyAction {
    ToggleStartStop,
    PickPosition,
    ToggleMacroRecording,
}

impl HotkeyAction {
    pub const ALL: [HotkeyAction; 3] = [
        HotkeyAction::ToggleStartStop,
        HotkeyAction::PickPosition,
        HotkeyAction::ToggleMacroRecording,
    ];

    #[cfg(target_os = "linux")]
    pub fn id(self) -> &'static str {
        match self {
            HotkeyAction::ToggleStartStop => "toggle_start_stop",
            HotkeyAction::PickPosition => "pick_position",
            HotkeyAction::ToggleMacroRecording => "toggle_macro_recording",
        }
    }

    #[cfg(target_os = "linux")]
    pub fn title(self) -> &'static str {
        match self {
            HotkeyAction::ToggleStartStop => "Toggle Start/Stop",
            HotkeyAction::PickPosition => "Pick Position",
            HotkeyAction::ToggleMacroRecording => "Macro Recording",
        }
    }

    pub fn shortcut(self, hotkeys: &RuntimeHotkeys) -> &str {
        match self {
            HotkeyAction::ToggleStartStop => hotkeys.toggle_start_stop.as_str(),
            HotkeyAction::PickPosition => hotkeys.pick_position.as_str(),
            HotkeyAction::ToggleMacroRecording => hotkeys.toggle_macro_recording.as_str(),
        }
    }
}

pub struct ToggleHotkeyPressState {
    pub started_at: Instant,
    pub was_running_before_press: bool,
    pub mode: String,
}

impl KeyboardModifier {
    #[cfg(target_os = "linux")]
    pub fn to_keys(self) -> Vec<Key> {
        let mut keys = Vec::new();

        if self.has_ctrl() {
            keys.push(Key::KEY_LEFTCTRL);
        }
        if self.has_alt() {
            keys.push(Key::KEY_LEFTALT);
        }
        if self.has_shift() {
            keys.push(Key::KEY_LEFTSHIFT);
        }
        if self.has_win() {
            keys.push(Key::KEY_LEFTMETA);
        }

        keys
    }

    pub fn has_ctrl(&self) -> bool {
        matches!(
            self,
            KeyboardModifier::Ctrl
                | KeyboardModifier::CtrlShift
                | KeyboardModifier::CtrlAlt
                | KeyboardModifier::CtrlWin
                | KeyboardModifier::CtrlShiftAlt
                | KeyboardModifier::CtrlShiftWin
                | KeyboardModifier::CtrlAltWin
                | KeyboardModifier::CtrlShiftAltWin
        )
    }

    pub fn has_alt(&self) -> bool {
        matches!(
            self,
            KeyboardModifier::Alt
                | KeyboardModifier::CtrlAlt
                | KeyboardModifier::ShiftAlt
                | KeyboardModifier::AltWin
                | KeyboardModifier::CtrlShiftAlt
                | KeyboardModifier::CtrlAltWin
                | KeyboardModifier::ShiftAltWin
                | KeyboardModifier::CtrlShiftAltWin
        )
    }

    pub fn has_shift(&self) -> bool {
        matches!(
            self,
            KeyboardModifier::Shift
                | KeyboardModifier::CtrlShift
                | KeyboardModifier::ShiftAlt
                | KeyboardModifier::ShiftWin
                | KeyboardModifier::CtrlShiftAlt
                | KeyboardModifier::CtrlShiftWin
                | KeyboardModifier::ShiftAltWin
                | KeyboardModifier::CtrlShiftAltWin
        )
    }

    pub fn has_win(&self) -> bool {
        matches!(
            self,
            KeyboardModifier::Win
                | KeyboardModifier::CtrlWin
                | KeyboardModifier::ShiftWin
                | KeyboardModifier::AltWin
                | KeyboardModifier::CtrlShiftWin
                | KeyboardModifier::CtrlAltWin
                | KeyboardModifier::ShiftAltWin
                | KeyboardModifier::CtrlShiftAltWin
        )
    }

    pub fn from_str(s: &str) -> Self {
        let mut ctrl = false;
        let mut alt = false;
        let mut shift = false;
        let mut win = false;

        for part in s.to_lowercase().split('+').map(str::trim) {
            match part {
                "ctrl" | "control" => ctrl = true,
                "alt" => alt = true,
                "shift" => shift = true,
                "win" | "meta" | "super" => win = true,
                "none" | "" => {}
                _ => return KeyboardModifier::None,
            }
        }

        match (ctrl, alt, shift, win) {
            (false, false, false, false) => KeyboardModifier::None,
            (true, false, false, false) => KeyboardModifier::Ctrl,
            (false, false, true, false) => KeyboardModifier::Shift,
            (false, true, false, false) => KeyboardModifier::Alt,
            (false, false, false, true) => KeyboardModifier::Win,
            (true, false, true, false) => KeyboardModifier::CtrlShift,
            (true, true, false, false) => KeyboardModifier::CtrlAlt,
            (true, false, false, true) => KeyboardModifier::CtrlWin,
            (false, true, true, false) => KeyboardModifier::ShiftAlt,
            (false, false, true, true) => KeyboardModifier::ShiftWin,
            (false, true, false, true) => KeyboardModifier::AltWin,
            (true, true, true, false) => KeyboardModifier::CtrlShiftAlt,
            (true, false, true, true) => KeyboardModifier::CtrlShiftWin,
            (true, true, false, true) => KeyboardModifier::CtrlAltWin,
            (false, true, true, true) => KeyboardModifier::ShiftAltWin,
            (true, true, true, true) => KeyboardModifier::CtrlShiftAltWin,
        }
    }

    #[allow(dead_code)]
    pub fn to_display_string(self) -> String {
        match self {
            KeyboardModifier::None => "".to_string(),
            KeyboardModifier::Ctrl => "Ctrl".to_string(),
            KeyboardModifier::Shift => "Shift".to_string(),
            KeyboardModifier::Alt => "Alt".to_string(),
            KeyboardModifier::Win => "Win".to_string(),
            KeyboardModifier::CtrlShift => "Ctrl+Shift".to_string(),
            KeyboardModifier::CtrlAlt => "Ctrl+Alt".to_string(),
            KeyboardModifier::CtrlWin => "Ctrl+Win".to_string(),
            KeyboardModifier::ShiftAlt => "Shift+Alt".to_string(),
            KeyboardModifier::ShiftWin => "Shift+Win".to_string(),
            KeyboardModifier::AltWin => "Alt+Win".to_string(),
            KeyboardModifier::CtrlShiftAlt => "Ctrl+Shift+Alt".to_string(),
            KeyboardModifier::CtrlShiftWin => "Ctrl+Shift+Win".to_string(),
            KeyboardModifier::CtrlAltWin => "Ctrl+Alt+Win".to_string(),
            KeyboardModifier::ShiftAltWin => "Shift+Alt+Win".to_string(),
            KeyboardModifier::CtrlShiftAltWin => "Ctrl+Shift+Alt+Win".to_string(),
        }
    }
}

pub struct AppState {
    pub is_running: AtomicBool,
    pub is_main_focused: AtomicBool,
    pub is_cps_test_focused: AtomicBool,
    pub is_jiggler_active: AtomicBool,
    pub minimize_to_tray: AtomicBool,
    pub is_quitting: AtomicBool,
    pub stop_on_custom_position_move: AtomicBool,
    pub acrylic_enabled: AtomicBool,
    pub cps: AtomicU32,
    pub jiggler_distance: AtomicU32,
    pub jiggler_interval: AtomicU32,
    pub jiggler_pattern: Mutex<JigglerPattern>,
    pub ozone_anchor_ready: AtomicBool,
    pub ozone_wait_for_click_anchor: AtomicBool,
    pub ozone_center_x: AtomicI32,
    pub ozone_center_y: AtomicI32,
    pub hotkeys: Mutex<RuntimeHotkeys>,
    pub active_mode: StdMutex<String>,
    pub hotkeys_suspended: AtomicBool,
    pub toggle_hotkey_press_state: StdMutex<Option<ToggleHotkeyPressState>>,

    pub mouse_button: Mutex<MouseButton>,
    pub click_mode: Mutex<ClickMode>,
    pub click_type: Mutex<ClickType>,
    pub hold_duration: AtomicU32,
    pub hold_unit: Mutex<HoldUnit>,
    pub repeat_mode: Mutex<RepeatMode>,
    pub repeat_count: AtomicU32,
    pub repeat_unit: Mutex<RepeatUnit>,
    pub position_mode: Mutex<PositionMode>,
    pub coord_x: AtomicI32,
    pub coord_y: AtomicI32,
    pub variation_ms: AtomicU32,

    pub keyboard_key: Mutex<String>,
    pub keyboard_modifiers: Mutex<KeyboardModifier>,
    pub kb_click_mode: Mutex<ClickMode>,
    pub kb_hold_duration: AtomicU32,
    pub kb_hold_unit: Mutex<HoldUnit>,
    pub kb_repeat_mode: Mutex<RepeatMode>,
    pub kb_repeat_count: AtomicU32,
    pub kb_repeat_unit: Mutex<RepeatUnit>,
    pub kb_is_running: AtomicBool,
    pub kb_cps: AtomicU32,
    pub kb_interval_ms: AtomicU32,
    pub kb_variation_ms: AtomicU32,

    #[cfg(target_os = "linux")]
    pub keyboard_uinput_device: Arc<Mutex<Option<VirtualDevice>>>,

    #[cfg(target_os = "linux")]
    pub uinput_device: Arc<Mutex<Option<VirtualDevice>>>,

    pub macro_engine: MacroEngineState,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            is_main_focused: AtomicBool::new(true),
            is_cps_test_focused: AtomicBool::new(false),
            is_jiggler_active: AtomicBool::new(false),
            minimize_to_tray: AtomicBool::new(true),
            is_quitting: AtomicBool::new(false),
            stop_on_custom_position_move: AtomicBool::new(true),
            acrylic_enabled: AtomicBool::new(false),
            cps: AtomicU32::new(10),
            jiggler_distance: AtomicU32::new(10),
            jiggler_interval: AtomicU32::new(1000),
            jiggler_pattern: Mutex::new(JigglerPattern::Random),
            ozone_anchor_ready: AtomicBool::new(false),
            ozone_wait_for_click_anchor: AtomicBool::new(false),
            ozone_center_x: AtomicI32::new(0),
            ozone_center_y: AtomicI32::new(0),
            hotkeys: Mutex::new(RuntimeHotkeys::default()),
            active_mode: StdMutex::new("mouse".to_string()),
            hotkeys_suspended: AtomicBool::new(false),
            toggle_hotkey_press_state: StdMutex::new(None),

            mouse_button: Mutex::new(MouseButton::Left),
            click_mode: Mutex::new(ClickMode::Press),
            click_type: Mutex::new(ClickType::Single),
            hold_duration: AtomicU32::new(100),
            hold_unit: Mutex::new(HoldUnit::Milliseconds),
            repeat_mode: Mutex::new(RepeatMode::Infinite),
            repeat_count: AtomicU32::new(10),
            repeat_unit: Mutex::new(RepeatUnit::Times),
            position_mode: Mutex::new(PositionMode::Current),
            coord_x: AtomicI32::new(841),
            coord_y: AtomicI32::new(425),
            variation_ms: AtomicU32::new(0),

            keyboard_key: Mutex::new("a".to_string()),
            keyboard_modifiers: Mutex::new(KeyboardModifier::None),
            kb_click_mode: Mutex::new(ClickMode::Press),
            kb_hold_duration: AtomicU32::new(100),
            kb_hold_unit: Mutex::new(HoldUnit::Milliseconds),
            kb_repeat_mode: Mutex::new(RepeatMode::Infinite),
            kb_repeat_count: AtomicU32::new(10),
            kb_repeat_unit: Mutex::new(RepeatUnit::Times),
            kb_is_running: AtomicBool::new(false),
            kb_cps: AtomicU32::new(10),
            kb_interval_ms: AtomicU32::new(100),
            kb_variation_ms: AtomicU32::new(0),

            #[cfg(target_os = "linux")]
            keyboard_uinput_device: Arc::new(Mutex::new(None)),

            #[cfg(target_os = "linux")]
            uinput_device: Arc::new(Mutex::new(None)),

            macro_engine: MacroEngineState::default(),
        }
    }
}
