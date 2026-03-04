// HBCR Content Manager (Non-technical maintainer UX)
// Goals:
// - Never require the maintainer to write IDs or TSV manually
// - Parent selection is always a dropdown (Subrace -> Race, Subclass -> Class)
// - Track changes locally and export TSV blocks for Google Sheets
// - Optional live preview in the Builder behind the editor (via liveData cmsPreview overlay)

const HBCR_WORKER_BASE = (typeof window !== "undefined" && window.__HBCR_WORKER_BASE__)
  ? String(window.__HBCR_WORKER_BASE__).replace(/\/$/, "")
  : "https://hbcr-api.hbcrbuilder.workers.dev";

function hbcrApi(path) {
  const p = String(path || "");
  if (p.startsWith("http")) return p;
  if (!p.startsWith("/")) return HBCR_WORKER_BASE + "/" + p;
  return HBCR_WORKER_BASE + p;
}

// ==============================
// Types
// ==============================
const TYPE_META = {
  Races:      { idKey: "RaceId",      nameKey: "RaceName",      descKey: "Description", parentKey: null,        parentType: null },
  Subraces:   { idKey: "SubraceId",   nameKey: "SubraceName",   descKey: "Description", parentKey: "RaceId",   parentType: "Races" },
  Classes:    { idKey: "ClassId",     nameKey: "ClassName",     descKey: "Description", parentKey: null,        parentType: null },
  Subclasses: { idKey: "SubclassId",  nameKey: "SubclassName",  descKey: "Description", parentKey: "ClassId",  parentType: "Classes" },
};

const ORDERED_TYPES = ["Races", "Subraces", "Classes", "Subclasses"];

// ==============================
// Storage
// ==============================
const CHANGES_KEY = "hbcr_cms_changes_v1";
const CMS_DRAFT_KEY = "hbcr_cms_draft_v3";            // read by src/data/liveData.js
const CMS_APPLY_KEY = "hbcr_cms_apply_preview";        // read by src/data/liveData.js

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch {}
}

function loadChanges() {
  return loadJson(CHANGES_KEY, { upserts: {}, deletes: {} });
}

function saveChanges(ch) {
  saveJson(CHANGES_KEY, ch || { upserts: {}, deletes: {} });
}

function loadDraft() {
  return loadJson(CMS_DRAFT_KEY, {});
}

function saveDraft(d) {
  saveJson(CMS_DRAFT_KEY, d || {});
}

function setPreviewEnabled(enabled) {
  try { localStorage.setItem(CMS_APPLY_KEY, enabled ? "1" : "0"); } catch {}
}

function isPreviewEnabled() {
  try { return String(localStorage.getItem(CMS_APPLY_KEY) || "0") === "1"; } catch { return false; }
}

// Mirror changes into the draft overlay so the embedded Builder can preview.
function syncChangesToDraft(bundle) {
  const ch = loadChanges();
  const draft = {};

  const upserts = ch.upserts || {};
  for (const type of Object.keys(upserts)) {
    const m = TYPE_META[type];
    if (!m) continue;
    const byId = upserts[type] || {};
    for (const id of Object.keys(byId)) {
      const row = byId[id];
      if (!row || typeof row !== "object") continue;
      // Ensure canonical idKey is present.
      const withId = { ...row, [m.idKey]: id };
      draft[`${type}::${id}`] = withId;
    }
  }

  // NOTE: deletes are not applied to preview overlay (bundle-only deletion would
  // require a more invasive builder-side filter). For maintainers, previewing
  // deletions is less important than safe additions/edits.

  saveDraft(draft);
}

// ==============================
// Helpers
// ==============================
function safeStr(x) { return (x == null) ? "" : String(x); }
function norm(s) { return safeStr(s).trim(); }

function slugify(s) {
  return norm(s)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function tsvEscape(s) {
  const v = safeStr(s);
  // TSV doesn't need quoting unless you want; we just replace tabs/newlines.
  return v.replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function copyToClipboard(text) {
  return navigator.clipboard.writeText(text);
}

function el(id) { return document.getElementById(id); }

// ==============================
// State
// ==============================
let bundle = {};
let currentType = "Races";
let selectedId = null;

// ==============================
// Bundle access
// ==============================
async function loadBundle() {
  setStatus("Loading bundle…");
  const res = await fetch(hbcrApi("/api/bundle"), { cache: "no-store" });
  if (!res.ok) throw new Error("bundle fetch failed: " + res.status);
  bundle = await res.json();
  setStatus("Bundle loaded.");
}

function sheetRows(type) {
  const arr = bundle?.[type];
  return Array.isArray(arr) ? arr : [];
}

function getColumns(type) {
  const rows = sheetRows(type);
  if (rows.length) return Object.keys(rows[0]);
  const m = TYPE_META[type];
  if (!m) return [];
  return [m.idKey, m.parentKey, m.nameKey, m.descKey].filter(Boolean);
}

function getRowById(type, id) {
  const m = TYPE_META[type];
  if (!m) return null;
  const idKey = m.idKey;
  const fromBundle = sheetRows(type).find(r => norm(r?.[idKey]) === norm(id));

  const ch = loadChanges();
  const up = ch.upserts?.[type]?.[id];
  if (up) return { ...fromBundle, ...up, [idKey]: id };
  return fromBundle || null;
}

function listItems(type, search) {
  const m = TYPE_META[type];
  const idKey = m.idKey;
  const nameKey = m.nameKey;
  const parentKey = m.parentKey;

  const ch = loadChanges();
  const deletes = new Set(Object.keys(ch.deletes?.[type] || {}));

  // Base from bundle
  const base = sheetRows(type)
    .map(r => ({ ...r }))
    .filter(r => !deletes.has(norm(r?.[idKey])));

  // Apply upserts (existing edits + new rows)
  const upserts = ch.upserts?.[type] || {};
  const seen = new Map();
  for (const r of base) {
    const id = norm(r?.[idKey]);
    if (!id) continue;
    const up = upserts[id];
    const merged = up ? { ...r, ...up, [idKey]: id } : r;
    seen.set(id, merged);
  }
  for (const id of Object.keys(upserts)) {
    if (deletes.has(norm(id))) continue;
    if (!seen.has(norm(id))) {
      const row = upserts[id];
      seen.set(norm(id), { ...row, [idKey]: id });
    }
  }

  let items = Array.from(seen.values());

  const q = norm(search).toLowerCase();
  if (q) {
    items = items.filter(r => {
      const id = norm(r?.[idKey]).toLowerCase();
      const nm = norm(r?.[nameKey]).toLowerCase();
      const parent = parentKey ? norm(r?.[parentKey]).toLowerCase() : "";
      return id.includes(q) || nm.includes(q) || parent.includes(q);
    });
  }

  items.sort((a, b) => {
    const an = norm(a?.[nameKey]).toLowerCase();
    const bn = norm(b?.[nameKey]).toLowerCase();
    if (an && bn) return an.localeCompare(bn);
    return norm(a?.[idKey]).localeCompare(norm(b?.[idKey]));
  });

  return items;
}

// ==============================
// UI rendering
// ==============================
function setStatus(msg) {
  el("status").textContent = msg;
}

function setType(type) {
  if (!TYPE_META[type]) return;
  currentType = type;
  selectedId = null;
  // Highlight buttons
  for (const t of ORDERED_TYPES) {
    const b = el(`btnType_${t}`);
    if (!b) continue;
    b.classList.toggle("is-active", t === currentType);
  }
  el("panelTitle").textContent = type;
  renderTable();
  renderForm(null);
}

function renderTable() {
  const m = TYPE_META[currentType];
  const list = el("tableBody");
  list.innerHTML = "";

  const rows = listItems(currentType, el("search").value);
  el("count").textContent = `${rows.length} items`;

  for (const r of rows) {
    const tr = document.createElement("tr");
    const id = norm(r?.[m.idKey]);
    tr.dataset.id = id;
    if (id && id === selectedId) tr.classList.add("is-selected");

    const tdName = document.createElement("td");
    tdName.textContent = norm(r?.[m.nameKey]) || "(unnamed)";
    const tdParent = document.createElement("td");
    tdParent.textContent = m.parentKey ? (norm(r?.[m.parentKey]) || "—") : "—";
    const tdId = document.createElement("td");
    tdId.className = "mono";
    tdId.textContent = id || "";
    const tdEdit = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn btn-small";
    btn.textContent = "Edit";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectRow(id);
    });
    tdEdit.appendChild(btn);

    tr.appendChild(tdName);
    tr.appendChild(tdParent);
    tr.appendChild(tdId);
    tr.appendChild(tdEdit);

    tr.addEventListener("click", () => selectRow(id));
    list.appendChild(tr);
  }
}

function selectRow(id) {
  selectedId = id;
  // re-render selection highlight
  for (const tr of el("tableBody").querySelectorAll("tr")) {
    tr.classList.toggle("is-selected", tr.dataset.id === id);
  }
  const row = getRowById(currentType, id);
  renderForm(row);
}

function renderParentOptions(parentType) {
  const pm = TYPE_META[parentType];
  const opts = sheetRows(parentType)
    .map(r => ({ id: norm(r?.[pm.idKey]), name: norm(r?.[pm.nameKey]) }))
    .filter(o => o.id);
  opts.sort((a,b) => a.name.localeCompare(b.name));
  return opts;
}

function renderForm(row) {
  const m = TYPE_META[currentType];
  const form = el("form");
  form.innerHTML = "";

  const isNew = !row;
  const title = isNew ? `Add ${currentType.slice(0, -1)}` : `Edit ${currentType.slice(0, -1)}`;
  el("formTitle").textContent = title;

  const help = el("formHelp");
  help.textContent = isNew
    ? "Fill the simple fields. ID is generated automatically."
    : "Edit fields and click Save. Export Changes generates TSV for Sheets.";

  const working = row ? { ...row } : {};
  let workingId = norm(working?.[m.idKey]);

  // Parent
  if (m.parentKey) {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = (m.parentType === "Races") ? "Parent Race" : "Parent Class";
    const sel = document.createElement("select");
    sel.id = "inpParent";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— Select —";
    sel.appendChild(opt0);
    for (const o of renderParentOptions(m.parentType)) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.name ? `${o.name} (${o.id})` : o.id;
      sel.appendChild(opt);
    }
    sel.value = norm(working?.[m.parentKey]);
    field.appendChild(lab);
    field.appendChild(sel);
    form.appendChild(field);
  }

  // Name
  {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = "Name";
    const inp = document.createElement("input");
    inp.id = "inpName";
    inp.placeholder = "e.g. Berserker";
    inp.value = norm(working?.[m.nameKey]);
    field.appendChild(lab);
    field.appendChild(inp);
    form.appendChild(field);
  }

  // Description
  {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = "Description (optional)";
    const ta = document.createElement("textarea");
    ta.id = "inpDesc";
    ta.placeholder = "Short description…";
    ta.value = norm(working?.[m.descKey]);
    field.appendChild(lab);
    field.appendChild(ta);
    form.appendChild(field);
  }

  // Icon (optional, if the sheet has something icon-ish)
  const cols = new Set(getColumns(currentType));
  const iconKey = cols.has("Icon") ? "Icon"
    : cols.has("icon") ? "icon"
    : cols.has("IconUrl") ? "IconUrl"
    : cols.has("iconUrl") ? "iconUrl"
    : null;
  if (iconKey) {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = "Icon (optional)";
    const inp = document.createElement("input");
    inp.id = "inpIcon";
    inp.placeholder = "icon path or url";
    inp.value = norm(working?.[iconKey]);
    field.appendChild(lab);
    field.appendChild(inp);
    form.appendChild(field);
  }

  // Advanced (ID + extra columns)
  const adv = document.createElement("details");
  adv.className = "advanced";
  const sum = document.createElement("summary");
  sum.textContent = "Advanced (IDs / extra columns)";
  adv.appendChild(sum);

  // ID
  {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = "ID";
    const inp = document.createElement("input");
    inp.id = "inpId";
    inp.placeholder = "auto-generated";
    inp.value = workingId;
    field.appendChild(lab);
    field.appendChild(inp);
    adv.appendChild(field);
  }

  // Extra columns (simple key/value editor)
  const extraKeys = getColumns(currentType)
    .filter(k => ![m.idKey, m.parentKey, m.nameKey, m.descKey, iconKey].includes(k));

  if (extraKeys.length) {
    const h = document.createElement("div");
    h.className = "hint";
    h.textContent = "Extra fields (usually leave blank):";
    adv.appendChild(h);

    for (const k of extraKeys) {
      const field = document.createElement("div");
      field.className = "field";
      const lab = document.createElement("label");
      lab.textContent = k;
      const inp = document.createElement("input");
      inp.dataset.extraKey = k;
      inp.value = safeStr(working?.[k]);
      field.appendChild(lab);
      field.appendChild(inp);
      adv.appendChild(field);
    }
  }
  form.appendChild(adv);

  // Auto-generate ID from name for NEW rows (unless user edits ID in Advanced)
  const nameEl = el("inpName");
  const idEl = el("inpId");
  if (isNew) {
    let idTouched = false;
    idEl.addEventListener("input", () => { idTouched = true; });
    nameEl.addEventListener("input", () => {
      if (idTouched) return;
      const base = slugify(nameEl.value);
      const parent = m.parentKey ? slugify(el("inpParent")?.value || "") : "";
      const suggested = (m.parentKey && parent)
        ? `${parent}_${base}`.replace(/_+/g, "_")
        : base;
      idEl.value = suggested;
    });
    // trigger once
    nameEl.dispatchEvent(new Event("input"));
  }
}

function collectFormRow() {
  const m = TYPE_META[currentType];
  const cols = getColumns(currentType);
  const colsSet = new Set(cols);
  const id = norm(el("inpId").value);
  const name = norm(el("inpName").value);

  if (!name) return { ok: false, error: "Name is required." };
  if (!id) return { ok: false, error: "ID is required (it should auto-generate)." };

  const row = {};
  row[m.idKey] = id;
  row[m.nameKey] = name;

  if (m.parentKey) {
    const parent = norm(el("inpParent").value);
    if (!parent) return { ok: false, error: "Parent selection is required." };
    row[m.parentKey] = parent;
  }

  row[m.descKey] = norm(el("inpDesc").value);

  // optional icon
  const iconEl = el("inpIcon");
  if (iconEl) {
    const iconKey = colsSet.has("Icon") ? "Icon"
      : colsSet.has("icon") ? "icon"
      : colsSet.has("IconUrl") ? "IconUrl"
      : colsSet.has("iconUrl") ? "iconUrl"
      : null;
    if (iconKey) row[iconKey] = norm(iconEl.value);
  }

  // extras
  for (const inp of el("form").querySelectorAll("input[data-extra-key]")) {
    const k = inp.dataset.extraKey;
    row[k] = safeStr(inp.value);
  }

  return { ok: true, id, row };
}

function upsertRow(type, id, row) {
  const ch = loadChanges();
  ch.upserts ||= {};
  ch.upserts[type] ||= {};
  ch.deletes ||= {};
  ch.deletes[type] ||= {};
  delete ch.deletes[type][id];
  ch.upserts[type][id] = row;
  saveChanges(ch);
  syncChangesToDraft(bundle);
}

function markDeleted(type, id) {
  const ch = loadChanges();
  ch.deletes ||= {};
  ch.deletes[type] ||= {};
  ch.upserts ||= {};
  ch.upserts[type] ||= {};
  delete ch.upserts[type][id];
  ch.deletes[type][id] = true;
  saveChanges(ch);
  syncChangesToDraft(bundle);
}

function buildTsvForType(type) {
  const m = TYPE_META[type];
  const ch = loadChanges();
  const byId = ch.upserts?.[type] || {};
  const ids = Object.keys(byId);
  if (!ids.length) return { header: "", body: "", rows: 0 };

  // Column order: canonical keys first, then bundle columns, then any extras from edits
  const baseCols = [m.idKey, m.parentKey, m.nameKey, m.descKey].filter(Boolean);
  const bundleCols = getColumns(type);
  const extra = new Set();
  for (const id of ids) {
    for (const k of Object.keys(byId[id] || {})) extra.add(k);
  }
  const cols = [...new Set([...baseCols, ...bundleCols, ...extra])].filter(Boolean);

  const lines = [];
  lines.push(cols.join("\t"));
  for (const id of ids) {
    const r = { ...byId[id], [m.idKey]: id };
    const vals = cols.map(k => tsvEscape(r?.[k]));
    lines.push(vals.join("\t"));
  }
  return { header: cols.join("\t"), body: lines.join("\n"), rows: ids.length };
}

function renderExport() {
  const out = el("exportOut");
  out.innerHTML = "";

  let total = 0;
  for (const t of ORDERED_TYPES) {
    const blk = buildTsvForType(t);
    if (!blk.rows) continue;
    total += blk.rows;

    const card = document.createElement("div");
    card.className = "export-card";

    const h = document.createElement("div");
    h.className = "export-head";
    h.textContent = `${t}: ${blk.rows} row(s)`;

    const btn = document.createElement("button");
    btn.className = "btn btn-small";
    btn.textContent = "Copy TSV";
    btn.addEventListener("click", async () => {
      await copyToClipboard(blk.body);
      toast("Copied TSV");
    });

    const pre = document.createElement("pre");
    pre.textContent = blk.body;

    const row = document.createElement("div");
    row.className = "export-actions";
    row.appendChild(btn);

    card.appendChild(h);
    card.appendChild(row);
    card.appendChild(pre);
    out.appendChild(card);
  }

  if (!total) {
    out.innerHTML = `<div class="empty">No saved changes yet. Add or edit something, then Export.</div>`;
  }
}

// ==============================
// Toast
// ==============================
let toastTimer = null;
function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-on"), 1200);
}

// ==============================
// Events
// ==============================
function wireEvents() {
  for (const t of ORDERED_TYPES) {
    el(`btnType_${t}`).addEventListener("click", () => setType(t));
  }

  el("search").addEventListener("input", () => renderTable());
  el("btnReload").addEventListener("click", async () => {
    await loadBundle();
    syncChangesToDraft(bundle);
    renderTable();
    toast("Reloaded");
  });

  el("btnAdd").addEventListener("click", () => {
    selectedId = null;
    renderTable();
    renderForm(null);
  });

  el("btnSave").addEventListener("click", () => {
    const res = collectFormRow();
    if (!res.ok) {
      alert(res.error);
      return;
    }
    const m = TYPE_META[currentType];
    const id = res.id;
    // If renaming ID of an existing row, treat as new ID (safe), but warn.
    // For maintainers: they should generally avoid changing IDs.
    const existing = sheetRows(currentType).some(r => norm(r?.[m.idKey]) === id);
    upsertRow(currentType, id, res.row);
    selectedId = id;
    renderTable();
    selectRow(id);
    toast(existing ? "Saved" : "Added");
    if (isPreviewEnabled()) refreshBuilder();
  });

  el("btnDelete").addEventListener("click", () => {
    if (!selectedId) {
      alert("Select an item first.");
      return;
    }
    if (!confirm(`Mark ${selectedId} as deleted? (This only affects export; it will not remove it from preview automatically.)`)) return;
    markDeleted(currentType, selectedId);
    selectedId = null;
    renderTable();
    renderForm(null);
    toast("Marked deleted");
  });

  el("btnExport").addEventListener("click", () => {
    el("mainView").classList.add("is-hidden");
    el("exportView").classList.remove("is-hidden");
    renderExport();
  });
  el("btnBack").addEventListener("click", () => {
    el("exportView").classList.add("is-hidden");
    el("mainView").classList.remove("is-hidden");
  });

  el("togPreview").addEventListener("change", (e) => {
    setPreviewEnabled(!!e.target.checked);
    toast(e.target.checked ? "Preview ON" : "Preview OFF");
    refreshBuilder(true);
  });

  el("btnReset").addEventListener("click", () => {
    if (!confirm("Clear all local editor data (changes + preview overlay)?")) return;
    try {
      localStorage.removeItem(CHANGES_KEY);
      localStorage.removeItem(CMS_DRAFT_KEY);
      localStorage.removeItem(CMS_APPLY_KEY);
    } catch {}
    el("togPreview").checked = false;
    toast("Reset");
    refreshBuilder(true);
    renderTable();
    renderForm(null);
  });

  el("btnRefreshBuilder").addEventListener("click", () => refreshBuilder(true));
}

function refreshBuilder(hard) {
  const frame = el("builderFrame");
  if (!frame) return;
  try {
    const url = new URL(frame.src, window.location.origin);
    // Ensure preview param stays in place; liveData looks for cmsPreview=1
    url.searchParams.set("embed", "1");
    url.searchParams.set("cmsPreview", "1");
    if (hard) url.searchParams.set("t", String(Date.now()));
    frame.src = url.toString();
  } catch {
    frame.src = "/editor/builder/?embed=1&cmsPreview=1&t=" + Date.now();
  }
}

// ==============================
// Boot
// ==============================
async function boot() {
  el("togPreview").checked = isPreviewEnabled();
  wireEvents();
  await loadBundle();
  syncChangesToDraft(bundle);
  setType(currentType);
  refreshBuilder(false);
}

boot().catch((err) => {
  console.error(err);
  setStatus("Failed to load: " + (err?.message || String(err)));
});
