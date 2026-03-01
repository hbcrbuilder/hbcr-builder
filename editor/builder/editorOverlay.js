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

  // ------------------------------------------------------------
  // Embedded Dock Mounting (NOT an overlay)
  // ------------------------------------------------------------
  const ui = { dock: null, results: null, search: null, filterAll: null, filterNew: null };
  const state = { open: false, filter: 'all', query: '' };

  function ensureRightGroup(topbar) {
    if (!topbar) return null;
    let right = topbar.querySelector(':scope > .hbcr-editor-right');
    if (right) return right;

    const version = topbar.querySelector(':scope > .version-pill');
    if (!version) return null;

    right = document.createElement('div');
    right.className = 'hbcr-editor-right';
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '10px';
    right.style.marginLeft = 'auto';

    topbar.insertBefore(right, version);
    right.appendChild(version);
    return right;
  }

  function ensureEmbeddedUI() {
    const app = document.getElementById('app');
    if (!app) return null;
    const topbar = app.querySelector('.topbar');
    if (!topbar) return null;

    const right = ensureRightGroup(topbar);
    if (!right) return null;

    let dock = right.querySelector('#hbcr_editor_dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'hbcr_editor_dock';
      dock.style.display = 'flex';
      dock.style.alignItems = 'center';
      dock.style.gap = '8px';
      dock.style.padding = '6px 10px';
      dock.style.borderRadius = '999px';
      dock.style.border = '1px solid rgba(212,175,55,0.22)';
      dock.style.background = 'rgba(0,0,0,0.26)';
      dock.style.color = 'rgba(232,220,198,0.95)';
      dock.style.fontSize = '12px';
      dock.style.letterSpacing = '0.08em';
      dock.style.textTransform = 'uppercase';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.textContent = '+ Add';
      addBtn.style.all = 'unset';
      addBtn.style.cursor = 'pointer';
      addBtn.style.padding = '4px 8px';
      addBtn.style.borderRadius = '10px';
      addBtn.style.border = '1px solid rgba(212,175,55,0.22)';
      addBtn.style.background = 'rgba(0,0,0,0.22)';
      addBtn.style.fontWeight = '700';
      addBtn.addEventListener('click', () => toggleOpen(true));

      const search = document.createElement('input');
      search.id = 'hbcr_editor_search';
      search.placeholder = 'Search content…';
      search.autocomplete = 'off';
      search.spellcheck = false;
      search.style.width = '220px';
      search.style.maxWidth = '34vw';
      search.style.padding = '6px 10px';
      search.style.borderRadius = '12px';
      search.style.border = '1px solid rgba(212,175,55,0.18)';
      search.style.background = 'rgba(0,0,0,0.22)';
      search.style.color = 'rgba(232,220,198,0.95)';
      search.style.outline = 'none';
      search.style.textTransform = 'none';
      search.style.letterSpacing = '0';

      const pillWrap = document.createElement('div');
      pillWrap.style.display = 'flex';
      pillWrap.style.alignItems = 'center';
      pillWrap.style.gap = '6px';

      const mkPill = (id, label) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = id;
        b.textContent = label;
        b.style.all = 'unset';
        b.style.cursor = 'pointer';
        b.style.padding = '4px 8px';
        b.style.borderRadius = '999px';
        b.style.border = '1px solid rgba(212,175,55,0.18)';
        b.style.background = 'rgba(0,0,0,0.18)';
        b.style.opacity = '0.9';
        return b;
      };
      const allP = mkPill('hbcr_editor_filter_all', 'All');
      const newP = mkPill('hbcr_editor_filter_new', 'New');
      pillWrap.appendChild(allP);
      pillWrap.appendChild(newP);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close';
      closeBtn.style.all = 'unset';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.padding = '4px 8px';
      closeBtn.style.borderRadius = '10px';
      closeBtn.style.border = '1px solid rgba(212,175,55,0.18)';
      closeBtn.style.background = 'rgba(0,0,0,0.18)';
      closeBtn.addEventListener('click', () => toggleOpen(false));

      dock.appendChild(addBtn);
      dock.appendChild(search);
      dock.appendChild(pillWrap);
      dock.appendChild(closeBtn);
      right.insertBefore(dock, right.firstChild);

      search.addEventListener('input', () => {
        state.query = search.value || '';
        renderResults();
      });
      allP.addEventListener('click', () => {
        state.filter = 'all';
        renderResults();
      });
      newP.addEventListener('click', () => {
        state.filter = 'new';
        renderResults();
      });
    }

    const frame = app.querySelector('.frame');
    if (!frame) return null;
    let results = frame.querySelector('#hbcr_editor_results');
    if (!results) {
      const divider = frame.querySelector('.divider');
      results = document.createElement('div');
      results.id = 'hbcr_editor_results';
      results.style.display = 'none';
      results.style.padding = '10px 28px 12px';
      results.style.background = 'rgba(0,0,0,0.18)';
      results.style.borderBottom = '1px solid rgba(212,175,55,0.14)';
      results.style.color = 'rgba(232,220,198,0.95)';
      results.style.maxHeight = '38vh';
      results.style.overflow = 'auto';
      if (divider && divider.parentNode) {
        divider.parentNode.insertBefore(results, divider.nextSibling);
      } else {
        frame.insertBefore(results, frame.firstChild);
      }
    }

    ui.dock = dock;
    ui.results = results;
    ui.search = document.getElementById('hbcr_editor_search');
    ui.filterAll = document.getElementById('hbcr_editor_filter_all');
    ui.filterNew = document.getElementById('hbcr_editor_filter_new');
    return ui;
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

  async function createUiForRow({ sheet, rowKey, label, row, forcedZoneId = "", forcedUiType = "", auto = false }) {
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

    const place = (zoneId) => {
      const uiType = forcedUiType || componentTypeFromSheet(sheet);
      const nodeId = nowId("ui");
      const nodeType = nodeTypeFromUiType(uiType);
      const props = { title: niceTitle(sheet, label), subtitle: "" };

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
      writeDraft(next);

      if (!auto) {
        toast("Added. Refreshing…");
        setTimeout(() => { try { location.reload(); } catch {} }, 350);
      }
    };

    if (forcedZoneId) {
      place(forcedZoneId);
      return;
    }

    startZonePick({ onPick: (zoneId) => place(zoneId) });
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
  // UI (BG3-native, ultra-simple)
  // NOTE: Previously this used fixed-position overlays. Per request, it is now
  // mounted INSIDE the editor header, and the results expand in normal flow.

  // -------------------------
  // Embedded Add Content (mounted in topbar; results panel expands under header)
  // -------------------------
  let idx = null;
  const lastSeen = readJsonLS(LAST_SEEN_KEY, {});

  function isNew(item) {
    const s = String(item.sheet);
    const set = new Set(lastSeen[s] || []);
    return !set.has(item.rowKey);
  }

  function markSeen(item) {
    const s = String(item.sheet);
    const set = new Set(lastSeen[s] || []);
    set.add(item.rowKey);
    lastSeen[s] = Array.from(set);
    writeJsonLS(LAST_SEEN_KEY, lastSeen);
  }

  function toggleOpen(on) {
    state.open = !!on;
    ensureEmbeddedUI();
    if (ui.results) ui.results.style.display = state.open ? 'block' : 'none';
    if (state.open) {
      renderResults();
      setTimeout(() => { try { ui.search?.focus(); } catch {} }, 30);
    }
  }

  async function addItemFlow(item) {
    const guess = guessMechanic(item);
    const forcedZoneId = findExistingZoneForMechanic(guess);
    if (forcedZoneId) {
      await addItemToDraftAndPlace(item, { forcedZoneId });
      toast(`Added to ${guess.toUpperCase()}.`);
      setTimeout(() => { try { location.reload(); } catch {} }, 300);
      return;
    }
    const chosenType = await promptType();
    if (!chosenType) return;
    toast('Click where to place it…');
    await addItemToDraftAndPlace(item, { forcedZoneId: null, chosenType });
    setTimeout(() => { try { location.reload(); } catch {} }, 300);
  }

  function renderResults() {
    ensureEmbeddedUI();
    if (!ui.results) return;

    if (ui.filterAll) ui.filterAll.style.borderColor = state.filter === 'all' ? 'rgba(212,175,55,0.55)' : 'rgba(212,175,55,0.18)';
    if (ui.filterNew) ui.filterNew.style.borderColor = state.filter === 'new' ? 'rgba(212,175,55,0.55)' : 'rgba(212,175,55,0.18)';

    if (!state.open) {
      ui.results.style.display = 'none';
      return;
    }

    ui.results.style.display = 'block';

    if (!idx) {
      ui.results.innerHTML = `<div style="opacity:.75;">Loading…</div>`;
      return;
    }

    const q = (state.query || '').toLowerCase().trim();
    const sections = [];
    for (const sheet of idx.sheets) {
      const rows = idx.rowsBySheet.get(sheet) || [];
      const filtered = rows.filter(r => {
        if (q && !r.searchText.includes(q)) return false;
        if (state.filter === 'new' && !isNew(r)) return false;
        return true;
      });
      if (!filtered.length) continue;
      sections.push({ sheet, rows: filtered.slice(0, 60) });
    }

    if (!sections.length) {
      ui.results.innerHTML = `<div style="opacity:.75;">No matches.</div>`;
      return;
    }

    const html = [];
    for (const sec of sections) {
      html.push(`<div style="opacity:.72;letter-spacing:.08em;text-transform:uppercase;font-size:11px;margin:10px 0 6px;">${esc(sec.sheet)}</div>`);
      for (const item of sec.rows) {
        const badge = isNew(item)
          ? `<span style="display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;border:1px solid rgba(212,175,55,0.18);background:rgba(0,0,0,0.14);font-size:10px;letter-spacing:.10em;">NEW</span>`
          : ``;
        html.push(
          `<div data-sheet="${esc(item.sheet)}" data-rowkey="${esc(item.rowKey)}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:12px;border:1px solid rgba(212,175,55,0.10);margin-bottom:6px;">` +
            `<div style="min-width:0;">` +
              `<div style="font-weight:700;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.label)}</div>` +
              `<div style="opacity:.72;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.rowKey)}</div>` +
            `</div>` +
            `<div style="display:flex;align-items:center;gap:8px;">${badge}<button data-action="add" style="all:unset;cursor:pointer;padding:6px 10px;border-radius:10px;border:1px solid rgba(212,175,55,0.22);background:rgba(0,0,0,0.20);font-weight:700;">Add</button></div>` +
          `</div>`
        );
      }
    }
    ui.results.innerHTML = html.join('');

    ui.results.querySelectorAll('button[data-action=add]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rowEl = btn.closest('[data-sheet]');
        const sheet = rowEl?.getAttribute('data-sheet');
        const rowKey = rowEl?.getAttribute('data-rowkey');
        const item = (idx.rowsBySheet.get(sheet) || []).find(x => x.rowKey === rowKey);
        if (!item) return;
        markSeen(item);
        await addItemFlow(item);
        renderResults();
      });
    });
  }

  // Re-mount on app re-render (app replaces header nodes)
  const mo = new MutationObserver(() => { ensureEmbeddedUI(); });
  try { mo.observe(document.getElementById('app'), { childList: true, subtree: true }); } catch {}
  ensureEmbeddedUI();

  (async () => {
    try {
      await ensureDraftBase();
      const bundle = await fetchBundle();
      idx = buildBundleIndex(bundle);
    } catch (e) {
      toast('Bundle failed to load.');
      console.warn(e);
    }
    toggleOpen(false);
  })();
})();
