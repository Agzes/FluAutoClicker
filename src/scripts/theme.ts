import { getSystemAccentColor, updateSliderFill } from "./utils";
import {
    applyWindowEffects,
    isAcrylicPreferred,
    setAcrylicPreferred,
} from "./window-effects";
import { emitSettingsChanged } from "./settings-persistence";
import { getPlatformCapabilities } from "./platform-capabilities";
import { applyFonts } from "./fonts";
import { t } from "./i18n";

type HsvColor = {
    h: number;
    s: number;
    v: number;
};

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string) {
    const raw = value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
        return `#${raw
            .split("")
            .map((part) => `${part}${part}`)
            .join("")}`.toUpperCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(raw)) {
        return `#${raw}`.toUpperCase();
    }
    return null;
}

function hexToRgb(hex: string) {
    const normalized = normalizeHexColor(hex) || "#77B6DD";
    const value = Number.parseInt(normalized.slice(1), 16);
    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    };
}

function getRelativeLuminance(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    const toLinear = (channel: number) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function rgbToHex(r: number, g: number, b: number) {
    return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function hexToHsv(hex: string): HsvColor {
    const { r, g, b } = hexToRgb(hex);
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;

    if (delta !== 0) {
        if (max === red) hue = 60 * (((green - blue) / delta) % 6);
        else if (max === green) hue = 60 * ((blue - red) / delta + 2);
        else hue = 60 * ((red - green) / delta + 4);
    }

    return {
        h: hue < 0 ? hue + 360 : hue,
        s: max === 0 ? 0 : delta / max,
        v: max,
    };
}

function hsvToHex({ h, s, v }: HsvColor) {
    const chroma = v * s;
    const hueSegment = h / 60;
    const x = chroma * (1 - Math.abs((hueSegment % 2) - 1));
    const match = v - chroma;
    let red: number;
    let green: number;
    let blue: number;

    if (hueSegment >= 0 && hueSegment < 1) [red, green, blue] = [chroma, x, 0];
    else if (hueSegment < 2) [red, green, blue] = [x, chroma, 0];
    else if (hueSegment < 3) [red, green, blue] = [0, chroma, x];
    else if (hueSegment < 4) [red, green, blue] = [0, x, chroma];
    else if (hueSegment < 5) [red, green, blue] = [x, 0, chroma];
    else [red, green, blue] = [chroma, 0, x];

    return rgbToHex(
        (red + match) * 255,
        (green + match) * 255,
        (blue + match) * 255,
    );
}

export function initTheme() {
    const accentModal = document.getElementById("accent-color-modal");
    const accentModalClose = document.getElementById("accent-modal-close");
    const accentPresetsModal = document.getElementById("accent-presets-modal");
    const customPicker = document.getElementById("accent-custom-picker");
    const colorPlane = document.getElementById("accent-color-sv-plane");
    const hueSlider = document.getElementById(
        "accent-color-hue",
    ) as HTMLInputElement | null;
    const hexInput = document.getElementById(
        "accent-color-hex",
    ) as HTMLInputElement | null;
    const darkWarning = document.getElementById("accent-color-dark-warning");
    const accentPreviewCircle = document.getElementById(
        "accent-preview-circle",
    );
    const accentNameDisplay = document.getElementById("current-accent-name");
    let pickerHsv = hexToHsv("#77B6DD");
    let isDraggingPicker = false;
    let isApplyingPickerColor = false;

    function renderCustomPicker(color: string) {
        const normalized = normalizeHexColor(color) || hsvToHex(pickerHsv);
        const hueColor = hsvToHex({ h: pickerHsv.h, s: 1, v: 1 });
        customPicker?.style.setProperty("--picker-color", normalized);
        customPicker?.style.setProperty("--picker-hue-color", hueColor);
        customPicker?.style.setProperty("--picker-x", `${pickerHsv.s * 100}%`);
        customPicker?.style.setProperty(
            "--picker-y",
            `${(1 - pickerHsv.v) * 100}%`,
        );
        colorPlane?.setAttribute(
            "aria-valuenow",
            Math.round(pickerHsv.v * 100).toString(),
        );
        if (hueSlider) hueSlider.value = Math.round(pickerHsv.h).toString();
        if (hexInput) hexInput.value = normalized;
        if (darkWarning)
            darkWarning.setAttribute(
                "aria-hidden",
                String(getRelativeLuminance(normalized) >= 0.035),
            );
    }

    function syncCustomPicker(color: string) {
        const normalized = normalizeHexColor(color) || "#77B6DD";
        pickerHsv = hexToHsv(normalized);
        renderCustomPicker(normalized);
    }

    function applyCustomPickerColor() {
        const color = hsvToHex(pickerHsv);
        renderCustomPicker(color);
        isApplyingPickerColor = true;
        void updateTheme(color, "solid", "Custom").finally(() => {
            isApplyingPickerColor = false;
        });
    }

    function updatePickerFromPointer(event: PointerEvent) {
        if (!colorPlane) return;
        const rect = colorPlane.getBoundingClientRect();
        pickerHsv = {
            ...pickerHsv,
            s: clamp((event.clientX - rect.left) / rect.width, 0, 1),
            v: 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1),
        };
        applyCustomPickerColor();
    }

    async function updateTheme(
        color: string,
        mode: string = "solid",
        name?: string,
    ) {
        let actualColor = color;
        if (mode === "system") {
            actualColor = await getSystemAccentColor();
            localStorage.setItem("flu-theme-mode", "system");
            name = "System";
        } else {
            localStorage.setItem("flu-theme-mode", "solid");
            localStorage.setItem("flu-theme-color", actualColor);
            if (name) localStorage.setItem("flu-theme-name", name);
        }

        document.documentElement.style.setProperty("--accent", actualColor);
        const dimColor =
            actualColor.length === 7 ? `${actualColor}66` : actualColor;
        document.documentElement.style.setProperty(
            "--accent-dim",
            dimColor,
        );
        if (accentNameDisplay)
            accentNameDisplay.textContent =
                name || localStorage.getItem("flu-theme-name") || t("custom_name", "Custom");
        if (accentPreviewCircle)
            accentPreviewCircle.style.background = actualColor;
        if (!isApplyingPickerColor) syncCustomPicker(actualColor);

        document.querySelectorAll(".accent-preset-btn").forEach((btn) => {
            const btnColor = (btn as HTMLElement).dataset.color;
            const btnMode = (btn as HTMLElement).dataset.mode || "solid";
            const isActive =
                btnMode === mode &&
                (mode === "system" || btnColor === color);
            btn.classList.toggle("active", isActive);
        });

        document
            .querySelectorAll(".interval-slider")
            .forEach((s) => updateSliderFill(s as HTMLInputElement));
        emitSettingsChanged();
    }

    const accentSettingsTrigger = document.getElementById(
        "accent-settings-trigger",
    );
    if (accentSettingsTrigger) {
        accentSettingsTrigger.addEventListener("click", () => {
            if (accentModal) {
                accentModal.style.display = "flex";
                requestAnimationFrame(() => {
                    accentModal.classList.add("active");
                });
                document.getElementById("content")?.classList.add("blurred");
            }
        });
    }

    accentModalClose?.addEventListener("click", () => {
        if (accentModal) {
            accentModal.classList.remove("active");
            setTimeout(() => {
                accentModal.style.display = "none";
                document.getElementById("content")?.classList.remove("blurred");
            }, 300);
        }
    });

    accentPresetsModal?.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest(".accent-preset-btn");
        if (btn) {
            const color = (btn as HTMLElement).dataset.color || "#77B6DD";
            const mode = (btn as HTMLElement).dataset.mode || "solid";
            const name = (btn as HTMLElement).dataset.name;

            if (mode === "system") void updateTheme("", "system", name);
            else if (color) void updateTheme(color, "solid", name);
        }
    });

    colorPlane?.addEventListener("pointerdown", (event) => {
        isDraggingPicker = true;
        colorPlane.setPointerCapture(event.pointerId);
        updatePickerFromPointer(event);
    });
    colorPlane?.addEventListener("pointermove", (event) => {
        if (isDraggingPicker) updatePickerFromPointer(event);
    });
    colorPlane?.addEventListener("pointerup", (event) => {
        isDraggingPicker = false;
        colorPlane.releasePointerCapture(event.pointerId);
    });
    colorPlane?.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 0.1 : 0.02;
        if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
            )
        )
            return;
        event.preventDefault();
        if (event.key === "ArrowLeft")
            pickerHsv = { ...pickerHsv, s: clamp(pickerHsv.s - step, 0, 1) };
        if (event.key === "ArrowRight")
            pickerHsv = { ...pickerHsv, s: clamp(pickerHsv.s + step, 0, 1) };
        if (event.key === "ArrowUp")
            pickerHsv = { ...pickerHsv, v: clamp(pickerHsv.v + step, 0, 1) };
        if (event.key === "ArrowDown")
            pickerHsv = { ...pickerHsv, v: clamp(pickerHsv.v - step, 0, 1) };
        applyCustomPickerColor();
    });
    hueSlider?.addEventListener("input", () => {
        pickerHsv = { ...pickerHsv, h: Number(hueSlider.value) };
        applyCustomPickerColor();
    });
    hexInput?.addEventListener("input", () => {
        const normalized = normalizeHexColor(hexInput.value);
        if (normalized) void updateTheme(normalized, "solid", "Custom");
    });
    accentModal?.addEventListener("click", (e) => {
        if (e.target === accentModal) accentModalClose?.click();
    });

    const storedColor = localStorage.getItem("flu-theme-color") || "#77B6DD";
    const storedMode = localStorage.getItem("flu-theme-mode") || "solid";
    const storedName = localStorage.getItem("flu-theme-name") || "Flu";
    void updateTheme(storedColor, storedMode, storedName);

    const italicTrigger = document.getElementById("remove-italic-trigger");
    const italicToggle = document.getElementById("remove-italic-toggle");
    const storedNoItalic = localStorage.getItem("flu-no-italic") === "true";
    const acrylicTrigger = document.getElementById("acrylic-toggle-trigger");
    const acrylicToggle = document.getElementById("acrylic-toggle");
    let acrylicSupported = true;

    if (italicTrigger && italicToggle) {
        if (storedNoItalic) {
            italicToggle.classList.add("active");
            document.body.classList.add("font-no-italic");
        }

        italicTrigger.addEventListener("click", () => {
            const isNoItalic = italicToggle.classList.toggle("active");
            document.body.classList.toggle("font-no-italic", isNoItalic);
            localStorage.setItem("flu-no-italic", isNoItalic.toString());
            emitSettingsChanged();
        });
    }

    if (acrylicTrigger && acrylicToggle) {
        const syncAcrylicToggle = (enabled: boolean) => {
            acrylicToggle.classList.toggle("active", enabled);
            document.documentElement.dataset.acrylicEnabled = enabled
                ? "1"
                : "0";
        };

        syncAcrylicToggle(isAcrylicPreferred());

        void getPlatformCapabilities().then((capabilities) => {
            acrylicSupported = capabilities.window_acrylic;
            acrylicTrigger.classList.toggle("disabled", !acrylicSupported);
            acrylicTrigger.setAttribute(
                "aria-disabled",
                acrylicSupported ? "false" : "true",
            );

            if (!acrylicSupported) {
                setAcrylicPreferred(false);
                syncAcrylicToggle(false);
                void applyWindowEffects(false);
                const description = acrylicTrigger.querySelector<HTMLElement>(
                    ".settings-item-desc",
                );
                if (description) {
                    description.textContent = t("accent_unavailable", "Unavailable on this desktop");
                }
            }
        });

        acrylicTrigger.addEventListener("click", async () => {
            if (!acrylicSupported) {
                return;
            }

            const next = !acrylicToggle.classList.contains("active");
            setAcrylicPreferred(next);
            emitSettingsChanged();
            const applied = await applyWindowEffects(next);
            syncAcrylicToggle(applied);
        });
    }

    window.addEventListener("flu:settings-applied", () => {
        const nextColor = localStorage.getItem("flu-theme-color") || "#77B6DD";
        const nextMode = localStorage.getItem("flu-theme-mode") || "solid";
        const nextName = localStorage.getItem("flu-theme-name") || "Flu";
        void updateTheme(nextColor, nextMode, nextName);

        applyFonts();

        const noItalic = localStorage.getItem("flu-no-italic") === "true";
        italicToggle?.classList.toggle("active", noItalic);
        document.body.classList.toggle("font-no-italic", noItalic);
        const acrylicEnabled = acrylicSupported && isAcrylicPreferred();
        acrylicToggle?.classList.toggle("active", acrylicEnabled);
        document.documentElement.dataset.acrylicEnabled = acrylicEnabled
            ? "1"
            : "0";
    });
}
