const PREVIEW_PATTERNS = ["rnd", "lin", "cir", "ozn", "lis"] as const;
type PreviewPattern = (typeof PREVIEW_PATTERNS)[number];

function activePattern(): PreviewPattern {
    const value = document
        .querySelector("#jiggler-pattern-row .multi-btn.active")
        ?.getAttribute("data-pattern");
    return (PREVIEW_PATTERNS as readonly string[]).includes(value || "")
        ? (value as PreviewPattern)
        : "rnd";
}

function previewDistance(): number {
    const input = document.getElementById("jiggler-distance-slider") as HTMLInputElement | null;
    const value = Number(input?.value || 20);
    return Number.isFinite(value) ? Math.min(500, Math.max(5, value)) : 20;
}

function makeRandom(seed: number) {
    let value = seed;
    return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 4294967296;
    };
}

export function initJigglerPreview() {
    const canvas = document.getElementById("jiggler-preview-canvas") as HTMLCanvasElement | null;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let width = 0;
    let height = 0;

    const draw = () => {
        if (!width || !height) return;

        const styles = getComputedStyle(document.documentElement);
        const accent = styles.getPropertyValue("--accent").trim() || "#77B6DD";
        const dim = styles.getPropertyValue("--text-dim").trim() || "rgba(120,120,120,1)";
        const pattern = activePattern();
        const distance = previewDistance();
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * (0.18 + 0.26 * (distance / 500));

        context.clearRect(0, 0, width, height);
        context.lineWidth = 1.4;
        context.lineCap = "round";
        context.lineJoin = "round";

        context.strokeStyle = dim;
        context.globalAlpha = 0.16;
        context.beginPath();
        context.moveTo(8, cy);
        context.lineTo(width - 8, cy);
        context.moveTo(cx, 8);
        context.lineTo(cx, height - 8);
        context.stroke();
        context.globalAlpha = 1;

        context.strokeStyle = accent;
        context.fillStyle = accent;

        if (pattern === "lin") {
            context.beginPath();
            context.moveTo(cx - radius, cy);
            context.lineTo(cx + radius, cy);
            context.stroke();

            context.globalAlpha = 0.45;
            context.beginPath();
            for (let step = 0; step <= 4; step += 1) {
                const x = cx - radius + (radius * 2 * step) / 4;
                context.moveTo(x, cy - 4);
                context.lineTo(x, cy + 4);
            }
            context.stroke();
            context.globalAlpha = 1;

            context.beginPath();
            context.arc(cx - radius, cy, 2, 0, Math.PI * 2);
            context.fill();
        } else if (pattern === "cir") {
            context.beginPath();
            context.arc(cx, cy, radius, 0, Math.PI * 2);
            context.stroke();
        } else if (pattern === "ozn") {
            context.globalAlpha = 0.5;
            context.beginPath();
            context.arc(cx, cy, radius, 0, Math.PI * 2);
            context.stroke();
            context.globalAlpha = 0.9;
            const random = makeRandom(17);
            for (let index = 0; index < 14; index += 1) {
                const angle = random() * Math.PI * 2;
                const length = Math.sqrt(random()) * radius;
                context.beginPath();
                context.arc(
                    cx + Math.cos(angle) * length,
                    cy + Math.sin(angle) * length,
                    1.4,
                    0,
                    Math.PI * 2,
                );
                context.fill();
            }
        } else if (pattern === "lis") {
            context.beginPath();
            for (let step = 0; step <= 96; step += 1) {
                const angle = (step / 96) * Math.PI * 2;
                const x = cx + Math.sin(angle) * radius;
                const y = cy + Math.sin(angle * 2) * radius;
                if (step === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.stroke();
        } else {
            const random = makeRandom(29);
            context.beginPath();
            context.moveTo(cx, cy);
            for (let step = 0; step < 10; step += 1) {
                const x = cx + (random() * 2 - 1) * radius;
                const y = cy + (random() * 2 - 1) * radius;
                context.lineTo(x, y);
            }
            context.stroke();
        }

        context.fillStyle = accent;
        context.beginPath();
        context.arc(cx, cy, 2, 0, Math.PI * 2);
        context.fill();
    };

    const resize = () => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const ratio = window.devicePixelRatio || 1;
        width = rect.width;
        height = rect.height;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        draw();
    };

    document.querySelectorAll("#jiggler-pattern-row .multi-btn").forEach((button) => {
        button.addEventListener("click", () => window.requestAnimationFrame(draw));
    });
    document
        .getElementById("jiggler-distance-slider")
        ?.addEventListener("input", () => draw());
    window.addEventListener("flu:jiggler-preview", draw);
    window.addEventListener("flu:settings-applied", draw);

    new ResizeObserver(resize).observe(canvas);
    resize();
}
