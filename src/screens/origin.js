import { ChoiceScreen } from "./choice.js";

export function OriginScreen({ state }) {
  const selected = state.character.origin;

  return ChoiceScreen({
    title: "Origin",
    subtitle: "Choose your story",
    selectedId: selected,
    selectAction: "select-origin",
    options: [
      { id: "custom", label: "Custom", icon: "👤", desc: "Build a character from scratch." },
      { id: "dark-urge", label: "Dark Urge", icon: "🩸", desc: "A darker origin — background locked to Haunted One." }
    ]
  });
}
