// src/design/designMode.js
// Design Mode runs inside the real Builder UI.
// - Enabled when window.__HBCR_DESIGN__ === true
// - Stores a draft (UILayout/UIBindings/UIZones) in localStorage

const DRAFT_KEY = "hbcr_design_draft";

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


function safeJsonParse(raw, fallback = {}) {
  try {
    if (raw == null || raw === "") return fallback;
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function cssFromStyleObj(styleObj) {
  if (!styleObj || typeof styleObj !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(styleObj)) {
    if (v == null || v === "") continue;
    const cssKey = String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    parts.push(`${cssKey}:${v}`);
  }
  return parts.join(";");
}

function applyDesignDraftToDom(appEl) {
  if (!isDesignMode()) return;
  if (!appEl || typeof document === "undefined") return;

  const screenId = getCurrentScreenId(appEl);
  if (!screenId) return;

  const draft = getDraftTablesOrEmpty();
  const currentLayout = Array.isArray(window.__HBCR_LAST_LAYOUT__) ? window.__HBCR_LAST_LAYOUT__ : [];
  const currentZones = Array.isArray(window.__HBCR_LAST_ZONES__) ? window.__HBCR_LAST_ZONES__ : [];

  const layoutRows = (draft.UILayout && draft.UILayout.length) ? draft.UILayout : currentLayout;
  const zoneRows = (draft.UIZones && draft.UIZones.length) ? draft.UIZones : currentZones;

  const screenLayout = (layoutRows || []).filter(r => String(r.ScreenId || r.screenId || "") === String(screenId));
  const screenZonesRaw = (zoneRows || []).filter(z => String(z.ScreenId || z.screenId || "") === String(screenId));

  const screenZones = (screenZonesRaw.length ? screenZonesRaw : [{ ScreenId: screenId, ZoneId: "root", ParentZoneId: "", Order: 0, Enabled: true, PropsJson: '{"direction":"column","gap":12}', StyleJson: "{}" }])
    .map(z => ({
      ScreenId: String(z.ScreenId || z.screenId || ""),
      ZoneId: String(z.ZoneId || z.zoneId || ""),
      ParentZoneId: String(z.ParentZoneId || z.parentZoneId || ""),
      Order: Number(z.Order ?? z.order ?? 0),
      Enabled: z.Enabled ?? z.enabled ?? true,
      props: safeJsonParse(z.PropsJson ?? z.propsJson ?? "{}", {}),
      style: safeJsonParse(z.StyleJson ?? z.styleJson ?? "{}", {}),
    }))
    .filter(z => z.ZoneId);

  const ensureZoneEl = (zoneId, parentZoneId, z) => {
    let el = document.querySelector(`[data-ui-zone="${CSS.escape(zoneId)}"]`);
    const dir = String(z?.props?.direction || "column").toLowerCase();
    const gap = Number(z?.props?.gap ?? 12);
    const flexParts = [
      "display:flex",
      `flex-direction:${dir === "row" ? "row" : "column"}`,
      `gap:${Number.isFinite(gap) ? gap : 12}px`,
      "min-width:0",
      "min-height:0",
    ];
    const extra = cssFromStyleObj(z?.style);

    if (el) {
      // Update flex style in case the draft changed
      el.setAttribute("style", [el.getAttribute("style") || "", flexParts.join(";"), extra].filter(Boolean).join(";"));
      return el;
    }

    el = document.createElement("div");
    el.className = "hbcr-zone";
    el.setAttribute("data-ui-zone", zoneId);
    el.setAttribute("style", [flexParts.join(";"), extra].filter(Boolean).join(";"));

    const parentId = parentZoneId || "";
    const parent = parentId
      ? document.querySelector(`[data-ui-zone="${CSS.escape(parentId)}"]`)
      : document.querySelector(`[data-ui-zone="root"]`) || appEl;

    (parent || appEl).appendChild(el);
    return el;
  };

  // Create parents before children
  const zoneSorted = [...screenZones].sort((a,b) => (a.ParentZoneId || "").localeCompare(b.ParentZoneId || "") || (a.Order||0)-(b.Order||0));
  for (const z of zoneSorted) {
    ensureZoneEl(z.ZoneId, z.ParentZoneId, z);
  }

  // Move components into their zones in Order
  const byZone = new Map();
  for (const r of screenLayout) {
    const zoneId = String(r.ZoneId || r.zoneId || r.Slot || r.slot || "root") || "root";
    if (!byZone.has(zoneId)) byZone.set(zoneId, []);
    byZone.get(zoneId).push(r);
  }
  for (const arr of byZone.values()) arr.sort((a,b) => (Number(a.Order)||0)-(Number(b.Order)||0));

  for (const [zoneId, rows] of byZone.entries()) {
    const zoneEl = document.querySelector(`[data-ui-zone="${CSS.escape(zoneId)}"]`);
    if (!zoneEl) continue;
    for (const r of rows) {
      const compId = String(r.ComponentId || r.componentId || "");
      if (!compId) continue;
      const compEl = document.querySelector(`[data-ui-component="${CSS.escape(compId)}"]`);
      if (!compEl) continue;
      if (compEl.parentElement !== zoneEl) zoneEl.appendChild(compEl);
    }
  }
}

function nextOrderForZone(layoutRows, screenId, zoneId) {
  const max = layoutRows
    .filter(r => String(r.ScreenId) === String(screenId) && String(r.ZoneId || r.Slot || "") === String(zoneId))
    .reduce((m, r) => Math.max(m, Number(r.Order) || 0), 0);
  return max + 10;
}

function onDragStart(e) {
  const comp = e.target?.closest?.("[data-ui-component]");
  if (!comp) return;
  const id = comp.getAttribute("data-ui-component");
  if (!id) return;
  e.dataTransfer.setData("text/hbcr-component", id);
  e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e) {
  const zone = e.target?.closest?.("[data-ui-zone]");
  if (!zone) return;
  if (!e.dataTransfer.types.includes("text/hbcr-component")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  zone.classList.add("hbcr-drop-hot");
}

function onDragLeave(e) {
  const zone = e.target?.closest?.("[data-ui-zone]");
  if (!zone) return;
  zone.classList.remove("hbcr-drop-hot");
}

function onDrop(e, appEl, store) {
  const zone = e.target?.closest?.("[data-ui-zone]");
  if (!zone) return;
  const compId = e.dataTransfer.getData("text/hbcr-component");
  if (!compId) return;
  e.preventDefault();
  zone.classList.remove("hbcr-drop-hot");

  const screenId = getCurrentScreenId(appEl);
  const zoneId = zone.getAttribute("data-ui-zone");
  const draft = getDraftTablesOrEmpty();

  const current = window.__HBCR_LAST_LAYOUT__;
  if ((!draft.UILayout || draft.UILayout.length === 0) && Array.isArray(current)) {
    draft.UILayout = current.map(r => ({ ...r }));
  }

  const row = draft.UILayout.find(r => String(r.ComponentId) === String(compId) && String(r.ScreenId) === String(screenId));
  if (!row) return;
  row.ZoneId = zoneId;
  row.Slot = zoneId; // back-compat
  row.Order = nextOrderForZone(draft.UILayout, screenId, zoneId);
  writeDesignDraft(draft);
  try { applyDesignDraftToDom(appEl); } catch {}
  store.patchUI({ __designTick: Date.now() });
}

export function installDesignMode({ appEl, store }) {
  if (!isDesignMode()) return;
  ensureToolbar();
  setZonesVisible(true);


  // Keep DOM in sync with draft layout without requiring every screen to be fully converted.
  // This is especially important for legacy screens (like radial) that are mid-migration.
  const scheduleApply = (() => {
    let raf = 0;
    return () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyDesignDraftToDom(appEl);
      });
    };
  })();

  scheduleApply();

  try {
    const mo = new MutationObserver(() => scheduleApply());
    mo.observe(appEl, { childList: true, subtree: true });
    window.addEventListener("focus", scheduleApply);
  } catch {}

  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("dragleave", onDragLeave, true);
  document.addEventListener("drop", (e) => onDrop(e, appEl, store), true);

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
      const screenId = getCurrentScreenId(appEl) || prompt("ScreenId? (e.g. picks)") || "";
      if (!screenId) return;
      const zoneId = prompt("ZoneId? (e.g. leftPanel)");
      if (!zoneId) return;
      const parentZoneId = prompt("ParentZoneId? (blank for root)") || "";
      const direction = (prompt("Direction? row/column", "column") || "column").toLowerCase();
      const draft = getDraftTablesOrEmpty();
      const currentZones = window.__HBCR_LAST_ZONES__;
      if ((!draft.UIZones || draft.UIZones.length === 0) && Array.isArray(currentZones)) {
        draft.UIZones = currentZones.map(z => ({ ...z }));
      }
      const exists = draft.UIZones.some(z => String(z.ScreenId) === String(screenId) && String(z.ZoneId) === String(zoneId));
      if (exists) { alert("Zone already exists"); return; }
      const order = draft.UIZones
        .filter(z => String(z.ScreenId) === String(screenId) && String(z.ParentZoneId || "") === String(parentZoneId))
        .reduce((m, z) => Math.max(m, Number(z.Order) || 0), 0) + 10;
      draft.UIZones.push({
        ScreenId: screenId,
        ZoneId: zoneId,
        ParentZoneId: parentZoneId || "",
        Order: order,
        Enabled: true,
        PropsJson: JSON.stringify({ direction }),
        StyleJson: "{}",
      });
      writeDesignDraft(draft);
      store.patchUI({ __designTick: Date.now() });
      return;
    }

    if (action === "dm-copy-uilayout") {
      const draft = getDraftTablesOrEmpty();
      const rows = (draft.UILayout && draft.UILayout.length) ? draft.UILayout : (window.__HBCR_LAST_LAYOUT__ || []);
      const headers = ["ScreenId","ComponentId","Type","ParentId","ZoneId","Slot","Order","Enabled","BindingId","PropsJson","StyleJson","VisibilityJson"];
      const text = toTsv(rows, headers);
      copyText(text);
      alert("Copied UILayout TSV. Paste into the UILayout sheet tab (starting at A1).\n\nThen run: HBCR → Publish Builder Data");
      return;
    }

    if (action === "dm-copy-uizones") {
      const draft = getDraftTablesOrEmpty();
      const rows = (draft.UIZones && draft.UIZones.length) ? draft.UIZones : (window.__HBCR_LAST_ZONES__ || []);
      const headers = ["ScreenId","ZoneId","ParentZoneId","Order","Enabled","PropsJson","StyleJson"];
      const text = toTsv(rows, headers);
      copyText(text);
      alert("Copied UIZones TSV. Create/replace a UIZones sheet tab and paste at A1.\n\nThen run: HBCR → Publish Builder Data");
      return;
    }
  }, true);
}
