
// HBCR Easy Mode Content Editor (Manual Paste Workflow)
// - Reads bundle from Worker (/api/bundle)
// - Provides simple "Add" wizards with parent dropdowns
// - Exports TSV rows for manual paste into Google Sheets
// - Shows the real Builder behind the editor (no injection, no overrides)

const HBCR_WORKER_BASE = (typeof window !== "undefined" && window.__HBCR_WORKER_BASE__)
  ? String(window.__HBCR_WORKER_BASE__).replace(/\/$/, "")
  : "https://hbcr-api.hbcrbuilder.workers.dev";

function hbcrApi(path) {
  const p = String(path || "");
  if (p.startsWith("http")) return p;
  return HBCR_WORKER_BASE + (p.startsWith("/") ? p : ("/" + p));
}

// ---------- DOM ----------
const els = {
  frame: document.getElementById("builderFrame"),
  drawer: document.getElementById("drawer"),
  handle: document.getElementById("drawerHandle"),
  btnToggleDrawer: document.getElementById("btnToggleDrawer"),
  tabLibrary: document.getElementById("tabLibrary"),
  tabEditor: document.getElementById("tabEditor"),
  cmsLibrary: document.getElementById("cmsLibrary"),
  cmsEditor: document.getElementById("cmsEditor"),
  cmsStatus: document.getElementById("cmsStatus"),
  btnReload: document.getElementById("btnReload"),
  btnApply: document.getElementById("btnApply"),
  btnExport: document.getElementById("btnExport"),
  btnSave: document.getElementById("btnSave"),
  btnRevert: document.getElementById("btnRevert"),
  selType: document.getElementById("selType"),
  inpSearch: document.getElementById("inpSearch"),
  listItems: document.getElementById("listItems"),
  crumb: document.getElementById("crumb"),

  addModal: document.getElementById("addModal"),
  addBackdrop: document.getElementById("addModalBackdrop"),
  addTitle: document.getElementById("addModalTitle"),
  addHelp: document.getElementById("addModalHelp"),
  addParentRow: document.getElementById("addParentRow"),
  addParentLabel: document.getElementById("addParentLabel"),
  addParentSelect: document.getElementById("addParentSelect"),
  addId: document.getElementById("addId"),
  addName: document.getElementById("addName"),
  addModalCreate: document.getElementById("addModalCreate"),
  addModalCancel: document.getElementById("addModalCancel"),
  addModalClose: document.getElementById("addModalClose"),
};

const LEGACY_HIDE_IDS = ["chkAutoApply", "btnRevert", "btnSave"]; // not used in manual flow

// ---------- State ----------
let bundle = null;            // object keyed by sheet name
let currentSheet = "Races";   // selected sheet to browse/edit
let currentRow = null;        // currently selected row (existing) OR new draft row (not saved anywhere)
let pendingRows = [];         // rows created/edited waiting for copy (manual paste)
let iconManifest = null;

const SHEETS = [
  { key: "Races", label: "Races", idKey: "RaceId", nameKey: "RaceName" },
  { key: "Subraces", label: "Subraces", idKey: "SubraceId", nameKey: "SubraceName", parentKey: "RaceId", parentSheet: "Races", parentLabel: "Parent Race" },
  { key: "Classes", label: "Classes", idKey: "ClassId", nameKey: "ClassName" },
  { key: "Subclasses", label: "Subclasses", idKey: "SubclassId", nameKey: "SubclassName", parentKey: "classId", parentSheet: "Classes", parentLabel: "Parent Class" },
];

// ---------- Helpers ----------
function safeStr(v){ return (v===null||v===undefined) ? "" : String(v); }

function setStatus(msg, kind="info"){
  els.cmsStatus.textContent = msg;
  els.cmsStatus.dataset.kind = kind;
}

function showTab(which){
  const isLib = which === "library";
  els.cmsLibrary.style.display = isLib ? "" : "none";
  els.cmsEditor.style.display = isLib ? "none" : "";
  els.tabLibrary.classList.toggle("is-active", isLib);
  els.tabEditor.classList.toggle("is-active", !isLib);
}

function slugify(s){
  return safeStr(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "new_id";
}

function getSheetMeta(sheetKey){
  return SHEETS.find(s => s.key === sheetKey) || null;
}

function getRows(sheetKey){
  if (!bundle) return [];
  const rows = bundle[sheetKey];
  return Array.isArray(rows) ? rows : [];
}

function guessColumns(sheetKey){
  const rows = getRows(sheetKey);
  if (rows.length) return Object.keys(rows[0]);
  // fallback to known schema
  const meta = getSheetMeta(sheetKey);
  if (!meta) return [];
  if (sheetKey === "Subclasses") return ["SubclassId","classId","SubclassName","Description","SortOrder","CasterProgression","Source"];
  if (sheetKey === "Subraces") return ["SubraceId","RaceId","SubraceName","Description","SortOrder","Source"];
  if (sheetKey === "Classes") return ["ClassId","ClassName","Description","SortOrder","Source"];
  if (sheetKey === "Races") return ["RaceId","RaceName","Description","SortOrder","Source"];
  return [];
}

function toTSVRow(sheetKey, rowObj, includeHeader=false){
  const cols = guessColumns(sheetKey);
  const esc = (v)=>{
    // TSV friendly: replace newlines, keep tabs as spaces
    return safeStr(v).replace(/\r?\n/g, "\\n").replace(/\t/g, "    ");
  };
  const row = cols.map(c => esc(rowObj?.[c]));
  if (!includeHeader) return row.join("\t");
  return cols.join("\t") + "\n" + row.join("\t");
}

async function copyText(txt){
  try{
    await navigator.clipboard.writeText(txt);
    setStatus("Copied to clipboard.", "ok");
  }catch(e){
    // fallback
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    setStatus("Copied to clipboard.", "ok");
  }
}

function openAddModal(sheetKey){
  const meta = getSheetMeta(sheetKey);
  if (!meta) return;

  // Reset fields
  els.addId.value = "";
  els.addName.value = "";
  els.addParentSelect.innerHTML = "";

  els.addTitle.textContent = `Add ${meta.label.replace(/s$/,"")}`;
  els.addHelp.textContent = "Fill the fields, then copy TSV and paste into the matching Google Sheet tab.";

  // Parent dropdown if needed
  if (meta.parentKey){
    els.addParentRow.style.display = "";
    els.addParentLabel.textContent = meta.parentLabel + ":";
    const parentRows = getRows(meta.parentSheet);
    const parentMeta = getSheetMeta(meta.parentSheet);
    const opts = parentRows
      .map(r => ({
        id: safeStr(r[parentMeta.idKey]),
        name: safeStr(r[parentMeta.nameKey]),
      }))
      .filter(o => o.id)
      .sort((a,b)=>a.name.localeCompare(b.name));

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = `Choose ${meta.parentLabel.toLowerCase()}…`;
    els.addParentSelect.appendChild(ph);

    for (const o of opts){
      const op = document.createElement("option");
      op.value = o.id;
      op.textContent = `${o.name || o.id} (${o.id})`;
      els.addParentSelect.appendChild(op);
    }
  }else{
    els.addParentRow.style.display = "none";
  }

  els.addModal.dataset.sheet = sheetKey;
  els.addBackdrop.style.display = "";
  els.addModal.style.display = "";
  setTimeout(()=>els.addName.focus(), 0);
}

function closeAddModal(){
  els.addBackdrop.style.display = "none";
  els.addModal.style.display = "none";
}

function buildNewRow(sheetKey){
  const meta = getSheetMeta(sheetKey);
  const idKey = meta.idKey;
  const nameKey = meta.nameKey;

  const idInput = safeStr(els.addId.value).trim();
  const nameInput = safeStr(els.addName.value).trim();

  const id = idInput || slugify(nameInput || "new");
  const row = {};
  // Fill all known columns with empty string
  for (const c of guessColumns(sheetKey)) row[c] = "";

  row[idKey] = id;
  row[nameKey] = nameInput || id;

  if (meta.parentKey){
    const parent = safeStr(els.addParentSelect.value).trim();
    if (!parent){
      setStatus(`Pick a ${meta.parentLabel.toLowerCase()} first.`, "warn");
      return null;
    }
    row[meta.parentKey] = parent;
  }

  // Soft defaults
  if ("Source" in row) row["Source"] = row["Source"] || "hbcr";
  if ("SortOrder" in row) row["SortOrder"] = row["SortOrder"] || "";

  return row;
}

function renderLibrary(){
  // Fill quick action buttons + type selector + list
  // Keep existing UI elements but make it obvious.
  const meta = getSheetMeta(currentSheet);
  els.selType.value = currentSheet;

  const rows = getRows(currentSheet);
  const q = safeStr(els.inpSearch.value).trim().toLowerCase();

  const idKey = meta?.idKey || "id";
  const nameKey = meta?.nameKey || "name";

  const filtered = rows.filter(r=>{
    if (!q) return true;
    const id = safeStr(r[idKey]).toLowerCase();
    const nm = safeStr(r[nameKey]).toLowerCase();
    return id.includes(q) || nm.includes(q);
  }).slice(0, 400);

  els.listItems.innerHTML = "";

  for (const r of filtered){
    const id = safeStr(r[idKey]);
    const nm = safeStr(r[nameKey]);
    const div = document.createElement("div");
    div.className = "cms-item";
    div.innerHTML = `
      <div class="cms-item-main">
        <div class="cms-item-name">${nm || id}</div>
        <div class="cms-item-id">${id}</div>
      </div>
      <button class="btn btn-small" type="button">Edit</button>
    `;
    div.querySelector("button").addEventListener("click", ()=>{
      currentRow = { sheet: currentSheet, row: r, mode: "edit" };
      renderEditor();
      showTab("editor");
    });
    els.listItems.appendChild(div);
  }

  els.crumb.textContent = `Browsing: ${meta?.label || currentSheet} · ${rows.length} rows`;
}

function renderEditor(){
  if (!currentRow){
    els.cmsEditor.innerHTML = `
      <div class="cms-empty">
        <div class="cms-empty-title">No item selected</div>
        <div class="cms-empty-sub">Use the Library tab to add a new item or edit an existing one.</div>
      </div>
    `;
    return;
  }

  const { sheet, row, mode } = currentRow;
  const meta = getSheetMeta(sheet);
  const cols = guessColumns(sheet);

  const idKey = meta.idKey;
  const nameKey = meta.nameKey;

  const title = mode === "add" ? `New ${meta.label.replace(/s$/,"")}` : `${meta.label.replace(/s$/,"")} · ${safeStr(row[nameKey]) || safeStr(row[idKey])}`;

  // Build a simple form: Name, Description, Parent (if any), Icon (if available), then "Advanced" for others
  const parentHtml = meta.parentKey ? `
    <div class="cms-field">
      <label>${meta.parentLabel}</label>
      <select id="edParent">
        ${renderParentOptions(meta, safeStr(row[meta.parentKey]))}
      </select>
    </div>
  ` : "";

  const iconField = cols.includes("Icon") ? `
    <div class="cms-field">
      <label>Icon</label>
      <input id="edIcon" list="iconList" value="${escapeHtml(safeStr(row.Icon))}" placeholder="Start typing icon path…">
      ${renderIconDatalist()}
      <div class="cms-hint">Pick an icon path from the repo assets. Optional.</div>
    </div>
  ` : "";

  const descField = cols.includes("Description") ? `
    <div class="cms-field">
      <label>Description</label>
      <textarea id="edDesc" rows="6">${escapeHtml(safeStr(row.Description))}</textarea>
    </div>
  ` : "";

  const otherKeys = cols.filter(c => ![idKey,nameKey,meta.parentKey,"Description","Icon"].includes(c));

  const advFields = otherKeys.map(k=>{
    return `
      <div class="cms-field">
        <label>${k}</label>
        <input data-adv="${escapeHtml(k)}" value="${escapeHtml(safeStr(row[k]))}">
      </div>
    `;
  }).join("");

  els.cmsEditor.innerHTML = `
    <div class="cms-editor-head">
      <div class="cms-editor-title">${escapeHtml(title)}</div>
      <div class="cms-editor-actions">
        <button class="btn btn-small" id="btnCopyRow" type="button">Copy TSV Row</button>
        <button class="btn btn-small" id="btnCopyHeaderRow" type="button">Copy Header+Row</button>
        <button class="btn btn-small" id="btnRefreshBuilder" type="button">Refresh Builder</button>
      </div>
    </div>

    <div class="cms-form">
      <div class="cms-field">
        <label>${idKey}</label>
        <input id="edId" value="${escapeHtml(safeStr(row[idKey]))}" ${mode==="edit" ? "readonly" : ""}>
        <div class="cms-hint">${mode==="edit" ? "ID is read-only to avoid breaking references." : "Choose a unique ID. This becomes the sheet row id."}</div>
      </div>

      ${meta.parentKey ? parentHtml : ""}

      <div class="cms-field">
        <label>${nameKey}</label>
        <input id="edName" value="${escapeHtml(safeStr(row[nameKey]))}">
      </div>

      ${descField}
      ${iconField}

      <details class="cms-adv">
        <summary>Advanced fields</summary>
        <div class="cms-adv-grid">
          ${advFields || `<div class="cms-hint">No additional fields.</div>`}
        </div>
      </details>

      <div class="cms-export-box">
        <div class="cms-export-title">Manual Paste</div>
        <div class="cms-export-sub">Copy TSV and paste it into the <b>${escapeHtml(sheet)}</b> tab in Google Sheets. Then refresh the builder.</div>
        <textarea id="tsvOut" rows="3" readonly></textarea>
      </div>
    </div>
  `;

  const tsvOut = document.getElementById("tsvOut");

  const syncRowFromInputs = ()=>{
    const newRow = {...row};
    const edName = document.getElementById("edName");
    const edDesc = document.getElementById("edDesc");
    const edParent = document.getElementById("edParent");
    const edIcon = document.getElementById("edIcon");

    newRow[nameKey] = safeStr(edName?.value).trim();

    if (meta.parentKey && edParent) newRow[meta.parentKey] = safeStr(edParent.value).trim();
    if (cols.includes("Description") && edDesc) newRow.Description = safeStr(edDesc.value);
    if (cols.includes("Icon") && edIcon) newRow.Icon = safeStr(edIcon.value).trim();

    // adv fields
    for (const inp of document.querySelectorAll("[data-adv]")){
      const k = inp.getAttribute("data-adv");
      newRow[k] = safeStr(inp.value);
    }

    // keep id stable
    newRow[idKey] = safeStr(document.getElementById("edId")?.value).trim() || newRow[idKey];

    return newRow;
  };

  const updateTSV = ()=>{
    const newRow = syncRowFromInputs();
    tsvOut.value = toTSVRow(sheet, newRow, false);
    currentRow.row = newRow;
  };
  updateTSV();

  for (const el of els.cmsEditor.querySelectorAll("input,textarea,select")){
    el.addEventListener("input", ()=>updateTSV());
    el.addEventListener("change", ()=>updateTSV());
  }

  document.getElementById("btnCopyRow").addEventListener("click", ()=>{
    copyText(toTSVRow(sheet, syncRowFromInputs(), false));
  });
  document.getElementById("btnCopyHeaderRow").addEventListener("click", ()=>{
    copyText(toTSVRow(sheet, syncRowFromInputs(), true));
  });
  document.getElementById("btnRefreshBuilder").addEventListener("click", ()=>{
    refreshBuilder();
  });
}

function renderParentOptions(meta, currentVal){
  const parentRows = getRows(meta.parentSheet);
  const parentMeta = getSheetMeta(meta.parentSheet);
  const opts = parentRows
    .map(r => ({ id: safeStr(r[parentMeta.idKey]), name: safeStr(r[parentMeta.nameKey]) }))
    .filter(o => o.id)
    .sort((a,b)=>a.name.localeCompare(b.name));

  const parts = [];
  parts.push(`<option value="">Choose ${escapeHtml(meta.parentLabel.toLowerCase())}…</option>`);
  for (const o of opts){
    const sel = o.id === currentVal ? "selected" : "";
    parts.push(`<option value="${escapeHtml(o.id)}" ${sel}>${escapeHtml(o.name || o.id)} (${escapeHtml(o.id)})</option>`);
  }
  return parts.join("");
}

function renderIconDatalist(){
  if (!iconManifest || !Array.isArray(iconManifest.icons)) return "";
  const options = iconManifest.icons.slice(0, 1200).map(p => `<option value="${escapeHtml(p)}"></option>`).join("");
  return `<datalist id="iconList">${options}</datalist>`;
}

function escapeHtml(s){
  return safeStr(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

async function loadIconManifest(){
  try{
    const res = await fetch("/editor/cms/icon_manifest.json", { cache: "no-store" });
    if (!res.ok) return null;
    iconManifest = await res.json();
  }catch{}
}

async function loadBundle(){
  setStatus("Loading bundle…", "info");
  const res = await fetch(hbcrApi("/api/bundle"), { cache: "no-store", mode: "cors" });
  if (!res.ok){
    setStatus(`Bundle fetch failed: ${res.status}`, "error");
    return;
  }
  bundle = await res.json();
  setStatus("Bundle loaded.", "ok");
  renderLibrary();
  if (currentRow) renderEditor();
}

function refreshBuilder(){
  // Full reload the iframe so it pulls latest /api/bundle after you paste to Sheets.
  try{
    els.frame.contentWindow.location.reload();
  }catch{
    // fallback: reset src
    const src = els.frame.getAttribute("src");
    els.frame.setAttribute("src", src);
  }
  setStatus("Builder refreshed.", "ok");
}

// ---------- Wire up UI ----------
function init(){
  // Hide legacy controls
  for (const id of LEGACY_HIDE_IDS){
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }

  // Remove "Apply" meaning; repurpose
  if (els.btnApply) els.btnApply.textContent = "Refresh Builder";
  if (els.btnReload) els.btnReload.textContent = "Reload Bundle";
  if (els.btnExport) els.btnExport.style.display = "none";
  if (els.btnSave) els.btnSave.style.display = "none";
  if (els.btnRevert) els.btnRevert.style.display = "none";

  // Tabs
  els.tabLibrary.addEventListener("click", ()=>showTab("library"));
  els.tabEditor.addEventListener("click", ()=>showTab("editor"));

  // Drawer toggle
  els.btnToggleDrawer.addEventListener("click", ()=>{
    const open = els.drawer.classList.toggle("is-open");
    els.btnToggleDrawer.textContent = open ? "Hide" : "Show";
    els.handle.style.display = open ? "none" : "";
  });
  els.handle.addEventListener("click", ()=>{
    els.drawer.classList.add("is-open");
    els.btnToggleDrawer.textContent = "Hide";
    els.handle.style.display = "none";
  });

  // Type selector
  els.selType.innerHTML = SHEETS.map(s=>`<option value="${escapeHtml(s.key)}">${escapeHtml(s.label)}</option>`).join("");
  els.selType.value = currentSheet;
  els.selType.addEventListener("change", ()=>{
    currentSheet = els.selType.value;
    currentRow = null;
    renderLibrary();
    renderEditor();
    showTab("library");
  });

  // Search
  els.inpSearch.addEventListener("input", ()=>renderLibrary());

  // Buttons
  els.btnReload.addEventListener("click", ()=>loadBundle());
  els.btnApply.addEventListener("click", ()=>refreshBuilder());

  // Add button: opens modal for current sheet
  document.getElementById("btnAdd").addEventListener("click", ()=>{
    openAddModal(currentSheet);
  });

  // Modal handlers
  const onCreate = ()=>{
    const sheetKey = els.addModal.dataset.sheet || currentSheet;
    const row = buildNewRow(sheetKey);
    if (!row) return;

    // Immediately open editor on this new row (but does not touch builder)
    currentRow = { sheet: sheetKey, row, mode: "add" };
    closeAddModal();
    renderLibrary(); // stay consistent
    renderEditor();
    showTab("editor");
    setStatus(`Created row for ${sheetKey}. Copy TSV and paste into Sheets.`, "ok");
  };

  els.addModalCreate.addEventListener("click", onCreate);
  els.addModalCancel.addEventListener("click", closeAddModal);
  els.addModalClose.addEventListener("click", closeAddModal);
  els.addBackdrop.addEventListener("click", closeAddModal);

  showTab("library");
}

// boot
(async ()=>{
  await loadIconManifest();
  init();
  await loadBundle();
})();
