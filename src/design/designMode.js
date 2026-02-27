// src/design/designMode.js
// Design Mode runs inside the real Builder UI.
// - Enabled when window.__HBCR_DESIGN__ === true
// - Stores a draft (UILayout/UIBindings/UIZones) in localStorage

const DRAFT_KEY = "hbcr_design_draft";


function ensureDesignCss() {
  if (document.getElementById("hbcr-design-css")) return;
  const style = document.createElement("style");
  style.id = "hbcr-design-css";
  style.textContent = `
    .hbcr-ui-wrap{position:relative}
    .hbcr-ui-handle{position:absolute;top:8px;right:8px;z-index:3;background:rgba(0,0,0,.75);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:2px 6px;font-size:12px;cursor:grab;user-select:none}
    html.hbcr-show-zones [data-ui-zone]{outline:1px dashed rgba(255,255,255,.22);outline-offset:6px}
    [data-ui-zone].hbcr-drop-hot{outline:2px solid rgba(155,183,255,.8)!important}
    html.hbcr-show-zones [data-ui-zone]::before{content:attr(data-ui-zone);position:sticky;top:0;display:inline-block;margin:0 0 6px 0;padding:2px 6px;border-radius:8px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.12);font-size:12px;color:rgba(255,255,255,.8)}
  `;
  document.head.appendChild(style);
}

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

function nextOrderForZone(layoutRows, screenId, zoneId) {
  const max = layoutRows
    .filter(r => String(r.ScreenId) === String(screenId) && String(r.ZoneId || r.Slot || "") === String(zoneId))
    .reduce((m, r) => Math.max(m, Number(r.Order) || 0), 0);
  return max + 10;
}


function enableDraggableComponents(root=document) {
  try{
    root.querySelectorAll?.("[data-ui-component]")?.forEach?.((el)=>{
      if (!el.getAttribute("draggable")) el.setAttribute("draggable","true");
    });
  }catch{}
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
  store.patchUI({ __designTick: Date.now() });
}

export function installDesignMode({ appEl, store }) {
  if (!isDesignMode()) return;
  ensureDesignCss();
  ensureToolbar();
  setZonesVisible(true);

  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("dragleave", onDragLeave, true);
  document.addEventListener("drop", (e) => onDrop(e, appEl, store), true);
  enableDraggableComponents(appEl || document);

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
