import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { listen } from "@tauri-apps/api/event";
import { syncAllKeyboardSettings } from "../keyboard";
import { ensureMacroReady } from "../macro";
import { syncAllMouseSettings } from "../mouse";
import { notify } from "../notifications";
import { getPlatformCapabilities } from "../platform-capabilities";
import { getSelectedMode, setSelectedMode, updateTabStates } from "../ui";
import type { AppMode } from "../ui";

type RunningPayload = {
    running?: boolean;
};

type MacroStatusPayload = {
    state?: string;
    error?: string;
};

type OzoneWaitingPayload = {
    waiting?: boolean;
};

type CompletedPayload = {
    unit?: string;
};

type SupportedTab = "mouse" | "keyboard" | "macro";

type RuntimeStatusPayload = {
    mouse_running?: boolean;
    keyboard_running?: boolean;
    macro_state?: string;
    running?: boolean;
    running_mode?: SupportedTab | null;
};

let runningMode: SupportedTab | null = null;
let isToggling = false;

function getStartButton() {
    return document.getElementById("start-btn");
}

function setStartButtonState(isRunning: boolean) {
    const startButton = getStartButton();
    const label = startButton?.querySelector(".start-label");
    if (!startButton || !label) {
        return;
    }

    if (isRunning) {
        startButton.classList.add("running");
        label.textContent = t("start.stop");
        startButton.style.backgroundColor = "var(--action-active-bg)";
        startButton.style.color = "var(--action-active-text)";
        return;
    }

    startButton.classList.remove("running");
    label.textContent = t("start.start");
    startButton.style.backgroundColor = "";
    startButton.style.color = "";
}

function getActiveTab(): SupportedTab {
    return getSelectedMode();
}

function getMouseIntervalMs(): number {
    const hours = Number.parseInt((document.getElementById("mouse-hours") as HTMLInputElement | null)?.value || "0", 10) || 0;
    const minutes = Number.parseInt((document.getElementById("mouse-minutes") as HTMLInputElement | null)?.value || "0", 10) || 0;
    const seconds = Number.parseInt((document.getElementById("mouse-seconds") as HTMLInputElement | null)?.value || "0", 10) || 0;
    const milliseconds = Number.parseInt((document.getElementById("mouse-ms") as HTMLInputElement | null)?.value || "0", 10) || 0;

    return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + milliseconds;
}

function getNumber(id: string): number {
    return Number.parseInt((document.getElementById(id) as HTMLInputElement | null)?.value || "0", 10) || 0;
}

function getActiveToggle(id: string): string {
    return document.querySelector(`#${id} .toggle-option.active`)?.getAttribute("data-value") || "";
}

function getHoldMs(valueId: string, unitId: string): number {
    const value = getNumber(valueId);
    return getActiveToggle(unitId) === "s" ? value * 1000 : value;
}

function getFiniteSeconds(repeatId: string, countId: string, unitId: string): number {
    if (getActiveToggle(repeatId) !== "finite") return 0;
    if (getActiveToggle(unitId) !== "seconds") return 0;
    return getNumber(countId);
}

const activeDangerWarnings = new Set<string>();

function warnDangerousSettings(tab: SupportedTab): void {
    const warnings: string[] = [];

    if (tab === "mouse") {
        const interval = getMouseIntervalMs();
        const cps = interval > 0 ? 1000 / interval : 0;
        if (cps > 500) {
            warnings.push(t("warning.high_cps", "High CPS ({cps}) may be unstable.", {
                cps: String(Math.round(cps)),
            }));
        }

        if (getActiveToggle("press-hold-toggle") === "hold") {
            const holdMs = getHoldMs("mouse-hold-duration", "mouse-hold-mode-toggle");
            if (holdMs > 60_000) {
                warnings.push(t("warning.long_hold", "Hold longer than {seconds}s may be hard to stop.", {
                    seconds: String(Math.round(holdMs / 1000)),
                }));
            }
        }

        const seconds = getFiniteSeconds("repeat-toggle", "mouse-repeat-count", "finite-mode-toggle");
        if (seconds > 3600) {
            warnings.push(t("warning.long_finite", "Finite run longer than 1 hour. Keep the stop hotkey ready."));
        }
    } else if (tab === "keyboard") {
        if (getActiveToggle("kb-mode-toggle") === "hold") {
            const holdMs = getHoldMs("kb-hold-duration", "kb-hold-mode-toggle");
            if (holdMs > 60_000) {
                warnings.push(t("warning.long_hold", "Hold longer than {seconds}s may be hard to stop.", {
                    seconds: String(Math.round(holdMs / 1000)),
                }));
            }
        }

        const seconds = getFiniteSeconds("kb-repeat-toggle", "kb-repeat-count", "kb-finite-mode-toggle");
        if (seconds > 3600) {
            warnings.push(t("warning.long_finite", "Finite run longer than 1 hour. Keep the stop hotkey ready."));
        }
    } else {
        const seconds = getFiniteSeconds("macro-repeat-toggle", "macro-repeat-count", "macro-finite-mode-toggle");
        if (seconds > 3600) {
            warnings.push(t("warning.long_finite", "Finite run longer than 1 hour. Keep the stop hotkey ready."));
        }
    }

    const next = new Set(warnings);
    warnings.forEach((message) => {
        if (!activeDangerWarnings.has(message)) {
            notify(message, "warning", 4200);
        }
    });
    activeDangerWarnings.clear();
    next.forEach((message) => activeDangerWarnings.add(message));
}

function showTimingWarningModal() {
    const modal = document.getElementById("timing-warning-modal");
    const handle = document.getElementById("timing-unlock-handle");
    if (!modal || !handle) {
        return;
    }

    modal.style.display = "flex";
    requestAnimationFrame(() => {
        modal.classList.add("active");
    });
    window.setTimeout(() => handle.focus(), 50);
    document.getElementById("content")?.classList.add("blurred");
}

async function toggleMouseClicker() {
    return invoke<boolean>("toggle_clicker", { source: "button" });
}

async function shouldShowTimingWarning() {
    const capabilities = await getPlatformCapabilities();
    return capabilities.os !== "linux";
}

function rememberRunningMode(mode: AppMode, isRunning: boolean) {
    if (isRunning) {
        runningMode = mode;
        return;
    }

    if (runningMode === mode) {
        runningMode = null;
    }
}

function applyRuntimeStatus(status: RuntimeStatusPayload) {
    const mode = status.running_mode || null;
    runningMode = mode;

    if (mode) {
        setSelectedMode(mode);
    }

    setStartButtonState(Boolean(status.running));
    updateTabStates();
}

async function syncRuntimeStatus() {
    try {
        const status = await invoke<RuntimeStatusPayload>("get_runtime_status");
        applyRuntimeStatus(status);
    } catch (error) {
        console.error("Failed to sync runtime status", error);
    }
}

async function handleStartButtonClick() {
    const startButton = getStartButton();
    if (!startButton || isToggling) {
        return;
    }

    isToggling = true;
    try {
        const isAlreadyRunning = startButton.classList.contains("running");
        const activeTab = isAlreadyRunning && runningMode ? runningMode : getActiveTab();

        if (activeTab === "keyboard") {
            if (!isAlreadyRunning) {
                await syncAllKeyboardSettings();
                warnDangerousSettings("keyboard");
            }

            const isRunning = await invoke<boolean>("toggle_keyboard_clicker");
            rememberRunningMode("keyboard", Boolean(isRunning));
            setStartButtonState(Boolean(isRunning));
            updateTabStates();
            return;
        }

        if (activeTab === "macro") {
            if (!isAlreadyRunning) {
                await ensureMacroReady();
                warnDangerousSettings("macro");
            }

            const isRunning = await invoke<boolean>("toggle_macro_player");
            rememberRunningMode("macro", Boolean(isRunning));
            setStartButtonState(Boolean(isRunning));
            updateTabStates();
            return;
        }

        if (!isAlreadyRunning && getMouseIntervalMs() <= 3 && await shouldShowTimingWarning()) {
            showTimingWarningModal();
            return;
        }

        if (!isAlreadyRunning) {
            await syncAllMouseSettings();
            warnDangerousSettings("mouse");
        }
        const isRunning = await toggleMouseClicker();
        rememberRunningMode("mouse", Boolean(isRunning));
        setStartButtonState(Boolean(isRunning));
        updateTabStates();
    } catch (error) {
        console.error("Failed to toggle selected mode", error);
        notify(error instanceof Error ? error.message : String(error), "error", 3200);
    } finally {
        isToggling = false;
    }
}

export function initStartStopControls() {
    const startButton = getStartButton();
    if (startButton) {
        startButton.addEventListener("click", () => {
            void handleStartButtonClick();
        });
    }

    let warningTimer: number | null = null;
    const scheduleDangerCheck = () => {
        if (warningTimer !== null) {
            window.clearTimeout(warningTimer);
        }
        warningTimer = window.setTimeout(() => {
            warningTimer = null;
            warnDangerousSettings(getActiveTab());
        }, 250);
    };

    document.addEventListener("input", scheduleDangerCheck);
    document.addEventListener("change", scheduleDangerCheck);
    document.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".toggle-option, .multi-btn, .drawer-toggle")) {
            scheduleDangerCheck();
        }
    });
    window.addEventListener("flu:mode-changed", scheduleDangerCheck);
    window.addEventListener("flu:settings-applied", scheduleDangerCheck);

    void listen<RunningPayload>("status-changed", (event) => {
        const isRunning = Boolean(event.payload.running);
        rememberRunningMode("mouse", isRunning);
        setStartButtonState(isRunning);
        updateTabStates();
    });

    void listen<RunningPayload>("keyboard-status-changed", (event) => {
        const isRunning = Boolean(event.payload.running);
        rememberRunningMode("keyboard", isRunning);
        setStartButtonState(isRunning);
        updateTabStates();
    });

    void listen<MacroStatusPayload>("macro-status-changed", (event) => {
        const state = String(event.payload?.state || "stopped");
        const isRunning = state === "playing";
        rememberRunningMode("macro", isRunning);
        setStartButtonState(isRunning);
        updateTabStates();

        if (state === "error" && event.payload?.error) {
            notify(String(event.payload.error), "error", 3600);
        }
    });

    void listen<OzoneWaitingPayload>("ozone-anchor-waiting", (event) => {
        if (event.payload?.waiting) {
            notify(t("ozone_notify"), "info", 3200);
        }
    });

    void listen<CompletedPayload>("clicker-completed", (event) => {
        const unit = event.payload?.unit === "seconds" ? "seconds" : "times";
        notify(t(`completed.mouse_${unit}`, "Mouse run finished"), "success", 2600);
    });

    void listen<CompletedPayload>("keyboard-completed", (event) => {
        const unit = event.payload?.unit === "seconds" ? "seconds" : "times";
        notify(t(`completed.keyboard_${unit}`, "Keyboard run finished"), "success", 2600);
    });

    void listen("macro-completed", () => {
        notify(t("completed.macro", "Macro finished"), "success", 2600);
    });

    void syncRuntimeStatus();

    return toggleMouseClicker;
}
