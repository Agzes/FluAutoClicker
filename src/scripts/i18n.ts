import {
  getLangStrings,
  LANGUAGES,
  getNativeName,
  type LangCode,
} from "../lang/index";

const STORAGE_KEY = "flu-language";
const DEFAULT_LANG: LangCode = "en";

let currentLanguage: LangCode = DEFAULT_LANG;
let currentDict: Record<string, string> = getLangStrings(DEFAULT_LANG);

function interpolate(text: string, params?: Record<string, string>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`);
}

export function t(key: string, fallback?: string, params?: Record<string, string>): string {
  const value = currentDict[key];
  if (value === undefined) {
    return fallback ?? key;
  }
  return interpolate(value, params);
}

export function getLanguage(): LangCode {
  return currentLanguage;
}

export function getLanguageNativeName(): string {
  return getNativeName(currentLanguage);
}

function setTextContent(el: Element, key: string, params?: Record<string, string>): void {
  const resolved = t(key, undefined, params);
  if (resolved !== undefined) {
    el.textContent = resolved;
  }
}

function applyDataI18n(params?: Record<string, string>): void {
  const elements = document.querySelectorAll<HTMLElement>("[data-i18n]");
  elements.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const childKeyEl = el.querySelector("[data-i18n]");
    if (childKeyEl) return;
    setTextContent(el, key, params);
  });

  const titleElements = document.querySelectorAll<HTMLElement>("[data-i18n-title]");
  titleElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) return;
    el.title = t(key, "");
  });

  const placeholderElements = document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]");
  placeholderElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    (el as HTMLInputElement).placeholder = t(key, "");
  });
}

function applySpecificSelectors(): void {
  const tr = currentDict;

  const groupTitles = document.querySelectorAll("#section-settings .settings-group-title");
  if (groupTitles.length > 0) {
    const g = groupTitles[0];
    if (!g.hasAttribute("data-i18n"))
      g.textContent = tr["settings.group.general"];
  }
  if (groupTitles.length > 1) {
    const g = groupTitles[1];
    if (!g.hasAttribute("data-i18n"))
      g.textContent = tr["settings.group.theme"];
  }
  if (groupTitles.length > 2) {
    const g = groupTitles[2];
    if (!g.hasAttribute("data-i18n"))
      g.textContent = tr["settings.group.utils"];
  }

  const settingsItems = document.querySelectorAll<HTMLElement>("#section-settings .settings-list-item");
  settingsItems.forEach((item) => {
    const titleEl = item.querySelector<HTMLElement>(".settings-item-title");
    const descEl = item.querySelector<HTMLElement>(".settings-item-desc");
    if (titleEl && titleEl.hasAttribute("data-i18n")) {
      setTextContent(titleEl, titleEl.getAttribute("data-i18n")!);
    }
    if (descEl && descEl.hasAttribute("data-i18n")) {
      setTextContent(descEl, descEl.getAttribute("data-i18n")!);
    }
  });

  setText('#settings-btn .footer-label', tr["footer.settings"]);
  setText('#hotkeys-btn .footer-label', tr["footer.hotkeys"]);
  setText('#profiles-btn .footer-label', tr["footer.profiles"]);
  setText('#help-btn .footer-label', tr["footer.help"]);

  setText('#start-btn .start-label', tr["start.start"]);

  const modeTabs = document.querySelectorAll<HTMLElement>(".mode-tabs .tab");
  modeTabs.forEach((tab) => {
    if (tab.hasAttribute("data-i18n")) {
      setTextContent(tab, tab.getAttribute("data-i18n")!);
    }
  });

  const hotkeyRows = document.querySelectorAll<HTMLElement>('.hotkey-list-item[data-hotkey-action]');
  hotkeyRows.forEach((row) => {
    const title = row.querySelector<HTMLElement>(".hotkey-title");
    const desc = row.querySelector<HTMLElement>(".hotkey-desc");
    if (title && title.hasAttribute("data-i18n")) {
      setTextContent(title, title.getAttribute("data-i18n")!);
    }
    if (desc && desc.hasAttribute("data-i18n")) {
      setTextContent(desc, desc.getAttribute("data-i18n")!);
    }
  });

  const winMinBtn = document.getElementById("minimize-btn");
  if (winMinBtn) winMinBtn.title = t("minimize", "Minimize");
  const winMaxBtn = document.getElementById("maximize-btn");
  if (winMaxBtn) winMaxBtn.title = t("maximize", "Maximize");
  const winCloseBtn = document.getElementById("close-btn");
  if (winCloseBtn) winCloseBtn.title = t("close", "Close");

  document.documentElement.lang = currentLanguage;
}

function setText(selector: string, value: string): void {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (element) element.textContent = value;
}

export function applyTranslations(): void {
  applyDataI18n();
  applySpecificSelectors();
}

export function setLanguage(code: string): void {
  const langCode = (LANGUAGES.some((l) => l.code === code) ? code : DEFAULT_LANG) as LangCode;
  currentLanguage = langCode;
  currentDict = getLangStrings(langCode);
  localStorage.setItem(STORAGE_KEY, langCode);
  sessionStorage.setItem("flu-language-pending-reload", "1");
  applyTranslations();
}

function setLanguageFromStorage(): void {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && LANGUAGES.some((l) => l.code === stored)) {
    currentLanguage = stored as LangCode;
    currentDict = getLangStrings(currentLanguage);
  } else {
    currentLanguage = DEFAULT_LANG;
    currentDict = getLangStrings(DEFAULT_LANG);
  }
}

export function initI18n(initialLanguage?: string): void {
  setLanguageFromStorage();

  if (initialLanguage && LANGUAGES.some((l) => l.code === initialLanguage)) {
    currentLanguage = initialLanguage as LangCode;
    currentDict = getLangStrings(currentLanguage);
  }

  applyTranslations();

  const langNameEl = document.getElementById("current-language-name");
  if (langNameEl) {
    langNameEl.textContent = getLanguageNativeName();
  }
  updateLangIndicator();
}

function updateLangIndicator(): void {
  const langIndicator = document.getElementById("lang-indicator");
  if (!langIndicator) return;
  const found = LANGUAGES.find((l) => l.code === currentLanguage);
  if (found) {
    langIndicator.innerHTML = found.flag;
  }
}

export function getAvailableLanguages(): typeof LANGUAGES {
  return LANGUAGES;
}

function openLanguagePicker(): void {
  const modal = document.getElementById("language-picker-modal");
  const list = document.getElementById("language-list");
  if (!modal || !list) return;

  list.innerHTML = "";

  const referenceKeys = Object.keys(getLangStrings(DEFAULT_LANG));

  LANGUAGES.forEach((lang) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "lang-card" + (lang.code === currentLanguage ? " active" : "");
    card.dataset.langCode = lang.code;

    const label = document.createElement("span");
    label.className = "lang-card-label";
    label.style.fontWeight = lang.code === currentLanguage ? "700" : "500";
    const flagSpan = document.createElement("span");
    flagSpan.className = "lang-card-flag";
    flagSpan.innerHTML = lang.flag;
    label.appendChild(flagSpan);
    label.append("  " + lang.nativeName);
    card.appendChild(label);

    if (lang.aiTranslated) {
      const aiBadge = document.createElement("span");
      aiBadge.className = "lang-ai-badge icon";
      aiBadge.innerHTML = "&#57787;";
      aiBadge.title = t("lang.ai_notice", "AI translation");
      card.appendChild(aiBadge);
    }

    const languageKeys = getLangStrings(lang.code);
    const missingCount = referenceKeys.filter((key) => !(key in languageKeys)).length;
    if (missingCount > 0) {
      const missingBadge = document.createElement("span");
      missingBadge.className = "lang-missing-badge";
      missingBadge.textContent = String(missingCount);
      missingBadge.title = t("lang.missing_keys", "{count} untranslated strings", {
        count: String(missingCount),
      });
      card.appendChild(missingBadge);
    }


    card.addEventListener("click", () => {
      document.querySelectorAll(".lang-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      setLanguage(lang.code);
      updateLangIndicator();
      const nameEl = document.getElementById("current-language-name");
      if (nameEl) nameEl.textContent = getLanguageNativeName();
    });

    list.appendChild(card);
  });

  modal.style.display = "flex";
  requestAnimationFrame(() => {
    modal.classList.add("active");
  });
}

function closeLanguagePicker(): void {
  const modal = document.getElementById("language-picker-modal");
  if (!modal) return;
  modal.classList.remove("active");
  setTimeout(() => {
    modal.style.display = "none";
  }, 300);
}

export function initLanguagePicker(): void {
  const trigger = document.getElementById("language-settings-trigger");
  const closeBtn = document.getElementById("language-picker-close");
  const modal = document.getElementById("language-picker-modal");

  trigger?.addEventListener("click", openLanguagePicker);

  closeBtn?.addEventListener("click", closeLanguagePicker);

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeLanguagePicker();
  });

  window.addEventListener("flu:settings-applied", () => {
    applyTranslations();
    const langNameEl = document.getElementById("current-language-name");
    if (langNameEl) {
      langNameEl.textContent = getLanguageNativeName();
    }
    updateLangIndicator();
  });
}
