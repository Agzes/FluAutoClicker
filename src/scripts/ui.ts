import { invoke } from "@tauri-apps/api/core";
import { getPlatformCapabilities } from "./platform-capabilities";
import { updateSliderFill, updateIndicator, formatDuration } from "./utils";
import { t } from "./i18n";

export type AppMode = "mouse" | "keyboard" | "macro";

function isAppMode(value: string | undefined | null): value is AppMode {
    return value === "mouse" || value === "keyboard" || value === "macro";
}

export function getSelectedMode(): AppMode {
    const activeTab = document.querySelector<HTMLElement>(".mode-tabs .tab.active");
    const activeSection = document.querySelector<HTMLElement>(".content-section.active");
    const tabMode = activeTab?.dataset.tab;
    const sectionMode = activeSection?.id.endsWith("-section")
        ? activeSection.id.slice(0, -"section".length - 1)
        : null;

    if (isAppMode(tabMode)) {
        return tabMode;
    }

    if (isAppMode(sectionMode)) {
        return sectionMode;
    }

    return "mouse";
}

export function setSelectedMode(mode: AppMode) {
    const tabs = document.querySelectorAll<HTMLElement>(".mode-tabs .tab");
    const sections = document.querySelectorAll<HTMLElement>(".content-section");
    const tabContainer = document.querySelector<HTMLElement>(".mode-tabs");
    const targetTab = document.querySelector<HTMLElement>(`.mode-tabs .tab[data-tab="${mode}"]`);
    const activeElement = document.activeElement;

    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
        activeElement.blur();
    }

    tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tab === mode));
    sections.forEach(section => section.classList.toggle("active", section.id === `${mode}-section`));

    if (tabContainer && targetTab) {
        updateIndicator(tabContainer, targetTab);
    }

    const featureBar = document.getElementById("mouse-feature-bar");
    if (featureBar) {
        featureBar.style.display = mode === "mouse" ? "flex" : "none";
    }

    const content = document.getElementById("content");
    if (content) {
        content.classList.toggle("macro-content-active", mode === "macro");
        content.scrollTop = 0;
        requestAnimationFrame(() => {
            content.scrollTop = 0;
        });
    }

    void invoke("set_active_app_mode", { mode }).catch((error) => {
        console.error("Failed to sync active app mode", error);
    });

    const updateCPSFn = (window as any).flu_update_cps;
    if (typeof updateCPSFn === "function") {
        updateCPSFn();
    }

    window.dispatchEvent(new CustomEvent("flu:mode-changed", { detail: mode }));
}

export function initInputs() {
    let isLinux = false;
    void getPlatformCapabilities().then((capabilities) => {
        isLinux = capabilities.os === "linux";
        updateCPS();
    });

    let sliderResizeFrame = 0;
    const refreshVisibleSliderFills = () => {
        sliderResizeFrame = 0;
        document.querySelectorAll('.interval-slider').forEach(slider => {
            const input = slider as HTMLInputElement;
            if (input.clientWidth > 0) updateSliderFill(input);
        });
    };
    const scheduleSliderResizeRefresh = () => {
        if (sliderResizeFrame) cancelAnimationFrame(sliderResizeFrame);
        sliderResizeFrame = requestAnimationFrame(refreshVisibleSliderFills);
    };

    window.addEventListener('resize', scheduleSliderResizeRefresh);

    function updateCPS() {
        const mode = getSelectedMode();
        const cpsEl = document.querySelector('.start-cps');
        if (!cpsEl) return;

        if (mode === "macro") {
            const totalMs = (window as any).flu_macro_duration || 0;
            cpsEl.textContent = t("cps_test.show_duration", undefined, { duration: formatDuration(totalMs) });
            return;
        }

        const h = parseInt((document.getElementById('mouse-hours') as HTMLInputElement)?.value) || 0;
        const m = parseInt((document.getElementById('mouse-minutes') as HTMLInputElement)?.value) || 0;
        const s = parseInt((document.getElementById('mouse-seconds') as HTMLInputElement)?.value) || 0;
        const ms = parseInt((document.getElementById('mouse-ms') as HTMLInputElement)?.value) || 0;
        const totalMs = h * 3600000 + m * 60000 + s * 1000 + ms;
        const isInfinite = totalMs < 3;
        const runtimeCps = totalMs === 0
            ? (isLinux ? 0 : 10000)
            : Math.max(1, Math.round(1000 / totalMs));
        if (!isInfinite) {
            cpsEl.textContent = t("cps_test.show_cps", undefined, { cps: (1000 / totalMs).toFixed(1) });
        } else {
            cpsEl.textContent = t("cps_test.infinity");
        }
        invoke("set_cps", { cps: runtimeCps });
    }

    (window as any).flu_update_cps = updateCPS;

    ['mouse-hours', 'mouse-minutes', 'mouse-seconds', 'mouse-ms', 'mouse-variation'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateCPS);
    });
    
    
    updateCPS();

    
    const mouseSlider = document.getElementById('mouse-slider') as HTMLInputElement;
    const mouseMs = document.getElementById('mouse-ms') as HTMLInputElement;
    if (mouseSlider && mouseMs) {
        mouseSlider.addEventListener('input', () => {
            mouseMs.value = mouseSlider.value;
            updateCPS();
            updateSliderFill(mouseSlider);
        });
        mouseMs.addEventListener('input', () => {
            const val = parseInt(mouseMs.value) || 0;
            mouseSlider.value = Math.min(val, 1000).toString();
            updateCPS();
            updateSliderFill(mouseSlider);
        });
        updateSliderFill(mouseSlider);
    }

    
    const kbSlider = document.getElementById('kb-slider') as HTMLInputElement;
    const kbMs = document.getElementById('kb-ms') as HTMLInputElement;
    const kbVariation = document.getElementById('kb-variation') as HTMLInputElement;
    if (kbSlider && kbMs) {
        function updateKbCps() {
            const h = parseInt((document.getElementById('kb-hours') as HTMLInputElement)?.value) || 0;
            const m = parseInt((document.getElementById('kb-minutes') as HTMLInputElement)?.value) || 0;
            const s = parseInt((document.getElementById('kb-seconds') as HTMLInputElement)?.value) || 0;
            const ms = parseInt((document.getElementById('kb-ms') as HTMLInputElement)?.value) || 0;
            const totalMs = h * 3600000 + m * 60000 + s * 1000 + ms;
            const cps = totalMs > 0 ? Math.round(1000 / totalMs) : 10000;
            invoke("set_keyboard_cps", { cps });
            invoke("set_keyboard_interval_ms", { intervalMs: totalMs });
            
            const variation = parseInt(kbVariation?.value) || 0;
            invoke("set_keyboard_variation_ms", { variation });
        }

        kbSlider.addEventListener('input', () => {
            kbMs.value = kbSlider.value;
            updateSliderFill(kbSlider);
            updateKbCps();
        });
        kbMs.addEventListener('input', () => {
            const val = parseInt(kbMs.value) || 0;
            kbSlider.value = Math.min(val, 1000).toString();
            updateSliderFill(kbSlider);
            updateKbCps();
        });
        
        if (kbVariation) {
            kbVariation.addEventListener('input', () => {
                const variation = parseInt(kbVariation.value) || 0;
                invoke("set_keyboard_variation_ms", { variation });
            });
        }
        updateKbCps();
    }

    const numInputs = document.querySelectorAll('input[type="number"]');
    numInputs.forEach(input => {
        const inputEl = input as HTMLInputElement;
        inputEl.addEventListener('focus', () => {
            if (inputEl.value === '0') {
                inputEl.value = '';
            } else {
                inputEl.select();
            }
        });
        inputEl.addEventListener('blur', () => {
            if (inputEl.value === '') {
                inputEl.value = '0';
                inputEl.dispatchEvent(new Event('input'));
            }
        });
        inputEl.addEventListener('wheel', (e: any) => {
            e.preventDefault();
            const step = parseFloat(inputEl.getAttribute('step') || '1');
            const val = parseFloat(inputEl.value) || 0;
            inputEl.value = (e.deltaY < 0 ? val + step : Math.max(0, val - step)).toString();
            inputEl.dispatchEvent(new Event('input'));
        }, { passive: false });
    });

    updateCPS();
}

export function initTabs(updateIndicatorFn: typeof updateIndicator, createSlideIndicatorFn: any) {
    const tabContainer = document.querySelector('.mode-tabs');
    const tabs = document.querySelectorAll<HTMLElement>('.mode-tabs .tab');
    const sections = document.querySelectorAll<HTMLElement>('.content-section');

    if (tabContainer) {
        const activeTab = tabContainer.querySelector('.tab.active');
        if (activeTab) createSlideIndicatorFn(tabContainer, activeTab, true);
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            const targetTab = tab.dataset.tab;
            if (!isAppMode(targetTab)) {
                return;
            }

            
            const startBtn = document.getElementById('start-btn');
            const isRunning = startBtn?.classList.contains('running');
            const activeTabEl = document.querySelector('.mode-tabs .tab.active');
            const activeTabName = (activeTabEl as HTMLElement | null)?.dataset.tab;

            
            if (isRunning && isAppMode(activeTabName)) {
                if (targetTab !== activeTabName) {
                    
                    if (activeTabEl) {
                        activeTabEl.classList.remove('lock-flash');
                        void (activeTabEl as HTMLElement).offsetWidth;
                        activeTabEl.classList.add('lock-flash');
                        setTimeout(() => {
                            activeTabEl.classList.remove('lock-flash');
                        }, 400);
                    }
                    return;
                }
            }

            setSelectedMode(targetTab);

            sections.forEach(section => {
                if (section.id === `${targetTab}-section`) {
                    requestAnimationFrame(() => {
                        section.querySelectorAll('.toggle-row, .multi-button-row').forEach(row => {
                            const activeBtn = row.querySelector('.active');
                            if (activeBtn) {
                                updateIndicatorFn(row, activeBtn);
                            }
                        });
                    });
                }
            });
        });
    });
}


export function updateTabStates() {
    const startBtn = document.getElementById('start-btn');
    const isRunning = startBtn?.classList.contains('running');
    const activeTabEl = document.querySelector('.mode-tabs .tab.active');
    const activeTabName = (activeTabEl as HTMLElement | null)?.dataset.tab;

    const tabs = document.querySelectorAll<HTMLElement>('.mode-tabs .tab');
    tabs.forEach(tab => {
        const tabName = tab.dataset.tab;
        if (isRunning && isAppMode(activeTabName)) {
            
            if (tabName !== activeTabName) {
                tab.classList.add('disabled');
            } else {
                tab.classList.remove('disabled');
            }
        } else {
            
            tab.classList.remove('disabled');
        }
    });
}
