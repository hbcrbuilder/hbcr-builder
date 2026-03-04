/* HBCR Content Manager (Non-technical Editor)
   - Reads baseline from /api/bundle
   - Stores changes locally (hbcr_editor_changes_v1)
   - Optional live preview overlay via hbcr_cms_draft_v3 + ?cmsPreview=1
*/
(function(){
  const SHEETS = ["Races","Subraces","Classes","Subclasses"];
  const PATH_TO_SHEET = {
    "/editor/races": "Races",
    "/editor/subraces": "Subraces",
    "/editor/classes": "Classes",
    "/editor/subclasses": "Subclasses",
    "/editor/export": "Export",
  };

  // Storage keys (shared with existing preview system in src/data/liveData.js)
  const CHANGES_KEY = "hbcr_editor_changes_v1";       // our map-by-id change store
  const CMS_DRAFT_KEY = "hbcr_cms_draft_v3";          // consumed by builder when ?cmsPreview=1 + apply=1
  const CMS_APPLY_KEY = "hbcr_cms_apply_preview";     // consumed by builder

  const PREVIEW_URL = "/?cmsPreview=1"; // builder root with cmsPreview enabled

  const state = {
    page: "Races",
    bundle: null,
    columns: {},  // per sheet: [col,...]
    meta: {},     // per sheet: {idKey,parentKey,nameKey,descKey,iconKey}
    changes: null,
    previewOn: false,
  };

  // ---------------- helpers ----------------
  const qs = (sel, el=document) => el.querySelector(sel);
  const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  function slugify(s){
    return String(s||"")
      .trim()
      .toLowerCase()
      .replace(/['"]/g,"")
      .replace(/[^a-z0-9]+/g,"_")
      .replace(/^_+|_+$/g,"")
      .slice(0,64);
  }

  function readJson(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch{ return fallback; }
  }
  function writeJson(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch{}
  }

  function ensureChanges(){
    const base = readJson(CHANGES_KEY, null);
    if(base && typeof base === "object") return base;
    const init = { Races:{}, Subraces:{}, Classes:{}, Subclasses:{}, meta:{updatedAt:Date.now()} };
    writeJson(CHANGES_KEY, init);
    return init;
  }

  async function fetchBundle(){
    // Use relative path (Pages may proxy), fall back to Worker absolute if needed.
    const candidates = ["/api/bundle", "https://hbcr-api.hbcrbuilder.workers.dev/api/bundle"];
    let lastErr = null;
    for(const url of candidates){
      try{
        const res = await fetch(url + "?t=" + Date.now(), {cache:"no-store"});
        if(!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
      }catch(e){ lastErr = e; }
    }
    throw lastErr || new Error("Bundle fetch failed");
  }

  function inferColumns(sheet, rows){
    const set = new Set();
    for(const r of (rows||[])){
      if(r && typeof r === "object"){
        Object.keys(r).forEach(k=>set.add(k));
      }
    }
    // Prefer stable ordering: id, name, parent, then rest alpha
    const meta = inferMeta(sheet, Array.from(set));
    const priority = [meta.idKey, meta.nameKey, meta.parentKey, meta.descKey, meta.iconKey].filter(Boolean);
    const rest = Array.from(set).filter(k=>!priority.includes(k)).sort((a,b)=>a.localeCompare(b));
    return [...priority, ...rest].filter((v,i,a)=>v && a.indexOf(v)===i);
  }

  function inferMeta(sheet, keys){
    const has = (k)=>keys.includes(k);
    const pick = (...cands)=>cands.find(c=>c && has(c)) || null;

    let idKey = null, parentKey = null;
    if(sheet==="Races") idKey = pick("RaceId","raceId","Id","id");
    if(sheet==="Subraces") idKey = pick("SubraceId","subraceId","Id","id");
    if(sheet==="Classes") idKey = pick("ClassId","classId","Id","id");
    if(sheet==="Subclasses") idKey = pick("SubclassId","subclassId","Id","id");

    if(sheet==="Subraces") parentKey = pick("RaceId","raceId","ParentRaceId","parentRaceId");
    if(sheet==="Subclasses") parentKey = pick("ClassId","classId","ParentClassId","parentClassId");
    // Races/Classes have no parent
    const nameKey = pick("Name", sheet.slice(0,-1)+"Name", "RaceName","SubraceName","ClassName","SubclassName","Label","Title") || "Name";
    const descKey = pick("Description","Desc","desc","Text","text");
    const iconKey = pick("Icon","icon","IconUrl","iconUrl","IconPath","iconPath","Image","image");

    // Canonical keys (we write these on save)
    const canonical = {
      Races: { idKey:"RaceId", nameKey, descKey, iconKey },
      Subraces: { idKey:"SubraceId", parentKey:"RaceId", nameKey, descKey, iconKey },
      Classes: { idKey:"ClassId", nameKey, descKey, iconKey },
      Subclasses: { idKey:"SubclassId", parentKey:"ClassId", nameKey, descKey, iconKey },
    };
    return canonical[sheet] || {idKey, parentKey, nameKey, descKey, iconKey};
  }

  function readBaselineRows(sheet){
    const b = state.bundle || {};
    const v = b[sheet];
    if(Array.isArray(v)) return v;
    if(v && Array.isArray(v.rows)) return v.rows;
    return [];
  }

  function mergedRows(sheet){
    const base = readBaselineRows(sheet);
    const meta = state.meta[sheet];
    const idKey = meta.idKey;
    const norm = (x)=>String(x??"").trim();

    const map = new Map();
    for(const r of base){
      const id = norm(r?.[idKey] ?? r?.id ?? r?.Id);
      if(!id) continue;
      map.set(id, r);
    }
    const edits = state.changes?.[sheet] || {};
    for(const id of Object.keys(edits)){
      const patch = edits[id];
      if(!patch) continue;
      const prev = map.get(id) || {};
      map.set(id, {...prev, ...patch, [idKey]: id});
    }
    return Array.from(map.values());
  }

  function changedCount(){
    let n = 0;
    for(const s of SHEETS){
      n += Object.keys(state.changes?.[s] || {}).length;
    }
    return n;
  }

  function setPreviewOn(on){
    state.previewOn = !!on;
    localStorage.setItem(CMS_APPLY_KEY, state.previewOn ? "1" : "0");
    // When turning off, we keep draft, but builder won't apply.
    renderPreviewBar();
    refreshIframe();
  }

  function updateCmsDraftForAllChanges(){
    const draft = readJson(CMS_DRAFT_KEY, {}) || {};
    // Remove existing draft entries for our managed sheets, then re-add from changes.
    for(const k of Object.keys(draft)){
      const [sheet] = String(k).split("::");
      if(SHEETS.includes(sheet)) delete draft[k];
    }
    for(const sheet of SHEETS){
      const meta = state.meta[sheet];
      const idKey = meta.idKey;
      const rows = state.changes?.[sheet] || {};
      for(const id of Object.keys(rows)){
        const row = rows[id];
        if(!row) continue;
        draft[`${sheet}::${id}`] = { ...row, [idKey]: id };
      }
    }
    writeJson(CMS_DRAFT_KEY, draft);
  }

  function clearLocal(){
    localStorage.removeItem(CHANGES_KEY);
    // Clear ONLY cms draft + apply keys (prevents ghosts)
    localStorage.removeItem(CMS_DRAFT_KEY);
    localStorage.removeItem(CMS_APPLY_KEY);
    state.changes = ensureChanges();
    state.previewOn = false;
    renderAll();
    refreshIframe();
  }

  function tsvEscape(v){
    const s = String(v ?? "");
    // TSV: replace newlines/tabs with spaces
    return s.replace(/\t/g," ").replace(/\r?\n/g," ").trim();
  }

  function buildTSV(sheet){
    const cols = state.columns[sheet] || [];
    const rowsMap = state.changes?.[sheet] || {};
    const ids = Object.keys(rowsMap);
    if(!ids.length) return "";
    const lines = [];
    lines.push(cols.join("\t"));
    for(const id of ids){
      const row = rowsMap[id] || {};
      const meta = state.meta[sheet];
      const outRow = { ...row, [meta.idKey]: id };
      lines.push(cols.map(c => tsvEscape(outRow[c])).join("\t"));
    }
    return lines.join("\n");
  }

  // ---------------- UI ----------------
  function routeToPage(){
    const p = location.pathname.replace(/\/+$/,"");
    // Find best match
    for(const [path, page] of Object.entries(PATH_TO_SHEET)){
      if(p === path) return page;
    }
    // Directory index case: /editor/races/
    for(const [path, page] of Object.entries(PATH_TO_SHEET)){
      if(p === path + "/") return page;
    }
    return "Races";
  }

  function setActiveTab(){
    qsa(".tab").forEach(t=>{
      const v = t.getAttribute("data-page");
      t.classList.toggle("active", v === state.page);
    });
  }

  function renderNav(){
    const nav = qs("#nav");
    nav.innerHTML = "";
    const items = [
      {page:"Races", href:"/editor/races/"},
      {page:"Subraces", href:"/editor/subraces/"},
      {page:"Classes", href:"/editor/classes/"},
      {page:"Subclasses", href:"/editor/subclasses/"},
      {page:"Export", href:"/editor/export/"},
    ];
    for(const it of items){
      const a = document.createElement("a");
      a.className = "tab";
      a.textContent = it.page;
      a.href = it.href;
      a.setAttribute("data-page", it.page);
      nav.appendChild(a);
    }
    setActiveTab();
  }

  function renderTop(){
    qs("#changesCount").textContent = String(changedCount());
    qs("#previewToggle").checked = !!state.previewOn;
  }

  function renderPreviewBar(){
    const st = qs("#previewStatus");
    const on = !!state.previewOn;
    st.textContent = on ? "Preview ON (uses local overlay)" : "Preview OFF";
  }

  function refreshIframe(){
    const iframe = qs("#builderFrame");
    if(!iframe) return;
    const url = new URL(PREVIEW_URL, location.origin);
    // small cache buster so reload always applies
    url.searchParams.set("t", String(Date.now()));
    iframe.src = url.toString();
  }

  function renderTable(){
    const sheet = state.page;
    const host = qs("#content");
    host.innerHTML = "";

    if(sheet === "Export"){
      renderExport(host);
      return;
    }

    const meta = state.meta[sheet];
    const rows = mergedRows(sheet);
    const parentSheet = sheet==="Subraces" ? "Races" : (sheet==="Subclasses" ? "Classes" : null);
    const parentMeta = parentSheet ? state.meta[parentSheet] : null;

    const title = document.createElement("div");
    title.className = "h1";
    title.textContent = sheet;
    host.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = sheet==="Subraces" ? "Subraces MUST have a Parent Race." :
                       sheet==="Subclasses" ? "Subclasses MUST have a Parent Class." :
                       "Add or edit items. IDs are auto-generated from names.";
    host.appendChild(hint);

    const addBtn = qs("#addBtn");
    addBtn.textContent = sheet.startsWith("Sub") ? ("+ Add " + sheet.slice(0,-2)) : ("+ Add " + sheet.slice(0,-1));
    addBtn.onclick = ()=>openEditorModal({mode:"add", sheet});

    // Optional parent filter
    const filterRow = document.createElement("div");
    filterRow.className = "row";
    if(parentSheet){
      const sel = document.createElement("select");
      sel.style.flex = "1";
      sel.innerHTML = `<option value="">All ${parentSheet}</option>`;
      const parents = mergedRows(parentSheet).sort((a,b)=>String(a[parentMeta.nameKey]||"").localeCompare(String(b[parentMeta.nameKey]||"")));
      for(const p of parents){
        const pid = String(p[parentMeta.idKey]||"").trim();
        const name = String(p[parentMeta.nameKey]||pid||"");
        if(!pid) continue;
        const opt = document.createElement("option");
        opt.value = pid;
        opt.textContent = name;
        sel.appendChild(opt);
      }
      sel.value = state._parentFilter || "";
      sel.onchange = ()=>{ state._parentFilter = sel.value; renderTable(); };
      filterRow.appendChild(sel);
      host.appendChild(filterRow);
    }

    const table = document.createElement("table");
    table.className = "table";
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
      ${parentSheet ? "<th>Parent</th>" : ""}
      <th>Name</th>
      <th>ID</th>
      <th></th>
    </tr>`;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");

    const norm = (x)=>String(x??"").trim();
    const filtered = rows
      .filter(r=>{
        if(!parentSheet || !state._parentFilter) return true;
        return norm(r[meta.parentKey]) === norm(state._parentFilter);
      })
      .sort((a,b)=>{
        const an = String(a[meta.nameKey]||"");
        const bn = String(b[meta.nameKey]||"");
        return an.localeCompare(bn);
      });

    for(const r of filtered){
      const tr = document.createElement("tr");
      const id = norm(r[meta.idKey] ?? r.id ?? r.Id);
      const name = String(r[meta.nameKey] ?? r.name ?? "").trim() || "—";

      const changed = !!(state.changes?.[sheet]||{})[id];
      const parentCell = parentSheet ? `<td>${escapeHtml(parentNameForRow(sheet, r) || "—")}${changed ? " <span class='small'>(edited)</span>" : ""}</td>` : "";
      tr.innerHTML = `
        ${parentCell}
        <td>${escapeHtml(name)}</td>
        <td class="k">${escapeHtml(id)}</td>
        <td style="text-align:right"><button class="btn" data-edit="${escapeHtml(id)}">Edit</button></td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    host.appendChild(table);

    qsa("button[data-edit]", host).forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-edit");
        const row = mergedRows(sheet).find(x=>String(x[meta.idKey]||"").trim()===String(id||"").trim());
        openEditorModal({mode:"edit", sheet, id, row});
      });
    });

    if(!filtered.length){
      const empty = document.createElement("div");
      empty.className = "notice";
      empty.textContent = "No rows found (check your filter or bundle).";
      host.appendChild(empty);
    }
  }

  function parentNameForRow(sheet, row){
    if(sheet==="Subraces"){
      const pid = String(row["RaceId"] ?? row["raceId"] ?? "").trim();
      const p = mergedRows("Races").find(r=>String(r["RaceId"]||"").trim()===pid);
      return p ? String(p[state.meta.Races.nameKey]||pid) : pid;
    }
    if(sheet==="Subclasses"){
      const pid = String(row["ClassId"] ?? row["classId"] ?? "").trim();
      const p = mergedRows("Classes").find(r=>String(r["ClassId"]||"").trim()===pid);
      return p ? String(p[state.meta.Classes.nameKey]||pid) : pid;
    }
    return "";
  }

  function escapeHtml(s){
    return String(s??"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  // ---------------- modal editor ----------------
  function openEditorModal({mode, sheet, id, row}){
    const modal = qs("#modal");
    const meta = state.meta[sheet];
    const cols = state.columns[sheet] || [];
    const isSub = (sheet==="Subraces" || sheet==="Subclasses");
    const parentSheet = sheet==="Subraces" ? "Races" : (sheet==="Subclasses" ? "Classes" : null);

    // Determine which optional fields we can show
    const showDesc = meta.descKey && cols.includes(meta.descKey);
    const showIcon = meta.iconKey && cols.includes(meta.iconKey);

    qs("#modalTitle").textContent = (mode==="add" ? "Add " : "Edit ") + (sheet==="Races"?"Race":sheet==="Subraces"?"Subrace":sheet==="Classes"?"Class":"Subclass");

    const form = qs("#modalForm");
    form.innerHTML = "";

    let current = row ? {...row} : {};
    // If editing, overlay any existing local change patch to show latest
    if(mode==="edit" && id){
      const patch = (state.changes?.[sheet]||{})[id];
      if(patch) current = {...current, ...patch};
    }

    // Parent dropdown for sub types
    let parentSel = null;
    if(parentSheet){
      const parentMeta = state.meta[parentSheet];
      const parents = mergedRows(parentSheet).sort((a,b)=>String(a[parentMeta.nameKey]||"").localeCompare(String(b[parentMeta.nameKey]||"")));
      const label = document.createElement("label");
      label.textContent = parentSheet==="Races" ? "Parent Race" : "Parent Class";
      form.appendChild(label);

      parentSel = document.createElement("select");
      parentSel.innerHTML = `<option value="">Select…</option>`;
      for(const p of parents){
        const pid = String(p[parentMeta.idKey]||"").trim();
        const nm = String(p[parentMeta.nameKey]||pid||"");
        if(!pid) continue;
        const opt = document.createElement("option");
        opt.value = pid;
        opt.textContent = nm;
        parentSel.appendChild(opt);
      }
      const existingParent = String(current[meta.parentKey] ?? current[meta.parentKey?.toLowerCase?.()] ?? "").trim();
      parentSel.value = existingParent;
      form.appendChild(parentSel);
    }

    // Name input
    const nameLbl = document.createElement("label");
    nameLbl.textContent = "Name";
    form.appendChild(nameLbl);
    const nameIn = document.createElement("input");
    nameIn.placeholder = "e.g. Berserker";
    nameIn.value = String(current[meta.nameKey] ?? current.Name ?? current.name ?? "").trim();
    form.appendChild(nameIn);

    // Optional desc
    let descIn = null;
    if(showDesc){
      const dl = document.createElement("label");
      dl.textContent = "Description (optional)";
      form.appendChild(dl);
      descIn = document.createElement("textarea");
      descIn.value = String(current[meta.descKey] ?? "").trim();
      form.appendChild(descIn);
    }

    // Optional icon
    let iconIn = null;
    if(showIcon){
      const il = document.createElement("label");
      il.textContent = "Icon (optional URL/path)";
      form.appendChild(il);
      iconIn = document.createElement("input");
      iconIn.placeholder = "e.g. /assets/icons/classes/barbarian.png";
      iconIn.value = String(current[meta.iconKey] ?? "").trim();
      form.appendChild(iconIn);
    }

    // Computed ID display (read-only)
    const idLbl = document.createElement("label");
    idLbl.textContent = "ID (auto)";
    form.appendChild(idLbl);
    const idOut = document.createElement("input");
    idOut.disabled = true;
    idOut.value = id ? String(id) : "(generated on save)";
    form.appendChild(idOut);

    const err = qs("#modalError");
    err.textContent = "";
    err.style.display = "none";

    function computeId(){
      const name = slugify(nameIn.value);
      if(!name) return "";
      if(sheet==="Races") return name;
      if(sheet==="Classes") return name;
      if(sheet==="Subraces"){
        const pid = parentSel ? String(parentSel.value||"").trim() : "";
        if(!pid) return "";
        return pid + "_" + name;
      }
      if(sheet==="Subclasses"){
        const pid = parentSel ? String(parentSel.value||"").trim() : "";
        if(!pid) return "";
        return pid + "_" + name;
      }
      return name;
    }

    function updateIdPreview(){
      if(mode==="edit" && id){
        idOut.value = id;
        return;
      }
      const computed = computeId();
      idOut.value = computed ? computed : "(choose parent + name)";
    }

    if(parentSel) parentSel.addEventListener("change", updateIdPreview);
    nameIn.addEventListener("input", updateIdPreview);
    updateIdPreview();

    qs("#modalCancel").onclick = ()=>closeModal();
    qs("#modalSave").onclick = ()=>{
      const name = String(nameIn.value||"").trim();
      if(!name){
        showErr("Name is required.");
        return;
      }
      let parentVal = null;
      if(parentSel){
        parentVal = String(parentSel.value||"").trim();
        if(!parentVal){
          showErr("Parent is required.");
          return;
        }
      }

      const newId = (mode==="edit" && id) ? String(id) : computeId();
      if(!newId){
        showErr("Could not generate an ID (check name/parent).");
        return;
      }

      // Prevent accidental ID collision with a different row (baseline)
      const baselineMap = new Map(mergedRows(sheet).map(r=>[String(r[meta.idKey]||"").trim(), r]));
      if(mode==="add" && baselineMap.has(newId)){
        showErr("That ID already exists. Choose a different name.");
        return;
      }

      // Build patch row with canonical keys
      const patch = {};
      patch[meta.idKey] = newId;
      patch[meta.nameKey] = name;
      if(parentSel) patch[meta.parentKey] = parentVal;
      if(descIn) patch[meta.descKey] = String(descIn.value||"").trim();
      if(iconIn) patch[meta.iconKey] = String(iconIn.value||"").trim();

      // For back-compat, also mirror lowercase parent keys if present in columns
      if(parentSel){
        const lower = meta.parentKey.charAt(0).toLowerCase() + meta.parentKey.slice(1);
        if((state.columns[sheet]||[]).includes(lower)) patch[lower] = parentVal;
      }

      // Save to changes map-by-id
      state.changes = ensureChanges();
      state.changes[sheet] = state.changes[sheet] || {};
      state.changes[sheet][newId] = patch;
      state.changes.meta = state.changes.meta || {};
      state.changes.meta.updatedAt = Date.now();
      writeJson(CHANGES_KEY, state.changes);

      // Update CMS draft for live preview overlay
      updateCmsDraftForAllChanges();
      renderTop();
      renderTable();
      closeModal();
    };

    function showErr(msg){
      err.textContent = msg;
      err.style.display = "";
      err.className = "notice bad";
    }

    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
  }

  function closeModal(){
    const modal = qs("#modal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden","true");
  }

  function renderExport(host){
    const title = document.createElement("div");
    title.className = "h1";
    title.textContent = "Export Changes (TSV)";
    host.appendChild(title);

    const count = changedCount();
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = count ? `You have ${count} changed row(s). Copy the TSV below and paste into Google Sheets.` :
                               "No local changes yet. Add/edit something first.";
    host.appendChild(hint);

    for(const sheet of SHEETS){
      const tsv = buildTSV(sheet);
      const boxWrap = document.createElement("div");
      boxWrap.style.margin = "12px 0 16px";
      const h = document.createElement("div");
      h.style.display = "flex";
      h.style.justifyContent = "space-between";
      h.style.alignItems = "center";
      h.innerHTML = `<div style="font-weight:700">${sheet}</div><div class="small">${Object.keys(state.changes?.[sheet]||{}).length} row(s)</div>`;
      boxWrap.appendChild(h);

      const btnRow = document.createElement("div");
      btnRow.className = "row";
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn primary";
      copyBtn.textContent = "Copy TSV";
      copyBtn.disabled = !tsv;
      copyBtn.onclick = async ()=>{
        try{
          await navigator.clipboard.writeText(tsv);
          copyBtn.textContent = "Copied!";
          setTimeout(()=>copyBtn.textContent="Copy TSV", 900);
        }catch{
          alert("Could not copy. Select the text manually.");
        }
      };
      btnRow.appendChild(copyBtn);
      boxWrap.appendChild(btnRow);

      const ta = document.createElement("textarea");
      ta.className = "codebox";
      ta.readOnly = true;
      ta.value = tsv || "";
      boxWrap.appendChild(ta);

      host.appendChild(boxWrap);
    }

    const note = document.createElement("div");
    note.className = "notice";
    note.innerHTML = "<b>Tip:</b> after pasting into Sheets, you can click <b>Reset Local</b> to avoid ghost data.";
    host.appendChild(note);
  }

  function renderAll(){
    renderNav();
    renderTop();
    renderPreviewBar();
    renderTable();
  }

  async function init(){
    state.page = routeToPage();
    state.changes = ensureChanges();
    state.previewOn = String(localStorage.getItem(CMS_APPLY_KEY)||"0")==="1";

    renderNav();
    renderTop();
    renderPreviewBar();

    qs("#resetBtn").onclick = ()=>clearLocal();
    qs("#openLegacyBtn").onclick = ()=>{ location.href = "/editor/cms/"; };
    qs("#previewToggle").addEventListener("change", (e)=>{
      setPreviewOn(!!e.target.checked);
    });

    // Load bundle + infer columns/meta
    try{
      state.bundle = await fetchBundle();
      for(const sheet of SHEETS){
        const rows = readBaselineRows(sheet);
        const cols = inferColumns(sheet, rows);
        state.columns[sheet] = cols;
        state.meta[sheet] = inferMeta(sheet, cols);
      }
      // Ensure CMS draft mirrors changes on load, so preview works after refresh
      updateCmsDraftForAllChanges();
    }catch(e){
      const host = qs("#content");
      host.innerHTML = `<div class="notice bad"><b>Bundle failed to load.</b><div class="small">${escapeHtml(String(e&&e.message||e))}</div></div>`;
    }

    renderAll();
    refreshIframe();

    // Close modal on backdrop click
    qs("#modal").addEventListener("click",(ev)=>{
      if(ev.target === qs("#modal")) closeModal();
    });
    window.addEventListener("keydown",(ev)=>{
      if(ev.key==="Escape") closeModal();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();