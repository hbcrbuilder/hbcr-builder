/**
 * HBCR Slot Editor Overlay (safe extension)
 *
 * Goals:
 * - Runs ONLY in /editor/builder (design flags enabled)
 * - Does NOT modify app rendering logic, filtering logic, or bundle pipeline
 * - Adds an editor-only "+ Add" system that writes ONLY to design draft:
 *     localStorage key: hbcr_design_draft
 *   which LayoutScreen already merges as overrides for:
 *     UILayout / UIBindings / UIZones
 *
 * Notes:
 * - This overlay is intentionally self-contained (no imports) to avoid touching the app.
 * - UI is minimal + inline-styled (no CSS rewrites).
 */
(function () {
  const DESIGN = !!window.__HBCR_DESIGN__;
  if (!DESIGN) return;

  // -------------------------
  // Constants / storage keys
  // -------------------------
  const DRAFT_KEY = "hbcr_design_draft"; // consumed by src/design/designMode.js
  const LAST_SEEN_KEY = "hbcr_editor_lastSeenRowKeys"; // for "New" detection

  const DEFAULT_BUNDLE_URL = "https://hbcr-api.hbcrbuilder.workers.dev/api/bundle";

  // -------------------------
  // Tiny helpers
  // -------------------------
  const nowId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function readJsonLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return (v == null ? fallback : v);
    } catch {
      return fallback;
    }
  }

  function writeJsonLS(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function readDraft() {
    return readJsonLS(DRAFT_KEY, null);
  }

  function writeDraft(next) {
    writeJsonLS(DRAFT_KEY, next || {});
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function asArray(x) {
    return Array.isArray(x) ? x : [];
  }

  // -------------------------
  // Bundle access (read-only)
  // -------------------------
  async function fetchBundle() {
    // IMPORTANT: This does NOT modify the app pipeline; it's just reading the same published bundle.
    const base = (window.__HBCR_BUNDLE_URL__ || DEFAULT_BUNDLE_URL);
    const url = base + (base.includes("?") ? "&" : "?") + "t=" + Date.now();
    const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
    if (!res.ok) throw new Error(`bundle fetch failed: ${res.status}`);
    return await res.json();
  }

  // -------------------------
  // Generic row indexing (no sheet assumptions)
  // -------------------------
  function stableRowKey(row) {
    if (!row || typeof row !== "object") return "";
    const direct = row.id ?? row.Id ?? row.ID ?? row.key ?? row.Key ?? row.slug ?? row.Slug;
    if (direct != null && String(direct).trim()) return String(direct).trim();

    // Try common ID columns without assuming structure
    const idLike = Object.entries(row).find(([k, v]) => /(^|_)(id|uuid|key)$|Id$|ID$/i.test(String(k)) && v != null && String(v).trim());
    if (idLike) return String(idLike[1]).trim();

    // Fallback: stable-ish hash of JSON with sorted keys
    const keys = Object.keys(row).sort();
    const s = keys.map(k => `${k}:${String(row[k] ?? "")}`).join("|");
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return "h" + (h >>> 0).toString(16);
  }

  function bestLabel(row, rowKey) {
    if (!row || typeof row !== "object") return rowKey;
    const preferred = ["name", "Name", "title", "Title", "label", "Label", "ClassName", "SubclassName", "RaceName", "TraitName", "FeatName", "SpellName", "CantripName"]; 
    for (const k of preferred) {
      const v = row[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    // first non-empty string
    for (const [k, v] of Object.entries(row)) {
      if (v != null && typeof v === "string" && v.trim()) return v.trim();
    }
    return rowKey;
  }

  function stringifyRow(row) {
    try {
      if (!row || typeof row !== "object") return String(row ?? "");
      return Object.entries(row)
        .filter(([_, v]) => v != null && String(v).trim())
        .map(([k, v]) => `${k}:${String(v)}`)
        .join("  ");
    } catch {
      return "";
    }
  }

  function buildBundleIndex(bundle) {
    const out = { sheets: [], rowsBySheet: new Map() };
    if (!bundle || typeof bundle !== "object") return out;

    const sheetNames = Object.keys(bundle)
      .filter(k => k && typeof k === "string")
      .sort((a, b) => a.localeCompare(b));

    for (const sheet of sheetNames) {
      const raw = bundle[sheet];
      const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.rows) ? raw.rows : null);
      if (!arr) continue;
      const indexed = [];
      for (const row of arr) {
        const key = stableRowKey(row);
        if (!key) continue;
        indexed.push({
          sheet,
          rowKey: key,
          label: bestLabel(row, key),
          searchText: (bestLabel(row, key) + " " + key + " " + stringifyRow(row)).toLowerCase(),
          row,
        });
      }
      out.sheets.push(sheet);
      out.rowsBySheet.set(sheet, indexed);
    }
    return out;
  }

  // -------------------------
  // Draft merge (non-destructive)
  // -------------------------
  function ensureDraftShape(draft, bundle) {
    const d = (draft && typeof draft === "object") ? clone(draft) : {};
    // We never overwrite existing arrays; we only ensure arrays exist.
    d.UILayout = asArray(d.UILayout ?? bundle?.UILayout);
    d.UIBindings = asArray(d.UIBindings ?? bundle?.UIBindings);
    d.UIZones = asArray(d.UIZones ?? bundle?.UIZones);
    return d;
  }

  function nextOrderWithin(layoutRows, screenId, zoneId) {
    const rows = layoutRows.filter(r => String(r?.ScreenId || r?.screenId) === String(screenId || "") && String(r?.ZoneId || r?.zoneId || r?.Slot || r?.slot || "root") === String(zoneId || "root"));
    let max = 0;
    for (const r of rows) {
      const o = Number(r?.Order ?? r?.order ?? 0) || 0;
      if (o > max) max = o;
    }
    return Math.ceil((max + 10) / 10) * 10;
  }

  // -------------------------
  // UI: modal + + button
  // -------------------------
  function el(tag, attrs = {}, html = "") {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k.startsWith("data-")) n.setAttribute(k, v);
      else n.setAttribute(k, v);
    }
    if (html) n.innerHTML = html;
    return n;
  }

  function ensurePlusButton() {
    let btn = document.getElementById("hbcr-editor-plus");
    if (btn) return btn;
    btn = el("button", {
      id: "hbcr-editor-plus",
      type: "button",
      title: "Editor: + Add",
      style: [
        "position:fixed",
        "right:14px",
        "bottom:14px",
        "z-index:999999",
        "width:48px",
        "height:48px",
        "border-radius:999px",
        "border:1px solid rgba(200,160,80,0.55)",
        "background:rgba(0,0,0,0.35)",
        "color:#e8dcc6",
        "font-size:28px",
        "line-height:46px",
        "text-align:center",
        "cursor:pointer",
        "backdrop-filter: blur(4px)",
      ].join(";"),
    }, "+");
    document.body.appendChild(btn);
    return btn;
  }

  function ensureModal() {
    let root = document.getElementById("hbcr-editor-add-modal");
    if (root) return root;

    root = el("div", {
      id: "hbcr-editor-add-modal",
      style: [
        "position:fixed",
        "inset:0",
        "z-index:999999",
        "display:none",
        "align-items:center",
        "justify-content:center",
        "background:rgba(0,0,0,0.55)",
      ].join(";"),
    });

    const panel = el("div", {
      style: [
        "width:min(860px, calc(100vw - 40px))",
        "max-height:min(78vh, 720px)",
        "overflow:hidden",
        "background:rgba(20,16,12,0.94)",
        "border:1px solid rgba(200,160,80,0.35)",
        "border-radius:14px",
        "box-shadow:0 12px 40px rgba(0,0,0,0.55)",
        "color:#e8dcc6",
        "font-family:inherit",
      ].join(";"),
    });

    const head = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 14px 10px 14px;border-bottom:1px solid rgba(200,160,80,0.18);" },
      `<div style="font-weight:800;letter-spacing:.04em;">Editor: + Add</div>
       <div style="display:flex;gap:8px;align-items:center;">
         <button type="button" id="hbcr-editor-add-close" style="all:unset;cursor:pointer;padding:6px 10px;border-radius:10px;border:1px solid rgba(200,160,80,0.35);">Close</button>
       </div>`
    );

    const body = el("div", { style: "display:grid;grid-template-columns: 320px 1fr;gap:0;min-height:420px;" });
    const left = el("div", { style: "border-right:1px solid rgba(200,160,80,0.18);padding:12px;overflow:auto;" });
    const right = el("div", { style: "padding:12px;overflow:auto;" });

    const tabs = [
      { id: "components", label: "Add Component" },
      { id: "bindings", label: "Bindings" },
      { id: "detect", label: "New / Unbound" },
      { id: "zones", label: "Zones" },
      { id: "export", label: "Export" },
    ];

    const tabList = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });
    for (const t of tabs) {
      const b = el("button", {
        type: "button",
        "data-tab": t.id,
        style: [
          "all:unset",
          "cursor:pointer",
          "padding:10px 10px",
          "border-radius:12px",
          "border:1px solid rgba(200,160,80,0.18)",
          "background:rgba(0,0,0,0.14)",
          "font-weight:700",
        ].join(";"),
      }, escapeHtml(t.label));
      tabList.appendChild(b);
    }
    left.appendChild(tabList);

    body.append(left, right);
    panel.append(head, body);
    root.appendChild(panel);
    document.body.appendChild(root);

    function hide() { root.style.display = "none"; }
    function show() { root.style.display = "flex"; }
    root.hideModal = hide;
    root.showModal = show;
    root._right = right;

    root.addEventListener("click", (e) => {
      if (e.target === root) hide();
    });
    panel.querySelector("#hbcr-editor-add-close").addEventListener("click", hide);
    left.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-tab]");
      if (!btn) return;
      const id = btn.getAttribute("data-tab");
      setActiveTab(id);
    });

    function setActiveTab(id) {
      for (const btn of tabList.querySelectorAll("[data-tab]")) {
        const on = btn.getAttribute("data-tab") === id;
        btn.style.background = on ? "rgba(200,160,80,0.15)" : "rgba(0,0,0,0.14)";
        btn.style.borderColor = on ? "rgba(200,160,80,0.35)" : "rgba(200,160,80,0.18)";
      }
      root._activeTab = id;
      if (typeof root.render === "function") root.render();
    }
    setActiveTab("components");
    return root;
  }

  // -------------------------
  // Main overlay controller
  // -------------------------
  let _bundle = null;
  let _index = null;
  let _draft = null;
  let _error = "";

  async function ensureData() {
    try {
      _bundle = await fetchBundle();
      _index = buildBundleIndex(_bundle);
      _draft = ensureDraftShape(readDraft(), _bundle);
      _error = "";
    } catch (e) {
      _error = String(e?.message || e);
    }
  }

  function saveDraftNonDestructive(nextDraft) {
    // Write ONLY draft (editor state). Renderer merges it automatically.
    writeDraft(nextDraft);
    _draft = nextDraft;
    // Ask app to re-render in place (design tick is already used elsewhere)
    try {
      // Most of the app rerenders on store changes. As a non-invasive nudge,
      // we can trigger a hashchange-like repaint by toggling a CSS var.
      document.documentElement.style.setProperty("--hbcr-editor-tick", String(Date.now()));
    } catch {}
  }

  // -------------------------
  // Views
  // -------------------------
  function viewError() {
    return `<div style="padding:10px;border:1px solid rgba(255,120,120,0.35);background:rgba(120,0,0,0.18);border-radius:12px;">
      <div style="font-weight:800;margin-bottom:6px;">Overlay error</div>
      <div style="opacity:.9;white-space:pre-wrap;">${escapeHtml(_error)}</div>
    </div>`;
  }

  function viewComponents() {
    const screens = Array.from(new Set(asArray(_draft?.UILayout).map(r => String(r?.ScreenId || r?.screenId)).filter(Boolean))).sort();
    const zones = asArray(_draft?.UIZones).map(z => String(z?.ZoneId || z?.zoneId)).filter(Boolean);
    const bindingIds = Array.from(new Set(asArray(_draft?.UIBindings).map(b => String(b?.BindingId || b?.bindingId)).filter(Boolean))).sort();

    const screenOpts = (screens.length ? screens : ["(type a screen id)"]).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    const zoneOpts = (zones.length ? zones : ["root"]).map(z => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("");
    const bindOpts = ["", ...bindingIds].map(b => `<option value="${escapeHtml(b)}">${b ? escapeHtml(b) : "(none)"}</option>`).join("");

    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="opacity:.9;line-height:1.35;">
          Adds a new UI node into <b>UILayout</b> (and optionally attaches an existing <b>UIBinding</b>).<br/>
          This is editor-only and saved to your local <code>${escapeHtml(DRAFT_KEY)}</code> draft.
        </div>

        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">ScreenId</span>
            <input id="hbcr-add-screen" placeholder="e.g. metamagic" list="hbcr-screen-list" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
            <datalist id="hbcr-screen-list">${screenOpts}</datalist>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">ZoneId</span>
            <select id="hbcr-add-zone" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">
              ${zoneOpts}
            </select>
          </label>
        </div>

        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">Component Type</span>
            <select id="hbcr-add-type" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">
              <option value="panel">Box / Panel</option>
              <option value="choiceGrid">Radial-like Choice Grid</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">BindingId (optional)</span>
            <select id="hbcr-add-binding" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">
              ${bindOpts}
            </select>
          </label>
        </div>

        <label style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-weight:700;">Props (JSON)</span>
          <textarea id="hbcr-add-props" rows="6" style="width:100%;box-sizing:border-box;padding:10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">{
  "title": "",
  "subtitle": "",
  "selectedPath": ""
}</textarea>
        </label>

        <div style="display:flex;gap:10px;align-items:center;">
          <button type="button" id="hbcr-add-component-btn" style="all:unset;cursor:pointer;padding:10px 12px;border-radius:12px;border:1px solid rgba(200,160,80,0.35);background:rgba(0,0,0,0.18);font-weight:800;">+ Add Component</button>
          <div id="hbcr-add-component-msg" style="opacity:.85;"></div>
        </div>
      </div>
    `;
  }

  function viewBindings() {
    const sheets = asArray(_index?.sheets);
    const sheetOpts = sheets.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="opacity:.9;line-height:1.35;">
          Create a new <b>UIBinding</b> row that reads from the published bundle.<br/>
          This does not alter sheets; it only stores a binding config in the draft.
        </div>
        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">BindingId</span>
            <input id="hbcr-bind-id" placeholder="e.g. Traits_All" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">SourceRef (bundle sheet)</span>
            <select id="hbcr-bind-sheet" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">${sheetOpts}</select>
          </label>
        </div>
        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">LabelField</span>
            <input id="hbcr-bind-label" value="name" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">ValueField</span>
            <input id="hbcr-bind-value" value="id" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
          </label>
        </div>
        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">IconField</span>
            <input id="hbcr-bind-icon" value="icon" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">DescField</span>
            <input id="hbcr-bind-desc" value="desc" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-weight:700;">WhereJson (optional, array)</span>
          <textarea id="hbcr-bind-where" rows="5" style="width:100%;box-sizing:border-box;padding:10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">[]</textarea>
        </label>
        <div style="display:flex;gap:10px;align-items:center;">
          <button type="button" id="hbcr-add-binding-btn" style="all:unset;cursor:pointer;padding:10px 12px;border-radius:12px;border:1px solid rgba(200,160,80,0.35);background:rgba(0,0,0,0.18);font-weight:800;">+ Create Binding</button>
          <div id="hbcr-add-binding-msg" style="opacity:.85;"></div>
        </div>
      </div>
    `;
  }

  function viewDetect() {
    // New detection = current bundle row keys vs last-seen.
    const lastSeen = readJsonLS(LAST_SEEN_KEY, {});
    const used = new Set();
    // "Used" = any rowKey already referenced inside UIBindings.WhereJson/SourceRef/etc.
    // We avoid assuming schema; only a best-effort scan.
    const draftStr = JSON.stringify({ UILayout: _draft?.UILayout, UIBindings: _draft?.UIBindings, UIZones: _draft?.UIZones } || {});

    const rows = [];
    for (const sheet of (_index?.sheets || [])) {
      const list = _index.rowsBySheet.get(sheet) || [];
      const prev = new Set(asArray(lastSeen?.[sheet]));
      for (const it of list) {
        const isNew = !prev.has(it.rowKey);
        const isMentioned = draftStr.includes(String(it.rowKey));
        if (isMentioned) used.add(it.rowKey);
        rows.push({ ...it, isNew, isMentioned });
      }
    }

    const totalNew = rows.filter(r => r.isNew).length;
    const totalUnbound = rows.filter(r => !r.isMentioned).length;

    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <div style="font-weight:800;">Detect</div>
          <div style="opacity:.85;">New rows: <b>${totalNew}</b> • Unbound rows: <b>${totalUnbound}</b></div>
          <button type="button" id="hbcr-mark-seen" style="all:unset;cursor:pointer;padding:8px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.30);background:rgba(0,0,0,0.16);font-weight:800;">Mark all as seen</button>
        </div>

        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">Sheet</span>
            <select id="hbcr-detect-sheet" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">
              ${(_index?.sheets || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">Search</span>
            <input id="hbcr-detect-q" placeholder="type to filter" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
          </label>
        </div>

        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;gap:8px;align-items:center;cursor:pointer;">
            <input id="hbcr-detect-only-new" type="checkbox" />
            <span>Only new</span>
          </label>
          <label style="display:flex;gap:8px;align-items:center;cursor:pointer;">
            <input id="hbcr-detect-only-unbound" type="checkbox" />
            <span>Only unbound</span>
          </label>
        </div>

        <div id="hbcr-detect-list" style="border:1px solid rgba(200,160,80,0.18);border-radius:12px;overflow:hidden;"></div>
      </div>
    `;
  }

  function viewZones() {
    const screens = Array.from(new Set(asArray(_draft?.UILayout).map(r => String(r?.ScreenId || r?.screenId)).filter(Boolean))).sort();
    const zones = asArray(_draft?.UIZones);
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="opacity:.9;line-height:1.35;">Add a new zone into <b>UIZones</b> (used by LayoutScreen). Defaults are safe and minimal.</div>

        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">ScreenId</span>
            <input id="hbcr-zone-screen" placeholder="e.g. metamagic" list="hbcr-zone-screen-list" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
            <datalist id="hbcr-zone-screen-list">${screens.map(s => `<option value="${escapeHtml(s)}"></option>`).join("")}</datalist>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">ZoneId</span>
            <input id="hbcr-zone-id" placeholder="e.g. sidebar" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
          </label>
        </div>
        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">ParentZoneId (optional)</span>
            <input id="hbcr-zone-parent" placeholder="root" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:700;">PropsJson</span>
            <input id="hbcr-zone-props" value='{"direction":"column","gap":12}' style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;" />
          </label>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button type="button" id="hbcr-add-zone-btn" style="all:unset;cursor:pointer;padding:10px 12px;border-radius:12px;border:1px solid rgba(200,160,80,0.35);background:rgba(0,0,0,0.18);font-weight:800;">+ Add Zone</button>
          <div id="hbcr-add-zone-msg" style="opacity:.85;"></div>
        </div>

        <div style="margin-top:8px;border-top:1px solid rgba(200,160,80,0.18);padding-top:10px;">
          <div style="font-weight:800;margin-bottom:8px;">Current Zones in Draft</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${zones.slice(0, 120).map(z => `<div style="opacity:.9;display:flex;justify-content:space-between;gap:10px;">
              <div style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><b>${escapeHtml(String(z?.ScreenId || ""))}</b> • ${escapeHtml(String(z?.ZoneId || ""))}</div>
              <div style="opacity:.75;">${escapeHtml(String(z?.ParentZoneId || ""))}</div>
            </div>`).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function viewExport() {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="opacity:.9;line-height:1.35;">Copy current draft overrides for publishing to Sheets (UILayout/UIBindings/UIZones). This does not write anywhere; it only copies JSON.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <button type="button" id="hbcr-copy-draft" style="all:unset;cursor:pointer;padding:10px 12px;border-radius:12px;border:1px solid rgba(200,160,80,0.35);background:rgba(0,0,0,0.18);font-weight:800;">Copy Draft JSON</button>
          <button type="button" id="hbcr-clear-draft" style="all:unset;cursor:pointer;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,120,120,0.35);background:rgba(120,0,0,0.12);font-weight:800;">Clear Draft</button>
          <div id="hbcr-export-msg" style="opacity:.85;"></div>
        </div>
        <textarea readonly rows="14" style="width:100%;box-sizing:border-box;padding:10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.18);color:#e8dcc6;outline:none;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(JSON.stringify(_draft || {}, null, 2))}</textarea>
      </div>
    `;
  }

  // -------------------------
  // Wiring / actions
  // -------------------------
  function installActions(modal) {
    const right = modal._right;

    // delegate handler based on active tab
    right.addEventListener("click", async (e) => {
      const id = e.target?.id;
      if (!id) return;

      // Add Component
      if (id === "hbcr-add-component-btn") {
        const msg = right.querySelector("#hbcr-add-component-msg");
        const screen = (right.querySelector("#hbcr-add-screen")?.value || "").trim();
        const zone = (right.querySelector("#hbcr-add-zone")?.value || "root").trim() || "root";
        const type = (right.querySelector("#hbcr-add-type")?.value || "panel").trim();
        const bindingId = (right.querySelector("#hbcr-add-binding")?.value || "").trim();
        const propsRaw = (right.querySelector("#hbcr-add-props")?.value || "{}").trim();

        if (!screen) { if (msg) msg.textContent = "ScreenId required."; return; }
        let props = {};
        try { props = propsRaw ? JSON.parse(propsRaw) : {}; } catch { if (msg) msg.textContent = "Props JSON invalid."; return; }

        const next = clone(_draft);
        const componentId = nowId(type);
        const order = nextOrderWithin(asArray(next.UILayout), screen, zone);
        next.UILayout = asArray(next.UILayout).concat([{
          ScreenId: screen,
          ComponentId: componentId,
          Type: type,
          ParentId: "",
          ZoneId: zone,
          Slot: "",
          Order: order,
          Enabled: true,
          BindingId: bindingId,
          PropsJson: JSON.stringify(props || {}),
          StyleJson: "{}",
          VisibilityJson: "",
        }]);
        saveDraftNonDestructive(next);
        if (msg) msg.textContent = `Added ${type} (${componentId}) to ${screen}/${zone}.`;
        return;
      }

      // Create Binding
      if (id === "hbcr-add-binding-btn") {
        const msg = right.querySelector("#hbcr-add-binding-msg");
        const bid = (right.querySelector("#hbcr-bind-id")?.value || "").trim() || nowId("binding");
        const sheet = (right.querySelector("#hbcr-bind-sheet")?.value || "").trim();
        const labelField = (right.querySelector("#hbcr-bind-label")?.value || "name").trim();
        const valueField = (right.querySelector("#hbcr-bind-value")?.value || "id").trim();
        const iconField = (right.querySelector("#hbcr-bind-icon")?.value || "icon").trim();
        const descField = (right.querySelector("#hbcr-bind-desc")?.value || "desc").trim();
        const whereRaw = (right.querySelector("#hbcr-bind-where")?.value || "[]").trim();
        try { if (whereRaw) JSON.parse(whereRaw); } catch { if (msg) msg.textContent = "WhereJson must be valid JSON."; return; }

        const exists = asArray(_draft?.UIBindings).some(b => String(b?.BindingId || b?.bindingId) === bid);
        if (exists) { if (msg) msg.textContent = "BindingId already exists."; return; }

        const next = clone(_draft);
        next.UIBindings = asArray(next.UIBindings).concat([{
          BindingId: bid,
          SourceType: "sheet",
          SourceRef: sheet,
          ItemsPath: "",
          WhereJson: whereRaw || "[]",
          LabelField: labelField,
          IconField: iconField,
          ValueField: valueField,
          DescField: descField,
          SortField: "",
          SortDir: "asc",
        }]);
        saveDraftNonDestructive(next);
        if (msg) msg.textContent = `Created binding ${bid} → ${sheet}.`;
        return;
      }

      // Add Zone
      if (id === "hbcr-add-zone-btn") {
        const msg = right.querySelector("#hbcr-add-zone-msg");
        const screen = (right.querySelector("#hbcr-zone-screen")?.value || "").trim();
        const zid = (right.querySelector("#hbcr-zone-id")?.value || "").trim();
        const parent = (right.querySelector("#hbcr-zone-parent")?.value || "").trim();
        const propsRaw = (right.querySelector("#hbcr-zone-props")?.value || "{}").trim();
        try { if (propsRaw) JSON.parse(propsRaw); } catch { if (msg) msg.textContent = "PropsJson invalid JSON."; return; }
        if (!screen) { if (msg) msg.textContent = "ScreenId required."; return; }
        if (!zid) { if (msg) msg.textContent = "ZoneId required."; return; }

        const exists = asArray(_draft?.UIZones).some(z => String(z?.ScreenId || z?.screenId) === screen && String(z?.ZoneId || z?.zoneId) === zid);
        if (exists) { if (msg) msg.textContent = "Zone already exists for that screen."; return; }

        const next = clone(_draft);
        next.UIZones = asArray(next.UIZones).concat([{
          ScreenId: screen,
          ZoneId: zid,
          ParentZoneId: parent,
          Order: 0,
          Enabled: true,
          PropsJson: propsRaw || "{}",
          StyleJson: "{}",
        }]);
        saveDraftNonDestructive(next);
        if (msg) msg.textContent = `Added zone ${zid} on ${screen}.`;
        modal.render();
        return;
      }

      // Detect: mark seen
      if (id === "hbcr-mark-seen") {
        const seen = {};
        for (const sheet of (_index?.sheets || [])) {
          const list = _index.rowsBySheet.get(sheet) || [];
          seen[sheet] = list.map(it => it.rowKey);
        }
        writeJsonLS(LAST_SEEN_KEY, seen);
        modal.render();
        return;
      }

      // Export
      if (id === "hbcr-copy-draft") {
        const msg = right.querySelector("#hbcr-export-msg");
        try {
          await navigator.clipboard.writeText(JSON.stringify(_draft || {}, null, 2));
          if (msg) msg.textContent = "Copied draft JSON.";
        } catch {
          if (msg) msg.textContent = "Clipboard blocked.";
        }
        return;
      }
      if (id === "hbcr-clear-draft") {
        const msg = right.querySelector("#hbcr-export-msg");
        if (!confirm("Clear hbcr_design_draft? (This only clears local editor state)") ) return;
        writeDraft({});
        _draft = ensureDraftShape({}, _bundle);
        if (msg) msg.textContent = "Draft cleared.";
        modal.render();
        return;
      }
    });

    // Detect list live rendering
    right.addEventListener("input", (e) => {
      const active = modal._activeTab;
      if (active !== "detect") return;
      if (e.target?.id === "hbcr-detect-q") renderDetectList(right);
    });
    right.addEventListener("change", (e) => {
      const active = modal._activeTab;
      if (active !== "detect") return;
      const id = e.target?.id;
      if (id === "hbcr-detect-sheet" || id === "hbcr-detect-only-new" || id === "hbcr-detect-only-unbound") {
        renderDetectList(right);
      }
    });
  }

  function renderDetectList(right) {
    const listEl = right.querySelector("#hbcr-detect-list");
    if (!listEl) return;
    const sheet = right.querySelector("#hbcr-detect-sheet")?.value || "";
    const q = (right.querySelector("#hbcr-detect-q")?.value || "").trim().toLowerCase();
    const onlyNew = !!right.querySelector("#hbcr-detect-only-new")?.checked;
    const onlyUnbound = !!right.querySelector("#hbcr-detect-only-unbound")?.checked;
    const lastSeen = readJsonLS(LAST_SEEN_KEY, {});
    const prev = new Set(asArray(lastSeen?.[sheet]));

    const draftStr = JSON.stringify({ UILayout: _draft?.UILayout, UIBindings: _draft?.UIBindings, UIZones: _draft?.UIZones } || {});

    const items = (_index?.rowsBySheet.get(sheet) || []).filter(it => {
      const isNew = !prev.has(it.rowKey);
      const isMentioned = draftStr.includes(String(it.rowKey));
      if (onlyNew && !isNew) return false;
      if (onlyUnbound && isMentioned) return false;
      if (q && !it.searchText.includes(q)) return false;
      return true;
    }).slice(0, 200);

    if (!items.length) {
      listEl.innerHTML = `<div style="padding:10px;opacity:.85;">No matches.</div>`;
      return;
    }

    listEl.innerHTML = items.map(it => {
      const isNew = !prev.has(it.rowKey);
      const isMentioned = draftStr.includes(String(it.rowKey));
      return `
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 10px;border-top:1px solid rgba(200,160,80,0.14);">
          <div style="min-width:0;">
            <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(it.label)}</div>
            <div style="opacity:.75;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(it.rowKey)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            ${isNew ? `<span style="font-size:12px;padding:4px 8px;border-radius:999px;border:1px solid rgba(120,200,120,0.35);background:rgba(0,80,0,0.15);">NEW</span>` : ``}
            ${isMentioned ? `<span style="font-size:12px;padding:4px 8px;border-radius:999px;border:1px solid rgba(200,160,80,0.28);background:rgba(0,0,0,0.12);">BOUND</span>` : `<span style="font-size:12px;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,120,120,0.25);background:rgba(80,0,0,0.10);">UNBOUND</span>`}
          </div>
        </div>
      `;
    }).join("");
  }

  // -------------------------
  // Render loop
  // -------------------------
  function attachRenderer(modal) {
    modal.render = function () {
      const right = modal._right;
      if (!_bundle || !_draft || _error) {
        right.innerHTML = _error ? viewError() : `<div style="opacity:.85;padding:10px;">Loading…</div>`;
        return;
      }
      const active = modal._activeTab || "components";
      if (active === "components") right.innerHTML = viewComponents();
      else if (active === "bindings") right.innerHTML = viewBindings();
      else if (active === "detect") {
        right.innerHTML = viewDetect();
        // render list after DOM exists
        setTimeout(() => renderDetectList(right), 0);
      }
      else if (active === "zones") right.innerHTML = viewZones();
      else if (active === "export") right.innerHTML = viewExport();
      else right.innerHTML = viewComponents();
    };
  }

  // -------------------------
  // Boot
  // -------------------------
  (async function boot() {
    const btn = ensurePlusButton();
    const modal = ensureModal();
    attachRenderer(modal);
    installActions(modal);

    // Load initial data once.
    await ensureData();
    modal.render();

    btn.addEventListener("click", async () => {
      // refresh bundle+draft each open to "detect new rows" without requiring reload
      await ensureData();
      modal.render();
      modal.showModal();
    });
  })();
})();
