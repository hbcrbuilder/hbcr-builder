// src/screens/layout.js
// Layout-driven screen renderer (Option 2 runtime).

import { getBundle, loadRacesJson, loadClassesJson, loadClassesFullJson } from "../data/liveData.js";
import { ChoiceScreen } from "./choice.js";
import { renderPickerLayout } from "./pickerShared.js";

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

function getPath

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderIconMaybe(val, fallback="◈") {
  if (val == null || val === "") return fallback;
  const s = String(val);
  // Already HTML
  if (s.includes("<") && s.includes(">")) return s;
  // Looks like an image path
  if (/\.(png|webp|jpg|jpeg|gif)$/i.test(s) || s.startsWith("./") || s.startsWith("/")) {
    const src = escapeHtml(s);
    return `<img src="${src}" alt="" style="width:48px;height:48px;object-fit:contain;filter:drop-shadow(0 6px 12px rgba(0,0,0,0.35));">`;
  }
  return escapeHtml(s);
}

(obj, path) {
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


async function renderChoiceButtons(node, state, bindingRow) {
  const items = await resolveBinding(bindingRow, state);

  const labelField = String(bindingRow?.LabelField ?? "label");
  const iconField = String(bindingRow?.IconField ?? "icon");
  const valueField = String(bindingRow?.ValueField ?? "id");
  // Some choice buttons need a limit/count (e.g. Choices.Count)
  const countField = String(bindingRow?.CountField ?? "Count");

  const activePath = node.props?.activePath || node.props?.activePickTypePath || "ui.activePickType";
  const activeVal = getPath(state, activePath);

  const btns = items.map((it) => {
    const id = it?.[valueField] ?? it?.id ?? it?.Id;
    if (id == null) return "";
    const label = it?.[labelField] ?? it?.name ?? it?.Name ?? String(id);
    const icon = renderIconMaybe(it?.[iconField] ?? it?.icon ?? it?.Icon ?? "");
    const count = Number(it?.[countField] ?? it?.count ?? it?.Count ?? 0);
    const isOn = String(activeVal ?? "") === String(id);
    // Encode: "<choiceId>|<count>|<label>"
    const enc = `${id}|${count}|${label}`.replace(/"/g, "&quot;");
    return `
      <button class="btn ${isOn ? "primary" : ""}"
              style="padding:10px 12px;border-radius:14px"
              data-action="set-active-pick"
              data-id="${enc}">
        <span style="display:inline-flex;align-items:center;gap:10px">
          <span style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(0,0,0,0.22)">${icon}</span>
          <span>${escapeHtml(label)}</span>
          ${count ? `<span style="opacity:.75;font-size:12px">(${count})</span>` : ``}
        </span>
      </button>
    `;
  }).filter(Boolean).join("");

  return `<div style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 14px 0">${btns}</div>`;
}

async function renderPickWindow(node, state, bindingRow) {
  const ui = state?.ui || {};
  const pickKey = ui.activePickType;
  if (!pickKey) return "";

  const items = await resolveBinding(bindingRow, state);

  const labelField = String(bindingRow?.LabelField ?? "Name");
  const iconField = String(bindingRow?.IconField ?? "Icon");
  const valueField = String(bindingRow?.ValueField ?? "Id");
  const descField = String(bindingRow?.DescField ?? "Description");

  const buildLevel = Math.max(1, Math.min(12, Number(
    state.ui?.picker?.level ||
    state.ui?.radial?.buildLevel ||
    state.ui?.buildLevel ||
    state.character?.level ||
    1
  )));

  const timeline = Array.isArray(state.character?.build?.timeline) ? state.character.build.timeline : [];
  const entry = timeline[Math.max(0, Math.min(11, buildLevel - 1))] || {};
  const picks = entry?.picks || {};
  const pickedIds = Array.isArray(picks[pickKey]) ? picks[pickKey] : (picks[pickKey] ? [picks[pickKey]] : []);

  const need = Math.max(0, Number(ui.activePickLimit || 0));
  const title = node.props?.title || (ui.activePickLabel || "Choices");
  const subtitle = ui.activePickLabel ? ui.activePickLabel : "Choose";

  const pickerItems = items.map((it) => ({
    id: String(it?.[valueField] ?? it?.id ?? it?.Id ?? ""),
    name: String(it?.[labelField] ?? it?.name ?? it?.Name ?? ""),
    text: String(it?.[descField] ?? it?.desc ?? it?.Description ?? ""),
    icon: it?.[iconField] ?? it?.icon ?? it?.Icon ?? null,
    tags: it?.tags || it?.Tags || null,
  })).filter(x => x.id);

  const topHtml = node.props?.topHtml || "";

  return renderPickerLayout({
    title,
    subtitle,
    buildLevel,
    need,
    pickedIds,
    items: pickerItems,
    focusId: ui.pickerFocus?.[pickKey] || "",
    toggleAction: "toggle-activePick-lvl",
    focusAction: "",
    emptyHint: "No options available.",
    topHtml
  });
}

function renderOrbit(options) {
  return `
    <div class="radial-orbit">
      ${options.map((o, i) => `
        <button class="radial-node" data-idx="${i}" data-action="${o.action}" data-id="${escapeHtml(o.id)}">
          <div class="radial-node-button">${o.icon ?? ""}</div>
          <div class="radial-node-label">${escapeHtml(o.label ?? "")}</div>
        </button>
      `).join("")}
    </div>
  `;
}

async function renderRadial(node, state, bindingRow) {
  const props = node.props || {};
  const items = await resolveBinding(bindingRow, state);

  const labelField = String(bindingRow?.LabelField ?? "name");
  const iconField = String(bindingRow?.IconField ?? "icon");
  const valueField = String(bindingRow?.ValueField ?? "id");

  const options = items.map((it) => {
    const id = it?.[valueField] ?? it?.id ?? it?.Id;
    if (id == null) return null;
    const label = it?.[labelField] ?? it?.name ?? it?.Name ?? String(id);
    const iconVal = it?.[iconField] ?? it?.icon ?? it?.Icon ?? "";
    const icon = renderIconMaybe(iconVal, "◈");
    const action = props.selectAction || "";
    return { id: String(id), label: String(label), icon, action };
  }).filter(Boolean);

  const title = props.title || "";
  const selectedPath = props.selectedPath;
  const selectedId = selectedPath ? getPath(state, selectedPath) : null;

  // Mark selected (CSS: add .selected maybe)
  const orbitOptions = options.map(o => ({ ...o, action: props.selectAction || "" }));

  const centerSubtitle = selectedId ? options.find(o => o.id === String(selectedId))?.label : "";

  return `
    <div class="radial-stage" data-stage="${escapeHtml(node.ComponentId)}" style="position:relative;z-index:1;min-height:420px;margin:10px 0;">
      <div class="radial-center">
        <div class="radial-center-title">${escapeHtml(title)}</div>
        ${centerSubtitle ? `<div class="radial-center-sub">${escapeHtml(centerSubtitle)}</div>` : ``}
      </div>
      ${renderOrbit(orbitOptions)}
    </div>
  `;
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
  if (t === "choiceButtons") {
    const binding = node.BindingId ? bindingsById.get(node.BindingId) : null;
    return await renderChoiceButtons(node, state, binding);
  }
  if (t === "pickWindow") {
    const binding = node.BindingId ? bindingsById.get(node.BindingId) : null;
    return await renderPickWindow(node, state, binding);
  }
  if (t === "radial") {
    const binding = node.BindingId ? bindingsById.get(node.BindingId) : null;
    return await renderRadial(node, state, binding);
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
