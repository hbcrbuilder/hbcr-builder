import { ChoiceScreen } from "./choice.js";
import { loadData } from "../data/liveData.js";

async function loadTraits(){
  // Live sheet first (if enabled), fallback to local JSON.
  return await loadData("./data/traits.json", "Traits", (rows) => ({ traits: rows }));
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