import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { setKeyBadgeContent } from "./key-badges";
import { t } from "./i18n";


const MODIFIER_LABELS = ["ctrl", "alt", "win", "shift"];

function isModifierLabel(label: string): boolean {
    return MODIFIER_LABELS.includes(label);
}


let isRecording = false;
const recordingModifiers: Set<string> = new Set();
let recordingCallback: ((mainKey: string, modifiers: string[]) => void) | null = null;

export function initKeyboard() {
    const keyboardSection = document.getElementById('keyboard-section') || document;
    const keys = keyboardSection.querySelectorAll('.kb-key');
    const tsuKeys = keyboardSection.querySelectorAll<HTMLElement>('.kb-tsu');
    const kbMainKeyDisplay = document.getElementById('kb-main-key-display');
    const kbModifiersDisplay = document.getElementById('kb-modifiers-display');
    const kbComboDisplay = document.querySelector("#keyboard-section .kb-selected-combo");
    const kbContainer = document.getElementById('kb-sliding-container');
    const numpadBackBtn = document.getElementById('kb-numpad-back');
    const recordBtn = document.getElementById('kb-record-btn');

    
    let selectedMainKey: string | null = null;
    let selectedMainElement: HTMLElement | null = null;
    const selectedModifiers: Set<string> = new Set();

    function readSelectionFromActiveKeys() {
        selectedMainKey = null;
        selectedMainElement = null;
        selectedModifiers.clear();

        keys.forEach(k => {
            if (!k.classList.contains('active')) {
                return;
            }

            const label = k.textContent?.trim().toLowerCase() || '';
            if (isModifierLabel(label)) {
                selectedModifiers.add(label);
                return;
            }

            if (!selectedMainElement) {
                selectedMainElement = k as HTMLElement;
                selectedMainKey = label;
            } else {
                k.classList.remove('active');
            }
        });
    }

    function updateDisplays() {
        if (kbComboDisplay || (kbModifiersDisplay && kbMainKeyDisplay)) {
            const combo = [...Array.from(selectedModifiers), selectedMainKey || ""].filter(Boolean);
            setKeyBadgeContent(kbComboDisplay || kbModifiersDisplay!.parentElement || kbModifiersDisplay!, combo);
        }
    }

    function syncToBackend() {
        const mainKey = selectedMainKey || "";
        const modifiers = selectedModifiers.size > 0
            ? Array.from(selectedModifiers).join('+')
            : "none";

        invoke("set_keyboard_key", { key: mainKey });
        invoke("set_keyboard_modifiers", { modifiers });
    }

    
    readSelectionFromActiveKeys();
    updateDisplays();
    tsuKeys.forEach((key) => {
        key.textContent = ":)";
    });

    keys.forEach(key => {
        key.addEventListener('click', () => {
            if (key.classList.contains('kb-tsu')) {
                return;
            }

            if (key.classList.contains('kb-menu')) {
                if (kbContainer) {
                    kbContainer.classList.toggle('numpad-active');
                }
                return;
            }

            if (key.id === 'kb-numpad-back') return;

            const label = (key.textContent?.trim().toLowerCase() || '');

            if (isModifierLabel(label)) {
                const isActive = selectedModifiers.has(label);

                if (isActive) {
                    selectedModifiers.delete(label);
                    keys.forEach(k => {
                        if (k.textContent?.trim().toLowerCase() === label) {
                            k.classList.remove('active');
                        }
                    });
                } else {
                    selectedModifiers.add(label);
                    keys.forEach(k => {
                        if (k.textContent?.trim().toLowerCase() === label) {
                            k.classList.add('active');
                        }
                    });
                }
            } else {
                if (selectedMainElement && selectedMainElement === key) {
                    selectedMainElement.classList.remove('active');
                    selectedMainElement = null;
                    selectedMainKey = null;
                } else {
                    if (selectedMainElement) {
                        selectedMainElement.classList.remove('active');
                    }
                    selectedMainElement = key as HTMLElement;
                    selectedMainKey = label;
                    key.classList.add('active');
                }
            }

            updateDisplays();
            syncToBackend();
        });
    });

    if (numpadBackBtn && kbContainer) {
        numpadBackBtn.addEventListener('click', () => {
            kbContainer.classList.remove('numpad-active');
        });
    }

    
    const kbModeToggle = document.getElementById('kb-mode-toggle');
    if (kbModeToggle) {
        const options = kbModeToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_keyboard_click_mode", { mode: value });
                }
            });
        });
    }

    
    const holdDurationInput = document.getElementById('kb-hold-duration') as HTMLInputElement;
    if (holdDurationInput) {
        holdDurationInput.addEventListener('input', () => {
            const val = parseInt(holdDurationInput.value) || 100;
            invoke("set_keyboard_hold_duration", { duration: val });
        });
    }

    
    const holdUnitToggle = document.getElementById('kb-hold-mode-toggle');
    if (holdUnitToggle) {
        const options = holdUnitToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_keyboard_hold_unit", { unit: value });
                }
            });
        });
    }

    
    const repeatToggle = document.getElementById('kb-repeat-toggle');
    if (repeatToggle) {
        const options = repeatToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_keyboard_repeat_mode", { mode: value });
                }
            });
        });
    }

    
    const repeatCountInput = document.getElementById('kb-repeat-count') as HTMLInputElement;
    if (repeatCountInput) {
        repeatCountInput.addEventListener('input', () => {
            const val = parseInt(repeatCountInput.value) || 1;
            invoke("set_keyboard_repeat_count", { count: val });
        });
    }

    
    const repeatUnitToggle = document.getElementById('kb-finite-mode-toggle');
    if (repeatUnitToggle) {
        const options = repeatUnitToggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = (opt as HTMLElement).dataset.value;
                if (value) {
                    invoke("set_keyboard_repeat_unit", { unit: value });
                }
            });
        });
    }

    
    const variationInput = document.getElementById('kb-variation') as HTMLInputElement;
    if (variationInput) {
        variationInput.addEventListener('input', () => {
            const val = parseInt(variationInput.value) || 0;
            invoke("set_keyboard_variation_ms", { variation: val });
        });
    }

    
    if (recordBtn) {
        recordBtn.addEventListener('click', () => {
            if (isRecording) return;

            isRecording = true;
            recordingModifiers.clear();

            recordBtn.classList.add('running');
            (recordBtn as HTMLElement).textContent = t('press_key', 'Press a key...');

            
            recordingCallback = (mainKey: string, modifiers: string[]) => {
                
                keys.forEach(k => {
                    const kLabel = k.textContent?.trim().toLowerCase() || '';
                    if (isModifierLabel(kLabel)) {
                        k.classList.remove('active');
                    } else {
                        k.classList.remove('active');
                    }
                });

                
                selectedMainKey = mainKey;
                selectedModifiers.clear();

                
                const allKbKeys = keys;
                for (const k of allKbKeys) {
                    const kLabel = k.textContent?.trim().toLowerCase() || '';
                    if (kLabel === mainKey) {
                        selectedMainElement = k as HTMLElement;
                        k.classList.add('active');
                        break;
                    }
                }

                
                modifiers.forEach(mod => {
                    selectedModifiers.add(mod);
                    keys.forEach(k => {
                        const kLabel = k.textContent?.trim().toLowerCase() || '';
                        if (kLabel === mod) {
                            k.classList.add('active');
                        }
                    });
                });

                updateDisplays();
                syncToBackend();
            };

            window.addEventListener('keydown', handleRecordKeydown, true);
        });
    }

    
    listen("keyboard-status-changed", (_event: any) => {
        
        
    });
}


function handleRecordKeydown(e: KeyboardEvent) {
    if (!isRecording) return;
    e.preventDefault();
    e.stopPropagation();

    const recordBtn = document.getElementById('kb-record-btn');

    
    if (e.key === 'Escape') {
        isRecording = false;
        recordingModifiers.clear();
        recordingCallback = null;
        window.removeEventListener('keydown', handleRecordKeydown, true);
        if (recordBtn) {
            recordBtn.classList.remove('running');
            (recordBtn as HTMLElement).textContent = t('click_to_record', 'Click to Record');
        }
        return;
    }

    
    if (e.ctrlKey) recordingModifiers.add('ctrl');
    if (e.shiftKey) recordingModifiers.add('shift');
    if (e.altKey) recordingModifiers.add('alt');
    if (e.metaKey) recordingModifiers.add('win');

    const pressedKey = e.key.toLowerCase();

    
    if (['control', 'shift', 'alt', 'meta'].includes(pressedKey)) {
        return; 
    }

    
    const keyMap: Record<string, string> = {
        ' ': 'space', 'enter': 'enter', 'tab': 'tab', 'backspace': '←',
        'escape': 'esc', 'capslock': 'caps', 'arrowup': 'up',
        'arrowdown': 'down', 'arrowleft': 'left', 'arrowright': 'right',
        'pageup': 'pgup', 'pagedown': 'pgdn', 'delete': 'del',
        'insert': 'ins', 'home': 'home', 'end': 'end',
    };

    let searchLabel = keyMap[pressedKey] || pressedKey;

    
    if (searchLabel.length === 1) {
        searchLabel = searchLabel.toUpperCase();
    }

    
    const allKeys = document.querySelectorAll('.kb-key');
    let matchedLabel = '';
    for (const key of allKeys) {
        const label = key.textContent?.trim().toLowerCase() || '';
        if (label === searchLabel.toLowerCase()) {
            matchedLabel = label;
            break;
        }
    }

    if (matchedLabel && !isModifierLabel(matchedLabel)) {
        
        isRecording = false;
        window.removeEventListener('keydown', handleRecordKeydown, true);

        
        if (recordingCallback) {
            recordingCallback(matchedLabel, Array.from(recordingModifiers));
        }

        
        if (recordBtn) {
            recordBtn.classList.remove('running');
            (recordBtn as HTMLElement).textContent = t('click_to_record', 'Click to Record');
        }

        recordingCallback = null;
        recordingModifiers.clear();
    }
}


export async function syncAllKeyboardSettings() {
    
    const keyboardSection = document.getElementById('keyboard-section') || document;
    const activeKeys = keyboardSection.querySelectorAll('.kb-key.active');
    let mainKey = "";
    const modLabels: string[] = [];

    activeKeys.forEach(k => {
        const label = k.textContent?.trim().toLowerCase() || '';
        if (isModifierLabel(label)) {
            modLabels.push(label);
        } else {
            mainKey = label;
        }
    });

    const modifiers = modLabels.length > 0 ? modLabels.join('+') : "none";
    await invoke("set_keyboard_key", { key: mainKey });
    await invoke("set_keyboard_modifiers", { modifiers });

    
    const h = parseInt((document.getElementById('kb-hours') as HTMLInputElement)?.value) || 0;
    const m = parseInt((document.getElementById('kb-minutes') as HTMLInputElement)?.value) || 0;
    const s = parseInt((document.getElementById('kb-seconds') as HTMLInputElement)?.value) || 0;
    const ms = parseInt((document.getElementById('kb-ms') as HTMLInputElement)?.value) || 0;
    const totalMs = h * 3600000 + m * 60000 + s * 1000 + ms;
    const cps = totalMs > 0 ? Math.round(1000 / totalMs) : 10000;
    await invoke("set_keyboard_cps", { cps });
    await invoke("set_keyboard_interval_ms", { intervalMs: totalMs });

    
    const variation = parseInt((document.getElementById('kb-variation') as HTMLInputElement)?.value) || 0;
    await invoke("set_keyboard_variation_ms", { variation });

    
    const activeMode = document.querySelector('#kb-mode-toggle .toggle-option.active');
    if (activeMode) {
        const value = (activeMode as HTMLElement).dataset.value;
        if (value) await invoke("set_keyboard_click_mode", { mode: value });
    }

    
    const holdDuration = parseInt((document.getElementById('kb-hold-duration') as HTMLInputElement)?.value) || 100;
    await invoke("set_keyboard_hold_duration", { duration: holdDuration });

    
    const activeHoldUnit = document.querySelector('#kb-hold-mode-toggle .toggle-option.active');
    if (activeHoldUnit) {
        const value = (activeHoldUnit as HTMLElement).dataset.value;
        if (value) await invoke("set_keyboard_hold_unit", { unit: value });
    }

    
    const activeRepeat = document.querySelector('#kb-repeat-toggle .toggle-option.active');
    if (activeRepeat) {
        const value = (activeRepeat as HTMLElement).dataset.value;
        if (value) await invoke("set_keyboard_repeat_mode", { mode: value });
    }

    
    const repeatCount = parseInt((document.getElementById('kb-repeat-count') as HTMLInputElement)?.value) || 1;
    await invoke("set_keyboard_repeat_count", { count: repeatCount });

    
    const activeRepeatUnit = document.querySelector('#kb-finite-mode-toggle .toggle-option.active');
    if (activeRepeatUnit) {
        const value = (activeRepeatUnit as HTMLElement).dataset.value;
        if (value) await invoke("set_keyboard_repeat_unit", { unit: value });
    }
}
