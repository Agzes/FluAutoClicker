(() => {
    const previewTemplate = document.getElementById("hero-preview-template");
    if (previewTemplate && previewTemplate.parentElement) {
        previewTemplate.parentElement.appendChild(
            previewTemplate.content.cloneNode(true),
        );
        previewTemplate.remove();
    }

    function setAccent(hex, dim) {
        const upper = hex.toUpperCase();
        document.documentElement.style.setProperty("--accent", upper);
        document.documentElement.style.setProperty(
            "--accent-dim",
            dim || "#4F7891",
        );
        document.querySelectorAll(".accent-dot").forEach((dot) => {
            dot.classList.toggle(
                "active",
                (dot.dataset.accent || "").toUpperCase() === upper,
            );
        });
    }

    document.querySelectorAll(".accent-dot").forEach((dot) => {
        dot.addEventListener("click", () => {
            if (dot.dataset.accent) {
                setAccent(dot.dataset.accent, dot.dataset.dim);
            }
        });
    });

    function initSlideGroup(container, itemSelector, onSelect) {
        if (!container) return null;
        let indicator = container.querySelector(".slide-indicator");
        if (!indicator) {
            indicator = document.createElement("div");
            indicator.className = "slide-indicator";
            container.prepend(indicator);
        }

        const items = Array.from(container.querySelectorAll(itemSelector));
        const paddingOffset = container.classList.contains("mode-tabs") ? 2 : 1;

        function positionIndicator(target, animate = true) {
            if (!target) return;
            const prevTransition = indicator.style.transition;
            if (!animate) indicator.style.transition = "none";
            indicator.style.width = `${target.offsetWidth}px`;
            indicator.style.transform = `translateX(${target.offsetLeft - paddingOffset}px)`;
            if (!animate) {
                indicator.getBoundingClientRect();
                indicator.style.transition = prevTransition;
            }
        }

        const initial =
            items.find((el) => el.classList.contains("active")) || items[0];
        requestAnimationFrame(() => positionIndicator(initial, false));

        items.forEach((item) => {
            item.addEventListener("click", () => {
                if (item.dataset.tab && item.dataset.tab !== "mouse") {
                    item.classList.remove("lock-flash");
                    void item.offsetWidth;
                    item.classList.add("lock-flash");
                    return;
                }
                items.forEach((el) => el.classList.remove("active"));
                item.classList.add("active");
                positionIndicator(item, true);
                if (onSelect) onSelect(item);
            });
        });

        window.addEventListener("resize", () => {
            const current = items.find((el) => el.classList.contains("active"));
            positionIndicator(current, false);
        });

        return { positionIndicator, items };
    }

    const slideGroups = [];
    const registerSlide = (container, selector, onSelect) => {
        const group = initSlideGroup(container, selector, onSelect);
        if (group) slideGroups.push(group);
        return group;
    };

    const modeTabsGroup = registerSlide(
        document.getElementById("app-mode-tabs"),
        ".tab",
    );

    const siteNavGroup = initSlideGroup(
        document.getElementById("site-nav"),
        ".tab",
        (item) => {
            const viewName = item.dataset.view || "overview";
            document.querySelectorAll(".page-view").forEach((view) => {
                view.classList.toggle("active", view.id === `view-${viewName}`);
            });
            if (viewName === "overview") {
                requestAnimationFrame(() => {
                    slideGroups.forEach((group) => {
                        const current = group.items.find((el) =>
                            el.classList.contains("active"),
                        );
                        group.positionIndicator(current, false);
                    });
                    updateSliderFill(slider);
                });
            }
        },
    );

    registerSlide(
        document.getElementById("press-hold-toggle"),
        ".toggle-option",
        (item) => {
            const sec = document.getElementById("mouse-hold-duration-section");
            if (sec)
                sec.classList.toggle("expanded", item.dataset.value === "hold");
        },
    );

    registerSlide(
        document.getElementById("mouse-hold-mode-toggle"),
        ".toggle-option",
    );
    registerSlide(
        document.getElementById("mouse-click-type-toggle"),
        ".toggle-option",
    );
    registerSlide(document.getElementById("mouse-button-toggle"), ".multi-btn");

    registerSlide(
        document.getElementById("repeat-toggle"),
        ".toggle-option",
        (item) => {
            const sec = document.getElementById("mouse-repeat-finite-section");
            if (sec)
                sec.classList.toggle(
                    "expanded",
                    item.dataset.value === "finite",
                );
        },
    );

    registerSlide(
        document.getElementById("finite-mode-toggle"),
        ".toggle-option",
    );

    registerSlide(
        document.getElementById("position-toggle"),
        ".toggle-option",
        (item) => {
            const sec = document.getElementById("mouse-coord-section");
            if (sec)
                sec.classList.toggle(
                    "expanded",
                    item.dataset.value === "custom",
                );
        },
    );

    const startBtn = document.getElementById("app-start-btn");
    const startLabel = document.getElementById("app-start-label");
    const startCps = document.getElementById("app-start-cps");
    const slider = document.getElementById("mouse-slider");
    const msInput = document.getElementById("mouse-ms");
    const intervalFields = ["hours", "minutes", "seconds", "ms"].map((id) =>
        document.getElementById(`mouse-${id}`),
    );

    function getMouseIntervalMs() {
        const h = Number(document.getElementById("mouse-hours")?.value || 0);
        const m = Number(document.getElementById("mouse-minutes")?.value || 0);
        const s = Number(document.getElementById("mouse-seconds")?.value || 0);
        const ms = Number(document.getElementById("mouse-ms")?.value || 0);
        return Math.max(1, h * 3600000 + m * 60000 + s * 1000 + ms);
    }

    function updateSliderFill(el) {
        if (!el) return;
        const min = parseFloat(el.min) || 0;
        const max = parseFloat(el.max) || 1000;
        const val = parseFloat(el.value) || 0;
        const ratio =
            max === min
                ? 0
                : Math.min(1, Math.max(0, (val - min) / (max - min)));
        const thumbWidth = 16;
        const fillPx =
            el.clientWidth > thumbWidth
                ? thumbWidth / 2 + ratio * (el.clientWidth - thumbWidth)
                : ratio * 100;
        const fillStop =
            el.clientWidth > thumbWidth ? `${fillPx}px` : `${fillPx}%`;
        el.style.background = `linear-gradient(to right, var(--accent-dim) ${fillStop}, rgba(11, 11, 11, 1) ${fillStop})`;
    }

    function updateStartCps() {
        if (!startCps) return;
        const totalMs = getMouseIntervalMs();
        const cps = 1000 / totalMs;
        startCps.textContent =
            cps >= 100 ? `~ ${Math.round(cps)} CPS` : `~ ${cps.toFixed(1)} CPS`;
    }

    if (slider && msInput) {
        slider.addEventListener("input", () => {
            msInput.value = slider.value;
            updateSliderFill(slider);
            updateStartCps();
        });
        requestAnimationFrame(() => updateSliderFill(slider));
        window.addEventListener("resize", () => updateSliderFill(slider));
    }

    intervalFields.forEach((input) => {
        if (!input) return;
        input.addEventListener("input", () => {
            if (input === msInput && slider) {
                const val = Math.min(
                    1000,
                    Math.max(1, Number(msInput.value || 1)),
                );
                slider.value = String(val);
                updateSliderFill(slider);
            }
            updateStartCps();
        });
    });

    let isRunning = false;

    function setStartButtonState(running) {
        isRunning = running;
        if (startBtn) startBtn.classList.toggle("running", isRunning);
        if (startLabel)
            startLabel.textContent = isRunning ? t("app.stop") : t("app.start");

        if (modeTabsGroup) {
            modeTabsGroup.items.forEach((tab) => {
                if (tab.dataset.tab !== "mouse") {
                    tab.classList.toggle("disabled", isRunning);
                }
            });
        }
    }

    if (startBtn) {
        startBtn.addEventListener("click", () =>
            setStartButtonState(!isRunning),
        );
    }

    window.addEventListener("keydown", (e) => {
        if (e.key === "F6") {
            e.preventDefault();
            setStartButtonState(!isRunning);
        }
    });

    updateStartCps();

    const pickBtn = document.getElementById("pick-btn");
    if (pickBtn) {
        pickBtn.addEventListener("click", () => {
            const xInput = document.getElementById("coord-x");
            const yInput = document.getElementById("coord-y");
            if (xInput)
                xInput.value = String(Math.floor(400 + Math.random() * 900));
            if (yInput)
                yInput.value = String(Math.floor(200 + Math.random() * 600));
        });
    }

    const drawerOverlay = document.getElementById("drawer-overlay");
    const drawerShell = document.getElementById("drawer-shell");
    const drawerTitle = document.getElementById("drawer-title");
    const drawerIcon = document.getElementById("drawer-icon");
    const drawerBody = document.getElementById("drawer-body");
    const drawerCloseBtn = document.getElementById("drawer-close-btn");
    const langTriggerBtn = document.getElementById("lang-trigger-btn");
    const langCurrentCode = document.getElementById("lang-current-code");
    const langModalOverlay = document.getElementById("lang-modal-overlay");
    const langModalClose = document.getElementById("lang-modal-close");
    const langOptionBtns = Array.from(document.querySelectorAll(".lang-card"));

    const I18N = window.FLU_I18N || {};
    let currentLang = "en";
    let activeDrawerKey = null;

    function t(key) {
        const dict = I18N[currentLang] || I18N.en || {};
        if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
        const fallback = I18N.en || {};
        return Object.prototype.hasOwnProperty.call(fallback, key)
            ? fallback[key]
            : key;
    }

    const DRAWER_ICONS = {
        settings: "&#xe154;",
        hotkeys: "&#xe284;",
        profiles: "&#xe36b;",
        help: "&#xe47b;",
        jiggler: "&#57987;",
    };

    function openDrawer(key) {
        const icon = DRAWER_ICONS[key];
        if (!icon || !drawerShell || !drawerOverlay) return;
        activeDrawerKey = key;
        const title = t(`drawer.${key}.title`);
        const desc = t(`drawer.${key}.desc`);
        const downloadLabel = t("drawer.download");
        drawerTitle.textContent = title;
        drawerIcon.innerHTML = icon;
        drawerBody.innerHTML = `
            <div class="drawer-stub">
                <span class="icon">${icon}</span>
                <div class="drawer-stub-title">${title}</div>
                <div class="drawer-stub-desc">${desc}</div>
                <a
                    href="https://github.com/Agzes/FluAutoClicker/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="drawer-stub-btn"
                >${downloadLabel}</a>
            </div>
        `;
        drawerOverlay.classList.add("active");
        drawerShell.classList.add("active");
        drawerShell.setAttribute("aria-hidden", "false");
    }

    function closeDrawer() {
        if (!drawerShell || !drawerOverlay) return;
        activeDrawerKey = null;
        drawerOverlay.classList.remove("active");
        drawerShell.classList.remove("active");
        drawerShell.setAttribute("aria-hidden", "true");
    }

    let flagsLoaded = false;
    let flagsPromise = null;

    function renderLangFlags() {
        const flags = window.FLU_FLAGS;
        if (!flags) return false;
        langOptionBtns.forEach((btn) => {
            const code = btn.dataset.lang;
            const slot = btn.querySelector(".lang-card-flag");
            if (code && slot && flags[code]) {
                slot.innerHTML = flags[code];
            }
        });
        flagsLoaded = true;
        return true;
    }

    function loadLangFlags() {
        if (flagsLoaded || renderLangFlags()) return Promise.resolve();
        if (flagsPromise) return flagsPromise;
        flagsPromise = new Promise((resolve) => {
            const script = document.createElement("script");
            script.src = "flags.js";
            script.async = true;
            script.onload = () => {
                renderLangFlags();
                resolve();
            };
            script.onerror = () => {
                flagsPromise = null;
                resolve();
            };
            document.head.appendChild(script);
        });
        return flagsPromise;
    }

    function openLangModal() {
        if (!langModalOverlay) return;
        loadLangFlags();
        langModalOverlay.classList.add("active");
        langModalOverlay.setAttribute("aria-hidden", "false");
    }

    function closeLangModal() {
        if (!langModalOverlay) return;
        langModalOverlay.classList.remove("active");
        langModalOverlay.setAttribute("aria-hidden", "true");
    }

    function applyLanguage(lang) {
        currentLang = Object.prototype.hasOwnProperty.call(I18N, lang)
            ? lang
            : "en";
        document.documentElement.lang = currentLang;
        if (langCurrentCode) {
            langCurrentCode.textContent = currentLang.toUpperCase();
        }
        langOptionBtns.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.lang === currentLang);
        });
        try {
            localStorage.setItem("flu-lang", currentLang);
        } catch (_) {}

        document.querySelectorAll("[data-i18n]").forEach((el) => {
            const key = el.dataset.i18n;
            if (!key) return;
            el.textContent = t(key);
        });

        if (startLabel) {
            startLabel.textContent = isRunning ? t("app.stop") : t("app.start");
        }

        if (activeDrawerKey) {
            openDrawer(activeDrawerKey);
        }

        requestAnimationFrame(() => {
            if (siteNavGroup) {
                const currentNav = siteNavGroup.items.find((el) =>
                    el.classList.contains("active"),
                );
                siteNavGroup.positionIndicator(currentNav, false);
            }
            slideGroups.forEach((group) => {
                const current = group.items.find((el) =>
                    el.classList.contains("active"),
                );
                group.positionIndicator(current, false);
            });
        });
    }

    if (langTriggerBtn) {
        langTriggerBtn.addEventListener("click", openLangModal);
    }
    if (langModalClose) {
        langModalClose.addEventListener("click", closeLangModal);
    }
    if (langModalOverlay) {
        langModalOverlay.addEventListener("click", (e) => {
            if (e.target === langModalOverlay) closeLangModal();
        });
    }
    window.addEventListener("keydown", (e) => {
        if (
            e.key === "Escape" &&
            langModalOverlay &&
            langModalOverlay.classList.contains("active")
        ) {
            closeLangModal();
        }
    });
    langOptionBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.dataset.lang) {
                applyLanguage(btn.dataset.lang);
                closeLangModal();
            }
        });
    });

    let initialLang = "en";
    try {
        const saved = localStorage.getItem("flu-lang");
        if (saved && Object.prototype.hasOwnProperty.call(I18N, saved)) {
            initialLang = saved;
        } else {
            const browserLang = (navigator.language || "en")
                .slice(0, 2)
                .toLowerCase();
            if (Object.prototype.hasOwnProperty.call(I18N, browserLang)) {
                initialLang = browserLang;
            }
        }
    } catch (_) {}
    applyLanguage(initialLang);

    document.querySelectorAll(".footer-btn[data-drawer]").forEach((btn) => {
        btn.addEventListener("click", () => openDrawer(btn.dataset.drawer));
    });

    const jigglerQuickBtn = document.getElementById("jiggler-quick-btn");
    if (jigglerQuickBtn) {
        jigglerQuickBtn.addEventListener("click", () => openDrawer("jiggler"));
    }

    if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closeDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener("click", closeDrawer);

    const drawerDragHandle = document.getElementById("drawer-drag-handle");
    const appWindow = document.getElementById("app-window");
    if (drawerDragHandle && drawerShell && appWindow) {
        let dragging = false;
        let startY = 0;
        let startHeight = 0;

        drawerDragHandle.addEventListener("pointerdown", (e) => {
            dragging = true;
            startY = e.clientY;
            startHeight = drawerShell.getBoundingClientRect().height;
            drawerShell.style.transition = "none";
            drawerDragHandle.setPointerCapture(e.pointerId);
        });

        drawerDragHandle.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            const winHeight = appWindow.getBoundingClientRect().height;
            const deltaY = startY - e.clientY;
            const nextPct = Math.min(
                90,
                Math.max(30, ((startHeight + deltaY) / winHeight) * 100),
            );
            drawerShell.style.height = `${nextPct}%`;
        });

        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            drawerShell.style.transition = "";
        };

        drawerDragHandle.addEventListener("pointerup", endDrag);
        drawerDragHandle.addEventListener("pointercancel", endDrag);
    }
})();
