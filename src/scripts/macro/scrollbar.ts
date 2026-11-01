function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function initMacroScrollbar() {
    const list = document.getElementById("macro-list-container");
    const track = document.getElementById("macro-scrollbar");
    const thumb = document.getElementById("macro-scrollbar-thumb");
    if (!list || !track || !thumb) return;

    let dragStartY = 0;
    let dragStartScroll = 0;

    const update = () => {
        const maxScroll = list.scrollHeight - list.clientHeight;
        if (maxScroll <= 1) {
            track.classList.remove("visible");
            thumb.style.height = "0";
            track.setAttribute("aria-valuenow", "0");
            return;
        }

        track.classList.add("visible");
        const trackHeight = track.clientHeight;
        const thumbHeight = clamp(
            Math.round((list.clientHeight / list.scrollHeight) * trackHeight),
            26,
            trackHeight,
        );
        const maxTop = Math.max(0, trackHeight - thumbHeight);

        thumb.style.height = `${thumbHeight}px`;
        thumb.style.top = `${maxTop * (list.scrollTop / maxScroll)}px`;
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", String(maxScroll));
        track.setAttribute("aria-valuenow", String(Math.round(list.scrollTop)));
    };

    list.addEventListener("scroll", update, { passive: true });
    window.addEventListener("flu:settings-applied", update);

    let frame = 0;
    const scheduleUpdate = () => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            update();
        });
    };

    new ResizeObserver(scheduleUpdate).observe(list);
    new MutationObserver(scheduleUpdate).observe(list, {
        childList: true,
        subtree: true,
    });

    thumb.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        dragStartY = event.clientY;
        dragStartScroll = list.scrollTop;
        thumb.classList.add("dragging");
        thumb.setPointerCapture(event.pointerId);
    });

    thumb.addEventListener("pointermove", (event) => {
        if (!thumb.hasPointerCapture(event.pointerId)) return;

        const trackHeight = track.clientHeight;
        const thumbHeight = thumb.offsetHeight;
        const maxScroll = list.scrollHeight - list.clientHeight;
        const maxTop = trackHeight - thumbHeight;
        if (maxTop <= 0 || maxScroll <= 0) return;

        list.scrollTop = dragStartScroll + ((event.clientY - dragStartY) * maxScroll) / maxTop;
    });

    thumb.addEventListener("pointerup", (event) => {
        thumb.classList.remove("dragging");
        if (thumb.hasPointerCapture(event.pointerId)) {
            thumb.releasePointerCapture(event.pointerId);
        }
    });

    thumb.addEventListener("pointercancel", () => {
        thumb.classList.remove("dragging");
    });

    track.addEventListener("pointerdown", (event) => {
        if (event.target === thumb) return;

        const rect = track.getBoundingClientRect();
        const thumbHeight = thumb.offsetHeight;
        const trackHeight = track.clientHeight;
        const maxScroll = list.scrollHeight - list.clientHeight;
        const maxTop = trackHeight - thumbHeight;
        if (maxTop <= 0 || maxScroll <= 0) return;

        list.scrollTop =
            (clamp(event.clientY - rect.top - thumbHeight / 2, 0, maxTop) / maxTop) *
            maxScroll;
    });

    update();
}
