import { ChoiceScreen } from "./choice.js";

async function loadTraits(){
  const res = await fetch("./data/traits.json", { cache: "no-store" });
  return res.json();
}

export async function CharacterTraitScreen({ state }) {
  const selected = state.character.characterTrait;
  const data = await loadTraits();

  const options = (data.traits ?? []).map(t => ({
    id: t.id,
    label: t.name,
    icon: "⚖",
    desc: t.description
  }));

  return ChoiceScreen({
    title: "Character Trait",
    subtitle: "Pick one optional trait (Homebrew)",
    selectedId: selected,
    selectAction: "select-characterTrait",
    options,
    note: "Traits are optional and include both benefits and drawbacks."
  });
}
