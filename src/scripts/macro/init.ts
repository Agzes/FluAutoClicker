import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { closeDrawer, openDrawer } from "../drawer";
import { notify } from "../notifications";
import { createSlideIndicator } from "../utils";
import { t } from "../i18n";
import { toBackendConfig } from "./backend";
import { applyMouseButtonSupport, gatherConfig, generateConfigUi, setupConfigListeners } from "./config-ui";
import { initRecordingSettingsUi, syncRecordingOptionsToUi, applyRecordAvailability, setMacroRecordingState } from "./recording";
import { applyRepeatModeToUi, initRepeatSettingsListeners } from "./repeat";
import { renderActions, loadActionsFromBackend, updateCurrentActionHighlight } from "./render";
import { macroState } from "./state";
import type { MacroActionType, MacroCapabilities, MacroRecordingOptions, MacroRepeatState } from "./types";

let macroReadyPromise: Promise<void> | null = null;

function initRecordButton(recordButton: HTMLElement | null) {
    if (!recordButton) {
        return;
    }

    recordButton.addEventListener("click", async () => {
        if (!macroState.capabilities.recording_supported) {
            notify(
                macroState.capabilities.recording_reason || t("macro.recording_unavailable", "Live macro recording is not available on this system."),
                "warning",
                3600
            );
            return;
        }

        const playerState = await invoke<string>("get_macro_player_state");
        try {
            if (playerState === "recording") {
                await invoke("stop_macro_recording");
                notify(t("macro.recording_stopped", "Macro recording stopped"), "info", 1800);
            } else {
                await invoke("start_macro_recording");
                notify(t("macro.recording_started", "Recording started. New actions will be added to this macro."), "success", 2600);
            }
        } catch (error) {
            notify(error instanceof Error ? error.message : String(error), "error", 3200);
        }
    });
}

function initAddActionDrawer() {
    const addButton = document.getElementById("macro-add-btn");
    const selectionView = document.getElementById("macro-add-selection-view");
    const configView = document.getElementById("macro-config-view");
    const configContent = document.getElementById("macro-config-content");
    const configTitle = document.getElementById("macro-config-title");
    const saveButton = document.getElementById("macro-config-save");
    const backButton = document.getElementById("macro-config-back");

    if (!addButton || !selectionView || !configView || !configContent || !configTitle) {
        return;
    }

    let currentType: MacroActionType | null = null;
    let editingActionId: number | null = null;

    const showSelectionView = () => {
        selectionView.style.display = "flex";
        selectionView.classList.remove("view-fade-in");
        void selectionView.offsetWidth;
        selectionView.classList.add("view-fade-in");
        configView.style.display = "none";
    };

    addButton.addEventListener("click", () => {
        editingActionId = null;
        showSelectionView();
        openDrawer("section-macro-add", t("macro.drawer.add_title", "Add Macro Action"), "&#58490;");
    });

    document.querySelectorAll(".macro-add-item-trigger").forEach((trigger) => {
        trigger.addEventListener("click", () => {
            const actionType = trigger.getAttribute("data-action");
            if (!actionType || !["mouse", "move", "keyboard", "sleep", "scroll"].includes(actionType)) {
                return;
            }

            currentType = actionType as MacroActionType;
            selectionView.style.display = "none";
            configView.style.display = "flex";
            configView.classList.remove("view-fade-in");
            void configView.offsetWidth;
            configView.classList.add("view-fade-in");

            configTitle.textContent = t("macro.configure_action", "Configure {type} Action", { type: currentType.charAt(0).toUpperCase() + currentType.slice(1) });
            configContent.innerHTML = generateConfigUi(currentType);
            applyMouseButtonSupport(configContent);
            setupConfigListeners(currentType, configContent);

            window.setTimeout(() => {
                configContent.querySelectorAll(".toggle-row, .multi-button-row").forEach((row) => {
                    const activeButton = row.querySelector<HTMLElement>(".active");
                    if (!activeButton) {
                        return;
                    }

                    createSlideIndicator(row, activeButton, true);
                    if (activeButton.dataset.value === "hold") {
                        row.parentElement?.querySelector(".expandable-content")?.classList.add("expanded");
                    }
                    if (activeButton.dataset.value === "custom") {
                        document.getElementById("cfg-mouse-coord-section")?.classList.add("expanded");
                    }
                });
            }, 50);
        });
    });

    window.addEventListener("flu:edit-macro-action", (event: Event) => {
        const detail = (event as CustomEvent<{ actionId: number }>).detail;
        const actionId = detail.actionId;

        const rawAction = macroState.rawActions?.find((a) => Number(a.id) === actionId);
        if (!rawAction || !rawAction.config?.type) {
            return;
        }

        editingActionId = actionId;
        currentType = rawAction.config.type;

        selectionView.style.display = "none";
        configView.style.display = "flex";
        configView.classList.remove("view-fade-in");
        void configView.offsetWidth;
        configView.classList.add("view-fade-in");

        configTitle.textContent = t("macro.configure_action", "Configure {type} Action", { type: currentType.charAt(0).toUpperCase() + currentType.slice(1) });
        configContent.innerHTML = generateConfigUi(currentType);
        applyMouseButtonSupport(configContent);
        setupConfigListeners(currentType, configContent, rawAction.config);

        openDrawer("section-macro-add", t("macro.drawer.edit_title", "Edit Macro Action"), "&#57714;");

        window.setTimeout(() => {
            configContent.querySelectorAll(".toggle-row, .multi-button-row").forEach((row) => {
                const activeButton = row.querySelector<HTMLElement>(".active");
                if (!activeButton) {
                    return;
                }

                createSlideIndicator(row, activeButton, true);
                if (activeButton.dataset.value === "hold") {
                    row.parentElement?.querySelector(".expandable-content")?.classList.add("expanded");
                }
                if (activeButton.dataset.value === "custom") {
                    document.getElementById("cfg-mouse-coord-section")?.classList.add("expanded");
                }
            });
        }, 50);
    });

    backButton?.addEventListener("click", showSelectionView);

    saveButton?.addEventListener("click", async () => {
        if (!currentType) {
            return;
        }

        const draft = gatherConfig(currentType);
        const payload = toBackendConfig(currentType, draft);
        if (!payload) {
            return;
        }

        try {
            const actionJson = JSON.stringify(payload);
            if (editingActionId !== null) {
                await invoke("update_macro_action", { actionId: editingActionId, action_id: editingActionId, actionJson, action_json: actionJson });
                await loadActionsFromBackend({ animateNew: false });
                notify(t("macro.action_updated", "Macro action updated"), "success", 1800);
            } else {
                await invoke("add_macro_action", { actionJson, action_json: actionJson });
                await loadActionsFromBackend({ animateNew: true });
                notify(t("macro.action_added", "Macro action added"), "success", 1800);
            }
            closeDrawer();
        } catch (error) {
            console.error("Failed to save macro action", error);
            notify(t("macro.action_save_error", "Could not save this macro action. Check the values and try again."), "error", 2600);
        }
    });
}

function initClearButton(recordButton: HTMLElement | null) {
    document.getElementById("macro-clear-btn")?.addEventListener("click", async () => {
        try {
            await invoke("clear_macros");
            macroState.actions = [];
            macroState.rawActions = [];
            renderActions();
            setMacroRecordingState(recordButton, false);
            notify(t("macro.cleared", "Macro cleared"), "info", 1800);
        } catch (error) {
            console.error("Failed to clear macros", error);
            notify(t("macro.clear_error", "Could not clear the macro. Try again in a moment."), "error", 2600);
        }
    });
}

async function loadCapabilities(recordButton: HTMLElement | null) {
    macroState.capabilities = await invoke<MacroCapabilities>("get_macro_capabilities");
    applyRecordAvailability(recordButton);
}

async function loadRecordingOptions() {
    macroState.recordingOptions = await invoke<MacroRecordingOptions>("get_macro_recording_options");
    syncRecordingOptionsToUi();
}

async function loadMacroState(recordButton: HTMLElement | null) {
    const state = await invoke<MacroRepeatState>("load_macro");
    applyRepeatModeToUi(state.repeat_mode);
    await loadActionsFromBackend();
    const playerState = await invoke<string>("get_macro_player_state");
    setMacroRecordingState(recordButton, playerState === "recording");
}

function applyImportedMacroSettings(payload: unknown) {
    const config = payload as { macro_settings?: { repeat_mode?: string; repeat_count?: number; repeat_duration_ms?: number } };
    const settings = config.macro_settings;
    if (!settings) {
        return;
    }

    if (settings.repeat_mode === "finite_times") {
        applyRepeatModeToUi(`finite_times_${settings.repeat_count || 1}`);
    } else if (settings.repeat_mode === "finite_seconds") {
        applyRepeatModeToUi(`finite_seconds_${settings.repeat_duration_ms || 1000}`);
    } else {
        applyRepeatModeToUi("infinite");
    }
}

function initMacroEventListeners(recordButton: HTMLElement | null) {
    void listen<{ action_id?: unknown }>("macro-step-changed", (event) => {
        const rawId = event.payload?.action_id;
        if (rawId === null || rawId === undefined) {
            macroState.currentPlayingActionId = null;
        } else {
            const parsed = Number(rawId);
            macroState.currentPlayingActionId = Number.isFinite(parsed) ? parsed : null;
        }

        if ((window as any).flu_window_hidden) {
            return;
        }

        updateCurrentActionHighlight();
    });

    void listen<{ state?: string }>("macro-status-changed", (event) => {
        const state = String(event.payload?.state || "");
        setMacroRecordingState(recordButton, state === "recording");
        if (state === "stopped" || state === "error") {
            macroState.currentPlayingActionId = null;
            updateCurrentActionHighlight();
        }
    });

    void listen("macro-actions-changed", () => {
        void loadActionsFromBackend({ animateNew: true }).catch((error) => {
            console.error("Failed to refresh macro actions", error);
        });
    });

    window.addEventListener("flu:settings-applied", (event) => {
        applyImportedMacroSettings((event as CustomEvent<unknown>).detail);
        void Promise.all([
            loadRecordingOptions(),
            loadActionsFromBackend(),
        ]).catch((error) => {
            console.error("Failed to refresh imported macro settings", error);
        });
    });

    window.addEventListener("flu:window-restored", () => {
        updateCurrentActionHighlight();
    });

    void listen<{ supported?: boolean; reason?: string | null }>("macro-recording-availability", (event) => {
        macroState.capabilities = {
            ...macroState.capabilities,
            recording_supported: Boolean(event.payload?.supported),
            recording_reason: event.payload?.reason ? String(event.payload.reason) : null,
        };

        applyRecordAvailability(recordButton);
        if (!macroState.capabilities.recording_supported && macroState.capabilities.recording_reason) {
            notify(macroState.capabilities.recording_reason, "warning", 4200);
        }
    });
}

function initSpeedMultiplierUi() {
    const speedToggle = document.getElementById("macro-speed-toggle");
    const customWrapper = document.getElementById("macro-custom-speed-wrapper");
    const customValueInput = document.getElementById("macro-custom-speed-value") as HTMLInputElement | null;

    if (!speedToggle) return;

    const updateSpeed = async (presetVal: string) => {
        let multiplier: number;
        if (presetVal === "custom") {
            if (customWrapper) {
                customWrapper.classList.remove("disabled");
                if (customValueInput) customValueInput.disabled = false;
            }
            multiplier = parseFloat(customValueInput?.value || "2.0") || 1.0;
        } else {
            if (customWrapper) {
                customWrapper.classList.add("disabled");
                if (customValueInput) customValueInput.disabled = true;
            }
            multiplier = parseFloat(presetVal) || 1.0;
        }

        try {
            await invoke("set_macro_speed_multiplier", { multiplier });
            (window as any).flu_macro_speed_multiplier = multiplier;
            renderActions();
        } catch (error) {
            console.error("Failed to set speed multiplier", error);
        }
    };

    speedToggle.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest(".toggle-option") as HTMLElement | null;
        if (!button) return;

        speedToggle.querySelectorAll(".toggle-option").forEach((entry) => entry.classList.remove("active"));
        button.classList.add("active");
        createSlideIndicator(speedToggle, button);

        const val = button.dataset.value || "1";
        void updateSpeed(val);
    });

    customValueInput?.addEventListener("input", () => {
        const val = speedToggle.querySelector(".toggle-option.active")?.getAttribute("data-value");
        if (val === "custom") {
            void updateSpeed("custom");
        }
    });

    void invoke<number>("get_macro_speed_multiplier").then((multiplier) => {
        (window as any).flu_macro_speed_multiplier = multiplier;
        const presets = ["1", "2", "5", "10", "100"];
        const presetStr = String(multiplier);
        let activeBtn: HTMLElement | null;
        if (presets.includes(presetStr)) {
            activeBtn = speedToggle.querySelector(`.toggle-option[data-value="${presetStr}"]`);
            if (customWrapper) {
                customWrapper.classList.add("disabled");
                if (customValueInput) customValueInput.disabled = true;
            }
        } else {
            activeBtn = speedToggle.querySelector('.toggle-option[data-value="custom"]');
            if (customValueInput) {
                customValueInput.value = presetStr;
                customValueInput.disabled = false;
            }
            if (customWrapper) {
                customWrapper.classList.remove("disabled");
            }
        }

        if (activeBtn) {
            speedToggle.querySelectorAll(".toggle-option").forEach((entry) => entry.classList.remove("active"));
            activeBtn.classList.add("active");
            createSlideIndicator(speedToggle, activeBtn, true);
        }
    }).catch((error) => {
        console.error("Failed to load speed multiplier", error);
    });
}

export function initMacro() {
    const recordButton = document.getElementById("macro-record-btn");

    initRecordingSettingsUi();

    document.getElementById("macro-record-settings-btn")?.addEventListener("click", () => {
        openDrawer("section-macro-recording", t("macro.drawer.recording_title", "Recording Filters"), "&#58700;");
        syncRecordingOptionsToUi();
    });

    initRecordButton(recordButton);
    initAddActionDrawer();
    initClearButton(recordButton);
    initRepeatSettingsListeners();
    initSpeedMultiplierUi();

    macroReadyPromise = Promise.all([
        loadCapabilities(recordButton),
        loadRecordingOptions(),
        loadMacroState(recordButton),
    ]).then(() => undefined).catch((error) => {
        macroReadyPromise = null;
        console.error("Failed to initialize macro state", error);
    });

    renderActions();
    initMacroEventListeners(recordButton);
}

export async function ensureMacroReady() {
    await macroReadyPromise;
}
