import { invoke } from "@tauri-apps/api/core";
import { notify } from "./notifications";
import { getPlatformCapabilities } from "./platform-capabilities";
import { t } from "./i18n";

type HotkeyAction =
    "toggle_start_stop" | "pick_position" | "toggle_macro_recording";

type RuntimeHotkeys = {
    toggle_start_stop: string;
    pick_position: string;
    toggle_macro_recording: string;
};

const ACTIONS: HotkeyAction[] = [
    "toggle_start_stop",
    "pick_position",
    "toggle_macro_recording",
];

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta"]);

const CODE_TO_SHORTCUT: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    Enter: "Enter",
    Escape: "Escape",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    CapsLock: "CapsLock",
    PrintScreen: "PrintScreen",
    ScrollLock: "ScrollLock",
    Pause: "Pause",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
};

function isHotkeyAction(value: string | undefined): value is HotkeyAction {
    return Boolean(value && ACTIONS.includes(value as HotkeyAction));
}

function getHotkeyValue(hotkeys: RuntimeHotkeys, action: HotkeyAction): string {
    return hotkeys[action];
}

function normalizeDisplayPart(part: string): string {
    const trimmed = part.trim();
    if (!trimmed) return "";

    if (/^key[a-z]$/i.test(trimmed)) return trimmed.slice(3).toUpperCase();
    if (/^digit[0-9]$/i.test(trimmed)) return trimmed.slice(5);
    if (/^arrow(up|down|left|right)$/i.test(trimmed))
        return trimmed.replace(/^arrow/i, "");

    if (trimmed === "Escape") return "Esc";

    const lower = trimmed.toLowerCase();
    if (lower === "ctrl" || lower === "control") return "Ctrl";
    if (lower === "shift") return "Shift";
    if (lower === "alt") return "Alt";
    if (
        lower === "meta" ||
        lower === "cmd" ||
        lower === "win" ||
        lower === "super"
    )
        return "Win";
    if (trimmed.length === 1) return trimmed.toUpperCase();
    return trimmed;
}

function formatHotkeyDisplay(value: string): string {
    return value
        .split("+")
        .map((part) => normalizeDisplayPart(part.trim()))
        .join(" + ");
}

function updateStartHotkeyLabel(hotkeys: RuntimeHotkeys) {
    const label = document.querySelector<HTMLElement>(".start-hotkey");
    if (!label) return;

    label.textContent = formatHotkeyDisplay(hotkeys.toggle_start_stop);
}

function normalizeMainKey(event: KeyboardEvent): string | null {
    const key = event.key ?? "";
    if (!key || key === "Dead") return null;

    const lower = key.toLowerCase();
    if (MODIFIER_KEYS.has(lower)) {
        return null;
    }

    const code = event.code ?? "";
    if (/^Key[A-Z]$/i.test(code)) return code.slice(3).toUpperCase();
    if (/^Digit[0-9]$/i.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(code)) return code.toUpperCase();
    if (/^Numpad[0-9]$/i.test(code)) return code;
    if (code.startsWith("Numpad")) return code;
    if (CODE_TO_SHORTCUT[code]) return CODE_TO_SHORTCUT[code];

    if (key === " ") return "Space";
    if (key.length === 1 && /^[\x20-\x7E]$/.test(key)) return key.toUpperCase();
    return key.replace(/\s+/g, "");
}

function buildShortcut(event: KeyboardEvent): string | null {
    const main = normalizeMainKey(event);
    if (!main) return null;

    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.shiftKey) parts.push("Shift");
    if (event.altKey) parts.push("Alt");
    if (event.metaKey) parts.push("Win");
    parts.push(main);
    return parts.join("+");
}

function fallbackHotkeys(): RuntimeHotkeys {
    return {
        toggle_start_stop: "F6",
        pick_position: "Ctrl+P",
        toggle_macro_recording: "Ctrl+Shift+R",
    };
}

async function fetchHotkeys(): Promise<RuntimeHotkeys> {
    try {
        return await invoke<RuntimeHotkeys>("get_hotkeys");
    } catch {
        return fallbackHotkeys();
    }
}

export async function initHotkeysEditor() {
    const rows = Array.from(
        document.querySelectorAll<HTMLElement>(
            ".hotkey-list-item[data-hotkey-action]",
        ),
    );
    if (!rows.length) return;
    const capabilities = await getPlatformCapabilities();
    const isPortalBackend = capabilities.hotkey_backend === "portal";
    const hotkeysAvailable = capabilities.global_hotkeys;

    const rowByAction = new Map<HotkeyAction, HTMLElement>();
    rows.forEach((row) => {
        const action = row.dataset.hotkeyAction;
        if (isHotkeyAction(action)) {
            rowByAction.set(action, row);
        }
    });

    let hotkeys = await fetchHotkeys();
    let activeAction: HotkeyAction | null = null;
    let activeRow: HTMLElement | null = null;
    let activeBadge: HTMLElement | null = null;
    let activePreviousRaw = "";
    let hotkeysSuspendedForCapture = false;

    const render = () => {
        ACTIONS.forEach((action) => {
            const row = rowByAction.get(action);
            const badge = row?.querySelector<HTMLElement>(
                "[data-hotkey-value]",
            );
            if (!row || !badge) return;

            const raw = getHotkeyValue(hotkeys, action);
            badge.dataset.rawHotkey = raw;
            badge.textContent = !hotkeysAvailable
                ? t("unavailable", "Unavailable")
                : isPortalBackend
                  ? t("hotkeys.portal_managed", "System")
                  : formatHotkeyDisplay(raw);
            badge.title = !hotkeysAvailable
                ? t(
                      "hotkeys_unavailable_wayland",
                      "Global hotkeys are unavailable on Wayland",
                  )
                : isPortalBackend
                  ? t("hotkeys.portal_configure", "Configure System Shortcuts")
                  : t("click_to_change", "Click to change");
            row.classList.toggle("disabled", !hotkeysAvailable);
            row.classList.toggle(
                "portal-managed",
                hotkeysAvailable && isPortalBackend,
            );
            row.setAttribute(
                "aria-disabled",
                hotkeysAvailable ? "false" : "true",
            );
        });

        const listEl = document.querySelector<HTMLElement>(
            "#section-hotkeys .hotkey-items-list",
        );
        if (listEl) {
            listEl.style.display =
                hotkeysAvailable && isPortalBackend ? "none" : "";
        }

        const portalPanel = document.getElementById("hotkeys-portal-panel");
        if (portalPanel) {
            portalPanel.style.display =
                hotkeysAvailable && isPortalBackend ? "flex" : "none";
        }

        const startHotkeyLabel =
            document.querySelector<HTMLElement>(".start-hotkey");
        if (hotkeysAvailable && !isPortalBackend) {
            if (startHotkeyLabel) startHotkeyLabel.style.display = "";
            updateStartHotkeyLabel(hotkeys);
        } else if (startHotkeyLabel) {
            startHotkeyLabel.style.display = "";
            startHotkeyLabel.textContent =
                isPortalBackend && hotkeysAvailable
                    ? t("hotkeys.portal_managed", "System")
                    : t("beta", "BETA");
        }
    };

    const clearCaptureState = async (
        restoreBadge: boolean,
        resumeHotkeys = true,
    ) => {
        if (activeRow) activeRow.classList.remove("listening");
        if (activeBadge) {
            activeBadge.classList.remove("listening");
            if (restoreBadge) {
                activeBadge.textContent =
                    formatHotkeyDisplay(activePreviousRaw);
            }
        }

        window.removeEventListener("keydown", onGlobalKeydown, true);
        window.removeEventListener("mousedown", onGlobalPointerDown, true);

        activeAction = null;
        activeRow = null;
        activeBadge = null;
        activePreviousRaw = "";

        if (hotkeysSuspendedForCapture && resumeHotkeys) {
            try {
                await invoke("resume_hotkeys");
                hotkeysSuspendedForCapture = false;
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                notify(message, "error", 2600);
            }
        }
    };

    const onGlobalPointerDown = (event: MouseEvent) => {
        if (!activeRow) return;
        const target = event.target as Node | null;
        if (target && activeRow.contains(target)) return;
        void clearCaptureState(true);
    };

    const onGlobalKeydown = async (event: KeyboardEvent) => {
        if (!activeAction || !activeBadge) return;
        if (event.repeat) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.key === "Escape") {
            await clearCaptureState(true);
            return;
        }

        const shortcut = buildShortcut(event);
        if (!shortcut) return;

        try {
            const updated = await invoke<RuntimeHotkeys>("set_hotkey", {
                action: activeAction,
                shortcut,
            });
            hotkeys = updated;
            document
                .getElementById("hotkeys-portal-configure-btn")
                ?.addEventListener("click", () => void openPortalConfigure());

            render();
            await clearCaptureState(false);
            notify(
                t("notify.hotkey_updated", "Hotkey updated"),
                "success",
                1800,
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            notify(message, "error", 2600);
            await clearCaptureState(true);
        }
    };

    const openPortalConfigure = async () => {
        try {
            await invoke("configure_portal_hotkeys");
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            notify(message, "error", 3200);
        }
    };

    const startCapture = async (row: HTMLElement, action: HotkeyAction) => {
        if (!hotkeysAvailable) {
            notify(
                t(
                    "hotkeys_unavailable_wayland",
                    "Global hotkeys are unavailable on Wayland",
                ),
                "info",
                2400,
            );
            return;
        }

        if (isPortalBackend) {
            return;
        }

        const badge = row.querySelector<HTMLElement>("[data-hotkey-value]");
        if (!badge) return;

        if (activeRow && activeRow !== row) {
            await clearCaptureState(true, false);
        }

        if (activeRow === row) return;

        if (!hotkeysSuspendedForCapture) {
            try {
                await invoke("suspend_hotkeys");
                hotkeysSuspendedForCapture = true;
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                notify(message, "error", 2600);
                return;
            }
        }

        activeAction = action;
        activeRow = row;
        activeBadge = badge;
        activePreviousRaw = getHotkeyValue(hotkeys, action);

        row.classList.add("listening");
        badge.classList.add("listening");
        badge.textContent = t("press_key", "Press keys...");

        window.addEventListener("keydown", onGlobalKeydown, true);
        window.addEventListener("mousedown", onGlobalPointerDown, true);
    };

    rowByAction.forEach((row, action) => {
        const badge = row.querySelector<HTMLElement>("[data-hotkey-value]");
        if (!badge) return;

        row.addEventListener("click", () => {
            void startCapture(row, action);
        });
        badge.addEventListener("click", (event) => {
            event.stopPropagation();
            void startCapture(row, action);
        });
    });

    document
        .getElementById("hotkeys-portal-configure-btn")
        ?.addEventListener("click", () => void openPortalConfigure());

    render();
}
