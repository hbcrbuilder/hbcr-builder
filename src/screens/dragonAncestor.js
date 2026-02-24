import { loadData } from "../data/liveData.js";
import { ChoiceScreen } from "./choice.js";

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normLower(s) {
  return String(s ?? "").trim().toLowerCase();
}

function getBuildLevel(state) {
  return Math.max(1, Math.min(12, Number(
    state.ui?.picker?.level ||
    state.ui?.radial?.buildLevel ||
    state.character?.level ||
    1
  )));
}

function getSelected(state) {
  const buildLevel = getBuildLevel(state);
  const tl = Array.isArray(state.character?.build?.timeline) ? state.character.build.timeline : [];
  const entry = tl[Math.max(0, Math.min(11, buildLevel - 1))] || {};
  return (
    entry?.picks?.dragonAncestor ??
    state.character?.dragonAncestor ??
    null
  );
}

function iconHtml(iconName) {
  const name = String(iconName ?? "").trim();
  if (!name) return "◈";
  const src = `./assets/icons/draconic_ancestor/${name}.png`;
  return `<img src="${escAttr(src)}" alt="" style="width:56px;height:56px;object-fit:contain;filter: drop-shadow(0 6px 12px rgba(0,0,0,0.35));" />`;
}

async function loadDragonAncestorOptions() {
  // Local fallback exists for offline/dev, live mode reads PickListItems from the bundle.
  const rows = await loadData("./data/picklistitems.json", "PickListItems", (r) => r);
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : []);

  const filtered = list
    .filter((r) => normLower(r?.PickType ?? r?.pickType) === "dragon_ancestor")
    .map((r) => {
      const id = String(r?.ItemId ?? r?.itemId ?? r?.id ?? "").trim();
      const label = String(r?.Label ?? r?.label ?? id).trim();
      const icon = r?.Icon ?? r?.icon;
      const sort = Number(r?.Sort ?? r?.sort ?? 0);
      return { id, label, icon, sort };
    })
    .filter((o) => o.id);

  filtered.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.label.localeCompare(b.label));

  return filtered.map((o) => ({
    id: o.id,
    label: o.label,
    icon: iconHtml(o.icon)
  }));
}

export async function DragonAncestorScreen({ state }) {
  const selected = getSelected(state);
  const options = await loadDragonAncestorOptions();

  return ChoiceScreen({
    title: "Dragon Ancestor",
    subtitle: "Level 1 · Choose your draconic ancestry",
    selectedId: selected,
    selectAction: "select-dragonAncestor",
    options,
    note: options.length ? null : "No dragon ancestor options found. (Did you publish the PickListItems tab?)"
  });
}
