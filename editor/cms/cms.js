import { getBundle } from "../../src/data/liveData.js";

// ===============================
// Helpers
// ===============================
const LS_DRAFT_KEY = "hbcr_cms_draft_v1";

const $ = (sel) => document.querySelector(sel);

function nowStamp() {
  const d = new Date();
  return d.toLocaleString();
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function toast(msg, kind = "ok") {
  const b = $("#cmsBanner");
  b.className = "cms-banner " + (kind === "error" ? "error" : "ok");
  b.style.display = "block";
  b.textContent = msg;
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => { b.style.display = "none"; }, 2200);
}

function normalizeKey(v) {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function detectId(row, sheet) {
  if (!row || typeof row !== "object") return "";
  // Prefer common normalized fields if present
  const direct = row.id ?? row.Id ?? row.ID;
  if (direct) return String(direct);

  // Sheet-aware fallbacks
  const guesses = [
    // Core
    "RaceId", "SubraceId", "ClassId", "SubclassId",
    "SpellId", "CantripId",
    "ItemId", "WeaponId", "EquipmentId",
    "PickTypeId", "ChoiceId",
    // Generic
    "FeatureId", "TraitId", "FeatId",
  ];

  for (const k of guesses) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  // Last resort: first key that ends with Id
  const idLike = Object.keys(row).find(k => /id$/i.test(k) && String(row[k] ?? "").trim());
  if (idLike) return String(row[idLike]).trim();
  return "";
}

function detectName(row) {
  if (!row || typeof row !== "object") return "";
  const direct = row.name ?? row.Name ?? row.Label;
  if (direct) return String(direct);
  const guesses = [
    "RaceName", "SubraceName", "ClassName", "SubclassName",
    "SpellName", "CantripName",
    "ItemName", "WeaponName", "EquipmentName",
    "PickTypeName",
    "FeatureName", "TraitName", "FeatName",
  ];
  for (const k of guesses) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  return "";
}

function sheetLabel(sheet) {
  return {
    Races: "Races",
    Subraces: "Subraces",
    Classes: "Classes",
    Subclasses: "Subclasses",
    Spells: "Spells",
    Cantrips: "Cantrips",
    Weapons: "Weapons",
    Equipment: "Equipment",
    PickType: "Pick Types",
    PickTypeItems: "Pick Items",
    Traits: "Traits",
    Feats: "Feats",
  }[sheet] || sheet;
}

function sheetOrder() {
  return [
    "Classes", "Subclasses",
    "Races", "Subraces",
    "Spells", "Cantrips",
    "Weapons", "Equipment",
    "PickType", "PickTypeItems",
    "Traits", "Feats",
  ];
}

function loadDraft() {
  const raw = localStorage.getItem(LS_DRAFT_KEY);
  const obj = raw ? safeJsonParse(raw, null) : null;
  if (!obj || typeof obj !== "object") return { updatedAt: null, sheets: {} };
  if (!obj.sheets || typeof obj.sheets !== "object") return { updatedAt: null, sheets: {} };
  return obj;
}

function saveDraft(d) {
  const out = { ...d, updatedAt: Date.now() };
  localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(out));
  return out;
}

function ensureSheetDraft(draft, sheet) {
  if (!draft.sheets[sheet]) draft.sheets[sheet] = { patchesById: {}, createdById: {} };
  if (!draft.sheets[sheet].patchesById) draft.sheets[sheet].patchesById = {};
  if (!draft.sheets[sheet].createdById) draft.sheets[sheet].createdById = {};
}

function getEffectiveRow(baseRow, draftSheet, id) {
  const created = draftSheet?.createdById?.[id];
  const patch = draftSheet?.patchesById?.[id];
  if (created) return { ...clone(created), ...(patch ? clone(patch) : {}) };
  if (!baseRow) return patch ? clone(patch) : null;
  return { ...clone(baseRow), ...(patch ? clone(patch) : {}) };
}

function computeDirtyCount(draftSheet) {
  const p = Object.keys(draftSheet?.patchesById || {}).length;
  const c = Object.keys(draftSheet?.createdById || {}).length;
  return p + c;
}

function rowsToTSV(rows, headers) {
  const esc = (v) => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.replace(/\r?\n/g, " ").replace(/\t/g, " ");
  };
  const lines = [];
  lines.push(headers.join("\t"));
  for (const r of rows) {
    lines.push(headers.map(h => esc(r[h])).join("\t"));
  }
  return lines.join("\n");
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

// ===============================
// State
// ===============================
let bundle = null;
let draft = loadDraft();

let currentSheet = "Subclasses";
let search = "";
let selectedId = null;

let _baseBySheet = {}; // sheet -> base array

// ===============================
// UI Wiring
// ===============================
function rebuildTypeSelect() {
  const sel = $("#cmsType");
  sel.innerHTML = "";
  const keys = Object.keys(bundle || {});

  const order = sheetOrder();
  const ordered = [...order.filter(k => keys.includes(k)), ...keys.filter(k => !order.includes(k))];

  for (const k of ordered) {
    // only expose array sheets
    if (!Array.isArray(bundle?.[k]) && !Array.isArray(bundle?.[k]?.rows)) continue;
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = sheetLabel(k);
    sel.appendChild(opt);
  }
  if ([...sel.options].some(o => o.value === currentSheet)) sel.value = currentSheet;
  else currentSheet = sel.value;
}

function getBaseRowsForSheet(sheet) {
  const raw = bundle?.[sheet];
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.rows) ? raw.rows : []);
  return arr;
}

function getIndexRows(sheet) {
  const base = _baseBySheet[sheet] || [];
  ensureSheetDraft(draft, sheet);
  const ds = draft.sheets[sheet];

  const byId = new Map();
  for (const r of base) {
    const id = detectId(r, sheet);
    if (!id) continue;
    byId.set(id, r);
  }
  // include created rows
  for (const [id, row] of Object.entries(ds.createdById || {})) {
    byId.set(id, row);
  }
  const out = [];
  for (const [id, baseRow] of byId.entries()) {
    const eff = getEffectiveRow(baseRow, ds, id);
    const name = detectName(eff);
    const dirty = !!ds.patchesById?.[id] || !!ds.createdById?.[id];
    out.push({ id, name, dirty });
  }
  out.sort((a,b) => (normalizeKey(a.name)||a.id).localeCompare(normalizeKey(b.name)||b.id));
  return out;
}

function renderList() {
  const list = $("#cmsList");
  list.innerHTML = "";

  const rows = getIndexRows(currentSheet);
  const q = normalizeKey(search);
  const filtered = q
    ? rows.filter(r => normalizeKey(r.name).includes(q) || normalizeKey(r.id).includes(q))
    : rows;

  const dirtyCount = computeDirtyCount(draft.sheets[currentSheet]);
  $("#cmsMeta").textContent = `${sheetLabel(currentSheet)} · ${filtered.length} shown · ${rows.length} total · ${dirtyCount} draft change(s)`;

  // hard cap render to keep it safe
  const MAX_RENDER = 200;
  const toShow = filtered.slice(0, MAX_RENDER);

  for (const r of toShow) {
    const item = document.createElement("div");
    item.className = "cms-item" + (r.id === selectedId ? " active" : "");
    const name = document.createElement("div");
    name.className = "cms-item-name";
    name.textContent = r.name || "(Unnamed)";
    const id = document.createElement("div");
    id.className = "cms-item-id";
    id.textContent = r.id;
    item.append(name, id);
    if (r.dirty) {
      const badge = document.createElement("div");
      badge.className = "cms-badge dirty";
      badge.textContent = "Draft";
      item.appendChild(badge);
    }
    item.onclick = () => { selectedId = r.id; renderAll(); };
    list.appendChild(item);
  }

  if (filtered.length > MAX_RENDER) {
    const more = document.createElement("div");
    more.className = "cms-meta";
    more.textContent = `Showing first ${MAX_RENDER}. Narrow your search to see more.`;
    list.appendChild(more);
  }
}

function fieldRow(label, value, onChange, { multiline=false, readonly=false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "cms-field";
  const l = document.createElement("div");
  l.className = "cms-label";
  l.textContent = label;
  const inp = document.createElement(multiline ? "textarea" : "input");
  inp.className = "cms-input" + (multiline ? " cms-textarea" : "");
  inp.value = value ?? "";
  if (readonly) inp.disabled = true;
  inp.oninput = () => onChange(inp.value);
  wrap.append(l, inp);
  return wrap;
}

function guessPrimaryKeys(sheet, row) {
  // return { idKey, nameKey }
  const keys = Object.keys(row || {});
  const idKey = keys.find(k => /id$/i.test(k)) || "id";
  const nameKey = keys.find(k => /name$/i.test(k)) || keys.find(k => /label$/i.test(k)) || "name";

  // sheet-aware preference
  const prefer = {
    Races: ["RaceId","RaceName"],
    Subraces: ["SubraceId","SubraceName"],
    Classes: ["ClassId","ClassName"],
    Subclasses: ["SubclassId","SubclassName"],
    Spells: ["SpellId","SpellName"],
    Cantrips: ["CantripId","CantripName"],
    Weapons: ["WeaponId","WeaponName"],
    Equipment: ["EquipmentId","EquipmentName"],
    PickType: ["PickTypeId","PickTypeName"],
  }[sheet];
  if (prefer) {
    return { idKey: prefer[0], nameKey: prefer[1] };
  }
  return { idKey, nameKey };
}

function renderForm() {
  const formCard = $("#cmsFormCard");
  const empty = $("#cmsEmptyHint");
  const form = $("#cmsForm");
  const adv = $("#cmsAdvancedForm");
  form.innerHTML = "";
  adv.innerHTML = "";

  if (!selectedId) {
    $("#cmsBreadcrumb").textContent = "Pick an item from the list.";
    formCard.style.display = "none";
    empty.style.display = "block";
    return;
  }

  ensureSheetDraft(draft, currentSheet);
  const ds = draft.sheets[currentSheet];
  const base = _baseBySheet[currentSheet] || [];
  const baseRow = base.find(r => detectId(r, currentSheet) === selectedId) || null;
  const row = getEffectiveRow(baseRow, ds, selectedId);
  if (!row) {
    $("#cmsBreadcrumb").textContent = `${sheetLabel(currentSheet)} · ${selectedId}`;
    formCard.style.display = "none";
    empty.style.display = "block";
    return;
  }

  const name = detectName(row) || "(Unnamed)";
  $("#cmsBreadcrumb").textContent = `${sheetLabel(currentSheet)} → ${name}  (id: ${selectedId})`;

  formCard.style.display = "block";
  empty.style.display = "none";

  // Primary fields
  const { idKey, nameKey } = guessPrimaryKeys(currentSheet, row);

  // ID (read-only)
  form.appendChild(fieldRow("ID", selectedId, () => {}, { readonly: true }));

  // Name
  form.appendChild(fieldRow("Name", row[nameKey] ?? row.name ?? "", (v) => {
    setPatchField(nameKey, v);
  }));

  // Description-ish field (best effort)
  const descKey = Object.keys(row).find(k => /desc(ription)?$/i.test(k) || /text$/i.test(k)) || null;
  if (descKey) {
    form.appendChild(fieldRow("Description", row[descKey] ?? "", (v) => setPatchField(descKey, v), { multiline: true }));
  }

  // Advanced: all other fields as plain inputs
  const primary = new Set([idKey, nameKey, descKey, "id", "name"].filter(Boolean));
  const keys = Object.keys(row).filter(k => !primary.has(k));
  keys.sort((a,b)=>a.localeCompare(b));
  for (const k of keys) {
    const val = row[k];
    const multiline = typeof val === "string" && val.length > 80;
    adv.appendChild(fieldRow(k, val ?? "", (v) => setPatchField(k, v), { multiline }));
  }
}

function setPatchField(key, value) {
  ensureSheetDraft(draft, currentSheet);
  const ds = draft.sheets[currentSheet];
  if (!ds.patchesById[selectedId]) ds.patchesById[selectedId] = {};
  ds.patchesById[selectedId][key] = value;
  draft = saveDraft(draft);
  renderDraftMeta();
  renderList();
}

function renderDraftMeta() {
  const when = draft.updatedAt ? new Date(draft.updatedAt).toLocaleString() : "(none)";
  const sheets = Object.keys(draft.sheets || {});
  const dirty = sheets.reduce((n, s) => n + computeDirtyCount(draft.sheets[s]), 0);
  $("#cmsDraftMeta").textContent = `Draft: ${dirty} change(s) · last saved ${when}`;
}

function clearBanner() {
  const b = $("#cmsBanner");
  b.style.display = "none";
}

async function reloadBundle() {
  clearBanner();
  $("#cmsMeta").textContent = "Loading…";
  bundle = await getBundle();
  _baseBySheet = {};
  for (const k of Object.keys(bundle || {})) {
    const rows = getBaseRowsForSheet(k);
    if (rows.length) _baseBySheet[k] = rows;
  }
  rebuildTypeSelect();
  renderAll();
}

function addNew() {
  ensureSheetDraft(draft, currentSheet);
  const ds = draft.sheets[currentSheet];

  const id = prompt(`New ${sheetLabel(currentSheet)} ID (no spaces):`);
  if (!id) return;
  const clean = String(id).trim();
  if (!clean) return;

  // uniqueness check across base + draft
  const existsBase = (_baseBySheet[currentSheet] || []).some(r => detectId(r, currentSheet) === clean);
  const existsDraft = !!ds.createdById?.[clean];
  if (existsBase || existsDraft) {
    toast("That ID already exists.", "error");
    return;
  }

  const name = prompt("Name (shown in the UI):") || "";

  // build a minimal row with the sheet's likely ID/Name keys
  const template = {};
  const keyPair = {
    Races: ["RaceId","RaceName"],
    Subraces: ["SubraceId","SubraceName"],
    Classes: ["ClassId","ClassName"],
    Subclasses: ["SubclassId","SubclassName"],
    Spells: ["SpellId","SpellName"],
    Cantrips: ["CantripId","CantripName"],
    Weapons: ["WeaponId","WeaponName"],
    Equipment: ["EquipmentId","EquipmentName"],
    PickType: ["PickTypeId","PickTypeName"],
    PickTypeItems: ["PickTypeId","PickItemName"],
  }[currentSheet] || ["Id","Name"];

  template[keyPair[0]] = clean;
  template[keyPair[1]] = name;

  ds.createdById[clean] = template;
  draft = saveDraft(draft);

  selectedId = clean;
  toast("Created draft item.", "ok");
  renderAll();
}

function revertSelected() {
  if (!selectedId) return;
  ensureSheetDraft(draft, currentSheet);
  const ds = draft.sheets[currentSheet];
  delete ds.patchesById[selectedId];
  delete ds.createdById[selectedId];
  draft = saveDraft(draft);
  toast("Reverted.", "ok");
  // if it was created-only, unselect
  const stillExists = (_baseBySheet[currentSheet] || []).some(r => detectId(r, currentSheet) === selectedId);
  if (!stillExists) selectedId = null;
  renderAll();
}

function saveDraftButton() {
  // We already save on edit; this just confirms
  draft = saveDraft(draft);
  toast("Draft saved.", "ok");
  renderDraftMeta();
}

function exportTSV() {
  ensureSheetDraft(draft, currentSheet);
  const ds = draft.sheets[currentSheet];
  const base = _baseBySheet[currentSheet] || [];
  const byId = new Map();
  for (const r of base) {
    const id = detectId(r, currentSheet);
    if (!id) continue;
    byId.set(id, r);
  }
  for (const [id, r] of Object.entries(ds.createdById || {})) {
    byId.set(id, r);
  }

  const merged = [];
  for (const [id, baseRow] of byId.entries()) {
    const eff = getEffectiveRow(baseRow, ds, id);
    merged.push(eff);
  }
  merged.sort((a,b)=> (detectId(a,currentSheet)||"").localeCompare(detectId(b,currentSheet)||""));

  // headers = union of keys
  const headersSet = new Set();
  for (const r of merged) for (const k of Object.keys(r || {})) headersSet.add(k);
  const headers = Array.from(headersSet);
  headers.sort((a,b)=>a.localeCompare(b));

  const tsv = rowsToTSV(merged, headers);
  copyText(tsv).then(()=>toast("TSV copied to clipboard.","ok")).catch(()=>toast("Could not copy TSV.","error"));
}

function copyReport() {
  ensureSheetDraft(draft, currentSheet);
  const ds = draft.sheets[currentSheet];
  const created = Object.keys(ds.createdById || {});
  const patched = Object.keys(ds.patchesById || {});
  const lines = [];
  lines.push("HBCR Content Editor Report");
  lines.push(`Type: ${sheetLabel(currentSheet)}`);
  lines.push(`Generated: ${nowStamp()}`);
  lines.push("");
  lines.push(`Created: ${created.length}`);
  for (const id of created.slice(0, 50)) lines.push(`+ ${id}`);
  if (created.length > 50) lines.push(`… +${created.length-50} more`);
  lines.push("");
  lines.push(`Edited: ${patched.length}`);
  for (const id of patched.slice(0, 50)) lines.push(`~ ${id}`);
  if (patched.length > 50) lines.push(`… +${patched.length-50} more`);

  const text = lines.join("\n");
  copyText(text).then(()=>toast("Report copied.","ok")).catch(()=>toast("Could not copy report.","error"));
}

function renderAll() {
  renderDraftMeta();
  renderList();
  renderForm();
}

// ===============================
// Init
// ===============================
async function main() {
  $("#cmsSearch").addEventListener("input", (e) => {
    search = e.target.value || "";
    // keep it cheap
    window.clearTimeout(main._deb);
    main._deb = window.setTimeout(() => renderList(), 120);
  });

  $("#cmsType").addEventListener("change", (e) => {
    currentSheet = e.target.value;
    selectedId = null;
    renderAll();
  });

  $("#cmsAdd").onclick = addNew;
  $("#cmsReload").onclick = async () => {
    // bust bundle cache
    // eslint-disable-next-line no-import-assign
    toast("Reloading bundle…", "ok");
    // force reload by clearing module cache promise
    // (liveData.js caches internally; easiest is hard refresh in practice)
    // Here we just refetch by directly calling fetch, bypassing cache.
    try {
      const res = await fetch("https://hbcr-api.hbcrbuilder.workers.dev/api/bundle?t=" + Date.now(), { cache: "no-store", mode: "cors" });
      if (!res.ok) throw new Error(String(res.status));
      bundle = await res.json();
      _baseBySheet = {};
      for (const k of Object.keys(bundle || {})) {
        const rows = getBaseRowsForSheet(k);
        if (rows.length) _baseBySheet[k] = rows;
      }
      rebuildTypeSelect();
      renderAll();
      toast("Bundle reloaded.", "ok");
    } catch (e) {
      toast("Bundle reload failed.", "error");
    }
  };

  $("#cmsSave").onclick = saveDraftButton;
  $("#cmsRevert").onclick = revertSelected;
  $("#cmsExport").onclick = exportTSV;
  $("#cmsCopyReport").onclick = copyReport;

  try {
    await reloadBundle();
  } catch (e) {
    toast("Could not load bundle.", "error");
    console.error(e);
  }
}

main();
