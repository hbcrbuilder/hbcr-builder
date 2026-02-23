import { ChoiceScreen } from "./choice.js";

export function SteelforgedFlourishesScreen({ state }) {
  const selected = state.character.steelforgedFlourishes;
  return ChoiceScreen({
    title: "Steelforged Flourishes",
    subtitle: "Choose flourishes",
    selectedId: selected,
    selectAction: "select-steelforgedFlourishes",
    options: [
  {
    "id": "flourish-a",
    "label": "Flourish A",
    "icon": "\u2736"
  },
  {
    "id": "flourish-b",
    "label": "Flourish B",
    "icon": "\u2736"
  }
]
  });
}
