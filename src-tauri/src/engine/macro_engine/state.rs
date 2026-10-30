use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex;

use super::recording::MacroRecordingContext;
use super::types::{MacroAction, MacroPlayerState, MacroRecordingOptions, MacroRepeatMode};

pub const MAX_MACRO_ACTIONS: usize = 10_000;

#[derive(Clone)]

pub struct MacroEngineState {
    pub actions: Arc<Mutex<Vec<MacroAction>>>,

    pub repeat_mode: Arc<Mutex<MacroRepeatMode>>,

    pub player_state: Arc<Mutex<MacroPlayerState>>,

    pub cancel_playback: Arc<AtomicBool>,

    pub action_id_counter: Arc<AtomicU64>,

    pub recording_active: Arc<AtomicBool>,

    pub recording_supported: Arc<AtomicBool>,

    pub recording_error: Arc<StdMutex<Option<String>>>,

    pub recording_context: Arc<StdMutex<MacroRecordingContext>>,

    pub recording_options: Arc<Mutex<MacroRecordingOptions>>,

    pub speed_multiplier: Arc<Mutex<f64>>,
}

impl Default for MacroEngineState {
    fn default() -> Self {
        Self {
            actions: Arc::new(Mutex::new(Vec::new())),
            repeat_mode: Arc::new(Mutex::new(MacroRepeatMode::default())),
            player_state: Arc::new(Mutex::new(MacroPlayerState::Stopped)),
            cancel_playback: Arc::new(AtomicBool::new(false)),
            action_id_counter: Arc::new(AtomicU64::new(1)),
            recording_active: Arc::new(AtomicBool::new(false)),
            recording_supported: Arc::new(AtomicBool::new(true)),
            recording_error: Arc::new(StdMutex::new(None)),
            recording_context: Arc::new(StdMutex::new(MacroRecordingContext::default())),
            recording_options: Arc::new(Mutex::new(MacroRecordingOptions::default())),
            speed_multiplier: Arc::new(Mutex::new(1.0)),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct MacroFile {
    pub version: u32,
    pub repeat_mode: MacroRepeatMode,
    #[serde(default)]
    pub recording_options: MacroRecordingOptions,
    pub actions: Vec<MacroAction>,
}

impl MacroFile {
    pub const CURRENT_VERSION: u32 = 2;

    pub fn new(
        actions: Vec<MacroAction>,
        repeat_mode: MacroRepeatMode,
        recording_options: MacroRecordingOptions,
    ) -> Self {
        Self {
            version: Self::CURRENT_VERSION,
            actions,
            repeat_mode,
            recording_options,
        }
    }

    pub fn migrate(mut self) -> Self {
        if self.actions.len() > MAX_MACRO_ACTIONS {
            log::warn!(
                "Truncating macro from {} to {} actions",
                self.actions.len(),
                MAX_MACRO_ACTIONS
            );
            self.actions.truncate(MAX_MACRO_ACTIONS);
        }
        if self.version >= Self::CURRENT_VERSION {
            return self;
        }

        let from_version = self.version;
        if self.version == 1 {
            for action in &mut self.actions {
                action.timestamp_ms = 0;
            }
        }
        self.version = Self::CURRENT_VERSION;
        log::info!("Migrated macro from v{from_version} to v{}", self.version);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::macro_engine::types::MacroActionConfig;

    #[test]
    fn macro_migration_truncates_oversized_action_lists() {
        let actions = (0..(MAX_MACRO_ACTIONS + 5))
            .map(|id| MacroAction {
                id: id as u64,
                timestamp_ms: 0,
                config: MacroActionConfig::Sleep { duration_ms: 1 },
            })
            .collect();

        let migrated = MacroFile {
            version: MacroFile::CURRENT_VERSION,
            repeat_mode: MacroRepeatMode::default(),
            recording_options: MacroRecordingOptions::default(),
            actions,
        }
        .migrate();

        assert_eq!(migrated.actions.len(), MAX_MACRO_ACTIONS);
    }
}
