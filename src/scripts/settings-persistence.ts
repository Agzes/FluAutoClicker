import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { setKeyBadgeContent } from "./key-badges";
import { getPlatformCapabilities, type PlatformCapabilities } from "./platform-capabilities";
import { setSelectedMode } from "./ui";
import type { AppMode } from "./ui";
import { updateSliderFill } from "./utils";
import { t } from "./i18n";
import {
    ALWAYS_ON_TOP_CHANGED_EVENT,
    ALWAYS_ON_TOP_STORAGE_KEY,
    setAlwaysOnTopPreference,
} from "./app/window-controls";
import {
    setPreferredWindowControlIconStyle,
    WINDOW_CONTROL_ICONS_STORAGE_KEY,
    type WindowControlIconStyle,
} from "./window-control-icons";

type Hotkeys = {
    toggle_start_stop: string;
    pick_position: string;
    toggle_macro_recording: string;
};

type MacroRecordingOptions = {
    record_mouse_clicks: boolean;
    record_mouse_moves: boolean;
    record_keyboard: boolean;
    record_delays: boolean;
    record_click_position: boolean;
    record_live_preview: boolean;
};

export type AppConfigFile = {
    version: number;
    active_profile: string;
    general: {
        theme_mode: string;
        theme_color: string;
        theme_name: string;
        remove_italic: boolean;
        font_app: string;
        font_loc: string;
        language: string;
        autostart: boolean;
        minimize_to_tray: boolean;
        stop_on_custom_position_move: boolean;
        reduce_motion: string;
    };
    mouse: {
        cps: number;
        variation_ms: number;
        button: string;
        click_mode: string;
        click_type: string;
        hold_duration: number;
        hold_unit: string;
        repeat_mode: string;
        repeat_count: number;
        repeat_unit: string;
        position_mode: string;
        coord_x: number;
        coord_y: number;
    };
    keyboard: {
        cps: number;
        variation_ms: number;
        key: string;
        modifiers: string;
        click_mode: string;
        hold_duration: number;
        hold_unit: string;
        repeat_mode: string;
        repeat_count: number;
        repeat_unit: string;
    };
    jiggler: {
        active: boolean;
        distance: number;
        interval_ms: number;
        pattern: string;
    };
    macro_settings: {
        repeat_mode: string;
        repeat_count: number;
        repeat_duration_ms: number;
        recording_options: MacroRecordingOptions;
        actions: unknown[];
    };
    hotkeys: Hotkeys;
    updates: {
        prerelease_channel: boolean;
        last_checked_at_unix_ms: number;
    };
    frontend_state: Record<string, unknown>;
};

const SETTINGS_CHANGED_EVENT = "flu:settings-changed";
const SETTINGS_APPLIED_EVENT = "flu:settings-applied";
const UPDATE_LAST_CHECK_STORAGE_KEY = "flu-update-last-checked-at";
const APP_MODES = new Set(["mouse", "keyboard", "macro"]);

let currentConfig: AppConfigFile | null = null;
let saveTimeoutId: number | null = null;
let isApplyingSnapshot = false;
let platformCapabilities: PlatformCapabilities | null = null;

function isSystemStartupAvailable() {
    return platformCapabilities?.system_startup !== false;
}

function defaultConfig(): AppConfigFile {
    return {
        version: 2,
        active_profile: "default",
        general: {
            theme_mode: "solid",
            theme_color: "#77B6DD",
            theme_name: "Flu",
            remove_italic: false,
            font_app: "museo-moderno",
            font_loc: "geologica",
            language: "en",
            autostart: false,
            minimize_to_tray: false,
            stop_on_custom_position_move: true,
            reduce_motion: "none",
        },
        mouse: {
            cps: 10,
            variation_ms: 0,
            button: "left",
            click_mode: "press",
            click_type: "single",
            hold_duration: 100,
            hold_unit: "ms",
            repeat_mode: "infinite",
            repeat_count: 10,
            repeat_unit: "times",
            position_mode: "current",
            coord_x: 841,
            coord_y: 425,
        },
        keyboard: {
            cps: 10,
            variation_ms: 0,
            key: "a",
            modifiers: "none",
            click_mode: "press",
            hold_duration: 100,
            hold_unit: "ms",
            repeat_mode: "infinite",
            repeat_count: 10,
            repeat_unit: "times",
        },
        jiggler: {
            active: false,
            distance: 20,
            interval_ms: 30000,
            pattern: "rnd",
        },
        macro_settings: {
            repeat_mode: "infinite",
            repeat_count: 10,
            repeat_duration_ms: 10000,
            recording_options: {
                record_mouse_clicks: true,
                record_mouse_moves: true,
                record_keyboard: true,
                record_delays: true,
                record_click_position: true,
                record_live_preview: true,
            },
            actions: [],
        },
        hotkeys: {
            toggle_start_stop: "F6",
            pick_position: "Ctrl+P",
            toggle_macro_recording: "Ctrl+Shift+R",
        },
        updates: {
            prerelease_channel: true,
            last_checked_at_unix_ms: 0,
        },
        frontend_state: {},
    };
}

function setToggleState(id: string, active: boolean) {
    document.getElementById(id)?.classList.toggle("active", active);
}

function setInputValue(id: string, value: string | number) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) {
        input.value = String(value);
    }
}

function setSliderValueText(sliderId: string, value: string) {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    const valueEl = slider?.parentElement?.querySelector(".visual-slider-value");
    if (valueEl) valueEl.textContent = value;
}

function refreshSliderFills() {
    document.querySelectorAll(".interval-slider").forEach((slider) => {
        updateSliderFill(slider as HTMLInputElement);
    });
}

function setActiveButton(groupId: string, value: string) {
    const group = document.getElementById(groupId);
    if (!group) return;

    let matched = false;
    group.querySelectorAll<HTMLElement>(".toggle-option, .multi-btn").forEach((button) => {
        const buttonValue = button.dataset.value
            || button.dataset.pattern
            || button.dataset.mode
            || button.textContent?.trim().toLowerCase()
            || "";
        const isActive = buttonValue === value;
        button.classList.toggle("active", isActive);
        if (isActive) matched = true;
    });

    if (!matched && groupId === "mouse-button-toggle") {
        const fallback = group.querySelector<HTMLElement>('.multi-btn[data-value="left"]');
        fallback?.classList.add("active");
    }

    if (groupId === "jiggler-pattern-row") {
        document
            .getElementById("jiggler-ozone-help")
            ?.classList.toggle("visible", value === "ozn");
    }
}

function setKeyboardSelection(key: string, modifiers: string) {
    const normalizedKey = key.toLowerCase();
    const modifierSet = new Set(
        modifiers
            .split("+")
            .map((part) => part.trim().toLowerCase())
            .filter((part) => part && part !== "none")
    );
    const keyboardSection = document.getElementById("keyboard-section") || document;
    let hasActiveMainKey = false;

    keyboardSection.querySelectorAll(".kb-key").forEach((button) => {
        const element = button as HTMLElement;
        const label = element.textContent?.trim().toLowerCase() || "";
        if (!label || element.classList.contains("kb-tsu") || element.classList.contains("kb-menu")) {
            element.classList.remove("active");
            return;
        }

        const isModifier = ["ctrl", "shift", "alt", "win"].includes(label);
        const isActive = isModifier
            ? modifierSet.has(label)
            : label === normalizedKey && !hasActiveMainKey;
        if (!isModifier && isActive) {
            hasActiveMainKey = true;
        }
        element.classList.toggle("active", isActive);
    });

    const comboDisplay = document.querySelector("#keyboard-section .kb-selected-combo");
    if (comboDisplay) {
        setKeyBadgeContent(comboDisplay, [...Array.from(modifierSet), normalizedKey || ""].filter(Boolean));
    }
}

function applyMacroRepeatSettings(config: AppConfigFile) {
    const repeatMode = config.macro_settings.repeat_mode;
    const repeatToggleValue = repeatMode === "infinite" ? "infinite" : "finite";
    const finiteModeValue = repeatMode === "finite_seconds" ? "seconds" : "times";
    const countValue = repeatMode === "finite_seconds"
        ? Math.max(1, Math.round(config.macro_settings.repeat_duration_ms / 1000))
        : config.macro_settings.repeat_count;

    setActiveButton("macro-repeat-toggle", repeatToggleValue);
    setActiveButton("macro-finite-mode-toggle", finiteModeValue);
    setInputValue("macro-repeat-count", countValue);
    document.getElementById("macro-repeat-finite-section")?.classList.toggle(
        "expanded",
        repeatToggleValue === "finite"
    );
}

function applyLocalStorageSnapshot(config: AppConfigFile) {
    localStorage.setItem("flu-theme-mode", config.general.theme_mode);
    localStorage.setItem("flu-theme-color", config.general.theme_color);
    localStorage.setItem("flu-theme-name", config.general.theme_name);
    localStorage.setItem("flu-no-italic", String(config.general.remove_italic));
    localStorage.setItem("flu-font-app", config.general.font_app || "museo-moderno");
    localStorage.setItem("flu-font-loc", config.general.font_loc || "geologica");
    localStorage.setItem("flu-language", config.general.language || "en");
    localStorage.setItem("flu-reduce-motion", config.general.reduce_motion || "none");

    const frontendState = config.frontend_state || {};
    const windowControlIcons = frontendState.window_control_icons === "classic" ? "classic" : "fluent";
    localStorage.setItem(WINDOW_CONTROL_ICONS_STORAGE_KEY, windowControlIcons);
    const notifications = {
        ...readFrontendNotifications(),
        ...asFrontendRecord(frontendState.notifications),
    };
    localStorage.setItem(
        "flu-window-acrylic",
        frontendState.acrylic_enabled === true ? "true" : "false"
    );
    localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, frontendState.always_on_top === true ? "true" : "false");
    localStorage.setItem("flu-frontend-state", JSON.stringify(notifications));
}

function asFrontendRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function readFrontendNotifications(): Record<string, unknown> {
    try {
        return asFrontendRecord(JSON.parse(localStorage.getItem("flu-frontend-state") || "{}"));
    } catch {
        return {};
    }
}

function readStoredUpdateLastCheckedAt(): number {
    const parsed = Number.parseInt(localStorage.getItem(UPDATE_LAST_CHECK_STORAGE_KEY) || "", 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function applyUpdateCheckSnapshot(config: AppConfigFile) {
    const persisted = config.updates?.last_checked_at_unix_ms || 0;
    const local = readStoredUpdateLastCheckedAt();
    localStorage.setItem(UPDATE_LAST_CHECK_STORAGE_KEY, String(Math.max(persisted, local)));
}

function applyConfigToUi(config: AppConfigFile) {
    const frontendState = config.frontend_state || {};
    const mouseTiming = (frontendState.mouse_timing || {}) as Record<string, number>;
    const keyboardTiming = (frontendState.keyboard_timing || {}) as Record<string, number>;

    setInputValue("mouse-hours", mouseTiming.hours ?? 0);
    setInputValue("mouse-minutes", mouseTiming.minutes ?? 0);
    setInputValue("mouse-seconds", mouseTiming.seconds ?? 0);
    setInputValue("mouse-ms", mouseTiming.ms ?? 550);
    setInputValue("mouse-slider", mouseTiming.ms ?? 550);
    setInputValue("mouse-variation", config.mouse.variation_ms);
    setInputValue("mouse-hold-duration", config.mouse.hold_duration);
    setInputValue("mouse-repeat-count", config.mouse.repeat_count);
    setInputValue("coord-x", config.mouse.coord_x);
    setInputValue("coord-y", config.mouse.coord_y);

    setInputValue("kb-hours", keyboardTiming.hours ?? 0);
    setInputValue("kb-minutes", keyboardTiming.minutes ?? 0);
    setInputValue("kb-seconds", keyboardTiming.seconds ?? 0);
    setInputValue("kb-ms", keyboardTiming.ms ?? 550);
    setInputValue("kb-slider", keyboardTiming.ms ?? 550);
    setInputValue("kb-variation", config.keyboard.variation_ms);
    setInputValue("kb-hold-duration", config.keyboard.hold_duration);
    setInputValue("kb-repeat-count", config.keyboard.repeat_count);

    const jigglerIntervalSeconds = Math.max(1, Math.round(config.jiggler.interval_ms / 1000));
    setInputValue("jiggler-slider", jigglerIntervalSeconds);
    setInputValue("jiggler-distance-slider", config.jiggler.distance);
    setSliderValueText("jiggler-slider", `${jigglerIntervalSeconds}s`);
    setSliderValueText("jiggler-distance-slider", `${config.jiggler.distance}px`);

    setActiveButton("mouse-button-toggle", config.mouse.button);
    setActiveButton("press-hold-toggle", config.mouse.click_mode);
    setActiveButton("mouse-click-type-toggle", config.mouse.click_type);
    setActiveButton("mouse-hold-mode-toggle", config.mouse.hold_unit);
    setActiveButton("repeat-toggle", config.mouse.repeat_mode);
    setActiveButton("finite-mode-toggle", config.mouse.repeat_unit);
    setActiveButton("position-toggle", config.mouse.position_mode);

    setActiveButton("kb-mode-toggle", config.keyboard.click_mode);
    setActiveButton("kb-hold-mode-toggle", config.keyboard.hold_unit);
    setActiveButton("kb-repeat-toggle", config.keyboard.repeat_mode);
    setActiveButton("kb-finite-mode-toggle", config.keyboard.repeat_unit);
    setKeyboardSelection(config.keyboard.key, config.keyboard.modifiers);

    setToggleState("jiggler-toggle", config.jiggler.active);
    setToggleState("jiggler-btn", config.jiggler.active);
    setActiveButton("jiggler-pattern-row", config.jiggler.pattern);

    setToggleState("autostart-toggle", isSystemStartupAvailable() && config.general.autostart);
    const autostartTrigger = document.getElementById("autostart-trigger");
    autostartTrigger?.classList.toggle("disabled", !isSystemStartupAvailable());
    autostartTrigger?.setAttribute("aria-disabled", isSystemStartupAvailable() ? "false" : "true");
    if (!isSystemStartupAvailable()) {
        const desc = autostartTrigger?.querySelector<HTMLElement>(".settings-item-desc");
        if (desc) desc.textContent = t("settings.unavailable_desktop", "Unavailable on this desktop");
    }
    setToggleState("tray-toggle", config.general.minimize_to_tray);
    setToggleState("remove-italic-toggle", config.general.remove_italic);
    setToggleState("acrylic-toggle", frontendState.acrylic_enabled === true);
    setToggleState("classic-window-icons-toggle", frontendState.window_control_icons === "classic");
    setToggleState("always-on-top-toggle", frontendState.always_on_top === true);
    setToggleState("macro-live-update-toggle", config.macro_settings.recording_options.record_live_preview !== false);
    setActiveButton("reduce-motion-row", config.general.reduce_motion || "none");
    applyReduceMotionClasses(config.general.reduce_motion || "none");
    applyMacroRepeatSettings(config);

    const activeTabCandidate = String(frontendState.active_tab || "mouse");
    const activeTab: AppMode = APP_MODES.has(activeTabCandidate) ? activeTabCandidate as AppMode : "mouse";
    setSelectedMode(activeTab);

    refreshSliderFills();
    requestAnimationFrame(refreshSliderFills);
}

export function applyPersistedConfig(config: AppConfigFile) {
    currentConfig = config;
    applyLocalStorageSnapshot(config);
    applyUpdateCheckSnapshot(config);
    applyConfigToUi(config);
    window.dispatchEvent(new CustomEvent(SETTINGS_APPLIED_EVENT, { detail: config }));
}

async function fetchHotkeys(): Promise<Hotkeys> {
    try {
        const runtime = await invoke<Partial<Hotkeys>>("get_hotkeys");
        return {
            ...(currentConfig || defaultConfig()).hotkeys,
            ...runtime,
        };
    } catch {
        return (currentConfig || defaultConfig()).hotkeys;
    }
}

async function fetchMacroSettings(fallback: AppConfigFile["macro_settings"]): Promise<AppConfigFile["macro_settings"]> {
    try {
        return await invoke<AppConfigFile["macro_settings"]>("get_macro_settings");
    } catch {
        return fallback;
    }
}

function getActiveValue(selector: string, fallback: string): string {
    const element = document.querySelector<HTMLElement>(selector);
    return (
        element?.dataset.value
        || element?.dataset.pattern
        || element?.dataset.mode
        || element?.textContent?.trim().toLowerCase()
        || fallback
    );
}

function getNumericValue(id: string, fallback: number): number {
    const input = document.getElementById(id) as HTMLInputElement | null;
    const parsed = Number.parseInt(input?.value || "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getKeyboardSnapshot() {
    const keyboardSection = document.getElementById("keyboard-section") || document;
    const activeKeys = keyboardSection.querySelectorAll(".kb-key.active");
    let key = "a";
    const modifiers: string[] = [];
    let foundMainKey = false;

    activeKeys.forEach((entry) => {
        const label = (entry.textContent || "").trim().toLowerCase();
        if (["ctrl", "shift", "alt", "win"].includes(label)) {
            modifiers.push(label);
            return;
        }
        if (!foundMainKey && label) {
            key = label;
            foundMainKey = true;
        }
    });

    return {
        key,
        modifiers: modifiers.length ? modifiers.join("+") : "none",
    };
}

async function captureConfigSnapshot(): Promise<AppConfigFile> {
    const base = currentConfig || defaultConfig();
    const hotkeys = await fetchHotkeys();
    const macroSettings = await fetchMacroSettings(base.macro_settings);
    const keyboard = getKeyboardSnapshot();
    const activeTabCandidate =
        document.querySelector<HTMLElement>(".mode-tabs .tab.active")?.dataset.tab || "mouse";
    const activeTab = APP_MODES.has(activeTabCandidate) ? activeTabCandidate : "mouse";
    return {
        ...base,
        general: {
            ...base.general,
            theme_mode: localStorage.getItem("flu-theme-mode") || base.general.theme_mode,
            theme_color: localStorage.getItem("flu-theme-color") || base.general.theme_color,
            theme_name: localStorage.getItem("flu-theme-name") || base.general.theme_name,
            remove_italic: localStorage.getItem("flu-no-italic") === "true",
            font_app: localStorage.getItem("flu-font-app") || "museo-moderno",
            font_loc: localStorage.getItem("flu-font-loc") || "geologica",
            language: localStorage.getItem("flu-language") || "en",
            autostart: isSystemStartupAvailable()
                && (document.getElementById("autostart-toggle")?.classList.contains("active") ?? base.general.autostart),
            minimize_to_tray: document.getElementById("tray-toggle")?.classList.contains("active") ?? base.general.minimize_to_tray,
            reduce_motion: getActiveValue("#reduce-motion-row .multi-btn.active", base.general.reduce_motion || "none"),
        },
        mouse: {
            ...base.mouse,
            cps: Math.max(1, Math.round(1000 / Math.max(1, (
                getNumericValue("mouse-hours", 0) * 3600000
                + getNumericValue("mouse-minutes", 0) * 60000
                + getNumericValue("mouse-seconds", 0) * 1000
                + getNumericValue("mouse-ms", 0)
            )))),
            variation_ms: getNumericValue("mouse-variation", base.mouse.variation_ms),
            button: getActiveValue("#mouse-button-toggle .multi-btn.active", base.mouse.button),
            click_mode: getActiveValue("#press-hold-toggle .toggle-option.active", base.mouse.click_mode),
            click_type: getActiveValue("#mouse-click-type-toggle .toggle-option.active", base.mouse.click_type),
            hold_duration: getNumericValue("mouse-hold-duration", base.mouse.hold_duration),
            hold_unit: getActiveValue("#mouse-hold-mode-toggle .toggle-option.active", base.mouse.hold_unit),
            repeat_mode: getActiveValue("#repeat-toggle .toggle-option.active", base.mouse.repeat_mode),
            repeat_count: getNumericValue("mouse-repeat-count", base.mouse.repeat_count),
            repeat_unit: getActiveValue("#finite-mode-toggle .toggle-option.active", base.mouse.repeat_unit),
            position_mode: getActiveValue("#position-toggle .toggle-option.active", base.mouse.position_mode),
            coord_x: getNumericValue("coord-x", base.mouse.coord_x),
            coord_y: getNumericValue("coord-y", base.mouse.coord_y),
        },
        keyboard: {
            ...base.keyboard,
            cps: Math.max(1, Math.round(1000 / Math.max(1, (
                getNumericValue("kb-hours", 0) * 3600000
                + getNumericValue("kb-minutes", 0) * 60000
                + getNumericValue("kb-seconds", 0) * 1000
                + getNumericValue("kb-ms", 0)
            )))),
            variation_ms: getNumericValue("kb-variation", base.keyboard.variation_ms),
            key: keyboard.key,
            modifiers: keyboard.modifiers,
            click_mode: getActiveValue("#kb-mode-toggle .toggle-option.active", base.keyboard.click_mode),
            hold_duration: getNumericValue("kb-hold-duration", base.keyboard.hold_duration),
            hold_unit: getActiveValue("#kb-hold-mode-toggle .toggle-option.active", base.keyboard.hold_unit),
            repeat_mode: getActiveValue("#kb-repeat-toggle .toggle-option.active", base.keyboard.repeat_mode),
            repeat_count: getNumericValue("kb-repeat-count", base.keyboard.repeat_count),
            repeat_unit: getActiveValue("#kb-finite-mode-toggle .toggle-option.active", base.keyboard.repeat_unit),
        },
        jiggler: {
            ...base.jiggler,
            active: document.getElementById("jiggler-toggle")?.classList.contains("active") ?? base.jiggler.active,
            distance: getNumericValue("jiggler-distance-slider", base.jiggler.distance),
            interval_ms: getNumericValue("jiggler-slider", Math.round(base.jiggler.interval_ms / 1000)) * 1000,
            pattern: getActiveValue("#jiggler-pattern-row .multi-btn.active", base.jiggler.pattern),
        },
        macro_settings: macroSettings,
        hotkeys,
        updates: {
            ...base.updates,
            last_checked_at_unix_ms: readStoredUpdateLastCheckedAt(),
        },
        frontend_state: {
            ...base.frontend_state,
            active_tab: activeTab,
            acrylic_enabled: localStorage.getItem("flu-window-acrylic") === "true",
            always_on_top: localStorage.getItem(ALWAYS_ON_TOP_STORAGE_KEY) === "true",
            window_control_icons: (
                document.getElementById("classic-window-icons-toggle")?.classList.contains("active")
                    ? "classic"
                    : "fluent"
            ) as WindowControlIconStyle,
            notifications: readFrontendNotifications(),
            mouse_timing: {
                hours: getNumericValue("mouse-hours", 0),
                minutes: getNumericValue("mouse-minutes", 0),
                seconds: getNumericValue("mouse-seconds", 0),
                ms: getNumericValue("mouse-ms", 550),
            },
            keyboard_timing: {
                hours: getNumericValue("kb-hours", 0),
                minutes: getNumericValue("kb-minutes", 0),
                seconds: getNumericValue("kb-seconds", 0),
                ms: getNumericValue("kb-ms", 550),
            },
        },
    };
}

async function persistSnapshot() {
    if (isApplyingSnapshot) return;
    const nextConfig = await captureConfigSnapshot();
    currentConfig = nextConfig;
    try {
        await invoke("save_app_config", { config: nextConfig });
    } catch (error) {
        console.error("Failed to persist settings", error);
    }
}

function scheduleSave() {
    if (isApplyingSnapshot) return;
    if (saveTimeoutId !== null) {
        window.clearTimeout(saveTimeoutId);
    }
    saveTimeoutId = window.setTimeout(() => {
        saveTimeoutId = null;
        void persistSnapshot();
    }, 250);
}

function initSimpleToggle(
    triggerId: string,
    toggleId: string,
    onToggle?: (active: boolean) => void | Promise<void>
) {
    const trigger = document.getElementById(triggerId);
    const toggle = document.getElementById(toggleId);
    if (!trigger || !toggle) return;

    trigger.addEventListener("click", () => {
        if (trigger.classList.contains("disabled") || trigger.getAttribute("aria-disabled") === "true") {
            return;
        }

        toggle.classList.toggle("active");
        const active = toggle.classList.contains("active");
        void Promise.resolve(onToggle?.(active)).catch((error) => {
            console.error(`Failed to apply ${toggleId}`, error);
            toggle.classList.toggle("active", !active);
            emitSettingsChanged();
        });
        emitSettingsChanged();
    });
}

export function emitSettingsChanged() {
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
}

export async function loadPersistedSettings() {
    isApplyingSnapshot = true;
    try {
        platformCapabilities = await getPlatformCapabilities();
        currentConfig = await invoke<AppConfigFile>("load_app_config");
    } catch {
        platformCapabilities = platformCapabilities || await getPlatformCapabilities();
        currentConfig = defaultConfig();
    }

    applyPersistedConfig(currentConfig);
    isApplyingSnapshot = false;
}

export async function persistCurrentSettings(): Promise<AppConfigFile> {
    await persistSnapshot();
    return currentConfig || defaultConfig();
}

export function applyReduceMotionClasses(value: string) {
    const root = document.documentElement;
    if (value === "reduce") {
        root.setAttribute("data-reduce-motion", "reduce");
    } else if (value === "remove") {
        root.setAttribute("data-reduce-motion", "remove");
    } else {
        root.removeAttribute("data-reduce-motion");
    }
}

export async function initSettingsPersistence() {
    platformCapabilities = platformCapabilities || await getPlatformCapabilities();

    initSimpleToggle("autostart-trigger", "autostart-toggle", async (active) => {
        if (!isSystemStartupAvailable()) {
            document.getElementById("autostart-toggle")?.classList.remove("active");
            return;
        }

        await invoke("set_start_on_system_startup", { enabled: active });
    });
    initSimpleToggle("tray-trigger", "tray-toggle", async (active) => {
        await invoke("set_minimize_to_tray", { enabled: active });
    });
    initSimpleToggle("classic-window-icons-trigger", "classic-window-icons-toggle", (active) => {
        setPreferredWindowControlIconStyle(active ? "classic" : "fluent");
    });
    initSimpleToggle("always-on-top-trigger", "always-on-top-toggle", async (active) => {
        await setAlwaysOnTopPreference(active);
    });
    
    const reduceMotionRow = document.getElementById("reduce-motion-row");
    if (reduceMotionRow) {
        const buttons = reduceMotionRow.querySelectorAll(".multi-btn");
        buttons.forEach((btn) => {
            btn.addEventListener("click", () => {
                buttons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                
                const indicator = reduceMotionRow.querySelector(".slide-indicator") as HTMLElement;
                if (indicator) {
                    indicator.style.width = `${(btn as HTMLElement).offsetWidth}px`;
                    indicator.style.left = `${(btn as HTMLElement).offsetLeft}px`;
                }

                const val = (btn as HTMLElement).dataset.value || "none";
                applyReduceMotionClasses(val);
                emitSettingsChanged();
            });
        });
    }

    initSimpleToggle("macro-live-update-trigger", "macro-live-update-toggle", async (active) => {
        const currentOptions = await invoke<MacroRecordingOptions>("get_macro_recording_options");
        currentOptions.record_live_preview = active;
        const optionsJson = JSON.stringify(currentOptions);
        await invoke("set_macro_recording_options", {
            optionsJson,
            options_json: optionsJson,
        });
    });

    window.addEventListener(SETTINGS_CHANGED_EVENT, scheduleSave);
    window.addEventListener(ALWAYS_ON_TOP_CHANGED_EVENT, (event) => {
        const active = Boolean((event as CustomEvent<boolean>).detail);
        setToggleState("always-on-top-toggle", active);
        scheduleSave();
    });
    document.addEventListener("input", () => scheduleSave());
    document.addEventListener("change", () => scheduleSave());
    document.addEventListener("click", () => {
        window.setTimeout(() => scheduleSave(), 0);
    });

    await listen("settings-applied", (event) => {
        const config = event.payload as AppConfigFile;
        isApplyingSnapshot = true;
        applyPersistedConfig(config);
        isApplyingSnapshot = false;
    });
    await listen("hotkeys-updated", () => scheduleSave());
    await listen("macro-status-changed", () => scheduleSave());
}
