import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { availableMonitors, primaryMonitor } from "@tauri-apps/api/window";
import { appWindow } from "./app-window";

const GEOMETRY_STORAGE_KEY = "flu-window-geometry";
const MIN_WIDTH = 480;
const MIN_HEIGHT = 570;
const MAX_SIZE = 8000;
const SAVE_DEBOUNCE_MS = 400;

type StoredGeometry = {
    x: number;
    y: number;
    width: number;
    height: number;
};

let saveTimeoutId: number | null = null;

function readStoredGeometry(): StoredGeometry | null {
    try {
        const raw = localStorage.getItem(GEOMETRY_STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<StoredGeometry>;
        const values = [parsed.x, parsed.y, parsed.width, parsed.height];
        if (!values.every((value): value is number => typeof value === "number" && Number.isFinite(value))) {
            return null;
        }

        return {
            x: parsed.x as number,
            y: parsed.y as number,
            width: Math.min(MAX_SIZE, Math.max(MIN_WIDTH, parsed.width as number)),
            height: Math.min(MAX_SIZE, Math.max(MIN_HEIGHT, parsed.height as number)),
        };
    } catch {
        return null;
    }
}

function isVisibleOnAnyMonitor(
    geometry: StoredGeometry,
    monitors: Awaited<ReturnType<typeof availableMonitors>>,
    physicalWidth: number,
    physicalHeight: number,
): boolean {
    return monitors.some((monitor) => {
        const left = monitor.position.x;
        const top = monitor.position.y;
        const right = left + monitor.size.width;
        const bottom = top + monitor.size.height;

        return (
            geometry.x < right &&
            geometry.x + physicalWidth > left &&
            geometry.y < bottom &&
            geometry.y + physicalHeight > top
        );
    });
}

async function restoreGeometry(): Promise<void> {
    const stored = readStoredGeometry();
    if (!stored) return;

    const scaleFactor = await appWindow.scaleFactor();
    const physicalWidth = Math.round(stored.width * scaleFactor);
    const physicalHeight = Math.round(stored.height * scaleFactor);

    let x = Math.round(stored.x);
    let y = Math.round(stored.y);

    try {
        const monitors = await availableMonitors();
        if (monitors.length > 0 && !isVisibleOnAnyMonitor(stored, monitors, physicalWidth, physicalHeight)) {
            const primary = await primaryMonitor();
            const monitor = primary ?? monitors[0];
            x = monitor.position.x + Math.max(0, Math.round((monitor.size.width - physicalWidth) / 2));
            y = monitor.position.y + Math.max(0, Math.round((monitor.size.height - physicalHeight) / 2));
        }
    } catch {
        return;
    }

    await appWindow.setSize(new LogicalSize(stored.width, stored.height));
    await appWindow.setPosition(new PhysicalPosition(x, y));
}

async function saveGeometry(): Promise<void> {
    try {
        if (
            await appWindow.isMinimized() ||
            await appWindow.isMaximized() ||
            await appWindow.isFullscreen()
        ) {
            return;
        }

        const position = await appWindow.outerPosition();
        const size = await appWindow.innerSize();
        const scaleFactor = await appWindow.scaleFactor();
        const logicalSize = size.toLogical(scaleFactor);

        if (logicalSize.width < MIN_WIDTH || logicalSize.height < MIN_HEIGHT) {
            return;
        }

        const geometry: StoredGeometry = {
            x: position.x,
            y: position.y,
            width: logicalSize.width,
            height: logicalSize.height,
        };
        localStorage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify(geometry));
    } catch {
        return;
    }
}

function scheduleSave(): void {
    if (saveTimeoutId !== null) {
        window.clearTimeout(saveTimeoutId);
    }

    saveTimeoutId = window.setTimeout(() => {
        saveTimeoutId = null;
        void saveGeometry();
    }, SAVE_DEBOUNCE_MS);
}

export async function initWindowGeometry(): Promise<void> {
    try {
        await restoreGeometry();
    } catch (error) {
        console.warn("Failed to restore window geometry", error);
    }

    void appWindow.onMoved(scheduleSave);
    void appWindow.onResized(scheduleSave);
}
