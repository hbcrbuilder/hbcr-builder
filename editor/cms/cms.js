/* HBCR Content Editor (Easy Mode)
   - Reads /api/bundle from Workers
   - Lets you edit a selected row as a draft (localStorage)
   - Shows the REAL builder full-screen behind a popout menu
   - Applies draft overrides to the builder via postMessage (throttled)
*/

const API_BASE = "https://hbcr-api.hbcrbuilder.workers.dev";
const BUNDLE_URL = API_BASE + "/api/bundle";

const DRAFT_KEY = "hbcr_cms_draft_v1";

const $ = (sel) => document.querySelector(sel);

const elType = $("#selType");
const elSearch = $("#inpSearch");
const elList = $("#listItems");
const elForm = $("#form");
const elCrumb = $("#crumb");
const elStatus = $("#cmsStatus");
const btnReload = $("#btnReload");
const btnAdd = $("#btnAdd");
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

function guessIdKey(sheet, row){
  if(!row || typeof row !== 'object') return null;
  const preferred = {
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
  };
  if(preferred[sheet] && row[preferred[sheet]] != null) return preferred[sheet];

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
  const preferred = {
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
  };
  if(preferred[sheet] && row[preferred[sheet]] != null) return preferred[sheet];

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
    if(items.length >= MAX_SHOW) break;
  }

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
      <div class="cms-item-id">${escapeHtml(it.id)}</div>
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
  if(!baseRow) return;
  currentIdKey = idKey;
  currentNameKey = guessNameKey(currentSheet, baseRow);
  currentRow = mergeDraft(currentSheet, currentId, baseRow);
  renderForm();
}

function selectItem(id){
  currentId = id;
  const { row: baseRow, idKey } = findBaseRow(currentSheet, id);
  if(!baseRow){
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

function addNew(){
  if(!currentSheet) return;
  const baseRows = getRowsForSheet(currentSheet);
  const sample = baseRows[0] || {};
  const idKey = guessIdKey(currentSheet, sample) || 'Id';
  const nameKey = guessNameKey(currentSheet, sample) || 'Name';

  const newId = prompt(`New ${currentSheet} ID (must be unique):`);
  if(!newId) return;

  // ensure not exists
  const exists = baseRows.some(r => {
    const k = guessIdKey(currentSheet, r);
    return k && String(r[k]).trim() === String(newId).trim();
  });
  if(exists){
    alert('That ID already exists in the bundle. Choose another.');
    return;
  }

  const newName = prompt('Name (display name):') || String(newId);

  const all = readDraftAll();
  all[draftKey(currentSheet, String(newId).trim())] = {
    [idKey]: String(newId).trim(),
    [nameKey]: String(newName).trim(),
  };
  writeDraftAll(all);

  // select it (draft-only)
  currentId = String(newId).trim();
  currentIdKey = idKey;
  currentNameKey = nameKey;
  currentRow = all[draftKey(currentSheet, currentId)];

  setStatus(`Draft created for ${currentSheet} → ${currentId}.`);
  renderList();
  renderForm();
}

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
