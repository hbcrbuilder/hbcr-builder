/* HBCR Content Editor (Easy Mode)
   - Reads /api/bundle from Workers
   - Lets you edit a selected row as a draft (localStorage)
   - Shows the REAL builder full-screen behind a popout menu
   - Applies draft overrides to the builder via postMessage (throttled)
*/

const API_BASE = "https://hbcr-api.hbcrbuilder.workers.dev";
const BUNDLE_URL = API_BASE + "/api/bundle";

const DRAFT_KEY = "hbcr_cms_draft_v3";// Bumped to clear old/bad drafts
const DRAWER_POS_KEY = "hbcr_cms_drawer_pos_v1";

const $ = (sel) => document.querySelector(sel);

const elType = $("#selType");
const elSearch = $("#inpSearch");
const elList = $("#listItems");
const elForm = $("#form");
const elCrumb = $("#crumb");
const elStatus = $("#cmsStatus");
const btnReload = $("#btnReload");
const btnAdd = $("#btnAdd");
const addModal = $("#addModal");
const addModalBackdrop = $("#addModalBackdrop");
const addModalClose = $("#addModalClose");
const addModalCancel = $("#addModalCancel");
const addModalCreate = $("#addModalCreate");
const addModalHelp = $("#addModalHelp");
const addParentRow = $("#addParentRow");
const addParentLabel = $("#addParentLabel");
const addParentSelect = $("#addParentSelect");
const addId = $("#addId");
const addName = $("#addName");
const btnExport = $("#btnExport");
const btnSave = $("#btnSave");
const btnRevert = $("#btnRevert");

const builderFrame = $("#builderFrame");
const drawer = $("#drawer");
const btnToggleDrawer = $("#btnToggleDrawer");
const drawerHandle = $("#drawerHandle");
const tabLibrary = $("#tabLibrary");
const tabEditor  = $("#tabEditor");
const pnlLibrary = $("#cmsLibrary");
const pnlEditor  = $("#cmsEditor");

const chkAutoApply = $("#chkAutoApply");
const btnApply = $("#btnApply");

let applyTimer = null;
let lastApplyAt = 0;
const APPLY_THROTTLE_MS = 2000;


let bundle = null; // { SheetName: rows[] }
let sheets = []; // sheet names
let currentSheet = null;
let currentRow = null; // merged row (bundle row + draft overrides)
let currentId = null;
let currentIdKey = null;
let currentNameKey = null;
let searchTimer = null;

function readDraftAll(){
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch { return {}; }
}
function writeDraftAll(obj){
  localStorage.setItem(DRAFT_KEY, JSON.stringify(obj));
}
function draftKey(sheet, id){
  return `${sheet}::${id}`;
}

const PREFERRED_ID_KEYS = {
  Races: "RaceId",
  Subraces: "SubraceId",
  Classes: "ClassId",
  Subclasses: "SubclassId",
  Spells: "SpellId",
  Cantrips: "SpellId",
  Feats: "FeatId",
  Traits: "TraitId",
  Equipment: "EquipmentId",
  Weapons: "WeaponId",
  ClassFeatures: "FeatureId",
};
const PREFERRED_NAME_KEYS = {
  Races: "RaceName",
  Subraces: "SubraceName",
  Classes: "ClassName",
  Subclasses: "SubclassName",
  Spells: "SpellName",
  Cantrips: "SpellName",
  Feats: "FeatName",
  Traits: "TraitName",
  Equipment: "EquipmentName",
  Weapons: "WeaponName",
  ClassFeatures: "FeatureName",
};

function guessIdKey(sheet, row){
  if(!row || typeof row !== 'object') return null;
  const pref = PREFERRED_ID_KEYS[sheet];
  if(pref && row[pref] != null) return pref;

  const keys = Object.keys(row);
  // try common patterns
  for (const k of keys){
    if (/^(id|ID|Id)$/.test(k)) return k;
  }
  for (const k of keys){
    if (/Id$/.test(k) || /ID$/.test(k)) return k;
  }
  return null;
}
function guessNameKey(sheet, row){
  if(!row || typeof row !== 'object') return null;
  const pref = PREFERRED_NAME_KEYS[sheet];
  if(pref && row[pref] != null) return pref;

  const keys = Object.keys(row);
  for (const k of keys){
    if (/Name$/.test(k)) return k;
  }
  return null;
}

function safeStr(v){
  if(v == null) return "";
  return String(v);
}

function pickIcon(row){
  if(!row) return "";
  const keys = ["Icon", "IconPath", "IconUrl", "IconURL", "icon", "iconPath", "Portrait", "portrait"];
  for (const k of keys){
    if (row[k]) return String(row[k]);
  }
  return "";
}

function normalizeForSearch(s){
  return safeStr(s).toLowerCase();
}

function getRowsForSheet(sheet){
  const rows = bundle?.[sheet];
  return Array.isArray(rows) ? rows : [];
}

function mergeDraft(sheet, id, baseRow){
  const all = readDraftAll();
  const d = all[draftKey(sheet, id)];
  if(!d) return baseRow;
  return { ...baseRow, ...d };
}

function setStatus(msg){
  elStatus.textContent = msg;
}

function populateTypeDropdown(){
  elType.innerHTML = "";
  for (const s of sheets){
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    elType.appendChild(opt);
  }
}

function renderList(){
  const sheet = currentSheet;
  const q = normalizeForSearch(elSearch.value);
  const rows = getRowsForSheet(sheet);

  // cap results to protect maintainers
  const MAX_SHOW = 400;

  const items = [];
  const seen = new Set();

  // 1) Bundle items
  for (const row of rows){
    const idKey = guessIdKey(sheet, row);
    const nameKey = guessNameKey(sheet, row);
    const id = safeStr(row?.[idKey]).trim();
    if(!id) continue;
    const name = safeStr(row?.[nameKey]).trim() || id;
    if(q){
      const hay = (name + " " + id).toLowerCase();
      if(!hay.includes(q)) continue;
    }
    items.push({ id, name, idKey, nameKey });
    seen.add(id);
    if(items.length >= MAX_SHOW) break;
  }

  // 2) Draft-only (new) items
  try{
    const all = readDraftAll();
    const idKey = PREFERRED_ID_KEYS[sheet] || "id";
    const nameKey = PREFERRED_NAME_KEYS[sheet] || "name";
    for(const k of Object.keys(all)){
      if(!k.startsWith(sheet + "::")) continue;
      const id = k.slice((sheet + "::").length);
      if(!id || seen.has(id)) continue;
      const d = all[k] || {};
      const name = safeStr(d[nameKey]).trim() || safeStr(d.Name).trim() || id;
      if(q){
        const hay = (name + " " + id).toLowerCase();
        if(!hay.includes(q)) continue;
      }
      items.push({ id, name, idKey, nameKey, isDraftOnly:true });
      seen.add(id);
      if(items.length >= MAX_SHOW) break;
    }
  } catch {}

  elList.innerHTML = "";
  if(items.length === 0){
    const empty = document.createElement('div');
    empty.className = 'cms-empty';
    empty.textContent = q ? 'No results. Try a different search.' : 'No items found for this type.';
    elList.appendChild(empty);
    return;
  }

  for (const it of items){
    const div = document.createElement('div');
    div.className = 'cms-item' + (currentId === it.id ? ' active' : '');
    div.dataset.id = it.id;
    div.innerHTML = `
      <div class="cms-item-name">${escapeHtml(it.name)}</div>
      <div class="cms-item-id">${escapeHtml(it.id)}${it.isDraftOnly ? " · draft" : ""}</div>
    `;
    div.addEventListener('click', () => selectItem(it.id));
    elList.appendChild(div);
  }
}

function escapeHtml(s){
  return safeStr(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function findBaseRow(sheet, id){
  const rows = getRowsForSheet(sheet);
  for (const row of rows){
    const idKey = guessIdKey(sheet, row);
    if(!idKey) continue;
    if(String(row[idKey]).trim() === id) return { row, idKey };
  }
  return { row: null, idKey: null };
}

function pushBuilderOverrides(){
  try{
    const all = readDraftAll();
    const msg = { type: "HBCR_CMS_OVERRIDES", draft: all, t: Date.now() };
    builderFrame?.contentWindow?.postMessage(msg, "*");
  } catch {}
}

function applyToPreview(){
  const now = Date.now();
  if(now - lastApplyAt < APPLY_THROTTLE_MS) return;
  lastApplyAt = now;
  pushBuilderOverrides();
}

function scheduleAutoApply(){
  if(!chkAutoApply?.checked) return;
  if(applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(()=>applyToPreview(), 550);
}

// Drawer + tabs
function setTab(which){
  const isLib = which === 'library';
  tabLibrary?.classList.toggle('is-active', isLib);
  tabEditor?.classList.toggle('is-active', !isLib);
  pnlLibrary?.classList.toggle('is-hidden', !isLib);
  pnlEditor?.classList.toggle('is-hidden', isLib);
}

function setDrawer(open){
  drawer?.classList.toggle('is-open', !!open);
  drawerHandle?.classList.toggle('is-hidden', !!open);
  if(btnToggleDrawer) btnToggleDrawer.textContent = open ? 'Hide' : 'Show';
}

// Draggable + resizable drawer (persists position)
function loadDrawerPos(){
  try{ return JSON.parse(localStorage.getItem(DRAWER_POS_KEY) || 'null'); }catch{ return null; }
}
function saveDrawerPos(){
  try{
    const r = drawer.getBoundingClientRect();
    const pos = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    localStorage.setItem(DRAWER_POS_KEY, JSON.stringify(pos));
  }catch{}
}
function applyDrawerPos(pos){
  if(!pos || !drawer) return;
  drawer.style.setProperty('--cms-left', pos.x + 'px');
  drawer.style.setProperty('--cms-top',  pos.y + 'px');
  drawer.style.setProperty('--cms-w',    pos.w + 'px');
  drawer.style.setProperty('--cms-h',    pos.h + 'px');
}
applyDrawerPos(loadDrawerPos());

(function enableDrawerDrag(){
  if(!drawer) return;
  const handle = document.querySelector('.cms-topbar');
  if(!handle) return;

  let dragging = false;
  let startX = 0, startY = 0;
  let baseLeft = 0, baseTop = 0;
  let raf = 0;

  const isInteractive = (el) => {
    if(!el) return false;
    return !!el.closest('button,a,input,select,textarea,label');
  };

  handle.addEventListener('pointerdown', (e)=>{
    if(e.button !== 0) return;
    if(isInteractive(e.target)) return;
    const r = drawer.getBoundingClientRect();
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    baseLeft = r.left; baseTop = r.top;
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const nextLeft = Math.max(6, Math.min(window.innerWidth - 60, baseLeft + dx));
    const nextTop  = Math.max(6, Math.min(window.innerHeight - 60, baseTop  + dy));
    if(raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(()=>{
      drawer.style.setProperty('--cms-left', nextLeft + 'px');
      drawer.style.setProperty('--cms-top',  nextTop  + 'px');
    });
  }, { passive:true });

  const stop = ()=>{
    if(!dragging) return;
    dragging = false;
    if(raf) cancelAnimationFrame(raf);
    saveDrawerPos();
  };
  window.addEventListener('pointerup', stop, { passive:true });
  window.addEventListener('pointercancel', stop, { passive:true });

  // Save size after resize
  const ro = new ResizeObserver(()=>{
    // debounce a bit
    clearTimeout(enableDrawerDrag._t);
    enableDrawerDrag._t = setTimeout(saveDrawerPos, 250);
  });
  ro.observe(drawer);
})();

btnToggleDrawer?.addEventListener('click', ()=> setDrawer(!drawer?.classList.contains('is-open')));
drawerHandle?.addEventListener('click', ()=> setDrawer(true));
tabLibrary?.addEventListener('click', ()=> setTab('library'));
tabEditor?.addEventListener('click', ()=> setTab('editor'));

btnApply?.addEventListener('click', ()=> applyToPreview());


function renderForm(){
  if(!currentRow){
    elForm.innerHTML = '<div class="cms-empty">No item selected.</div>';
    return;
  }

  const idVal = safeStr(currentRow[currentIdKey]).trim();
  const nameVal = safeStr(currentRow[currentNameKey]).trim();

  // heuristic description field
  const descKey = ['Description','Desc','description','Tooltip','LongDescription','Notes'].find(k => currentRow[k] != null);
  const descVal = descKey ? safeStr(currentRow[descKey]) : '';

  elForm.innerHTML = '';

  const fields = document.createElement('div');

  fields.appendChild(fieldReadOnly('ID', idVal));
  fields.appendChild(fieldInput('Name', nameVal, (v)=> updateDraftField(currentNameKey, v)));

  if(descKey){
    fields.appendChild(fieldTextarea('Description', descVal, (v)=> updateDraftField(descKey, v)));
  }

  // Advanced section
  const adv = document.createElement('details');
  adv.className = 'cms-adv';
  adv.innerHTML = '<summary>Advanced fields (read-only JSON)</summary>';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(currentRow, null, 2);
  adv.appendChild(pre);

  elForm.appendChild(fields);
  elForm.appendChild(adv);

  // Update breadcrumb
  elCrumb.textContent = `${currentSheet} → ${nameVal || idVal} (id: ${idVal})`;

  // Auto-apply if enabled (throttled) so maintainers see changes without crashing the browser.
  scheduleAutoApply();
}

function fieldReadOnly(label, value){
  const wrap = document.createElement('div');
  wrap.className = 'cms-field';
  wrap.innerHTML = `<label>${escapeHtml(label)}</label><input value="${escapeHtml(value)}" readonly />`;
  return wrap;
}
function fieldInput(label, value, onChange){
  const wrap = document.createElement('div');
  wrap.className = 'cms-field';
  const lab = document.createElement('label');
  lab.textContent = label;
  const inp = document.createElement('input');
  inp.value = value;
  inp.addEventListener('input', () => {
    onChange(inp.value);
    // debounced update
    if(searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      // refresh merged row + preview
      refreshCurrent();
    }, 120);
  });
  wrap.appendChild(lab);
  wrap.appendChild(inp);
  return wrap;
}
function fieldTextarea(label, value, onChange){
  const wrap = document.createElement('div');
  wrap.className = 'cms-field';
  const lab = document.createElement('label');
  lab.textContent = label;
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.addEventListener('input', () => {
    onChange(ta.value);
    if(searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshCurrent(), 180);
  });
  wrap.appendChild(lab);
  wrap.appendChild(ta);
  return wrap;
}

function updateDraftField(key, value){
  if(!currentSheet || !currentId || !key) return;
  const all = readDraftAll();
  const k = draftKey(currentSheet, currentId);
  all[k] = { ...(all[k] || {}), [key]: value };
  writeDraftAll(all);
  setStatus(`Draft saved locally. (${Object.keys(all).length} item(s) changed)`);
}

function refreshCurrent(){
  if(!currentSheet || !currentId) return;
  const { row: baseRow, idKey } = findBaseRow(currentSheet, currentId);

  if(!baseRow){
    // draft-only new item
    const all = readDraftAll();
    const d = all[draftKey(currentSheet, currentId)];
    if(d){
      currentRow = d;
      renderForm();
    }
    return;
  }

  currentIdKey = idKey;
  currentNameKey = guessNameKey(currentSheet, baseRow);
  currentRow = mergeDraft(currentSheet, currentId, baseRow);
  renderForm();
}

function selectItem(id){
  currentId = id;
  const { row: baseRow, idKey } = findBaseRow(currentSheet, id);

  // Draft-only new item
  if(!baseRow){
    const all = readDraftAll();
    const k = draftKey(currentSheet, id);
    const d = all[k];
    if(d){
      currentIdKey = PREFERRED_ID_KEYS[currentSheet] || Object.keys(d).find(x=>/Id$/.test(x)) || 'Id';
      currentNameKey = PREFERRED_NAME_KEYS[currentSheet] || Object.keys(d).find(x=>/Name$/.test(x)) || 'Name';
      currentRow = d;
      renderList();
      renderForm();
      setTab('editor');
      return;
    }

    currentRow = null;
    renderForm();
    return;
  }

  currentIdKey = idKey;
  currentNameKey = guessNameKey(currentSheet, baseRow);
  currentRow = mergeDraft(currentSheet, id, baseRow);
  renderList();
  renderForm();

  // Jump to Editor tab when an item is selected.
  setTab('editor');
}

async function loadBundle(){
  setStatus('Loading bundle…');
  const res = await fetch(BUNDLE_URL, { cache: 'no-store' });
  if(!res.ok) throw new Error(`bundle fetch failed: ${res.status}`);
  const data = await res.json();
  bundle = data;
  sheets = Object.keys(bundle || {}).filter(k => Array.isArray(bundle[k]));
  sheets.sort((a,b)=>a.localeCompare(b));
  populateTypeDropdown();
  currentSheet = sheets[0] || null;
  elType.value = currentSheet || '';
  setStatus(`Loaded ${sheets.length} types. Draft changes: ${Object.keys(readDraftAll()).length}`);
  renderList();
}


function openAddModal(){
  if(!currentSheet) return;

  // reset
  addId.value = '';
  addName.value = '';
  addParentSelect.innerHTML = '';
  addParentRow.classList.add('is-hidden');

  // Configure parent selector for relational sheets
  if(currentSheet === 'Subclasses'){
    addParentRow.classList.remove('is-hidden');
    addParentLabel.textContent = 'Parent Class';
    const classes = getRowsForSheet('Classes');
    const idK = guessIdKey('Classes', classes[0] || {}) || 'ClassId';
    const nameK = guessNameKey('Classes', classes[0] || {}) || 'ClassName';
    for(const r of classes){
      const opt = document.createElement('option');
      opt.value = String(r[idK] ?? '').trim();
      opt.textContent = `${String(r[nameK] ?? opt.value).trim()} (${opt.value})`;
      addParentSelect.appendChild(opt);
    }
    addModalHelp.textContent = 'Create a Subclass. Pick the parent Class first.';
  } else if(currentSheet === 'Subraces'){
    addParentRow.classList.remove('is-hidden');
    addParentLabel.textContent = 'Parent Race';
    const races = getRowsForSheet('Races');
    const idK = guessIdKey('Races', races[0] || {}) || 'RaceId';
    const nameK = guessNameKey('Races', races[0] || {}) || 'RaceName';
    for(const r of races){
      const opt = document.createElement('option');
      opt.value = String(r[idK] ?? '').trim();
      opt.textContent = `${String(r[nameK] ?? opt.value).trim()} (${opt.value})`;
      addParentSelect.appendChild(opt);
    }
    addModalHelp.textContent = 'Create a Subrace. Pick the parent Race first.';
  } else {
    addModalHelp.textContent = `Create a new item for ${currentSheet}.`;
  }

  addModal.classList.remove('is-hidden');
  addModal.setAttribute('aria-hidden','false');
  setTimeout(()=> addId.focus(), 0);
}

function closeAddModal(){
  addModal.classList.add('is-hidden');
  addModal.setAttribute('aria-hidden','true');
}

addModalBackdrop.addEventListener('click', closeAddModal);
addModalClose.addEventListener('click', closeAddModal);
addModalCancel.addEventListener('click', closeAddModal);


function addNew(){
  openAddModal();
}

function createFromModal(){
  if(!currentSheet) return;

  const baseRows = getRowsForSheet(currentSheet);
  const sample = baseRows[0] || {};
  const idKey = guessIdKey(currentSheet, sample) || 'Id';
  const nameKey = guessNameKey(currentSheet, sample) || 'Name';

  const newIdRaw = (addId.value || '').trim();
  if(!newIdRaw){ alert('ID is required.'); return; }

  // ensure not exists
  const exists = baseRows.some(r => {
    const k = guessIdKey(currentSheet, r);
    return k && String(r[k]).trim() === newIdRaw;
  });
  if(exists){
    alert('That ID already exists in the bundle. Choose another.');
    return;
  }

  const newNameRaw = (addName.value || '').trim() || newIdRaw;

  const all = readDraftAll();
  const key = draftKey(currentSheet, newIdRaw);

  // Build row patch with correct parent keys for relational sheets
  const patch = {
    [idKey]: newIdRaw,
    [nameKey]: newNameRaw,
  };

  if(currentSheet === 'Subclasses'){
    // IMPORTANT: sheet uses lowercase `classId` (from bundle)
    const parent = String(addParentSelect.value || '').trim();
    if(!parent){ alert('Pick a parent Class.'); return; }
    patch['classId'] = parent;
    // Useful defaults so it looks sane
    if(!('Description' in patch)) patch['Description'] = '';
    if(!('SortOrder' in patch)) patch['SortOrder'] = '';
    if(!('CasterProgression' in patch)) patch['CasterProgression'] = '';
    if(!('Source' in patch)) patch['Source'] = '';
  }

  if(currentSheet === 'Subraces'){
    // IMPORTANT: Subraces uses `RaceId` (uppercase R) per bundle
    const parent = String(addParentSelect.value || '').trim();
    if(!parent){ alert('Pick a parent Race.'); return; }
    patch['RaceId'] = parent;
    if(!('Description' in patch)) patch['Description'] = '';
    if(!('SortOrder' in patch)) patch['SortOrder'] = '';
  }

  all[key] = patch;
  writeDraftAll(all);

  // select it (draft-only)
  currentId = newIdRaw;
  currentIdKey = idKey;
  currentNameKey = nameKey;
  currentRow = all[key];

  setStatus(`Draft created for ${currentSheet} → ${currentId}.`);
  closeAddModal();
  renderList();
  renderForm();
}

addModalCreate.addEventListener('click', createFromModal);

// Enter key submits in modal
addName.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); createFromModal(); }});
addId.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); createFromModal(); }});


function exportDraftTSV(){
  const all = readDraftAll();
  const keys = Object.keys(all);
  if(keys.length === 0){
    alert('No draft changes to export yet.');
    return;
  }

  // simple TSV: Sheet, ID, JSON
  const lines = ['Sheet\tID\tPatchJSON'];
  for (const k of keys){
    const [sheet, id] = k.split('::');
    lines.push(`${sheet}\t${id}\t${JSON.stringify(all[k])}`);
  }

  const tsv = lines.join('\n');
  navigator.clipboard.writeText(tsv).then(
    ()=> setStatus(`Copied TSV for ${keys.length} change(s). Paste into your tracking sheet.`),
    ()=> alert('Clipboard blocked. Copy manually from console.')
  );
}

function saveDraft(){
  // Draft already saved on input. This is just reassurance.
  const count = Object.keys(readDraftAll()).length;
  setStatus(`Draft saved locally. (${count} item(s) changed)`);

  // Apply to builder preview when user explicitly saves.
  applyToPreview();
}

function revertDraft(){
  if(!currentSheet || !currentId) return;
  const all = readDraftAll();
  const k = draftKey(currentSheet, currentId);
  if(!all[k]){ setStatus('Nothing to revert for this item.'); return; }
  if(!confirm('Revert draft changes for this item?')) return;
  delete all[k];
  writeDraftAll(all);
  setStatus(`Reverted. Draft changes: ${Object.keys(all).length}`);
  refreshCurrent();
}

// Events
elType.addEventListener('change', () => {
  currentSheet = elType.value;
  currentId = null;
  currentRow = null;
  elCrumb.textContent = 'Select an item from the left.';
  renderList();
  renderForm();
});

elSearch.addEventListener('input', () => {
  // debounce list rendering
  if(searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(renderList, 120);
});

btnReload.addEventListener('click', async () => {
  try { await loadBundle(); } catch(e){
    console.error(e);
    setStatus('Failed to load bundle. Check console.');
    alert('Failed to load bundle. Check Network tab.');
  }
});

btnAdd.addEventListener('click', addNew);
btnExport.addEventListener('click', exportDraftTSV);
btnSave.addEventListener('click', saveDraft);
btnRevert.addEventListener('click', revertDraft);

// init
loadBundle().catch(e => {
  console.error(e);
  setStatus('Failed to load bundle.');
  alert('Failed to load bundle.');
});