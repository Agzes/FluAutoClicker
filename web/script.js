(() => {
    const REPO_OWNER = "Agzes";
    const REPO_NAME = "FluAutoClicker";
    const GITHUB_REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
    const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
    const GITHUB_LATEST_URL = `${GITHUB_RELEASES_URL}/latest`;
    const GITHUB_RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=10`;
    const GITHUB_NOTES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/docs/release-notes`;
    const RAW_BASE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main`;
    const LOCAL_RELEASES_URL = "releases.json";
    const CACHE_TTL_MS = 15 * 60 * 1000;
    const RELEASE_CACHE_KEY = "flu-latest-release-v1";
    const CHANGELOG_CACHE_KEY = "flu-changelog-cache-v1";

    const previewTemplate = document.getElementById("hero-preview-template");
    if (previewTemplate && previewTemplate.parentElement) {
        previewTemplate.parentElement.appendChild(
            previewTemplate.content.cloneNode(true),
        );
        previewTemplate.remove();
    }

    function setAccent(hex, dim, persist = true) {
        const upper = hex.toUpperCase();
        const dimVal = dim || "#4F7891";
        document.documentElement.style.setProperty("--accent", upper);
        document.documentElement.style.setProperty("--accent-dim", dimVal);
        document.querySelectorAll(".accent-dot").forEach((dot) => {
            dot.classList.toggle(
                "active",
                (dot.dataset.accent || "").toUpperCase() === upper,
            );
        });
        if (persist) {
            try {
                localStorage.setItem(
                    "flu-accent",
                    JSON.stringify({ accent: upper, dim: dimVal }),
                );
            } catch (_) {}
        }
    }

    try {
        const savedAccent = localStorage.getItem("flu-accent");
        if (savedAccent) {
            const parsed = JSON.parse(savedAccent);
            if (parsed && typeof parsed.accent === "string") {
                setAccent(parsed.accent, parsed.dim, false);
            }
        }
    } catch (_) {}

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
                if (onSelect && onSelect(item) === false) return;
                items.forEach((el) => el.classList.remove("active"));
                item.classList.add("active");
                positionIndicator(item, true);
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
            } else if (viewName === "changelog") {
                ensureChangelogLoaded();
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

    let isRunning = false;
    let simClicks = 0;
    let simTimerId = null;

    function updateStartCps() {
        if (!startCps) return;
        const totalMs = getMouseIntervalMs();
        const cps = 1000 / totalMs;
        const base =
            cps >= 100 ? `~ ${Math.round(cps)} CPS` : `~ ${cps.toFixed(1)} CPS`;
        startCps.textContent = isRunning
            ? `${base} • ${simClicks} ${t("app.clicks")}`
            : base;
    }

    function stopSimulation() {
        if (simTimerId !== null) {
            clearInterval(simTimerId);
            simTimerId = null;
        }
    }

    function startSimulation() {
        stopSimulation();
        simClicks = 0;
        updateStartCps();
        let lastTick = performance.now();
        let carryMs = 0;
        simTimerId = setInterval(() => {
            const now = performance.now();
            const intervalMs = getMouseIntervalMs();
            carryMs += now - lastTick;
            lastTick = now;
            if (carryMs >= intervalMs) {
                const steps = Math.floor(carryMs / intervalMs);
                carryMs -= steps * intervalMs;
                simClicks += steps;
                updateStartCps();
            }
        }, 50);
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

    function setStartButtonState(running) {
        isRunning = running;
        if (startBtn) startBtn.classList.toggle("running", isRunning);
        if (startLabel)
            startLabel.textContent = isRunning ? t("app.stop") : t("app.start");

        if (isRunning) {
            startSimulation();
        } else {
            stopSimulation();
            updateStartCps();
        }

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
    let latestVersionTag = "v0.1.0-beta.9";

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
        cps: "&#59030;",
    };

    let cpsTimerId = null;
    let cpsRafId = null;

    function stopCpsLoops() {
        if (cpsTimerId !== null) {
            clearInterval(cpsTimerId);
            cpsTimerId = null;
        }
        if (cpsRafId !== null) {
            cancelAnimationFrame(cpsRafId);
            cpsRafId = null;
        }
    }

    function openCpsDrawer() {
        if (!drawerShell || !drawerOverlay) return;
        stopCpsLoops();
        activeDrawerKey = "cps";
        drawerTitle.textContent = t("cps.title");
        drawerIcon.innerHTML = DRAWER_ICONS.cps;

        drawerBody.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.className = "cps-drawer";

        const modeSection = document.createElement("div");
        modeSection.className = "section-row cps-drawer-row";
        const modeRow = document.createElement("div");
        modeRow.className = "multi-button-row";
        const clickModeBtn = document.createElement("button");
        clickModeBtn.type = "button";
        clickModeBtn.className = "multi-btn active";
        clickModeBtn.dataset.value = "click";
        clickModeBtn.textContent = t("cps.click_mode");
        const holdModeBtn = document.createElement("button");
        holdModeBtn.type = "button";
        holdModeBtn.className = "multi-btn";
        holdModeBtn.dataset.value = "hold";
        holdModeBtn.textContent = t("cps.hold_mode");
        modeRow.append(clickModeBtn, holdModeBtn);
        modeSection.appendChild(modeRow);

        const timeSection = document.createElement("div");
        timeSection.className = "section-row cps-drawer-row";
        const timeRow = document.createElement("div");
        timeRow.className = "multi-button-row";
        [5, 10, 15, 25, 60].forEach((sec, idx) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = idx === 0 ? "multi-btn active" : "multi-btn";
            btn.dataset.value = String(sec);
            btn.textContent = `${sec}s`;
            timeRow.appendChild(btn);
        });
        timeSection.appendChild(timeRow);

        const clickArea = document.createElement("button");
        clickArea.type = "button";
        clickArea.className = "cps-click-area";
        const maxDisplay = document.createElement("div");
        maxDisplay.className = "cps-stat cps-stat-max";
        maxDisplay.textContent = "—";
        const mainDisplay = document.createElement("div");
        mainDisplay.className = "cps-count-display";
        mainDisplay.textContent = t("cps.click");
        const minDisplay = document.createElement("div");
        minDisplay.className = "cps-stat cps-stat-min";
        minDisplay.textContent = "—";
        const statusHint = document.createElement("div");
        statusHint.className = "cps-hint";
        statusHint.textContent = t("cps.ready").replace("{sec}", "5");
        clickArea.append(maxDisplay, mainDisplay, minDisplay, statusHint);

        const bottomSection = document.createElement("div");
        bottomSection.className =
            "section-row cps-drawer-row cps-drawer-row-bottom";
        const statusRow = document.createElement("div");
        statusRow.className = "cps-status-row";
        const statusLeft = document.createElement("div");
        statusLeft.className = "cps-status-left";
        const statusIcon = document.createElement("span");
        statusIcon.className = "icon cps-status-icon";
        statusIcon.innerHTML = "&#58487;";
        const resultText = document.createElement("span");
        resultText.className = "cps-result-text";
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "cps-retry-btn";
        retryBtn.textContent = t("cps.try_again");
        statusLeft.append(statusIcon, resultText);
        statusRow.append(statusLeft, retryBtn);
        bottomSection.appendChild(statusRow);

        wrap.append(modeSection, timeSection, clickArea, bottomSection);
        drawerBody.appendChild(wrap);

        const facts = t("cps.facts")
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);

        let mode = "click";
        let duration = 5;
        let clickCount = 0;
        let testRunning = false;
        let isFinished = false;
        let startTime = 0;
        let intervals = [];
        let lastClickTime = 0;
        let holdStartTime = 0;
        let isHolding = false;
        let totalHoldTime = 0;

        function showRandomFact() {
            if (facts.length > 0) {
                resultText.textContent =
                    facts[Math.floor(Math.random() * facts.length)];
            }
        }

        function formatMs(ms) {
            if (ms < 10) return `${ms.toFixed(1)}ms`;
            if (ms < 1000) return `${Math.round(ms)}ms`;
            return `${(ms / 1000).toFixed(2)}s`;
        }

        function calcStats() {
            if (intervals.length === 0) return { min: 0, max: 0 };
            let min = intervals[0];
            let max = intervals[0];
            for (const v of intervals) {
                if (v < min) min = v;
                if (v > max) max = v;
            }
            return { min, max };
        }

        function updateDisplayLoop() {
            if (isFinished) return;
            if (testRunning) {
                if (mode === "click") {
                    const stats = calcStats();
                    mainDisplay.textContent = String(clickCount);
                    maxDisplay.textContent =
                        intervals.length > 0
                            ? `MAX ${formatMs(stats.max)}`
                            : "—";
                    minDisplay.textContent =
                        intervals.length > 0
                            ? `MIN ${formatMs(stats.min)}`
                            : "—";
                } else {
                    if (isHolding) {
                        const cur = Math.round(
                            performance.now() - holdStartTime,
                        );
                        mainDisplay.textContent = `${cur}ms`;
                    } else {
                        mainDisplay.textContent =
                            totalHoldTime > 0
                                ? `${Math.round(totalHoldTime)}ms`
                                : t("cps.hold");
                    }
                    maxDisplay.textContent = "";
                    minDisplay.textContent = "";
                }
            }
            cpsRafId = requestAnimationFrame(updateDisplayLoop);
        }

        function finishTest() {
            testRunning = false;
            isFinished = true;
            stopCpsLoops();
            statusHint.textContent = t("cps.finished");
            retryBtn.classList.add("ready");
            if (mode === "click") {
                const cps = clickCount / duration;
                mainDisplay.textContent = `${cps.toFixed(1)} CPS`;
            } else {
                if (isHolding) {
                    totalHoldTime += performance.now() - holdStartTime;
                    isHolding = false;
                }
                mainDisplay.textContent = `${Math.round(totalHoldTime)}ms`;
            }
        }

        function resetTest() {
            stopCpsLoops();
            testRunning = false;
            isFinished = false;
            clickCount = 0;
            intervals = [];
            lastClickTime = 0;
            isHolding = false;
            totalHoldTime = 0;
            retryBtn.classList.remove("ready");
            mainDisplay.textContent =
                mode === "click" ? t("cps.click") : t("cps.hold");
            maxDisplay.textContent = "—";
            minDisplay.textContent = "—";
            statusHint.textContent = t("cps.ready").replace(
                "{sec}",
                String(duration),
            );
            showRandomFact();
            cpsRafId = requestAnimationFrame(updateDisplayLoop);
        }

        function startTest(now) {
            testRunning = true;
            startTime = now;
            cpsTimerId = setInterval(() => {
                const elapsed = (performance.now() - startTime) / 1000;
                const left = Math.max(0, duration - elapsed);
                if (left <= 0) {
                    finishTest();
                } else {
                    statusHint.textContent = t("cps.left").replace(
                        "{sec}",
                        left.toFixed(1),
                    );
                }
            }, 50);
        }

        function spawnRipple(e) {
            const rect = clickArea.getBoundingClientRect();
            const ripple = document.createElement("span");
            ripple.className = "cps-ripple";
            const x = e.clientX ? e.clientX - rect.left : rect.width / 2;
            const y = e.clientY ? e.clientY - rect.top : rect.height / 2;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            clickArea.appendChild(ripple);
            ripple.addEventListener("animationend", () => ripple.remove());
        }

        clickArea.addEventListener("pointerdown", (e) => {
            if (isFinished) return;
            const now =
                typeof e.timeStamp === "number"
                    ? e.timeStamp
                    : performance.now();
            clickArea.classList.add("clicking");
            spawnRipple(e);
            if (!testRunning) startTest(now);

            if (mode === "click") {
                if (lastClickTime > 0) {
                    intervals.push(now - lastClickTime);
                }
                lastClickTime = now;
                clickCount += 1;
            } else {
                isHolding = true;
                holdStartTime = now;
            }
        });

        const releaseHold = () => {
            clickArea.classList.remove("clicking");
            if (mode === "hold" && isHolding && testRunning) {
                totalHoldTime += performance.now() - holdStartTime;
                isHolding = false;
            }
        };
        clickArea.addEventListener("pointerup", releaseHold);
        clickArea.addEventListener("pointercancel", releaseHold);

        retryBtn.addEventListener("click", resetTest);

        initSlideGroup(modeRow, ".multi-btn", (btn) => {
            if (testRunning || isFinished) return false;
            mode = btn.dataset.value === "hold" ? "hold" : "click";
            resetTest();
        });

        initSlideGroup(timeRow, ".multi-btn", (btn) => {
            if (testRunning || isFinished) return false;
            duration = parseInt(btn.dataset.value || "5", 10) || 5;
            resetTest();
        });

        resetTest();

        drawerOverlay.classList.add("active");
        drawerShell.classList.add("active");
        drawerShell.setAttribute("aria-hidden", "false");
    }

    function openDrawer(key) {
        if (key === "cps") {
            openCpsDrawer();
            return;
        }
        const icon = DRAWER_ICONS[key];
        if (!icon || !drawerShell || !drawerOverlay) return;
        stopCpsLoops();
        activeDrawerKey = key;
        const title = t(`drawer.${key}.title`);
        const rawDesc = t(`drawer.${key}.desc`);
        const desc = rawDesc.replace("{version}", latestVersionTag);
        const downloadLabel = t("drawer.download");
        drawerTitle.textContent = title;
        drawerIcon.innerHTML = icon;

        drawerBody.innerHTML = "";
        const stub = document.createElement("div");
        stub.className = "drawer-stub";

        const iconSpan = document.createElement("span");
        iconSpan.className = "icon";
        iconSpan.innerHTML = icon;

        const titleEl = document.createElement("div");
        titleEl.className = "drawer-stub-title";
        titleEl.textContent = title;

        const descEl = document.createElement("div");
        descEl.className = "drawer-stub-desc";
        descEl.textContent = desc;

        const btn = document.createElement("a");
        btn.href =
            document.getElementById("hero-download-btn")?.href ||
            GITHUB_LATEST_URL;
        btn.target = "_blank";
        btn.rel = "noopener noreferrer";
        btn.className = "drawer-stub-btn";
        btn.textContent = downloadLabel;

        stub.append(iconSpan, titleEl, descEl, btn);
        drawerBody.appendChild(stub);

        drawerOverlay.classList.add("active");
        drawerShell.classList.add("active");
        drawerShell.setAttribute("aria-hidden", "false");
    }

    function closeDrawer() {
        if (!drawerShell || !drawerOverlay) return;
        stopCpsLoops();
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
        updateStartCps();

        if (activeDrawerKey) {
            openDrawer(activeDrawerKey);
        }

        if (changelogState.entries.length > 0) {
            renderChangelogEntries(changelogState.entries);
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

    function normalizeVersionStr(raw) {
        return String(raw || "")
            .trim()
            .replace(/\.md$/i, "")
            .replace(/^v\.?/i, "");
    }

    function parseSemver(raw) {
        const cleaned = normalizeVersionStr(raw).split("+")[0];
        const dashIdx = cleaned.indexOf("-");
        const coreStr = dashIdx >= 0 ? cleaned.slice(0, dashIdx) : cleaned;
        const preStr = dashIdx >= 0 ? cleaned.slice(dashIdx + 1) : "";
        return {
            core: coreStr.split(".").map((part) => {
                const n = Number.parseInt(part, 10);
                return Number.isFinite(n) ? n : 0;
            }),
            pre: preStr,
        };
    }

    function compareVersionsDesc(a, b) {
        const pa = parseSemver(a);
        const pb = parseSemver(b);
        const len = Math.max(pa.core.length, pb.core.length);
        for (let i = 0; i < len; i += 1) {
            const va = pa.core[i] || 0;
            const vb = pb.core[i] || 0;
            if (va !== vb) return vb - va;
        }
        if (!pa.pre && !pb.pre) return 0;
        if (!pa.pre) return -1;
        if (!pb.pre) return 1;
        const leftParts = pa.pre.split(".");
        const rightParts = pb.pre.split(".");
        const maxPre = Math.max(leftParts.length, rightParts.length);
        for (let i = 0; i < maxPre; i += 1) {
            const lp = leftParts[i];
            const rp = rightParts[i];
            if (lp === rp) continue;
            if (lp === undefined) return 1;
            if (rp === undefined) return -1;
            const ln = Number.parseInt(lp, 10);
            const rn = Number.parseInt(rp, 10);
            if (String(ln) === lp && String(rn) === rp) {
                return rn - ln;
            }
            return rp.localeCompare(lp);
        }
        return 0;
    }

    function formatDisplayTag(raw) {
        const norm = normalizeVersionStr(raw);
        return norm ? `v${norm}` : "v0.1.0-beta.9";
    }

    function isSafeHttpUrl(url) {
        try {
            const parsed = new URL(url, window.location.href);
            return parsed.protocol === "https:" || parsed.protocol === "http:";
        } catch (_) {
            return false;
        }
    }

    function readCache(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (
                !parsed ||
                typeof parsed.ts !== "number" ||
                Date.now() - parsed.ts > CACHE_TTL_MS
            ) {
                return null;
            }
            return parsed.data;
        } catch (_) {
            return null;
        }
    }

    function writeCache(key, data) {
        try {
            sessionStorage.setItem(
                key,
                JSON.stringify({ ts: Date.now(), data }),
            );
        } catch (_) {}
    }

    let localReleasesPromise = null;

    function fetchLocalReleases() {
        if (!localReleasesPromise) {
            localReleasesPromise = fetch(LOCAL_RELEASES_URL)
                .then((res) => (res.ok ? res.json() : null))
                .catch(() => null);
        }
        return localReleasesPromise;
    }

    function applyLatestRelease(info) {
        if (!info || !info.tag) return;
        latestVersionTag = info.tag;
        const targetUrl = isSafeHttpUrl(info.url)
            ? info.url
            : GITHUB_LATEST_URL;

        const headerVersion = document.getElementById("header-version-link");
        if (headerVersion) {
            headerVersion.textContent = info.tag;
            headerVersion.href = targetUrl;
        }

        const heroVer = document.getElementById("hero-download-ver");
        if (heroVer) {
            heroVer.textContent = info.tag;
        }

        const heroBtn = document.getElementById("hero-download-btn");
        if (heroBtn) {
            heroBtn.href = targetUrl;
        }

        const winRow = document.querySelector('.dl-row[data-dl="windows"]');
        if (winRow) {
            winRow.href = isSafeHttpUrl(info.winUrl) ? info.winUrl : targetUrl;
        }

        const linuxRow = document.querySelector('.dl-row[data-dl="linux"]');
        if (linuxRow) {
            linuxRow.href = targetUrl;
        }

        if (activeDrawerKey === "help") {
            openDrawer("help");
        }
    }

    async function detectLatestRelease() {
        const cached = readCache(RELEASE_CACHE_KEY);
        if (cached) {
            applyLatestRelease(cached);
            return;
        }

        const local = await fetchLocalReleases();
        if (local && local.latest && local.latest.tag) {
            applyLatestRelease(local.latest);
            return;
        }

        try {
            const res = await fetch(GITHUB_RELEASES_API, {
                headers: { Accept: "application/vnd.github+json" },
            });
            if (res.ok) {
                const releases = await res.json();
                if (Array.isArray(releases)) {
                    const valid = releases.filter(
                        (r) =>
                            r &&
                            !r.draft &&
                            r.tag_name &&
                            r.tag_name.toLowerCase() !== "nightly",
                    );
                    if (valid.length > 0) {
                        valid.sort((a, b) =>
                            compareVersionsDesc(a.tag_name, b.tag_name),
                        );
                        const top = valid[0];
                        const assets = Array.isArray(top.assets)
                            ? top.assets
                            : [];
                        const exeAsset = assets.find(
                            (a) =>
                                typeof a.name === "string" &&
                                a.name.toLowerCase().endsWith(".exe"),
                        );
                        const info = {
                            tag: formatDisplayTag(top.tag_name),
                            url: top.html_url || GITHUB_LATEST_URL,
                            winUrl: exeAsset?.browser_download_url || "",
                        };
                        writeCache(RELEASE_CACHE_KEY, info);
                        applyLatestRelease(info);
                        return;
                    }
                }
            }
        } catch (_) {}

        try {
            const res = await fetch(
                `${RAW_BASE_URL}/docs/updates/latest-beta.json`,
            );
            if (res.ok) {
                const json = await res.json();
                if (json && json.version) {
                    const info = {
                        tag: formatDisplayTag(json.version),
                        url: json.github_url || GITHUB_LATEST_URL,
                        winUrl: "",
                    };
                    writeCache(RELEASE_CACHE_KEY, info);
                    applyLatestRelease(info);
                }
            }
        } catch (_) {}
    }

    const changelogList = document.getElementById("changelog-list");
    const changelogRefreshBtn = document.getElementById(
        "changelog-refresh-btn",
    );
    const changelogState = {
        loaded: false,
        loading: false,
        entries: [],
    };

    function appendInlineMarkdown(parent, text) {
        const tokenRe =
            /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<)]+)/g;
        let lastIdx = 0;
        let match;
        while ((match = tokenRe.exec(text)) !== null) {
            if (match.index > lastIdx) {
                parent.appendChild(
                    document.createTextNode(text.slice(lastIdx, match.index)),
                );
            }
            const tok = match[0];
            if (tok.startsWith("`") && tok.endsWith("`")) {
                const code = document.createElement("code");
                code.textContent = tok.slice(1, -1);
                parent.appendChild(code);
            } else if (
                (tok.startsWith("**") && tok.endsWith("**")) ||
                (tok.startsWith("__") && tok.endsWith("__"))
            ) {
                const strong = document.createElement("strong");
                appendInlineMarkdown(strong, tok.slice(2, -2));
                parent.appendChild(strong);
            } else if (tok.startsWith("~~") && tok.endsWith("~~")) {
                const del = document.createElement("del");
                appendInlineMarkdown(del, tok.slice(2, -2));
                parent.appendChild(del);
            } else if (
                (tok.startsWith("*") && tok.endsWith("*")) ||
                (tok.startsWith("_") && tok.endsWith("_"))
            ) {
                const em = document.createElement("em");
                appendInlineMarkdown(em, tok.slice(1, -1));
                parent.appendChild(em);
            } else if (tok.startsWith("[")) {
                const closeBracket = tok.indexOf("]");
                const label = tok.slice(1, closeBracket);
                const href = tok.slice(closeBracket + 2, -1);
                if (isSafeHttpUrl(href)) {
                    const a = document.createElement("a");
                    a.href = href;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    a.textContent = label;
                    parent.appendChild(a);
                } else {
                    parent.appendChild(document.createTextNode(label));
                }
            } else if (isSafeHttpUrl(tok)) {
                const a = document.createElement("a");
                a.href = tok;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = tok;
                parent.appendChild(a);
            }
            lastIdx = tokenRe.lastIndex;
        }
        if (lastIdx < text.length) {
            parent.appendChild(document.createTextNode(text.slice(lastIdx)));
        }
    }

    function parseReleaseMarkdown(filename, markdown) {
        const lines = String(markdown || "")
            .replace(/\r\n/g, "\n")
            .split("\n");
        let title = formatDisplayTag(filename);
        let releaseDate = "";
        const fragment = document.createDocumentFragment();

        let currentList = null;
        let currentListTag = "";
        let lastTopLi = null;
        let currentSublist = null;
        let inCodeBlock = false;
        let codeLines = [];

        function closeLists() {
            currentList = null;
            currentListTag = "";
            lastTopLi = null;
            currentSublist = null;
        }

        function flushCodeBlock() {
            const pre = document.createElement("pre");
            pre.className = "changelog-pre";
            const code = document.createElement("code");
            code.textContent = codeLines.join("\n");
            pre.appendChild(code);
            fragment.appendChild(pre);
            inCodeBlock = false;
            codeLines = [];
        }

        for (const rawLine of lines) {
            const trimmed = rawLine.trim();

            if (trimmed.startsWith("```")) {
                closeLists();
                if (inCodeBlock) {
                    flushCodeBlock();
                } else {
                    inCodeBlock = true;
                    codeLines = [];
                }
                continue;
            }

            if (inCodeBlock) {
                codeLines.push(rawLine);
                continue;
            }

            if (!trimmed) {
                closeLists();
                continue;
            }

            if (/^([-*_])\1{2,}$/.test(trimmed)) {
                closeLists();
                const hr = document.createElement("hr");
                hr.className = "changelog-hr";
                fragment.appendChild(hr);
                continue;
            }

            if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
                title = trimmed
                    .slice(2)
                    .replace(/^FluAutoClicker\s+/i, "")
                    .trim();
                closeLists();
                continue;
            }

            if (/^Release date:/i.test(trimmed)) {
                releaseDate = trimmed.replace(/^Release date:/i, "").trim();
                closeLists();
                continue;
            }

            if (trimmed.startsWith("## ")) {
                closeLists();
                const h3 = document.createElement("h3");
                h3.className = "changelog-section-title";
                h3.textContent = trimmed.slice(3).trim();
                fragment.appendChild(h3);
                continue;
            }

            if (trimmed.startsWith("### ") || trimmed.startsWith("#### ")) {
                closeLists();
                const h4 = document.createElement("h4");
                h4.className = "changelog-subheading";
                h4.textContent = trimmed.replace(/^#{3,4}\s+/, "").trim();
                fragment.appendChild(h4);
                continue;
            }

            if (trimmed.startsWith("> ")) {
                closeLists();
                const bq = document.createElement("blockquote");
                bq.className = "changelog-quote";
                appendInlineMarkdown(bq, trimmed.slice(2).trim());
                fragment.appendChild(bq);
                continue;
            }

            const ulMatch = rawLine.match(/^(\s*)[-*+]\s+(.*)$/);
            const olMatch = rawLine.match(/^(\s*)\d+\.\s+(.*)$/);
            const listMatch = ulMatch || olMatch;
            if (listMatch) {
                const indent = listMatch[1].length;
                const content = listMatch[2].trim();
                const tag = olMatch ? "ol" : "ul";
                const cls = olMatch ? "changelog-ol" : "changelog-ul";

                if (!currentList || (indent < 2 && currentListTag !== tag)) {
                    currentList = document.createElement(tag);
                    currentList.className = cls;
                    currentListTag = tag;
                    lastTopLi = null;
                    currentSublist = null;
                    fragment.appendChild(currentList);
                }

                if (indent >= 2 && lastTopLi) {
                    if (!currentSublist) {
                        currentSublist = document.createElement(tag);
                        currentSublist.className = "changelog-sublist";
                        lastTopLi.appendChild(currentSublist);
                    }
                    const subLi = document.createElement("li");
                    appendInlineMarkdown(subLi, content);
                    currentSublist.appendChild(subLi);
                } else {
                    currentSublist = null;
                    const li = document.createElement("li");
                    appendInlineMarkdown(li, content);
                    currentList.appendChild(li);
                    lastTopLi = li;
                }
                continue;
            }

            closeLists();
            const p = document.createElement("p");
            p.className = "changelog-paragraph";
            appendInlineMarkdown(p, trimmed);
            fragment.appendChild(p);
        }

        if (inCodeBlock) {
            flushCodeBlock();
        }

        return {
            tag: formatDisplayTag(title),
            date: releaseDate,
            fragment,
        };
    }

    function renderChangelogLoading() {
        if (!changelogList) return;
        changelogList.innerHTML = "";
        const card = document.createElement("div");
        card.className = "section-row changelog-state";
        const spinner = document.createElement("div");
        spinner.className = "changelog-spinner";
        const msg = document.createElement("span");
        msg.textContent = t("changelog.loading");
        card.append(spinner, msg);
        changelogList.appendChild(card);
    }

    function renderChangelogError() {
        if (!changelogList) return;
        changelogList.innerHTML = "";
        const card = document.createElement("div");
        card.className = "section-row changelog-state";
        const msg = document.createElement("span");
        msg.textContent = t("changelog.error");

        const actions = document.createElement("div");
        actions.className = "changelog-toolbar-actions";

        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "header-link-btn changelog-refresh-btn";
        retryBtn.textContent = t("changelog.retry");
        retryBtn.addEventListener("click", () => loadChangelog(true));

        const ghLink = document.createElement("a");
        ghLink.href = GITHUB_RELEASES_URL;
        ghLink.target = "_blank";
        ghLink.rel = "noopener noreferrer";
        ghLink.className = "header-link-btn";
        ghLink.textContent = t("changelog.view_github");

        actions.append(retryBtn, ghLink);
        card.append(msg, actions);
        changelogList.appendChild(card);
    }

    function renderChangelogEntries(entries) {
        if (!changelogList) return;
        changelogList.innerHTML = "";

        entries.forEach((entry, index) => {
            const parsed = parseReleaseMarkdown(entry.name, entry.markdown);
            const isLatest = index === 0;
            const isBeta = /-(beta|alpha|rc)/i.test(parsed.tag);

            const card = document.createElement("article");
            card.className = "section-row changelog-card";
            if (isLatest) card.classList.add("is-latest", "expanded");

            const inner = document.createElement("div");
            inner.className = "changelog-card-inner";

            const head = document.createElement("button");
            head.type = "button";
            head.className = "changelog-card-head";
            head.setAttribute("aria-expanded", isLatest ? "true" : "false");

            const headLeft = document.createElement("div");
            headLeft.className = "changelog-head-left";

            const verTag = document.createElement("span");
            verTag.className = "changelog-version-tag";
            verTag.textContent = parsed.tag;
            headLeft.appendChild(verTag);

            if (isLatest) {
                const latestBadge = document.createElement("span");
                latestBadge.className = "changelog-badge";
                latestBadge.textContent = t("changelog.latest_badge");
                headLeft.appendChild(latestBadge);
            }

            if (isBeta) {
                const betaBadge = document.createElement("span");
                betaBadge.className = "changelog-badge is-beta";
                betaBadge.textContent = t("changelog.prerelease_badge");
                headLeft.appendChild(betaBadge);
            }

            const headRight = document.createElement("div");
            headRight.className = "changelog-head-right";

            if (parsed.date) {
                const dateEl = document.createElement("span");
                dateEl.className = "changelog-date";
                dateEl.textContent = parsed.date;
                headRight.appendChild(dateEl);
            }

            const svg = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "svg",
            );
            svg.setAttribute("class", "changelog-toggle-chevron");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "2.2");
            svg.setAttribute("stroke-linecap", "round");
            svg.setAttribute("stroke-linejoin", "round");
            const poly = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "polyline",
            );
            poly.setAttribute("points", "6 9 12 15 18 9");
            svg.appendChild(poly);
            headRight.appendChild(svg);

            head.append(headLeft, headRight);

            const body = document.createElement("div");
            body.className = "changelog-card-body";
            body.appendChild(parsed.fragment);

            head.addEventListener("click", () => {
                const nextExpanded = !card.classList.contains("expanded");
                card.classList.toggle("expanded", nextExpanded);
                head.setAttribute(
                    "aria-expanded",
                    nextExpanded ? "true" : "false",
                );
            });

            inner.append(head, body);
            card.appendChild(inner);
            changelogList.appendChild(card);
        });
    }

    async function loadChangelog(forceRefresh = false) {
        if (changelogState.loading) return;

        if (!forceRefresh) {
            const cached = readCache(CHANGELOG_CACHE_KEY);
            if (Array.isArray(cached) && cached.length > 0) {
                changelogState.entries = cached;
                changelogState.loaded = true;
                renderChangelogEntries(cached);
                return;
            }

            const local = await fetchLocalReleases();
            if (
                local &&
                Array.isArray(local.releases) &&
                local.releases.length > 0
            ) {
                changelogState.entries = local.releases;
                changelogState.loaded = true;
                renderChangelogEntries(local.releases);
                return;
            }
        }

        changelogState.loading = true;
        if (changelogRefreshBtn) {
            changelogRefreshBtn.classList.add("is-loading");
        }
        renderChangelogLoading();

        try {
            const listRes = await fetch(GITHUB_NOTES_API, {
                headers: { Accept: "application/vnd.github+json" },
            });
            if (!listRes.ok) {
                throw new Error(`GitHub API ${listRes.status}`);
            }
            const files = await listRes.json();
            if (!Array.isArray(files)) {
                throw new Error("Unexpected response");
            }

            const mdFiles = files
                .filter(
                    (f) =>
                        f &&
                        f.type === "file" &&
                        typeof f.name === "string" &&
                        f.name.toLowerCase().endsWith(".md") &&
                        isSafeHttpUrl(f.download_url),
                )
                .sort((a, b) => compareVersionsDesc(a.name, b.name));

            const results = await Promise.all(
                mdFiles.map(async (file) => {
                    const mdRes = await fetch(file.download_url);
                    if (!mdRes.ok) return null;
                    const markdown = await mdRes.text();
                    return { name: file.name, markdown };
                }),
            );

            const entries = results.filter(Boolean);
            if (entries.length === 0) {
                throw new Error("No release notes found");
            }

            changelogState.entries = entries;
            changelogState.loaded = true;
            writeCache(CHANGELOG_CACHE_KEY, entries);
            renderChangelogEntries(entries);
        } catch (_) {
            if (changelogState.entries.length > 0) {
                renderChangelogEntries(changelogState.entries);
            } else {
                renderChangelogError();
            }
        } finally {
            changelogState.loading = false;
            if (changelogRefreshBtn) {
                changelogRefreshBtn.classList.remove("is-loading");
            }
        }
    }

    function ensureChangelogLoaded() {
        if (!changelogState.loaded && !changelogState.loading) {
            loadChangelog(false);
        }
    }

    if (changelogRefreshBtn) {
        changelogRefreshBtn.addEventListener("click", () =>
            loadChangelog(true),
        );
    }

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

    detectLatestRelease();

    document.querySelectorAll(".footer-btn[data-drawer]").forEach((btn) => {
        btn.addEventListener("click", () => openDrawer(btn.dataset.drawer));
    });

    const jigglerQuickBtn = document.getElementById("jiggler-quick-btn");
    if (jigglerQuickBtn) {
        jigglerQuickBtn.addEventListener("click", () => openDrawer("jiggler"));
    }

    const cpsQuickBtn = document.getElementById("cps-quick-btn");
    if (cpsQuickBtn) {
        cpsQuickBtn.addEventListener("click", () => openDrawer("cps"));
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
