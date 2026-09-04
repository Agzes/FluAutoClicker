import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPlatformCapabilities } from "./platform-capabilities";
import { notify } from "./notifications";
import { t } from "./i18n";

function readMouseIntervalMs(): number {
    const h = parseInt((document.getElementById('mouse-hours') as HTMLInputElement)?.value) || 0;
    const m = parseInt((document.getElementById('mouse-minutes') as HTMLInputElement)?.value) || 0;
    const s = parseInt((document.getElementById('mouse-seconds') as HTMLInputElement)?.value) || 0;
    const ms = parseInt((document.getElementById('mouse-ms') as HTMLInputElement)?.value) || 0;
    return h * 3600000 + m * 60000 + s * 1000 + ms;
}

function mouseRuntimeCps(totalMs: number, isLinux: boolean): number {
    if (totalMs === 0) {
        return isLinux ? 0 : 10000;
    }

    return Math.max(1, Math.round(1000 / totalMs));
}

export async function syncAllMouseSettings() {
    const capabilities = await getPlatformCapabilities();
    await invoke("set_cps", {
        cps: mouseRuntimeCps(readMouseIntervalMs(), capabilities.os === "linux"),
    });

    
    const activeBtn = document.querySelector('#mouse-button-toggle .multi-btn.active');
    if (activeBtn) {
        const value = (activeBtn as HTMLElement).dataset.value;
        if (value) await invoke("set_mouse_button", { button: value });
    }

    
    const activeMode = document.querySelector('#press-hold-toggle .toggle-option.active');
    if (activeMode) {
        const value = (activeMode as HTMLElement).dataset.value;
        if (value) await invoke("set_click_mode", { mode: value });
    }

    
    const activeClickType = document.querySelector('#mouse-click-type-toggle .toggle-option.active');
    if (activeClickType) {
        const value = (activeClickType as HTMLElement).dataset.value;
        if (value) await invoke("set_click_type", { clickType: value });
    }

    
    const holdDuration = parseInt((document.getElementById('mouse-hold-duration') as HTMLInputElement)?.value) || 100;
    await invoke("set_hold_duration", { duration: holdDuration });

    
    const activeHoldUnit = document.querySelector('#mouse-hold-mode-toggle .toggle-option.active');
    if (activeHoldUnit) {
        const value = (activeHoldUnit as HTMLElement).dataset.value;
        if (value) await invoke("set_hold_unit", { unit: value });
    }

    
    const activeRepeat = document.querySelector('#repeat-toggle .toggle-option.active');
    if (activeRepeat) {
        const value = (activeRepeat as HTMLElement).dataset.value;
        if (value) await invoke("set_repeat_mode", { mode: value });
    }

    
    const repeatCount = parseInt((document.getElementById('mouse-repeat-count') as HTMLInputElement)?.value) || 1;
    await invoke("set_repeat_count", { count: repeatCount });

    
    const activeRepeatUnit = document.querySelector('#finite-mode-toggle .toggle-option.active');
    if (activeRepeatUnit) {
        const value = (activeRepeatUnit as HTMLElement).dataset.value;
        if (value) await invoke("set_repeat_unit", { unit: value });
    }

    
    const activePosition = document.querySelector('#position-toggle .toggle-option.active');
    if (activePosition) {
        const value = (activePosition as HTMLElement).dataset.value;
        if (value) await invoke("set_position_mode", { mode: value });
    }

    
    const x = parseInt((document.getElementById('coord-x') as HTMLInputElement)?.value) || 0;
    const y = parseInt((document.getElementById('coord-y') as HTMLInputElement)?.value) || 0;
    await invoke("set_position", { x, y });

    
    const variation = parseInt((document.getElementById('mouse-variation') as HTMLInputElement)?.value) || 0;
    await invoke("set_variation_ms", { variation });
}


export function initMouseSettings() {

    void applyExtendedButtonVisibility();

    const mouseButtonRow = document.getElementById('mouse-button-toggle');
    if (mouseButtonRow) {
        const buttons = mouseButtonRow.querySelectorAll('.multi-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const value = (btn as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_mouse_button", { button: value });
                }
            });
        });
    }

    
    const pressHoldToggle = document.getElementById('press-hold-toggle');
    if (pressHoldToggle) {
        const options = pressHoldToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_click_mode", { mode: value });
                }
            });
        });
    }

    
    const clickTypeToggle = document.getElementById('mouse-click-type-toggle');
    if (clickTypeToggle) {
        const options = clickTypeToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_click_type", { clickType: value });
                }
            });
        });
    }

    
    const holdDurationInput = document.getElementById('mouse-hold-duration') as HTMLInputElement;
    if (holdDurationInput) {
        holdDurationInput.addEventListener('input', () => {
            const val = parseInt(holdDurationInput.value) || 100;
            invoke("set_hold_duration", { duration: val });
        });
    }

    
    const holdUnitToggle = document.getElementById('mouse-hold-mode-toggle');
    if (holdUnitToggle) {
        const options = holdUnitToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_hold_unit", { unit: value });
                }
            });
        });
    }

    
    const repeatToggle = document.getElementById('repeat-toggle');
    if (repeatToggle) {
        const options = repeatToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_repeat_mode", { mode: value });
                }
            });
        });
    }

    
    const repeatCountInput = document.getElementById('mouse-repeat-count') as HTMLInputElement;
    if (repeatCountInput) {
        repeatCountInput.addEventListener('input', () => {
            const val = parseInt(repeatCountInput.value) || 1;
            invoke("set_repeat_count", { count: val });
        });
    }

    
    const repeatUnitToggle = document.getElementById('finite-mode-toggle');
    if (repeatUnitToggle) {
        const options = repeatUnitToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_repeat_unit", { unit: value });
                }
            });
        });
    }

    
    const positionToggle = document.getElementById('position-toggle');
    if (positionToggle) {
        const options = positionToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_position_mode", { mode: value });
                }
            });
        });
    }

    
    const coordXInput = document.getElementById('coord-x') as HTMLInputElement;
    const coordYInput = document.getElementById('coord-y') as HTMLInputElement;
    
    if (coordXInput) {
        coordXInput.addEventListener('input', () => {
            const x = parseInt(coordXInput.value) || 0;
            const y = parseInt(coordYInput?.value) || 0;
            invoke("set_position", { x, y });
        });
    }
    
    if (coordYInput) {
        coordYInput.addEventListener('input', () => {
            const x = parseInt(coordXInput?.value) || 0;
            const y = parseInt(coordYInput.value) || 0;
            invoke("set_position", { x, y });
        });
    }

    
    const variationInput = document.getElementById('mouse-variation') as HTMLInputElement;
    if (variationInput) {
        variationInput.addEventListener('input', () => {
            const val = parseInt(variationInput.value) || 0;
            invoke("set_variation_ms", { variation: val });
        });
    }

    
    const pickBtn = document.getElementById('pick-btn');
    if (pickBtn) {
        pickBtn.addEventListener('click', async () => {
            const button = pickBtn as HTMLButtonElement;
            const originalText = pickBtn.innerHTML;
            const delayMs = 5000;
            let remainingSeconds = Math.ceil(delayMs / 1000);
            const renderCountdown = () => {
                pickBtn.innerHTML = `<span class="icon" style="margin-right: 6px; font-size: 14px;">&#58633;</span>` + t("picking", "PICK") + " " + remainingSeconds;
            };

            button.disabled = true;
            renderCountdown();
            const countdownTimer = window.setInterval(() => {
                remainingSeconds -= 1;
                if (remainingSeconds > 0) {
                    renderCountdown();
                } else {
                    window.clearInterval(countdownTimer);
                }
            }, 1000);
            notify(t("move_cursor_capture", "Move the cursor. Position will be captured in {seconds}s.", { seconds: String(Math.round(delayMs / 1000)) }), "info", delayMs + 600);

            try {
                const position = (await invoke("pick_cursor_position", {
                    delayMs,
                    delay_ms: delayMs,
                })) as { x: number; y: number };

                if (coordXInput) {
                    coordXInput.value = String(position.x);
                    coordXInput.dispatchEvent(new Event('input', { bubbles: true }));
                }

                if (coordYInput) {
                    coordYInput.value = String(position.y);
                    coordYInput.dispatchEvent(new Event('input', { bubbles: true }));
                }

                notify(t("captured_position", "Captured position {x}, {y}", { x: String(position.x), y: String(position.y) }), "success", 2200);
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                notify(message, "error", 3200);
            } finally {
                window.clearInterval(countdownTimer);
                button.disabled = false;
                pickBtn.innerHTML = originalText;
            }
        });
    }

    void listen("cursor-position-picked", (event) => {
        const payload = event.payload as { x?: number; y?: number };
        if (coordXInput && typeof payload?.x === "number") {
            coordXInput.value = String(payload.x);
            coordXInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (coordYInput && typeof payload?.y === "number") {
            coordYInput.value = String(payload.y);
            coordYInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (typeof payload?.x === "number" && typeof payload?.y === "number") {
            notify(t("captured_position", "Captured position {x}, {y}", { x: String(payload.x), y: String(payload.y) }), "success", 2200);
        }
    });

    void listen("cursor-position-pick-failed", (event) => {
        const payload = event.payload as { error?: string };
        notify(payload?.error || t("capture_failed", "Failed to capture cursor position"), "error", 3200);
    });
}

async function applyExtendedButtonVisibility() {
    const capabilities = await getPlatformCapabilities();
    const supported = capabilities.extended_mouse_buttons !== false;

    document.querySelectorAll<HTMLElement>('[data-capability-toggle="extended_mouse_buttons"]').forEach((btn) => {
        btn.style.display = supported ? "" : "none";
    });

    if (!supported) {
        const row = document.getElementById('mouse-button-toggle');
        const active = row?.querySelector<HTMLElement>('.multi-btn.active');
        if (active && (active.dataset.value === 'front' || active.dataset.value === 'back')) {
            active.classList.remove('active');
            row?.querySelector<HTMLElement>('[data-value="left"]')?.classList.add('active');
        }
    }
}
