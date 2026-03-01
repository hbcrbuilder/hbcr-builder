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
  // UX goals (non-coder friendly)
  // -------------------------
  // - Default UI is a guided wizard (no IDs, no JSON)
  // - Advanced drawer reveals raw fields for power users
  // - All writes are ONLY to UILayout/UIBindings/UIZones draft in localStorage
  // - No renderer/filter/bundle pipeline modifications

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

  function fieldKeysFromRow(row) {
    if (!row || typeof row !== "object") return [];
    return Object.keys(row);
  }

  function guessField(keys, kind) {
    const k = (keys || []).map(String);
    const has = (re) => k.find(x => re.test(x));
    if (kind === "label") return has(/^(name|title|label)$/i) || has(/name$/i) || has(/title$/i) || (k[0] || "name");
    if (kind === "value") return has(/^(id|key|slug|uuid)$/i) || has(/id$/i) || has(/key$/i) || (k[0] || "id");
    if (kind === "icon") return has(/^icon$/i) || has(/icon/i) || "";
    if (kind === "desc") return has(/^(desc|description|details|summary)$/i) || has(/desc/i) || has(/description/i) || "";
    return "";
  }

  function titleCase(s) {
    return String(s || "").replace(/[_\-]+/g, " ").replace(/\b\w/g, m => m.toUpperCase()).trim();
  }

  function toast(msg, ok = true) {
    try {
      const id = "hbcr_editor_toast";
      let t = document.getElementById(id);
      if (!t) {
        t = el("div", { id, style: [
          "position:fixed",
          "left:14px",
          "bottom:14px",
          "z-index:999999",
          "padding:10px 12px",
          "border-radius:12px",
          "border:1px solid rgba(200,160,80,0.30)",
          "background:rgba(0,0,0,0.35)",
          "color:#e8dcc6",
          "backdrop-filter: blur(4px)",
          "max-width:min(520px, calc(100vw - 28px))",
          "opacity:0",
          "transform:translateY(8px)",
          "transition:opacity .18s ease, transform .18s ease",
          "pointer-events:none",
          "font-weight:700",
        ].join(";") });
        document.body.appendChild(t);
      }
      t.style.borderColor = ok ? "rgba(200,160,80,0.30)" : "rgba(255,120,120,0.40)";
      t.innerHTML = escapeHtml(msg);
      requestAnimationFrame(() => {
        t.style.opacity = "1";
        t.style.transform = "translateY(0px)";
      });
      clearTimeout(t._timer);
      t._timer = setTimeout(() => {
        t.style.opacity = "0";
        t.style.transform = "translateY(8px)";
      }, 2200);
    } catch {}
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
      { id: "wizard", label: "Add to Layout" },
      { id: "sources", label: "Content Sources" },
      { id: "new", label: "New Content" },
      { id: "areas", label: "Layout Areas" },
      { id: "export", label: "Save / Export" },
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
    setActiveTab("wizard");
    return root;
  }

  // -------------------------
  // Main overlay controller
  // -------------------------
  let _bundle = null;
  let _index = null;
  let _draft = null;
  let _error = "";

  // wizard state (editor-only)
  let _advanced = false;
  let _wizStep = 1;
  let _wizTemplate = "radial";
  let _wizName = "";
  let _wizSheet = "";
  let _wizSearch = "";
  let _wizSingleRow = false;
  let _wizSelectedRowKey = "";
  let _wizScreen = "";
  let _wizZone = "root";

  function resetWizard() {
    _wizStep = 1;
    _wizTemplate = "radial";
    _wizName = "";
    _wizSheet = (_index?.sheets?.[0] || "");
    _wizSearch = "";
    _wizSingleRow = false;
    _wizSelectedRowKey = "";
    _wizScreen = "";
    _wizZone = "root";
  }

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

  function viewWizard() {
    const screens = Array.from(new Set(asArray(_draft?.UILayout).map(r => String(r?.ScreenId || r?.screenId)).filter(Boolean))).sort();
    const zones = asArray(_draft?.UIZones).map(z => String(z?.ZoneId || z?.zoneId)).filter(Boolean);
    const sheets = asArray(_index?.sheets);

    if (!_wizSheet) _wizSheet = sheets[0] || "";
    const rows = (_index?.rowsBySheet?.get(_wizSheet) || []);
    const filtered = !_wizSearch ? rows : rows.filter(r => r.searchText.includes(String(_wizSearch).toLowerCase()));
    const showRows = filtered.slice(0, 120);

    const templateCards = [
      { id: "radial", title: "Radial (selection wheel)", desc: "Shows a list of choices (like Race/Class/Subclass)." },
      { id: "dropdown", title: "Dropdown", desc: "Shows a compact list selector." },
      { id: "panel", title: "Panel / Box", desc: "A simple container with a title." },
      { id: "button", title: "Button / Choice", desc: "A single clickable option." },
    ];

    const stepHdr = (n, label) => `<div style="display:flex;gap:10px;align-items:center;">
      <div style="width:26px;height:26px;border-radius:999px;border:1px solid rgba(200,160,80,0.28);display:flex;align-items:center;justify-content:center;font-weight:900;background:${_wizStep===n?"rgba(200,160,80,0.15)":"rgba(0,0,0,0.12)"};">${n}</div>
      <div style="font-weight:900;">${escapeHtml(label)}</div>
    </div>`;

    const advToggle = `
      <label style="display:flex;gap:8px;align-items:center;cursor:pointer;user-select:none;opacity:.92;">
        <input id="hbcr-adv" type="checkbox" ${_advanced?"checked":""} />
        <span style="font-weight:800;">Advanced</span>
      </label>
    `;

    const nav = `
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <div style="opacity:.9;line-height:1.35;">Add something to the layout using a simple wizard. This only updates your local draft (safe).</div>
        ${advToggle}
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px;">
        <button type="button" id="hbcr-wiz-prev" style="all:unset;cursor:pointer;padding:8px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.25);background:rgba(0,0,0,0.12);font-weight:900;opacity:${_wizStep===1?".45":"1"};">Back</button>
        <button type="button" id="hbcr-wiz-next" style="all:unset;cursor:pointer;padding:8px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.35);background:rgba(0,0,0,0.18);font-weight:900;">Next</button>
        <button type="button" id="hbcr-wiz-reset" style="all:unset;cursor:pointer;padding:8px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.18);background:rgba(0,0,0,0.10);font-weight:900;opacity:.9;">Reset</button>
      </div>
    `;

    const step1 = `
      ${stepHdr(1, "Choose what you're adding")}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
        ${templateCards.map(c => `
          <button type="button" data-template="${escapeHtml(c.id)}" style="all:unset;cursor:pointer;padding:12px;border-radius:14px;border:1px solid ${_wizTemplate===c.id?"rgba(200,160,80,0.40)":"rgba(200,160,80,0.18)"};background:${_wizTemplate===c.id?"rgba(200,160,80,0.12)":"rgba(0,0,0,0.12)"};">
            <div style="font-weight:900;margin-bottom:4px;">${escapeHtml(c.title)}</div>
            <div style="opacity:.88;line-height:1.25;">${escapeHtml(c.desc)}</div>
          </button>
        `).join("")}
      </div>
      <label style="display:flex;flex-direction:column;gap:6px;margin-top:12px;">
        <span style="font-weight:900;">Name (optional)</span>
        <input id="hbcr-wiz-name" placeholder="e.g. Trait Picker" value="${escapeHtml(_wizName)}" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
        <div style="opacity:.78;font-size:12px;line-height:1.25;">This is just a friendly label. Internal IDs are generated for you.</div>
      </label>
    `;

    const sheetOpts = sheets.map(s => `<option value="${escapeHtml(s)}" ${s===_wizSheet?"selected":""}>${escapeHtml(titleCase(s))}</option>`).join("");

    const step2 = `
      ${stepHdr(2, "Pick the content it should show")}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
        <label style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-weight:900;">Content list (bundle sheet)</span>
          <select id="hbcr-wiz-sheet" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">${sheetOpts}</select>
        </label>
        <label style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-weight:900;">Search (optional)</span>
          <input id="hbcr-wiz-search" placeholder="type to search…" value="${escapeHtml(_wizSearch)}" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
        </label>
      </div>

      <label style="display:flex;gap:8px;align-items:center;margin-top:10px;cursor:pointer;user-select:none;">
        <input id="hbcr-wiz-single" type="checkbox" ${_wizSingleRow?"checked":""} />
        <span style="font-weight:900;">Only show one item (optional)</span>
        <span style="opacity:.78;font-size:12px;">(advanced usage; usually leave off)</span>
      </label>

      <div id="hbcr-wiz-rowpick" style="margin-top:10px;${_wizSingleRow?"":"display:none;"}">
        <div style="font-weight:900;margin-bottom:6px;">Choose the item</div>
        <div style="max-height:240px;overflow:auto;border:1px solid rgba(200,160,80,0.18);border-radius:14px;background:rgba(0,0,0,0.12);">
          ${showRows.map(r => `
            <button type="button" data-rowkey="${escapeHtml(r.rowKey)}" style="all:unset;display:block;cursor:pointer;width:100%;box-sizing:border-box;padding:10px 12px;border-bottom:1px solid rgba(200,160,80,0.10);background:${_wizSelectedRowKey===r.rowKey?"rgba(200,160,80,0.10)":"transparent"};">
              <div style="font-weight:900;">${escapeHtml(r.label)}</div>
              <div style="opacity:.75;font-size:12px;">${escapeHtml(r.rowKey)} • ${escapeHtml(titleCase(r.sheet))}</div>
            </button>
          `).join("") || `<div style="padding:12px;opacity:.8;">No matches.</div>`}
        </div>
      </div>

      ${_advanced ? `
        <div style="margin-top:12px;padding:10px;border-radius:14px;border:1px solid rgba(200,160,80,0.18);background:rgba(0,0,0,0.10);">
          <div style="font-weight:900;margin-bottom:6px;">Advanced (content fields)</div>
          <div style="opacity:.82;line-height:1.25;font-size:12px;">We'll auto-pick fields for you when we build the Content Source. You can adjust them later under “Content Sources”.</div>
        </div>
      ` : ""}
    `;

    const screenOpts = screens.map(s => `<option value="${escapeHtml(s)}" ${s===_wizScreen?"selected":""}>${escapeHtml(titleCase(s))}</option>`).join("");
    const zoneOpts = (zones.length ? zones : ["root"]).map(z => `<option value="${escapeHtml(z)}" ${z===_wizZone?"selected":""}>${escapeHtml(titleCase(z))}</option>`).join("");

    const step3 = `
      ${stepHdr(3, "Choose where it goes")}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
        <label style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-weight:900;">Screen</span>
          <select id="hbcr-wiz-screen" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">
            <option value="">(pick one)</option>
            ${screenOpts}
          </select>
          <div style="opacity:.78;font-size:12px;">If you don’t see the screen yet, open it once, then come back.</div>
        </label>
        <label style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-weight:900;">Area</span>
          <select id="hbcr-wiz-zone" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">${zoneOpts}</select>
        </label>
      </div>

      <div style="display:flex;gap:10px;align-items:center;margin-top:12px;">
        <button type="button" id="hbcr-wiz-create" style="all:unset;cursor:pointer;padding:10px 12px;border-radius:12px;border:1px solid rgba(200,160,80,0.38);background:rgba(0,0,0,0.18);font-weight:1000;">Add to Layout</button>
        <div style="opacity:.85;">This writes to your local draft only.</div>
      </div>

      ${_advanced ? `
        <div style="margin-top:12px;padding:10px;border-radius:14px;border:1px solid rgba(200,160,80,0.18);background:rgba(0,0,0,0.10);">
          <div style="font-weight:900;margin-bottom:6px;">Advanced</div>
          <div style="opacity:.82;font-size:12px;line-height:1.25;">Raw IDs / JSON editing is available under the “Save / Export” tab.</div>
        </div>
      ` : ""}
    `;

    const content = (_wizStep === 1 ? step1 : _wizStep === 2 ? step2 : step3);
    return `<div style="display:flex;flex-direction:column;gap:12px;">${nav}${content}</div>`;
  }

  function viewSources() {
    const sheets = asArray(_index?.sheets);
    const existing = asArray(_draft?.UIBindings);
    const list = existing.map(b => {
      const id = String(b?.BindingId || b?.bindingId || "");
      const src = String(b?.SourceRef || b?.sourceRef || b?.Sheet || b?.sheet || "");
      return { id, src, raw: b };
    }).filter(x => x.id);

    const sheetOpts = sheets.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(titleCase(s))}</option>`).join("");
    return `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="opacity:.92;line-height:1.35;">
          <div style="font-weight:1000;margin-bottom:4px;">Content Sources</div>
          A “Content Source” tells the UI what list of items to show (from the published bundle). This is editor-only and safe.
        </div>

        <div style="padding:10px;border-radius:14px;border:1px solid rgba(200,160,80,0.18);background:rgba(0,0,0,0.10);">
          <div style="font-weight:1000;margin-bottom:6px;">Create a new Content Source</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <label style="display:flex;flex-direction:column;gap:6px;">
              <span style="font-weight:900;">Name</span>
              <input id="hbcr-src-id" placeholder="e.g. Traits_All" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;" />
            </label>
            <label style="display:flex;flex-direction:column;gap:6px;">
              <span style="font-weight:900;">Bundle sheet</span>
              <select id="hbcr-src-sheet" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:12px;border:1px solid rgba(200,160,80,0.22);background:rgba(0,0,0,0.2);color:#e8dcc6;outline:none;">${sheetOpts}</select>
            </label>
          </div>
          <div style="opacity:.78;font-size:12px;margin-top:8px;line-height:1.25;">We auto-pick display/value/icon fields based on what’s in that sheet. You can adjust in Advanced mode later.</div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:10px;">
            <button type="button" id="hbcr-src-create" style="all:unset;cursor:pointer;padding:9px 12px;border-radius:12px;border:1px solid rgba(200,160,80,0.35);background:rgba(0,0,0,0.18);font-weight:1000;">+ Create Content Source</button>
            <div id="hbcr-src-msg" style="opacity:.85;"></div>
          </div>
        </div>

        <div style="font-weight:1000;">Existing</div>
        <div style="border:1px solid rgba(200,160,80,0.18);border-radius:14px;overflow:hidden;background:rgba(0,0,0,0.10);">
          ${list.length ? list.map(x => `
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid rgba(200,160,80,0.10);">
              <div>
                <div style="font-weight:900;">${escapeHtml(x.id)}</div>
                <div style="opacity:.78;font-size:12px;">Sheet: ${escapeHtml(titleCase(x.src || "(unknown)"))}</div>
              </div>
              <button type="button" data-del-src="${escapeHtml(x.id)}" style="all:unset;cursor:pointer;padding:7px 10px;border-radius:12px;border:1px solid rgba(255,120,120,0.30);background:rgba(120,0,0,0.10);font-weight:900;">Remove</button>
            </div>
          `).join("") : `<div style="padding:12px;opacity:.85;">No content sources yet.</div>`}
        </div>
      </div>
    `;
  }

  function viewNewContent() {
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
          <div style="font-weight:1000;">New Content</div>
          <div style="opacity:.85;">New since last seen: <b>${totalNew}</b> • Not referenced in layout draft: <b>${totalUnbound}</b></div>
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

  function viewAreas() {
    const zones = asArray(_draft?.UIZones);
    const zoneIds = zones.map(z => String(z?.ZoneId || z?.zoneId)).filter(Boolean);
    return `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="opacity:.92;line-height:1.35;">
          <div style="font-weight:1000;margin-bottom:4px;">Layout Areas</div>
          Areas are where components can be placed. You usually don’t need to touch this.
        </div>
        <div style="border:1px solid rgba(200,160,80,0.18);border-radius:14px;overflow:hidden;background:rgba(0,0,0,0.10);">
          ${(zoneIds.length ? zoneIds : ["root"]).map(z => `
            <div style="padding:10px 12px;border-bottom:1px solid rgba(200,160,80,0.10);">
              <div style="font-weight:900;">${escapeHtml(titleCase(z))}</div>
              <div style="opacity:.75;font-size:12px;">ZoneId: ${escapeHtml(z)}</div>
            </div>
          `).join("")}
        </div>
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
      const activeTab = modal._activeTab || "wizard";
      const id = e.target?.id || "";

      // -------------------------
      // Wizard interactions (non-coder friendly)
      // -------------------------
      if (activeTab === "wizard") {
        const tplBtn = e.target?.closest?.("[data-template]");
        if (tplBtn) {
          _wizTemplate = tplBtn.getAttribute("data-template") || _wizTemplate;
          modal.render();
          return;
        }
        const rowBtn = e.target?.closest?.("[data-rowkey]");
        if (rowBtn) {
          _wizSelectedRowKey = rowBtn.getAttribute("data-rowkey") || "";
          modal.render();
          return;
        }

        if (id === "hbcr-wiz-prev") {
          _wizStep = Math.max(1, _wizStep - 1);
          modal.render();
          return;
        }
        if (id === "hbcr-wiz-next") {
          // minimal validation per step
          if (_wizStep === 2 && _wizSingleRow && !_wizSelectedRowKey) {
            toast("Pick an item (or turn off ‘Only show one item’).", false);
            return;
          }
          _wizStep = Math.min(3, _wizStep + 1);
          modal.render();
          return;
        }
        if (id === "hbcr-wiz-reset") {
          resetWizard();
          modal.render();
          return;
        }
        if (id === "hbcr-wiz-create") {
          const screen = String(_wizScreen || "").trim();
          const zone = String(_wizZone || "root").trim() || "root";
          const sheet = String(_wizSheet || "").trim();
          if (!screen) { toast("Choose a Screen first.", false); return; }
          if (!sheet) { toast("Choose a content list (sheet).", false); return; }

          // Map friendly template → existing renderer-safe types.
          // We do NOT change renderer; we only use types it already understands.
          let type = "choiceGrid";
          if (_wizTemplate === "panel") type = "panel";
          // dropdown/button are currently represented as choiceGrid for safety.

          const list = (_index?.rowsBySheet?.get(sheet) || []);
          const firstRow = list[0]?.row || null;
          const keys = fieldKeysFromRow(firstRow);
          const labelField = guessField(keys, "label");
          const valueField = guessField(keys, "value");
          const iconField = guessField(keys, "icon");
          const descField = guessField(keys, "desc");

          const bindingId = nowId("src");
          const where = (_wizSingleRow && _wizSelectedRowKey)
            ? JSON.stringify([{ field: valueField, op: "eq", value: _wizSelectedRowKey }])
            : "[]";

          const next = clone(_draft);
          next.UIBindings = asArray(next.UIBindings).concat([{
            BindingId: bindingId,
            SourceType: "sheet",
            SourceRef: sheet,
            ItemsPath: "",
            WhereJson: where,
            LabelField: labelField,
            IconField: iconField,
            ValueField: valueField,
            DescField: descField,
            SortField: "",
            SortDir: "asc",
          }]);

          const componentId = nowId(type);
          const order = nextOrderWithin(asArray(next.UILayout), screen, zone);
          const title = (_wizName || titleCase(_wizTemplate)) + (sheet ? ` • ${titleCase(sheet)}` : "");
          const props = (type === "panel")
            ? { title }
            : { title, mode: _wizTemplate };

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
            PropsJson: JSON.stringify(props),
            StyleJson: "{}",
            VisibilityJson: "",
          }]);

          saveDraftNonDestructive(next);
          toast("Added to layout (saved to local draft).", true);
          resetWizard();
          modal.render();
          return;
        }
      }

      // -------------------------
      // Content Sources
      // -------------------------
      if (activeTab === "sources") {
        const del = e.target?.closest?.("[data-del-src]");
        if (del) {
          const bid = del.getAttribute("data-del-src") || "";
          if (!bid) return;
          const next = clone(_draft);
          next.UIBindings = asArray(next.UIBindings).filter(b => String(b?.BindingId || b?.bindingId) !== bid);
          saveDraftNonDestructive(next);
          toast("Removed content source.");
          modal.render();
          return;
        }
        if (id === "hbcr-src-create") {
          const msg = right.querySelector("#hbcr-src-msg");
          const name = (right.querySelector("#hbcr-src-id")?.value || "").trim();
          const sheet = (right.querySelector("#hbcr-src-sheet")?.value || "").trim();
          if (!name) { if (msg) msg.textContent = "Name is required."; toast("Name is required.", false); return; }
          if (!sheet) { if (msg) msg.textContent = "Choose a sheet."; toast("Choose a sheet.", false); return; }
          const exists = asArray(_draft?.UIBindings).some(b => String(b?.BindingId || b?.bindingId) === name);
          if (exists) { if (msg) msg.textContent = "That name already exists."; toast("That name already exists.", false); return; }

          const list = (_index?.rowsBySheet?.get(sheet) || []);
          const firstRow = list[0]?.row || null;
          const keys = fieldKeysFromRow(firstRow);
          const labelField = guessField(keys, "label");
          const valueField = guessField(keys, "value");
          const iconField = guessField(keys, "icon");
          const descField = guessField(keys, "desc");

          const next = clone(_draft);
          next.UIBindings = asArray(next.UIBindings).concat([{
            BindingId: name,
            SourceType: "sheet",
            SourceRef: sheet,
            ItemsPath: "",
            WhereJson: "[]",
            LabelField: labelField,
            IconField: iconField,
            ValueField: valueField,
            DescField: descField,
            SortField: "",
            SortDir: "asc",
          }]);
          saveDraftNonDestructive(next);
          if (msg) msg.textContent = `Created: ${name}`;
          toast("Created content source.");
          modal.render();
          return;
        }
      }

      // If no id, nothing else to do
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

      // New Content: mark seen
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

    // Wizard + sources model updates
    right.addEventListener("input", (e) => {
      const active = modal._activeTab || "wizard";
      const id = e.target?.id;
      if (active === "wizard") {
        if (id === "hbcr-wiz-name") _wizName = e.target.value || "";
        if (id === "hbcr-wiz-search") { _wizSearch = e.target.value || ""; modal.render(); }
      }
    });

    right.addEventListener("change", (e) => {
      const active = modal._activeTab || "wizard";
      const id = e.target?.id;
      if (active === "wizard") {
        if (id === "hbcr-adv") { _advanced = !!e.target.checked; modal.render(); }
        if (id === "hbcr-wiz-sheet") { _wizSheet = e.target.value || ""; _wizSelectedRowKey = ""; modal.render(); }
        if (id === "hbcr-wiz-single") { _wizSingleRow = !!e.target.checked; if (!_wizSingleRow) _wizSelectedRowKey = ""; modal.render(); }
        if (id === "hbcr-wiz-screen") _wizScreen = e.target.value || "";
        if (id === "hbcr-wiz-zone") _wizZone = e.target.value || "root";
      }
    });

    // Detect list live rendering
    right.addEventListener("input", (e) => {
      const active = modal._activeTab;
      if (active !== "new") return;
      if (e.target?.id === "hbcr-detect-q") renderDetectList(right);
    });
    right.addEventListener("change", (e) => {
      const active = modal._activeTab;
      if (active !== "new") return;
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
      const active = modal._activeTab || "wizard";
      if (active === "wizard") right.innerHTML = viewWizard();
      else if (active === "sources") right.innerHTML = viewSources();
      else if (active === "new") {
        right.innerHTML = viewNewContent();
        // render list after DOM exists
        setTimeout(() => renderDetectList(right), 0);
      }
      else if (active === "areas") right.innerHTML = viewAreas();
      else if (active === "export") right.innerHTML = viewExport();
      else right.innerHTML = viewWizard();
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
    resetWizard();
    modal.render();

    btn.addEventListener("click", async () => {
      // refresh bundle+draft each open to "detect new rows" without requiring reload
      await ensureData();
      modal.render();
      modal.showModal();
    });
  })();
})();
