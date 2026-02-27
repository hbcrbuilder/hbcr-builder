import { getBundle } from "../src/data/liveData.js";

const LS_KEY = "hbcr_editor_draft";

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

function normalizeLayoutRows(rows){
  const out = (Array.isArray(rows) ? rows : []).map(r => ({
    ScreenId: String(r.ScreenId ?? "").trim(),
    ComponentId: String(r.ComponentId ?? "").trim(),
    Type: String(r.Type ?? "").trim(),
    ParentId: String(r.ParentId ?? "").trim(),
    Slot: String(r.Slot ?? "").trim() || "center",
    Order: Number(r.Order ?? 0) || 0,
    Enabled: (String(r.Enabled ?? "").toLowerCase() === "true") || r.Enabled === true,
    BindingId: String(r.BindingId ?? "").trim(),
    PropsJson: r.PropsJson ?? "",
    StyleJson: r.StyleJson ?? "",
    VisibilityJson: r.VisibilityJson ?? "",
  }));
  return out.filter(r => r.ScreenId && r.ComponentId);
}

function normalizeBindingRows(rows){
  return (Array.isArray(rows) ? rows : []).map(r => ({
    BindingId: String(r.BindingId ?? "").trim(),
    SourceType: String(r.SourceType ?? "").trim(),
    SourceRef: String(r.SourceRef ?? "").trim(),
    ItemsPath: String(r.ItemsPath ?? "").trim(),
    WhereJson: r.WhereJson ?? "",
    LabelField: String(r.LabelField ?? "").trim(),
    IconField: String(r.IconField ?? "").trim(),
    ValueField: String(r.ValueField ?? "").trim(),
    DescField: String(r.DescField ?? "").trim(),
    SortField: String(r.SortField ?? "").trim(),
    SortDir: String(r.SortDir ?? "").trim(),
  })).filter(r => r.BindingId);
}

function parseJsonMaybe(v){
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function safePrettyJson(text){
  const t = (text ?? "").toString().trim();
  if (!t) return "";
  try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; }
}

function assignOrders(rows){
  // For each (ScreenId, ParentId, Slot) group, re-number orders 10,20,30...
  const groups = new Map();
  for (const r of rows){
    const k = `${r.ScreenId}||${r.ParentId||""}||${r.Slot||""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const list of groups.values()){
    list.sort((a,b)=> (a.Order||0)-(b.Order||0));
    list.forEach((r,i)=> r.Order = (i+1)*10);
  }
}

function tsvEscape(v){
  if (v == null) return "";
  const s = (typeof v === "string") ? v : JSON.stringify(v);
  return s.replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function rowsToTSV(rows, headers){
  const lines = [];
  lines.push(headers.join("\t"));
  for (const r of rows){
    lines.push(headers.map(h => tsvEscape(r[h])).join("\t"));
  }
  return lines.join("\n");
}

async function copyText(text){
  await navigator.clipboard.writeText(text);
}

function el(sel){ return document.querySelector(sel); }
function mk(tag, cls){ const d=document.createElement(tag); if(cls) d.className=cls; return d; }

let bundle = null;
let draft = null; // {UILayout, UIBindings}
let currentScreen = null;
let selectedId = null;

const slotNames = ["left","center","right","top","bottom","overlay"];

function loadDraftFromStorage(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (!Array.isArray(obj.UILayout) || !Array.isArray(obj.UIBindings)) return null;
    return obj;
  }catch{ return null; }
}

function setMsg(text){
  const m = el("#inspectorMsg");
  if (!m) return;
  m.textContent = text || "";
}

function setInspectorVisible(visible){
  el("#inspectorEmpty").classList.toggle("hidden", visible);
  el("#inspector").classList.toggle("hidden", !visible);
}

function getScreenRows(){
  return draft.UILayout.filter(r => r.ScreenId === currentScreen);
}

function rebuildScreenList(){
  const cont = el("#screenList");
  cont.innerHTML = "";
  const screens = Array.from(new Set(draft.UILayout.map(r => r.ScreenId))).sort();
  for (const s of screens){
    const item = mk("div", "screen-item"+(s===currentScreen?" active":""));
    const k = mk("div","k"); k.textContent = s;
    const v = mk("div","v"); 
    const count = draft.UILayout.filter(r=>r.ScreenId===s).length;
    v.textContent = `${count} components`;
    item.append(k,v);
    item.onclick = ()=>{ currentScreen = s; selectedId=null; renderAll(); };
    cont.appendChild(item);
  }
  if (!currentScreen && screens.length) currentScreen = screens[0];
}

function renderBoard(){
  const board = el("#board");
  board.innerHTML = "";
  const filter = el("#slotFilter").value;

  const rows = getScreenRows();
  // show only top-level (ParentId blank) in board; children appear as small list inside panel cards in inspector view (v2)
  const top = rows.filter(r => !r.ParentId);
  const bySlot = new Map(slotNames.map(s => [s, []]));
  for (const r of top){
    const s = (r.Slot || "center").toLowerCase();
    if (!bySlot.has(s)) bySlot.set(s, []);
    bySlot.get(s).push(r);
  }
  for (const list of bySlot.values()) list.sort((a,b)=> (a.Order||0)-(b.Order||0));

  for (const slot of slotNames){
    if (filter !== "(all)" && filter !== slot) continue;

    const col = mk("div","slot");
    col.dataset.slot = slot;
    col.ondragover = (e)=>{ e.preventDefault(); };
    col.ondrop = (e)=>{
      e.preventDefault();
      const cid = e.dataTransfer.getData("text/componentId");
      if (!cid) return;
      const r = draft.UILayout.find(x => x.ComponentId === cid && x.ScreenId === currentScreen);
      if (!r) return;
      r.Slot = slot;
      r.ParentId = "";
      assignOrders(draft.UILayout);
      renderAll();
      selectComponent(cid);
      setMsg("Moved to slot: "+slot);
    };

    const head = mk("div","slot-head");
    const name = mk("div","slot-name"); name.textContent = slot;
    const meta = mk("div","slot-meta"); meta.textContent = `${bySlot.get(slot)?.length || 0}`;
    head.append(name, meta);

    const body = mk("div","slot-body");
    for (const r of bySlot.get(slot) || []){
      const card = mk("div","card"+(r.ComponentId===selectedId?" active":""));
      card.draggable = true;
      card.dataset.componentId = r.ComponentId;
      card.ondragstart = (e)=>{
        e.dataTransfer.setData("text/componentId", r.ComponentId);
        e.dataTransfer.effectAllowed = "move";
      };
      card.onclick = ()=> selectComponent(r.ComponentId);

      // allow reorder by dropping on card
      card.ondragover = (e)=>{ e.preventDefault(); };
      card.ondrop = (e)=>{
        e.preventDefault();
        const fromId = e.dataTransfer.getData("text/componentId");
        if (!fromId || fromId === r.ComponentId) return;
        const a = draft.UILayout.find(x=> x.ScreenId===currentScreen && x.ComponentId===fromId);
        const b = r;
        if (!a || !b) return;
        // if different slot, adopt target slot first
        a.Slot = b.Slot;
        a.ParentId = b.ParentId;
        // reorder: place a before b in the group
        const group = draft.UILayout.filter(x=> x.ScreenId===currentScreen && (x.ParentId||"")===(b.ParentId||"") && (x.Slot||"")===(b.Slot||""));
        group.sort((x,y)=> (x.Order||0)-(y.Order||0));
        const without = group.filter(x=> x.ComponentId !== a.ComponentId);
        const idx = without.findIndex(x=> x.ComponentId === b.ComponentId);
        without.splice(idx, 0, a);
        // write back orders
        without.forEach((x,i)=> x.Order=(i+1)*10);
        renderAll();
        selectComponent(a.ComponentId);
        setMsg("Reordered.");
      };

      const id = mk("div","id"); id.textContent = r.ComponentId;
      const type = mk("div","type"); type.textContent = `${r.Type || "(type)"}${r.BindingId?` • ${r.BindingId}`:""}`;
      const small = mk("div","small"); small.textContent = `order ${r.Order||0}${r.Enabled?"":" • disabled"}`;
      card.append(id,type,small);
      body.appendChild(card);
    }

    col.append(head, body);
    board.appendChild(col);
  }
}

function renderInspector(){
  if (!selectedId){
    setInspectorVisible(false);
    return;
  }
  const r = draft.UILayout.find(x => x.ScreenId===currentScreen && x.ComponentId===selectedId);
  if (!r){ setInspectorVisible(false); return; }
  setInspectorVisible(true);

  el("#fComponentId").value = r.ComponentId;
  el("#fType").value = r.Type || "";
  el("#fBindingId").value = r.BindingId || "";
  el("#fSlot").value = (r.Slot || "center").toLowerCase();
  el("#fParentId").value = r.ParentId || "";
  el("#fOrder").value = r.Order || 0;
  el("#fEnabled").checked = !!r.Enabled;

  el("#fProps").value = safePrettyJson(parseJsonMaybe(r.PropsJson));
  el("#fStyle").value = safePrettyJson(parseJsonMaybe(r.StyleJson));
  el("#fVisibility").value = safePrettyJson(parseJsonMaybe(r.VisibilityJson));
  setMsg("");
}

function selectComponent(id){
  selectedId = id;
  renderAll();
}

function applyInspector(){
  const r = draft.UILayout.find(x => x.ScreenId===currentScreen && x.ComponentId===selectedId);
  if (!r) return;

  r.Type = el("#fType").value.trim();
  r.BindingId = el("#fBindingId").value.trim();
  r.Slot = el("#fSlot").value.trim() || "center";
  r.ParentId = el("#fParentId").value.trim();
  r.Order = Number(el("#fOrder").value || 0) || 0;
  r.Enabled = el("#fEnabled").checked;

  // validate json fields (store compact)
  const fields = [
    ["PropsJson","#fProps"],
    ["StyleJson","#fStyle"],
    ["VisibilityJson","#fVisibility"],
  ];
  for (const [k, sel] of fields){
    const raw = el(sel).value.trim();
    if (!raw){ r[k] = ""; continue; }
    try { r[k] = JSON.stringify(JSON.parse(raw)); }
    catch {
      setMsg(`Invalid JSON in ${k}.`);
      return;
    }
  }

  assignOrders(draft.UILayout);
  renderAll();
  setMsg("Applied.");
}

function deleteSelected(){
  const idx = draft.UILayout.findIndex(x => x.ScreenId===currentScreen && x.ComponentId===selectedId);
  if (idx === -1) return;
  const id = selectedId;
  draft.UILayout.splice(idx, 1);
  // remove children too
  for (let i=draft.UILayout.length-1;i>=0;i--){
    const r = draft.UILayout[i];
    if (r.ScreenId===currentScreen && r.ParentId===id) draft.UILayout.splice(i,1);
  }
  selectedId = null;
  assignOrders(draft.UILayout);
  renderAll();
}

function saveDraft(silent=false){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(draft));
    if (!silent) alert("Draft saved to localStorage (hbcr_editor_draft).");
  }catch(err){
    if (!silent) alert("Failed to save draft: "+err.message);
  }
}

function resetDraft(){
  if (!confirm("Reset draft to the current live bundle?")) return;
  draft = {
    UILayout: normalizeLayoutRows(bundle.UILayout),
    UIBindings: normalizeBindingRows(bundle.UIBindings),
  };
  assignOrders(draft.UILayout);
  selectedId = null;
  rebuildScreenList();
  renderAll();
}

let _previewOpen = false;
let _previewDebounce = null;

function persistDraftSilently(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(draft)); }catch(_e){}
}

function refreshEmbeddedPreview(force=false){
  if (!_previewOpen) return;
  if (_previewDebounce) clearTimeout(_previewDebounce);
  const delay = force ? 0 : 250;
  _previewDebounce = setTimeout(()=>{
    const frame = document.getElementById("previewFrame");
    if (!frame) return;
    // Bump query param to ensure a reload even if the URL is the same.
    frame.src = `/?editorPreview=1&v=${Date.now()}`;
  }, delay);
}

function setPreviewOpen(open){
  const modal = document.getElementById("previewModal");
  if (!modal) return;
  _previewOpen = open;
  modal.setAttribute("aria-hidden", open ? "false" : "true");
  if (open){
    persistDraftSilently();
    refreshEmbeddedPreview(true);
  }
}

function openPreview(){
  // embedded preview (modal)
  setPreviewOpen(true);
}

function closePreview(){
  setPreviewOpen(false);
}


function downloadJson(){
  const blob = new Blob([JSON.stringify(draft, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hbcr_editor_draft.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderAll(){
  rebuildScreenList();
  renderBoard();
  renderInspector();
  // Keep draft in localStorage so preview stays in sync.
  if (draft) persistDraftSilently();
  refreshEmbeddedPreview(false);
}

async function reloadBundle(){
  bundle = await getBundle();
  // prefer stored draft
  const stored = loadDraftFromStorage();
  if (stored){
    draft = {
      UILayout: normalizeLayoutRows(stored.UILayout),
      UIBindings: normalizeBindingRows(stored.UIBindings),
    };
  } else {
    draft = {
      UILayout: normalizeLayoutRows(bundle.UILayout),
      UIBindings: normalizeBindingRows(bundle.UIBindings),
    };
  }
  assignOrders(draft.UILayout);
  if (!currentScreen){
    const screens = Array.from(new Set(draft.UILayout.map(r=>r.ScreenId))).sort();
    currentScreen = screens[0] || null;
  }
  renderAll();
}

function hookUI(){
  el("#btnReload").onclick = ()=> reloadBundle();
  el("#btnReset").onclick = ()=> resetDraft();
  el("#btnSaveDraft").onclick = ()=> saveDraft();
  el("#btnPreview").onclick = ()=> openPreview();
  const closeBtn = document.getElementById("btnPreviewClose");
  if (closeBtn) closeBtn.onclick = ()=> closePreview();
  const refBtn = document.getElementById("btnPreviewRefresh");
  if (refBtn) refBtn.onclick = ()=> { persistDraftSilently(); refreshEmbeddedPreview(true); };
  el("#btnDownload").onclick = ()=> downloadJson();

  el("#slotFilter").onchange = ()=> renderBoard();

  el("#btnApply").onclick = ()=> applyInspector();
  el("#btnDelete").onclick = ()=> deleteSelected();

  el("#btnExportUILayout").onclick = async ()=>{
    const headers = ["ScreenId","ComponentId","Type","ParentId","Slot","Order","Enabled","BindingId","PropsJson","StyleJson","VisibilityJson"];
    const tsv = rowsToTSV(draft.UILayout, headers);
    await copyText(tsv);
    alert("Copied UILayout TSV to clipboard.");
  };
  el("#btnExportUIBindings").onclick = async ()=>{
    const headers = ["BindingId","SourceType","SourceRef","ItemsPath","WhereJson","LabelField","IconField","ValueField","DescField","SortField","SortDir"];
    const tsv = rowsToTSV(draft.UIBindings, headers);
    await copyText(tsv);
    alert("Copied UIBindings TSV to clipboard.");
  };
}

hookUI();
reloadBundle();
