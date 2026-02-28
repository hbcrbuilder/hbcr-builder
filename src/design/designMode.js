// src/design/designMode.js
// Design Mode support.
// We support two kinds:
// 1) legacy "zones" editor (freeform drag/resize)  [existing UI]
// 2) "slots" editor (LOCKED shell + guided +Add)   [new default for /editor/builder]
//
// Strict CSP note: do NOT rely on inline <script> flags.
// We use an external script (editor/builder/designFlags.js) to set:
//   window.__HBCR_DESIGN__ = true
//   window.__HBCR_DESIGN_KIND__ = "slots" | "zones"

const DRAFT_KEY = "hbcr_design_draft";

export function isDesignMode() {
  return typeof window !== "undefined" && window.__HBCR_DESIGN__ === true;
}

export function designKind() {
  return (typeof window !== "undefined" && window.__HBCR_DESIGN_KIND__) ? String(window.__HBCR_DESIGN_KIND__) : "";
}

export function isSlotEditor() {
  return isDesignMode() && designKind() === "slots";
}

export function isZonesEditor() {
  // default to zones when design mode is on but kind isn't specified
  return isDesignMode() && (designKind() === "zones" || !designKind());
}

export function readDesignDraft() {
  if (!isDesignMode()) return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeDesignDraft(next) {
  if (!isDesignMode()) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next || {}));
  } catch {}
}

export function clearDesignDraft() {
  if (!isDesignMode()) return;
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

// -------------------------------
// Legacy zones editor helpers
// -------------------------------
function isZonesVisible() {
  return document.documentElement.classList.contains("hbcr-show-zones");
}
function setZonesVisible(on) {
  document.documentElement.classList.toggle("hbcr-show-zones", !!on);
}

// Keep the legacy editor tooling available when explicitly requested.
function ensureToolbarLegacy() {
  let el = document.querySelector(".hbcr-design-toolbar");
  if (el) return el;

  el = document.createElement("div");
  el.className = "hbcr-design-toolbar";
  el.style.position = "fixed";
  el.style.top = "12px";
  el.style.right = "12px";
  el.style.zIndex = "999999";
  el.style.background = "rgba(8,8,8,.92)";
  el.style.border = "1px solid rgba(255,255,255,.15)";
  el.style.borderRadius = "12px";
  el.style.padding = "10px";
  el.style.display = "flex";
  el.style.gap = "8px";
  el.style.alignItems = "center";

  const btn = (label, action) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("data-action", action);
    b.style.fontSize = "12px";
    b.style.borderRadius = "10px";
    b.style.padding = "6px 10px";
    b.style.border = "1px solid rgba(255,255,255,.12)";
    b.style.background = "rgba(255,255,255,.04)";
    b.style.color = "rgba(255,255,255,.9)";
    b.style.cursor = "pointer";
    return b;
  };

  el.appendChild(btn("Design Mode", "dm-toggle-zones"));
  el.appendChild(btn("CLEAR DRAFT", "dm-clear"));
  document.body.appendChild(el);
  return el;
}

function ensureDesignCssLegacy() {
  if (document.getElementById("hbcr-design-css")) return;
  const st = document.createElement("style");
  st.id = "hbcr-design-css";
  st.textContent = `
    .hbcr-show-zones [data-ui-component]{
      outline:1px dashed rgba(120,180,255,.55);
      outline-offset:2px;
    }
  `;
  document.head.appendChild(st);
}

// NOTE: The drag/resize implementation lives in src/screens/layout.js today.
// In legacy zones editor we keep the old behavior by toggling the CSS class.
// Slot editor MUST NOT toggle these classes or it will block clicks.

export function installDesignMode({ appEl, store }) {
  if (!isDesignMode()) return;

  // SLOT EDITOR = locked shell. Do not install any overlays, toolbars,
  // drag handlers, or zone outlines. Also ensure zones class is OFF.
  if (isSlotEditor()) {
    setZonesVisible(false);
    return;
  }

  // LEGACY ZONES EDITOR
  if (!isZonesEditor()) return;

  ensureToolbarLegacy();
  ensureDesignCssLegacy();
  setZonesVisible(true);

  // Only intercept clicks for our legacy toolbar actions.
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (!action?.startsWith("dm-")) return;

    e.preventDefault();

    if (action === "dm-toggle-zones") {
      setZonesVisible(!isZonesVisible());
      return;
    }

    if (action === "dm-clear") {
      if (confirm("Clear local draft layout?")) {
        clearDesignDraft();
        store?.patchUI?.({ __designTick: Date.now() });
      }
      return;
    }
  }, { capture: true });
}
