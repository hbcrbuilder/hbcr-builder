import { ChoiceScreen } from "./choice.js";
import { loadRacesJson } from "../data/liveData.js";

async function loadRaces(){
  return await loadRacesJson();
}

export async function SubraceScreen({ state }) {
  const data = await loadRaces();
  const raceId = state.character.race;
  const race = data.races.find(r => r.id === raceId);

  if (!race) {
    return ChoiceScreen({
      title: "Subrace",
      subtitle: "Choose your subrace",
      selectedId: null,
      selectAction: "select-subrace",
      options: [],
      note: "Pick a race first."
    });
  }

  // Some races have no subrace; auto-skip will be handled by router flow later.
  const subs = race.subraces || [];
  const options = subs.map(s => ({
    id: s.id,
    label: s.name,
    icon: s.icon ? `<img src="${s.icon}" alt="" style="width:64px;height:64px;object-fit:contain"/>` : "◆",
    desc: (s.oncePerCombatSpell?.name) ? `Once/Combat: ${s.oncePerCombatSpell.name}` :
          (s.resistance ? `Resistance: ${s.resistance}` : (s.traits?.[0] || ""))
  }));

  return ChoiceScreen({
    title: "Subrace",
    subtitle: `Choose your ${race.name} subrace`,
    selectedId: state.character.subrace,
    selectAction: "select-subrace",
    options
  });
}
