import { ChoiceScreen } from "./choice.js";

export function DragonAncestorScreen({ state }) {
  const selected = state.character.dragonAncestor;
  return ChoiceScreen({
    title: "Dragon Ancestor",
    subtitle: "Choose ancestor",
    selectedId: selected,
    selectAction: "select-dragonAncestor",
    options: [
  {
    "id": "red",
    "label": "Red",
    "icon": "\ud83d\udc09"
  },
  {
    "id": "blue",
    "label": "Blue",
    "icon": "\ud83d\udc09"
  },
  {
    "id": "gold",
    "label": "Gold",
    "icon": "\ud83d\udc09"
  }
]
  });
}
