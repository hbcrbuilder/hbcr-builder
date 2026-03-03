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
const btnExportPatch = $("#btnExportPatch");
const btnExportRows = $("#btnExportRows");
const btnClearDrafts = $("#btnClearDrafts");
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

let iconManifest = null; // { icons: ["/assets/icons/...png", ...] }

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

async function loadIconManifest(){
  try{
    const res = await fetch('/editor/cms/icon_manifest.json', { cache:'force-cache' });
    if(!res.ok) return null;
    const j = await res.json();
    if(j && Array.isArray(j.icons)) return j;
  }catch{}
  return null;
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

function tsvEscape(v){
  // Google Sheets paste-friendly
  return safeStr(v).replace(/\t/g,' ').replace(/\r?\n/g,'\\n');
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

function addNew(){
  if(!currentSheet) return;
  if(currentSheet === 'Subclasses') return openAddSubclassWizard();
  if(currentSheet === 'Subraces') return openAddSubraceWizard();
  return openAddGenericWizard();
}

function exportPatchTSV(){
  const all = readDraftAll();
  const keys = Object.keys(all);
  if(keys.length === 0){
    alert('No draft changes to export yet.');
    return;
  }

  const lines = ['Sheet\tIdKey\tId\tField\tValue'];
  for(const k of keys){
    const [sheet, id] = k.split('::');
    const patch = all[k] || {};
    // Determine idKey from bundle sample or preferred
    const sample = getRowsForSheet(sheet)[0] || patch;
    const idKey = guessIdKey(sheet, sample) || PREFERRED_ID_KEYS[sheet] || 'Id';
    for(const field of Object.keys(patch)){
      lines.push(`${sheet}\t${idKey}\t${id}\t${field}\t${tsvEscape(patch[field])}`);
    }
  }

  const tsv = lines.join('\n');
  navigator.clipboard.writeText(tsv).then(
    ()=> setStatus(`Copied Patch TSV for ${keys.length} item(s). Paste into Google Sheets (or your patch tab).`),
    ()=> alert('Clipboard blocked. Copy manually from console.')
  );
}

function exportRowsTSVForCurrentType(){
  if(!currentSheet){ alert('Pick a Type first.'); return; }
  const all = readDraftAll();
  const ids = Object.keys(all)
    .filter(k => k.startsWith(currentSheet + '::'))
    .map(k => k.slice((currentSheet+'::').length));

  if(ids.length === 0){
    alert(`No draft changes for ${currentSheet}.`);
    return;
  }

  const baseRows = getRowsForSheet(currentSheet);
  const sample = baseRows[0] || (all[draftKey(currentSheet, ids[0])] || {});
  const idKey = guessIdKey(currentSheet, sample) || PREFERRED_ID_KEYS[currentSheet] || 'Id';
  const nameKey = guessNameKey(currentSheet, sample) || PREFERRED_NAME_KEYS[currentSheet] || null;

  // Column order: sample keys first, then any extra keys from patches
  const cols = [...Object.keys(sample)];
  const extra = new Set();
  for(const id of ids){
    const patch = all[draftKey(currentSheet, id)] || {};
    Object.keys(patch).forEach(k => { if(!cols.includes(k)) extra.add(k); });
  }
  const extraCols = Array.from(extra).sort((a,b)=>a.localeCompare(b));
  const headers = cols.concat(extraCols);

  // Ensure idKey and nameKey included early
  if(!headers.includes(idKey)) headers.unshift(idKey);
  if(nameKey && !headers.includes(nameKey)) headers.splice(1,0,nameKey);

  const lines = [headers.join('\t')];
  for(const id of ids){
    const { row: baseRow } = findBaseRow(currentSheet, id);
    const patch = all[draftKey(currentSheet, id)] || {};
    const merged = { ...(baseRow || {}), ...patch };
    merged[idKey] = merged[idKey] ?? id;
    const rowVals = headers.map(h => tsvEscape(merged[h] ?? ''));
    lines.push(rowVals.join('\t'));
  }

  const tsv = lines.join('\n');
  navigator.clipboard.writeText(tsv).then(
    ()=> setStatus(`Copied Rows TSV for ${currentSheet} (${ids.length} row(s)). Paste into that sheet tab.`),
    ()=> alert('Clipboard blocked. Copy manually from console.')
  );
}

function clearDrafts(){
  if(!confirm('Clear ALL local drafts? This only affects your browser.')) return;
  writeDraftAll({});
  currentId = null;
  currentRow = null;
  elCrumb.textContent = 'Select an item from the Library.';
  renderList();
  renderForm();
  setStatus('Cleared drafts.');
  applyToPreview();
}

function makeModal(title, bodyEl){
  const overlay = document.createElement('div');
  overlay.className = 'cms-modal-overlay';
  overlay.innerHTML = `
    <div class="cms-modal">
      <div class="cms-modal-h">${escapeHtml(title)}</div>
      <div class="cms-modal-b"></div>
      <div class="cms-modal-actions">
        <button class="btn" data-act="cancel" type="button">Cancel</button>
        <button class="btn" data-act="ok" type="button">Create</button>
      </div>
    </div>
  `;
  overlay.querySelector('.cms-modal-b').appendChild(bodyEl);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e)=>{
    if(e.target === overlay) close();
  });
  return { overlay, close, okBtn: overlay.querySelector('[data-act="ok"]'), cancelBtn: overlay.querySelector('[data-act="cancel"]') };
}

function buildIconPicker(initial){
  const wrap = document.createElement('div');
  wrap.className = 'cms-field';
  const lab = document.createElement('label');
  lab.textContent = 'Icon (optional)';
  const inp = document.createElement('input');
  inp.value = initial || '';
  inp.placeholder = 'Pick an icon path…';

  // datalist
  const dl = document.createElement('datalist');
  dl.id = 'cmsIconList';
  const icons = iconManifest?.icons || [];
  for(const p of icons.slice(0, 800)){
    const opt = document.createElement('option');
    opt.value = p;
    dl.appendChild(opt);
  }
  inp.setAttribute('list', dl.id);
  wrap.appendChild(lab);
  wrap.appendChild(inp);
  wrap.appendChild(dl);
  return { wrap, input: inp };
}

function openAddGenericWizard(){
  const sheet = currentSheet;
  const baseRows = getRowsForSheet(sheet);
  const sample = baseRows[0] || {};
  const idKey = guessIdKey(sheet, sample) || 'Id';
  const nameKey = guessNameKey(sheet, sample) || 'Name';

  const body = document.createElement('div');
  const fId = fieldInput('ID (unique)', '', ()=>{});
  const fName = fieldInput('Name', '', ()=>{});
  // pull the actual inputs
  const idInp = fId.querySelector('input');
  const nameInp = fName.querySelector('input');
  body.appendChild(fId);
  body.appendChild(fName);
  const iconPick = buildIconPicker('');
  body.appendChild(iconPick.wrap);

  const { close, okBtn, cancelBtn } = makeModal(`Add New ${sheet}`, body);
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', ()=>{
    const newId = idInp.value.trim();
    if(!newId){ alert('ID is required.'); return; }
    const exists = baseRows.some(r => {
      const k = guessIdKey(sheet, r);
      return k && String(r[k]).trim() === newId;
    });
    if(exists){ alert('That ID already exists. Choose another.'); return; }
    const newName = (nameInp.value.trim() || newId);
    const all = readDraftAll();
    const patch = { [idKey]: newId, [nameKey]: newName };
    // icon field if any exists in sample
    const iconKey = ['Icon','IconPath','icon','iconPath'].find(k=> sample[k] != null) || 'Icon';
    if(iconPick.input.value.trim()) patch[iconKey] = iconPick.input.value.trim();
    all[draftKey(sheet, newId)] = patch;
    writeDraftAll(all);
    close();
    currentId = newId; currentIdKey = idKey; currentNameKey = nameKey; currentRow = patch;
    setStatus(`Draft created for ${sheet} → ${newId}.`);
    renderList();
    renderForm();
    setTab('editor');
  });
}

function openAddSubclassWizard(){
  const sheet = 'Subclasses';
  const baseRows = getRowsForSheet(sheet);
  const sample = baseRows[0] || {};
  const idKey = guessIdKey(sheet, sample) || 'SubclassId';
  const nameKey = guessNameKey(sheet, sample) || 'SubclassName';

  const classes = getRowsForSheet('Classes');
  const classSample = classes[0] || {};
  const classIdKey = guessIdKey('Classes', classSample) || 'ClassId';
  const classNameKey = guessNameKey('Classes', classSample) || 'ClassName';
  const classOptions = classes
    .map(r => ({ id: safeStr(r[classIdKey]).trim(), name: safeStr(r[classNameKey]).trim() }))
    .filter(x => x.id)
    .sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id));

  const parentKey = ['ClassId','ParentClassId','BaseClassId'].find(k=> sample[k] != null) || 'ClassId';

  const body = document.createElement('div');

  // Parent dropdown
  const parentWrap = document.createElement('div');
  parentWrap.className = 'cms-field';
  parentWrap.innerHTML = '<label>Parent Class</label>';
  const sel = document.createElement('select');
  sel.className = 'cms-select';
  sel.innerHTML = '<option value="">Select a class…</option>';
  for(const o of classOptions){
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name ? `${o.name} (${o.id})` : o.id;
    sel.appendChild(opt);
  }
  parentWrap.appendChild(sel);
  body.appendChild(parentWrap);

  const fId = fieldInput('Subclass ID (unique)', '', ()=>{});
  const fName = fieldInput('Subclass Name', '', ()=>{});
  const idInp = fId.querySelector('input');
  const nameInp = fName.querySelector('input');
  body.appendChild(fId);
  body.appendChild(fName);
  const iconPick = buildIconPicker('');
  body.appendChild(iconPick.wrap);

  const { close, okBtn, cancelBtn } = makeModal('Add New Subclass', body);
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', ()=>{
    const parentId = sel.value.trim();
    if(!parentId){ alert('Pick a Parent Class.'); return; }
    const newId = idInp.value.trim();
    if(!newId){ alert('Subclass ID is required.'); return; }
    const exists = baseRows.some(r => {
      const k = guessIdKey(sheet, r);
      return k && String(r[k]).trim() === newId;
    });
    if(exists){ alert('That Subclass ID already exists.'); return; }
    const newName = (nameInp.value.trim() || newId);
    const patch = { [idKey]: newId, [nameKey]: newName, [parentKey]: parentId };
    const iconKey = ['Icon','IconPath','icon','iconPath'].find(k=> sample[k] != null) || 'Icon';
    if(iconPick.input.value.trim()) patch[iconKey] = iconPick.input.value.trim();
    const all = readDraftAll();
    all[draftKey(sheet, newId)] = patch;
    writeDraftAll(all);
    close();
    currentSheet = sheet;
    elType.value = sheet;
    currentId = newId; currentIdKey = idKey; currentNameKey = nameKey; currentRow = patch;
    setStatus(`Draft created for Subclasses → ${newId} (parent ${parentId}).`);
    renderList();
    renderForm();
    setTab('editor');
  });
}

function openAddSubraceWizard(){
  const sheet = 'Subraces';
  const baseRows = getRowsForSheet(sheet);
  const sample = baseRows[0] || {};
  const idKey = guessIdKey(sheet, sample) || 'SubraceId';
  const nameKey = guessNameKey(sheet, sample) || 'SubraceName';

  const races = getRowsForSheet('Races');
  const raceSample = races[0] || {};
  const raceIdKey = guessIdKey('Races', raceSample) || 'RaceId';
  const raceNameKey = guessNameKey('Races', raceSample) || 'RaceName';
  const raceOptions = races
    .map(r => ({ id: safeStr(r[raceIdKey]).trim(), name: safeStr(r[raceNameKey]).trim() }))
    .filter(x => x.id)
    .sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id));

  const parentKey = ['RaceId','ParentRaceId','BaseRaceId'].find(k=> sample[k] != null) || 'RaceId';

  const body = document.createElement('div');
  const parentWrap = document.createElement('div');
  parentWrap.className = 'cms-field';
  parentWrap.innerHTML = '<label>Parent Race</label>';
  const sel = document.createElement('select');
  sel.className = 'cms-select';
  sel.innerHTML = '<option value="">Select a race…</option>';
  for(const o of raceOptions){
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name ? `${o.name} (${o.id})` : o.id;
    sel.appendChild(opt);
  }
  parentWrap.appendChild(sel);
  body.appendChild(parentWrap);

  const fId = fieldInput('Subrace ID (unique)', '', ()=>{});
  const fName = fieldInput('Subrace Name', '', ()=>{});
  const idInp = fId.querySelector('input');
  const nameInp = fName.querySelector('input');
  body.appendChild(fId);
  body.appendChild(fName);
  const iconPick = buildIconPicker('');
  body.appendChild(iconPick.wrap);

  const { close, okBtn, cancelBtn } = makeModal('Add New Subrace', body);
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', ()=>{
    const parentId = sel.value.trim();
    if(!parentId){ alert('Pick a Parent Race.'); return; }
    const newId = idInp.value.trim();
    if(!newId){ alert('Subrace ID is required.'); return; }
    const exists = baseRows.some(r => {
      const k = guessIdKey(sheet, r);
      return k && String(r[k]).trim() === newId;
    });
    if(exists){ alert('That Subrace ID already exists.'); return; }
    const newName = (nameInp.value.trim() || newId);
    const patch = { [idKey]: newId, [nameKey]: newName, [parentKey]: parentId };
    const iconKey = ['Icon','IconPath','icon','iconPath'].find(k=> sample[k] != null) || 'Icon';
    if(iconPick.input.value.trim()) patch[iconKey] = iconPick.input.value.trim();
    const all = readDraftAll();
    all[draftKey(sheet, newId)] = patch;
    writeDraftAll(all);
    close();
    currentSheet = sheet;
    elType.value = sheet;
    currentId = newId; currentIdKey = idKey; currentNameKey = nameKey; currentRow = patch;
    setStatus(`Draft created for Subraces → ${newId} (parent ${parentId}).`);
    renderList();
    renderForm();
    setTab('editor');
  });
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
btnExportPatch.addEventListener('click', exportPatchTSV);
btnExportRows.addEventListener('click', exportRowsTSVForCurrentType);
btnClearDrafts.addEventListener('click', clearDrafts);
btnSave.addEventListener('click', saveDraft);
btnRevert.addEventListener('click', revertDraft);

// init
// init
(async ()=>{
  iconManifest = await loadIconManifest();
  await loadBundle();
})().catch(e => {
  console.error(e);
  setStatus('Failed to load bundle.');
  alert('Failed to load bundle.');
});
