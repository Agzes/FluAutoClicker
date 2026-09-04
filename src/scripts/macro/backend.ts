import { invoke } from "@tauri-apps/api/core";
import { notify } from "../notifications";
import { macroState } from "./state";
import { t } from "../i18n";
import type {
    MacroActionDraft,
    MacroActionType,
    MacroBackendAction,
    MacroKeyboardDraft,
    MacroMoveDraft,
    MacroMouseDraft,
    MacroSleepDraft,
    MacroScrollDraft,
    MacroUiAction,
} from "./types";

export function normalizeKey(key: string): string {
    const map: Record<string, string> = {
        backspace: "backspace",
        esc: "escape",
        pgup: "pageup",
        pgdn: "pagedown",
        del: "delete",
        ins: "insert",
    };

    return map[key] || key;
}

export function capitalize(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export function parseKeyboardCombo(raw: string) {
    const tokens = raw
        .split("+")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);

    const modifiers: string[] = [];
    let key = "a";

    tokens.forEach((token) => {
        if (["ctrl", "shift", "alt", "win"].includes(token)) {
            if (!modifiers.includes(token)) {
                modifiers.push(token);
            }
            return;
        }

        key = normalizeKey(token);
    });

    if (tokens.length === 1 && ["ctrl", "shift", "alt", "win"].includes(tokens[0])) {
        key = "a";
    }

    return { key, modifiers };
}

function parseModifierList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(String).map((part) => part.trim().toLowerCase()).filter(Boolean);
    }

    return String(value || "")
        .split(/[+,]/)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part && part !== "none");
}

export function getHoldMs(action: unknown): number | null {
    if (typeof action === "string" && action.startsWith("hold_")) {
        return Number.parseInt(action.replace("hold_", ""), 10);
    }

    if (action && typeof action === "object" && "hold" in action) {
        const hold = (action as { hold?: { duration_ms?: unknown } }).hold;
        const duration = Number(hold?.duration_ms);
        return Number.isFinite(duration) ? duration : null;
    }

    return null;
}

export async function captureCursorPosition(
    pickButton: HTMLElement,
    xInputId: string,
    yInputId: string
) {
    const delayMs = Math.max(0, Number(macroState.capabilities.pick_delay_ms || 5000));
    const originalText = pickButton.innerHTML;
    const button = pickButton as HTMLButtonElement;
    let countdownTimer: number | null = null;

    button.disabled = true;
    if (delayMs > 0) {
        let remainingSeconds = Math.ceil(delayMs / 1000);
        const renderCountdown = () => {
            pickButton.innerHTML = `<span class="icon">&#58633;</span> ` + t("picking", "PICK") + " " + remainingSeconds;
        };
        renderCountdown();
        countdownTimer = window.setInterval(() => {
            remainingSeconds -= 1;
            if (remainingSeconds > 0) {
                renderCountdown();
            } else {
                window.clearInterval(countdownTimer!);
                countdownTimer = null;
            }
        }, 1000);
        notify(t("move_cursor_capture", "Move the cursor. Position will be captured in {seconds}s.", { seconds: String(Math.round(delayMs / 1000)) }), "info", delayMs + 600);
    } else {
        pickButton.innerHTML = '<span class="icon">&#58633;</span> ' + t("picking", "PICK");
    }

    try {
        const position = await invoke<{ x: number; y: number }>("pick_cursor_position", {
            delayMs,
            delay_ms: delayMs,
        });

        const xInput = document.getElementById(xInputId) as HTMLInputElement | null;
        const yInput = document.getElementById(yInputId) as HTMLInputElement | null;
        if (xInput) {
            xInput.value = String(position.x);
            xInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (yInput) {
            yInput.value = String(position.y);
            yInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        notify(t("captured_position", "Captured position {x}, {y}", { x: String(position.x), y: String(position.y) }), "success", 2200);
    } catch (error) {
        notify(error instanceof Error ? error.message : String(error), "error", 3200);
    } finally {
        if (countdownTimer !== null) {
            window.clearInterval(countdownTimer);
        }
        button.disabled = false;
        pickButton.innerHTML = originalText;
    }
}

export function fromBackendAction(item: MacroBackendAction): MacroUiAction | null {
    if (!item || typeof item !== "object") {
        return null;
    }

    const id = Number(item.id || 0);
    const config = item.config || {};
    const type = config.type;
    if (!id || !type) {
        return null;
    }

    if (type === "mouse") {
        const button = String(config.button || "left");
        const action = config.action || "press";
        const holdMs = getHoldMs(action);
        const position = typeof config.position === "string" ? config.position : null;
        const clickCount = Math.min(3, Math.max(1, Number(config.clicks) || 1));

        let name = t(`macro.action.${button}_click`, `${capitalize(button)} Click`);
        if (holdMs) {
            name = t(`macro.action.${button}_hold`, `${capitalize(button)} Hold`);
        } else if (action === "down") {
            name = t(`macro.action.${button}_down`, `${capitalize(button)} Down`);
        } else if (action === "up") {
            name = t(`macro.action.${button}_up`, `${capitalize(button)} Up`);
        }
        if (!holdMs && action === "press" && clickCount > 1) {
            name += ` ×${clickCount}`;
        }

        return {
            id,
            type,
            name,
            details: `${position ? t("macro.action.at_position", "At {position}", { position }) : t("macro.action.at_current_position", "At current position")}${holdMs ? " " + t("macro.action.for_ms", "for {ms}ms", { ms: String(holdMs) }) : ""}`,
            icon: "&#58633;",
        };
    }

    if (type === "move") {
        const x = Number(config.x || 0);
        const y = Number(config.y || 0);
        let styleStr = "instant";
        const style = config.style;
        if (typeof style === "string") {
            styleStr = style;
        } else if (style && typeof style === "object") {
            if ("linear" in style) {
                styleStr = "linear";
            } else if ("smooth" in style) {
                styleStr = "smooth";
            }
        }
        return {
            id,
            type,
            name: t("macro.action.move_cursor", "Move Cursor"),
            details: t("macro.action.to_position", "To {x}, {y} ({style})", { x: String(x), y: String(y), style: styleStr }),
            icon: "&#57987;",
        };
    }

    if (type === "keyboard") {
        const text = typeof config.text === "string" && config.text.length > 0 ? config.text : "";
        const key = String(text || config.key || "a").toUpperCase();
        const action = config.action || "press";
        const holdMs = getHoldMs(action);
        const detailKeys = [...parseModifierList(config.modifiers), key].filter(Boolean);
        const combo = detailKeys.join(" + ");

        let name = t("macro.action.key_press", "Key Press");
        if (holdMs) {
            name = t("macro.action.key_hold", "Key Hold");
        } else if (action === "down") {
            name = t("macro.action.key_down", "Key Down");
        } else if (action === "up") {
            name = t("macro.action.key_up", "Key Up");
        }

        return {
            id,
            type,
            name,
            details: `${combo}${holdMs ? " " + t("macro.action.for_ms", "for {ms}ms", { ms: String(holdMs) }) : ""}`,
            detailKeys,
            detailSuffix: holdMs ? t("macro.action.for_ms", "for {ms}ms", { ms: String(holdMs) }) : "",
            icon: "&#57988;",
        };
    }

    if (type === "sleep") {
        const durationMs = Number(config.duration_ms || 0);
        return {
            id,
            type,
            name: t("macro.action.sleep", "Sleep"),
            details: t("macro.action.wait_for", "Wait for {ms}ms", { ms: String(durationMs) }),
            icon: "&#57824;",
        };
    }

    if (type === "scroll") {
        const clicks = Number(config.clicks || 0);
        const direction = clicks < 0 ? t("config.down", "Down") : t("config.up", "Up");
        const absClicks = Math.abs(clicks);
        return {
            id,
            type,
            name: t("macro.action.mouse_scroll", "Mouse Scroll"),
            details: t("macro.action.scroll_dir", "Scroll {direction} ({count} step{plural})", { direction, count: String(absClicks), plural: absClicks !== 1 ? "s" : "" }),
            icon: "&#59030;",
        };
    }

    if (type === "raw_move") {
        const points = Number(config.points || 0);
        const start = typeof config.start === "string" ? config.start : "?";
        const end = typeof config.end === "string" ? config.end : "?";
        return {
            id,
            type,
            name: t("macro.action.raw_move", "Raw Move"),
            details: t("macro.action.raw_details", "{points} points ({start} → {end})", { points: String(points), start, end }),
            icon: "&#57987;",
        };
    }

    return null;
}

export function toBackendConfig(type: MacroActionType, draft: MacroActionDraft): Record<string, unknown> | null {
    if (type === "mouse") {
        const mouseDraft = draft as MacroMouseDraft;
        return {
            type: "mouse",
            button: String(mouseDraft.button || "left").toLowerCase(),
            action: mouseDraft.action === "hold"
                ? { hold: { duration_ms: Math.max(1, Number(mouseDraft.durationMs || 100)) } }
                : (mouseDraft.action === "down" || mouseDraft.action === "up" ? mouseDraft.action : "press"),
            clicks: Math.min(3, Math.max(1, Number(mouseDraft.clicks) || 1)),
            position: mouseDraft.positionMode === "current" ? null : [Number(mouseDraft.x || 0), Number(mouseDraft.y || 0)],
        };
    }

    if (type === "move") {
        const moveDraft = draft as MacroMoveDraft;
        return {
            type: "move",
            x: Number(moveDraft.x || 0),
            y: Number(moveDraft.y || 0),
            style: moveDraft.style === "linear"
                ? { linear: { duration_ms: 300 } }
                : (moveDraft.style === "smooth"
                    ? { smooth: { path: [], duration_ms: 300 } }
                    : "instant"),
        };
    }

    if (type === "keyboard") {
        const keyboardDraft = draft as MacroKeyboardDraft;
        const parsed = parseKeyboardCombo(String(keyboardDraft.key || "A"));
        return {
            type: "keyboard",
            key: parsed.key,
            modifiers: parsed.modifiers,
            action: keyboardDraft.action === "hold"
                ? { hold: { duration_ms: Math.max(1, Number(keyboardDraft.durationMs || 50)) } }
                : (keyboardDraft.action === "down" || keyboardDraft.action === "up" ? keyboardDraft.action : "press"),
        };
    }

    if (type === "sleep") {
        const sleepDraft = draft as MacroSleepDraft;
        return {
            type: "sleep",
            duration_ms: Math.max(1, Number(sleepDraft.durationMs || 500)),
        };
    }

    if (type === "scroll") {
        const scrollDraft = draft as MacroScrollDraft;
        return {
            type: "scroll",
            clicks: Number(scrollDraft.clicks || 0),
        };
    }

    if (type === "raw_move") {
        return {
            type: "raw_move",
            points: [],
        };
    }

    return null;
}
