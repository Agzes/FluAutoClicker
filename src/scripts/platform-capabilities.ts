import { invoke } from "@tauri-apps/api/core";

export type PlatformCapabilities = {
    window_acrylic: boolean;
    system_startup: boolean;
    global_hotkeys: boolean;
    extended_mouse_buttons?: boolean;
    wayland: boolean;
    os?: string;
    uinput_available?: boolean;
    macro_playback_backend?: "uinput" | "enigo" | string;
    recording_backend?: "rdev" | "rdev_x11" | "unsupported_wayland" | string;
    session_type?: string | null;
    desktop_environment?: string | null;
    wayland_compositor?: string | null;
    window_manager?: string | null;
    webview_devtools?: boolean;
};

const fallbackCapabilities: PlatformCapabilities = {
    window_acrylic: false,
    system_startup: false,
    global_hotkeys: true,
    wayland: false,
    os: undefined,
    uinput_available: true,
    macro_playback_backend: "enigo",
    recording_backend: "rdev",
};

let cachedCapabilities: PlatformCapabilities | null = null;

export async function getPlatformCapabilities(): Promise<PlatformCapabilities> {
    if (cachedCapabilities) {
        return cachedCapabilities;
    }

    try {
        cachedCapabilities = await invoke<PlatformCapabilities>("get_platform_capabilities");
    } catch (error) {
        console.warn("Failed to load platform capabilities", error);
        cachedCapabilities = fallbackCapabilities;
    }

    return cachedCapabilities;
}
