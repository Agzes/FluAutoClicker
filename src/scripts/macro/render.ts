import { invoke } from "@tauri-apps/api/core";
import { setKeyBadgeContent } from "../key-badges";
import { fromBackendAction } from "./backend";
import { macroState } from "./state";
import type { MacroBackendAction, MacroUiAction } from "./types";
import { formatDuration } from "../utils";
import { t } from "../i18n";

export function getMacroDurationMs(actions: MacroBackendAction[]): number {
    let totalMs = 0;
    for (const action of actions) {
        const config = action.config;
        if (!config || !config.type) continue;

        if (config.type === "sleep") {
            totalMs += Number(config.duration_ms) || 0;
        } else if (config.type === "mouse" || config.type === "keyboard") {
            const act = config.action;
            if (act && typeof act === "object" && "hold" in act) {
                const hold = (act as { hold?: { duration_ms?: unknown } }).hold;
                const duration = Number(hold?.duration_ms);
                if (Number.isFinite(duration)) {
                    totalMs += duration;
                }
            }
        } else if (config.type === "move") {
            const style = config.style;
            if (style && typeof style === "object") {
                if ("linear" in style) {
                    const linear = (style as { linear?: { duration_ms?: unknown } }).linear;
                    const duration = Number(linear?.duration_ms);
                    if (Number.isFinite(duration)) {
                        totalMs += duration;
                    }
                } else if ("smooth" in style) {
                    const smooth = (style as { smooth?: { duration_ms?: unknown } }).smooth;
                    const duration = Number(smooth?.duration_ms);
                    if (Number.isFinite(duration)) {
                        totalMs += duration;
                    }
                }
            }
        } else if (config.type === "raw_move") {
            totalMs += Number(config.duration_ms) || 0;
        }
    }
    return totalMs;
}


type DropPosition = "before" | "after";

type PointerDragState = {
    actionId: number;
    pointerId: number;
    item: HTMLElement;
    startY: number;
    hasMoved: boolean;
    previousActions: MacroUiAction[];
};

let pointerDragState: PointerDragState | null = null;
let reorderRequestSerial = 0;
let selectedActionId: number | null = null;

function getListContainer() {
    return document.getElementById("macro-list-container");
}

function bindPointerDragListeners() {
    window.addEventListener("pointermove", handlePointerDragMove, { passive: false });
    window.addEventListener("pointerup", handlePointerDragEnd, { passive: false });
    window.addEventListener("pointercancel", handlePointerDragCancel);
}

function unbindPointerDragListeners() {
    window.removeEventListener("pointermove", handlePointerDragMove);
    window.removeEventListener("pointerup", handlePointerDragEnd);
    window.removeEventListener("pointercancel", handlePointerDragCancel);
}

function getActionItems() {
    const listContainer = getListContainer();
    if (!listContainer) {
        return [];
    }

    return Array.from(listContainer.querySelectorAll<HTMLElement>(".macro-action-item"));
}

function getActionIdFromElement(element: HTMLElement | null) {
    const rawId = element?.getAttribute("data-action-id");
    const id = Number(rawId);
    return Number.isFinite(id) ? id : null;
}

function getDropPosition(item: HTMLElement, pointer: { clientY: number }): DropPosition {
    const rect = item.getBoundingClientRect();
    return pointer.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function getDropTarget(clientY: number) {
    const listContainer = getListContainer();
    if (!listContainer || !pointerDragState) {
        return null;
    }

    const items = getActionItems()
        .filter((item) => getActionIdFromElement(item) !== pointerDragState?.actionId);

    if (items.length === 0) {
        return null;
    }

    let closestItem = items[0];
    let closestDistance = Number.POSITIVE_INFINITY;

    items.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const distance = Math.abs(clientY - midpoint);

        if (distance < closestDistance) {
            closestDistance = distance;
            closestItem = item;
        }
    });

    return {
        item: closestItem,
        position: getDropPosition(closestItem, { clientY }),
    };
}

function animateActionLayoutChange(updateLayout: () => void) {
    const previousRects = new Map<HTMLElement, DOMRect>();

    getActionItems().forEach((item) => {
        previousRects.set(item, item.getBoundingClientRect());
    });

    updateLayout();

    getActionItems().forEach((item) => {
        const previousRect = previousRects.get(item);
        if (!previousRect || item.classList.contains("dragging")) {
            return;
        }

        const nextRect = item.getBoundingClientRect();
        const deltaY = previousRect.top - nextRect.top;

        if (Math.abs(deltaY) < 1) {
            return;
        }

        item.animate(
            [
                { transform: `translateY(${deltaY}px)` },
                { transform: "translateY(0)" },
            ],
            {
                duration: 160,
                easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            }
        );
    });
}

function moveDraggedElement(clientY: number) {
    if (!pointerDragState) {
        return;
    }

    if (!pointerDragState.hasMoved) {
        if (Math.abs(clientY - pointerDragState.startY) < 4) {
            return;
        }

        pointerDragState.hasMoved = true;
        getListContainer()?.classList.add("dragging");
        pointerDragState.item.classList.add("dragging");
    }

    const target = getDropTarget(clientY);
    if (!target) {
        return;
    }

    const draggedItem = pointerDragState.item;
    animateActionLayoutChange(() => {
        if (target.position === "after") {
            target.item.after(draggedItem);
        } else {
            target.item.before(draggedItem);
        }
    });
}

function getVisibleActionOrder() {
    const listContainer = getListContainer();
    if (!listContainer) {
        return [];
    }

    return Array.from(listContainer.querySelectorAll<HTMLElement>(".macro-action-item"))
        .map((item) => getActionIdFromElement(item))
        .filter((id): id is number => id !== null);
}

function finishPointerDrag(commit: boolean) {
    const dragState = pointerDragState;
    if (!dragState) {
        return;
    }

    unbindPointerDragListeners();
    pointerDragState = null;
    dragState.item.classList.remove("dragging", "drag-pressed");
    getListContainer()?.classList.remove("dragging");

    if (commit) {
        applyVisibleActionOrder(dragState.previousActions);
    } else {
        renderActions();
    }
}

function handlePointerDragMove(event: PointerEvent) {
    if (!pointerDragState || pointerDragState.pointerId !== event.pointerId) {
        return;
    }

    event.preventDefault();
    moveDraggedElement(event.clientY);
}

function handlePointerDragEnd(event: PointerEvent) {
    if (!pointerDragState || pointerDragState.pointerId !== event.pointerId) {
        return;
    }

    event.preventDefault();
    moveDraggedElement(event.clientY);
    finishPointerDrag(true);
}

function handlePointerDragCancel(event: PointerEvent) {
    if (!pointerDragState || pointerDragState.pointerId !== event.pointerId) {
        return;
    }

    finishPointerDrag(false);
}

async function persistActionOrder(actionIds: number[], previousActions: MacroUiAction[]) {
    const requestSerial = ++reorderRequestSerial;

    try {
        await invoke("reorder_macro_actions", { actionIds, action_ids: actionIds });
    } catch (error) {
        console.error("Failed to reorder macro actions", error);
        if (requestSerial === reorderRequestSerial) {
            macroState.actions = previousActions;
            renderActions();
            await loadActionsFromBackend();
        }
    }
}

function applyVisibleActionOrder(previousActions: MacroUiAction[]) {
    const visibleOrder = getVisibleActionOrder();
    if (visibleOrder.length !== previousActions.length) {
        renderActions();
        return;
    }

    if (visibleOrder.every((id, index) => id === previousActions[index]?.id)) {
        macroState.actions = previousActions;
        renderActions();
        return;
    }

    const actionsById = new Map(previousActions.map((action) => [action.id, action]));
    const nextActions = visibleOrder
        .map((id) => actionsById.get(id))
        .filter((action): action is MacroUiAction => Boolean(action));

    if (nextActions.length !== previousActions.length) {
        renderActions();
        return;
    }

    macroState.actions = nextActions;
    const rawActionsById = new Map(macroState.rawActions.map((action) => [Number(action.id), action]));
    macroState.rawActions = visibleOrder
        .map((id) => rawActionsById.get(id))
        .filter((action): action is MacroBackendAction => Boolean(action));

    renderActions();
    void persistActionOrder(visibleOrder, previousActions);
}

function selectAction(actionId: number | null) {
    selectedActionId = actionId;
    getActionItems().forEach((item) => {
        const isSelected = actionId !== null && getActionIdFromElement(item) === actionId;
        item.classList.toggle("selected", isSelected);
        item.setAttribute("aria-selected", String(isSelected));
    });
}

async function removeAction(actionId: number) {
    if (selectedActionId === actionId) {
        selectedActionId = null;
    }

    try {
        await invoke("remove_macro_action", { actionId, action_id: actionId });
        macroState.actions = macroState.actions.filter((entry) => entry.id !== actionId);
        macroState.rawActions = macroState.rawActions.filter((entry) => Number(entry.id) !== actionId);
        renderActions();
    } catch (error) {
        console.error("Failed to remove macro action", error);
        await loadActionsFromBackend();
    }
}

async function duplicateAction(actionId: number) {
    try {
        await invoke("duplicate_macro_action", { actionId, action_id: actionId });
        await loadActionsFromBackend({ animateNew: true });
    } catch (error) {
        console.error("Failed to duplicate macro action", error);
        await loadActionsFromBackend();
    }
}

function moveSelectedAction(delta: number) {
    if (selectedActionId === null) {
        return;
    }

    const previousActions = [...macroState.actions];
    const index = previousActions.findIndex((action) => action.id === selectedActionId);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= previousActions.length) {
        return;
    }

    const nextActions = [...previousActions];
    [nextActions[index], nextActions[targetIndex]] = [nextActions[targetIndex], nextActions[index]];

    const rawById = new Map(macroState.rawActions.map((action) => [Number(action.id), action]));
    macroState.actions = nextActions;
    macroState.rawActions = nextActions
        .map((action) => rawById.get(action.id))
        .filter((action): action is MacroBackendAction => Boolean(action));

    renderActions();
    void persistActionOrder(nextActions.map((action) => action.id), previousActions);
}

export function initMacroEditorShortcuts() {
    document.addEventListener("keydown", (event) => {
        if (selectedActionId === null || event.defaultPrevented) {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (target && (target.matches("input, textarea, select") || target.isContentEditable)) {
            return;
        }

        const key = event.key;

        if (key === "Delete") {
            event.preventDefault();
            void removeAction(selectedActionId);
            return;
        }

        if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "d") {
            event.preventDefault();
            void duplicateAction(selectedActionId);
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === "ArrowUp" || key === "ArrowDown")) {
            event.preventDefault();
            moveSelectedAction(key === "ArrowUp" ? -1 : 1);
        }
    });
}

function appendHighlightedDetails(container: Element, text: string) {
    const parts = text.split(/(\d+(?:\.\d+)?(?:\s*ms)?)/gi).filter(Boolean);

    parts.forEach((part) => {
        const isNumber = /^\d+(?:\.\d+)?(?:\s*ms)?$/i.test(part.trim());
        const element = document.createElement("span");
        element.className = isNumber ? "action-detail-number" : "action-detail-text";
        element.textContent = part;
        container.appendChild(element);
    });
}

function getActionSummary(action: (typeof macroState.actions)[number]) {
    if (action.type === "sleep") {
        return action.details;
    }

    if (action.type === "scroll") {
        return action.details;
    }

    if (action.type === "move") {
        return t("macro.move_summary", "Move {details}", { details: `${action.details.charAt(0).toLowerCase()}${action.details.slice(1).replace(t("macro.instant_suffix", " (instant)"), "")}` });
    }

    if (action.type === "mouse") {
        const actionLabel = action.name.includes("Hold")
            ? action.name.replace("Hold", "hold")
            : action.name.replace("Click", "click");
        return `${actionLabel} ${action.details.charAt(0).toLowerCase()}${action.details.slice(1)}`;
    }

    if (action.type === "keyboard") {
        return action.detailSuffix ? `${action.name.replace(t("macro.key_prefix", "Key "), "")} ${action.details}` : `${action.name.replace(t("macro.key_prefix", "Key "), "")} ${action.details}`;
    }

    return `${action.name} ${action.details}`.trim();
}

function createActionElement(action: (typeof macroState.actions)[number], animate = false) {
    const item = document.createElement("div");
    item.className = "macro-action-item";
    item.setAttribute("data-action-id", String(action.id));
    if (animate) {
        item.classList.add("adding");
    }
    if (macroState.currentPlayingActionId === action.id) {
        item.classList.add("playing");
    }
    if (selectedActionId === action.id) {
        item.classList.add("selected");
        item.setAttribute("aria-selected", "true");
    }

    item.innerHTML = `
        <button class="action-drag-handle" type="button" aria-label="${t("macro.drag_to_reorder", "Drag to reorder")}" title="${t("macro.drag_to_reorder", "Drag to reorder")}">
            <span class="icon">&#57579;</span>
        </button>
        <div class="action-icon"><span class="icon">${action.icon}</span></div>
        <div class="action-info">
            <span class="action-details"></span>
        </div>
        <button class="action-edit" type="button" data-id="${action.id}" aria-label="${t("macro.edit_action_btn", "Edit action")}" title="${t("macro.edit_action_btn", "Edit action")}">
            <span class="icon">&#57714;</span>
        </button>
        <button class="action-duplicate" type="button" data-id="${action.id}" aria-label="${t("macro.duplicate_action", "Duplicate action")}" title="${t("macro.duplicate_action", "Duplicate action")}">
            <span class="icon">&#57502;</span>
        </button>
        <button class="action-remove" type="button" data-id="${action.id}" aria-label="${t("macro.remove_action", "Remove action")}" title="${t("macro.remove_action", "Remove action")}">
            <span class="icon">&#57742;</span>
        </button>
    `;

    const details = item.querySelector(".action-details");
    if (details && action.detailKeys?.length) {
        details.classList.add("action-details-keys");
        const prefix = document.createElement("span");
        prefix.className = "action-detail-text";
        prefix.textContent = `${action.name.replace(t("macro.key_prefix", "Key "), "")} `;
        details.appendChild(prefix);

        const combo = document.createElement("span");
        combo.className = "key-badge-combo";
        setKeyBadgeContent(combo, action.detailKeys);
        details.appendChild(combo);

        if (action.detailSuffix) {
            const suffix = document.createElement("span");
            suffix.className = "action-detail-suffix";
            appendHighlightedDetails(suffix, action.detailSuffix);
            details.appendChild(suffix);
        }
    } else if (details) {
        appendHighlightedDetails(details, getActionSummary(action));
    }

    const dragHandle = item.querySelector<HTMLElement>(".action-drag-handle");
    dragHandle?.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        finishPointerDrag(false);
        pointerDragState = {
            actionId: action.id,
            pointerId: event.pointerId,
            item,
            startY: event.clientY,
            hasMoved: false,
            previousActions: [...macroState.actions],
        };

        bindPointerDragListeners();
        item.classList.add("drag-pressed");
    });

    item.querySelector(".action-remove")?.addEventListener("click", () => {
        item.classList.add("removing");
        window.setTimeout(() => {
            void removeAction(action.id);
        }, 300);
    });

    item.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("button")) {
            return;
        }
        selectAction(action.id);
    });

    item.querySelector(".action-edit")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("flu:edit-macro-action", { detail: { actionId: action.id } }));
    });

    item.querySelector(".action-duplicate")?.addEventListener("click", () => {
        void duplicateAction(action.id);
    });

    if (animate) {
        item.addEventListener("animationend", () => item.classList.remove("adding"), { once: true });
    }

    return item;
}

export function renderActions(options: { animateNew?: boolean } = {}) {
    const rawTotalMs = getMacroDurationMs(macroState.rawActions);
    const speedMultiplier = (window as any).flu_macro_speed_multiplier || 1.0;
    const totalMs = Math.round(rawTotalMs / speedMultiplier);
    (window as any).flu_macro_duration = totalMs;
    const durationValEl = document.getElementById("macro-duration-val");
    if (durationValEl) {
        durationValEl.textContent = formatDuration(totalMs);
    }
    const updateCPSFn = (window as any).flu_update_cps;
    if (typeof updateCPSFn === "function") {
        updateCPSFn();
    }

    const listContainer = getListContainer();
    if (!listContainer) {
        return;
    }

    if (selectedActionId !== null && !macroState.actions.some((action) => action.id === selectedActionId)) {
        selectedActionId = null;
    }

    if (macroState.actions.length === 0) {
        listContainer.innerHTML = `
            <div class="macro-list-empty">
                <span>${t("macro.no_actions", "No actions recorded yet")}</span>
            </div>
        `;
        return;
    }

    listContainer.querySelector(".macro-list-empty")?.remove();
    const existingIds = new Set(
        Array.from(listContainer.querySelectorAll<HTMLElement>(".macro-action-item"))
            .map((element) => element.getAttribute("data-action-id") || "")
    );
    const liveIds = new Set(macroState.actions.map((action) => String(action.id)));
    listContainer.querySelectorAll<HTMLElement>(".macro-action-item").forEach((element) => {
        const id = element.getAttribute("data-action-id") || "";
        if (!liveIds.has(id)) {
            element.remove();
        }
    });

    let addedNewItemAtEnd = false;
    const lastActionId = macroState.actions[macroState.actions.length - 1]?.id ?? null;
    macroState.actions.forEach((action) => {
        const existing = listContainer.querySelector<HTMLElement>(`.macro-action-item[data-action-id="${action.id}"]`);
        const isNewItem = !existingIds.has(String(action.id));
        const shouldAnimate = Boolean(options.animateNew && isNewItem);
        const item = createActionElement(action, shouldAnimate);
        addedNewItemAtEnd ||= isNewItem && action.id === lastActionId;
        if (existing) {
            existing.replaceWith(item);
        } else {
            listContainer.appendChild(item);
        }
    });

    if (options.animateNew && addedNewItemAtEnd) {
        const isMinimized = document.body.classList.contains("window-minimized") || document.hidden;
        window.requestAnimationFrame(() => {
            listContainer.scrollTo({ top: listContainer.scrollHeight, behavior: isMinimized ? "auto" : "smooth" });
        });
    }
}

export function updateCurrentActionHighlight() {
    const listContainer = getListContainer();
    if (!listContainer) {
        return;
    }

    const isMinimized = document.body.classList.contains("window-minimized") || document.hidden || (window as any).flu_window_hidden;
    if (isMinimized) {
        return;
    }

    listContainer.querySelectorAll(".macro-action-item").forEach((element) => {
        const item = element as HTMLElement;
        const id = Number(item.getAttribute("data-action-id"));
        const isPlaying = macroState.currentPlayingActionId !== null && id === macroState.currentPlayingActionId;
        item.classList.toggle("playing", isPlaying);
        if (isPlaying) {
            item.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    });
}

export async function loadActionsFromBackend(options: { animateNew?: boolean } = {}) {
    const rawActions = await invoke<MacroBackendAction[]>("get_macro_actions");
    macroState.rawActions = rawActions;
    macroState.actions = rawActions
        .map((item) => fromBackendAction(item))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
    renderActions(options);
}
