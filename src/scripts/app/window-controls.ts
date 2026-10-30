import { invoke } from "@tauri-apps/api/core";
import { appWindow } from "../app-window";
import { applyWindowControlIcons, WINDOW_CONTROL_ICONS_CHANGED_EVENT } from "../window-control-icons";
export const ALWAYS_ON_TOP_STORAGE_KEY = "flu-always-on-top";
export const ALWAYS_ON_TOP_CHANGED_EVENT = "flu:always-on-top-changed";

function readStoredAlwaysOnTop() {
    return localStorage.getItem(ALWAYS_ON_TOP_STORAGE_KEY) === "true";
}

export async function setAlwaysOnTopPreference(active: boolean) {
    await appWindow.setAlwaysOnTop(active);
    localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, String(active));
    window.dispatchEvent(new CustomEvent(ALWAYS_ON_TOP_CHANGED_EVENT, { detail: active }));
}

async function syncAlwaysOnTopFromWindow() {
    try {
        localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, String(await appWindow.isAlwaysOnTop()));
    } catch {
        localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, String(readStoredAlwaysOnTop()));
    }
}

async function applyStoredAlwaysOnTop() {
    const active = readStoredAlwaysOnTop();
    try {
        await appWindow.setAlwaysOnTop(active);
    } catch (error) {
        console.error("Failed to apply always on top preference", error);
    }
}

async function refreshWindowControlIcons() {
    try {
        applyWindowControlIcons({ maximized: await appWindow.isMaximized() });
    } catch {
        applyWindowControlIcons();
    }
}

export function initWindowControls() {
    void refreshWindowControlIcons();
    void applyStoredAlwaysOnTop();

    const updateMinimizedState = async () => {
        try {
            const minimized = await appWindow.isMinimized();
            const visible = await appWindow.isVisible();
            const isHidden = minimized || !visible;
            (window as any).flu_window_hidden = isHidden;
            const wasMinimized = document.body.classList.contains("window-minimized");
            document.body.classList.toggle("window-minimized", isHidden);
            if (wasMinimized && !isHidden) {
                window.dispatchEvent(new CustomEvent("flu:window-restored"));
            }
        } catch (error) {
            console.error("Failed to check minimized state", error);
        }
    };

    void updateMinimizedState();

    window.addEventListener("resize", () => {
        void refreshWindowControlIcons();
        void updateMinimizedState();
    });

    document.addEventListener("visibilitychange", () => {
        void updateMinimizedState();
    });

    window.addEventListener("focus", () => {
        void updateMinimizedState();
    });

    window.addEventListener("blur", () => {
        void updateMinimizedState();
    });
    window.addEventListener(WINDOW_CONTROL_ICONS_CHANGED_EVENT, () => {
        void refreshWindowControlIcons();
    });
    window.addEventListener("flu:settings-applied", () => {
        void refreshWindowControlIcons();
        void applyStoredAlwaysOnTop();
    });
    window.addEventListener(ALWAYS_ON_TOP_CHANGED_EVENT, () => {
        void syncAlwaysOnTopFromWindow();
    });

    document.getElementById("minimize-btn")?.addEventListener("click", () => {
        void invoke("minimize_main_window").catch((error) => {
            console.error("Failed to minimize window", error);
            void appWindow.minimize();
        });
    });

    document.getElementById("maximize-btn")?.addEventListener("click", async () => {
        try {
            const isMaximized = await appWindow.isMaximized();
            if (isMaximized) {
                await appWindow.unmaximize();
            } else {
                await appWindow.maximize();
            }
            await refreshWindowControlIcons();
        } catch (error) {
            console.error("Failed to toggle maximize state", error);
        }
    });

    document.getElementById("close-btn")?.addEventListener("click", () => {
        void appWindow.close();
    });
}
