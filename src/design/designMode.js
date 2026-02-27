// src/design/designMode.js
// Design Mode runs inside the real Builder UI.
// - Enabled when window.__HBCR_DESIGN__ === true
// - Stores a draft (UILayout/UIBindings/UIZones) in localStorage

const DRAFT_KEY = "hbcr_design_draft";

// Absolute layout v1 (permanent):
// We store pixel positions for each ComponentId on a ScreenId.
// Draft.UILayout rows may include: X, Y, W, H, Z.
// The live screens apply these via inline styles on [data-ui-component].

const ABS_HEADERS = [
  "ScreenId",
  "ComponentId",
  "Type",
  "ParentId",
  "X",
  "Y",
  "W",
  "H",
  "Z",
  "Enabled",
  "BindingId",
  "PropsJson",
  "StyleJson",
  "VisibilityJson",
];

export function isDesignMode() {
  return typeof window !== "undefined" && window.__HBCR_DESIGN__ === true;
}

export function readDesignDraft() {
  if (!isDesignMode()) return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

export function writeDesignDraft(next) {
  if (!isDesignMode()) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(next || {}));
}

function toTsv(rows, headers) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    // TSV: allow tabs/newlines by replacing with spaces
    return s.replace(/\t/g, " ").replace(/\r?\n/g, " ");
  };
  return [
    headers.join("\t"),
    ...rows.map((r) => headers.map((h) => esc(r?.[h])).join("\t")),
  ].join("\n");
}

function copyText(text) {
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }
}

function ensureToolbar() {
  let el = document.querySelector(".hbcr-design-toolbar");
  if (el) return el;

  el = document.createElement("div");
  el.className = "hbcr-design-toolbar";
  el.style.top = "12px";
  el.style.right = "12px";
  el.style.background = "rgba(8,8,8,.92)";
  el.style.border = "1px solid rgba(255,255,255,.15)";
  el.style.borderRadius = "12px";
  el.style.padding = "10px";
  el.style.display = "flex";
  el.style.gap = "8px";
  el.style.alignItems = "center";

  const pill = (txt) => {
    const s = document.createElement("span");
    s.textContent = txt;
    s.style.fontSize = "12px";
    s.style.opacity = "0.85";
    s.style.padding = "4px 8px";
    s.style.borderRadius = "999px";
    s.style.border = "1px solid rgba(255,255,255,.12)";
    return s;
  };

  const mkBtn = (label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = "btn";
    b.style.padding = "8px 10px";
    b.style.fontSize = "12px";
    return b;
  };

  const tag = pill("Design Mode");
  el.appendChild(tag);

  const btnToggleZones = mkBtn("Zones");
  btnToggleZones.dataset.action = "dm-toggle-zones";
  el.appendChild(btnToggleZones);

  const btnAddZone = mkBtn("+ Zone");
  btnAddZone.dataset.action = "dm-add-zone";
  el.appendChild(btnAddZone);

  const btnCopyLayout = mkBtn("Copy UILayout TSV");
  btnCopyLayout.dataset.action = "dm-copy-uilayout";
  el.appendChild(btnCopyLayout);

  const btnCopyZones = mkBtn("Copy UIZones TSV");
  btnCopyZones.dataset.action = "dm-copy-uizones";
  el.appendChild(btnCopyZones);

  const btnClear = mkBtn("Clear Draft");
  btnClear.dataset.action = "dm-clear";
  el.appendChild(btnClear);

  const back = document.createElement("a");
  back.href = "/editor/";
  back.textContent = "Editor";
  back.style.color = "#9bb7ff";
  back.style.fontSize = "12px";
  back.style.textDecoration = "none";
  back.style.marginLeft = "6px";
  el.appendChild(back);

  document.body.appendChild(el);
  return el;
}

function getDraftTablesOrEmpty() {
  const d = readDesignDraft() || {};
  d.UILayout = Array.isArray(d.UILayout) ? d.UILayout : [];
  d.UIBindings = Array.isArray(d.UIBindings) ? d.UIBindings : [];
  d.UIZones = Array.isArray(d.UIZones) ? d.UIZones : [];
  return d;
}

function getCurrentScreenId(appEl) {
  return appEl?.getAttribute?.("data-screen") || "";
}

function isZonesVisible() {
  return document.documentElement.classList.contains("hbcr-show-zones");
}

function setZonesVisible(on) {
  document.documentElement.classList.toggle("hbcr-show-zones", !!on);
}

function ensureDesignCss() {
  if (document.getElementById("hbcr-design-css")) return;
  const style = document.createElement("style");
  style.id = "hbcr-design-css";
  style.textContent = `
    /* Absolute design canvas helpers */
    html.hbcr-show-zones [data-ui-component]{outline:1px dashed rgba(155,183,255,.45);outline-offset:3px}
    html.hbcr-show-zones [data-ui-component]::after{content:attr(data-ui-component);position:absolute;left:8px;top:8px;z-index:99999;display:inline-block;padding:2px 6px;border-radius:8px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.12);font-size:12px;color:rgba(255,255,255,.85);pointer-events:none}
    .hbcr-ui-handle{position:absolute;right:8px;top:8px;z-index:99998;background:rgba(0,0,0,.72);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:2px 6px;font-size:12px;cursor:grab;user-select:none}
    .hbcr-ui-handle:active{cursor:grabbing}
  `;
  document.head.appendChild(style);
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function px(n) {
  const v = Math.round(num(n, 0));
  return `${v}px`;
}

function findOrCreateRow(draft, screenId, compId) {
  const row = (draft.UILayout || []).find(r => String(r.ScreenId) === String(screenId) && String(r.ComponentId) === String(compId));
  if (row) return row;
  const base = { ScreenId: screenId, ComponentId: compId, Type: "block", ParentId: "", X: 40, Y: 40, W: 480, H: 320, Z: 10, Enabled: true, BindingId: "", PropsJson: "{}", StyleJson: "{}", VisibilityJson: "" };
  draft.UILayout.push(base);
  return base;
}

function applyRowToEl(el, row) {
  if (!el || !row) return;
  el.style.position = "absolute";
  el.style.left = px(row.X);
  el.style.top = px(row.Y);
  if (row.W != null && row.W !== "") el.style.width = px(row.W);
  if (row.H != null && row.H !== "") el.style.height = px(row.H);
  el.style.zIndex = String(num(row.Z, 10));
}

function syncAllPositions(appEl, store) {
  const screenId = getCurrentScreenId(appEl);
  if (!screenId) return;
  const draft = getDraftTablesOrEmpty();
  const current = window.__HBCR_LAST_LAYOUT__ || window.HBCR_LAST_LAYOUT;
  if ((!draft.UILayout || draft.UILayout.length === 0) && Array.isArray(current) && current.length && ("X" in current[0])) {
    draft.UILayout = current.map(r => ({ ...r }));
  }
  const comps = Array.from(document.querySelectorAll("[data-ui-component]"));
  let changed = false;
  for (const el of comps) {
    const compId = el.getAttribute("data-ui-component");
    if (!compId) continue;
    const row = findOrCreateRow(draft, screenId, compId);

    // MIGRATE/SEED: if this row has no absolute coords (e.g., old ZoneId/Order schema),
    // seed from current DOM position so the screen doesn't collapse into (0,0).
    if (row.X == null || row.X === "" || row.Y == null || row.Y === "") {
      const canvas =
        document.querySelector("#hbcr-canvas") ||
        document.querySelector("[data-ui-canvas]") ||
        document.querySelector(".hbcr-canvas") ||
        appEl ||
        document.body;
      const c = canvas.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      row.X = Math.round(r.left - c.left);
      row.Y = Math.round(r.top - c.top);
      row.W = Math.max(10, Math.round(r.width));
      row.H = Math.max(10, Math.round(r.height));
      row.Z = num(row.Z, 10);
      changed = true;
    }

    // Only apply if it differs from what's already on the element.
    const wantLeft = px(row.X);
    const wantTop = px(row.Y);
    const wantW = (row.W != null && row.W !== "") ? px(row.W) : "";
    const wantH = (row.H != null && row.H !== "") ? px(row.H) : "";
    const wantZ = String(num(row.Z, 10));
    if (
      el.style.position !== "absolute" ||
      el.style.left !== wantLeft ||
      el.style.top !== wantTop ||
      (wantW && el.style.width !== wantW) ||
      (wantH && el.style.height !== wantH) ||
      el.style.zIndex !== wantZ
    ) {
      applyRowToEl(el, row);
      changed = true;
    }
    // ensure handle exists
    if (!el.querySelector(":scope > .hbcr-ui-handle")) {
      const h = document.createElement("div");
      h.className = "hbcr-ui-handle";
      h.textContent = "⋮⋮";
      h.setAttribute("data-ui-handle", "true");
      h.setAttribute("title", "Drag");
      el.appendChild(h);
      changed = true;
    }
  }

  // Avoid thrashing: only persist if something actually changed.
  if (changed) {
    writeDesignDraft(draft);
    // debug-friendly alias
    window.__HBCR_LAST_LAYOUT__ = draft.UILayout;
    window.HBCR_LAST_LAYOUT = draft.UILayout;
  }
}

function installPointerDrag({ appEl, store }) {
  let active = null;

  const onDown = (e) => {
    const handle = e.target?.closest?.(".hbcr-ui-handle,[data-ui-handle]");
    if (!handle) return;
    const compEl = handle.closest?.("[data-ui-component]");
    if (!compEl) return;
    e.preventDefault();

    const screenId = getCurrentScreenId(appEl);
    if (!screenId) return;
    const compId = compEl.getAttribute("data-ui-component");
    if (!compId) return;

    const draft = getDraftTablesOrEmpty();
    const current = window.__HBCR_LAST_LAYOUT__ || window.HBCR_LAST_LAYOUT;
    if ((!draft.UILayout || draft.UILayout.length === 0) && Array.isArray(current) && current.length && ("X" in current[0])) {
    draft.UILayout = current.map(r => ({ ...r }));
    }
    const row = findOrCreateRow(draft, screenId, compId);

    // MIGRATE/SEED: if this row has no absolute coords (e.g., old ZoneId/Order schema),
    // seed from current DOM position so the screen doesn't collapse into (0,0).
    if (row.X == null || row.X === "" || row.Y == null || row.Y === "") {
      const canvas =
        document.querySelector("#hbcr-canvas") ||
        document.querySelector("[data-ui-canvas]") ||
        document.querySelector(".hbcr-canvas") ||
        appEl ||
        document.body;
      const c = canvas.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      row.X = Math.round(r.left - c.left);
      row.Y = Math.round(r.top - c.top);
      row.W = Math.max(10, Math.round(r.width));
      row.H = Math.max(10, Math.round(r.height));
      row.Z = num(row.Z, 10);
      changed = true;
    }

    row.Z = num(row.Z, 10) + 1;
    applyRowToEl(compEl, row);

    active = {
      compEl,
      screenId,
      compId,
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: num(row.X, 0),
      baseTop: num(row.Y, 0),
    };

    const move = (ev) => {
      if (!active) return;
      ev.preventDefault();
      const dx = ev.clientX - active.startX;
      const dy = ev.clientY - active.startY;
      active.compEl.style.left = px(active.baseLeft + dx);
      active.compEl.style.top = px(active.baseTop + dy);
    };

    const up = (ev) => {
      if (!active) return;
      ev.preventDefault();
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);

      const draft2 = getDraftTablesOrEmpty();
      const row2 = findOrCreateRow(draft2, active.screenId, active.compId);
      row2.X = num(parseFloat(active.compEl.style.left || "0"), active.baseLeft);
      row2.Y = num(parseFloat(active.compEl.style.top || "0"), active.baseTop);
      writeDesignDraft(draft2);
      store?.patchUI?.({ __designTick: Date.now() });
      active = null;
    };

    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  };

  document.addEventListener("mousedown", onDown, true);
}

export function installDesignMode({ appEl, store }) {
  if (!isDesignMode()) return;
  ensureToolbar();
  setZonesVisible(true);

  ensureDesignCss();
  syncAllPositions(appEl, store);
  installPointerDrag({ appEl, store });

  // The app re-renders frequently; a naive MutationObserver causes a tight
  // loop (observer -> sync -> DOM writes -> observer...). Throttle to one
  // sync per animation frame and never call patchUI from sync.
  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncAllPositions(appEl, store);
    });
  });
  // Observe only the builder root to reduce noise.
  mo.observe(appEl || document.body, { childList: true, subtree: true });

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
        localStorage.removeItem(DRAFT_KEY);
        store.patchUI({ __designTick: Date.now() });
      }
      return;
    }

    if (action === "dm-add-zone") {
      alert("Zones are disabled in Absolute Layout mode. Drag components freely on the canvas instead.");
      return;
    }

    if (action === "dm-copy-uilayout") {
      const draft = getDraftTablesOrEmpty();
      const rows = (draft.UILayout && draft.UILayout.length) ? draft.UILayout : (window.__HBCR_LAST_LAYOUT__ || []);
      const text = toTsv(rows, ABS_HEADERS);
      copyText(text);
      alert("Copied UILayout TSV. Paste into the UILayout sheet tab (starting at A1).\n\nThen run: HBCR → Publish Builder Data");
      return;
    }

    if (action === "dm-copy-uizones") {
      alert("UIZones is not used in Absolute Layout mode.");
      return;
    }
  }, true);
}
