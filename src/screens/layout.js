// src/screens/layout.js
// Layout-driven screen renderer (Option 2 runtime).

import { getBundle, loadRacesJson, loadClassesJson, loadClassesFullJson } from "../data/liveData.js";
import { ChoiceScreen } from "./choice.js";
import { isDesignMode, isSlotEditor, readDesignDraft } from "../design/designMode.js";

// ---- helpers ----

function asRows(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.rows)) return v.rows;
  return [];
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

function safeJsonParse(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  const s = String(v).trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function getPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function template(str, state) {
  if (typeof str !== "string") return str;
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => {
    const val = getPath(state, p.trim());
    return val == null ? "" : String(val);
  });
}

function evalVisibility(visibilityJson, state) {
  const rules = safeJsonParse(visibilityJson, null);
  if (!rules) return true;
  const arr = Array.isArray(rules) ? rules : [rules];
  for (const r of arr) {
    const op = String(r?.op || "").toLowerCase();
    const path = r?.path || r?.field;
    if (!path) continue;
    const val = getPath(state, path);
    if (op === "exists") {
      if (val == null || val === "") return false;
    } else if (op === "=" || op === "eq") {
      const want = template(r?.value, state);
      if (String(val ?? "") !== String(want ?? "")) return false;
    }
  }
  return true;
}

function applyWhere(items, whereJson, state) {
  const clauses = safeJsonParse(whereJson, []);
  const arr = Array.isArray(clauses) ? clauses : [clauses];
  if (!arr.length) return items;

  return (items || []).filter((it) => {
    for (const c of arr) {
      const field = c?.field || c?.path;
      const op = String(c?.op || "=").toLowerCase();
      const raw = c?.value;
      const value = template(raw, state);
      const itVal = field ? it?.[field] : undefined;

      if (op === "exists") {
        if (itVal == null || itVal === "") return false;
        continue;
      }

      if (op === "=" || op === "eq") {
        if (String(itVal ?? "") !== String(value ?? "")) return false;
        continue;
      }

      if (op === "!=" || op === "neq") {
        if (String(itVal ?? "") === String(value ?? "")) return false;
        continue;
      }

      // Basic support for `in` where value is a JSON array string or comma list
      if (op === "in") {
        let set = [];
        if (Array.isArray(raw)) set = raw;
        else {
          const parsed = safeJsonParse(value, null);
          if (Array.isArray(parsed)) set = parsed;
          else set = String(value ?? "").split(",").map(s => s.trim()).filter(Boolean);
        }
        if (!set.map(String).includes(String(itVal ?? ""))) return false;
        continue;
      }
    }
    return true;
  });
}

function sortItems(items, sortField, sortDir) {
  const field = String(sortField || "").trim();
  if (!field) return items;
  const dir = String(sortDir || "asc").toLowerCase() === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
  });
}

// Allowlisted loader functions (so config can't call arbitrary JS)
const LOADER_MAP = {
  loadRacesJson,
  loadClassesJson,
  loadClassesFullJson,
};

async function resolveBinding(bindingRow, state) {
  if (!bindingRow) return [];
  const sourceType = String(bindingRow.SourceType ?? bindingRow.sourceType ?? "sheet").trim();
  const sourceRef = String(bindingRow.SourceRef ?? bindingRow.sourceRef ?? bindingRow.DataSheet ?? bindingRow.dataSheet ?? "").trim();
  const itemsPath = String(bindingRow.ItemsPath ?? bindingRow.itemsPath ?? "").trim();
  const childPath = String(bindingRow.ChildPath ?? bindingRow.childPath ?? "").trim();
  const whereJson = bindingRow.WhereJson ?? bindingRow.whereJson ?? "[]";

  let data = null;

  if (sourceType === "loader") {
    const fn = LOADER_MAP[sourceRef];
    if (!fn) return [];
    data = await fn();
  } else {
    // Default: treat as bundle sheet name
    const b = await getBundle();
    const sheetName = sourceRef || String(bindingRow.DataSheet ?? bindingRow.dataSheet ?? "");
    data = b?.[sheetName] ?? null;
  }

  let items = [];
  if (Array.isArray(data)) items = data;
  else if (data && itemsPath && Array.isArray(data[itemsPath])) items = data[itemsPath];
  else if (data && Array.isArray(data?.rows)) items = data.rows;

  // Apply WhereJson to the current list
  let filtered = applyWhere(items, whereJson, state);

  // If a binding is meant to select a single parent and then return a nested array, support that.
  // 1) explicit ChildPath
  if (childPath && filtered.length === 1 && Array.isArray(filtered[0]?.[childPath])) {
    filtered = filtered[0][childPath];
  }

  // 2) heuristic for existing repo shapes (races -> subraces, classes -> subclasses)
  if (!childPath && filtered.length === 1) {
    const idHint = String(bindingRow.BindingId ?? bindingRow.bindingId ?? "").toLowerCase();
    const one = filtered[0];
    if (idHint.includes("subrace") && Array.isArray(one?.subraces)) filtered = one.subraces;
    if (idHint.includes("subclass") && Array.isArray(one?.subclasses)) filtered = one.subclasses;
  }

  // Sort if requested
  const sortField = bindingRow.SortField ?? bindingRow.ItemSortField ?? "";
  const sortDir = bindingRow.SortDir ?? bindingRow.ItemSortDir ?? "asc";
  filtered = sortItems(filtered, sortField, sortDir);

  return filtered;
}

function renderPanel(node, childrenHtml) {
  const title = node.props?.title;
  return `
    <div class="screen" style="padding-top:0">
      ${title ? `<div class="h1">${title}</div>` : ""}
      ${childrenHtml}
    </div>
  `;
}

async function renderChoiceGrid(node, state, bindingRow) {
  const props = node.props || {};
  const items = await resolveBinding(bindingRow, state);

  const labelField = String(bindingRow?.LabelField ?? "label");
  const iconField = String(bindingRow?.IconField ?? "icon");
  const valueField = String(bindingRow?.ValueField ?? "id");
  const descField = String(bindingRow?.DescField ?? "desc");

  const options = items
    .map((it) => ({
      id: it?.[valueField] ?? it?.id ?? it?.Id,
      label: it?.[labelField] ?? it?.name ?? it?.Name ?? "(unnamed)",
      icon: it?.[iconField] ?? it?.icon ?? it?.Icon ?? null,
      desc: it?.[descField] ?? it?.desc ?? it?.Description ?? "",
    }))
    .filter((o) => o.id != null);

  const selectedPath = props.selectedPath;
  const selectedId = selectedPath ? getPath(state, selectedPath) : null;

  return ChoiceScreen({
    title: props.title || "Choose",
    subtitle: props.subtitle || "Make your selection",
    selectedId,
    options,
    selectAction: props.selectAction || "",
    note: props.note,
  });
}

function buildTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.ComponentId, n]));
  for (const n of nodes) n.children = [];
  const roots = [];
  for (const n of nodes) {
    const parentId = n.ParentId;
    if (parentId && byId.has(parentId)) byId.get(parentId).children.push(n);
    else roots.push(n);
  }
  const sortRec = (arr) => {
    arr.sort((a, b) => a.Order - b.Order);
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

// ---- zones (UIZones sheet tab) ----

function normalizeZoneRow(z) {
  return {
    ScreenId: String(z.ScreenId ?? z.screenId ?? "").trim(),
    ZoneId: String(z.ZoneId ?? z.zoneId ?? "").trim(),
    ParentZoneId: String(z.ParentZoneId ?? z.parentZoneId ?? "").trim(),
    Order: Number(z.Order ?? z.order ?? 0) || 0,
    Enabled: toBool(z.Enabled ?? z.enabled ?? true),
    PropsJson: z.PropsJson ?? z.propsJson ?? "{}",
    StyleJson: z.StyleJson ?? z.styleJson ?? "{}",
  };
}

function buildZoneTree(zones) {
  const byId = new Map(zones.map(z => [z.ZoneId, z]));
  for (const z of zones) z.children = [];
  const roots = [];
  for (const z of zones) {
    const p = z.ParentZoneId;
    if (p && byId.has(p)) byId.get(p).children.push(z);
    else roots.push(z);
  }
  const sortRec = (arr) => {
    arr.sort((a,b) => (a.Order - b.Order));
    for (const z of arr) sortRec(z.children);
  };
  sortRec(roots);
  return roots;
}

function zoneStyle(zone) {
  const props = safeJsonParse(zone?.PropsJson, {});
  const style = safeJsonParse(zone?.StyleJson, {});
  const direction = String(props.direction || props.flexDirection || "column");
  const gap = props.gap ?? 12;
  const wrap = props.wrap ? "wrap" : "nowrap";
  const justify = props.justify || "flex-start";
  const align = props.align || "stretch";
  const grow = props.grow;
  const basis = props.basis;
  const width = props.width;
  const maxWidth = props.maxWidth;
  const minWidth = props.minWidth;

  const parts = [
    "display:flex",
    `flex-direction:${direction}`,
    `gap:${Number(gap) || 0}px`,
    `flex-wrap:${wrap}`,
    `justify-content:${justify}`,
    `align-items:${align}`,
  ];
  if (grow != null) parts.push(`flex-grow:${Number(grow)}`);
  if (basis != null) parts.push(`flex-basis:${basis}`);
  if (width != null) parts.push(`width:${width}`);
  if (maxWidth != null) parts.push(`max-width:${maxWidth}`);
  if (minWidth != null) parts.push(`min-width:${minWidth}`);
  for (const [k,v] of Object.entries(style || {})) {
    if (v == null || v === "") continue;
    const cssKey = String(k).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
    parts.push(`${cssKey}:${v}`);
  }
  return parts.join(";");
}

function wrapComponentHtml(componentId, innerHtml) {
  const drag = isDesignMode() ? "draggable=\"true\"" : "";
  return `
    <div class="hbcr-ui-wrap" data-ui-component="${componentId}" ${drag}>
      ${isDesignMode() ? `<div class="hbcr-ui-handle" title="Drag" aria-hidden="true">⋮⋮</div>` : ""}
      ${innerHtml}
    </div>
  `;
}

function ensureDesignCss() {
  if (!isDesignMode()) return;
  if (document.getElementById("hbcr-design-css")) return;
  const style = document.createElement("style");
  style.id = "hbcr-design-css";
  style.textContent = `
    .hbcr-ui-wrap{position:relative}
    .hbcr-ui-handle{position:absolute;top:8px;right:8px;z-index:3;background:rgba(0,0,0,.75);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:2px 6px;font-size:12px;cursor:grab;user-select:none}
    html.hbcr-show-zones [data-ui-zone]{outline:1px dashed rgba(255,255,255,.22);outline-offset:6px}
    [data-ui-zone].hbcr-drop-hot{outline:2px solid rgba(155,183,255,.8)!important}
    html.hbcr-show-zones [data-ui-zone]::before{content:attr(data-ui-zone);position:sticky;top:0;display:inline-block;margin:0 0 6px 0;padding:2px 6px;border-radius:8px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.12);font-size:12px;color:rgba(255,255,255,.8)}
  `;
  document.head.appendChild(style);
}

async function renderNode(node, state, bindingsById) {
  const childrenHtml = (await Promise.all(node.children.map((ch) => renderNode(ch, state, bindingsById)))).join("");
  const t = String(node.Type || "").trim();
  if (t === "panel") return wrapComponentHtml(node.ComponentId, renderPanel(node, childrenHtml));
  if (t === "choiceGrid") {
    const binding = node.BindingId ? bindingsById.get(node.BindingId) : null;
    return wrapComponentHtml(node.ComponentId, await renderChoiceGrid(node, state, binding));
  }
  // Unknown component type: render children (so layouts don't hard-break)
  return wrapComponentHtml(node.ComponentId, childrenHtml);
}

/**
 * LayoutScreen(ctx, screenId)
 * Renders a screen from bundle.UILayout + bundle.UIBindings
 */
export async function LayoutScreen(ctx, screenId) {
  const state = ctx?.state;
  const b0 = await getBundle();

  // Draft override (design mode only)
  const draft = readDesignDraft();
  const b = (draft && typeof draft === "object")
    ? { ...b0, UILayout: draft.UILayout || b0?.UILayout, UIBindings: draft.UIBindings || b0?.UIBindings, UIZones: draft.UIZones || b0?.UIZones }
    : b0;

  const layoutRowsRaw = asRows(b?.UILayout);
  const bindingRowsRaw = asRows(b?.UIBindings);
  const zoneRowsRaw = asRows(b?.UIZones);

  const bindingsById = new Map(
    bindingRowsRaw
      .filter((r) => (r?.BindingId || r?.bindingId))
      .map((r) => [String(r.BindingId || r.bindingId), r])
  );

  const screen = String(screenId || "");
  const nodes = layoutRowsRaw
    .filter((r) => String(r?.ScreenId || r?.screenId) === screen)
    .filter((r) => toBool(r?.Enabled ?? r?.enabled ?? true))
    .map((r) => {
      const props = safeJsonParse(r?.PropsJson ?? r?.propsJson ?? "{}", {});
      return {
        ComponentId: String(r?.ComponentId || r?.componentId || ""),
        Type: String(r?.Type || r?.type || ""),
        ParentId: String(r?.ParentId || r?.parentId || ""),
        ZoneId: String(r?.ZoneId || r?.zoneId || r?.Slot || r?.slot || "root"),
        Slot: String(r?.Slot || r?.slot || ""),
        Order: Number(r?.Order ?? r?.order ?? 0),
        BindingId: String(r?.BindingId || r?.bindingId || ""),
        props,
        visibilityJson: r?.VisibilityJson ?? r?.Visibilityjson ?? r?.VisibilityJson,
        children: [],
      };
    })
    .filter((n) => n.ComponentId);

  const visibleNodes = nodes.filter((n) => evalVisibility(n.visibilityJson, state));
  const roots = buildTree(visibleNodes);

  // Zones
  const zones = zoneRowsRaw
    .map(normalizeZoneRow)
    .filter(z => z.ScreenId === screen)
    .filter(z => z.Enabled && z.ZoneId);

  const finalZones = zones.length ? zones : [{ ScreenId: screen, ZoneId: "root", ParentZoneId: "", Order: 0, Enabled: true, PropsJson: JSON.stringify({ direction: "column", gap: 12 }), StyleJson: "{}" }];
  const zoneRoots = buildZoneTree(finalZones);

  const rootsByZone = new Map();
  for (const r of roots) {
    const zid = String(r.ZoneId || r.Slot || "root") || "root";
    if (!rootsByZone.has(zid)) rootsByZone.set(zid, []);
    rootsByZone.get(zid).push(r);
  }
  for (const [zid, arr] of rootsByZone) arr.sort((a,b)=>a.Order-b.Order);

  const renderZoneRec = async (z) => {
    const childrenZonesHtml = (await Promise.all((z.children || []).map(renderZoneRec))).join("");
    const comps = rootsByZone.get(z.ZoneId) || [];
    const compsHtml = (await Promise.all(comps.map(n => renderNode(n, state, bindingsById)))).join("");
    return `
      <div class="hbcr-zone" data-ui-zone="${z.ZoneId}" style="${zoneStyle(z)}">
        ${childrenZonesHtml}
        ${compsHtml}
      </div>
    `;
  };

  ensureDesignCss();

  // Expose current rows for export
  window.__HBCR_LAST_LAYOUT__ = layoutRowsRaw.filter(r => String(r?.ScreenId || r?.screenId) === screen);
  window.__HBCR_LAST_ZONES__ = finalZones.filter(z => z.ScreenId === screen).map(z => ({
    ScreenId: z.ScreenId,
    ZoneId: z.ZoneId,
    ParentZoneId: z.ParentZoneId,
    Order: z.Order,
    Enabled: z.Enabled,
    PropsJson: z.PropsJson,
    StyleJson: z.StyleJson,
  }));

  const body = (await Promise.all(zoneRoots.map(renderZoneRec))).join("");
  return `<div class="hbcr-layout-root">${body}</div>`;
}
