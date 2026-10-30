export type ToastKind = "info" | "success" | "warning" | "error";
export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
  icon?: string;
};
export type ToastOptions = ToastAction & {
  channel?: "updates";
  title?: string;
  icon?: string;
};

function toastIcon(kind: ToastKind): string {
  if (kind === "success") return "&#58544;";
  if (kind === "warning") return "&#58485;";
  if (kind === "error") return "&#57676;";
  return "&#58437;";
}

function toastColor(kind: ToastKind): string {
  if (kind === "success") return "#57d18d";
  if (kind === "warning") return "#ffc107";
  if (kind === "error") return "#ff6666";
  return "var(--accent)";
}

function ensureToastContainer(): HTMLElement {
  const existing = document.getElementById("toast-container");
  if (existing) return existing;

  const container = document.createElement("div");
  container.id = "toast-container";
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-atomic", "false");
  document.body.appendChild(container);
  return container;
}

export function notify(
  message: string,
  kind: ToastKind = "info",
  timeoutMs = 3200,
  action?: ToastOptions
) {
  const container = ensureToastContainer();

  const item = document.createElement("div");
  item.className = "toast-item";
  item.dataset.toastKind = kind;
  item.style.setProperty("--toast-color", toastColor(kind));

  const icon = document.createElement("span");
  icon.className = "icon toast-icon";
  icon.innerHTML = action?.icon || toastIcon(kind);
  item.appendChild(icon);

  const body = document.createElement("div");
  body.className = "toast-body";

  const copy = document.createElement("div");
  copy.className = "toast-copy";

  if (action?.title) {
    const title = document.createElement("span");
    title.className = "toast-title";
    title.textContent = action.title;
    copy.appendChild(title);
  }

  const text = document.createElement("p");
  text.className = "toast-message";
  text.textContent = message;
  copy.appendChild(text);
  body.appendChild(copy);

  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      void Promise.resolve(action.onClick()).finally(() => {
        item.remove();
      });
    });
    body.appendChild(button);
  }

  item.appendChild(body);
  container.appendChild(item);
  requestAnimationFrame(() => {
    item.dataset.visible = "true";
  });

  window.setTimeout(() => {
    item.dataset.visible = "false";
    window.setTimeout(() => item.remove(), 220);
  }, timeoutMs);
}
