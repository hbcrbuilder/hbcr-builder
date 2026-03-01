/**
 * HBCR Editor Overlay (Inbox-first, non-coder friendly)
 *
 * HARD CONSTRAINTS (do not violate):
 * - Editor-only: runs ONLY when window.__HBCR_DESIGN__ is true (slot editor)
 * - DO NOT modify rendering logic, class/subclass filtering, or bundle fetch pipeline
 * - DO NOT assume sheet structure
 * - DO NOT rewrite CSS (inline styles only)
 * - ONLY write to design draft (localStorage: hbcr_design_draft)
 *   affecting ONLY UILayout / UIBindings / UIZones
 */
(function () {
  const DESIGN = !!window.__HBCR_DESIGN__;
  if (!DESIGN) return;

  // -------------------------
  // Storage keys
  // -------------------------
  const DRAFT_KEY = "hbcr_design_draft";
  const LAST_SEEN_KEY = "hbcr_editor_lastSeenRowKeys";

  // IMPORTANT: We only READ the bundle (same published JSON). We do not modify the app pipeline.
  const DEFAULT_BUNDLE_URL = "https://hbcr-api.hbcrbuilder.workers.dev/api/bundle";

  // -------------------------
  // Helpers
  // -------------------------
  const nowId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  function readJsonLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
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

  function asRows(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.rows)) return v.rows;
    return [];
  }

  function stableRowKey(row) {
    if (!row || typeof row !== "object") return "";
    const direct = row.id ?? row.Id ?? row.ID ?? row.key ?? row.Key ?? row.slug ?? row.Slug;
    if (direct != null && String(direct).trim()) return String(direct).trim();

    const idLike = Object.entries(row).find(([k, v]) => /(^|_)(id|uuid|key)$|Id$|ID$/i.test(String(k)) && v != null && String(v).trim());
    if (idLike) return String(idLike[1]).trim();

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
    const preferred = ["name","Name","title","Title","label","Label","ClassName","SubclassName","RaceName","TraitName","FeatName","SpellName","CantripName"]; 
    for (const k of preferred) {
      const v = row[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    for (const [_, v] of Object.entries(row)) {
      if (v != null && typeof v === "string" && v.trim()) return v.trim();
    }
    return rowKey;
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
    if (kind === "desc") return has(/^(desc|description|details|summary|text)$/i) || has(/desc/i) || has(/description/i) || has(/text/i) || "";
    return "";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toast(msg) {
    const id = "hbcr_inbox_toast";
    let t = document.getElementById(id);
    if (!t) {
      t = document.createElement("div");
      t.id = id;
      t.style.position = "fixed";
      t.style.left = "14px";
      t.style.bottom = "14px";
      t.style.zIndex = "999999";
      t.style.background = "rgba(0,0,0,.78)";
      t.style.border = "1px solid rgba(255,255,255,.15)";
      t.style.borderRadius = "12px";
      t.style.padding = "10px 12px";
      t.style.color = "rgba(255,255,255,.92)";
      t.style.fontSize = "12px";
      t.style.maxWidth = "60vw";
      t.style.boxShadow = "0 10px 30px rgba(0,0,0,.35)";
      t.style.pointerEvents = "none";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t.__hbcrTimer);
    t.__hbcrTimer = setTimeout(() => { t.style.opacity = "0"; }, 1800);
  }

  function currentScreenId() {
    // LayoutScreen exposes current rows in window.__HBCR_LAST_LAYOUT__ / __HBCR_LAST_ZONES__
    try {
      const r0 = (window.__HBCR_LAST_LAYOUT__ && window.__HBCR_LAST_LAYOUT__[0]) || null;
      if (r0 && (r0.ScreenId || r0.screenId)) return String(r0.ScreenId || r0.screenId);
      const z0 = (window.__HBCR_LAST_ZONES__ && window.__HBCR_LAST_ZONES__[0]) || null;
      if (z0 && (z0.ScreenId || z0.screenId)) return String(z0.ScreenId || z0.screenId);
    } catch {}
    return "builder";
  }

  // -------------------------
  // Bundle read (read-only)
  // -------------------------
  async function fetchBundle() {
    const base = (window.__HBCR_BUNDLE_URL__ || DEFAULT_BUNDLE_URL);
    const url = base + (base.includes("?") ? "&" : "?") + "t=" + Date.now();
    const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
    if (!res.ok) throw new Error(`bundle fetch failed: ${res.status}`);
    return await res.json();
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
        const label = bestLabel(row, key);
        indexed.push({
          sheet,
          rowKey: key,
          label,
          searchText: (label + " " + key + " " + JSON.stringify(row)).toLowerCase(),
          row,
        });
      }
      if (indexed.length) {
        out.sheets.push(sheet);
        out.rowsBySheet.set(sheet, indexed);
      }
    }
    return out;
  }

  // -------------------------
  // Draft base (safe)
  // -------------------------
  async function ensureDraftBase() {
    // We want draft to contain FULL tables (UILayout/UIBindings/UIZones) so we don't drop other screens.
    const draft = readDraft() || {};
    if (draft.UILayout && draft.UIBindings && draft.UIZones) return draft;

    const b = await fetchBundle();
    const next = {
      ...draft,
      UILayout: draft.UILayout || asRows(b?.UILayout),
      UIBindings: draft.UIBindings || asRows(b?.UIBindings),
      UIZones: draft.UIZones || asRows(b?.UIZones),
    };
    writeDraft(next);
    return next;
  }

  // -------------------------
  // Placement mode (click-to-place)
  // -------------------------
  function startZonePick({ onPick }) {
    toast("Click a layout area to place it.");

    const hotCls = "hbcr-drop-hot";

    const onMove = (e) => {
      const z = e.target?.closest?.("[data-ui-zone]");
      document.querySelectorAll(`.${hotCls}`).forEach(el => el.classList.remove(hotCls));
      if (z) z.classList.add(hotCls);
    };

    const onClick = (e) => {
      const z = e.target?.closest?.("[data-ui-zone]");
      if (!z) return;
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      const zoneId = z.getAttribute("data-ui-zone") || "root";
      onPick(zoneId);
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        cleanup();
        toast("Cancelled.");
      }
    };

    function cleanup() {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.querySelectorAll(`.${hotCls}`).forEach(el => el.classList.remove(hotCls));
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);

    return cleanup;
  }

  // -------------------------
  // Create UI for a selected row (simple, safe defaults)
  // -------------------------
  function componentTypeFromSheet(sheet) {
    const s = String(sheet || "").toLowerCase();
    if (s.includes("trait")) return "dropdown";
    return "radial"; // default
  }

  function nodeTypeFromUiType(uiType) {
    // Must map to EXISTING renderer types (do not change renderer).
    // - "choiceGrid" renders a radial-like choice screen
    // - "panel" is a container
    if (uiType === "panel") return "panel";
    // Dropdown is not a native renderer type; we keep it as choiceGrid for now.
    return "choiceGrid";
  }

  function niceTitle(sheet, label) {
    const s = String(sheet || "");
    if (!s) return String(label || "Choose");
    return `${s}: ${label}`;
  }

  async function createUiForRow({ sheet, rowKey, label, row }) {
    const draft = await ensureDraftBase();
    const next = {
      UILayout: Array.isArray(draft.UILayout) ? [...draft.UILayout] : [],
      UIBindings: Array.isArray(draft.UIBindings) ? [...draft.UIBindings] : [],
      UIZones: Array.isArray(draft.UIZones) ? [...draft.UIZones] : [],
    };

    const screenId = currentScreenId();

    // Create a binding (hidden from the user)
    const keys = fieldKeysFromRow(row);
    const labelField = guessField(keys, "label");
    const valueField = guessField(keys, "value");
    const iconField = guessField(keys, "icon");
    const descField = guessField(keys, "desc");

    const bindingId = nowId("bind");
    const where = [{ field: valueField, op: "eq", value: rowKey }];

    next.UIBindings.push({
      BindingId: bindingId,
      SourceType: "sheet",
      SourceRef: sheet,
      LabelField: labelField,
      ValueField: valueField,
      IconField: iconField,
      DescField: descField,
      WhereJson: JSON.stringify(where),
    });

    // Ask user to pick a zone (click-to-place)
    startZonePick({
      onPick: (zoneId) => {
        const uiType = componentTypeFromSheet(sheet);
        const nodeId = nowId("ui");
        const nodeType = nodeTypeFromUiType(uiType);

        // safe, minimal props (no JSON editing)
        const props = {
          title: niceTitle(sheet, label),
          subtitle: "",
        };

        next.UILayout.push({
          ScreenId: screenId,
          ComponentId: nodeId,
          Type: nodeType,
          ParentId: "",
          ZoneId: zoneId,
          Slot: "",
          Order: 0,
          BindingId: bindingId,
          PropsJson: JSON.stringify(props),
          Enabled: true,
        });
        // Save draft
        writeDraft(next);
        // The core app store isn't exposed; safest is a quick refresh in editor.
        toast("Added. Refreshing…");
        setTimeout(() => { try { location.reload(); } catch {} }, 350);
      }
    });
  }

  // -------------------------
  // Placed detection (best-effort)
  // -------------------------
  function buildPlacedSet(draft) {
    // Returns a set of "sheet|rowKey" that appear in bindings referenced by layout.
    const placed = new Set();
    try {
      const bindings = asRows(draft?.UIBindings);
      const layout = asRows(draft?.UILayout);
      const usedBindingIds = new Set(layout.map(r => String(r?.BindingId || r?.bindingId || "")).filter(Boolean));
      for (const b of bindings) {
        const bid = String(b?.BindingId || b?.bindingId || "");
        if (!bid || !usedBindingIds.has(bid)) continue;
        const sheet = String(b?.SourceRef || b?.sourceRef || "");
        const where = String(b?.WhereJson || b?.whereJson || "");
        const m = where.match(/\"value\"\s*:\s*\"([^\"]+)\"/);
        if (sheet && m?.[1]) placed.add(`${sheet}|${m[1]}`);
      }
    } catch {}
    return placed;
  }

  // -------------------------
  // UI (single-screen inbox)
  // -------------------------
  function ensureFab() {
    if (document.getElementById("hbcr_inbox_fab")) return;

    const fab = document.createElement("button");
    fab.id = "hbcr_inbox_fab";
    fab.type = "button";
    fab.textContent = "+";
    fab.title = "Add";
    fab.style.position = "fixed";
    fab.style.right = "18px";
    fab.style.bottom = "18px";
    fab.style.zIndex = "999999";
    fab.style.width = "44px";
    fab.style.height = "44px";
    fab.style.borderRadius = "14px";
    fab.style.border = "1px solid rgba(255,255,255,.18)";
    fab.style.background = "rgba(0,0,0,.75)";
    fab.style.color = "rgba(255,255,255,.92)";
    fab.style.fontSize = "22px";
    fab.style.cursor = "pointer";
    fab.style.boxShadow = "0 12px 30px rgba(0,0,0,.35)";

    fab.addEventListener("click", () => openInbox());

    document.body.appendChild(fab);
  }

  function openInbox() {
    if (document.getElementById("hbcr_inbox_modal")) return;

    const overlay = document.createElement("div");
    overlay.id = "hbcr_inbox_modal";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "999998";
    overlay.style.background = "rgba(0,0,0,.45)";

    const card = document.createElement("div");
    card.style.position = "fixed";
    card.style.left = "50%";
    card.style.top = "50%";
    card.style.transform = "translate(-50%, -50%)";
    card.style.width = "min(980px, calc(100vw - 40px))";
    card.style.maxHeight = "min(760px, calc(100vh - 40px))";
    card.style.overflow = "hidden";
    card.style.borderRadius = "16px";
    card.style.background = "rgba(8,8,8,.92)";
    card.style.border = "1px solid rgba(255,255,255,.14)";
    card.style.boxShadow = "0 18px 45px rgba(0,0,0,.45)";
    card.style.display = "flex";
    card.style.flexDirection = "column";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.padding = "12px 14px";
    header.style.borderBottom = "1px solid rgba(255,255,255,.10)";

    const hLeft = document.createElement("div");
    hLeft.innerHTML = `<div style="font-size:14px;font-weight:700;color:rgba(255,255,255,.92)">Add Content</div><div style="font-size:12px;color:rgba(255,255,255,.70)">Search the published bundle, then click where it should go.</div>`;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Close";
    closeBtn.style.borderRadius = "12px";
    closeBtn.style.padding = "6px 10px";
    closeBtn.style.border = "1px solid rgba(255,255,255,.16)";
    closeBtn.style.background = "rgba(255,255,255,.06)";
    closeBtn.style.color = "rgba(255,255,255,.9)";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", () => overlay.remove());

    header.appendChild(hLeft);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.style.display = "grid";
    body.style.gridTemplateColumns = "1.3fr 0.7fr";
    body.style.gap = "12px";
    body.style.padding = "12px";
    body.style.flex = "1";
    body.style.overflow = "hidden";

    // Left: search + results
    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.gap = "10px";
    left.style.minHeight = "0";

    const searchRow = document.createElement("div");
    searchRow.style.display = "flex";
    searchRow.style.gap = "8px";
    searchRow.style.alignItems = "center";

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search (e.g. Oathbreaker, Metamagic, Darkvision)…";
    search.style.flex = "1";
    search.style.padding = "10px 12px";
    search.style.borderRadius = "12px";
    search.style.border = "1px solid rgba(255,255,255,.16)";
    search.style.background = "rgba(255,255,255,.06)";
    search.style.color = "rgba(255,255,255,.92)";
    search.style.outline = "none";

    const filter = document.createElement("select");
    filter.style.padding = "10px 10px";
    filter.style.borderRadius = "12px";
    filter.style.border = "1px solid rgba(255,255,255,.16)";
    filter.style.background = "rgba(255,255,255,.06)";
    filter.style.color = "rgba(255,255,255,.92)";
    filter.innerHTML = `
      <option value="unplaced">Unplaced</option>
      <option value="new">New</option>
      <option value="all">All</option>
    `;

    const markSeen = document.createElement("button");
    markSeen.type = "button";
    markSeen.textContent = "Mark seen";
    markSeen.style.padding = "10px 10px";
    markSeen.style.borderRadius = "12px";
    markSeen.style.border = "1px solid rgba(255,255,255,.16)";
    markSeen.style.background = "rgba(255,255,255,.06)";
    markSeen.style.color = "rgba(255,255,255,.92)";
    markSeen.style.cursor = "pointer";

    searchRow.appendChild(search);
    searchRow.appendChild(filter);
    searchRow.appendChild(markSeen);

    const results = document.createElement("div");
    results.style.flex = "1";
    results.style.minHeight = "0";
    results.style.overflow = "auto";
    results.style.borderRadius = "12px";
    results.style.border = "1px solid rgba(255,255,255,.10)";
    results.style.background = "rgba(0,0,0,.25)";

    left.appendChild(searchRow);
    left.appendChild(results);

    // Right: details + big actions
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.flexDirection = "column";
    right.style.gap = "10px";
    right.style.minHeight = "0";

    const details = document.createElement("div");
    details.style.borderRadius = "12px";
    details.style.border = "1px solid rgba(255,255,255,.10)";
    details.style.background = "rgba(0,0,0,.25)";
    details.style.padding = "12px";
    details.style.color = "rgba(255,255,255,.90)";
    details.style.fontSize = "13px";
    details.innerHTML = `<div style="opacity:.75">Pick something from the list.</div>`;

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Create UI for this → click to place";
    addBtn.disabled = true;
    addBtn.style.width = "100%";
    addBtn.style.padding = "12px 12px";
    addBtn.style.borderRadius = "12px";
    addBtn.style.border = "1px solid rgba(255,255,255,.16)";
    addBtn.style.background = "rgba(255,255,255,.08)";
    addBtn.style.color = "rgba(255,255,255,.92)";
    addBtn.style.cursor = "pointer";

    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.textContent = "Reset draft";
    undoBtn.style.width = "100%";
    undoBtn.style.padding = "10px 12px";
    undoBtn.style.borderRadius = "12px";
    undoBtn.style.border = "1px solid rgba(255,255,255,.16)";
    undoBtn.style.background = "rgba(255,255,255,.04)";
    undoBtn.style.color = "rgba(255,255,255,.88)";
    undoBtn.style.cursor = "pointer";

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.textContent = "Copy draft JSON";
    exportBtn.style.width = "100%";
    exportBtn.style.padding = "10px 12px";
    exportBtn.style.borderRadius = "12px";
    exportBtn.style.border = "1px solid rgba(255,255,255,.16)";
    exportBtn.style.background = "rgba(255,255,255,.04)";
    exportBtn.style.color = "rgba(255,255,255,.88)";
    exportBtn.style.cursor = "pointer";

    right.appendChild(details);
    right.appendChild(addBtn);
    right.appendChild(exportBtn);
    right.appendChild(undoBtn);

    body.appendChild(left);
    body.appendChild(right);

    card.appendChild(header);
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // State
    let bundle = null;
    let index = null;
    let selected = null;

    // Load + render
    (async () => {
      results.innerHTML = `<div style="padding:12px;color:rgba(255,255,255,.75)">Loading bundle…</div>`;
      try {
        bundle = await fetchBundle();
        index = buildBundleIndex(bundle);
        await ensureDraftBase();
        render();
      } catch (e) {
        results.innerHTML = `<div style="padding:12px;color:rgba(255,180,180,.95)">Failed to load bundle. Check /api/bundle.</div>`;
      }
    })();

    function getLastSeen() {
      return readJsonLS(LAST_SEEN_KEY, {});
    }
    function setLastSeen(v) {
      writeJsonLS(LAST_SEEN_KEY, v || {});
    }

    function isNew(sheet, rowKey) {
      const seen = getLastSeen();
      const set = new Set(Array.isArray(seen?.[sheet]) ? seen[sheet] : []);
      return !set.has(rowKey);
    }

    function markAllSeen() {
      if (!index) return;
      const seen = getLastSeen();
      for (const sheet of index.sheets) {
        const arr = index.rowsBySheet.get(sheet) || [];
        seen[sheet] = arr.map(r => r.rowKey);
      }
      setLastSeen(seen);
      toast("Marked as seen.");
      render();
    }

    function render() {
      if (!index) return;
      const q = String(search.value || "").trim().toLowerCase();
      const mode = String(filter.value || "unplaced");

      const draft = readDraft() || {};
      const placed = buildPlacedSet(draft);

      const blocks = [];
      for (const sheet of index.sheets) {
        const rows = index.rowsBySheet.get(sheet) || [];
        let list = rows;
        if (q) list = list.filter(r => r.searchText.includes(q));

        if (mode === "new") list = list.filter(r => isNew(r.sheet, r.rowKey));
        if (mode === "unplaced") list = list.filter(r => !placed.has(`${r.sheet}|${r.rowKey}`));

        if (!list.length) continue;

        const itemsHtml = list.slice(0, 250).map(r => {
          const key = `${r.sheet}|${r.rowKey}`;
          const isPlaced = placed.has(key);
          const badge = isPlaced ? `<span style="font-size:11px;opacity:.65">Placed</span>` : `<span style="font-size:11px;color:rgba(180,255,190,.9)">Not placed</span>`;
          return `
            <div data-pick="${esc(key)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.06);cursor:pointer">
              <div style="min-width:0">
                <div style="font-size:13px;color:rgba(255,255,255,.92);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</div>
                <div style="font-size:12px;opacity:.65">${esc(r.rowKey)}</div>
              </div>
              <div>${badge}</div>
            </div>
          `;
        }).join("");

        blocks.push(`
          <div style="border-bottom:1px solid rgba(255,255,255,.08)">
            <div style="padding:10px 12px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:rgba(255,255,255,.65);background:rgba(255,255,255,.03)">${esc(sheet)}</div>
            ${itemsHtml}
          </div>
        `);
      }

      results.innerHTML = blocks.length
        ? blocks.join("")
        : `<div style="padding:12px;color:rgba(255,255,255,.70)">No matches.</div>`;

      // click handlers
      results.querySelectorAll("[data-pick]").forEach(el => {
        el.addEventListener("click", () => {
          const key = el.getAttribute("data-pick");
          const [sheet, rowKey] = String(key).split("|");
          const row = (index.rowsBySheet.get(sheet) || []).find(r => r.rowKey === rowKey);
          if (!row) return;
          selected = row;
          addBtn.disabled = false;

          const newBadge = isNew(sheet, rowKey) ? `<span style="font-size:11px;color:rgba(255,220,140,.95)">New</span>` : `<span style="font-size:11px;opacity:.65">Seen</span>`;
          details.innerHTML = `
            <div style="font-size:14px;font-weight:700">${esc(row.label)}</div>
            <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span style="font-size:12px;opacity:.75">${esc(sheet)}</span>
              <span style="font-size:12px;opacity:.75">•</span>
              <span style="font-size:12px;opacity:.75">${esc(row.rowKey)}</span>
              <span style="font-size:12px;opacity:.75">•</span>
              ${newBadge}
            </div>
            <div style="margin-top:10px;font-size:12px;opacity:.75">Next: click “Create UI…” then click where it should go.</div>
          `;

          // Mark selected as seen automatically
          const seen = getLastSeen();
          const arr = Array.isArray(seen?.[sheet]) ? seen[sheet] : [];
          if (!arr.includes(rowKey)) {
            seen[sheet] = [...arr, rowKey];
            setLastSeen(seen);
          }
        });
      });
    }

    search.addEventListener("input", render);
    filter.addEventListener("change", render);
    markSeen.addEventListener("click", markAllSeen);

    addBtn.addEventListener("click", async () => {
      if (!selected) return;
      overlay.remove();
      try {
        await createUiForRow(selected);
      } catch (e) {
        toast("Could not add. Check console.");
        console.error(e);
      }
    });

    undoBtn.addEventListener("click", () => {
      if (!confirm("Clear local editor draft? This does NOT change the sheet.")) return;
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      toast("Draft cleared. Refreshing…");
      setTimeout(() => { try { location.reload(); } catch {} }, 350);
      render();
    });

    exportBtn.addEventListener("click", async () => {
      const draft = readDraft() || {};
      const text = JSON.stringify(draft, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        toast("Draft JSON copied.");
      } catch {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast("Draft JSON copied.");
      }
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.addEventListener("keydown", function onKey(e) {
      if (!document.getElementById("hbcr_inbox_modal")) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (e.key === "Escape") overlay.remove();
    });

    // initial focus
    setTimeout(() => { try { search.focus(); } catch {} }, 50);
  }

  // Install
  ensureFab();
})();
