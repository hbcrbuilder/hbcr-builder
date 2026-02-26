import { loadData } from "./liveData.js";

function normLower(s){
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Loads PickListItems from the live bundle (preferred) with local JSON fallback.
 * Returns a normalized list of items for a given PickType.
 *
 * Expected sheet columns (case-insensitive):
 * PickType, ItemId, Label, Description (optional), Icon (optional), Sort (optional), Cost (optional)
 */
export async function loadPickListItems(pickType){
  const rows = await loadData("./data/picklistitems.json", "PickListItems", (r) => r);
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : []);

  const want = normLower(pickType);

  const out = list
    .filter(r => normLower(r?.PickType ?? r?.pickType) === want)
    .map(r => {
      const id = String(r?.ItemId ?? r?.itemId ?? r?.id ?? "").trim();
      const label = String(r?.Label ?? r?.label ?? r?.name ?? id).trim();
      const desc = String(r?.Description ?? r?.description ?? r?.Desc ?? r?.desc ?? "").trim();
      const icon = String(r?.Icon ?? r?.icon ?? "").trim();
      const sort = Number(r?.Sort ?? r?.sort ?? 0) || 0;
      const cost = Number(r?.Cost ?? r?.cost ?? 0) || 0;
      return { id, label, desc, icon, sort, cost };
    })
    .filter(o => o.id);

  out.sort((a,b)=>(a.sort||0)-(b.sort||0) || a.label.localeCompare(b.label, undefined, { sensitivity:"base" }));
  return out;
}
