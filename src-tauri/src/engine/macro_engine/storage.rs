use serde_json;
use std::path::PathBuf;
use tokio::fs;

use super::state::MacroFile;
use super::types::{MacroAction, MacroRecordingOptions, MacroRepeatMode};

fn get_macro_file_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FluAutoClicker");

    config_dir.join("macro.json")
}

pub async fn save_macro(
    actions: &[MacroAction],
    repeat_mode: &MacroRepeatMode,
    recording_options: &MacroRecordingOptions,
) -> Result<(), String> {
    let file_path = get_macro_file_path();

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let macro_file = MacroFile::new(
        actions.to_vec(),
        repeat_mode.clone(),
        recording_options.clone(),
    );

    let json = serde_json::to_string_pretty(&macro_file)
        .map_err(|e| format!("Failed to serialize macro: {}", e))?;

    fs::write(&file_path, json)
        .await
        .map_err(|e| format!("Failed to write macro file: {}", e))?;

    Ok(())
}

pub async fn load_macro(
) -> Result<(Vec<MacroAction>, MacroRepeatMode, MacroRecordingOptions), String> {
    let file_path = get_macro_file_path();

    if !file_path.exists() {
        return Ok((
            Vec::new(),
            MacroRepeatMode::Infinite,
            MacroRecordingOptions::default(),
        ));
    }

    let json = fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("Failed to read macro file: {}", e))?;

    match serde_json::from_str::<serde_json::Value>(&json) {
        Ok(value) => {
            let version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            if version < MacroFile::CURRENT_VERSION {
                log::info!("Backing up legacy macro file (version {version}) before migration");
                crate::engine::config_store::backup_raw_config_file(
                    &format!("macro_v{version}"),
                    json.as_bytes(),
                )
                .await;
            }
        }
        Err(_) => {
            log::warn!("Macro file is not valid JSON, backing up corrupt file");
            crate::engine::config_store::backup_raw_config_file("macro_corrupt", json.as_bytes())
                .await;
        }
    }

    let macro_file: MacroFile =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse macro file: {}", e))?;

    let macro_file = macro_file.migrate();

    Ok((
        macro_file.actions,
        macro_file.repeat_mode,
        macro_file.recording_options,
    ))
}
