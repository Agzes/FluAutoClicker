import { initDrawer, initJiggler, initTimingModal } from "../drawer";
import { initHotkeysEditor } from "../hotkeys";
import { initKeyboard } from "../keyboard";
import { initMacro } from "../macro";
import { initMouseSettings } from "../mouse";
import { initProfiles } from "../profiles";
import { loadPersistedSettings, initSettingsPersistence } from "../settings-persistence";
import { initStartupModals } from "../startup-modals";
import { initTheme } from "../theme";
import { initFonts } from "../fonts";
import { initI18n, initLanguagePicker } from "../i18n";
import { initInputs } from "../ui";
import { initUpdateChecks } from "../update-check";
import { initUinputPermissionModal } from "../uinput-permissions";
import { initWindowEffects } from "../window-effects";
import { initWebviewErrorModal } from "../webview-error-modal";
import { initCpsTestWindow, initDrawerLaunchers } from "./quick-actions";
import { initStartStopControls } from "./start-stop";
import { initTabAndToggleUi } from "./toggle-groups";
import { initWindowControls } from "./window-controls";
import { initWindowGeometry } from "../window-geometry";
import { initKeyboardPartyMode } from "./easter-egg";
import { initNativeShellGuards } from "./native-shell-guards";
import { initLocalShortcuts } from "./local-shortcuts";

export async function bootstrapApp() {
    initWebviewErrorModal();
    initUinputPermissionModal();
    initNativeShellGuards();
    initLocalShortcuts();

    await loadPersistedSettings();
    await initWindowEffects();
    await initWindowGeometry();

    initI18n();
    initLanguagePicker();
    initKeyboard();
    initDrawer();
    initTheme();
    initFonts();
    initInputs();
    initMacro();
    initMouseSettings();
    initJiggler();
    void initHotkeysEditor();
    void initSettingsPersistence();
    void initProfiles();

    initCpsTestWindow();
    const toggleMouseClicker = initStartStopControls();
    initTimingModal(toggleMouseClicker);
    initWindowControls();
    initTabAndToggleUi();
    initDrawerLaunchers();
    initKeyboardPartyMode();
    initStartupModals();
    void initUpdateChecks();
}
