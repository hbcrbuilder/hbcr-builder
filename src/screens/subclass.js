import { ChoiceScreen } from "./choice.js";
import { getBundle, loadClassesFullJson } from "../data/liveData.js";

async function loadClassesFull() {
  return await loadClassesFullJson();
}

export async function SubclassScreen({ state }) {
  const selected = state.character.subclass;
  const clsId = state.character.class;

  if (!clsId) {
    return ChoiceScreen({
      title: "Subclass",
      subtitle: "Pick a class first",
      selectedId: selected,
      selectAction: "select-subclass",
      options: [],
      note: "Go back and choose a class before selecting a subclass.",
      disableAll: true,
    });
  }

  const data = await loadClassesFull();
  const cls = data.classes.find((c) => c.id === clsId);

  // IMPORTANT:
  // The maintainer edits live in the bundle sheet (Subclasses).
  // classes.full.json is useful for level feature details, but cannot be the only
  // source of truth for the Subclass picker, otherwise new/modded subclasses won't
  // appear in preview.
  //
  // Strategy:
  //  1) Prefer bundle.Subclasses filtered by ClassId
  //  2) Fall back to classes.full.json subclasses
  const b = await getBundle();
  const src = Array.isArray(b?.Subclasses)
    ? b.Subclasses
    : Array.isArray(b?.Subclasses?.rows)
      ? b.Subclasses.rows
      : [];

  const byId = new Map();

  // 1) Bundle-driven options
  for (const r of src) {
    const classId = r?.ClassId ?? r?.classId ?? r?.ParentClassId ?? r?.parentClassId;
    if (String(classId || "") !== String(clsId)) continue;

    const id = r?.SubclassId ?? r?.id ?? r?.Id ?? r?.ID;
    if (!id) continue;

    const name = r?.SubclassName ?? r?.name ?? r?.Name ?? String(id);
    const desc = r?.Description ?? r?.desc ?? r?.Desc ?? r?.description ?? "";

    byId.set(String(id), { id: String(id), label: name, icon: "✦", desc });
  }

  // 2) Fallback/enrichment from classes.full.json
  for (const sc of cls?.subclasses ?? []) {
    const id = sc?.id;
    if (!id) continue;
    if (!byId.has(String(id))) {
      byId.set(String(id), {
        id: String(id),
        label: sc?.name ?? String(id),
        icon: "✦",
        desc: (sc?.levels?.["1st"] ?? []).join(", "),
      });
    }
  }

  const options = Array.from(byId.values());

  return ChoiceScreen({
    title: "Subclass",
    subtitle: `Choose your ${cls?.name ?? ""} subclass`,
    selectedId: selected,
    selectAction: "select-subclass",
    options,
    note: "Subclass features are sourced from the Homebrew class PDFs.",
  });
}
