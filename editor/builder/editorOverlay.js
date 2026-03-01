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
  // -------------------------
  function ensureFab() {
    if (document.getElementById("hbcr_inbox_fab")) return;

    const fab = document.createElement("button");
    fab.id = "hbcr_inbox_fab";
    fab.type = "button";
    fab.title = "Add";
    fab.style.position = "fixed";
    fab.style.right = "18px";
    fab.style.bottom = "18px";
    fab.style.zIndex = "999999";
    fab.style.width = "56px";
    fab.style.height = "56px";
    fab.style.borderRadius = "16px";
    fab.style.border = "1px solid rgba(212,175,55,0.28)";
    fab.style.background = "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.28)), rgba(10,6,6,0.78)";
    fab.style.cursor = "pointer";
    fab.style.boxShadow = "0 12px 30px rgba(0,0,0,.35)";

    const img = document.createElement("img");
    img.alt = "Add";
    img.src = "/assets/ui/karlachplus.png";
    img.style.width = "42px";
    img.style.height = "42px";
    img.style.objectFit = "contain";
    img.style.filter = "drop-shadow(0 0 10px rgba(212,175,55,0.18))";
    fab.appendChild(img);

    fab.addEventListener("click", () => openInbox());

    document.body.appendChild(fab);
  }
  function openInbox() {
    if (document.getElementById("hbcr_inbox_dock")) return;

    // Editor-only light styling; does not change app CSS.
    if (!document.getElementById("hbcr_inbox_style")) {
      const st = document.createElement("style");
      st.id = "hbcr_inbox_style";
      st.textContent = `
        #hbcr_inbox_dock .hbcr-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border-radius:10px; cursor:pointer; border: 1px solid rgba(212,175,55,0.10); }
        #hbcr_inbox_dock .hbcr-row:hover{ background: rgba(212,175,55,0.07); border-color: rgba(212,175,55,0.24); }
        #hbcr_inbox_dock .hbcr-name{ color: rgba(242,230,196,0.94); font-size: 13px; letter-spacing: 0.06em; }
        #hbcr_inbox_dock .hbcr-meta{ color: rgba(242,230,196,0.66); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
        #hbcr_inbox_dock .hbcr-chip{ display:inline-flex; align-items:center; padding:2px 6px; border-radius:999px; border:1px solid rgba(212,175,55,0.18); background: rgba(0,0,0,0.14); color: rgba(242,230,196,0.78); font-size: 10px; letter-spacing: 0.10em; text-transform: uppercase; }
        #hbcr_inbox_dropdown{ box-shadow: 0 18px 40px rgba(0,0,0,.45); }
      `;
      document.head.appendChild(st);
    }

    // --- Top dock (does not overlap the main builder area)
    const dock = document.createElement("div");
    dock.id = "hbcr_inbox_dock";
    dock.className = "filter-panel";
    dock.style.position = "fixed";
    dock.style.left = "12px";
    dock.style.right = "12px";
    dock.style.top = "10px";
    dock.style.zIndex = "999999";
    dock.style.padding = "10px 12px";

    const titleRow = document.createElement("div");
    titleRow.style.display = "flex";
    titleRow.style.alignItems = "center";
    titleRow.style.justifyContent = "space-between";
    titleRow.style.gap = "10px";

    const title = document.createElement("div");
    title.className = "filter-title";
    title.textContent = "ADD CONTENT";
    title.style.margin = "0";

    const close = document.createElement("button");
    close.className = "btn";
    close.textContent = "Close";
    close.style.padding = "10px 12px";
    close.addEventListener("click", () => {
      try { if (dock.__hbcrOnResize) window.removeEventListener("resize", dock.__hbcrOnResize); } catch {}
      try { dock.remove(); } catch {}
      try { document.getElementById("hbcr_inbox_dropdown")?.remove(); } catch {}
    });

    titleRow.appendChild(title);
    titleRow.appendChild(close);
    dock.appendChild(titleRow);

    const topRow = document.createElement("div");
    topRow.className = "filter-row wrap";
    topRow.style.marginTop = "10px";

    const search = document.createElement("input");
    search.className = "search";
    search.placeholder = "Search…";
    search.style.flex = "1";

    const gear = document.createElement("button");
    gear.className = "btn";
    gear.textContent = "⋯";
    gear.title = "Draft tools";
    gear.style.padding = "10px 12px";

    topRow.appendChild(search);
    topRow.appendChild(gear);
    dock.appendChild(topRow);

    const tools = document.createElement("div");
    tools.style.display = "none";
    tools.style.marginTop = "10px";
    tools.className = "filter-row wrap";
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn";
    copyBtn.textContent = "Copy Draft";
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn";
    resetBtn.textContent = "Reset Draft";
    tools.appendChild(copyBtn);
    tools.appendChild(resetBtn);
    dock.appendChild(tools);

    gear.addEventListener("click", () => {
      tools.style.display = tools.style.display === "none" ? "flex" : "none";
    });

    copyBtn.addEventListener("click", async () => {
      const d = readDraft() || {};
      const text = JSON.stringify(d, null, 2);
      try { await navigator.clipboard.writeText(text); toast("Draft copied."); }
      catch {
        const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Draft copied.");
      }
    });
    resetBtn.addEventListener("click", () => {
      writeDraft({});
      toast("Draft reset. Refreshing…");
      setTimeout(() => { try { location.reload(); } catch {} }, 350);
    });

    const pills = document.createElement("div");
    pills.className = "pill-row";
    pills.style.justifyContent = "flex-start";
    pills.style.marginTop = "10px";
    const pillAll = document.createElement("span");
    pillAll.className = "pill";
    pillAll.textContent = "ALL";
    pillAll.style.cursor = "pointer";
    const pillNew = document.createElement("span");
    pillNew.className = "pill";
    pillNew.textContent = "NEW";
    pillNew.style.cursor = "pointer";
    pills.appendChild(pillAll);
    pills.appendChild(pillNew);
    dock.appendChild(pills);

    // Dropdown results container (appears below dock)
    const dropdown = document.createElement("div");
    dropdown.id = "hbcr_inbox_dropdown";
    dropdown.className = "filter-panel";
    dropdown.style.position = "fixed";
    dropdown.style.left = "12px";
    dropdown.style.right = "12px";
    // top is computed after mount so it always sits right below the dock
    dropdown.style.top = "96px";
    dropdown.style.zIndex = "999998";
    dropdown.style.maxHeight = "42vh";
    dropdown.style.overflow = "auto";
    dropdown.style.padding = "10px 12px";

    const listWrap = document.createElement("div");
    dropdown.appendChild(listWrap);

    document.body.appendChild(dock);
    document.body.appendChild(dropdown);

    const positionDropdown = () => {
      try {
        const r = dock.getBoundingClientRect();
        dropdown.style.top = `${Math.round(r.bottom + 8)}px`;
      } catch {}
    };
    positionDropdown();
    const onResize = () => positionDropdown();
    window.addEventListener("resize", onResize);
    dock.__hbcrOnResize = onResize;

    let state = { mode: "all", q: "" };
    const lastSeen = readJsonLS(LAST_SEEN_KEY, {});
    const setMode = (m) => {
      state.mode = m;
      pillAll.style.borderColor = m === "all" ? "rgba(212,175,55,0.55)" : "rgba(212,175,55,0.18)";
      pillNew.style.borderColor = m === "new" ? "rgba(212,175,55,0.55)" : "rgba(212,175,55,0.18)";
      render();
    };
    setMode("all");

    search.addEventListener("input", () => { state.q = (search.value || "").toLowerCase().trim(); render(); });
    pillAll.addEventListener("click", () => setMode("all"));
    pillNew.addEventListener("click", () => setMode("new"));

    let idx = null;
    (async () => {
      try {
        await ensureDraftBase();
        const bundle = await fetchBundle();
        idx = buildBundleIndex(bundle);
        render();
        setTimeout(() => { try { search.focus(); } catch {} }, 40);
      } catch (e) {
        toast("Bundle failed to load.");
        listWrap.innerHTML = `<div class="mini-muted">${esc(e?.message || e)}</div>`;
      }
    })();

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

    function allZoneIds() {
      const els = Array.from(document.querySelectorAll("[data-ui-zone]"));
      return els.map(el => String(el.getAttribute("data-ui-zone") || "")).filter(Boolean);
    }
    function inferKnownMechanic(sheet) {
      const s = String(sheet || "").toLowerCase();
      if (s.includes("subclass")) return "subclass";
      if (s.includes("class")) return "class";
      if (s.includes("race") || s.includes("subrace")) return "race";
      if (s.includes("trait") || s.includes("feature") || s.includes("passive")) return "trait";
      if (s.includes("feat")) return "feat";
      if (s.includes("spell") || s.includes("cantrip")) return "spell";
      return "";
    }
    function autoZoneForMechanic(mech, zoneIds) {
      const z = zoneIds.map(x => x.toLowerCase());
      const pick = (needle) => {
        const i = z.findIndex(v => v.includes(needle));
        return i >= 0 ? zoneIds[i] : "";
      };
      if (!mech) return "";
      return pick(mech) || pick(mech.slice(0, 4)) || "";
    }
    function showMechanicChooser({ label, onChoose }) {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "1000000";
      overlay.style.background = "rgba(0,0,0,0.55)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";

      const box = document.createElement("div");
      box.className = "filter-panel";
      box.style.width = "420px";
      box.style.maxWidth = "calc(100vw - 36px)";

      const t = document.createElement("div");
      t.className = "filter-title";
      t.textContent = "CHOOSE STYLE";
      box.appendChild(t);

      const mm = document.createElement("div");
      mm.className = "mini-muted";
      mm.style.textAlign = "left";
      mm.style.marginTop = "10px";
      mm.textContent = `How should “${label}” appear?`;
      box.appendChild(mm);

      const row = document.createElement("div");
      row.className = "filter-row wrap";
      row.style.marginTop = "12px";
      const mkBtn = (txt, val) => {
        const b = document.createElement("button");
        b.className = "btn primary";
        b.textContent = txt;
        b.addEventListener("click", () => { try { overlay.remove(); } catch {} onChoose(val); });
        return b;
      };
      row.appendChild(mkBtn("Radial", "radial"));
      row.appendChild(mkBtn("Dropdown", "dropdown"));
      row.appendChild(mkBtn("Panel", "panel"));
      const cancel = document.createElement("button");
      cancel.className = "btn";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => { try { overlay.remove(); } catch {} });
      row.appendChild(cancel);
      box.appendChild(row);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }

    async function addItemFlow(item) {
      const zoneIds = allZoneIds();
      const mech = inferKnownMechanic(item.sheet);
      const autoZone = autoZoneForMechanic(mech, zoneIds);

      if (mech && autoZone) {
        await createUiForRow({ sheet: item.sheet, rowKey: item.rowKey, label: item.label, row: item.row, forcedZoneId: autoZone, forcedUiType: componentTypeFromSheet(item.sheet), auto: true });
        toast("Added. Refreshing…");
        setTimeout(() => { try { location.reload(); } catch {} }, 350);
        return;
      }

      showMechanicChooser({
        label: item.label,
        onChoose: (uiType) => {
          toast("Click where to place it.");
          createUiForRow({ sheet: item.sheet, rowKey: item.rowKey, label: item.label, row: item.row, forcedUiType: uiType, auto: false });
        }
      });
    }

    function render() {
      if (!idx) {
        listWrap.innerHTML = `<div class="mini-muted">Loading…</div>`;
        return;
      }
      const q = state.q;
      const sections = [];
      for (const sheet of idx.sheets) {
        const rows = idx.rowsBySheet.get(sheet) || [];
        const filtered = rows.filter(r => {
          if (q && !r.searchText.includes(q)) return false;
          if (state.mode === "new" && !isNew(r)) return false;
          return true;
        });
        if (!filtered.length) continue;
        sections.push({ sheet, rows: filtered.slice(0, 80) });
      }

      if (!sections.length) {
        listWrap.innerHTML = `<div class="mini-muted">No matches.</div>`;
        return;
      }

      const html = [];
      for (const sec of sections) {
        html.push(`<div class="mini-muted" style="text-align:left;margin:10px 0 6px 2px;">${esc(sec.sheet)}</div>`);
        for (const item of sec.rows) {
          const badge = isNew(item) ? `<span class="hbcr-chip">NEW</span>` : ``;
          html.push(
            `<div class="hbcr-row" data-sheet="${esc(item.sheet)}" data-rowkey="${esc(item.rowKey)}">` +
              `<div style="min-width:0;">` +
                `<div class="hbcr-name">${esc(item.label)}</div>` +
                `<div class="hbcr-meta">${esc(item.rowKey)}</div>` +
              `</div>` +
              `<div style="display:flex;align-items:center;gap:8px;">${badge}<button class="btn primary" data-action="add" style="padding:8px 10px;">Add</button></div>` +
            `</div>`
          );
        }
      }
      listWrap.innerHTML = html.join("");

      listWrap.querySelectorAll("button[data-action=add]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const rowEl = btn.closest(".hbcr-row");
          const sheet = rowEl.getAttribute("data-sheet");
          const rowKey = rowEl.getAttribute("data-rowkey");
          const item = (idx.rowsBySheet.get(sheet) || []).find(x => x.rowKey === rowKey);
          if (!item) return;
          markSeen(item);
          await addItemFlow(item);
          render();
        });
      });
    }

  }

  // Install
  ensureFab();
})();
