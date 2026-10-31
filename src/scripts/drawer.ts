import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notify } from "./notifications";
import { ensureUinputPermissionsForFeature } from "./uinput-permissions";
import { updateSliderFill } from "./utils";
import { t } from "./i18n";
import { LICENSE_CATEGORIES } from "../data/licenses";
import type { LicenseItem } from "../data/licenses";

const DRAWER_FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

let drawerReturnFocus: HTMLElement | null = null;

const DRAWER_HEIGHT_KEY = "flu-drawer-height-pct";
const DRAWER_HEIGHT_DEFAULT = 75;

function isVisibleElement(element: HTMLElement) {
    return Boolean(
        element.offsetWidth ||
        element.offsetHeight ||
        element.getClientRects().length,
    );
}

function getDrawerFocusableElements(drawer: HTMLElement) {
    return Array.from(
        drawer.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR),
    ).filter(
        (element) =>
            !element.hasAttribute("inert") && isVisibleElement(element),
    );
}

function setDrawerAccessibilityState(drawer: HTMLElement, isOpen: boolean) {
    drawer.toggleAttribute("inert", !isOpen);
    drawer.setAttribute("aria-hidden", isOpen ? "false" : "true");
}

function rememberDrawerReturnFocus(drawer: HTMLElement) {
    const activeElement = document.activeElement;
    if (
        activeElement instanceof HTMLElement &&
        !drawer.contains(activeElement)
    ) {
        drawerReturnFocus = activeElement;
    }
}

function restoreDrawerReturnFocus(drawer: HTMLElement) {
    const activeElement = document.activeElement;
    if (
        activeElement instanceof HTMLElement &&
        drawer.contains(activeElement)
    ) {
        activeElement.blur();
    }

    if (drawerReturnFocus?.isConnected) {
        drawerReturnFocus.focus({ preventScroll: true });
    }
    drawerReturnFocus = null;
}

const DRAWER_TITLE_KEYS: Record<string, string> = {
    Settings: "drawer.settings",
    Hotkeys: "drawer.hotkeys",
    "Profiles System": "drawer.profiles",
    "Help & Resources": "drawer.help",
    "Mouse Jiggler": "jiggler.section_title",
    "Add Macro Action": "macro.add_action",
    "Edit Macro Action": "macro.edit_action",
    "Recording Filters": "macro.recording_filters",
    General: "settings.group.general",
    Utils: "settings.group.utils",
    "Theme & Appearance": "settings.group.theme",
    Updates: "settings.group.updates",
    Licenses: "drawer.licenses",
};

export function openDrawer(sectionId: string, title: string, icon?: string) {
    const drawer = document.getElementById("drawer-shell");
    const drawerOverlay = document.getElementById("drawer-overlay");
    const drawerSection = document.getElementById("drawer-title-section");
    const drawerGroup = document.getElementById("drawer-title-group");
    const drawerTitleIcon = document.getElementById("drawer-title-icon");
    const drawerSections = document.querySelectorAll(".drawer-section");

    if (!drawer || !drawerOverlay || !drawerSection) return;

    rememberDrawerReturnFocus(drawer);
    setDrawerAccessibilityState(drawer, true);

    const titleParts = title.split(" > ");
    const translatedParts = titleParts.map((part) =>
        t(DRAWER_TITLE_KEYS[part] || "", part),
    );
    drawerSection.textContent = translatedParts[0];
    drawerSection.removeAttribute("data-i18n");
    if (translatedParts.length > 1 && drawerGroup) {
        drawerGroup.innerHTML = `<span style="color: var(--text-dim);"> ></span> ${translatedParts.slice(1).join(" > ")}`;
    } else if (drawerGroup) {
        drawerGroup.textContent = "";
    }
    if (drawerTitleIcon) {
        drawerTitleIcon.innerHTML = icon || "";
        drawerTitleIcon.style.display = icon ? "flex" : "none";
    }

    drawerSections.forEach((s) => s.classList.remove("active"));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add("active");

    drawer.classList.add("active");
    drawerOverlay.classList.add("active");
    document.getElementById("content")?.classList.add("blurred");

    setTimeout(() => refreshDrawerUi(target), 50);
}

export function closeDrawer() {
    const drawer = document.getElementById("drawer-shell");
    const drawerOverlay = document.getElementById("drawer-overlay");
    drawer?.classList.remove("active");
    drawerOverlay?.classList.remove("active");
    if (drawer) {
        restoreDrawerReturnFocus(drawer);
        setDrawerAccessibilityState(drawer, false);
    }
    setTimeout(() => {
        document.getElementById("content")?.classList.remove("blurred");
    }, 300);

    try {
        if (sessionStorage.getItem("flu-language-pending-reload") === "1") {
            sessionStorage.removeItem("flu-language-pending-reload");
            window.location.reload();
        }
    } catch {}
}

function refreshDrawerUi(section?: HTMLElement | null) {
    const rows = document.querySelectorAll(".multi-button-row");
    rows.forEach((row) => {
        const indicator = row.querySelector(".slide-indicator") as HTMLElement;
        const activeBtn = row.querySelector(".multi-btn.active") as HTMLElement;
        if (indicator && activeBtn) {
            indicator.style.width = `${activeBtn.offsetWidth}px`;
            indicator.style.left = `${activeBtn.offsetLeft}px`;
        }
    });

    section?.querySelectorAll(".interval-slider").forEach((slider) => {
        updateSliderFill(slider as HTMLInputElement);
    });
}

function bindHelpLink(elementId: string, url: string, label: string) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const openResource = async () => {
        try {
            await openUrl(url);
        } catch (error) {
            console.error(`Failed to open ${label}`, error);
            notify(`Could not open ${label}.`, "error", 2600);
        }
    };

    element.addEventListener("click", () => {
        void openResource();
    });

    element.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void openResource();
    });
}

function handleLicenseLinkClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest(".license-item-link");
    if (!target) return;
    const url = target.getAttribute("data-url");
    if (!url) return;
    e.preventDefault();
    openUrl(url).catch((err) => {
        console.error("Failed to open link", err);
        notify("Could not open link.", "error", 2600);
    });
}

function renderLicenseItem(item: LicenseItem): string {
    const parts: string[] = ['<div class="license-item">'];
    if (item.name) {
        const flagHtml = item.flagSvg
            ? `<span class="license-flag">${item.flagSvg}</span> `
            : "";
        parts.push(
            `<div class="license-item-header"><div class="license-item-name-row"><span class="license-item-name">${flagHtml}${item.name}</span>`,
        );
        if (item.license) {
            parts.push(
                `<span class="license-item-type">${item.license}</span>`,
            );
        }
        parts.push("</div>");
        if (item.author) {
            parts.push(
                `<span class="license-item-by">by ${item.author}</span>`,
            );
        }
        parts.push("</div>");
    }
    if (item.description) {
        parts.push(`<div class="license-item-text">${item.description}</div>`);
    }
    const links: string[] = [];
    if (item.licenseLink && item.licenseLinkAlt) {
        links.push(
            `<span class="license-item-link" data-url="${item.licenseLink}">MIT</span>`,
        );
        links.push(
            `<span class="license-item-link" data-url="${item.licenseLinkAlt}">Apache-2.0</span>`,
        );
        if (item.licenseLinkThird) {
            links.push(
                `<span class="license-item-link" data-url="${item.licenseLinkThird}">zlib</span>`,
            );
        }
    } else if (item.licenseLink) {
        links.push(
            `<span class="license-item-link" data-url="${item.licenseLink}">${t("licenses.btn_license", "License")}</span>`,
        );
    }
    if (item.link) {
        links.push(
            `<span class="license-item-link" data-url="${item.link}">${t("licenses.btn_project", "Project")}</span>`,
        );
    }
    if (item.linkAlt) {
        links.push(
            `<span class="license-item-link" data-url="${item.linkAlt}">${t("licenses.btn_mirror", "Mirror")}</span>`,
        );
    }
    if (item.linkArchived) {
        links.push(
            `<span class="license-item-link" data-url="${item.linkArchived}">${t("licenses.btn_legacy", "Legacy")}</span>`,
        );
    }
    if (item.packageLink) {
        links.push(
            `<span class="license-item-link" data-url="${item.packageLink}">${t("licenses.btn_package", "Package")}</span>`,
        );
    }
    if (item.siteLink) {
        links.push(
            `<span class="license-item-link" data-url="${item.siteLink}">${t("licenses.btn_site", "Site")}</span>`,
        );
    }
    if (links.length > 0) {
        parts.push(`<div class="license-item-links">${links.join("")}</div>`);
    }
    parts.push("</div>");
    return parts.join("");
}

function renderLicenses(): void {
    const container = document.getElementById("licenses-container");
    if (!container) return;
    container.innerHTML = LICENSE_CATEGORIES.map((cat) => {
        const group: string[] = [];
        if (cat.titleKey) {
            group.push(`<h3 class="license-category">${t(cat.titleKey)}</h3>`);
        } else if (cat.titleText) {
            group.push(`<h3 class="license-category">${cat.titleText}</h3>`);
        }
        cat.items.forEach((item) => group.push(renderLicenseItem(item)));
        return group.join("");
    }).join("");
    container.addEventListener("click", handleLicenseLinkClick);
}

export function initDrawer() {
    const drawerOverlay = document.getElementById("drawer-overlay");
    const drawer = document.getElementById("drawer-shell");
    const drawerClose = document.getElementById("drawer-close-btn");

    if (drawer) {
        setDrawerAccessibilityState(
            drawer,
            drawer.classList.contains("active"),
        );

        drawer.addEventListener("keydown", (event) => {
            if (event.key !== "Tab" || !drawer.classList.contains("active"))
                return;

            const focusableElements = getDrawerFocusableElements(drawer);
            if (focusableElements.length === 0) {
                event.preventDefault();
                return;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement;

            if (event.shiftKey && activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus({ preventScroll: true });
            } else if (!event.shiftKey && activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus({ preventScroll: true });
            }
        });
    }

    drawerClose?.addEventListener("click", closeDrawer);
    drawerOverlay?.addEventListener("click", closeDrawer);

    document
        .getElementById("settings-btn")
        ?.addEventListener("click", () =>
            openDrawer("section-settings", "Settings > General", "&#xe154;"),
        );
    document
        .getElementById("hotkeys-btn")
        ?.addEventListener("click", () =>
            openDrawer("section-hotkeys", "Hotkeys", "&#xe284;"),
        );
    document
        .getElementById("profiles-btn")
        ?.addEventListener("click", () =>
            openDrawer("section-profiles", "Profiles System", "&#xe36b;"),
        );
    document
        .getElementById("help-btn")
        ?.addEventListener("click", () =>
            openDrawer("section-help", "Help & Resources", "&#xe47b;"),
        );
    bindHelpLink(
        "help-discord-link",
        "https://agzes.github.io/go/to/discord",
        "Discord",
    );
    bindHelpLink(
        "help-github-link",
        "https://github.com/Agzes/FluAutoClicker",
        "GitHub",
    );
    document
        .getElementById("help-licenses-link")
        ?.addEventListener("click", () =>
            openDrawer("section-licenses", "Licenses", "&#58696;"),
        );
    renderLicenses();
    initDrawerResize();
    initDrawerHoverTitle();

    return { openDrawer, closeDrawer };
}

export function initJiggler() {
    const jigglerToggle = document.getElementById("jiggler-toggle");
    if (jigglerToggle) {
        jigglerToggle.addEventListener("click", async () => {
            if (!(await ensureUinputPermissionsForFeature())) {
                return;
            }

            const newState = (await invoke("toggle_jiggler")) as boolean;
            jigglerToggle.classList.toggle("active", newState);

            const mainBtn = document.getElementById("jiggler-btn");
            mainBtn?.classList.toggle("active", newState);
        });
    }

    const patternRow = document.getElementById("jiggler-pattern-row");
    if (patternRow) {
        const buttons = patternRow.querySelectorAll(".multi-btn");
        const ozoneHelp = document.getElementById("jiggler-ozone-help");
        const syncOzoneHelp = () => {
            const activePattern = (
                patternRow.querySelector(
                    ".multi-btn.active",
                ) as HTMLElement | null
            )?.dataset.pattern;
            ozoneHelp?.classList.toggle("visible", activePattern === "ozn");
        };
        const positionIndicator = () => {
            const indicator = patternRow.querySelector(
                ".slide-indicator",
            ) as HTMLElement | null;
            const activeBtn = patternRow.querySelector(
                ".multi-btn.active",
            ) as HTMLElement | null;
            if (indicator && activeBtn) {
                indicator.style.width = `${activeBtn.offsetWidth}px`;
                indicator.style.left = `${activeBtn.offsetLeft}px`;
            }
        };
        syncOzoneHelp();
        positionIndicator();
        buttons.forEach((btn) => {
            btn.addEventListener("click", async () => {
                buttons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                syncOzoneHelp();
                positionIndicator();

                const pattern = (btn as HTMLElement).dataset.pattern;
                if (pattern) {
                    await invoke("set_jiggler_pattern", { pattern });
                }
            });
        });
    }

    const intervalSlider = document.getElementById(
        "jiggler-slider",
    ) as HTMLInputElement;
    if (intervalSlider) {
        intervalSlider.addEventListener("input", () => {
            const value = parseInt(intervalSlider.value);
            const valueDisplay = intervalSlider.parentElement?.querySelector(
                ".visual-slider-value",
            );
            if (valueDisplay) {
                valueDisplay.textContent = `${value}s`;
            }

            invoke("set_jiggler_interval", { interval: value * 1000 });
        });
    }

    const distanceSlider = document.getElementById(
        "jiggler-distance-slider",
    ) as HTMLInputElement;
    if (distanceSlider) {
        distanceSlider.addEventListener("input", () => {
            const value = parseInt(distanceSlider.value);
            const valueDisplay = distanceSlider.parentElement?.querySelector(
                ".visual-slider-value",
            );
            if (valueDisplay) {
                valueDisplay.textContent = `${value}px`;
            }
            invoke("set_jiggler_distance", { distance: value });
        });
    }

    void listen("jiggler-status-changed", (event) => {
        const payload = event.payload as { active?: boolean };
        const active = Boolean(payload?.active);
        jigglerToggle?.classList.toggle("active", active);
        document
            .getElementById("jiggler-btn")
            ?.classList.toggle("active", active);
    });
}

export function initTimingModal(onConfirm: () => void) {
    const modal = document.getElementById("timing-warning-modal");
    const track = document.getElementById("timing-unlock-track");
    const progress = document.getElementById("timing-unlock-progress");
    const text = track?.querySelector(".unlock-slider-text");
    const handle = document.getElementById("timing-unlock-handle");
    const cancel = document.getElementById("timing-cancel-btn");

    if (modal && track && handle && cancel) {
        let isDragging = false;
        let startX = 0;
        let currentX = 0;
        let maxDelta = 0;
        const handleTransition =
            "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), background 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s ease";
        const handleDragTransition =
            "transform 0s linear, background 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s ease";
        const progressTransition =
            "width 0.3s cubic-bezier(0.16, 1, 0.3, 1), background 0.35s cubic-bezier(0.16, 1, 0.3, 1)";
        const progressDragTransition =
            "width 0s linear, background 0.35s cubic-bezier(0.16, 1, 0.3, 1)";

        const resetHandle = () => {
            isDragging = false;
            currentX = 0;
            handle.style.transform = "translateX(0)";
            handle.style.transition = handleTransition;
            if (progress) {
                progress.style.width = "0";
                progress.style.transition = progressTransition;
            }
            if (text)
                text.textContent = t(
                    "timing.slide_to_confirm",
                    "Slide to confirm",
                );
            track.classList.remove("unlocked");
        };

        const startDragging = (clientX: number) => {
            isDragging = true;
            maxDelta = track.clientWidth - handle.clientWidth - 8;
            startX = clientX - currentX;
            handle.style.transition = handleDragTransition;
            if (progress) progress.style.transition = progressDragTransition;
        };

        const moveDragging = (clientX: number) => {
            if (!isDragging) return;

            let delta = clientX - startX;
            if (delta < 0) delta = 0;
            if (delta > maxDelta) delta = maxDelta;

            currentX = delta;
            handle.style.transform = `translateX(${delta}px)`;
            if (progress) {
                progress.style.width = `${delta + 21}px`;
            }

            const iconEl = document.getElementById("timing-unlock-icon");
            if (delta >= maxDelta * 0.98) {
                track.classList.add("unlocked");
                if (text)
                    text.textContent = t(
                        "timing.release_to_confirm",
                        "Release to confirm",
                    );
                if (iconEl) iconEl.innerHTML = "&#58544;";
            } else {
                track.classList.remove("unlocked");
                if (text)
                    text.textContent = t(
                        "timing.slide_to_confirm",
                        "Slide to confirm",
                    );
                if (iconEl) iconEl.innerHTML = "&#58591;";
            }
        };

        handle.addEventListener("mousedown", (e) => startDragging(e.clientX));
        window.addEventListener("mousemove", (e) => moveDragging(e.clientX));
        window.addEventListener("mouseup", () => {
            if (!isDragging) return;
            if (currentX >= maxDelta * 0.98) {
                modal.classList.remove("active");
                setTimeout(() => {
                    modal.style.display = "none";
                    document
                        .getElementById("content")
                        ?.classList.remove("blurred");
                }, 300);
                onConfirm();
                setTimeout(resetHandle, 300);
            } else {
                resetHandle();
            }
            isDragging = false;
        });

        handle.addEventListener(
            "touchstart",
            (e) => startDragging(e.touches[0].clientX),
            { passive: true },
        );
        window.addEventListener(
            "touchmove",
            (e) => moveDragging(e.touches[0].clientX),
            { passive: true },
        );
        window.addEventListener("touchend", () => {
            if (!isDragging) return;
            if (currentX >= maxDelta * 0.98) {
                modal.classList.remove("active");
                setTimeout(() => {
                    modal.style.display = "none";
                    document
                        .getElementById("content")
                        ?.classList.remove("blurred");
                }, 300);
                onConfirm();
                setTimeout(resetHandle, 300);
            } else {
                resetHandle();
            }
            isDragging = false;
        });

        cancel.addEventListener("click", () => {
            modal.classList.remove("active");
            setTimeout(() => {
                modal.style.display = "none";
                document.getElementById("content")?.classList.remove("blurred");
            }, 300);
            resetHandle();
        });
    }
}

function getDrawerHeightPct(): number {
    try {
        const v = localStorage.getItem(DRAWER_HEIGHT_KEY);
        if (v !== null) {
            const n = Number(v);
            if (!isNaN(n) && n >= 25 && n <= 90) return n;
        }
    } catch {}
    return DRAWER_HEIGHT_DEFAULT;
}

function saveDrawerHeightPct(pct: number) {
    try {
        localStorage.setItem(DRAWER_HEIGHT_KEY, String(pct));
    } catch {}
}

function applyDrawerHeightPct(pct: number) {
    const drawer = document.getElementById("drawer-shell");
    if (!drawer) return;
    const maxH = window.innerHeight * (pct / 100);
    const minH = window.innerHeight * 0.25;
    const clamped = Math.max(minH, maxH);
    drawer.style.height = `${clamped}px`;
}

function setDrawerHeight(heightPx: number) {
    const drawer = document.getElementById("drawer-shell");
    if (!drawer) return;
    const maxH = window.innerHeight * 0.9;
    const minH = window.innerHeight * 0.25;
    const clamped = Math.max(minH, Math.min(maxH, heightPx));
    drawer.style.height = `${clamped}px`;
}

export function initDrawerResize() {
    const handle = document.getElementById("drawer-drag-handle");
    const drawer = document.getElementById("drawer-shell");
    if (!handle || !drawer) return;

    applyDrawerHeightPct(getDrawerHeightPct());

    let isDragging = false;
    let startY = 0;
    let startHeight = 0;

    const onStart = (clientY: number) => {
        isDragging = true;
        startY = clientY;
        startHeight = drawer.offsetHeight;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
    };

    const onMove = (clientY: number) => {
        if (!isDragging) return;
        const maxDelta = window.innerHeight * 0.9 - startHeight;
        const minDelta = window.innerHeight * 0.25 - startHeight;
        let delta = startY - clientY;
        delta = Math.max(minDelta, Math.min(maxDelta, delta));
        setDrawerHeight(startHeight + delta);
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const pct = Math.round(
            (drawer.offsetHeight / window.innerHeight) * 100,
        );
        saveDrawerHeightPct(Math.max(25, Math.min(90, pct)));
    };

    handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onStart(e.clientY);
    });
    window.addEventListener("mousemove", (e) => onMove(e.clientY));
    window.addEventListener("mouseup", onEnd);

    handle.addEventListener(
        "touchstart",
        (e) => {
            onStart(e.touches[0].clientY);
        },
        { passive: true },
    );
    window.addEventListener(
        "touchmove",
        (e) => {
            onMove(e.touches[0].clientY);
        },
        { passive: true },
    );
    window.addEventListener("touchend", onEnd);
}

function setDrawerTitleHtml(group: string) {
    const groupEl = document.getElementById("drawer-title-group");
    const section = document.getElementById("drawer-title-section");
    if (!groupEl || !section) return;

    const translatedGroup = t(DRAWER_TITLE_KEYS[group] || "", group);
    const newHtml = `<span style="color: var(--text-dim);"> ></span> ${translatedGroup}`;
    if (groupEl.innerHTML === newHtml) return;

    const oldSectionRect = section.getBoundingClientRect();
    const oldSectionCenter = oldSectionRect.left + oldSectionRect.width / 2;

    groupEl.classList.add("slide-out");

    setTimeout(() => {
        groupEl.innerHTML = newHtml;

        const newSectionRect = section.getBoundingClientRect();
        const newSectionCenter = newSectionRect.left + newSectionRect.width / 2;
        const movedBy = newSectionCenter - oldSectionCenter;

        section.style.transition = "none";
        section.style.transform = `translateX(${-movedBy}px)`;
        void section.offsetWidth;

        groupEl.classList.remove("slide-out");
        groupEl.classList.add("slide-in");

        section.style.transition =
            "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)";
        section.style.transform = "translateX(0)";

        void groupEl.offsetWidth;

        groupEl.classList.add("slide-in-active");

        setTimeout(() => {
            groupEl.classList.remove("slide-in", "slide-in-active");
            section.style.transition = "";
            section.style.transform = "";
        }, 220);
    }, 200);
}

function initDrawerHoverTitle() {
    const wrapper = document.getElementById("drawer-sections-wrapper");
    if (!wrapper) return;

    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let currentGroup = "";

    const getGroupForItem = (item: HTMLElement): string | null => {
        let el: HTMLElement | null = item;
        while (el && el !== wrapper && el.parentElement !== wrapper) {
            const prev = el.previousElementSibling as HTMLElement | null;
            if (prev && prev.hasAttribute("data-group")) {
                return prev.getAttribute("data-group");
            }
            el = prev;
        }
        return null;
    };

    wrapper.addEventListener("mouseover", (e) => {
        const target = (e.target as HTMLElement).closest(
            ".settings-list-item, .hotkey-list-item, .help-list-item",
        );
        if (!target) return;

        const group = getGroupForItem(target as HTMLElement);
        if (!group || group === currentGroup) return;

        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            currentGroup = group;
            setDrawerTitleHtml(group);
        }, 200);
    });
}
