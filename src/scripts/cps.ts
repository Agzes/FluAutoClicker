import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSlideIndicator, updateIndicator } from "./utils";
import { initWebviewErrorModal } from "./webview-error-modal";
import { initWindowEffects } from "./window-effects";
import { applyWindowControlIcons, WINDOW_CONTROL_ICONS_STORAGE_KEY } from "./window-control-icons";
import { t, initI18n } from "./i18n";

const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", async () => {
    initI18n();
    initWebviewErrorModal();
    await initWindowEffects();
    applyWindowControlIcons();

    const closeBtn = document.getElementById('close-btn');
    const minimizeBtn = document.getElementById('minimize-btn');
    const modeRow = document.getElementById('cps-mode-row');
    const timeRow = document.getElementById('cps-time-row');
    const clickArea = document.getElementById('cps-click-area');
    const mainDisplay = document.getElementById('cps-main-display');
    const maxDisplay = document.getElementById('cps-max-display');
    const minDisplay = document.getElementById('cps-min-display');
    const statusHint = document.getElementById('cps-status-hint');
    const resultText = document.getElementById('cps-result-text');
    const retryBtn = document.getElementById('cps-retry-btn');

    
    let mode: 'click' | 'hold' = 'click';
    let clickCount = 0;
    let isRunning = false;
    let isFinished = false;
    let startTime = 0;
    let duration = 5;
    let timer: any = null;
    const facts: string[] = t("cps.facts", "Rust ensures blazing speed and safety.|Crafted with love and ∞ cups of tea.|It will always be free and open-source.|Personalize your UI with dynamic themes.|Ultralight code minimizes system usage.|Star FluAutoClicker on github.").split("|").map(s => s.trim());
    let lastCps = 0;

    
    let intervals: number[] = [];
    let lastClickTime = 0;

    
    let holdStartTime = 0;
    let isHolding = false;
    let totalHoldTime = 0;

    function nowFromEvent(event?: Event) {
        return typeof event?.timeStamp === 'number' ? event.timeStamp : performance.now();
    }

    function calcStats() {
        if (intervals.length === 0) return { median: 0, min: 0, max: 0, accuracy: 0 };

        const sorted = [...intervals].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];

        
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;

        
        const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
        const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
        const stddev = Math.sqrt(variance);
        
        const cv = mean > 0 ? (stddev / mean) * 100 : 0;
        const accuracy = Math.max(0, Math.min(100, 100 - cv));

        return { median, min, max, accuracy };
    }

    function formatMs(ms: number): string {
        if (ms < 10) return `${ms.toFixed(1)}ms`;
        if (ms < 1000) return `${Math.round(ms)}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    }

    
    function updateDisplayLoop() {
        if (!isFinished && mainDisplay) {
            if (isRunning) {
                if (mode === 'click') {
                    const stats = calcStats();
                    mainDisplay.textContent = clickCount.toString();
                    if (maxDisplay) maxDisplay.textContent = t("cps.max", "MAX") + " " + formatMs(stats.max);
                    if (minDisplay) minDisplay.textContent = t("cps.min", "MIN") + " " + formatMs(stats.min);
                } else {
                    
                    if (isHolding) {
                        const currentHold = performance.now() - holdStartTime;
                        mainDisplay.textContent = t("cps.ms", "{value}ms", { value: String(Math.round(currentHold)) });
                    } else {
                        mainDisplay.textContent = totalHoldTime > 0 ? t("cps.ms", "{value}ms", { value: String(totalHoldTime) }) : t("cps.hold", "HOLD!");
                    }
                    if (maxDisplay) maxDisplay.textContent = '';
                    if (minDisplay) minDisplay.textContent = '';
                }
            }
            requestAnimationFrame(updateDisplayLoop);
        }
    }

    function showRandomFact() {
        if (facts.length > 0) {
            const fact = facts[Math.floor(Math.random() * facts.length)];
            if (resultText) resultText.textContent = fact;
        }
    }

    showRandomFact();

    closeBtn?.addEventListener('click', () => appWindow.close());
    minimizeBtn?.addEventListener('click', () => appWindow.minimize());

    function applyTheme() {
        const color = localStorage.getItem('flu-theme-color') || '#77B6DD';
        document.documentElement.style.setProperty('--accent', color);
        const dimColor = color.length === 7 ? `${color}66` : color;
        document.documentElement.style.setProperty('--accent-dim', dimColor);
    }

    window.addEventListener('storage', (e) => {
        if (e.key?.startsWith('flu-theme')) applyTheme();
        if (e.key === WINDOW_CONTROL_ICONS_STORAGE_KEY) applyWindowControlIcons();
    });
    applyTheme();

    
    if (modeRow) {
        const activeBtn = modeRow.querySelector('.multi-btn.active');
        if (activeBtn) createSlideIndicator(modeRow, activeBtn as HTMLElement, true);

        modeRow.querySelectorAll('.multi-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (isRunning || isFinished) return;
                modeRow.querySelectorAll('.multi-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                updateIndicator(modeRow, btn as HTMLElement);
                mode = (btn.getAttribute('data-value') || 'click') as 'click' | 'hold';
                resetTest();
            });
        });
    }

    
    if (timeRow) {
        const activeBtn = timeRow.querySelector('.multi-btn.active');
        if (activeBtn) createSlideIndicator(timeRow, activeBtn as HTMLElement, true);

        timeRow.querySelectorAll('.multi-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (isRunning || isFinished) return;
                timeRow.querySelectorAll('.multi-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                updateIndicator(timeRow, btn as HTMLElement);
                duration = parseInt(btn.getAttribute('data-value') || '5');
                resetTest();
            });
        });
    }

    
    function startClickTest(eventTime = performance.now()) {
        clickCount = 1;
        isRunning = true;
        isFinished = false;
        startTime = eventTime;
        lastClickTime = eventTime;
        intervals = [];
        document.body.classList.add('high-performance-mode');
        if (mainDisplay) mainDisplay.textContent = "1";
        if (maxDisplay) maxDisplay.textContent = '—';
        if (minDisplay) minDisplay.textContent = '—';
        if (statusHint) statusHint.textContent = t("cps.time_left", "Time left: {time}s", { time: String(duration) });
        if (retryBtn) retryBtn.classList.remove('ready');

        requestAnimationFrame(updateDisplayLoop);

        timer = setInterval(() => {
            const elapsed = (performance.now() - startTime) / 1000;
            const remaining = Math.max(0, duration - elapsed);
            lastCps = clickCount / elapsed;

            const stats = calcStats();
            if (statusHint) {
                const accText = intervals.length >= 2
                    ? t("cps.accuracy", "Accuracy") + ": ~" + stats.accuracy.toFixed(1) + "%"
                    : t("cps.time_left", "Time left: {time}s", { time: remaining.toFixed(1) });
                statusHint.textContent = accText + " • " + lastCps.toFixed(1) + " " + t("cps.label", "CPS");
            }

            if (remaining <= 0) {
                endClickTest();
            }
        }, 100);
    }

    function endClickTest() {
        isRunning = false;
        isFinished = true;
        clearInterval(timer);
        const finalCps = clickCount / duration;
        const stats = calcStats();
        if (mainDisplay) mainDisplay.textContent = finalCps.toFixed(1) + " " + t("cps.label", "CPS");
        if (maxDisplay) maxDisplay.textContent = t("cps.max", "MAX") + " " + formatMs(stats.max);
        if (minDisplay) minDisplay.textContent = t("cps.min", "MIN") + " " + formatMs(stats.min);
        if (statusHint) {
            const accText = intervals.length >= 2
                ? t("cps.accuracy", "Accuracy") + ": ~" + stats.accuracy.toFixed(1) + "%"
                : t("cps.no_interval", "No interval data");
            statusHint.textContent = accText + " • " + clickCount + " " + t("cps.clicks_in", "clicks in") + " " + duration + "s";
        }

        showRandomFact();
        if (retryBtn) retryBtn.classList.add('ready');
        document.body.classList.remove('high-performance-mode');
    }

    
    function startHoldTest() {
        isRunning = true;
        isFinished = false;
        totalHoldTime = 0;
        startTime = performance.now();
        if (mainDisplay) mainDisplay.textContent = t("cps.hold", "HOLD!");
        if (statusHint) statusHint.textContent = t("cps.hold_button", "Hold the button") + " • " + duration + "s timer";
        if (retryBtn) retryBtn.classList.remove('ready');

        requestAnimationFrame(updateDisplayLoop);

        timer = setInterval(() => {
            const elapsed = (performance.now() - startTime) / 1000;
            const remaining = Math.max(0, duration - elapsed);
            const holdFraction = totalHoldTime / 1000 / Math.max(elapsed, 0.001);
            lastCps = holdFraction;

            if (statusHint) {
                const holdSecs = (totalHoldTime / 1000).toFixed(2);
                statusHint.textContent = t("cps.time_left", "Time left: {time}s", { time: remaining.toFixed(1) }) + " • " + t("cps.held_label", "Held") + ": " + holdSecs + "s (" + (holdFraction * 100).toFixed(1) + "%)";
            }

            if (remaining <= 0) {
                endHoldTest();
            }
        }, 100);
    }

    function endHoldTest() {
        if (isHolding) {
            totalHoldTime += performance.now() - holdStartTime;
            isHolding = false;
        }
        isRunning = false;
        isFinished = true;
        clearInterval(timer);

        const totalHoldSecs = totalHoldTime / 1000;
        const holdPercent = (totalHoldTime / 1000 / duration) * 100;
        if (mainDisplay) mainDisplay.textContent = `${holdPercent.toFixed(1)}%`;
        if (statusHint) statusHint.textContent = t("cps.held_format", "Held {held}s out of {total}s", { held: totalHoldSecs.toFixed(2), total: String(duration) });

        showRandomFact();
        if (retryBtn) retryBtn.classList.add('ready');
        document.body.classList.remove('high-performance-mode');
    }

    
    function resetTest() {
        isRunning = false;
        isFinished = false;
        isHolding = false;
        clearInterval(timer);
        clickCount = 0;
        totalHoldTime = 0;
        lastCps = 0;
        intervals = [];
        lastClickTime = 0;
        if (mainDisplay) mainDisplay.textContent = mode === 'click' ? t("cps.start", "CLICK!") : t("cps.hold", "HOLD!");
        if (maxDisplay) maxDisplay.textContent = '—';
        if (minDisplay) minDisplay.textContent = '—';
        if (statusHint) statusHint.textContent = mode === 'click'
            ? t("cps.ready_to_start", "READY TO START") + " • " + duration + "S"
            : t("cps.ready_to_hold", "READY TO HOLD") + " • " + duration + "S";
        showRandomFact();
        if (retryBtn) retryBtn.classList.remove('ready');
        document.body.classList.remove('high-performance-mode');
    }

    
    clickArea?.addEventListener('mousedown', (e) => {
        if (isFinished) return;
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;

        if (mode !== 'click') {
            return;
        }

        e.preventDefault();
        const eventTime = nowFromEvent(e);
        if (!isRunning && clickCount === 0) {
            startClickTest(eventTime);
            return;
        }

        if (isRunning) {
            const interval = eventTime - lastClickTime;
            intervals.push(interval);
            lastClickTime = eventTime;
            clickCount++;
        }
    }, { capture: true });

    clickArea?.addEventListener('contextmenu', (e) => e.preventDefault());

    clickArea?.addEventListener('pointerdown', () => {
        if (isFinished) return;

        if (mode === 'hold') {
            if (!isRunning && !isFinished) {
                startHoldTest();
            }
            if (isRunning) {
                isHolding = true;
                holdStartTime = performance.now();
            }
        }
    });

    clickArea?.addEventListener('pointerup', () => {
        if (mode === 'hold' && isHolding && isRunning) {
            totalHoldTime += performance.now() - holdStartTime;
            isHolding = false;
        }
    });

    clickArea?.addEventListener('pointercancel', () => {
        if (mode === 'hold' && isHolding && isRunning) {
            totalHoldTime += performance.now() - holdStartTime;
            isHolding = false;
        }
    });

    clickArea?.addEventListener('pointerleave', () => {
        if (mode === 'hold' && isHolding && isRunning) {
            totalHoldTime += performance.now() - holdStartTime;
            isHolding = false;
        }
    });

    retryBtn?.addEventListener('click', resetTest);
    resetTest();
});
