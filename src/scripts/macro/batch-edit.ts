import { invoke } from "@tauri-apps/api/core";
import { closeDrawer, openDrawer } from "../drawer";
import { t } from "../i18n";
import { notify } from "../notifications";
import { createSlideIndicator } from "../utils";
import { captureCursorPosition, normalizeKey } from "./backend";
import { getSelectedMacroActionIds, loadActionsFromBackend } from "./render";
import { macroState } from "./state";

type BatchScope = "all" | "selected";
type BatchActionType = "mouse" | "keyboard" | "move" | "sleep" | "scroll";

type BatchPreviewResult = {
    matched: number;
    changed: number;
    total: number;
};

type BatchUiState = {
    scope: BatchScope;
    type: BatchActionType;
    preview: BatchPreviewResult | null;
    previewPending: boolean;
    previewFailed: boolean;
    previewSerial: number;
    previewTimer: number | null;
};

type ToggleOption = {
    value: string;
    label: string;
};

const batchState: BatchUiState = {
    scope: "all",
    type: "mouse",
    preview: null,
    previewPending: false,
    previewFailed: false,
    previewSerial: 0,
    previewTimer: null,
};

function tr(
    key: string,
    fallback: string,
    params?: Record<string, string>,
): string {
    return t(key, fallback, params);
}

function q<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

function isBatchDrawerOpen(): boolean {
    return Boolean(q("section-macro-batch")?.classList.contains("active"));
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function anyLabel(): string {
    return tr("macro.batch.any", "Any");
}

function anyMasculineLabel(): string {
    return tr("macro.batch.any_m", "Any");
}

function anyFeminineLabel(): string {
    return tr("macro.batch.any_f", "Any");
}

function anyPluralLabel(): string {
    return tr("macro.batch.any_pl", "Any");
}

function keepLabel(): string {
    return tr("macro.batch.keep", "Keep");
}

function pressLabel(): string {
    return tr("macro.batch.press", "Press");
}

function holdLabel(): string {
    return tr("macro.batch.hold", "Hold");
}

function downLabel(): string {
    return tr("macro.batch.down", "Down");
}

function upLabel(): string {
    return tr("macro.batch.up", "Up");
}

function toggleRow(
    field: string,
    options: ToggleOption[],
    activeValue = options[0]?.value || "",
): string {
    return `
        <div class="toggle-row batch-toggle-row" data-field="${field}">
            <div class="slide-indicator"></div>
            ${options
                .map(
                    (option) =>
                        `<button type="button" class="toggle-option${option.value === activeValue ? " active" : ""}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`,
                )
                .join("")}
        </div>
    `;
}

function batchField(label: string, content: string, hint?: string): string {
    return `
        <div class="settings-list-item batch-field-item">
            <span class="settings-item-title">${escapeHtml(label)}</span>
            <div class="batch-field-control">${content}</div>
            ${
                hint
                    ? `<div class="settings-list-item batch-note"><span class="icon">&#57593;</span><span class="batch-note-text">${escapeHtml(hint)}</span></div>`
                    : ""
            }
        </div>
    `;
}

let activeKeyRecordCleanup: (() => void) | null = null;

function stopKeyRecording() {
    if (activeKeyRecordCleanup) {
        activeKeyRecordCleanup();
        activeKeyRecordCleanup = null;
    }
}

type NumberBoxOptions = {
    id?: string;
    min?: number;
    max?: number;
    step?: number | "any";
};

function numberBox(
    field: string,
    placeholder: string,
    options: NumberBoxOptions = {},
): string {
    const id = options.id ? ` id="${options.id}"` : "";
    const min = options.min !== undefined ? ` min="${options.min}"` : "";
    const max = options.max !== undefined ? ` max="${options.max}"` : "";
    const step = options.step !== undefined ? ` step="${options.step}"` : "";
    return `
        <div class="coord-input-box batch-number-input">
            <input${id} type="number" data-field="${field}" placeholder="${escapeHtml(placeholder)}"${min}${max}${step} autocomplete="off" />
        </div>
    `;
}

function numberPair(
    minField: string,
    maxField: string,
    minPlaceholder: string,
    maxPlaceholder: string,
    options: NumberBoxOptions = {},
): string {
    return `
        <div class="batch-input-pair">
            ${numberBox(minField, minPlaceholder, options)}
            ${numberBox(maxField, maxPlaceholder, options)}
        </div>
    `;
}

function textBox(field: string, placeholder: string, id?: string): string {
    const idAttr = id ? ` id="${id}"` : "";
    return `
        <div class="coord-input-box batch-text-input">
            <input${idAttr} type="text" data-field="${field}" placeholder="${escapeHtml(placeholder)}" spellcheck="false" autocomplete="off" />
        </div>
    `;
}

function numericModes(): ToggleOption[] {
    return [
        { value: "keep", label: keepLabel() },
        { value: "set", label: tr("macro.batch.set", "Set") },
        { value: "add", label: tr("macro.batch.add", "Add") },
        { value: "multiply", label: tr("macro.batch.multiply", "×") },
    ];
}

function numberEditor(
    modeField: string,
    valueField: string,
    defaultValue: string,
): string {
    return `
        <div class="batch-number-editor" data-default-value="${escapeHtml(defaultValue)}" data-mode-field="${escapeHtml(modeField)}">
            ${toggleRow(modeField, numericModes())}
            <div class="expandable-content" data-editor-expand="${escapeHtml(modeField)}">
                <div class="expandable-inner">
                    ${numberBox(valueField, defaultValue, { min: 0, step: "any" })}
                </div>
            </div>
        </div>
    `;
}

function mouseButtonOptions(includeKeep: boolean): ToggleOption[] {
    const options: ToggleOption[] = includeKeep
        ? [{ value: "keep", label: keepLabel() }]
        : [{ value: "any", label: anyFeminineLabel() }];
    options.push(
        { value: "left", label: t("left", "Left") },
        { value: "middle", label: t("middle", "Middle") },
        { value: "right", label: t("right", "Right") },
        { value: "front", label: t("front", "X1") },
        { value: "back", label: t("back", "X2") },
    );
    return options;
}

function actionOptions(includeKeep: boolean): ToggleOption[] {
    const options: ToggleOption[] = includeKeep
        ? [{ value: "keep", label: keepLabel() }]
        : [{ value: "any", label: anyMasculineLabel() }];
    options.push(
        { value: "press", label: pressLabel() },
        { value: "hold", label: holdLabel() },
        { value: "down", label: downLabel() },
        { value: "up", label: upLabel() },
    );
    return options;
}

function clickOptions(includeKeep: boolean): ToggleOption[] {
    const options: ToggleOption[] = includeKeep
        ? [{ value: "keep", label: keepLabel() }]
        : [{ value: "any", label: anyPluralLabel() }];
    options.push(
        { value: "1", label: t("single", "Single") },
        { value: "2", label: t("double", "Double") },
        { value: "3", label: t("triple", "Triple") },
    );
    return options;
}

function positionOptions(includeKeep: boolean): ToggleOption[] {
    const options: ToggleOption[] = includeKeep
        ? [{ value: "keep", label: keepLabel() }]
        : [{ value: "any", label: anyFeminineLabel() }];
    options.push(
        { value: "current", label: tr("macro.batch.current", "Current") },
        { value: "custom", label: tr("macro.batch.custom", "Custom") },
    );
    return options;
}

function moveStyleOptions(includeKeep: boolean): ToggleOption[] {
    const options: ToggleOption[] = includeKeep
        ? [{ value: "keep", label: keepLabel() }]
        : [{ value: "any", label: anyMasculineLabel() }];
    options.push(
        { value: "instant", label: tr("macro.batch.style_instant", "Instant") },
        { value: "linear", label: tr("macro.batch.style_linear", "Linear") },
        { value: "smooth", label: tr("macro.batch.style_smooth", "Smooth") },
    );
    return options;
}

function scrollDirectionOptions(includeKeep: boolean): ToggleOption[] {
    const options: ToggleOption[] = includeKeep
        ? [{ value: "keep", label: keepLabel() }]
        : [{ value: "any", label: anyLabel() }];
    options.push(
        { value: "up", label: t("config.up", "Up") },
        { value: "down", label: t("config.down", "Down") },
    );
    return options;
}

function holdHint(): string {
    return [
        tr(
            "macro.batch.hold_hint",
            "Duration filters only match hold actions.",
        ),
        tr(
            "macro.batch.hold_sequence_hint",
            "Recorded holds are recognized as Down -> Sleep -> Up sequences.",
        ),
    ].join(" ");
}

function holdFilterTemplate(includeRecordedHolds: boolean): string {
    return `
        <div class="expandable-content expanded" id="batch-search-hold-expandable">
            <div class="expandable-inner">
                ${batchField(
                    tr("macro.batch.hold_duration", "Hold duration (ms)"),
                    numberPair(
                        "search-hold-min",
                        "search-hold-max",
                        tr("macro.batch.min", "Min"),
                        tr("macro.batch.max", "Max"),
                        {
                            min: 0,
                        },
                    ),
                    includeRecordedHolds
                        ? holdHint()
                        : tr(
                              "macro.batch.hold_hint",
                              "Duration filters only match hold actions.",
                          ),
                )}
            </div>
        </div>
    `;
}

function searchTemplate(type: BatchActionType): string {
    if (type === "mouse") {
        return [
            batchField(
                tr("macro.batch.button", "Button"),
                toggleRow("search-mouse-button", mouseButtonOptions(false)),
            ),
            batchField(
                tr("macro.batch.action", "Action"),
                toggleRow("search-mouse-action", actionOptions(false)),
            ),
            batchField(
                tr("macro.batch.clicks", "Clicks"),
                toggleRow("search-mouse-clicks", clickOptions(false)),
            ),
            batchField(
                tr("macro.batch.position", "Position"),
                toggleRow("search-mouse-position", positionOptions(false)),
            ),
            holdFilterTemplate(true),
        ].join("");
    }

    if (type === "keyboard") {
        return [
            batchField(
                tr("macro.batch.action", "Action"),
                toggleRow("search-keyboard-action", actionOptions(false)),
            ),
            batchField(
                tr("macro.batch.key_pattern", "Key pattern"),
                textBox(
                    "search-key-pattern",
                    tr("macro.batch.key_placeholder", "e.g. ctrl+c, f*, *+s"),
                ),
            ),
            holdFilterTemplate(false),
        ].join("");
    }

    if (type === "move") {
        return batchField(
            tr("macro.batch.style", "Style"),
            toggleRow("search-move-style", moveStyleOptions(false)),
        );
    }

    if (type === "sleep") {
        return batchField(
            tr("macro.batch.duration", "Duration (ms)"),
            numberPair(
                "search-sleep-min",
                "search-sleep-max",
                tr("macro.batch.min", "Min"),
                tr("macro.batch.max", "Max"),
                {
                    min: 0,
                },
            ),
        );
    }

    return [
        batchField(
            tr("macro.batch.direction", "Direction"),
            toggleRow("search-scroll-direction", scrollDirectionOptions(false)),
        ),
        batchField(
            tr("macro.batch.steps", "Steps"),
            numberPair(
                "search-scroll-min",
                "search-scroll-max",
                tr("macro.batch.min", "Min"),
                tr("macro.batch.max", "Max"),
                {
                    min: 0,
                },
            ),
        ),
    ].join("");
}

function replaceTemplate(type: BatchActionType): string {
    if (type === "mouse") {
        return [
            batchField(
                tr("macro.batch.button", "Button"),
                toggleRow("replace-mouse-button", mouseButtonOptions(true)),
            ),
            batchField(
                tr("macro.batch.action", "Action"),
                toggleRow("replace-mouse-action", actionOptions(true)),
                tr(
                    "macro.batch.hold_sequence_action_hint",
                    "Action type changes are skipped for recorded holds; their Down -> Sleep -> Up structure is kept.",
                ),
            ),
            batchField(
                tr("macro.batch.hold_duration", "Hold duration (ms)"),
                numberEditor(
                    "replace-mouse-hold-mode",
                    "replace-mouse-hold-value",
                    "100",
                ),
                `${tr("macro.batch.hold_replace_hint", "The new duration is applied to hold actions.")} ${tr(
                    "macro.batch.hold_sequence_hint",
                    "Recorded holds are recognized as Down -> Sleep -> Up sequences.",
                )}`,
            ),
            batchField(
                tr("macro.batch.clicks", "Clicks"),
                toggleRow("replace-mouse-clicks", clickOptions(true)),
            ),
            batchField(
                tr("macro.batch.position", "Position"),
                `${toggleRow("replace-mouse-position", positionOptions(true))}
                <div class="expandable-content" id="batch-mouse-custom-position">
                    <div class="expandable-inner">
                        <div class="batch-input-pair batch-custom-position">
                            ${numberBox("replace-mouse-x", "X", { id: "batch-mouse-x" })}
                            ${numberBox("replace-mouse-y", "Y", { id: "batch-mouse-y" })}
                            <button type="button" class="pick-btn" id="batch-mouse-pick-btn">
                                <span class="icon" style="margin-right: 4px; font-size: 13px;">&#58633;</span>
                                ${escapeHtml(t("picking", "PICK"))}
                            </button>
                        </div>
                    </div>
                </div>`,
            ),
        ].join("");
    }

    if (type === "keyboard") {
        return [
            batchField(
                tr("macro.batch.action", "Action"),
                toggleRow("replace-keyboard-action", actionOptions(true)),
            ),
            batchField(
                tr("macro.batch.hold_duration", "Hold duration (ms)"),
                numberEditor(
                    "replace-keyboard-hold-mode",
                    "replace-keyboard-hold-value",
                    "50",
                ),
            ),
            batchField(
                tr("macro.batch.key_pattern", "Key pattern"),
                `<div class="batch-key-row">
                    ${textBox(
                        "replace-key-combo",
                        tr(
                            "macro.batch.key_keep_placeholder",
                            "Leave empty to keep the current key",
                        ),
                        "batch-replace-key-combo",
                    )}
                    <button type="button" class="kb-record-btn batch-key-record-btn" id="batch-key-record-btn">${escapeHtml(
                        t("click_to_record", "Click to Record"),
                    )}</button>
                    <button type="button" class="batch-key-clear-btn" id="batch-key-clear-btn" title="${escapeHtml(keepLabel())}" style="display: none;">
                        <span class="icon">&#57742;</span>
                    </button>
                </div>`,
            ),
        ].join("");
    }

    if (type === "move") {
        return [
            batchField(
                tr("macro.batch.style", "Style"),
                toggleRow("replace-move-style", moveStyleOptions(true)),
            ),
            batchField(
                tr("macro.batch.duration", "Duration (ms)"),
                numberEditor(
                    "replace-move-duration-mode",
                    "replace-move-duration-value",
                    "300",
                ),
            ),
        ].join("");
    }

    if (type === "sleep") {
        return batchField(
            tr("macro.batch.duration", "Duration (ms)"),
            numberEditor("replace-sleep-mode", "replace-sleep-value", "500"),
        );
    }

    return [
        batchField(
            tr("macro.batch.direction", "Direction"),
            toggleRow("replace-scroll-direction", scrollDirectionOptions(true)),
        ),
        batchField(
            tr("macro.batch.amount", "Steps"),
            numberEditor("replace-scroll-mode", "replace-scroll-value", "1"),
        ),
    ].join("");
}

function refreshIndicators(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>(".toggle-row").forEach((row) => {
        const activeButton = row.querySelector<HTMLElement>(
            ".toggle-option.active",
        );
        if (activeButton) {
            createSlideIndicator(row, activeButton, true);
        }
    });
}

function updateTypeUi() {
    const row = q("batch-type-grid");
    if (!row) {
        return;
    }

    row.querySelectorAll<HTMLElement>(".multi-btn").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.value === batchState.type,
        );
    });

    const activeButton = row.querySelector<HTMLElement>(".multi-btn.active");
    if (activeButton) {
        createSlideIndicator(row, activeButton, true);
    }
}

function updateScopeUi() {
    const selectedIds = getSelectedMacroActionIds();
    if (batchState.scope === "selected" && selectedIds.length === 0) {
        batchState.scope = "all";
    }

    const scopeRow = q("batch-scope-toggle");
    const selectedButton = q<HTMLButtonElement>("batch-scope-selected");
    if (selectedButton) {
        selectedButton.textContent = tr(
            "macro.batch.scope_selected",
            "Selected ({count})",
            {
                count: String(selectedIds.length),
            },
        );
        selectedButton.disabled = selectedIds.length === 0;
        selectedButton.title =
            selectedIds.length === 0
                ? tr(
                      "macro.batch.no_selected",
                      "Select one or more macro actions first",
                  )
                : "";
    }

    scopeRow
        ?.querySelectorAll<HTMLElement>(".toggle-option")
        .forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.value === batchState.scope,
            );
        });

    const activeButton = scopeRow?.querySelector<HTMLElement>(
        ".toggle-option.active",
    );
    if (scopeRow && activeButton) {
        createSlideIndicator(scopeRow, activeButton, true);
    }
}

function updateConditionalSections() {
    const position = activeValue("replace", "replace-mouse-position");
    q("batch-mouse-custom-position")?.classList.toggle(
        "expanded",
        position === "custom",
    );

    const holdExpandable = q("batch-search-hold-expandable");
    if (holdExpandable) {
        const actionFilter =
            batchState.type === "mouse"
                ? activeValue("search", "search-mouse-action")
                : activeValue("search", "search-keyboard-action");
        holdExpandable.classList.toggle(
            "expanded",
            actionFilter === "any" || actionFilter === "hold",
        );
    }

    q("batch-replace-fields")
        ?.querySelectorAll<HTMLElement>("[data-editor-expand]")
        .forEach((expandable) => {
            const modeField = expandable.dataset.editorExpand;
            if (!modeField) {
                return;
            }
            const mode = activeValue("replace", modeField);
            expandable.classList.toggle("expanded", mode !== "keep");
        });

    const keyComboInput = q<HTMLInputElement>("batch-replace-key-combo");
    const keyClearButton = q<HTMLButtonElement>("batch-key-clear-btn");
    if (keyComboInput && keyClearButton) {
        keyClearButton.style.display = keyComboInput.value.trim()
            ? "inline-flex"
            : "none";
    }
}

function applyBatchMouseButtonSupport() {
    const allowedButtons = new Set(
        macroState.capabilities.supported_mouse_buttons,
    );
    (["search-mouse-button", "replace-mouse-button"] as const).forEach(
        (field) => {
            const scope = field.startsWith("search") ? "search" : "replace";
            const root = q(
                scope === "search"
                    ? "batch-search-fields"
                    : "batch-replace-fields",
            );
            const row = root?.querySelector<HTMLElement>(
                `[data-field="${field}"]`,
            );
            if (!row) {
                return;
            }

            row.querySelectorAll<HTMLButtonElement>(".toggle-option").forEach(
                (button) => {
                    const value = button.dataset.value || "";
                    if (value === "any" || value === "keep") {
                        return;
                    }
                    const supported = allowedButtons.has(value);
                    button.disabled = !supported;
                    button.title = supported
                        ? ""
                        : t(
                              "config.mouse_btn_unsupported",
                              'Mouse button "{value}" is not supported on this system',
                              { value },
                          );
                },
            );
        },
    );
}

function activeValue(scope: "search" | "replace", field: string): string {
    const root = q(
        scope === "search" ? "batch-search-fields" : "batch-replace-fields",
    );
    const row = root?.querySelector<HTMLElement>(`[data-field="${field}"]`);
    return (
        row?.querySelector<HTMLElement>(".toggle-option.active")?.dataset
            .value || "any"
    );
}

function inputValue(scope: "search" | "replace", field: string): string {
    const root = q(
        scope === "search" ? "batch-search-fields" : "batch-replace-fields",
    );
    const input = root?.querySelector<HTMLInputElement>(
        `[data-field="${field}"]`,
    );
    return input?.value || "";
}

function numberValue(
    scope: "search" | "replace",
    field: string,
): number | undefined {
    const raw = inputValue(scope, field).trim();
    if (!raw) {
        return undefined;
    }

    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
}

function integerValue(
    scope: "search" | "replace",
    field: string,
): number | undefined {
    const value = numberValue(scope, field);
    return value === undefined ? undefined : Math.trunc(value);
}

function nonNegativeIntegerValue(
    scope: "search" | "replace",
    field: string,
): number | undefined {
    const value = integerValue(scope, field);
    return value === undefined
        ? undefined
        : Math.max(0, Math.min(4_294_967_295, value));
}

function coordinateValue(
    scope: "search" | "replace",
    field: string,
): number | undefined {
    const value = integerValue(scope, field);
    return value === undefined
        ? undefined
        : Math.max(-2_147_483_648, Math.min(2_147_483_647, value));
}

function buildNumberEdit(
    scope: "search" | "replace",
    modeField: string,
    valueField: string,
) {
    const mode = activeValue(scope, modeField);
    return {
        mode,
        value: mode === "keep" ? undefined : numberValue(scope, valueField),
    };
}

function buildRequest(dryRun: boolean) {
    const type = batchState.type;
    const search: Record<string, unknown> = { action_type: type };
    const replace: Record<string, unknown> = {};

    if (type === "mouse") {
        const mouseAction = activeValue("search", "search-mouse-action");
        const canFilterHold = mouseAction === "any" || mouseAction === "hold";
        search.button = activeValue("search", "search-mouse-button");
        search.mouse_action = mouseAction;
        search.clicks =
            activeValue("search", "search-mouse-clicks") === "any"
                ? undefined
                : Number(activeValue("search", "search-mouse-clicks"));
        search.position = activeValue("search", "search-mouse-position");
        search.hold_min_ms = canFilterHold
            ? nonNegativeIntegerValue("search", "search-hold-min")
            : undefined;
        search.hold_max_ms = canFilterHold
            ? nonNegativeIntegerValue("search", "search-hold-max")
            : undefined;

        replace.mouse = {
            button: activeValue("replace", "replace-mouse-button"),
            action: activeValue("replace", "replace-mouse-action"),
            hold_duration: buildNumberEdit(
                "replace",
                "replace-mouse-hold-mode",
                "replace-mouse-hold-value",
            ),
            clicks:
                activeValue("replace", "replace-mouse-clicks") === "keep"
                    ? undefined
                    : Number(activeValue("replace", "replace-mouse-clicks")),
            position: activeValue("replace", "replace-mouse-position"),
            x: coordinateValue("replace", "replace-mouse-x"),
            y: coordinateValue("replace", "replace-mouse-y"),
        };
    } else if (type === "keyboard") {
        const keyboardAction = activeValue("search", "search-keyboard-action");
        const canFilterHold =
            keyboardAction === "any" || keyboardAction === "hold";
        search.keyboard_action = keyboardAction;
        search.key_pattern =
            inputValue("search", "search-key-pattern").trim() || undefined;
        search.hold_min_ms = canFilterHold
            ? nonNegativeIntegerValue("search", "search-hold-min")
            : undefined;
        search.hold_max_ms = canFilterHold
            ? nonNegativeIntegerValue("search", "search-hold-max")
            : undefined;

        replace.keyboard = {
            action: activeValue("replace", "replace-keyboard-action"),
            hold_duration: buildNumberEdit(
                "replace",
                "replace-keyboard-hold-mode",
                "replace-keyboard-hold-value",
            ),
            key_combo:
                inputValue("replace", "replace-key-combo").trim() || undefined,
        };
    } else if (type === "move") {
        search.move_style = activeValue("search", "search-move-style");

        replace.movement = {
            style: activeValue("replace", "replace-move-style"),
            duration_ms: buildNumberEdit(
                "replace",
                "replace-move-duration-mode",
                "replace-move-duration-value",
            ),
        };
    } else if (type === "sleep") {
        search.sleep_min_ms = nonNegativeIntegerValue(
            "search",
            "search-sleep-min",
        );
        search.sleep_max_ms = nonNegativeIntegerValue(
            "search",
            "search-sleep-max",
        );

        replace.sleep = {
            duration_ms: buildNumberEdit(
                "replace",
                "replace-sleep-mode",
                "replace-sleep-value",
            ),
        };
    } else {
        search.scroll_direction = activeValue(
            "search",
            "search-scroll-direction",
        );
        search.scroll_min_steps = nonNegativeIntegerValue(
            "search",
            "search-scroll-min",
        );
        search.scroll_max_steps = nonNegativeIntegerValue(
            "search",
            "search-scroll-max",
        );

        replace.scroll = {
            direction: activeValue("replace", "replace-scroll-direction"),
            amount: buildNumberEdit(
                "replace",
                "replace-scroll-mode",
                "replace-scroll-value",
            ),
        };
    }

    return {
        scope: batchState.scope,
        action_ids:
            batchState.scope === "selected" ? getSelectedMacroActionIds() : [],
        dry_run: dryRun,
        search,
        replace,
    };
}

function wireNumericInputs(container: HTMLElement) {
    container
        .querySelectorAll<HTMLInputElement>("input[type='number']")
        .forEach((inputElement) => {
            inputElement.addEventListener("focus", () => {
                inputElement.select();
            });

            inputElement.addEventListener(
                "wheel",
                (event: WheelEvent) => {
                    event.preventDefault();
                    const editor = inputElement.closest<HTMLElement>(
                        ".batch-number-editor",
                    );
                    const modeField = editor?.dataset.modeField;
                    const mode = modeField
                        ? activeValue("replace", modeField)
                        : "";
                    const step = mode === "multiply" ? 0.1 : 1;
                    const minAttr = inputElement.getAttribute("min");
                    const min =
                        minAttr !== null
                            ? Number.parseFloat(minAttr)
                            : Number.NEGATIVE_INFINITY;
                    const current = Number.parseFloat(inputElement.value) || 0;
                    const next =
                        event.deltaY < 0
                            ? current + step
                            : Math.max(min, current - step);
                    inputElement.value =
                        mode === "multiply"
                            ? String(Number(next.toFixed(2)))
                            : String(Math.round(next));
                    inputElement.dataset.auto = "false";
                    inputElement.dispatchEvent(
                        new Event("input", { bubbles: true }),
                    );
                },
                { passive: false },
            );
        });
}

function recordKeyComboFromEvent(event: KeyboardEvent): string {
    const modifiers: string[] = [];
    if (event.ctrlKey) modifiers.push("ctrl");
    if (event.shiftKey) modifiers.push("shift");
    if (event.altKey) modifiers.push("alt");
    if (event.metaKey) modifiers.push("win");

    const keyMap: Record<string, string> = {
        " ": "space",
        enter: "enter",
        tab: "tab",
        backspace: "backspace",
        escape: "escape",
        capslock: "capslock",
        arrowup: "up",
        arrowdown: "down",
        arrowleft: "left",
        arrowright: "right",
        pageup: "pageup",
        pagedown: "pagedown",
        delete: "delete",
        insert: "insert",
        home: "home",
        end: "end",
    };

    const raw = event.key.toLowerCase();
    const mapped = keyMap[raw] || normalizeKey(raw);
    const isModifierOnly = [
        "control",
        "shift",
        "alt",
        "meta",
        "ctrl",
        "win",
    ].includes(mapped);
    if (!isModifierOnly && mapped && !modifiers.includes(mapped)) {
        modifiers.push(mapped);
    }

    return modifiers.join("+");
}

function wireDynamicControls(search: HTMLElement, replace: HTMLElement) {
    wireNumericInputs(search);
    wireNumericInputs(replace);

    q("batch-mouse-pick-btn")?.addEventListener("click", async (event) => {
        const button = event.currentTarget as HTMLElement;
        await captureCursorPosition(button, "batch-mouse-x", "batch-mouse-y");
        schedulePreview(0);
    });

    const recordButton = q<HTMLButtonElement>("batch-key-record-btn");
    const keyComboInput = q<HTMLInputElement>("batch-replace-key-combo");
    const clearButton = q<HTMLButtonElement>("batch-key-clear-btn");

    clearButton?.addEventListener("click", () => {
        stopKeyRecording();
        if (keyComboInput) {
            keyComboInput.value = "";
            updateConditionalSections();
            schedulePreview(0);
        }
    });

    recordButton?.addEventListener("click", () => {
        if (activeKeyRecordCleanup) {
            stopKeyRecording();
            return;
        }

        const handleKey = (event: KeyboardEvent) => {
            if (!isBatchDrawerOpen()) {
                stopKeyRecording();
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const raw = event.key.toLowerCase();
            if (["control", "shift", "alt", "meta"].includes(raw)) {
                return;
            }

            const combo = recordKeyComboFromEvent(event);
            if (combo && keyComboInput) {
                keyComboInput.value = combo;
                updateConditionalSections();
                schedulePreview(0);
            }

            stopKeyRecording();
        };

        const cleanup = () => {
            window.removeEventListener("keydown", handleKey, true);
            recordButton.classList.remove("active");
            recordButton.textContent = t("click_to_record", "Click to Record");
        };

        activeKeyRecordCleanup = cleanup;
        recordButton.classList.add("active");
        recordButton.textContent = t("recording", "Recording...");
        window.addEventListener("keydown", handleKey, true);
    });
}

function renderBatchFields() {
    stopKeyRecording();
    const search = q("batch-search-fields");
    const replace = q("batch-replace-fields");
    if (!search || !replace) {
        return;
    }

    search.innerHTML = searchTemplate(batchState.type);
    replace.innerHTML = replaceTemplate(batchState.type);
    applyBatchMouseButtonSupport();
    wireDynamicControls(search, replace);
    updateConditionalSections();
    window.requestAnimationFrame(() => {
        refreshIndicators(search);
        refreshIndicators(replace);
    });
}

function updatePreviewUi() {
    const preview = q("batch-preview");
    const text = q("batch-preview-text");
    const applyButton = q<HTMLButtonElement>("batch-apply");
    if (!preview || !text || !applyButton) {
        return;
    }

    preview.classList.remove("has-changes", "is-empty");
    let canApply = false;

    if (batchState.previewPending) {
        text.textContent = tr(
            "macro.batch.preview_checking",
            "Checking matches...",
        );
        preview.classList.add("is-empty");
    } else if (batchState.previewFailed) {
        text.textContent = tr(
            "macro.batch.preview_error",
            "Could not check matching actions",
        );
        preview.classList.add("is-empty");
    } else if (batchState.preview) {
        const { matched, changed } = batchState.preview;
        if (changed > 0) {
            text.textContent = tr(
                "macro.batch.preview_changed",
                "{changed} of {matched} matching actions will change",
                { changed: String(changed), matched: String(matched) },
            );
            preview.classList.add("has-changes");
            canApply = true;
        } else if (matched > 0) {
            text.textContent = tr(
                "macro.batch.preview_no_changes",
                "{matched} actions match, but no changes are selected",
                { matched: String(matched) },
            );
            preview.classList.add("is-empty");
        } else {
            text.textContent = tr(
                "macro.batch.preview_none",
                "No actions match this search",
            );
            preview.classList.add("is-empty");
        }
    } else {
        text.textContent = tr(
            "macro.batch.preview_none",
            "No actions match this search",
        );
        preview.classList.add("is-empty");
    }

    applyButton.disabled = !canApply;
}

async function runPreview(serial: number) {
    if (!isBatchDrawerOpen() || serial !== batchState.previewSerial) {
        return;
    }

    try {
        const request = buildRequest(true);
        const requestJson = JSON.stringify(request);
        const result = await invoke<BatchPreviewResult>(
            "batch_edit_macro_actions",
            {
                requestJson,
                request_json: requestJson,
            },
        );

        if (serial !== batchState.previewSerial) {
            return;
        }

        batchState.preview = result;
        batchState.previewPending = false;
        batchState.previewFailed = false;
    } catch (error) {
        if (serial !== batchState.previewSerial) {
            return;
        }

        console.error("Failed to preview macro batch edit", error);
        batchState.preview = null;
        batchState.previewPending = false;
        batchState.previewFailed = true;
    }

    updatePreviewUi();
}

function schedulePreview(delay = 180) {
    if (!isBatchDrawerOpen()) {
        return;
    }

    if (batchState.previewTimer !== null) {
        window.clearTimeout(batchState.previewTimer);
    }

    const serial = ++batchState.previewSerial;
    batchState.previewPending = true;
    batchState.previewFailed = false;
    updatePreviewUi();

    batchState.previewTimer = window.setTimeout(() => {
        batchState.previewTimer = null;
        void runPreview(serial);
    }, delay);
}

async function applyBatchEdit() {
    const applyButton = q<HTMLButtonElement>("batch-apply");
    if (!applyButton || applyButton.disabled) {
        return;
    }

    applyButton.disabled = true;
    const request = buildRequest(false);
    const requestJson = JSON.stringify(request);

    try {
        const result = await invoke<BatchPreviewResult>(
            "batch_edit_macro_actions",
            {
                requestJson,
                request_json: requestJson,
            },
        );

        if (result.changed === 0) {
            batchState.preview = result;
            batchState.previewPending = false;
            batchState.previewFailed = false;
            updatePreviewUi();
            notify(
                tr("macro.batch.no_changes", "No macro actions were changed"),
                "info",
                2200,
            );
            return;
        }

        await loadActionsFromBackend();
        closeDrawer();
        notify(
            tr("macro.batch.applied", "Updated {count} macro actions", {
                count: String(result.changed),
            }),
            "success",
            2400,
        );
    } catch (error) {
        console.error("Failed to apply macro batch edit", error);
        notify(
            tr(
                "macro.batch.error",
                "Could not apply batch edits. Check the values and try again.",
            ),
            "error",
            3000,
        );
    } finally {
        if (isBatchDrawerOpen()) {
            updatePreviewUi();
        }
    }
}

function openBatchEditor() {
    if (macroState.actions.length === 0) {
        notify(
            tr("macro.batch.empty", "No macro actions to edit yet"),
            "info",
            2200,
        );
        return;
    }

    const selectedIds = getSelectedMacroActionIds();
    batchState.scope = selectedIds.length > 0 ? "selected" : "all";
    batchState.preview = null;
    batchState.previewPending = false;
    batchState.previewFailed = false;
    batchState.previewSerial += 1;
    if (batchState.previewTimer !== null) {
        window.clearTimeout(batchState.previewTimer);
        batchState.previewTimer = null;
    }

    updateScopeUi();
    updateTypeUi();
    renderBatchFields();
    openDrawer("section-macro-batch", "Batch Edit", "&#57714;");

    window.setTimeout(() => {
        updateScopeUi();
        updateTypeUi();
        const search = q("batch-search-fields");
        const replace = q("batch-replace-fields");
        if (search) {
            refreshIndicators(search);
        }
        if (replace) {
            refreshIndicators(replace);
        }
        updateConditionalSections();
        schedulePreview(0);
    }, 60);
}

function initBatchFieldEvents() {
    (["batch-search-fields", "batch-replace-fields"] as const).forEach((id) => {
        const root = q(id);
        if (!root) {
            return;
        }

        root.addEventListener("click", (event) => {
            const button = (
                event.target as HTMLElement
            ).closest<HTMLButtonElement>(".toggle-option");
            if (!button || button.disabled) {
                return;
            }

            const row = button.closest<HTMLElement>(".toggle-row");
            if (!row) {
                return;
            }

            event.preventDefault();
            row.querySelectorAll<HTMLElement>(".toggle-option").forEach(
                (entry) => {
                    entry.classList.remove("active");
                },
            );
            button.classList.add("active");
            createSlideIndicator(row, button);

            const editor = row.closest<HTMLElement>(".batch-number-editor");
            const numberInput =
                editor?.querySelector<HTMLInputElement>("input[data-field]");
            const mode = button.dataset.value;
            const usesAutoValue =
                !numberInput ||
                numberInput.value.trim() === "" ||
                numberInput.dataset.auto !== "false";
            if (numberInput && mode && usesAutoValue) {
                if (mode === "multiply") {
                    numberInput.value = "1";
                } else if (mode === "set" || mode === "add") {
                    numberInput.value = editor?.dataset.defaultValue || "";
                }
                numberInput.dataset.auto = "true";
            }

            updateConditionalSections();
            schedulePreview();
        });

        root.addEventListener("input", (event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement) {
                target.dataset.auto = "false";
            }
            updateConditionalSections();
            schedulePreview();
        });
    });
}

export function initBatchEdit() {
    q("macro-batch-btn")?.addEventListener("click", openBatchEditor);

    q("batch-scope-toggle")?.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
            ".toggle-option",
        );
        if (!button || button.disabled) {
            return;
        }

        batchState.scope =
            button.dataset.value === "selected" ? "selected" : "all";
        updateScopeUi();
        schedulePreview(0);
    });

    q("batch-type-grid")?.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>(
            ".multi-btn",
        );
        const value = button?.dataset.value as BatchActionType | undefined;
        if (!value) {
            return;
        }

        batchState.type = value;
        updateTypeUi();
        renderBatchFields();
        schedulePreview(0);
    });

    q("batch-cancel")?.addEventListener("click", () => {
        stopKeyRecording();
        closeDrawer();
    });
    q("batch-apply")?.addEventListener("click", () => {
        stopKeyRecording();
        void applyBatchEdit();
    });

    initBatchFieldEvents();
}
