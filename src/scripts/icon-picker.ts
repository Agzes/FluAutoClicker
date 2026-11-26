import iconCodepoints from "lucide-static/font/codepoints.json";

const icons: Record<string, number> = iconCodepoints as Record<string, number>;
const allIconKeys: string[] = Object.keys(icons);

let selectedIconKey: string | null = null;
let onConfirmCallback: ((key: string | null) => void) | null = null;

function getModal() {
    return document.getElementById("icon-picker-modal");
}

function getGrid() {
    return document.getElementById("icon-grid");
}

function getSearchInput() {
    return document.getElementById("icon-search-input") as HTMLInputElement | null;
}

function getSelectedLabel() {
    return document.getElementById("icon-picker-selected");
}

function renderGrid(filter?: string) {
    const grid = getGrid();
    if (!grid) return;

    const lowerFilter = (filter || "").toLowerCase();
    const matched = lowerFilter
        ? allIconKeys.filter((k) => k.includes(lowerFilter))
        : allIconKeys;

    grid.innerHTML = "";

    const fragment = document.createDocumentFragment();
    for (const key of matched) {
        const codepoint = icons[key];
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "icon-cell" + (key === selectedIconKey ? " selected" : "");
        cell.dataset.iconKey = key;
        cell.title = key;
        cell.textContent = String.fromCodePoint(codepoint);
        cell.addEventListener("click", () => onCellClick(key));
        fragment.appendChild(cell);
    }
    grid.appendChild(fragment);
}

function onCellClick(key: string) {
    selectedIconKey = key;

    const grid = getGrid();
    if (grid) {
        grid.querySelectorAll(".icon-cell").forEach((cell) => {
            cell.classList.toggle("selected", (cell as HTMLElement).dataset.iconKey === key);
        });
    }

    const label = getSelectedLabel();
    if (label) {
        const char = icons[key] ? String.fromCodePoint(icons[key]) : "";
        label.innerHTML = `<span style="color:var(--text-muted);font-size:11px;display:inline-flex;align-items:center;gap:5px"><span style="font-family:'LucideIcons',sans-serif;font-size:13px">${char}</span><span>${key}</span></span>`;
    }
}

export function openIconPicker(
    currentIcon: string | null,
    confirm: (key: string | null) => void,
) {
    selectedIconKey = currentIcon;
    onConfirmCallback = confirm;

    const modal = getModal();
    const searchInput = getSearchInput();
    const label = getSelectedLabel();

    if (searchInput) searchInput.value = "";
    if (label) {
        if (currentIcon && icons[currentIcon]) {
            const char = String.fromCodePoint(icons[currentIcon]);
            label.innerHTML = `<span style="color:var(--text-muted);font-size:11px;display:inline-flex;align-items:center;gap:5px"><span style="font-family:'LucideIcons',sans-serif;font-size:13px">${char}</span><span>${currentIcon}</span></span>`;
        } else {
            label.innerHTML = `<span style="color:var(--text-dim);font-size:11px">No icon selected</span>`;
        }
    }

    renderGrid();

    if (modal) {
        modal.style.display = "flex";
        requestAnimationFrame(() => modal.classList.add("active"));
    }

    setTimeout(() => searchInput?.focus(), 100);
}

export function closeIconPicker() {
    const modal = getModal();
    if (modal) {
        modal.classList.remove("active");
        setTimeout(() => {
            modal.style.display = "none";
        }, 300);
    }
    onConfirmCallback = null;
}

function confirmSelection() {
    if (onConfirmCallback) {
        onConfirmCallback(selectedIconKey);
    }
    closeIconPicker();
}

function cancelSelection() {
    closeIconPicker();
}

export function initIconPicker() {
    const closeBtn = document.getElementById("icon-picker-close");
    const confirmBtn = document.getElementById("icon-picker-confirm");
    const cancelBtn = document.getElementById("icon-picker-cancel");
    const modal = getModal();
    const searchInput = getSearchInput();

    closeBtn?.addEventListener("click", cancelSelection);
    confirmBtn?.addEventListener("click", confirmSelection);
    cancelBtn?.addEventListener("click", cancelSelection);

    modal?.addEventListener("click", (e) => {
        if (e.target === modal) cancelSelection();
    });

    searchInput?.addEventListener("input", () => {
        renderGrid(searchInput.value);
    });
}
