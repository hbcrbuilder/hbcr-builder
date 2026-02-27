// src/screens/layout.js
// Layout-driven screen renderer (Option 2 runtime).

import { getBundle, loadRacesJson, loadClassesJson, loadClassesFullJson } from "../data/liveData.js";
import { ChoiceScreen } from "./choice.js";

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

async function renderNode(node, state, bindingsById) {
  const childrenHtml = (await Promise.all(node.children.map((ch) => renderNode(ch, state, bindingsById)))).join("");
  const t = String(node.Type || "").trim();
  if (t === "panel") return renderPanel(node, childrenHtml);
  if (t === "choiceGrid") {
    const binding = node.BindingId ? bindingsById.get(node.BindingId) : null;
    return await renderChoiceGrid(node, state, binding);
  }
  // Unknown component type: render children (so layouts don't hard-break)
  return childrenHtml;
}

/**
 * LayoutScreen(ctx, screenId)
 * Renders a screen from bundle.UILayout + bundle.UIBindings
 */
export async function LayoutScreen(ctx, screenId) {
  const state = ctx?.state;
  const b = await getBundle();

  const layoutRowsRaw = asRows(b?.UILayout);
  const bindingRowsRaw = asRows(b?.UIBindings);

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

  const htmlParts = [];
  for (const r of roots) htmlParts.push(await renderNode(r, state, bindingsById));
  return htmlParts.join("");
}
