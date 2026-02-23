import { ChoiceScreen } from "./choice.js";

export function PersonalityScreen({ state }) {
  const selected = state.character.personality;
  return ChoiceScreen({
    title: "Personality",
    subtitle: "Choose your personality",
    selectedId: selected,
    selectAction: "select-personality",
    options: [
  {
    "id": "kind",
    "label": "Kind",
    "icon": "\ud83e\udd0d"
  },
  {
    "id": "sarcastic",
    "label": "Sarcastic",
    "icon": "\ud83d\ude0f"
  },
  {
    "id": "ruthless",
    "label": "Ruthless",
    "icon": "\ud83d\udde1\ufe0f"
  }
]
  });
}
