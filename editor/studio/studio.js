/* HBCR Editor Studio
   - Discovers tables from /api/bundle
   - Schema-driven forms stored in localStorage (hbcr_editor_schema_v1)
   - Row changes stored in localStorage (hbcr_editor_changes_v2)
   - Generates TSV ready to paste into Google Sheets

   Design goals:
   - Non-technical maintainer: simple forms, parent refs as dropdowns (show names, store ids)
   - Flexible: you can add fields (slots) without coding via Designer tab
   - Safe: changes stored by primary key map => no duplicates
*/
(function(){
  const SCHEMA_KEY = 'hbcr_editor_schema_v1';
  const CHANGES_KEY = 'hbcr_editor_changes_v2';

  const DEFAULT_HIDDEN = new Set(['Races','Subraces']);
  const BUNDLE_URLS = ['/api/bundle', 'https://hbcr-api.hbcrbuilder.workers.dev/api/bundle'];

  const el = {
    tableList: document.getElementById('tableList'),
    status: document.getElementById('status'),
    viewDesigner: document.getElementById('viewDesigner'),
    viewContent: document.getElementById('viewContent'),
    viewExport: document.getElementById('viewExport'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalSave: document.getElementById('modalSave'),
    btnReset: document.getElementById('btnReset'),
    btnReload: document.getElementById('btnReload'),
  };

  const state = {
    tab: 'designer',
    bundle: null,
    tables: [],
    table: null,
    schema: null,
    changes: null,
    modal: { table:null, pk:null, draft:null },
  };

  const qsa = (s, root=document)=>Array.from(root.querySelectorAll(s));
  const qs = (s, root=document)=>root.querySelector(s);

  function slugify(s){
    return String(s||'')
      .trim()
      .toLowerCase()
      .replace(/[\"']/g,'')
      .replace(/[^a-z0-9]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,64);
  }

  function readJson(key, fallback){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch{ return fallback; }
  }
  function writeJson(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch{}
  }

  async function fetchBundle(){
    let last = null;
    for(const u of BUNDLE_URLS){
      try{
        const r = await fetch(u + '?t=' + Date.now(), {cache:'no-store'});
        if(!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      }catch(e){ last = e; }
    }
    throw last || new Error('bundle fetch failed');
  }

  function bundleRows(table){
    const b = state.bundle || {};
    const v = b[table];
    if(Array.isArray(v)) return v;
    if(v && Array.isArray(v.rows)) return v.rows;
    return [];
  }

  function inferColumns(table, rows){
    const set = new Set();
    for(const r of rows){ if(r && typeof r==='object') Object.keys(r).forEach(k=>set.add(k)); }
    const cols = Array.from(set);
    const pri = [];
    const pkGuess = guessPrimaryKey(table, cols);
    if(pkGuess) pri.push(pkGuess);
    const nameGuess = guessLabelKey(table, cols);
    if(nameGuess) pri.push(nameGuess);
    for(const k of ['ClassId','RaceId','OwnerId','ParentId']) if(cols.includes(k)) pri.push(k);
    const rest = cols.filter(c=>!pri.includes(c)).sort((a,b)=>a.localeCompare(b));
    return [...new Set([...pri, ...rest])].filter(Boolean);
  }

  function guessPrimaryKey(table, cols){
    const known = {
      Classes: 'ClassId',
      Subclasses: 'SubclassId',
      Races: 'RaceId',
      Subraces: 'SubraceId',
      Spells: 'SpellId',
      Cantrips: 'SpellId',
    };
    if(known[table] && cols.includes(known[table])) return known[table];
    const byName = cols.find(c=>c.toLowerCase() === (table.slice(0,-1).toLowerCase() + 'id'));
    if(byName) return byName;
    const anyId = cols.find(c=>/id$/i.test(c));
    return anyId || (cols.includes('Id') ? 'Id' : (cols.includes('id') ? 'id' : null));
  }

  function guessLabelKey(table, cols){
    const known = {
      Classes: 'ClassName',
      Subclasses: 'SubclassName',
      Races: 'RaceName',
      Subraces: 'SubraceName',
    };
    if(known[table] && cols.includes(known[table])) return known[table];
    const anyName = cols.find(c=>/name$/i.test(c));
    if(anyName) return anyName;
    return cols.includes('Name') ? 'Name' : (cols.includes('Label') ? 'Label' : null);
  }

  function ensureSchema(){
    const existing = readJson(SCHEMA_KEY, null);
    if(existing && existing.tables) return existing;

    const schema = { version: 1, tables: {} };
    for(const t of state.tables){
      const rows = bundleRows(t);
      const cols = inferColumns(t, rows);
      const primaryKey = guessPrimaryKey(t, cols) || cols[0] || 'Id';
      const labelKey = guessLabelKey(t, cols) || primaryKey;
      const enabled = !DEFAULT_HIDDEN.has(t) && (t === 'Classes' || t === 'Subclasses');

      const fields = cols.map(c=>({
        key: c,
        label: c,
        type: c===primaryKey ? 'hidden' : 'text',
        required: c===labelKey,
      }));

      if(t === 'Subclasses'){
        const fClass = fields.find(f=>f.key==='ClassId');
        if(fClass){
          fClass.type = 'ref';
          fClass.refTable = 'Classes';
          fClass.refValueKey = 'ClassId';
          fClass.refLabelKey = 'ClassName';
          fClass.required = true;
        }
        const fCP = fields.find(f=>f.key==='CasterProgression');
        if(fCP){
          fCP.type = 'select';
          fCP.options = ['', 'full', 'half', 'third', 'none'];
        }
      }
      if(t === 'Classes'){
        const f = fields.find(x=>x.key==='ClassName');
        if(f) f.required = true;
      }

      schema.tables[t] = { enabled, primaryKey, labelKey, fields };
    }

    writeJson(SCHEMA_KEY, schema);
    return schema;
  }

  function ensureChanges(){
    const existing = readJson(CHANGES_KEY, null);
    if(existing && typeof existing==='object') return existing;
    const changes = { version: 2, tables: {}, meta: { updatedAt: Date.now() } };
    writeJson(CHANGES_KEY, changes);
    return changes;
  }

  function getTableSchema(table){
    return state.schema?.tables?.[table] || null;
  }

  function setStatus(msg){
    el.status.textContent = msg;
  }

  function countChanges(){
    let n = 0;
    for(const t of Object.keys(state.changes?.tables || {})){
      n += Object.keys(state.changes.tables[t] || {}).length;
    }
    return n;
  }

  function mergedRows(table){
    const s = getTableSchema(table);
    const pk = s?.primaryKey;
    const base = bundleRows(table);
    const map = new Map();
    for(const r of base){
      const id = String(r?.[pk] ?? '').trim();
      if(!id) continue;
      map.set(id, r);
    }
    const patches = state.changes?.tables?.[table] || {};
    for(const id of Object.keys(patches)){
      const p = patches[id];
      if(!p) continue;
      const prev = map.get(id) || {};
      map.set(id, { ...prev, ...p, [pk]: id });
    }
    return Array.from(map.values());
  }

  function refOptions(refTable, valueKey, labelKey){
    const rows = mergedRows(refTable);
    const opts = rows
      .map(r=>({ value: String(r?.[valueKey] ?? '').trim(), label: String(r?.[labelKey] ?? r?.[valueKey] ?? '').trim() }))
      .filter(o=>o.value);
    opts.sort((a,b)=>a.label.localeCompare(b.label));
    return opts;
  }

  function autoPrimaryKey(table, draft){
    const s = getTableSchema(table);
    if(!s) return null;
    const pk = s.primaryKey;
    const labelKey = s.labelKey;
    const label = String(draft?.[labelKey] ?? '').trim();
    const existing = String(draft?.[pk] ?? '').trim();
    if(existing) return existing;
    const parentRefField = s.fields.find(f=>f.type==='ref' && /id$/i.test(f.key));
    const parentVal = parentRefField ? String(draft?.[parentRefField.key] ?? '').trim() : '';
    if(parentVal && label) return `${parentVal}_${slugify(label)}`;
    if(label) return slugify(label);
    return null;
  }

  function renderTableList(){
    el.tableList.innerHTML = '';
    for(const t of state.tables){
      const s = getTableSchema(t);
      const enabled = !!s?.enabled;
      const item = document.createElement('div');
      item.className = 'table-item' + (state.table===t ? ' active' : '');
      item.dataset.table = t;
      const left = document.createElement('div');
      left.innerHTML = `<div style="font-weight:700">${escapeHtml(t)}</div><div class="mini" style="color:var(--muted);font-size:12px">${enabled ? 'Enabled in Editor' : 'Hidden (Designer only)'}</div>`;
      const right = document.createElement('div');
      const pill = document.createElement('div');
      pill.className = 'pill ' + (enabled ? 'on' : 'off');
      pill.textContent = enabled ? 'ON' : 'OFF';
      right.appendChild(pill);
      item.appendChild(left);
      item.appendChild(right);
      el.tableList.appendChild(item);
    }
  }

  function showTab(tab){
    state.tab = tab;
    qsa('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
    el.viewDesigner.classList.toggle('hidden', tab!=='designer');
    el.viewContent.classList.toggle('hidden', tab!=='content');
    el.viewExport.classList.toggle('hidden', tab!=='export');
    renderCurrent();
  }

  function renderCurrent(){
    const n = countChanges();
    setStatus(`Bundle loaded. Tables: ${state.tables.length}. Selected: ${state.table || '—'}. Local changes: ${n}.`);
    if(state.tab==='designer') renderDesigner();
    if(state.tab==='content') renderContent();
    if(state.tab==='export') renderExport();
    renderTableList();
  }

  function renderDesigner(){
    const t = state.table;
    if(!t){
      el.viewDesigner.innerHTML = `<div class="card"><h2>Designer</h2><div class="help">Pick a table on the left.</div></div>`;
      return;
    }
    const s = getTableSchema(t);
    const rows = bundleRows(t);
    const cols = inferColumns(t, rows);
    const pk = s.primaryKey;
    const labelKey = s.labelKey;

    const fieldRows = (s.fields || []).map((f, idx)=>{
      const type = f.type || 'text';
      const req = f.required ? 'Yes' : 'No';
      const extra = type==='select' ? (f.options||[]).filter(x=>x!==undefined).join(', ') : (type==='ref' ? `${f.refTable}.${f.refLabelKey} (stores ${f.refValueKey})` : '');
      return `<tr>
        <td>${idx+1}</td>
        <td><div style="font-weight:700">${escapeHtml(f.key)}</div><div class="mini">${escapeHtml(f.label||f.key)}</div></td>
        <td>${escapeHtml(type)}</td>
        <td>${escapeHtml(req)}</td>
        <td class="mini">${escapeHtml(extra)}</td>
        <td class="actions">
          <button class="btn" data-action="editField" data-idx="${idx}">Edit</button>
          <button class="btn" data-action="moveUp" data-idx="${idx}">↑</button>
          <button class="btn" data-action="moveDown" data-idx="${idx}">↓</button>
          <button class="btn danger" data-action="delField" data-idx="${idx}">Delete</button>
        </td>
      </tr>`;
    }).join('');

    el.viewDesigner.innerHTML = `
      <div class="card">
        <h2>Designer — ${escapeHtml(t)}</h2>
        <div class="row">
          <div class="field" style="max-width:260px">
            <label>Enabled in Editor</label>
            <select class="input" id="designerEnabled">
              <option value="1" ${s.enabled?'selected':''}>Enabled (shows in Content + Export)</option>
              <option value="0" ${!s.enabled?'selected':''}>Hidden (Designer only)</option>
            </select>
          </div>
          <div class="field" style="max-width:220px">
            <label>Primary Key Column</label>
            <select class="input" id="designerPk">${cols.map(c=>`<option value="${escapeAttr(c)}" ${c===pk?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>
          </div>
          <div class="field" style="max-width:220px">
            <label>Label Column (shown to humans)</label>
            <select class="input" id="designerLabel">${cols.map(c=>`<option value="${escapeAttr(c)}" ${c===labelKey?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>
          </div>
          <div class="field" style="max-width:220px">
            <label>Quick actions</label>
            <div class="row" style="gap:8px">
              <button class="btn primary" id="btnAddField">+ Add Field</button>
              <button class="btn" id="btnResetTableSchema">Reset Table Schema</button>
            </div>
          </div>
        </div>
        <div class="help" style="margin-top:10px">
          Tip: For dropdowns, use <b>select</b>. For “Parent Class” style dropdowns, use <b>ref</b> (shows names, stores IDs).
        </div>
      </div>

      <div class="card">
        <h2>Fields</h2>
        <table class="grid">
          <thead><tr><th>#</th><th>Field</th><th>Type</th><th>Required</th><th>Details</th><th></th></tr></thead>
          <tbody>${fieldRows || `<tr><td colspan="6" class="mini">No fields yet.</td></tr>`}</tbody>
        </table>
      </div>
    `;

    qs('#designerEnabled', el.viewDesigner).addEventListener('change', (e)=>{
      s.enabled = e.target.value === '1';
      writeJson(SCHEMA_KEY, state.schema);
      renderCurrent();
    });
    qs('#designerPk', el.viewDesigner).addEventListener('change', (e)=>{
      s.primaryKey = e.target.value;
      for(const f of s.fields){ if(f.key===s.primaryKey) f.type = 'hidden'; }
      writeJson(SCHEMA_KEY, state.schema);
      renderCurrent();
    });
    qs('#designerLabel', el.viewDesigner).addEventListener('change', (e)=>{
      s.labelKey = e.target.value;
      for(const f of s.fields){ if(f.key===s.labelKey) f.required = true; }
      writeJson(SCHEMA_KEY, state.schema);
      renderCurrent();
    });

    qs('#btnAddField', el.viewDesigner).addEventListener('click', ()=>openFieldModal(t, null));
    qs('#btnResetTableSchema', el.viewDesigner).addEventListener('click', ()=>{
      if(!confirm('Reset this table schema back to bundle columns?')) return;
      const cols2 = inferColumns(t, bundleRows(t));
      const pk2 = guessPrimaryKey(t, cols2) || cols2[0] || 'Id';
      const lk2 = guessLabelKey(t, cols2) || pk2;
      const fields2 = cols2.map(c=>({ key:c, label:c, type: c===pk2?'hidden':'text', required: c===lk2 }));
      state.schema.tables[t] = { enabled: s.enabled, primaryKey: pk2, labelKey: lk2, fields: fields2 };
      writeJson(SCHEMA_KEY, state.schema);
      renderCurrent();
    });

    el.viewDesigner.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action]');
      if(!btn) return;
      const idx = Number(btn.dataset.idx);
      if(Number.isNaN(idx)) return;
      const action = btn.dataset.action;
      if(action==='editField') return openFieldModal(t, idx);
      if(action==='delField'){
        if(!confirm('Delete this field from the form? (It can be re-added later)')) return;
        s.fields.splice(idx,1);
        writeJson(SCHEMA_KEY, state.schema);
        renderCurrent();
      }
      if(action==='moveUp' && idx>0){
        const tmp = s.fields[idx-1];
        s.fields[idx-1] = s.fields[idx];
        s.fields[idx] = tmp;
        writeJson(SCHEMA_KEY, state.schema);
        renderCurrent();
      }
      if(action==='moveDown' && idx < s.fields.length-1){
        const tmp = s.fields[idx+1];
        s.fields[idx+1] = s.fields[idx];
        s.fields[idx] = tmp;
        writeJson(SCHEMA_KEY, state.schema);
        renderCurrent();
      }
    }, { once:true });
  }

  function openFieldModal(table, idx){
    const s = getTableSchema(table);
    const cols = inferColumns(table, bundleRows(table));
    const isNew = idx===null;
    const f = isNew ? { key:'', label:'', type:'text', required:false } : JSON.parse(JSON.stringify(s.fields[idx]));
    const type = f.type || 'text';

    showModal('Field', `
      <div class="card">
        <h2>${isNew ? 'Add Field' : 'Edit Field'}</h2>
        <div class="row">
          <div class="field">
            <label>Column / Key</label>
            <input class="input" id="fKey" placeholder="e.g. CasterProgression" value="${escapeAttr(f.key)}" list="colList" />
            <datalist id="colList">${cols.map(c=>`<option value="${escapeAttr(c)}">`).join('')}</datalist>
          </div>
          <div class="field">
            <label>Label (shown in form)</label>
            <input class="input" id="fLabel" placeholder="e.g. Caster Progression" value="${escapeAttr(f.label || f.key)}" />
          </div>
        </div>
        <div class="row">
          <div class="field" style="max-width:260px">
            <label>Type</label>
            <select class="input" id="fType">
              ${['text','textarea','number','checkbox','select','ref','hidden'].map(t=>`<option value="${t}" ${t===type?'selected':''}>${t}</option>`).join('')}
            </select>
            <div class="help">Use <b>ref</b> for dropdowns that show names but store an ID.</div>
          </div>
          <div class="field" style="max-width:160px">
            <label>Required</label>
            <select class="input" id="fReq">
              <option value="0" ${!f.required?'selected':''}>No</option>
              <option value="1" ${f.required?'selected':''}>Yes</option>
            </select>
          </div>
        </div>

        <div class="card" style="margin:12px 0 0 0">
          <h2>Type settings</h2>
          <div class="help">Only used for <b>select</b> or <b>ref</b>.</div>
          <div class="row">
            <div class="field">
              <label>Select options (one per line)</label>
              <textarea class="input" id="fOptions" placeholder="full\nhalf\nnone">${escapeHtml((f.options||[]).join('\n'))}</textarea>
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label>Ref table</label>
              <select class="input" id="fRefTable">
                <option value="">(choose)</option>
                ${state.tables.map(t=>`<option value="${escapeAttr(t)}" ${(f.refTable||'')===t?'selected':''}>${escapeHtml(t)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Ref value key (stored)</label>
              <input class="input" id="fRefValue" placeholder="e.g. ClassId" value="${escapeAttr(f.refValueKey||'')}" />
            </div>
            <div class="field">
              <label>Ref label key (shown)</label>
              <input class="input" id="fRefLabel" placeholder="e.g. ClassName" value="${escapeAttr(f.refLabelKey||'')}" />
            </div>
          </div>
        </div>
      </div>
    `, ()=>{
      const key = qs('#fKey', el.modalBody).value.trim();
      if(!key){ alert('Field key is required.'); return false; }
      const label = qs('#fLabel', el.modalBody).value.trim() || key;
      const t = qs('#fType', el.modalBody).value;
      const req = qs('#fReq', el.modalBody).value === '1';
      const options = qs('#fOptions', el.modalBody).value.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>0);
      const refTable = qs('#fRefTable', el.modalBody).value.trim();
      const refValueKey = qs('#fRefValue', el.modalBody).value.trim();
      const refLabelKey = qs('#fRefLabel', el.modalBody).value.trim();

      const newField = { key, label, type:t, required:req };
      if(t==='select') newField.options = [''].concat(options);
      if(t==='ref'){
        if(!refTable || !refValueKey || !refLabelKey){ alert('Ref fields require Ref table, value key, and label key.'); return false; }
        newField.refTable = refTable;
        newField.refValueKey = refValueKey;
        newField.refLabelKey = refLabelKey;
      }
      if(key === s.primaryKey) newField.type = 'hidden';

      if(isNew) s.fields.push(newField);
      else s.fields[idx] = newField;
      writeJson(SCHEMA_KEY, state.schema);
      renderCurrent();
      return true;
    });
  }

  function buildRefMapsForTable(table){
    const s = getTableSchema(table);
    const out = {};
    for(const f of s.fields){
      if(f.type!=='ref') continue;
      const opts = refOptions(f.refTable, f.refValueKey, f.refLabelKey);
      out[f.key] = new Map(opts.map(o=>[o.value, o.label]));
    }
    return out;
  }

  function renderContent(){
    const enabledTables = state.tables.filter(t=>getTableSchema(t)?.enabled);
    const t = state.table && getTableSchema(state.table)?.enabled ? state.table : (enabledTables[0] || null);
    if(!t){
      el.viewContent.innerHTML = `<div class="card"><h2>Content</h2><div class="help">No tables are enabled. Go to Designer and enable the tables you want maintainers to edit.</div></div>`;
      return;
    }
    state.table = t;
    const s = getTableSchema(t);
    const pk = s.primaryKey;
    const labelKey = s.labelKey;

    const rows = mergedRows(t);
    const listCols = [labelKey, pk].filter(Boolean);
    const refCols = s.fields.filter(f=>f.type==='ref').map(f=>f.key);
    for(const rc of refCols){ if(!listCols.includes(rc)) listCols.splice(1,0,rc); }
    const shownCols = listCols.slice(0,4);

    el.viewContent.innerHTML = `
      <div class="card">
        <h2>Content — ${escapeHtml(t)}</h2>
        <div class="row">
          <div class="field" style="max-width:340px">
            <label>Quick search</label>
            <input class="input" id="search" placeholder="search by name/id" />
          </div>
          <div class="field" style="max-width:240px">
            <label>Actions</label>
            <div class="row" style="gap:8px">
              <button class="btn primary" id="btnAddRow">+ Add Row</button>
              <button class="btn" id="btnShowEnabled">Show enabled tables</button>
            </div>
          </div>
        </div>
        <div class="help" style="margin-top:10px">Tip: this saves locally. Use <b>Export</b> to copy TSV and paste into Sheets.</div>
      </div>
      <div class="card">
        <table class="grid" id="grid">
          <thead><tr>${shownCols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}<th></th></tr></thead>
          <tbody id="gridBody"></tbody>
        </table>
      </div>
    `;

    const body = qs('#gridBody', el.viewContent);
    const search = qs('#search', el.viewContent);

    function renderGrid(filter){
      const f = String(filter||'').trim().toLowerCase();
      const refMaps = buildRefMapsForTable(t);
      const filtered = !f ? rows : rows.filter(r=>{
        const a = String(r?.[labelKey] ?? '').toLowerCase();
        const b = String(r?.[pk] ?? '').toLowerCase();
        return a.includes(f) || b.includes(f);
      });
      body.innerHTML = filtered.slice(0,500).map(r=>{
        const id = String(r?.[pk] ?? '').trim();
        const cells = shownCols.map(c=>{
          let v = r?.[c];
          if(refMaps[c] && v!=null && String(v).trim()!=='') v = refMaps[c].get(String(v).trim()) || v;
          return `<td>${escapeHtml(String(v??''))}</td>`;
        }).join('');
        const edited = !!state.changes?.tables?.[t]?.[id];
        return `<tr>${cells}
          <td class="actions">
            <button class="btn" data-action="edit" data-id="${escapeAttr(id)}">${edited ? 'Edit (local)' : 'Edit'}</button>
            <button class="btn danger" data-action="remove" data-id="${escapeAttr(id)}">Remove local</button>
          </td>
        </tr>`;
      }).join('') || `<tr><td colspan="${shownCols.length+1}" class="mini">No rows.</td></tr>`;
    }

    renderGrid('');
    search.addEventListener('input', ()=>renderGrid(search.value));

    qs('#btnAddRow', el.viewContent).addEventListener('click', ()=>openRowModal(t, null));
    qs('#btnShowEnabled', el.viewContent).addEventListener('click', ()=>{
      alert('Enabled tables:\n\n' + enabledTables.join('\n'));
    });

    el.viewContent.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action]');
      if(!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if(!id) return;
      if(action==='edit') return openRowModal(t, id);
      if(action==='remove'){
        if(!confirm('Remove local changes for this row? (Bundle baseline remains)')) return;
        const tableMap = state.changes.tables[t] || {};
        delete tableMap[id];
        state.changes.tables[t] = tableMap;
        state.changes.meta.updatedAt = Date.now();
        writeJson(CHANGES_KEY, state.changes);
        renderCurrent();
      }
    });
  }

  function readDraftFromModal(){
    const d = { ...(state.modal.draft||{}) };
    qsa('[data-key]', el.modalBody).forEach(inp=>{
      d[inp.dataset.key] = inp.value;
    });
    return d;
  }

  function openRowModal(table, id){
    const s = getTableSchema(table);
    const pk = s.primaryKey;
    const base = id ? (mergedRows(table).find(r=>String(r?.[pk]??'').trim()===id) || {}) : {};
    const patch = id ? (state.changes?.tables?.[table]?.[id] || {}) : {};
    const draft = { ...base, ...patch };
    state.modal = { table, pk: id || null, draft };

    const fields = s.fields.filter(f=>f.type!=='hidden');
    const refOpts = {};
    for(const f of fields){
      if(f.type==='ref') refOpts[f.key] = refOptions(f.refTable, f.refValueKey, f.refLabelKey);
    }

    const formHtml = fields.map(f=>{
      const key = f.key;
      const label = f.label || key;
      const required = f.required ? ' <span style="color:var(--danger)">*</span>' : '';
      const value = draft[key];
      if(f.type==='textarea'){
        return `<div class="field"><label>${escapeHtml(label)}${required}</label><textarea class="input" data-key="${escapeAttr(key)}">${escapeHtml(String(value??''))}</textarea></div>`;
      }
      if(f.type==='number'){
        return `<div class="field"><label>${escapeHtml(label)}${required}</label><input class="input" type="number" data-key="${escapeAttr(key)}" value="${escapeAttr(String(value??''))}" /></div>`;
      }
      if(f.type==='checkbox'){
        const checked = String(value).toLowerCase()==='true' || value===1 || value==='1';
        return `<div class="field"><label>${escapeHtml(label)}${required}</label><select class="input" data-key="${escapeAttr(key)}"><option value="">(blank)</option><option value="1" ${checked?'selected':''}>Yes</option><option value="0" ${(!checked && value!=null && value!=='')?'selected':''}>No</option></select></div>`;
      }
      if(f.type==='select'){
        const opts = (f.options || ['']).map(o=>String(o));
        const cur = String(value??'');
        return `<div class="field"><label>${escapeHtml(label)}${required}</label><select class="input" data-key="${escapeAttr(key)}">${opts.map(o=>`<option value="${escapeAttr(o)}" ${o===cur?'selected':''}>${escapeHtml(o||'(blank)')}</option>`).join('')}</select></div>`;
      }
      if(f.type==='ref'){
        const cur = String(value??'');
        const opts = refOpts[key] || [];
        return `<div class="field"><label>${escapeHtml(label)}${required}</label><select class="input" data-key="${escapeAttr(key)}"><option value="">(choose)</option>${opts.map(o=>`<option value="${escapeAttr(o.value)}" ${o.value===cur?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select></div>`;
      }
      return `<div class="field"><label>${escapeHtml(label)}${required}</label><input class="input" data-key="${escapeAttr(key)}" value="${escapeAttr(String(value??''))}" /></div>`;
    }).join('');

    const pkAuto = autoPrimaryKey(table, draft) || '';
    const pkLine = `
      <div class="card">
        <h2>Row ID</h2>
        <div class="kvs">
          <div class="k">Primary key</div><div class="v"><b>${escapeHtml(pk)}</b></div>
          <div class="k">Value</div><div class="v"><code id="pkPreview">${escapeHtml(id || pkAuto || '(auto)')}</code></div>
        </div>
        <div class="help">ID is auto-generated from the name (and parent if present).</div>
      </div>`;

    showModal(`${id ? 'Edit' : 'Add'} — ${table}`, `${pkLine}<div class="card"><h2>Fields</h2><div class="row">${formHtml}</div></div>`, saveRowFromModal);

    el.modalBody.addEventListener('input', ()=>{
      const d = readDraftFromModal();
      const gen = autoPrimaryKey(table, d);
      const pkNode = qs('#pkPreview', el.modalBody);
      if(pkNode && !id) pkNode.textContent = gen || '(auto)';
    }, { once:true });
  }

  function saveRowFromModal(){
    const table = state.modal.table;
    const s = getTableSchema(table);
    const pk = s.primaryKey;
    const draft = readDraftFromModal();

    for(const f of s.fields){
      if(!f.required) continue;
      const v = String(draft?.[f.key] ?? '').trim();
      if(!v){ alert(`Missing required field: ${f.label || f.key}`); return false; }
    }

    let id = String(draft?.[pk] ?? '').trim();
    if(!id) id = autoPrimaryKey(table, draft) || '';
    if(!id){ alert('Unable to generate an ID. Fill the name field first.'); return false; }

    if(!state.changes.tables[table]) state.changes.tables[table] = {};
    draft[pk] = id;
    state.changes.tables[table][id] = draft;
    state.changes.meta.updatedAt = Date.now();
    writeJson(CHANGES_KEY, state.changes);
    closeModal();
    renderCurrent();
    return true;
  }

  function renderExport(){
    const enabled = state.tables.filter(t=>getTableSchema(t)?.enabled);
    const n = countChanges();
    el.viewExport.innerHTML = `
      <div class="card">
        <h2>Export TSV</h2>
        <div class="help">Copy TSV and paste into Google Sheets. Only local changes are exported.</div>
        <div class="help" style="margin-top:8px">Local changes: <b>${n}</b></div>
      </div>
      <div class="card">
        <h2>Enabled tables</h2>
        <div class="row" style="gap:8px">
          ${enabled.map(t=>`<button class="btn primary" data-action="copyOne" data-table="${escapeAttr(t)}">Copy ${escapeHtml(t)} TSV</button>`).join('')}
          ${enabled.length ? `<button class="btn ok" data-action="copyAll">Copy ALL TSV</button>` : ''}
        </div>
        <div class="help" style="margin-top:10px">Copy → paste into Sheets. Each block includes a header row.</div>
      </div>
      <div class="card">
        <h2>Note</h2>
        <div class="help">Studio does not inject data into the builder (avoids duplicates). It only generates TSV for Sheets.</div>
      </div>
    `;

    el.viewExport.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button[data-action]');
      if(!btn) return;
      const action = btn.dataset.action;
      if(action==='copyOne'){
        const t = btn.dataset.table;
        const txt = tsvForTable(t);
        await copyText(txt);
        alert(`Copied ${t} TSV (${txt.split('\n').length-1} row(s)).`);
      }
      if(action==='copyAll'){
        const blocks = enabled.map(t=>`# ${t}\n${tsvForTable(t)}`).join('\n\n');
        await copyText(blocks);
        alert('Copied ALL TSV blocks.');
      }
    }, { once:true });
  }

  function tsvEscape(v){
    return String(v ?? '').replace(/\t/g,' ').replace(/\r?\n/g,' ').trim();
  }

  function tsvForTable(table){
    const s = getTableSchema(table);
    const cols = (s.fields || []).map(f=>f.key);
    const pk = s.primaryKey;
    if(!cols.includes(pk)) cols.unshift(pk);
    const patches = state.changes?.tables?.[table] || {};
    const rows = Object.keys(patches).map(id=>({ ...patches[id], [pk]: id }));
    const header = cols.join('\t');
    const lines = rows.map(r=>cols.map(c=>tsvEscape(r?.[c])).join('\t'));
    return [header, ...lines].join('\n');
  }

  function showModal(title, html, onSave){
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = html;
    el.modal.classList.remove('hidden');
    el.modalSave.onclick = ()=>{ if(onSave) onSave(); };
  }
  function closeModal(){
    el.modal.classList.add('hidden');
    el.modalBody.innerHTML = '';
    el.modalSave.onclick = null;
  }

  async function copyText(text){
    try{ await navigator.clipboard.writeText(text); }
    catch{
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  function escapeHtml(s){
    return String(s??'').replace(/[&<>"']/g, c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s){
    return escapeHtml(s).replace(/\n/g,' ');
  }

  document.addEventListener('click', (e)=>{
    const closeBtn = e.target.closest('[data-action="close"]');
    if(closeBtn) closeModal();
    const tableItem = e.target.closest('.table-item');
    if(tableItem){
      state.table = tableItem.dataset.table;
      renderCurrent();
    }
    const tabBtn = e.target.closest('.tab');
    if(tabBtn) showTab(tabBtn.dataset.tab);
  });

  el.btnReset.addEventListener('click', ()=>{
    if(!confirm('Reset local schema + local changes?')) return;
    localStorage.removeItem(SCHEMA_KEY);
    localStorage.removeItem(CHANGES_KEY);
    state.schema = null;
    state.changes = null;
    boot();
  });
  el.btnReload.addEventListener('click', ()=>boot());

  async function boot(){
    setStatus('Loading bundle…');
    try{
      state.bundle = await fetchBundle();
      state.tables = Object.keys(state.bundle || {})
        .filter(k=>!k.startsWith('_'))
        .filter(k=>{
          const v = state.bundle[k];
          return Array.isArray(v) || (v && Array.isArray(v.rows));
        })
        .sort((a,b)=>a.localeCompare(b));

      state.schema = ensureSchema();
      state.changes = ensureChanges();

      if(!state.table){
        state.table = 'Subclasses';
        if(!state.tables.includes(state.table)) state.table = state.tables[0] || null;
      }
      renderCurrent();
    }catch(err){
      console.error(err);
      setStatus('Failed to load bundle. ' + (err?.message || String(err)));
      el.viewDesigner.innerHTML = `<div class="card"><h2>Error</h2><div class="help">${escapeHtml(err?.message || String(err))}</div></div>`;
      el.viewContent.innerHTML = '';
      el.viewExport.innerHTML = '';
    }
  }

  boot();
})();
