import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { emitSettingsChanged } from "./settings-persistence";
import { notify } from "./notifications";
import { t } from "./i18n";

type FontSource = "builtin" | "google" | "system" | "imported";
type FontStatus = "ready" | "loading" | "error";

export type FontFace = {
    id: string;
    name: string;
    family: string;
    category: string;
    source: FontSource;
    status: FontStatus;
};

const BUILTIN_FONTS: FontFace[] = [
    {
        id: "museo-moderno",
        name: "MuseoModerno",
        family: "MuseoModerno",
        category: "display",
        source: "builtin",
        status: "ready",
    },
    {
        id: "geologica",
        name: "Geologica",
        family: "Geologica",
        category: "sans-serif",
        source: "builtin",
        status: "ready",
    },
    {
        id: "montserrat",
        name: "Montserrat",
        family: "Montserrat",
        category: "sans-serif",
        source: "builtin",
        status: "ready",
    },
];

const GOOGLE_FONTS: FontFace[] = [
    { id: "gf-inter", name: "Inter", family: "Inter", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-opensans", name: "Open Sans", family: "Open Sans", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-notosans", name: "Noto Sans", family: "Noto Sans", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-lato", name: "Lato", family: "Lato", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-source sans", name: "Source Sans 3", family: "Source Sans 3", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-manrope", name: "Manrope", family: "Manrope", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-dmsans", name: "DM Sans", family: "DM Sans", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-ibmplex", name: "IBM Plex Sans", family: "IBM Plex Sans", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-workingsans", name: "Work Sans", family: "Work Sans", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-ptsans", name: "PT Sans", family: "PT Sans", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-wix", name: "Wix Madefor Display", family: "Wix Madefor Display", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-sansation", name: "Sansation", family: "Sansation", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-spacegrotesk", name: "Space Grotesk", family: "Space Grotesk", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-onest", name: "Onest", family: "Onest", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-plusjakarta", name: "Plus Jakarta Sans", family: "Plus Jakarta Sans", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-raleway", name: "Raleway", family: "Raleway", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-jost", name: "Jost", family: "Jost", category: "sans-serif", source: "google", status: "ready" },
    { id: "gf-calsans", name: "Cal Sans", family: "Cal Sans", category: "sans-serif", source: "google", status: "ready" },
];

const SYSTEM_FONTS: FontFace[] = [
    { id: "sys-segoe", name: "Segoe UI", family: "Segoe UI", category: "sans-serif", source: "system", status: "ready" },
    { id: "sys-arial", name: "Arial", family: "Arial", category: "sans-serif", source: "system", status: "ready" },
    { id: "sys-verdana", name: "Verdana", family: "Verdana", category: "sans-serif", source: "system", status: "ready" },
    { id: "sys-tahoma", name: "Tahoma", family: "Tahoma", category: "sans-serif", source: "system", status: "ready" },
    { id: "sys-calibri", name: "Calibri", family: "Calibri", category: "sans-serif", source: "system", status: "ready" },
    { id: "sys-consolas", name: "Consolas", family: "Consolas", category: "monospace", source: "system", status: "ready" },
];

const ALL_AVAILABLE = [...BUILTIN_FONTS, ...SYSTEM_FONTS, ...GOOGLE_FONTS];

const importedFonts: FontFace[] = [];
const downloadedGoogleFonts = new Set<string>();
const searchedGoogleFonts = new Map<string, FontFace>();
let searchTimeoutId: number | null = null;
let isSearchingExternal = false;

const FONT_APP_STORAGE_KEY = "flu-font-app";
const FONT_LOC_STORAGE_KEY = "flu-font-loc";
const DEFAULT_APP_FONT = "museo-moderno";
const DEFAULT_LOC_FONT = "geologica";

function findFontById(id: string): FontFace | undefined {
    const searched = Array.from(searchedGoogleFonts.values());
    return [...ALL_AVAILABLE, ...importedFonts, ...searched].find(
        (f) => f.id === id,
    );
}

function getStoredFontId(key: string, fallback: string): string {
    return localStorage.getItem(key) || fallback;
}

export function getFontApp(): FontFace {
    return (
        findFontById(getStoredFontId(FONT_APP_STORAGE_KEY, DEFAULT_APP_FONT)) ||
        BUILTIN_FONTS[0]
    );
}

export function getFontLoc(): FontFace {
    return (
        findFontById(getStoredFontId(FONT_LOC_STORAGE_KEY, DEFAULT_LOC_FONT)) ||
        BUILTIN_FONTS[1]
    );
}

export function getFontAppId(): string {
    return getFontApp().id;
}

export function getFontLocId(): string {
    return getFontLoc().id;
}

export function setFontApp(fontId: string): void {
    const font = findFontById(fontId);
    if (!font) return;
    localStorage.setItem(FONT_APP_STORAGE_KEY, fontId);
    applyFontApp(font);
    emitSettingsChanged();
}

export function setFontLoc(fontId: string): void {
    const font = findFontById(fontId);
    if (!font) return;
    localStorage.setItem(FONT_LOC_STORAGE_KEY, fontId);
    applyFontLoc(font);
    emitSettingsChanged();
}

export function applyFontApp(font?: FontFace): void {
    const f = font || getFontApp();
    document.documentElement.style.setProperty(
        "--font-app",
        `"${f.family}", ${f.category}`,
    );
}

export function applyFontLoc(font?: FontFace): void {
    const f = font || getFontLoc();
    document.documentElement.style.setProperty(
        "--font-loc",
        `"${f.family}", ${f.category}`,
    );
}

export function applyFonts(): void {
    applyFontApp();
    applyFontLoc();
}

function getAllFonts(): FontFace[] {
    const searched: FontFace[] = [];
    for (const font of searchedGoogleFonts.values()) {
        searched.push(font);
    }
    return [...ALL_AVAILABLE, ...importedFonts, ...searched];
}

function saveSearchedFontInfo(font: FontFace): void {
    try {
        const raw = localStorage.getItem(SEARCHED_FONTS_KEY);
        const list: { id: string; name: string; family: string }[] = raw
            ? JSON.parse(raw)
            : [];
        if (!list.some((f) => f.id === font.id)) {
            list.push({ id: font.id, name: font.name, family: font.family });
            localStorage.setItem(SEARCHED_FONTS_KEY, JSON.stringify(list));
        }
    } catch {}
}

function restoreSearchedFonts(): void {
    try {
        const raw = localStorage.getItem(SEARCHED_FONTS_KEY);
        if (!raw) return;
        const list: { id: string; name: string; family: string }[] =
            JSON.parse(raw);
        for (const item of list) {
            const font: FontFace = {
                id: item.id,
                name: item.name,
                family: item.family,
                category: "sans-serif",
                source: "google",
                status: "ready",
            };
            if (!searchedGoogleFonts.has(item.family.toLowerCase())) {
                searchedGoogleFonts.set(item.family.toLowerCase(), font);
            }
        }
    } catch {}
}

async function searchGoogleFontsApi(query: string): Promise<FontFace | null> {
    const familyEncoded = query.replace(/['"]/g, "").trim();
    if (familyEncoded.length < 2) return null;

    const cached = searchedGoogleFonts.get(familyEncoded.toLowerCase());
    if (cached) return cached;

    try {
        const url = `https://fonts.googleapis.com/css2?family=${familyEncoded.replace(/\s+/g, "+")}:wght@400;700&display=swap`;
        const resp = await fetch(url);
        if (!resp.ok) return null;

        const css = await resp.text();
        if (!css.includes("font-family")) return null;

        const nameMatch = css.match(/font-family:\s*['"]([^'"]+)['"]/);
        if (!nameMatch) return null;

        const actualName = nameMatch[1];
        const id = `gf-search-${actualName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

        const font: FontFace = {
            id,
            name: actualName,
            family: actualName,
            category: "sans-serif",
            source: "google",
            status: "ready",
        };

        searchedGoogleFonts.set(actualName.toLowerCase(), font);
        saveSearchedFontInfo(font);
        return font;
    } catch {
        return null;
    }
}

function renderFontList(
    container: HTMLElement,
    currentId: string,
    query: string,
    onSelect: (fontId: string) => void,
    onDownloadGoogle: (font: FontFace) => void,
): void {
    container.innerHTML = "";

    const lowerQuery = query.toLowerCase().trim();
    const all = getAllFonts();

    let hasVisible = false;

    for (const font of all) {
        if (font.source === "system" && font.status === "error") continue;
        if (
            lowerQuery &&
            !font.name.toLowerCase().includes(lowerQuery) &&
            !font.family.toLowerCase().includes(lowerQuery)
        ) {
            continue;
        }
        hasVisible = true;
        const card = document.createElement("button");
        card.type = "button";
        card.className = "font-card" + (font.id === currentId ? " active" : "");
        card.dataset.fontId = font.id;

        const preview = document.createElement("span");
        preview.className = "font-card-preview";
        preview.textContent = font.name;
        preview.style.fontFamily =
            font.source === "system"
                ? ""
                : `"${font.family}", ${font.category}`;
        card.appendChild(preview);

        if (font.source === "system") {
            const badge = document.createElement("span");
            badge.className = "font-source-badge";
            badge.textContent = t("fonts.system", "System");
            badge.title = t("fonts.system_title", "System font - preview shown in current app font");
            card.appendChild(badge);
        } else if (font.source === "imported") {
            const badge = document.createElement("span");
            badge.className = "font-source-badge";
            badge.textContent = t("fonts.imported", "Imported");
            card.appendChild(badge);
            const rm = document.createElement("span");
            rm.className = "icon font-remove-icon";
            rm.innerHTML = "&#57742;";
            rm.title = t("fonts.remove_imported", "Remove imported font");
            rm.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = importedFonts.findIndex((f) => f.id === font.id);
                if (idx >= 0) importedFonts.splice(idx, 1);
                try {
                    const raw = localStorage.getItem(IMPORTED_FONTS_KEY);
                    if (raw) {
                        const list = JSON.parse(raw);
                        localStorage.setItem(IMPORTED_FONTS_KEY, JSON.stringify(list.filter((f: { id: string }) => f.id !== font.id)));
                    }
                } catch {}
                if (getFontAppId() === font.id) setFontApp(DEFAULT_APP_FONT);
                if (getFontLocId() === font.id) setFontLoc(DEFAULT_LOC_FONT);
                const appNameEl = document.getElementById("font-app-name");
                const locNameEl = document.getElementById("font-loc-name");
                if (appNameEl) appNameEl.textContent = getFontApp().name;
                if (locNameEl) locNameEl.textContent = getFontLoc().name;
                emitFontListUpdate();
            });
            card.appendChild(rm);
        } else if (font.source === "google") {
            const badge = document.createElement("span");
            badge.className = "font-source-badge";
            badge.textContent = t("fonts.google", "Google");
            card.appendChild(badge);
            if (font.status === "ready" && !downloadedGoogleFonts.has(font.id)) {
                const dl = document.createElement("span");
                dl.className = "icon font-download-icon";
                dl.innerHTML = "&#57522;";
                dl.title = t("fonts.download_google", "Download from Google Fonts");
                card.appendChild(dl);
            }
            if (downloadedGoogleFonts.has(font.id)) {
                const rm = document.createElement("span");
                rm.className = "icon font-remove-icon";
                rm.innerHTML = "&#57742;";
                rm.title = t("fonts.remove_downloaded", "Remove downloaded font");
                rm.addEventListener("click", (e) => {
                    e.stopPropagation();
                    downloadedGoogleFonts.delete(font.id);
                    try {
                        const raw = localStorage.getItem(DOWNLOADED_FONTS_KEY);
                        if (raw) {
                            const list = JSON.parse(raw);
                            localStorage.setItem(DOWNLOADED_FONTS_KEY, JSON.stringify(list.filter((f: { id: string }) => f.id !== font.id)));
                        }
                    } catch {}
                    if (getFontAppId() === font.id) setFontApp(DEFAULT_APP_FONT);
                    if (getFontLocId() === font.id) setFontLoc(DEFAULT_LOC_FONT);
                    const appNameEl = document.getElementById("font-app-name");
                    const locNameEl = document.getElementById("font-loc-name");
                    if (appNameEl) appNameEl.textContent = getFontApp().name;
                    if (locNameEl) locNameEl.textContent = getFontLoc().name;
                    emitFontListUpdate();
                });
                card.appendChild(rm);
            }
        }

        if (font.status === "loading") {
            const spinner = document.createElement("span");
            spinner.className = "icon font-status-spinner";
            spinner.innerHTML = "&#57610;";
            spinner.title = t("fonts.downloading", "Downloading...");
            card.appendChild(spinner);
        }

        const appId = getFontAppId();
        const locId = getFontLocId();
        if (font.id === appId || font.id === locId) {
            const role = document.createElement("span");
            role.className = "font-role-badge";
            if (font.id === appId) {
                const i = document.createElement("span");
                i.className = "icon";
                i.innerHTML = "&#57752;";
                i.title = t("fonts.app_role", "Application font");
                role.appendChild(i);
            }
            if (font.id === locId) {
                const i = document.createElement("span");
                i.className = "icon";
                i.innerHTML = "&#57598;";
                i.title = t("fonts.loc_role", "Localization font");
                role.appendChild(i);
            }
            if (font.id === appId && font.id === locId) {
                role.title = t("fonts.both_roles", "Application & Localization font");
            }
            card.appendChild(role);
        }

        card.addEventListener("click", () => {
            if (
                font.source === "google" &&
                font.status === "ready" &&
                !downloadedGoogleFonts.has(font.id)
            ) {
                onDownloadGoogle(font);
                return;
            }
            if (font.status === "loading") return;

            container
                .querySelectorAll(".font-card.active")
                .forEach((c) => c.classList.remove("active"));
            card.classList.add("active");
            onSelect(font.id);
        });

        container.appendChild(card);
    }

    if (!hasVisible && lowerQuery) {
        const empty = document.createElement("div");
        empty.className = "font-list-empty";
        empty.textContent = t("font.no_matching", 'No fonts matching "{query}"', { query });
        container.appendChild(empty);

        if (isSearchingExternal) {
            const statusMsg = document.createElement("div");
            statusMsg.className = "font-list-empty";
            statusMsg.style.fontSize = "9px";
            statusMsg.style.opacity = "0.5";
            statusMsg.style.padding = "4px 8px 8px";
            statusMsg.textContent = t("fonts.checking_google", "Checking Google Fonts...");
            container.appendChild(statusMsg);
        }
    }
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error("Failed to read blob"));
        reader.readAsDataURL(blob);
    });
}

const DOWNLOADED_FONTS_KEY = "flu-downloaded-fonts";
const SEARCHED_FONTS_KEY = "flu-searched-fonts";
const IMPORTED_FONTS_KEY = "flu-imported-fonts";

type DownloadedFontInfo = {
    id: string;
    family: string;
};

function saveDownloadedFontInfo(info: DownloadedFontInfo): void {
    try {
        const raw = localStorage.getItem(DOWNLOADED_FONTS_KEY);
        const list: DownloadedFontInfo[] = raw ? JSON.parse(raw) : [];
        if (!list.some((f) => f.id === info.id)) {
            list.push(info);
            localStorage.setItem(DOWNLOADED_FONTS_KEY, JSON.stringify(list));
        }
    } catch {}
}

function getDownloadedFontInfos(): DownloadedFontInfo[] {
    try {
        const raw = localStorage.getItem(DOWNLOADED_FONTS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

async function restoreDownloadedFonts(): Promise<void> {
    const infos = getDownloadedFontInfos();
    for (const info of infos) {
        try {
            const fileNames: string[] = [];
            for (let i = 0; ; i++) {
                for (const ext of ["woff2", "woff", "ttf"]) {
                    const fileName = `${info.family.replace(/\s+/g, "")}-${i}.${ext}`;
                    try {
                        const b64 = await invoke<string>("load_font_file", {
                            name: fileName,
                        });
                        const mime =
                            ext === "woff2"
                                ? "font/woff2"
                                : ext === "woff"
                                  ? "font/woff"
                                  : "font/ttf";
                        const ff = new FontFace(
                            info.family,
                            `url(data:${mime};base64,${b64})`,
                            { weight: "400", style: "normal" },
                        );
                        await ff.load();
                        document.fonts.add(ff);
                        fileNames.push(fileName);
                        break;
                    } catch {
                        continue;
                    }
                }
                if (fileNames.length <= i) break;
            }
            if (fileNames.length > 0) {
                downloadedGoogleFonts.add(info.id);
            }
        } catch {}
    }
}

async function downloadGoogleFont(font: FontFace): Promise<void> {
    const familyEncoded = font.family.replace(/\s+/g, "+");

    try {
        font.status = "loading";
        emitFontListUpdate();

        const cssUrl = `https://fonts.googleapis.com/css2?family=${familyEncoded}:wght@400;700&display=swap`;
        const cssResp = await fetch(cssUrl);
        if (!cssResp.ok)
            throw new Error(`Google Fonts API returned ${cssResp.status}`);

        const css = await cssResp.text();
        const urlRegex = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
        const urls: string[] = [];
        let match;
        while ((match = urlRegex.exec(css)) !== null) {
            urls.push(match[1]);
        }

        if (urls.length === 0)
            throw new Error("No woff2 URLs found in CSS response");

        const srcParts: string[] = [];

        for (let i = 0; i < urls.length; i++) {
            const resp = await fetch(urls[i]);
            if (!resp.ok)
                throw new Error(`Failed to download font file: ${resp.status}`);
            const blob = await resp.blob();
            const b64 = await blobToBase64(blob);

            const ext = urls[i].endsWith(".woff2")
                ? "woff2"
                : urls[i].endsWith(".woff")
                  ? "woff"
                  : "ttf";

            const objUrl = URL.createObjectURL(blob);
            srcParts.push(`url(${objUrl}) format("${ext === "ttf" ? "truetype" : ext}")`);

            const fileName = `${font.family.replace(/\s+/g, "")}-${i}.${ext}`;
            await invoke("save_font_file", { name: fileName, data: b64 });
        }

        for (const src of srcParts) {
            const urlOnly = src.replace(/ format\([^)]*\)/g, "");
            const ff = new FontFace(font.family, urlOnly, {
                weight: "400",
                style: "normal",
            });
            await ff.load();
            document.fonts.add(ff);
        }

        downloadedGoogleFonts.add(font.id);
        saveDownloadedFontInfo({ id: font.id, family: font.family });
        font.status = "ready";

        notify(`"${font.name}" downloaded`, "success", 1800);
        emitFontListUpdate();
    } catch {
        font.status = "ready";
        notify(`Failed to download "${font.name}"`, "error", 2800);
        emitFontListUpdate();
    }
}

let fontListUpdateCallback: (() => void) | null = null;

function emitFontListUpdate(): void {
    fontListUpdateCallback?.();
}

type ImportedFontInfo = {
    id: string;
    name: string;
    family: string;
    b64: string;
    ext: string;
};

function saveImportedFontInfo(info: ImportedFontInfo): void {
    try {
        const raw = localStorage.getItem(IMPORTED_FONTS_KEY);
        const list: ImportedFontInfo[] = raw ? JSON.parse(raw) : [];
        if (!list.some((f) => f.id === info.id)) {
            list.push(info);
            localStorage.setItem(IMPORTED_FONTS_KEY, JSON.stringify(list));
        }
    } catch {}
}

function restoreImportedFonts(): void {
    try {
        const raw = localStorage.getItem(IMPORTED_FONTS_KEY);
        if (!raw) return;
        const list: ImportedFontInfo[] = JSON.parse(raw);
        for (const item of list) {
            if (findFontById(item.id)) continue;
            try {
                const mime =
                    item.ext === "woff2"
                        ? "font/woff2"
                        : item.ext === "woff"
                          ? "font/woff"
                          : "font/ttf";
                const fmt = item.ext === "ttf" ? "truetype" : item.ext;

                const style = document.createElement("style");
                style.textContent = `@font-face { font-family: "${item.family}"; src: url(data:${mime};base64,${item.b64}) format("${fmt}"); font-weight: 400; font-style: normal; }`;
                document.head.appendChild(style);

                const loaded: FontFace = {
                    id: item.id,
                    name: item.name,
                    family: item.family,
                    category: "sans-serif",
                    source: "imported",
                    status: "ready",
                };
                importedFonts.push(loaded);
            } catch {}
        }
    } catch {}
}

function checkSystemFonts(): void {
    const el = document.createElement("span");
    el.style.cssText = "position:fixed;left:-9999px;top:-9999px;font-size:72px;visibility:hidden;white-space:nowrap";
    el.textContent = "abcdefghijklmnopqrstuvwxyz0123456789";
    document.body.appendChild(el);

    el.style.fontFamily = "monospace";
    const fallbackWidth = el.offsetWidth;

    for (const font of SYSTEM_FONTS) {
        el.style.fontFamily = `"${font.family}", monospace`;
        const testWidth = el.offsetWidth;
        if (Math.abs(testWidth - fallbackWidth) < 2) {
            font.status = "error";
        }
    }

    document.body.removeChild(el);
}

export function initFonts(): void {
    const fontSettingsTrigger = document.getElementById(
        "font-settings-trigger",
    );
    const fontSettingsModal = document.getElementById("font-settings-modal");
    const fontSettingsClose = document.getElementById("font-settings-close");
    const fontPickerModal = document.getElementById("font-picker-modal");
    const fontPickerClose = document.getElementById("font-picker-close");
    const fontAppTrigger = document.getElementById("font-app-trigger");
    const fontLocTrigger = document.getElementById("font-loc-trigger");
    const fontSearchInput = document.getElementById(
        "font-search-input",
    ) as HTMLInputElement | null;
    const fontList = document.getElementById("font-list");
    const fontImportBtn = document.getElementById("font-import-btn");

    let pickerTarget: "app" | "loc" = "app";

    function updateFontIndicator(): void {
        const indicator = document.getElementById("font-indicator");
        if (indicator) {
            const appFont = getFontApp();
            indicator.style.fontFamily = `"${appFont.family}", ${appFont.category}`;
        }
    }

    function updateFontNames(): void {
        const appNameEl = document.getElementById("font-app-name");
        const locNameEl = document.getElementById("font-loc-name");
        if (appNameEl) appNameEl.textContent = getFontApp().name;
        if (locNameEl) locNameEl.textContent = getFontLoc().name;
        updateFontIndicator();
    }

    function openFontSettingsModal(): void {
        if (!fontSettingsModal) return;
        fontSettingsModal.style.display = "flex";
        requestAnimationFrame(() => {
            fontSettingsModal.classList.add("active");
        });
        document.getElementById("content")?.classList.add("blurred");
        updateFontNames();
    }

    function closeFontSettingsModal(): void {
        if (!fontSettingsModal) return;
        fontSettingsModal.classList.remove("active");
        setTimeout(() => {
            fontSettingsModal.style.display = "none";
            document.getElementById("content")?.classList.remove("blurred");
        }, 300);
    }

    function refreshFontList(target: "app" | "loc", query: string): void {
        if (!fontList) return;
        const currentId = target === "app" ? getFontAppId() : getFontLocId();
        renderFontList(
            fontList,
            currentId,
            query,
            (fontId) => {
                if (pickerTarget === "app") {
                    setFontApp(fontId);
                } else {
                    setFontLoc(fontId);
                }
                updateFontNames();
                refreshFontList(pickerTarget, fontSearchInput?.value || "");
            },
            async (font) => {
                await downloadGoogleFont(font);
                const fontId = font.id;
                if (pickerTarget === "app") {
                    setFontApp(fontId);
                } else {
                    setFontLoc(fontId);
                }
                updateFontNames();
                refreshFontList(pickerTarget, fontSearchInput?.value || "");
            },
        );
    }

    function openFontPicker(target: "app" | "loc"): void {
        pickerTarget = target;
        if (!fontPickerModal || !fontList) return;

        const titleEl = document.getElementById("font-picker-title");
        if (titleEl) {
            titleEl.textContent =
                target === "app" ? t("fonts.app_title", "Application Font") : t("fonts.loc_title", "Localization Font");
        }

        const iconEl = fontPickerModal.querySelector<HTMLElement>(
            ".drawer-modal-header-left .icon",
        );
        if (iconEl) {
            iconEl.innerHTML = target === "app" ? "&#57752;" : "&#57598;";
        }

        if (fontSearchInput) {
            fontSearchInput.value = "";
        }

        refreshFontList(target, "");

        fontListUpdateCallback = () =>
            refreshFontList(pickerTarget, fontSearchInput?.value || "");

        fontPickerModal.style.display = "flex";
        requestAnimationFrame(() => {
            fontPickerModal.classList.add("active");
            setTimeout(() => fontSearchInput?.focus(), 100);
        });
    }

    function closeFontPicker(): void {
        if (!fontPickerModal) return;
        fontPickerModal.classList.remove("active");
        fontListUpdateCallback = null;
        setTimeout(() => {
            fontPickerModal.style.display = "none";
        }, 300);
    }

    async function handleImportFont(): Promise<void> {
        try {
            const selected = await open({
                multiple: false,
                filters: [
                    {
                        name: "Font Files",
                        extensions: ["ttf", "otf", "woff", "woff2"],
                    },
                ],
            });
            if (!selected) return;

            const [fileName, b64] = await invoke<[string, string]>(
                "import_font_file",
                { source: selected },
            );

            const familyName = fileName
                .replace(/\.[^.]+$/, "")
                .replace(/[-_]/g, " ");
            const id = `imported-${fileName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

            if (findFontById(id)) {
                notify("Font already imported", "info", 1800);
                return;
            }

            const ext = fileName.split(".").pop()?.toLowerCase() || "ttf";
            const mime =
                ext === "woff2"
                    ? "font/woff2"
                    : ext === "woff"
                      ? "font/woff"
                      : "font/ttf";

            const cssFontFace = `
                @font-face {
                    font-family: "${familyName}";
                    src: url(data:${mime};base64,${b64}) format("${ext === "ttf" ? "truetype" : ext}");
                    font-weight: 400;
                    font-style: normal;
                }
            `;
            const style = document.createElement("style");
            style.textContent = cssFontFace;
            document.head.appendChild(style);

            const loaded: FontFace = {
                id,
                name: familyName,
                family: familyName,
                category: "sans-serif",
                source: "imported",
                status: "ready",
            };
            importedFonts.push(loaded);
            saveImportedFontInfo({
                id,
                name: familyName,
                family: familyName,
                b64,
                ext,
            });

            notify(`"${familyName}" imported`, "success", 1800);
            refreshFontList(pickerTarget, fontSearchInput?.value || "");

            if (pickerTarget === "app") setFontApp(id);
            else setFontLoc(id);
            updateFontNames();
        } catch {
            notify("Failed to import font", "error", 2800);
        }
    }

    if (fontSettingsTrigger) {
        fontSettingsTrigger.addEventListener("click", openFontSettingsModal);
    }

    fontSettingsClose?.addEventListener("click", closeFontSettingsModal);

    fontSettingsModal?.addEventListener("click", (e) => {
        if (e.target === fontSettingsModal) closeFontSettingsModal();
    });

    fontAppTrigger?.addEventListener("click", () => openFontPicker("app"));
    fontLocTrigger?.addEventListener("click", () => openFontPicker("loc"));

    fontPickerClose?.addEventListener("click", closeFontPicker);

    fontPickerModal?.addEventListener("click", (e) => {
        if (e.target === fontPickerModal) closeFontPicker();
    });

    fontImportBtn?.addEventListener("click", handleImportFont);

    if (fontSearchInput && fontList) {
        fontSearchInput.addEventListener("input", () => {
            const query = fontSearchInput.value;
            refreshFontList(pickerTarget, query);

            if (searchTimeoutId !== null) window.clearTimeout(searchTimeoutId);
            searchTimeoutId = window.setTimeout(async () => {
                searchTimeoutId = null;
                const trimmed = query.trim();
                if (trimmed.length < 2) return;

                const all = getAllFonts();
                const lower = trimmed.toLowerCase();
                const localMatch = all.some((f) =>
                    f.name.toLowerCase().includes(lower),
                );
                if (localMatch) return;

                isSearchingExternal = true;
                refreshFontList(pickerTarget, fontSearchInput?.value || "");
                await searchGoogleFontsApi(trimmed);
                isSearchingExternal = false;
                if (
                    fontSearchInput?.value.trim().toLowerCase() ===
                    trimmed.toLowerCase()
                ) {
                    refreshFontList(pickerTarget, fontSearchInput.value);
                }
            }, 400);
        });
    }

    window.addEventListener("flu:settings-applied", () => {
        applyFonts();
        updateFontIndicator();
    });

    restoreSearchedFonts();
    restoreImportedFonts();
    applyFonts();
    updateFontNames();
    void restoreDownloadedFonts();
    checkSystemFonts();
}
