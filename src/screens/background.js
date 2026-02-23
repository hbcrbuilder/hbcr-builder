import { ChoiceScreen } from "./choice.js";

export function BackgroundScreen({ state }) {
  const isDarkUrge = state.character.origin === "dark-urge";

  if (isDarkUrge) {
    return ChoiceScreen({
      title: "Background",
      subtitle: "Locked for Dark Urge",
      selectedId: "haunted-one",
      selectAction: "select-background",
      options: [
        { id: "haunted-one", label: "Haunted One", icon: "🕯️", desc: "Locked background for Dark Urge." }
      ],
      note: "Background is locked to Haunted One for Dark Urge.",
      disableAll: true
    });
  }

  return ChoiceScreen({
    title: "Background",
    subtitle: "Choose your background",
    selectedId: state.character.background,
    selectAction: "select-background",
    options: [
      { id: "acolyte", label: "Acolyte", icon: "📜" },
      { id: "soldier", label: "Soldier", icon: "🪖" },
      { id: "urchin", label: "Urchin", icon: "🧤" },
      { id: "sage", label: "Sage", icon: "📚" }
    ]
  });
}
