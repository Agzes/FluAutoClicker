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
  if (kind === "success") return "&#57894;";
  if (kind === "warning") return "&#57747;";
  if (kind === "error") return "&#57463;";
  return "&#57593;";
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
  toastQueue.push({ message, kind, timeoutMs, action });
  showNextToast();
}

type ToastEntry = {
  message: string;
  kind: ToastKind;
  timeoutMs: number;
  action?: ToastOptions;
};

const toastQueue: ToastEntry[] = [];
let toastActive = false;

function showNextToast() {
  if (toastActive) return;

  const entry = toastQueue.shift();
  if (!entry) {
    toastActive = false;
    return;
  }

  toastActive = true;
  const container = ensureToastContainer();

  const item = document.createElement("div");
  item.className = "toast-item";
  item.dataset.toastKind = entry.kind;
  item.style.setProperty("--toast-color", toastColor(entry.kind));

  const icon = document.createElement("span");
  icon.className = "icon toast-icon";
  icon.innerHTML = entry.action?.icon || toastIcon(entry.kind);
  item.appendChild(icon);

  const body = document.createElement("div");
  body.className = "toast-body";

  const copy = document.createElement("div");
  copy.className = "toast-copy";

  if (entry.action?.title) {
    const title = document.createElement("span");
    title.className = "toast-title";
    title.textContent = entry.action.title;
    copy.appendChild(title);
  }

  const text = document.createElement("p");
  text.className = "toast-message";
  text.textContent = entry.message;
  copy.appendChild(text);
  body.appendChild(copy);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    item.dataset.visible = "false";
    window.setTimeout(() => {
      item.remove();
      toastActive = false;
      showNextToast();
    }, 220);
  };

  if (entry.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = entry.action.label;
    button.addEventListener("click", () => {
      void Promise.resolve(entry.action!.onClick()).finally(finish);
    });
    body.appendChild(button);
  }

  item.appendChild(body);
  container.appendChild(item);
  requestAnimationFrame(() => {
    item.dataset.visible = "true";
  });

  const timer = window.setTimeout(finish, entry.timeoutMs);
}
