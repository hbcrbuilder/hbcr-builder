import { ChoiceScreen } from "./choice.js";

export function DeityScreen({ state }) {
  const selected = state.character.deity;
  return ChoiceScreen({
    title: "Deity",
    subtitle: "Choose your deity",
    selectedId: selected,
    selectAction: "select-deity",
    options: [
  {
    "id": "selune",
    "label": "Sel\u00fbne",
    "icon": "\ud83c\udf19"
  },
  {
    "id": "shar",
    "label": "Shar",
    "icon": "\ud83c\udf11"
  },
  {
    "id": "tyr",
    "label": "Tyr",
    "icon": "\u2696\ufe0f"
  }
]
  });
}
