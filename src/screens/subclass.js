import { ChoiceScreen } from "./choice.js";

async function loadClassesFull() {
  const res = await fetch("./data/classes.full.json", { cache: "no-store" });
  return res.json();
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
      disableAll: true
    });
  }

  const data = await loadClassesFull();
  const cls = data.classes.find(c => c.id === clsId);

  const options = (cls?.subclasses ?? []).map(sc => ({
    id: sc.id,
    label: sc.name,
    icon: "✦",
    desc: (sc.levels?.["1st"] ?? []).join(", ")
  }));

  return ChoiceScreen({
    title: "Subclass",
    subtitle: `Choose your ${cls?.name ?? ""} subclass`,
    selectedId: selected,
    selectAction: "select-subclass",
    options,
    note: "Subclass features are sourced from the Homebrew class PDFs."
  });
}
