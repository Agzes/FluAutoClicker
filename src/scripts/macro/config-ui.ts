import { updateIndicator } from "../utils";
import { captureCursorPosition, normalizeKey, getHoldMs } from "./backend";
import { setKeyBadgeContent } from "../key-badges";
import { macroState } from "./state";
import { t } from "../i18n";
import type {
    MacroActionDraft,
    MacroActionType,
    MacroKeyboardDraft,
    MacroMouseDraft,
    MacroMoveDraft,
    MacroBackendAction,
} from "./types";

const MODIFIER_LABELS = ["ctrl", "alt", "win", "shift"];

function isModifierLabel(label: string): boolean {
    return MODIFIER_LABELS.includes(label);
}

function normalizeKeyboardLabel(label: string): string {
    const value = label.trim().toLowerCase();
    const map: Record<string, string> = {
        "←": "backspace",
        esc: "escape",
        caps: "capslock",
        pgup: "pageup",
        pgdn: "pagedown",
        del: "delete",
        ins: "insert",
    };

    return map[value] || normalizeKey(value);
}

function formatKeyboardCombo(modifiers: string[], mainKey = ""): string {
    const combo = [...modifiers];
    if (mainKey && !modifiers.includes(mainKey)) {
        combo.push(mainKey);
    }

    return combo.join("+") || "a";
}

export function applyMouseButtonSupport(container: HTMLElement) {
    const allowedButtons = new Set(macroState.capabilities.supported_mouse_buttons);
    const row = container.querySelector("#cfg-mouse-btn");
    if (!row) {
        return;
    }

    row.querySelectorAll<HTMLElement>(".multi-btn").forEach((button) => {
        const value = button.dataset.value || "";
        const supported = allowedButtons.has(value);
        const target = button as HTMLButtonElement;
        target.disabled = !supported;
        target.title = supported ? "" : t("config.mouse_btn_unsupported", 'Mouse button "{value}" is not supported on this system', { value });
        target.style.opacity = supported ? "" : "0.4";
        target.style.cursor = supported ? "" : "not-allowed";
    });

    const activeButton = row.querySelector<HTMLElement>(".multi-btn.active");
    if (activeButton && (activeButton as HTMLButtonElement).disabled) {
        activeButton.classList.remove("active");
        const fallback = row.querySelector<HTMLElement>('.multi-btn[data-value="left"]');
        fallback?.classList.add("active");
        if (fallback) {
            updateIndicator(row, fallback);
        }
    }
}

function initNumericInputs(container: HTMLElement) {
    container.querySelectorAll("input[type='number']").forEach((input) => {
        const inputElement = input as HTMLInputElement;
        inputElement.addEventListener("focus", () => {
            if (inputElement.value === "0") {
                inputElement.value = "";
            } else {
                inputElement.select();
            }
        });

        inputElement.addEventListener("blur", () => {
            if (inputElement.value !== "") {
                return;
            }

            inputElement.value = "0";
            inputElement.dispatchEvent(new Event("input"));
        });

        inputElement.addEventListener(
            "wheel",
            (event: WheelEvent) => {
                event.preventDefault();
                const step = Number.parseFloat(inputElement.getAttribute("step") || "1");
                const value = Number.parseFloat(inputElement.value) || 0;
                inputElement.value = (event.deltaY < 0 ? value + step : Math.max(0, value - step)).toString();
                inputElement.dispatchEvent(new Event("input"));
            },
            { passive: false }
        );
    });
}

function initToggleRows(container: HTMLElement) {
    container.querySelectorAll(".toggle-row, .multi-button-row").forEach((row) => {
        row.addEventListener("click", (event) => {
            const button = (event.target as HTMLElement).closest(".toggle-option, .multi-btn") as HTMLElement | null;
            if (!button) {
                return;
            }

            row.querySelectorAll(".toggle-option, .multi-btn").forEach((entry) => entry.classList.remove("active"));
            button.classList.add("active");
            updateIndicator(row as HTMLElement, button);

            const value = button.dataset.value;
            if (row.id === "cfg-mouse-action" || row.id === "cfg-kb-action") {
                row.parentElement?.querySelector(".expandable-content")?.classList.toggle("expanded", value === "hold");
            }

            if (row.id === "cfg-mouse-pos-toggle") {
                document.getElementById("cfg-mouse-coord-section")?.classList.toggle("expanded", value === "custom");
            }
        });
    });
}

function initKeyboardConfigUi(existingConfig?: MacroBackendAction["config"]) {
    const recordButton = document.getElementById("cfg-kb-record-btn");
    const keyInput = document.getElementById("cfg-kb-key") as HTMLInputElement | null;
    const modifiersDisplay = document.getElementById("cfg-kb-modifiers-display");
    const mainKeyDisplay = document.getElementById("cfg-kb-main-key-display");
    const comboDisplay = document.querySelector("#macro-config-content .kb-selected-combo");
    const slidingContainer = document.getElementById("cfg-kb-sliding-container");
    const numpadBack = document.getElementById("cfg-kb-numpad-back");
    const keyboardContainer = slidingContainer?.parentElement?.parentElement?.parentElement as HTMLElement | null;

    let activeModifiers: string[] = [];
    let activeMainKey = "";
    let activeMainElement: HTMLElement | null = null;
    let isLocalRecording = false;

    if (existingConfig && existingConfig.type === "keyboard") {
        if (existingConfig.modifiers) {
            const mods = typeof existingConfig.modifiers === "string"
                ? existingConfig.modifiers.split("+").filter(Boolean)
                : (Array.isArray(existingConfig.modifiers) ? existingConfig.modifiers : []);
            activeModifiers = mods.map(m => m.toLowerCase().trim());
        }
        if (existingConfig.key) {
            activeMainKey = existingConfig.key.toLowerCase().trim();
        }
    }

    keyboardContainer?.querySelectorAll<HTMLElement>(".kb-tsu").forEach((key) => {
        key.textContent = ":)";
    });

    if (existingConfig && existingConfig.type === "keyboard") {
        keyboardContainer?.querySelectorAll(".kb-key").forEach((button) => {
            const key = button as HTMLElement;
            const label = key.textContent?.trim().toLowerCase() || "";
            const value = normalizeKeyboardLabel(label);

            if (key.classList.contains("kb-tsu") || key.classList.contains("kb-menu") || key.id === "cfg-kb-numpad-back") {
                return;
            }

            if (isModifierLabel(label)) {
                if (activeModifiers.includes(label)) {
                    key.classList.add("active");
                }
                return;
            }

            if (value === activeMainKey) {
                key.classList.add("active");
                activeMainElement = key;
            }
        });
    }

    const updateKeyDisplay = (mainKey = "") => {
        if (mainKey) {
            activeMainKey = mainKey;
        }

        const result = formatKeyboardCombo(activeModifiers, activeMainKey);

        if (keyInput) {
            keyInput.value = result;
        }
        if (comboDisplay || (modifiersDisplay && mainKeyDisplay)) {
            setKeyBadgeContent(
                comboDisplay || modifiersDisplay!.parentElement || modifiersDisplay!,
                [...activeModifiers, activeMainKey || ""].filter(Boolean)
            );
        }
    };

    updateKeyDisplay();

    numpadBack?.addEventListener("click", () => {
        slidingContainer?.classList.remove("numpad-active");
    });

    recordButton?.addEventListener("click", () => {
        isLocalRecording = !isLocalRecording;
        recordButton.textContent = isLocalRecording ? t("recording", "Recording...") : t("click_to_record", "Click to Record");
        recordButton.classList.toggle("active", isLocalRecording);

        if (!isLocalRecording) {
            return;
        }

        const handleKey = (event: KeyboardEvent) => {
            event.preventDefault();
            activeModifiers = [];
            if (event.ctrlKey) {
                activeModifiers.push("ctrl");
            }
            if (event.shiftKey) {
                activeModifiers.push("shift");
            }
            if (event.altKey) {
                activeModifiers.push("alt");
            }
            if (event.metaKey) {
                activeModifiers.push("win");
            }

            const keyMap: Record<string, string> = {
                " ": "space",
                enter: "enter",
                tab: "tab",
                backspace: "backspace",
                escape: "escape",
                capslock: "capslock",
                arrowup: "up",
                arrowdown: "down",
                arrowleft: "left",
                arrowright: "right",
                pageup: "pageup",
                pagedown: "pagedown",
                delete: "delete",
                insert: "insert",
                home: "home",
                end: "end",
            };
            const key = keyMap[event.key.toLowerCase()] || normalizeKeyboardLabel(event.key);
            const isModifier = ["control", "shift", "alt", "meta"].includes(key);
            updateKeyDisplay(isModifier ? "" : key);

            isLocalRecording = false;
            recordButton.textContent = t("click_to_record", "Click to Record");
            recordButton.classList.remove("active");
            window.removeEventListener("keydown", handleKey);
        };

        window.addEventListener("keydown", handleKey);
    });

    keyboardContainer?.querySelectorAll(".kb-key").forEach((button) => {
        button.addEventListener("click", () => {
            const key = button as HTMLElement;
            const label = key.textContent?.trim().toLowerCase() || "";
            const value = normalizeKeyboardLabel(label);

            if (key.classList.contains("kb-tsu")) {
                return;
            }

            if (key.classList.contains("kb-menu")) {
                slidingContainer?.classList.toggle("numpad-active");
                return;
            }

            if (key.id === "cfg-kb-numpad-back") {
                return;
            }

            if (isModifierLabel(label)) {
                if (activeModifiers.includes(label)) {
                    activeModifiers = activeModifiers.filter((entry) => entry !== label);
                    key.classList.remove("active");
                } else {
                    activeModifiers.push(label);
                    key.classList.add("active");
                }

                updateKeyDisplay();
                return;
            }

            if (activeMainElement && activeMainElement === key) {
                activeMainElement.classList.remove("active");
                activeMainElement = null;
                activeMainKey = "";
            } else {
                activeMainElement?.classList.remove("active");
                activeMainElement = key;
                key.classList.add("active");
                activeMainKey = value;
            }
            updateKeyDisplay();
        });
    });
}

function initSleepConfigUi() {
    const sleepInput = document.getElementById("cfg-sleep-ms") as HTMLInputElement | null;
    const sleepHint = document.getElementById("cfg-sleep-hint");

    sleepInput?.addEventListener("input", () => {
        if (!sleepHint) {
            return;
        }

        const seconds = (Number.parseInt(sleepInput.value, 10) || 0) / 1000;
        sleepHint.textContent = t("config.sleep_hint", "{seconds}s pause", { seconds: seconds.toFixed(3) });
    });
}

function initScrollConfigUi() {
    const amountInput = document.getElementById("cfg-scroll-amount") as HTMLInputElement | null;
    const dirRow = document.getElementById("cfg-scroll-dir");
    const hint = document.getElementById("cfg-scroll-hint");

    const updateHint = () => {
        if (!hint || !amountInput) return;
        const amount = Number.parseInt(amountInput.value, 10) || 1;
        const dir = dirRow?.querySelector(".active")?.getAttribute("data-value") || "up";
        const dirWord = dir === "up" ? t("config.up", "Up") : t("config.down", "Down");
        const stepWord = amount === 1 ? t("config.step", "step") : t("config.steps", "steps");
        hint.textContent = t("config.scroll_hint", "Scroll {direction} ({amount} {step})", { direction: dirWord, amount: String(amount), step: stepWord });
    };

    amountInput?.addEventListener("input", updateHint);
    dirRow?.addEventListener("click", () => {
        setTimeout(updateHint, 0);
    });
}

export function setupConfigListeners(type: MacroActionType, container: HTMLElement, existingConfig?: MacroBackendAction["config"]) {
    initToggleRows(container);
    initNumericInputs(container);

    if (type === "mouse") {
        document.getElementById("cfg-mouse-pick-btn")?.addEventListener("click", async (event) => {
            await captureCursorPosition(event.currentTarget as HTMLElement, "cfg-mouse-x", "cfg-mouse-y");
        });

        if (existingConfig && existingConfig.type === "mouse") {
            const btnVal = existingConfig.button || "left";
            const btnRow = container.querySelector("#cfg-mouse-btn");
            if (btnRow) {
                btnRow.querySelectorAll(".multi-btn").forEach(b => b.classList.remove("active"));
                const btnEl = btnRow.querySelector(`.multi-btn[data-value="${btnVal}"]`);
                if (btnEl) btnEl.classList.add("active");
            }

            let actVal = "press";
            const holdMs = getHoldMs(existingConfig.action);
            if (holdMs !== null) {
                actVal = "hold";
                const durationInput = container.querySelector("#cfg-mouse-duration") as HTMLInputElement | null;
                if (durationInput) {
                    durationInput.value = String(holdMs);
                }
            } else {
                actVal = String(existingConfig.action || "press");
            }

            const actRow = container.querySelector("#cfg-mouse-action");
            if (actRow) {
                actRow.querySelectorAll(".toggle-option").forEach(b => b.classList.remove("active"));
                const actEl = actRow.querySelector(`.toggle-option[data-value="${actVal}"]`);
                if (actEl) actEl.classList.add("active");
            }

            const clicksVal = String(Math.min(3, Math.max(1, Number(existingConfig.clicks) || 1)));
            const clicksRow = container.querySelector("#cfg-mouse-clicks");
            if (clicksRow) {
                clicksRow.querySelectorAll(".toggle-option").forEach(b => b.classList.remove("active"));
                const clicksEl = clicksRow.querySelector(`.toggle-option[data-value="${clicksVal}"]`);
                if (clicksEl) clicksEl.classList.add("active");
            }

            const posVal = existingConfig.position;
            const posRow = container.querySelector("#cfg-mouse-pos-toggle");
            if (posRow) {
                posRow.querySelectorAll(".toggle-option").forEach(b => b.classList.remove("active"));
                const targetVal = posVal ? "custom" : "current";
                const posEl = posRow.querySelector(`.toggle-option[data-value="${targetVal}"]`);
                if (posEl) posEl.classList.add("active");
            }
            if (posVal) {
                const parts = String(posVal).split(",");
                const xInput = container.querySelector("#cfg-mouse-x") as HTMLInputElement | null;
                const yInput = container.querySelector("#cfg-mouse-y") as HTMLInputElement | null;
                if (xInput && parts[0]) xInput.value = parts[0];
                if (yInput && parts[1]) yInput.value = parts[1];
            }
        }
        return;
    }

    if (type === "move") {
        document.getElementById("cfg-move-pick-btn")?.addEventListener("click", async (event) => {
            await captureCursorPosition(event.currentTarget as HTMLElement, "cfg-move-x", "cfg-move-y");
        });

        if (existingConfig && existingConfig.type === "move") {
            const xInput = container.querySelector("#cfg-move-x") as HTMLInputElement | null;
            const yInput = container.querySelector("#cfg-move-y") as HTMLInputElement | null;
            if (xInput && existingConfig.x !== undefined) xInput.value = String(existingConfig.x);
            if (yInput && existingConfig.y !== undefined) yInput.value = String(existingConfig.y);

            let styleVal = "instant";
            const rawStyle = existingConfig.style;
            if (typeof rawStyle === "string") {
                if (rawStyle.startsWith("linear")) {
                    styleVal = "linear";
                } else if (rawStyle.startsWith("smooth")) {
                    styleVal = "smooth";
                }
            } else if (rawStyle && typeof rawStyle === "object") {
                if ("linear" in rawStyle) {
                    styleVal = "linear";
                } else if ("smooth" in rawStyle) {
                    styleVal = "smooth";
                }
            }
            const styleRow = container.querySelector("#cfg-move-style");
            if (styleRow) {
                styleRow.querySelectorAll(".toggle-option").forEach(b => b.classList.remove("active"));
                const styleEl = styleRow.querySelector(`.toggle-option[data-value="${styleVal}"]`);
                if (styleEl) styleEl.classList.add("active");
            }
        }
        return;
    }

    if (type === "keyboard") {
        initKeyboardConfigUi(existingConfig);

        if (existingConfig && existingConfig.type === "keyboard") {
            let actVal = "press";
            const holdMs = getHoldMs(existingConfig.action);
            if (holdMs !== null) {
                actVal = "hold";
                const durationInput = container.querySelector("#cfg-kb-duration") as HTMLInputElement | null;
                if (durationInput) {
                    durationInput.value = String(holdMs);
                }
            } else {
                actVal = String(existingConfig.action || "press");
            }

            const actRow = container.querySelector("#cfg-kb-action");
            if (actRow) {
                actRow.querySelectorAll(".toggle-option").forEach(b => b.classList.remove("active"));
                const actEl = actRow.querySelector(`.toggle-option[data-value="${actVal}"]`);
                if (actEl) actEl.classList.add("active");
            }
        }
        return;
    }

    if (type === "sleep") {
        initSleepConfigUi();

        if (existingConfig && existingConfig.type === "sleep") {
            const sleepInput = container.querySelector("#cfg-sleep-ms") as HTMLInputElement | null;
            if (sleepInput && existingConfig.duration_ms !== undefined) {
                sleepInput.value = String(existingConfig.duration_ms);
                sleepInput.dispatchEvent(new Event("input"));
            }
        }
        return;
    }

    if (type === "scroll") {
        initScrollConfigUi();

        if (existingConfig && existingConfig.type === "scroll") {
            const clicks = existingConfig.clicks !== undefined ? Number(existingConfig.clicks) : 1;
            const dirVal = clicks < 0 ? "down" : "up";
            const amountVal = Math.abs(clicks);

            const dirRow = container.querySelector("#cfg-scroll-dir") as HTMLElement | null;
            if (dirRow) {
                dirRow.querySelectorAll(".toggle-option").forEach(b => b.classList.remove("active"));
                const dirEl = dirRow.querySelector(`.toggle-option[data-value="${dirVal}"]`) as HTMLElement | null;
                if (dirEl) {
                    dirEl.classList.add("active");
                    updateIndicator(dirRow, dirEl);
                }
            }

            const amountInput = container.querySelector("#cfg-scroll-amount") as HTMLInputElement | null;
            if (amountInput) {
                amountInput.value = String(amountVal);
            }
        }

        document.getElementById("cfg-scroll-amount")?.dispatchEvent(new Event("input"));
    }
}

export function generateConfigUi(type: MacroActionType): string {
    switch (type) {
        case "mouse":
            return `
                <div class="section-row">
                    <div class="multi-button-row" id="cfg-mouse-btn" style="margin: 0;">
                        <div class="slide-indicator" style="width: 20%; left: 0%;"></div>
                        <button class="multi-btn active" data-value="left">${t("left", "Left")}</button>
                        <button class="multi-btn" data-value="middle">${t("middle", "Middle")}</button>
                        <button class="multi-btn" data-value="right">${t("right", "Right")}</button>
                        <button class="multi-btn" data-value="front">${t("front", "X1")}</button>
                        <button class="multi-btn" data-value="back">${t("back", "X2")}</button>
                    </div>
                </div>

                <div class="section-row">
                    <div class="toggle-row" id="cfg-mouse-clicks" style="margin: 0;">
                        <div class="slide-indicator" style="width: 33.333%; left: 0%;"></div>
                        <button class="toggle-option active" data-value="1">${t("single", "Single")}</button>
                        <button class="toggle-option" data-value="2">${t("double", "Double")}</button>
                        <button class="toggle-option" data-value="3">${t("triple", "Triple")}</button>
                    </div>
                </div>

                <div class="section-row">
                    <div class="toggle-row" id="cfg-mouse-action" style="margin: 0;">
                        <div class="slide-indicator" style="width: 25%; left: 0%;"></div>
                        <button class="toggle-option active" data-value="press">${t("press", "Press")}</button>
                        <button class="toggle-option" data-value="hold">${t("hold", "Hold")}</button>
                        <button class="toggle-option" data-value="down">${t("config.down", "Down")}</button>
                        <button class="toggle-option" data-value="up">${t("config.up", "Up")}</button>
                    </div>

                    <div class="expandable-content" id="cfg-mouse-duration-container">
                        <div class="expandable-inner">
                            <div class="finite-inputs-row">
                                <div class="coord-input-box" style="flex: 2;">
                                    <input type="number" value="100" id="cfg-mouse-duration" min="1">
                                </div>
                                <div class="toggle-row" id="cfg-mouse-hold-mode-toggle" style="flex: 3; margin: 0;">
                                    <div class="slide-indicator" style="width: 50%; left: 0%;"></div>
                                    <button class="toggle-option active" data-value="ms">${t("config.ms", "ms")}</button>
                                    <button class="toggle-option" data-value="s">${t("config.sec", "sec")}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section-row">
                    <div class="toggle-row" id="cfg-mouse-pos-toggle" style="margin: 0;">
                        <div class="slide-indicator" style="width: 50%; left: 0%;"></div>
                        <button class="toggle-option active" data-value="current">${t("current_position", "Current position")}</button>
                        <button class="toggle-option" data-value="custom">${t("choose_place", "Choose a place")}</button>
                    </div>

                    <div class="expandable-content" id="cfg-mouse-coord-section">
                        <div class="expandable-inner">
                            <div class="coord-row-inner">
                                <div class="coord-input-box">
                                    <input type="number" value="0" id="cfg-mouse-x" min="0">
                                </div>
                                <div class="coord-input-box">
                                    <input type="number" value="0" id="cfg-mouse-y" min="0">
                                </div>
                                <button class="pick-btn" id="cfg-mouse-pick-btn">
                                    <span class="icon" style="margin-right: 6px; font-size: 14px;">&#58633;</span>
                                    ${t("picking", "PICK")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        case "move":
            return `
                <div class="section-row">
                    <div class="coord-row-inner">
                        <div class="coord-input-box">
                            <input type="number" value="0" id="cfg-move-x" min="0">
                        </div>
                        <div class="coord-input-box">
                            <input type="number" value="0" id="cfg-move-y" min="0">
                        </div>
                        <button class="pick-btn" id="cfg-move-pick-btn">
                            <span class="icon" style="margin-right: 6px; font-size: 14px;">&#58633;</span>
                            ${t("picking", "PICK")}
                        </button>
                    </div>
                </div>

                <div class="section-row">
                    <div class="toggle-row" id="cfg-move-style" style="margin: 0;">
                        <div class="slide-indicator" style="width: 33.333%; left: 0%;"></div>
                        <button class="toggle-option active" data-value="instant">${t("macro.record_moves_instant", "Instant")}</button>
                        <button class="toggle-option" data-value="linear">${t("macro.record_moves_linear", "Linear")}</button>
                        <button class="toggle-option" data-value="smooth">${t("macro.record_moves_smooth", "Smooth*")}</button>
                    </div>
                    <div style="font-size: 9px; color: var(--text-dim); margin-top: 6px; text-align: center; opacity: 0.8;">${t("config.smooth_beta_hint", "* Smooth mode is in Beta / WIP")}</div>
                </div>
            `;
        case "keyboard":
            return `
                <div class="section-row">
                    <div class="toggle-row" id="cfg-kb-action" style="margin: 0;">
                        <div class="slide-indicator" style="width: 25%; left: 0%;"></div>
                        <button class="toggle-option active" data-value="press">${t("press", "Press")}</button>
                        <button class="toggle-option" data-value="hold">${t("hold", "Hold")}</button>
                        <button class="toggle-option" data-value="down">${t("config.down", "Down")}</button>
                        <button class="toggle-option" data-value="up">${t("config.up", "Up")}</button>
                    </div>

                    <div class="expandable-content" id="cfg-kb-duration-container">
                        <div class="expandable-inner">
                            <div class="finite-inputs-row">
                                <div class="coord-input-box" style="flex: 2;">
                                    <input type="number" value="100" id="cfg-kb-duration" min="1">
                                </div>
                                <div class="toggle-row" id="cfg-kb-hold-mode-toggle" style="flex: 3; margin: 0;">
                                    <div class="slide-indicator" style="width: 50%; left: 0%;"></div>
                                    <button class="toggle-option active" data-value="ms">${t("config.ms", "ms")}</button>
                                    <button class="toggle-option" data-value="s">${t("config.sec", "sec")}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section-row keyboard-section-row">
                    <div class="kb-viewport">
                        <div class="kb-container" id="cfg-kb-sliding-container">
                            <div class="kb-main-view">
                                <div class="virtual-keyboard">
                                    <div class="kb-row">
                                        <button class="kb-key kb-esc">ESC</button><button class="kb-key kb-fn">F1</button><button class="kb-key kb-fn">F2</button><button class="kb-key kb-fn">F3</button><button class="kb-key kb-fn">F4</button><button class="kb-key kb-fn">F5</button><button class="kb-key kb-fn">F6</button><button class="kb-key kb-fn">F7</button><button class="kb-key kb-fn">F8</button><button class="kb-key kb-fn">F9</button><button class="kb-key kb-fn">F10</button><button class="kb-key kb-fn">F11</button><button class="kb-key kb-fn">F12</button>
                                    </div>
                                    <div class="kb-row">
                                        <button class="kb-key">\`</button><button class="kb-key">1</button><button class="kb-key">2</button><button class="kb-key">3</button><button class="kb-key">4</button><button class="kb-key">5</button><button class="kb-key">6</button><button class="kb-key">7</button><button class="kb-key">8</button><button class="kb-key">9</button><button class="kb-key">0</button><button class="kb-key">-</button><button class="kb-key">=</button><button class="kb-key kb-backspace">←</button>
                                    </div>
                                    <div class="kb-row">
                                        <button class="kb-key kb-tab">Tab</button><button class="kb-key">Q</button><button class="kb-key">W</button><button class="kb-key">E</button><button class="kb-key">R</button><button class="kb-key">T</button><button class="kb-key">Y</button><button class="kb-key">U</button><button class="kb-key">I</button><button class="kb-key">O</button><button class="kb-key">P</button><button class="kb-key">[</button><button class="kb-key">]</button><button class="kb-key kb-bslash">\\</button>
                                    </div>
                                    <div class="kb-row">
                                        <button class="kb-key kb-caps">Caps</button><button class="kb-key">A</button><button class="kb-key">S</button><button class="kb-key">D</button><button class="kb-key">F</button><button class="kb-key">G</button><button class="kb-key">H</button><button class="kb-key">J</button><button class="kb-key">K</button><button class="kb-key">L</button><button class="kb-key">;</button><button class="kb-key">'</button><button class="kb-key kb-enter">Enter</button>
                                    </div>
                                    <div class="kb-row">
                                        <button class="kb-key kb-shift">Shift</button><button class="kb-key">Z</button><button class="kb-key">X</button><button class="kb-key">C</button><button class="kb-key">V</button><button class="kb-key">B</button><button class="kb-key">N</button><button class="kb-key">M</button><button class="kb-key">,</button><button class="kb-key">.</button><button class="kb-key">/</button><button class="kb-key kb-shift">Shift</button>
                                    </div>
                                    <div class="kb-row">
                                        <button class="kb-key">Ctrl</button><button class="kb-key kb-mod">Win</button><button class="kb-key">Alt</button><button class="kb-key kb-space">Space</button><button class="kb-key">Alt</button><button class="kb-key kb-tsu" style="cursor: default; opacity: 0.5;">TSU</button><button class="kb-key">Ctrl</button><button class="kb-key kb-menu">≡</button>
                                    </div>
                                </div>
                            </div>
                            <div class="kb-numpad-view">
                                <div class="kb-numpad-content">
                                    <div class="kb-row"><button class="kb-key">Home</button><button class="kb-key">PgUp</button><button class="kb-key">PgDn</button></div>
                                    <div class="kb-row"><button class="kb-key">7</button><button class="kb-key">8</button><button class="kb-key">9</button><button class="kb-key">Num</button></div>
                                    <div class="kb-row"><button class="kb-key">4</button><button class="kb-key">5</button><button class="kb-key">6</button><button class="kb-key">Ins</button></div>
                                    <div class="kb-row"><button class="kb-key">1</button><button class="kb-key">2</button><button class="kb-key">3</button><button class="kb-key">Del</button></div>
                                    <div class="kb-row"><button class="kb-key">0</button><button class="kb-key">.</button><button class="kb-key">/</button><button class="kb-key">End</button></div>
                                    <div class="kb-row"><button class="kb-key kb-back-btn" id="cfg-kb-numpad-back">BACK</button><button class="kb-key">*</button><button class="kb-key">-</button></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section-row">
                    <div class="kb-status-row">
                        <span class="kb-selected-combo">
                            <span class="kb-modifiers" id="cfg-kb-modifiers-display"></span><span class="kb-main-key" id="cfg-kb-main-key-display">...</span>
                        </span>
                        <button class="kb-record-btn" id="cfg-kb-record-btn">${t("click_to_record", "Click to Record")}</button>
                        <input type="hidden" value="a" id="cfg-kb-key">
                    </div>
                </div>
            `;
        case "sleep":
            return `
                <div class="section-row">
                    <div class="coord-input-box" style="width: 100%;">
                        <input type="number" value="500" id="cfg-sleep-ms" min="1">
                    </div>
                    <div style="font-size: 9px; color: var(--text-dim); margin-top: 6px; text-align: center; opacity: 0.8;" id="cfg-sleep-hint">
                        ${t("config.sleep_default_hint", "0.500s pause")}
                    </div>
                </div>
            `;
        case "scroll":
            return `
                <div class="section-row">
                    <div class="toggle-row" id="cfg-scroll-dir" style="margin: 0 0 5px;">
                        <div class="slide-indicator" style="width: 50%; left: 0%;"></div>
                        <button class="toggle-option active" data-value="up">${t("config.up", "Up")}</button>
                        <button class="toggle-option" data-value="down">${t("config.down", "Down")}</button>
                    </div>
                    <div class="coord-input-box" style="width: 100%;">
                        <input type="number" value="1" id="cfg-scroll-amount" min="1" max="1000">
                    </div>
                    <div style="font-size: 9px; color: var(--text-dim); margin-top: 6px; text-align: center; opacity: 0.8;" id="cfg-scroll-hint">
                        ${t("config.scroll_default_hint", "Scroll Up (1 step)")}
                    </div>
                </div>
            `;
        case "raw_move":
            return `
                <div class="section-row">
                    <div style="font-size: 12px; color: var(--text-dim); text-align: center; width: 100%;">
                        ${t("config.raw_move_no_edit", "Raw move actions cannot be edited manually.")}
                    </div>
                </div>
            `;
    }
}

export function gatherConfig(type: MacroActionType): MacroActionDraft {
    if (type === "mouse") {
        const durationValue = Number.parseInt((document.getElementById("cfg-mouse-duration") as HTMLInputElement | null)?.value || "100", 10);
        const durationUnit =
            document
                .getElementById("cfg-mouse-hold-mode-toggle")
                ?.querySelector(".active")
                ?.getAttribute("data-value") || "ms";

        const draft: MacroMouseDraft = {
            button:
                document.getElementById("cfg-mouse-btn")?.querySelector(".active")?.getAttribute("data-value") || "left",
            action:
                (document.getElementById("cfg-mouse-action")?.querySelector(".active")?.getAttribute("data-value") as "press" | "hold" | "down" | "up") || "press",
            clicks:
                Math.min(3, Math.max(1, Number(document.getElementById("cfg-mouse-clicks")?.querySelector(".active")?.getAttribute("data-value")) || 1)),
            positionMode:
                (document.getElementById("cfg-mouse-pos-toggle")?.querySelector(".active")?.getAttribute("data-value") as "current" | "custom") || "current",
            x: (document.getElementById("cfg-mouse-x") as HTMLInputElement | null)?.value || "0",
            y: (document.getElementById("cfg-mouse-y") as HTMLInputElement | null)?.value || "0",
            durationMs: durationUnit === "s" ? durationValue * 1000 : durationValue,
        };

        return draft;
    }

    if (type === "move") {
        return {
            x: (document.getElementById("cfg-move-x") as HTMLInputElement | null)?.value || "0",
            y: (document.getElementById("cfg-move-y") as HTMLInputElement | null)?.value || "0",
            style:
                (document.getElementById("cfg-move-style")?.querySelector(".active")?.getAttribute("data-value") as "instant" | "linear" | "smooth") || "instant",
        };
    }

    if (type === "keyboard") {
        const durationValue = Number.parseInt((document.getElementById("cfg-kb-duration") as HTMLInputElement | null)?.value || "50", 10);
        const durationUnit =
            document
                .getElementById("cfg-kb-hold-mode-toggle")
                ?.querySelector(".active")
                ?.getAttribute("data-value") || "ms";

        const draft: MacroKeyboardDraft = {
            action:
                (document.getElementById("cfg-kb-action")?.querySelector(".active")?.getAttribute("data-value") as "press" | "hold" | "down" | "up") || "press",
            key: (document.getElementById("cfg-kb-key") as HTMLInputElement | null)?.value || "A",
            durationMs: durationUnit === "s" ? durationValue * 1000 : durationValue,
        };

        return draft;
    }

    if (type === "sleep") {
        return {
            durationMs: (document.getElementById("cfg-sleep-ms") as HTMLInputElement | null)?.value || "500",
        };
    }

    if (type === "raw_move") {
        return {
            x: "0",
            y: "0",
            style: "instant",
        } as MacroMoveDraft;
    }

    const amountVal = Number((document.getElementById("cfg-scroll-amount") as HTMLInputElement | null)?.value || "1");
    const dirVal = document.getElementById("cfg-scroll-dir")?.querySelector(".active")?.getAttribute("data-value") || "up";
    const clicks = dirVal === "down" ? -amountVal : amountVal;
    return {
        clicks: String(clicks),
    };
}
