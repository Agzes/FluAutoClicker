import { invoke } from "@tauri-apps/api/core";
import { getPlatformCapabilities } from "./platform-capabilities";

const UINPUT_DISMISS_KEY = "flu_uinput_permission_dismissed_v1";
let permissionActionInFlight = false;

type UinputModalMode = "startup" | "feature";

function showModal(modal: HTMLElement) {
    modal.style.display = "flex";
    document.getElementById("content")?.classList.add("blurred");
    requestAnimationFrame(() => {
        modal.classList.add("active");
    });
}

function hideModal(modal: HTMLElement | null) {
    if (!modal) return;

    modal.classList.remove("active");
    window.setTimeout(() => {
        modal.style.display = "none";
        document.getElementById("content")?.classList.remove("blurred");
    }, 220);
}

function setStatus(message: string, kind: "info" | "success" | "error" = "info") {
    const status = document.getElementById("uinput-status");
    if (!status) return;

    status.textContent = message;
    status.className = `uinput-status ${kind}`;
}

function setBusy(isBusy: boolean) {
    for (const id of ["uinput-temp-grant-btn", "uinput-install-rule-btn", "uinput-retry-btn"]) {
        const button = document.getElementById(id) as HTMLButtonElement | null;
        if (button) {
            button.disabled = isBusy;
        }
    }
}

async function hasUinputPermission() {
    try {
        return await invoke<boolean>("check_uinput_permissions");
    } catch {
        return false;
    }
}

async function refreshUinputStatus() {
    const hasPermission = await hasUinputPermission();
    if (hasPermission) {
        setStatus("Permission is available. Linux input automation is ready.", "success");
    } else {
        setStatus("Permission is still missing. Use temporary access or install the udev rule.", "info");
    }
    return hasPermission;
}

async function runPermissionAction(command: "request_uinput_permissions" | "install_uinput_udev_rule") {
    if (permissionActionInFlight) {
        return;
    }

    permissionActionInFlight = true;
    setBusy(true);
    setStatus(
        command === "install_uinput_udev_rule"
            ? "Opening administrator prompt and installing udev rule..."
            : "Opening administrator prompt and granting temporary access...",
        "info",
    );

    try {
        await invoke<boolean>(command);
        const hasPermission = await refreshUinputStatus();
        if (hasPermission) {
            setStatus(
                command === "install_uinput_udev_rule"
                    ? "udev rule installed. Log out and back in if access disappears after restart."
                    : "Temporary access granted for this boot.",
                "success",
            );
            window.setTimeout(() => hideModal(document.getElementById("uinput-permission-modal")), 1400);
        }
    } catch (error) {
        setStatus(String(error || "Permission request failed."), "error");
    } finally {
        permissionActionInFlight = false;
        setBusy(false);
    }
}

export async function showUinputPermissionModal(mode: UinputModalMode = "feature") {
    const modal = document.getElementById("uinput-permission-modal");
    if (!modal) return;

    modal.dataset.mode = mode;
    setStatus("");
    showModal(modal);
    await refreshUinputStatus();
}

export async function ensureUinputPermissionsForFeature() {
    if (await hasUinputPermission()) {
        return true;
    }

    await showUinputPermissionModal("feature");
    return false;
}

export async function maybeShowStartupUinputPermissionModal() {
    const capabilities = await getPlatformCapabilities();
    if (capabilities.os !== "linux" || capabilities.uinput_available !== false) {
        return;
    }

    if (localStorage.getItem(UINPUT_DISMISS_KEY) === "true") {
        return;
    }

    window.setTimeout(() => {
        void showUinputPermissionModal("startup");
    }, 450);
}

export function initUinputPermissionModal() {
    document.getElementById("uinput-temp-grant-btn")?.addEventListener("click", () => {
        void runPermissionAction("request_uinput_permissions");
    });

    document.getElementById("uinput-install-rule-btn")?.addEventListener("click", () => {
        void runPermissionAction("install_uinput_udev_rule");
    });

    document.getElementById("uinput-retry-btn")?.addEventListener("click", () => {
        void refreshUinputStatus();
    });

    const close = () => {
        localStorage.setItem(UINPUT_DISMISS_KEY, "true");
        hideModal(document.getElementById("uinput-permission-modal"));
    };

    document.getElementById("uinput-modal-later-btn")?.addEventListener("click", close);
    document.getElementById("uinput-modal-close-btn")?.addEventListener("click", close);
}
