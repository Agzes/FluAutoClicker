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

const unlisteners: Array<() => void> = [];
let windowListenersBound = false;

export function initWindowFocusState() {
    if (windowListenersBound) {
        return;
    }
    windowListenersBound = true;

    void currentWindow.onFocusChanged(() => {
        void reapplyAcrylic();
    }).then((unlisten) => unlisteners.push(unlisten));

    void currentWindow.onMoved(async () => {
        void reapplyAcrylic();
    }).then((unlisten) => unlisteners.push(unlisten));

    void currentWindow.onResized(() => {
        setTimeout(() => void reapplyAcrylic(), 100);
    }).then((unlisten) => unlisteners.push(unlisten));

    window.addEventListener("beforeunload", () => {
        unlisteners.forEach((unlisten) => unlisten());
        unlisteners.length = 0;
        windowListenersBound = false;
    }, { once: true });
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
