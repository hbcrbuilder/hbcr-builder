import { ChoiceScreen } from "./choice.js";
import { loadData } from "../data/liveData.js";

function esc(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

async function loadPickListItems(){
  // Local fallback path is optional; in live mode this reads from the Cloudflare bundle.
  // If you don't ship a local JSON file for PickListItems, this will simply return [].
  try{
    const rows = await loadData("./data/picklistitems.json", "PickListItems", (r)=>r);
    return Array.isArray(rows) ? rows : [];
  }catch{
    try{
      const rows = await loadData("./data/choices.json", "PickListItems", (r)=>r);
      return Array.isArray(rows) ? rows : [];
    }catch{
      return [];
    }
  }
}

function getBuildLevel(state){
  return Math.max(1, Math.min(12, Number(
    state.ui?.picker?.level ||
    state.ui?.radial?.buildLevel ||
    state.character.level ||
    1
  )));
}

function getSelectedId(state, buildLevel){
  const tl = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const slot = tl[Math.max(0, Math.min(11, buildLevel - 1))] || {};
  const picked = slot?.picks?.dragonAncestor;
  return picked || state.character.dragonAncestor || null;
}

function iconHtml(iconKey){
  const key = String(iconKey || "").trim();
  if(!key) return "🐉";

  // Matches the pattern used by MetamagicScreen.
  // Expect files like: src/assets/icons/draconic_ancestor/Draconic_Black.png
  const src = `./src/assets/icons/draconic_ancestor/${key}.png`;
  return `
    <img class="icon-img" src="${esc(src)}" alt=""
         onerror="this.style.display='none'; const fb=this.nextElementSibling; if(fb) fb.style.display='inline';">
    <span class="icon-fallback" style="display:none;">🐉</span>
  `;
}

export async function DragonAncestorScreen({ state }) {
  const buildLevel = getBuildLevel(state);
  const selected = getSelectedId(state, buildLevel);

  const all = await loadPickListItems();
  const items = (all || []).filter(r => {
    const pt = String(r?.pickType ?? r?.PickType ?? r?.pick_type ?? "").toLowerCase().trim();
    return pt === "dragon_ancestor";
  });

  const options = items
    .map(r => ({
      id: String(r?.itemId ?? r?.ItemId ?? r?.id ?? "").trim(),
      label: String(r?.label ?? r?.Label ?? r?.name ?? r?.Name ?? "").trim(),
      icon: iconHtml(r?.icon ?? r?.Icon),
      sort: Number(r?.sort ?? r?.Sort ?? 9999)
    }))
    .filter(o => o.id)
    .sort((a,b) => (a.sort - b.sort) || a.label.localeCompare(b.label));

  return ChoiceScreen({
    title: "Dragon Ancestor",
    subtitle: `Level ${buildLevel} • Choose your Draconic Ancestry`,
    selectedId: selected,
    selectAction: "select-dragonAncestor",
    options,
    note: options.length ? null : "No dragon ancestor options found. (Did you publish the PickListItems tab?)"
  });
}
