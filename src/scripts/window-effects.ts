import { invoke } from "@tauri-apps/api/core";
import { appWindow } from "./app-window";

const ACRYLIC_STORAGE_KEY = "flu-window-acrylic";
let acrylicEnabledState = false;
let acrylicNativeReady = false;
const currentWindow = appWindow;

export function isAcrylicPreferred() {
    return localStorage.getItem(ACRYLIC_STORAGE_KEY) === "true";
}

export function setAcrylicPreferred(enabled: boolean) {
    localStorage.setItem(ACRYLIC_STORAGE_KEY, enabled ? "true" : "false");
}

export async function applyWindowEffects(enabled: boolean) {
    let acrylicApplied = false;
    const focused = document.hasFocus();

    try {
        acrylicApplied = await invoke<boolean>("set_window_acrylic", { enabled, focused });
    } catch (error) {
        console.warn("Failed to update acrylic window effect", error);
    }

    const active = enabled && acrylicApplied;
    acrylicEnabledState = enabled;
    acrylicNativeReady = active;
    document.body.classList.toggle("window-acrylic", active);
    document.documentElement.dataset.windowEffect = active ? "acrylic" : "default";

    return active;
}

async function reapplyAcrylic() {
    if (!acrylicEnabledState || !acrylicNativeReady) {
        return;
    }

    try {
        await invoke("set_window_acrylic", { enabled: true, focused: true });
    } catch (error) {
        console.warn("Failed to reapply acrylic", error);
    }
}

export function initWindowFocusState() {
    void currentWindow.onFocusChanged(() => {
        void reapplyAcrylic();
    });

    void currentWindow.onMoved(async () => {
        void reapplyAcrylic();
    });

    void currentWindow.onResized(() => {
        setTimeout(() => void reapplyAcrylic(), 100);
    });
}

export async function initWindowEffects() {
    initWindowFocusState();
    window.addEventListener("flu:settings-applied", () => {
        void applyWindowEffects(isAcrylicPreferred());
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            setTimeout(() => void reapplyAcrylic(), 50);
        }
    });
    return applyWindowEffects(isAcrylicPreferred());
}
