export function createStore() {
  const initialCharacter = () => ({
    origin: null,          // "custom" | "dark-urge"
    race: null,
    subrace: null,
    class: null,
    subclass: null,

    // Character level (1–12). Used for summary display.
    level: 1,

    // Multiclass build timeline (per *character* level).
    // Each slot stores the class/subclass taken at that character level,
    // plus any picks made for that level.
    build: {
      timeline: Array.from({ length: 12 }, (_, i) => ({
        lvl: i + 1,
        classId: null,
        subclassId: null,
        picks: {}
      }))
    },

    // Class feature choices (placeholders for now)
    metamagic: null,
    wildshapes: [],
    manoeuvres: null,
    smites: null,
    frontierBallistics: null,
    dragonAncestor: null,
    pactBinding: null,
    steelforgedFlourishes: null,
    combatTechniques: null,
    elementalFletchings: null,
    gatheredSwarm: null,
    optimizationMatrix: null,
    sabotageMatrix: null,

    cantrips: [],
    spells: [],

    characterTrait: null,
    personality: null,
    deity: null,
    background: null,

    // Dynamic post-subclass step flow
    // (Derived from subclass and used to compute the route order)
    subclassFlow: [],

    abilities: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
    proficiencies: [],
    features: [],
    equipment: []
  });

  const state = {
    mod: null,
    character: initialCharacter(),
    ui: {
      buildLevel: 1,
      // Layout-driven pick UI state (Option 2)
      activePickType: null,
      activePickLimit: 0,
      activePickLabel: null,
      radial: {
        stage: "race",            // race | subrace | class | subclass | build
        buildLevel: 1,          // current character level being edited in build timeline
        breadcrumbs: []            // [{ stage, id, label, icon }]
      },
      picker: { open: false, type: null, level: 1 },
      // Picker UI state
      spellFilters: { search: "" },
      cantripFilters: { search: "" },
      pickerFocus: {
        spells: null,
        cantrips: null,
      },
    }
  };

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(state));

  return {
    getState: () => state,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    setMod: (mod) => { state.mod = mod; notify(); },
    patchCharacter: (patch) => { Object.assign(state.character, patch); notify(); },
    patchUI: (patch) => { Object.assign(state.ui, patch); notify(); },
    
    // Ensure timeline slot exists and optionally auto-fill it from the most recent prior level.
    // This fixes the "right-side level boxes empty" issue when the UI visually carries forward
    // the previous class but the timeline slot was never explicitly written.
    setBuildLevel: (level) => {
      const lvl = Math.max(1, Math.min(12, Number(level) || 1));
      const ch = state.character;

      // Ensure timeline exists
      if (!ch.build || !Array.isArray(ch.build.timeline)) {
        ch.build = {
          ...(ch.build || {}),
          timeline: Array.from({ length: 12 }, (_, i) => ({ lvl: i + 1, classId: null, subclassId: null, picks: {} }))
        };
      }

      const tl = ch.build.timeline;

      // Ensure slot exists
      if (!tl[lvl - 1]) tl[lvl - 1] = { lvl, classId: null, subclassId: null, picks: {} };

      const slot = tl[lvl - 1];

      // Auto-fill if empty: copy most recent prior class/subclass forward
      if (!slot.classId) {
        for (let i = lvl - 2; i >= 0; i--) {
          const prev = tl[i];
          if (prev && prev.classId) {
            slot.classId = prev.classId;
            slot.subclassId = prev.subclassId || null;
            break;
          }
        }
      }

      // Enforce subclass-lock rule: subclass is determined by the FIRST occurrence of that class.
      if (slot.classId) {
        const firstIdx = tl.findIndex(e => String(e?.classId || "") === String(slot.classId));
        if (firstIdx >= 0) {
          const firstSubclass = tl[firstIdx]?.subclassId || null;
          // If current slot is not the first occurrence, lock to first subclass (even if empty)
          if ((lvl - 1) !== firstIdx) {
            slot.subclassId = firstSubclass;
          } else {
            // first occurrence: keep current subclass (user-editable elsewhere)
            // (do nothing)
          }
        }
      }

      // Set UI level
      state.ui.buildLevel = lvl;
      if (state.ui.radial) state.ui.radial.buildLevel = lvl;

      notify();
    },

    resetCharacter: () => { state.character = initialCharacter(); notify(); }
  };
}
