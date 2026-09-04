import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { formatInvokeError, safeInvoke } from "./invoke";
import { notify } from "./notifications";
import { t } from "./i18n";
import {
    applyPersistedConfig,
    persistCurrentSettings,
    type AppConfigFile,
} from "./settings-persistence";
import { openIconPicker, initIconPicker } from "./icon-picker";
import iconData from "../assets/icons/lucide-icons/data.json";

type ProfileEntry = {
    name: string;
    icon?: string;
};

type ProfileFile = {
    version: number;
    name: string;
    icon?: string;
    data: AppConfigFile;
};

type IconData = { encodedCode: string; prefix: string; className: string; unicode: string };

const lucideIcons: Record<string, IconData> = iconData as Record<string, IconData>;

let activeProfile = "default";
let profileEntries: ProfileEntry[] = [];
let isRefreshing = false;
let searchFilter = "";

function getNameInput() {
    return document.getElementById("profile-name-input") as HTMLInputElement | null;
}

function getRenameInput() {
    return document.getElementById("profile-rename-input") as HTMLInputElement | null;
}

function timestampForFile() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFilePart(value: string) {
    return value.replace(/[^a-z0-9_-]+/gi, "_") || "profile";
}

function unicodeChar(unicodeStr: string): string {
    const m = unicodeStr.match(/&#(\d+);/);
    return m ? String.fromCodePoint(parseInt(m[1], 10)) : "";
}

function getIconChar(iconKey: string | undefined): string {
    if (iconKey && lucideIcons[iconKey]) return unicodeChar(lucideIcons[iconKey].unicode);
    return unicodeChar("&#58218;");
}

async function saveJson(filename: string, payload: unknown) {
    const path = await save({ defaultPath: filename, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return false;
    await invoke("save_export_file", { path, contents: JSON.stringify(payload, null, 2) });
    return true;
}

function readJsonFile(onRead: (payload: unknown) => void | Promise<void>) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        try { await onRead(JSON.parse(await file.text())); }
        catch (error) { notify(formatInvokeError(error), "error", 3200); }
    }, { once: true });
    document.body.appendChild(input);
    input.click();
}

async function loadAllProfiles(profileNames: string[]): Promise<ProfileEntry[]> {
    const entries: ProfileEntry[] = [];
    for (const name of profileNames) {
        entries.push({ name, icon: (await safeInvoke<ProfileFile | null>("export_profile_cmd", { name }, { fallback: null }))?.icon });
    }
    return entries;
}

async function refreshProfiles() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
        const [profiles, config] = await Promise.all([
            safeInvoke<string[]>("list_profiles_cmd", undefined, {
                fallback: ["default"], notifyOnError: true,
                errorMessage: t("error.could_not_load_profiles", "Could not load profiles"),
            }),
            safeInvoke<AppConfigFile>("load_app_config", undefined, {
                fallback: { active_profile: "default" } as AppConfigFile, notifyOnError: true,
                errorMessage: t("error.could_not_load_active_profile", "Could not load active profile"),
            }),
        ]);
        activeProfile = (config.active_profile || "default") && profiles.includes(config.active_profile || "")
            ? config.active_profile!
            : profiles[0] || "default";
        profileEntries = await loadAllProfiles(profiles);
        renderProfileList();
    } finally {
        isRefreshing = false;
    }
}

function renderProfileList() {
    const container = document.getElementById("profiles-list");
    if (!container) return;
    container.innerHTML = "";
    const frag = document.createDocumentFragment();
    const filtered = searchFilter
        ? profileEntries.filter(e => e.name.toLowerCase().includes(searchFilter.toLowerCase()))
        : profileEntries;
    const sorted = [...filtered].sort((a, b) => a.name === activeProfile ? -1 : b.name === activeProfile ? 1 : 0);
    for (const entry of sorted) {
        const isActive = entry.name === activeProfile;
        const item = document.createElement("div");
        item.className = "profile-list-item" + (isActive ? " active" : "");
        item.innerHTML = `
            <span class="profile-list-icon">${getIconChar(entry.icon)}</span>
            <span class="profile-list-name">${entry.name}</span>
            ${isActive ? `
            <button class="feature-btn profile-act-btn" data-action="rename" title="${entry.name === "default" ? t("profiles.default_rename_hint", "Cannot rename the default profile") : t("profiles.rename")}" ${entry.name === "default" ? "disabled" : ""}><span class="icon">&#57714;</span></button>
            <button class="feature-btn profile-act-btn" data-action="export" title="${t("profiles.export_now")}"><span class="icon">&#58154;</span></button>
            <button class="feature-btn profile-act-btn" data-action="import" title="${t("profiles.import")}"><span class="icon">&#58136;</span></button>
            <button class="feature-btn profile-act-btn" data-action="delete" title="${entry.name === "default" ? t("profiles.default_delete_hint", "Cannot delete the default profile") : t("profiles.delete")}" ${entry.name === "default" ? "disabled" : ""}><span class="icon">&#57742;</span></button>
            ` : ""}
        `;
        if (isActive) {
            const iconSpan = item.querySelector(".profile-list-icon") as HTMLElement;
            if (iconSpan) {
                iconSpan.style.cursor = "pointer";
                iconSpan.title = t("profiles.change_icon", "Change icon");
                iconSpan.addEventListener("click", (e) => {
                    e.stopPropagation();
                    openIconPicker(entry.icon || null, (key) => void saveIcon(key));
                });
            }
            item.querySelectorAll("[data-action]").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const action = (btn as HTMLElement).dataset.action;
                    if (action === "rename") openRenameModal();
                    else if (action === "export") exportProfile();
                    else if (action === "import") importProfile();
                    else if (action === "delete") openDeleteModal();
                });
            });
        }
        item.addEventListener("click", () => void loadProfile(entry.name));
        frag.appendChild(item);
    }
    container.appendChild(frag);
}

async function saveProfileAs(mode: "blank" | "copy" | "ui") {
    const name = getNameInput()?.value.trim();
    if (!name) { notify(t("please_enter_profile_name", "Please enter a profile name."), "error", 2000); return; }
    if (profileEntries.some(e => e.name === name)) {
        notify(t("profile_name_exists", 'A profile named "{name}" already exists.', { name }), "error", 2000);
        return;
    }
    let config: AppConfigFile;
    if (mode === "blank") config = await persistCurrentSettings();
    else if (mode === "ui") {
        const current = await persistCurrentSettings();
        config = {
            ...current,
            mouse: { cps: 1, variation_ms: 0, button: "left", click_mode: "normal", click_type: "single", hold_duration: 0, hold_unit: "ms", repeat_mode: "off", repeat_count: 1, repeat_unit: "times", position_mode: "current", coord_x: 0, coord_y: 0 },
            keyboard: { cps: 1, variation_ms: 0, key: "", modifiers: "", click_mode: "normal", hold_duration: 0, hold_unit: "ms", repeat_mode: "off", repeat_count: 1, repeat_unit: "times" },
            jiggler: { active: false, distance: 0, interval_ms: 0, pattern: "linear" },
            macro_settings: { repeat_mode: "off", repeat_count: 1, repeat_duration_ms: 0, recording_options: { record_mouse_clicks: true, record_mouse_moves: false, record_keyboard: true, record_delays: true, record_click_position: false, record_live_preview: false }, actions: [] },
        };
    } else {
        config = await persistCurrentSettings();
    }
    config.active_profile = name;
    const updated = await safeInvoke("save_profile_cmd", { name, icon: null, config }, {
        notifyOnError: true, errorMessage: t("error.could_not_save_profile", "Could not save profile"),
    });
    applyPersistedConfig(updated as any);
    await refreshProfiles();
    notify(t("profile_saved", 'Profile "{name}" saved', { name }), "success", 1800);
}

async function loadProfile(name: string) {
    const updated = await safeInvoke("load_profile_cmd", { name }, {
        notifyOnError: true, errorMessage: t("error.could_not_load_profile", "Could not load profile"),
    });
    activeProfile = name;
    applyPersistedConfig(updated as any);
    await refreshProfiles();
    notify(t("profile_loaded", 'Profile "{name}" loaded', { name }), "success", 1800);
}

async function renameProfile() {
    const nextName = getRenameInput()?.value.trim() || "";
    if (!nextName) return;
    if (profileEntries.some(e => e.name === nextName)) {
        notify(t("profile_name_exists", 'A profile named "{name}" already exists.', { name: nextName }), "error", 2000);
        return;
    }
    const prev = activeProfile;
    await safeInvoke("rename_profile_cmd", { oldName: prev, newName: nextName }, {
        notifyOnError: true, errorMessage: t("error.could_not_rename_profile", "Could not rename profile"),
    });
    activeProfile = nextName;
    await refreshProfiles();
    closeRenameModal();
    notify(t("profile_renamed", 'Profile renamed to "{name}"', { name: nextName }), "success", 1800);
}

async function deleteProfile() {
    const profile = activeProfile;
    await safeInvoke("delete_profile_cmd", { name: profile }, {
        notifyOnError: true, errorMessage: t("error.could_not_delete_profile", "Could not delete profile"),
    });
    const config = await safeInvoke<Pick<AppConfigFile, "active_profile">>("load_app_config", undefined, { fallback: { active_profile: "default" } });
    activeProfile = "default";
    applyPersistedConfig(config as any);
    closeDeleteModal();
    await refreshProfiles();
    notify(t("profile_deleted", 'Profile "{name}" deleted', { name: profile }), "info", 1800);
}

async function exportProfile() {
    const profileName = activeProfile || "default";
    const entry = profileEntries.find(e => e.name === profileName);
    const profile = profileName === activeProfile
        ? ({ version: 1, name: profileName, icon: entry?.icon, data: { ...(await persistCurrentSettings()), active_profile: profileName } } satisfies ProfileFile)
        : await invoke<ProfileFile>("export_profile_cmd", { name: profileName });
    const saved = await saveJson(`fluautoclicker-profile-${safeFilePart(profile.name)}-${timestampForFile()}.json`, profile);
    if (saved) notify(t("profile_exported", 'Profile "{name}" exported', { name: profile.name }), "success", 1800);
}

function importProfile() {
    readJsonFile(async (payload) => {
        const updated = await invoke<AppConfigFile>("import_profile_cmd", { profile: payload });
        activeProfile = updated.active_profile || "default";
        applyPersistedConfig(updated);
        await refreshProfiles();
        notify(t("profile_imported", 'Profile "{name}" imported', { name: activeProfile }), "success", 2200);
    });
}

async function saveIcon(iconKey: string | null) {
    const config = await persistCurrentSettings();
    config.active_profile = activeProfile;
    await safeInvoke("save_profile_cmd", { name: activeProfile, icon: iconKey, config }, {
        notifyOnError: true, errorMessage: t("error.could_not_save_profile", "Could not save profile"),
    });
    await refreshProfiles();
}

function showModal(id: string) {
    const m = document.getElementById(id);
    if (m) { m.style.display = "flex"; requestAnimationFrame(() => m.classList.add("active")); }
}

function hideModal(id: string) {
    const m = document.getElementById(id);
    if (m) { m.classList.remove("active"); setTimeout(() => { m.style.display = "none"; }, 300); }
}


function openRenameModal() {
    const label = document.getElementById("rename-confirm-label");
    const inp = getRenameInput();
    if (label) label.textContent = t("profiles.rename_label", 'Rename "{name}"?', { name: activeProfile });
    if (inp) inp.value = activeProfile;
    showModal("rename-confirm-modal");
    setTimeout(() => inp?.focus(), 100);
}

function closeRenameModal() { hideModal("rename-confirm-modal"); }

function openDeleteModal() {
    const textEl = document.getElementById("delete-confirm-text");
    if (textEl) textEl.textContent = t("profiles.delete_confirm", 'Delete profile "{name}"?', { name: activeProfile });
    showModal("delete-confirm-modal");
}

function closeDeleteModal() { hideModal("delete-confirm-modal"); }

function openCreateModal() {
    const name = getNameInput()?.value.trim();
    if (!name) { notify(t("please_enter_profile_name", "Please enter a profile name."), "error", 2000); return; }
    if (profileEntries.some(e => e.name === name)) {
        notify(t("profile_name_exists", 'A profile named "{name}" already exists.', { name }), "error", 2000);
        return;
    }
    showModal("create-profile-modal");
}

function closeCreateModal() { hideModal("create-profile-modal"); }

export function initProfiles() {
    initIconPicker();

    document.getElementById("profile-rename-confirm")?.addEventListener("click", () => {
        void renameProfile().catch(e => notify(formatInvokeError(e), "error", 2800));
    });
    document.getElementById("rename-confirm-close")?.addEventListener("click", closeRenameModal);
    document.getElementById("rename-confirm-modal")?.addEventListener("click", (e) => {
        if (e.target === document.getElementById("rename-confirm-modal")) closeRenameModal();
    });
    getRenameInput()?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); void renameProfile().catch(err => notify(formatInvokeError(err), "error", 2800)); }
        if (e.key === "Escape") closeRenameModal();
    });

    document.getElementById("profile-delete-confirm")?.addEventListener("click", () => {
        void deleteProfile().catch(e => notify(formatInvokeError(e), "error", 2800));
    });
    document.getElementById("delete-confirm-close")?.addEventListener("click", closeDeleteModal);
    document.getElementById("delete-confirm-modal")?.addEventListener("click", (e) => {
        if (e.target === document.getElementById("delete-confirm-modal")) closeDeleteModal();
    });

    document.getElementById("create-profile-close")?.addEventListener("click", closeCreateModal);
    document.getElementById("create-profile-modal")?.addEventListener("click", (e) => {
        if (e.target === document.getElementById("create-profile-modal")) closeCreateModal();
    });
    document.getElementById("create-mode-blank")?.addEventListener("click", () => {
        closeCreateModal(); void saveProfileAs("blank").catch(e => notify(formatInvokeError(e), "error", 2800));
    });
    document.getElementById("create-mode-copy")?.addEventListener("click", () => {
        closeCreateModal(); void saveProfileAs("copy").catch(e => notify(formatInvokeError(e), "error", 2800));
    });
    document.getElementById("create-mode-ui")?.addEventListener("click", () => {
        closeCreateModal(); void saveProfileAs("ui").catch(e => notify(formatInvokeError(e), "error", 2800));
    });

    const nameInput = getNameInput();

    nameInput?.addEventListener("input", () => {
        searchFilter = nameInput.value;
        renderProfileList();
    });

    nameInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const name = nameInput.value.trim();
            if (name && !profileEntries.some(p => p.name === name)) openCreateModal();
        }
    });

    document.getElementById("profile-create-btn")?.addEventListener("click", openCreateModal);

    void listen("profiles-updated", () => { void refreshProfiles(); });
    void refreshProfiles().catch(e => notify(formatInvokeError(e), "error", 2800));
}
