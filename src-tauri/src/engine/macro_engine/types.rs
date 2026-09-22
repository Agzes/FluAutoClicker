use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MacroMouseButton {
    Left,
    Middle,
    Right,
    Front,
    Back,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MacroMouseAction {
    Press,
    Hold { duration_ms: u32 },
    Down,
    Up,
}

pub fn default_mouse_clicks() -> u8 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MacroMoveStyle {
    Instant,
    Linear {
        duration_ms: u32,
    },
    Smooth {
        path: Vec<(i32, i32)>,
        duration_ms: u32,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MacroActionConfig {
    Mouse {
        button: MacroMouseButton,
        action: MacroMouseAction,
        position: Option<(i32, i32)>,
        #[serde(default = "default_mouse_clicks")]
        clicks: u8,
    },
    Move {
        x: i32,
        y: i32,
        style: MacroMoveStyle,
    },
    Keyboard {
        key: String,
        #[serde(default)]
        text: Option<String>,
        modifiers: Vec<String>,
        action: MacroKeyboardAction,
    },
    Sleep {
        duration_ms: u32,
    },
    Scroll {
        clicks: i32,
    },
    RawMove {
        points: Vec<(i32, i32, u64)>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MacroKeyboardAction {
    Press,
    Hold { duration_ms: u32 },
    Down,
    Up,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MacroAction {
    pub id: u64,
    #[serde(default)]
    pub timestamp_ms: u64,
    pub config: MacroActionConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub enum MacroRepeatMode {
    #[default]
    Infinite,
    FiniteTimes {
        count: u32,
    },
    FiniteSeconds {
        duration_ms: u64,
    },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum MacroRecordMouseMovesMode {
    Off,
    #[default]
    Instant,
    Linear,
    Smooth,
    Raw,
}

fn deserialize_mouse_moves<'de, D>(deserializer: D) -> Result<MacroRecordMouseMovesMode, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct MouseMovesVisitor;

    impl<'de> serde::de::Visitor<'de> for MouseMovesVisitor {
        type Value = MacroRecordMouseMovesMode;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a boolean or a string (off, instant, linear, smooth)")
        }

        fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            if value {
                Ok(MacroRecordMouseMovesMode::Instant)
            } else {
                Ok(MacroRecordMouseMovesMode::Off)
            }
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            match value.to_lowercase().as_str() {
                "off" | "false" => Ok(MacroRecordMouseMovesMode::Off),
                "instant" | "true" | "on" => Ok(MacroRecordMouseMovesMode::Instant),
                "linear" => Ok(MacroRecordMouseMovesMode::Linear),
                "smooth" => Ok(MacroRecordMouseMovesMode::Smooth),
                "raw" => Ok(MacroRecordMouseMovesMode::Raw),
                _ => Ok(MacroRecordMouseMovesMode::Off),
            }
        }
    }

    deserializer.deserialize_any(MouseMovesVisitor)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct MacroRecordingOptions {
    pub record_mouse_clicks: bool,
    #[serde(deserialize_with = "deserialize_mouse_moves")]
    pub record_mouse_moves: MacroRecordMouseMovesMode,
    pub record_keyboard: bool,
    pub record_delays: bool,
    pub record_click_position: bool,
    pub record_live_preview: bool,
}

impl Default for MacroRecordingOptions {
    fn default() -> Self {
        Self {
            record_mouse_clicks: true,
            record_mouse_moves: MacroRecordMouseMovesMode::Instant,
            record_keyboard: true,
            record_delays: true,
            record_click_position: true,
            record_live_preview: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub enum MacroPlayerState {
    #[default]
    Stopped,
    Playing,
    Recording,
}
