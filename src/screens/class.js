import { ChoiceScreen } from "./choice.js";

async function loadClasses(){
  const res = await fetch("./data/classes.json");
  return res.json();
}

export async function ClassScreen({ state }) {
  const data = await loadClasses();
  const selected = state.character.class;

  const options = data.classes.map(c => ({
    id: c.id,
    label: c.name,
    icon: c.icon ? `<img src="${c.icon}" alt="" style="width:64px;height:64px;object-fit:contain"/>` : "◈",
  }));

  return ChoiceScreen({
    title: "Class",
    subtitle: "Choose your class",
    selectedId: selected,
    selectAction: "select-class",
    options
  });
}
