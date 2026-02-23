import { ChoiceScreen } from "./choice.js";

export function GatheredSwarmScreen({ state }) {
  const selected = state.character.gatheredSwarm;
  return ChoiceScreen({
    title: "Gathered Swarm",
    subtitle: "Choose swarm",
    selectedId: selected,
    selectAction: "select-gatheredSwarm",
    options: [
  {
    "id": "swarm-a",
    "label": "Swarm A",
    "icon": "\ud83e\udeb2"
  },
  {
    "id": "swarm-b",
    "label": "Swarm B",
    "icon": "\ud83e\udeb2"
  }
]
  });
}
