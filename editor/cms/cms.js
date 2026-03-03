
// HBCR Easy Mode Content Editor (Manual Paste Workflow)
// - Reads bundle from Worker (/api/bundle)
// - Provides simple "Add" wizards with parent dropdowns
// - Exports TSV rows for manual paste into Google Sheets
// - Shows the real Builder behind the editor (no injection, no overrides)

const HBCR_WORKER_BASE = (typeof window !== "undefined" && window.__HBCR_WORKER_BASE__)
  ? String(window.__HBCR_WORKER_BASE__).replace(/\/$/, "")
  : "https://hbcr-api.hbcrbuilder.workers.dev";


// ---------- Floating window (draggable + persistent size/pos) ----------
const WINDOW_STATE_KEY = "hbcr_cms_window_v1";
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function loadWindowState(){
  try { return JSON.parse(localStorage.getItem(WINDOW_STATE_KEY) || "null"); } catch { return null; }
}
function saveWindowState(state){
  try { localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state)); } catch {}
}

function applyWindowState(drawer, st){
  if (!st) return;
  if (typeof st.top === "number") drawer.style.setProperty("--cms-top", st.top + "px");
  if (typeof st.left === "number") drawer.style.setProperty("--cms-left", st.left + "px");
  if (typeof st.w === "number") drawer.style.setProperty("--cms-w", st.w + "px");
  if (typeof st.h === "number") drawer.style.setProperty("--cms-h", st.h + "px");
}

function setupDrawerWindowing(){
  const drawer = document.getElementById("drawer");
  if (!drawer) return;

  // Restore saved state
  applyWindowState(drawer, loadWindowState());

  // Drag by topbar, but ignore clicks on controls/links
  const handle = drawer.querySelector(".cms-topbar");
  let dragging = false;
  let startX = 0, startY = 0, startTop = 0, startLeft = 0;

  function isInteractive(el){
    return !!el.closest("button,a,input,select,textarea,label");
  }

  handle?.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (isInteractive(e.target)) return;

    dragging = true;
    handle.setPointerCapture?.(e.pointerId);
    const rect = drawer.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startTop = rect.top;
    startLeft = rect.left;
    e.preventDefault();
  });

  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = drawer.getBoundingClientRect();

    const newLeft = clamp(startLeft + dx, 8, vw - rect.width - 8);
    const newTop  = clamp(startTop + dy, 8, vh - rect.height - 8);

    drawer.style.setProperty("--cms-left", newLeft + "px");
    drawer.style.setProperty("--cms-top", newTop + "px");
  }, { passive: true });

  window.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;

    const rect = drawer.getBoundingClientRect();
    saveWindowState({
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    });
  });

  // Persist resizes (the CSS uses resize: both)
  const ro = new ResizeObserver(() => {
    const rect = drawer.getBoundingClientRect();
    // Update CSS vars so the resize "sticks" with our var-driven sizing
    drawer.style.setProperty("--cms-w", Math.round(rect.width) + "px");
    drawer.style.setProperty("--cms-h", Math.round(rect.height) + "px");
    saveWindowState({
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    });
  });
  ro.observe(drawer);
}


function hbcrApi(path) {
  const p = String(path || "");
  if (!p.startsWith("/")) return HBCR_WORKER_BASE + "/" + p;
  return HBCR_WORKER_BASE + p;
}

const els = {};
let bundle = {};
let currentType = "Races";
let currentId = null;
let currentRow = null;

// Local preview patch storage (read by src/data/liveData.js when ?cmsPreview=1)
const CMS_DRAFT_KEY = "hbcr_cms_draft_v3";

function loadCmsDraft(){
  try{
    const raw = localStorage.getItem(CMS_DRAFT_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  }catch{
    return {};
  }
}

function saveCmsDraft(d){
  try{ localStorage.setItem(CMS_DRAFT_KEY, JSON.stringify(d || {})); }catch{}
}

function setDraftEntry(type, id, row){
  const m = TYPE_META[type] || {};
  const idKey = m.idKey;
  const draft = loadCmsDraft();
  const key = `${type}::${id}`;
  const out = {};
  // store only non-id fields (liveData will add idKey on insert)
  for (const k of Object.keys(row || {})){
    if (k === idKey) continue;
    out[k] = row[k];
  }
  draft[key] = out;
  saveCmsDraft(draft);
}

function clearDraftEntry(type, id){
  const draft = loadCmsDraft();
  const key = `${type}::${id}`;
  if (draft && Object.prototype.hasOwnProperty.call(draft, key)){
    delete draft[key];
    saveCmsDraft(draft);
    return true;
  }
  return false;
}

const TYPE_META = {
  Races:      { idKey:"RaceId",      nameKey:"RaceName",      descKey:"Description", parentKey:null },
  Subraces:   { idKey:"SubraceId",   nameKey:"SubraceName",   descKey:"Description", parentKey:"RaceId", parentType:"Races" },
  Classes:    { idKey:"ClassId",     nameKey:"ClassName",     descKey:"Description", parentKey:null },
  Subclasses: { idKey:"SubclassId",  nameKey:"SubclassName",  descKey:"Description", parentKey:"classId", parentType:"Classes" },
  Spells:     { idKey:"SpellId",     nameKey:"SpellName",     descKey:"Description", parentKey:null },
};

function safeStr(x){ return (x==null) ? "" : String(x); }
function norm(s){ return safeStr(s).trim(); }

async function loadBundle(){
  els.cmsStatus.textContent = "Loading bundle…";
  const res = await fetch(hbcrApi("/api/bundle"), { cache:"no-store" });
  if (!res.ok) throw new Error("bundle fetch failed: " + res.status);
  bundle = await res.json();
  els.cmsStatus.textContent = "Bundle loaded.";
}

function getSheetRows(type){
  const rows = bundle?.[type];
  return Array.isArray(rows) ? rows : [];
}

function getColumns(type){
  const rows = getSheetRows(type);
  if (rows.length) return Object.keys(rows[0]);
  // fallback: use meta keys first
  const m = TYPE_META[type] || {};
  const base = [m.idKey, m.parentKey, m.nameKey, m.descKey].filter(Boolean);
  // de-dupe
  return [...new Set(base)];
}

function getDisplayName(type, row){
  const m = TYPE_META[type] || {};
  return norm(row?.[m.nameKey]) || norm(row?.[m.idKey]) || "(unnamed)";
}

function listTypes(){
  // only show types that exist in bundle
  const keys = Object.keys(bundle || {});
  const ordered = ["Races","Subraces","Classes","Subclasses","Spells"];
  return ordered.filter(k => keys.includes(k));
}

function renderTypeSelect(){
  const types = listTypes();
  els.selType.innerHTML = "";
  for (const t of types){
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    els.selType.appendChild(opt);
  }
  if (!types.includes(currentType)) currentType = types[0] || "Races";
  els.selType.value = currentType;
}

function renderList(){
  const q = norm(els.inpSearch.value).toLowerCase();
  const rows = getSheetRows(currentType);
  const m = TYPE_META[currentType] || {};
  const idKey = m.idKey || "id";
  const nameKey = m.nameKey || "name";

  const out = document.createElement("div");
  out.className = "cms-list-inner";

  let shown = 0;
  for (const r of rows){
    const id = norm(r?.[idKey]);
    if (!id) continue;
    const nm = norm(r?.[nameKey]) || id;
    const hay = (id + " " + nm).toLowerCase();
    if (q && !hay.includes(q)) continue;

    const item = document.createElement("div");
    item.className = "cms-item";
    item.innerHTML = `
      <div class="cms-item-main">
        <div class="cms-item-name">${nm}</div>
        <div class="cms-item-id">${id}</div>
      </div>
      <button class="btn btn-small" type="button">Edit</button>
    `;
    item.querySelector("button").addEventListener("click", ()=> selectItem(currentType, id));
    out.appendChild(item);
    shown++;
    if (shown >= 250) break; // keep it snappy
  }

  els.listItems.innerHTML = "";
  els.listItems.appendChild(out);
  els.cmsStatus.textContent = `Showing ${shown} of ${rows.length} ${currentType}.`;
}

function selectItem(type, id){
  currentType = type;
  currentId = id;
  const rows = getSheetRows(type);
  const m = TYPE_META[type] || {};
  const idKey = m.idKey || "id";
  currentRow = rows.find(r => norm(r?.[idKey]) === id) || null;

  // switch to editor tab
  setTab("editor");
  renderEditor();
}

function setTab(which){
  const isLib = which === "library";
  els.tabLibrary.classList.toggle("is-active", isLib);
  els.tabEditor.classList.toggle("is-active", !isLib);
  els.cmsLibrary.classList.toggle("is-hidden", !isLib);
  els.cmsEditor.classList.toggle("is-hidden", isLib);
}

function renderEditor(){
  if (!currentRow){
    els.crumb.textContent = "Select an item from the Library.";
    els.form.innerHTML = `<div class="cms-empty">No item selected.</div>`;
    return;
  }
  const m = TYPE_META[currentType] || {};
  const cols = getColumns(currentType);
  const idKey = m.idKey;

  els.crumb.textContent = `${currentType} → ${getDisplayName(currentType, currentRow)} (${norm(currentRow[idKey])})`;

  const wrap = document.createElement("div");
  wrap.className = "cms-form-inner";

  // Helper to build input rows
  function addInput(label, key, kind="text"){
    const val = safeStr(currentRow?.[key] ?? "");
    const row = document.createElement("div");
    row.className = "cms-field";
    const readOnly = key === idKey ? "readonly" : "";
    row.innerHTML = `
      <label class="cms-label">${label}</label>
      <input class="cms-input" data-key="${key}" type="${kind}" value="${escapeHtml(val)}" ${readOnly}/>
    `;
    wrap.appendChild(row);
  }
  function addTextarea(label, key){
    const val = safeStr(currentRow?.[key] ?? "");
    const row = document.createElement("div");
    row.className = "cms-field";
    row.innerHTML = `
      <label class="cms-label">${label}</label>
      <textarea class="cms-input" data-key="${key}" rows="5">${escapeHtml(val)}</textarea>
    `;
    wrap.appendChild(row);
  }
  function addSelect(label, key, options){
    const val = safeStr(currentRow?.[key] ?? "");
    const row = document.createElement("div");
    row.className = "cms-field";
    const opts = options.map(o => `<option value="${escapeAttr(o.value)}"${o.value===val?' selected':''}>${escapeHtml(o.label)}</option>`).join("");
    row.innerHTML = `
      <label class="cms-label">${label}</label>
      <select class="cms-select" data-key="${key}">${opts}</select>
    `;
    wrap.appendChild(row);
  }

  // Main fields first
  addInput("ID", idKey);

  if (m.parentKey){
    const parentType = m.parentType;
    const parentMeta = TYPE_META[parentType];
    const opts = [{value:"", label:"(choose)"}];
    for (const pr of getSheetRows(parentType)){
      const pid = norm(pr?.[parentMeta.idKey]);
      if (!pid) continue;
      const pl = norm(pr?.[parentMeta.nameKey]) || pid;
      opts.push({ value: pid, label: `${pl} (${pid})` });
    }
    addSelect(m.parentType === "Classes" ? "Parent Class" : "Parent Race", m.parentKey, opts);
  }

  addInput("Name", m.nameKey);

  if (m.descKey && cols.includes(m.descKey)){
    addTextarea("Description", m.descKey);
  }

  // Show other columns in an "Advanced" collapsible
  const adv = document.createElement("details");
  adv.className = "cms-advanced";
  adv.innerHTML = `<summary>Advanced fields</summary>`;
  const advWrap = document.createElement("div");
  advWrap.className = "cms-advanced-inner";

  const mainKeys = new Set([m.idKey,m.parentKey,m.nameKey,m.descKey].filter(Boolean));
  for (const k of cols){
    if (mainKeys.has(k)) continue;
    const v = safeStr(currentRow?.[k] ?? "");
    const row = document.createElement("div");
    row.className = "cms-field";
    row.innerHTML = `
      <label class="cms-label">${escapeHtml(k)}</label>
      <input class="cms-input" data-key="${escapeAttr(k)}" value="${escapeHtml(v)}"/>
    `;
    advWrap.appendChild(row);
  }
  adv.appendChild(advWrap);

  wrap.appendChild(adv);

  // Wire inputs
  wrap.querySelectorAll("[data-key]").forEach(el=>{
    el.addEventListener("input", ()=>{
      const key = el.getAttribute("data-key");
      currentRow[key] = el.value;
    });
    el.addEventListener("change", ()=>{
      const key = el.getAttribute("data-key");
      currentRow[key] = el.value;
    });
  });

  els.form.innerHTML = "";
  els.form.appendChild(wrap);
}

function escapeHtml(s){
  return safeStr(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g, "&quot;"); }

function tsvSanitizeCell(v){
  return safeStr(v).replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
}
function buildTSVRow(type, row, includeHeader){
  const cols = getColumns(type);
  const header = cols.join("\t");
  const line = cols.map(c => tsvSanitizeCell(row?.[c] ?? "")).join("\t");
  return includeHeader ? (header + "\n" + line) : line;
}
async function copyText(txt){
  try{
    await navigator.clipboard.writeText(txt);
    toast("Copied to clipboard.");
  }catch{
    // fallback
    const ta = document.createElement("textarea");
    ta.value = txt; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy");
    ta.remove();
    toast("Copied to clipboard.");
  }
}

function toast(msg){
  // minimal toast using existing styles; reuse cmsStatus line
  els.cmsStatus.textContent = msg;
  setTimeout(()=> renderList(), 800);
}

// -------- Modal (Add New) --------
let modalOkHandler = null;
function openModal(title, bodyEl, onOk){
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = "";
  els.modalBody.appendChild(bodyEl);
  modalOkHandler = onOk;
  els.modal.classList.remove("is-hidden");
}
function closeModal(){
  els.modal.classList.add("is-hidden");
  modalOkHandler = null;
}

function makeField(label, inputEl){
  const wrap = document.createElement("div");
  wrap.className = "cms-field";
  const lab = document.createElement("label");
  lab.className = "cms-label";
  lab.textContent = label;
  wrap.appendChild(lab);
  wrap.appendChild(inputEl);
  return wrap;
}

function slugify(s){
  return norm(s).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}

function startAdd(type){
  currentType = type;
  els.selType.value = type;
  setTab("editor");

  const m = TYPE_META[type];
  const body = document.createElement("div");

  const inpName = document.createElement("input");
  inpName.className = "cms-input";
  inpName.placeholder = "Name…";

  const inpId = document.createElement("input");
  inpId.className = "cms-input";
  inpId.placeholder = "ID…";

  let selParent = null;
  if (m.parentKey){
    selParent = document.createElement("select");
    selParent.className = "cms-select";
    const parentType = m.parentType;
    const parentMeta = TYPE_META[parentType];
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "(choose)";
    selParent.appendChild(opt0);
    for (const pr of getSheetRows(parentType)){
      const pid = norm(pr?.[parentMeta.idKey]);
      if (!pid) continue;
      const pl = norm(pr?.[parentMeta.nameKey]) || pid;
      const opt = document.createElement("option");
      opt.value = pid;
      opt.textContent = `${pl} (${pid})`;
      selParent.appendChild(opt);
    }
    body.appendChild(makeField(parentType==="Classes" ? "Parent Class" : "Parent Race", selParent));
  }

  body.appendChild(makeField("Name", inpName));
  body.appendChild(makeField("ID", inpId));

  inpName.addEventListener("input", ()=>{
    if (!norm(inpId.value)){
      inpId.value = slugify(inpName.value);
    }
  });

  openModal(`Add ${type.slice(0,-1)}`, body, ()=>{
    const id = norm(inpId.value);
    const name = norm(inpName.value);
    const parent = selParent ? norm(selParent.value) : "";
    if (!id){ toast("ID is required."); return; }
    if (!name){ toast("Name is required."); return; }
    if (selParent && !parent){ toast("Choose a parent first."); return; }

    // Build new row with correct keys and empty defaults
    const cols = getColumns(type);
    const row = {};
    for (const c of cols) row[c] = "";
    row[m.idKey] = id;
    row[m.nameKey] = name;
    if (m.parentKey) row[m.parentKey] = parent;

    // Add to local view (NOT to builder; user will paste TSV)
    bundle[type] = getSheetRows(type).concat([row]);

    closeModal();
    // select and render
    renderList();
    selectItem(type, id);
    toast("Row created locally. Copy TSV and paste into Sheets.");
  });
}

// -------- UI wiring --------
function wireUI(){
  els.builderFrame = document.getElementById("builderFrame");
  els.drawer = document.getElementById("drawer");
  els.drawerHandle = document.getElementById("drawerHandle");
  els.btnToggleDrawer = document.getElementById("btnToggleDrawer");

  els.tabLibrary = document.getElementById("tabLibrary");
  els.tabEditor = document.getElementById("tabEditor");
  els.cmsLibrary = document.getElementById("cmsLibrary");
  els.cmsEditor = document.getElementById("cmsEditor");

  els.selType = document.getElementById("selType");
  els.inpSearch = document.getElementById("inpSearch");
  els.listItems = document.getElementById("listItems");
  els.cmsStatus = document.getElementById("cmsStatus");

  els.crumb = document.getElementById("crumb");
  els.form = document.getElementById("form");

  els.btnCopyRow = document.getElementById("btnCopyRow");
  els.btnCopyHeaderRow = document.getElementById("btnCopyHeaderRow");
  els.btnUpdatePreview = document.getElementById("btnUpdatePreview");
  els.btnClearPreview = document.getElementById("btnClearPreview");
  els.btnRefreshBuilder = document.getElementById("btnRefreshBuilder");

  // quick add
  document.getElementById("btnQuickAddRace").addEventListener("click", ()=> startAdd("Races"));
  document.getElementById("btnQuickAddSubrace").addEventListener("click", ()=> startAdd("Subraces"));
  document.getElementById("btnQuickAddClass").addEventListener("click", ()=> startAdd("Classes"));
  document.getElementById("btnQuickAddSubclass").addEventListener("click", ()=> startAdd("Subclasses"));

  // tabs
  els.tabLibrary.addEventListener("click", ()=> setTab("library"));
  els.tabEditor.addEventListener("click", ()=> setTab("editor"));

  // type/search
  els.selType.addEventListener("change", ()=>{
    currentType = els.selType.value;
    renderList();
  });
  els.inpSearch.addEventListener("input", ()=> renderList());

  // reload
  const btnReload = document.getElementById("btnReload");
  btnReload.addEventListener("click", async ()=>{
    await loadBundle();
    renderTypeSelect();
    renderList();
    toast("Reloaded.");
  });

  // copy
  els.btnCopyRow.addEventListener("click", ()=>{
    if (!currentRow) return toast("Select an item first.");
    copyText(buildTSVRow(currentType, currentRow, false));
  });
  els.btnCopyHeaderRow.addEventListener("click", ()=>{
    if (!currentRow) return toast("Select an item first.");
    copyText(buildTSVRow(currentType, currentRow, true));
  });

  // Update Builder preview behind the menu (Option A)
  els.btnUpdatePreview.addEventListener("click", ()=>{
    if (!currentRow) return toast("Select an item first.");
    const m = TYPE_META[currentType] || {};
    const idKey = m.idKey;
    const id = norm(currentRow?.[idKey]);
    if (!id) return toast("Missing ID.");
    setDraftEntry(currentType, id, currentRow);
    // reload builder iframe in preview mode
    const base = "/editor/builder/?embed=1&cmsPreview=1";
    els.builderFrame.src = base + "&t=" + Date.now();
    toast("Preview updated (local only). If it looks good, copy TSV to Sheets.");
  });

  els.btnClearPreview.addEventListener("click", ()=>{
    if (!currentRow) return toast("Select an item first.");
    const m = TYPE_META[currentType] || {};
    const idKey = m.idKey;
    const id = norm(currentRow?.[idKey]);
    if (!id) return toast("Missing ID.");
    const removed = clearDraftEntry(currentType, id);
    const base = "/editor/builder/?embed=1&cmsPreview=1";
    els.builderFrame.src = base + "&t=" + Date.now();
    toast(removed ? "Preview cleared for this item." : "Nothing to clear for this item.");
  });

  // refresh builder
  els.btnRefreshBuilder.addEventListener("click", ()=>{
    const base = "/editor/builder/?embed=1";
    els.builderFrame.src = base + "&t=" + Date.now();
    toast("Builder refreshed.");
  });

  // drawer hide/show
  els.btnToggleDrawer.addEventListener("click", ()=>{
    const open = els.drawer.classList.toggle("is-open");
    els.drawerHandle.classList.toggle("is-hidden", open);
    els.btnToggleDrawer.textContent = open ? "Hide" : "Show";
  });
  els.drawerHandle.addEventListener("click", ()=>{
    els.drawer.classList.add("is-open");
    els.drawerHandle.classList.add("is-hidden");
    els.btnToggleDrawer.textContent = "Hide";
  });

  // modal
  els.modal = document.getElementById("modal");
  els.modalTitle = document.getElementById("modalTitle");
  els.modalBody = document.getElementById("modalBody");
  document.getElementById("modalCancel").addEventListener("click", closeModal);
  document.getElementById("modalBackdrop").addEventListener("click", closeModal);
  document.getElementById("modalOk").addEventListener("click", ()=>{
    if (modalOkHandler) modalOkHandler();
  });
}

async function main(){
  setupDrawerWindowing();
  wireUI();
  await loadBundle();
  renderTypeSelect();
  renderList();
  setTab("library");
}

main().catch(err=>{
  console.error(err);
  const el = document.getElementById("cmsStatus");
  if (el) el.textContent = "Error: " + (err?.message || err);
});
