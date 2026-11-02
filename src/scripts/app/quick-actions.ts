import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "../i18n";
import { notify } from "../notifications";
import { applyPersistedConfig, persistCurrentSettings, type AppConfigFile } from "../settings-persistence";
import { isWebviewDevtoolsAvailable, toggleWebviewDevtools } from "../utils";
import { showWebviewCreationError } from "../webview-error-modal";

function timestampForFile() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

async function saveJson(filename: string, payload: unknown) {
    const path = await save({
        defaultPath: filename,
        filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return false;

    await invoke("save_export_file", {
        path,
        contents: JSON.stringify(payload, null, 2),
    });
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

        try {
            const payload = JSON.parse(await file.text());
            await onRead(payload);
        } catch (error) {
            notify(error instanceof Error ? error.message : t("error.could_not_read_json", "Could not read JSON file"), "error", 3200);
        }
    }, { once: true });
    document.body.appendChild(input);
    input.click();
}

async function exportConfig() {
    const config = await persistCurrentSettings();
    const saved = await saveJson(`fluautoclicker-config-${timestampForFile()}.json`, config);
    if (saved) notify(t("config_exported", "Config exported"), "success", 1800);
}

function importConfig() {
    readJsonFile(async (payload) => {
        const updated = await invoke<AppConfigFile>("import_app_config", { config: payload });
        applyPersistedConfig(updated);
        notify(t("config_imported", "Config imported"), "success", 2200);
    });
}

async function exportBackup() {
    const backup = await invoke("export_backup_cmd");
    const saved = await saveJson(`fluautoclicker-backup-${timestampForFile()}.json`, backup);
    if (saved) notify(t("backup_exported", "All settings and profiles exported"), "success", 1800);
}

function importBackup() {
    readJsonFile(async (payload) => {
        const updated = await invoke<AppConfigFile>("import_backup_cmd", { backup: payload });
        applyPersistedConfig(updated);
        notify(t("backup_imported", "All settings and profiles imported"), "success", 2200);
    });
}

export function initCpsTestWindow() {
    document.getElementById("cps-test-btn")?.addEventListener("click", () => {
        const cpsWindow = new WebviewWindow("cps-test", {
            url: "cps.html",
            title: t("cps.window_title", "CPS Test"),
            width: 400,
            height: 500,
            resizable: false,
            decorations: false,
            transparent: true,
            center: true,
        });

        void cpsWindow.once("tauri://error", (event) => {
            showWebviewCreationError("CPS Test", event.payload);
        });
    });

    void isWebviewDevtoolsAvailable().then((available) => {
        if (!available || document.getElementById("webview-devtools-btn")) {
            return;
        }

        const cpsTestBtn = document.getElementById("cps-test-btn");
        if (!cpsTestBtn?.parentElement) return;

        const webviewDevtoolsBtn = document.createElement("div");
        webviewDevtoolsBtn.className = "settings-list-item";
        webviewDevtoolsBtn.id = "webview-devtools-btn";
        webviewDevtoolsBtn.style.cursor = "pointer";
        webviewDevtoolsBtn.innerHTML = `
            <div class="settings-item-icon"><span class="icon">&#57866;</span></div>
            <div class="settings-item-content">
                <span class="settings-item-title"></span>
                <span class="settings-item-desc"></span>
            </div>
            <span class="icon settings-item-arrow">&#57529;</span>
        `;

        const title = webviewDevtoolsBtn.querySelector(".settings-item-title");
        const desc = webviewDevtoolsBtn.querySelector(".settings-item-desc");
        if (title) title.textContent = t("settings.webview_devtools.title", "Webview DevTools");
        if (desc) desc.textContent = t("settings.webview_devtools.desc", "Open inspector for the current webview");

        webviewDevtoolsBtn.addEventListener("click", () => {
            void toggleWebviewDevtools().catch((error) => {
                console.error("Failed to toggle webview devtools", error);
            });
        });

        cpsTestBtn.insertAdjacentElement("afterend", webviewDevtoolsBtn);
    });
}

export function initDrawerLaunchers() {
    document.getElementById("config-export-btn")?.addEventListener("click", () => {
        void exportConfig().catch((error) => {
            notify(error instanceof Error ? error.message : t("error.could_not_export_config", "Could not export config"), "error", 3200);
        });
    });

    document.getElementById("config-import-btn")?.addEventListener("click", () => {
        importConfig();
    });

    document.getElementById("backup-export-btn")?.addEventListener("click", () => {
        void exportBackup().catch((error) => {
            notify(error instanceof Error ? error.message : t("error.could_not_export_backup", "Could not export backup"), "error", 3200);
        });
    });

    document.getElementById("backup-import-btn")?.addEventListener("click", () => {
        importBackup();
    });

    document.getElementById("jiggler-btn")?.addEventListener("click", async (event) => {
        event.stopPropagation();
        const { openDrawer } = await import("../drawer");
        openDrawer("section-jiggler", t("jiggler.drawer_title", "Mouse Jiggler"), "&#57987;");
    });

    document.getElementById("donate-btn")?.addEventListener("click", () => {
        void openUrl("https://agzes.github.io/donate").catch((error) => {
            notify(error instanceof Error ? error.message : t("error.could_not_open_donate", "Could not open Donate"), "error", 3200);
        });
    });
}
