import { ChoiceScreen } from "./choice.js";

export function PactBindingScreen({ state }) {
  const selected = state.character.pactBinding;
  return ChoiceScreen({
    title: "Pact Binding",
    subtitle: "Choose pact binding",
    selectedId: selected,
    selectAction: "select-pactBinding",
    options: [
  {
    "id": "blade",
    "label": "Pact of the Blade",
    "icon": "\ud83d\udde1\ufe0f"
  },
  {
    "id": "chain",
    "label": "Pact of the Chain",
    "icon": "\u26d3\ufe0f"
  }
]
  });
}
