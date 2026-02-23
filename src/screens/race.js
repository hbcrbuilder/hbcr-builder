import { ChoiceScreen } from "./choice.js";
import { loadRacesJson } from "../data/liveData.js";

async function loadRaces(){
  return await loadRacesJson();
}

export async function RaceScreen({ state }) {
  const data = await loadRaces();
  const selected = state.character.race;

  const options = data.races.map(r => ({
    id: r.id,
    label: r.name,
    icon: r.icon ? `<img src="${r.icon}" alt="" style="width:64px;height:64px;object-fit:contain"/>` : "◈",
    desc: r.traits ? r.traits[0] : ""
  }));

  return ChoiceScreen({
    title: "Race",
    subtitle: "Choose your race",
    selectedId: selected,
    selectAction: "select-race",
    options
  });
}
