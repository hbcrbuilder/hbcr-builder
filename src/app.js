import { createStore } from "./store.js";
import { createRouter } from "./router.js";

import { RaceScreen } from "./screens/race.js";
import { SubraceScreen } from "./screens/subrace.js";
import { ClassScreen } from "./screens/class.js";
import { SubclassScreen } from "./screens/subclass.js";
import { MetamagicScreen } from "./screens/metamagic.js";
import { WildshapesScreen } from "./screens/wildshapes.js";
import { ManoeuvresScreen } from "./screens/manoeuvres.js";
import { SmitesScreen } from "./screens/smites.js";
import { FrontierBallisticsScreen } from "./screens/frontierBallistics.js";
import { DragonAncestorScreen } from "./screens/dragonAncestor.js";
import { PactBindingScreen } from "./screens/pactBinding.js";
import { SteelforgedFlourishesScreen } from "./screens/steelforgedFlourishes.js";
import { CombatTechniquesScreen } from "./screens/combatTechniques.js";
import { ElementalFletchingsScreen } from "./screens/elementalFletchings.js";
import { GatheredSwarmScreen } from "./screens/gatheredSwarm.js";
import { OptimizationMatrixScreen } from "./screens/optimizationMatrix.js";
import { SabotageMatrixScreen } from "./screens/sabotageMatrix.js";
import { CantripsScreen } from "./screens/cantrips.js";
import { SpellsScreen } from "./screens/spells.js";
import { FeatsScreen } from "./screens/feats.js";
import { PassivesScreen } from "./screens/passives.js";
import { LayoutScreen } from "./screens/layout.js";

// Spells/Cantrips/Feats are accessed from the radial Build pane.
// They are routed as lightweight pickers and always return to the Build pane.
// NOTE: The builder has moved to the radial workflow.
// The legacy full-page screens (Character Trait / Personality / Deity / Background / Abilities)
// are intentionally not wired into the app routing anymore.

function applyPaladinDivineSmite(timeline){
  const tl = (Array.isArray(timeline) ? timeline : []).map(e => ({ ...e, picks: { ...(e?.picks || {}) } }));
  // Remove any existing divine smite markers (we'll re-apply to the true first Paladin level).
  for(let i=0;i<tl.length;i++){
    const e = tl[i];
    const picks = { ...(e?.picks || {}) };
    if(Array.isArray(picks.smites)) picks.smites = picks.smites.filter(x => x !== 'divine');
    tl[i] = { ...e, picks };
  }

  const firstIdx = tl.findIndex(e => String(e?.classId || '') === 'paladin');
  if(firstIdx >= 0){
    const e = tl[firstIdx];
    const picks = { ...(e?.picks || {}) };
    // Paladin Class Level 1 always grants Divine Smite; it is not a choice.
    const existing = Array.isArray(picks.smites) ? picks.smites.filter(x => x !== 'divine') : [];
    // Preserve any additional smites picked at that Paladin-1 slot.
    picks.smites = ['divine', ...existing];
    tl[firstIdx] = { ...e, picks };
  }

  return tl;
}

import { RadialScreen, installRadialLayout } from "./screens/radial.js";

import { installDesignMode } from "./design/designMode.js";


const appEl = document.getElementById("app");

const store = createStore();

const screens = {
  radial: (ctx) => RadialScreen(ctx),
  race: (ctx) => RaceScreen(ctx),
  subrace: (ctx) => SubraceScreen(ctx),
  class: (ctx) => ClassScreen(ctx),
  subclass: (ctx) => SubclassScreen(ctx),

  // Layout-driven screens (Option 2). Start with picks.
  picks: (ctx) => LayoutScreen(ctx, "picks"),

  metamagic: (ctx) => MetamagicScreen(ctx),
  wildshapes: (ctx) => WildshapesScreen(ctx),
  manoeuvres: (ctx) => ManoeuvresScreen(ctx),
  smites: (ctx) => SmitesScreen(ctx),
  frontierBallistics: (ctx) => FrontierBallisticsScreen(ctx),
  dragonAncestor: (ctx) => DragonAncestorScreen(ctx),
  pactBinding: (ctx) => PactBindingScreen(ctx),
  steelforgedFlourishes: (ctx) => SteelforgedFlourishesScreen(ctx),
  combatTechniques: (ctx) => CombatTechniquesScreen(ctx),
  elementalFletchings: (ctx) => ElementalFletchingsScreen(ctx),
  gatheredSwarm: (ctx) => GatheredSwarmScreen(ctx),
  optimizationMatrix: (ctx) => OptimizationMatrixScreen(ctx),
  sabotageMatrix: (ctx) => SabotageMatrixScreen(ctx),
  cantrips: (ctx) => CantripsScreen(ctx),
  spells: (ctx) => SpellsScreen(ctx),
  feats: (ctx) => FeatsScreen(ctx),
  passives: (ctx) => PassivesScreen(ctx),
  // Legacy pages removed from routing (radial handles these now)
};


// Post-subclass step flows.
// Note: some subclass IDs in classes.full.json are missing their first letter due to PDF parsing.
// We map using the IDs currently present in data.
// Previously, after subclass selection we routed through several full-page steps.
// With the radial workflow, those screens are removed.
const baseTail = [];
const subclassFlowMap = {
  artificer: {
    "arcanist": [...baseTail],
    "rtillerist": [...baseTail],
    "battle-synthetic": [...baseTail],
    "infused-arcsmith": ["optimizationMatrix", "sabotageMatrix", ...baseTail]
  },
  barbarian: {
    "bestial-heart": [...baseTail],
    "frenzy": [...baseTail],
    "frostbreaker": [...baseTail],
    "giants-blood": [...baseTail],
    "wild-magic": [...baseTail]
  },
  bard: {
    "ollege-captivation": [...baseTail],
    "ollege-lore": [...baseTail],
    "ollege-steel": ["steelforgedFlourishes", ...baseTail],
    "ollege-alour": [...baseTail]
  },
  cleric: {
    "death-omain": [...baseTail],
    "life-omain": [...baseTail],
    "empest-omain": [...baseTail],
    "war-omain": [...baseTail]
  },
  druid: {
    "circle-of-the-elements": ["wildshapes", ...baseTail],
    "circle-of-the-land": ["wildshapes", ...baseTail],
    "circle-of-the-moon": [...baseTail],
    "circle-of-the-spores": ["wildshapes", ...baseTail],
    "circle-of-the-stars": ["wildshapes", ...baseTail]
  },
  fighter: {
    "arcane-archer": ["manoeuvres", "elementalFletchings", ...baseTail],
    "champion": ["manoeuvres", ...baseTail],
    "eldritch-knight": ["manoeuvres", ...baseTail],
    "frontier-knight": ["manoeuvres", "combatTechniques", ...baseTail]
  },
  monk: {
    "may-the-rcane": [...baseTail],
    "may-the-drunken-fist": [...baseTail],
    "may-the-pen-and": [...baseTail],
    "may-the-shadow-arts": [...baseTail]
  },
  paladin: {
    "eath-of-the-ncients": ["smites", ...baseTail],
    "eath-of-the-crowned-phoenix": ["smites", ...baseTail],
    "eath-of-evotion": ["smites", ...baseTail],
    "eath-of-vengeance": ["smites", ...baseTail],
    "oathbreaker": ["smites", ...baseTail]
  },
  ranger: {
    "beast-aster": ["frontierBallistics", ...baseTail],
    "bloom-stalker": ["frontierBallistics", ...baseTail],
    "hunter": ["frontierBallistics", ...baseTail],
    "warmkeeper": ["gatheredSwarm", "frontierBallistics", ...baseTail]
  },
  rogue: {
    "arcane-trickster": [...baseTail],
    "assassin": [...baseTail],
    "mercenary": [...baseTail],
    "hief": [...baseTail]
  },
  sorcerer: {
    "draconic-loodline": ["dragonAncestor", "metamagic", ...baseTail],
    "hade-alker": ["metamagic", ...baseTail],
    "olcanist": ["metamagic", ...baseTail],
    "wild-magic": ["metamagic", ...baseTail]
  },
  warlock: {
    "act-the-blade": ["pactBinding", ...baseTail],
    "act-the-chain": ["pactBinding", ...baseTail],
    "act-penumbra": ["pactBinding", ...baseTail],
    "act-the-ome": ["pactBinding", ...baseTail]
  },
  wizard: {
    "arcblade": [...baseTail],
    "arcane-warden": [...baseTail],
    "evoker": [...baseTail],
    "necromancer": [...baseTail]
  }
};



function buildFlow(character) {
  // Races without subraces go straight to Class.
  const noSubrace = new Set(["githyanki", "half-orc", "human"]);
  const base = [
    "race",
    ...(noSubrace.has(character.race) ? [] : ["subrace"]),
    "class",
    "subclass"
  ];

  // After choosing a subclass, continue with that subclass's step chain.
  const classId = character.class;
  const subclassId = character.subclass;
  if (!classId || !subclassId) return base;

  const flowKey = `${classId}:${subclassId}`;

  // Data-driven subclass flow (no-code maintainer path):
  // flows.json -> subclasses["class:subclass"] = ["metamagic", ...]
  const dataFlow = (__hbcrFlows && __hbcrFlows.subclasses) ? __hbcrFlows.subclasses[flowKey] : null;

  // Fallback to legacy hardcoded map for backward compatibility.
  const flow = (Array.isArray(dataFlow) ? dataFlow : (subclassFlowMap?.[classId]?.[subclassId] ?? character.subclassFlow ?? baseTail));
  return [...base, ...flow];
}

const router = createRouter({ screens, initialRoute: "radial" });

async function loadModMeta() {
  try {
    const res = await fetch("./data/mod.json", { cache: "no-store" });
    const mod = await res.json();
    store.setMod(mod);
  } catch {
    store.setMod({ modName: "HBCR", modVersion: "?", builderVersion: "?" });
  }
}

let __hbcrFlows = null;
let __hbcrFlowsPromise = null;

async function loadFlowsConfig(){
  if(__hbcrFlows) return __hbcrFlows;
  if(__hbcrFlowsPromise) return __hbcrFlowsPromise;
  __hbcrFlowsPromise = (async () => {
    try{
      const res = await fetch("./data/flows.json", { cache: "no-store" });
      if(!res.ok) return null;
      const data = await res.json();
      if(data && typeof data === "object") __hbcrFlows = data;
    }catch(e){
      __hbcrFlows = null;
    }
    return __hbcrFlows;
  })();
  return __hbcrFlowsPromise;
}



async function render() {
  const state = store.getState();

  try { appEl.setAttribute("data-screen", router.getRoute()); } catch {}


  const screenFn = router.resolve();
  const ctx = {
    state,
    actions: {
      go: async (route) => { router.go(route); await render(); },
      patch: (patch) => store.patchCharacter(patch),
      reset: () => store.resetCharacter()
    }
  };

  const screenHtml = await screenFn(ctx);

// Breadcrumbs are rendered by the radial screen itself (docked to the radial pane)
// so their placement is always correct relative to the "build window".
// (Non-radial legacy screens can add their own later if needed.)
const crumbHtml = ``;
  const header = `
    <div class="topbar">
      <div class="brand-row">
        <img class="hbcr-logo" src="./assets/ui/hbcr-logo-cutout.png" alt="Home Brew - Comprehensive Reworks"/>
        <div class="brand-text">
</div>
      </div>
      <div class="version-pill">
        <span>Mod v${state.mod?.modVersion ?? "?"}</span>
        <span style="opacity:.55">•</span>
        <span>Builder v${state.mod?.builderVersion ?? "?"}</span>
      </div>
    </div>
    <div class="divider"></div>
  `;

  appEl.innerHTML = `
    <div class="frame">
      ${header}
      <div class="content">
        ${crumbHtml}
        ${screenHtml}
      </div>
    </div>
  `;

  // After the DOM is in place, install responsive orbit positioning for the radial UI.
  // This keeps the big center circle centered and reflows orbit nodes on window resize.
  if (router.getRoute() === "radial") {
    requestAnimationFrame(() => {
      try { installRadialLayout(); } catch { /* ignore */ }
    });
  }
}

function layoutRadial() {
  const pane = appEl.querySelector('.radial-pane');
  if (!pane) return;
  const nodes = Array.from(pane.querySelectorAll('.radial-node'));
  if (!nodes.length) return;

  const rect = pane.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const minDim = Math.min(w, h);

  // node "footprint" (rough) to keep a safe margin from edges
  const NODE_R = 68; // ~half of 120x140 incl. label breathing room
  const maxR = Math.max(140, (minDim / 2) - NODE_R - 12);

  // Choose ring strategy based on count
  const n = nodes.length;
  const scale = n > 16 ? 0.78 : n > 12 ? 0.85 : n > 10 ? 0.92 : 1;
  const rings = n <= 10 ? 1 : 2;
  const innerCount = rings === 1 ? n : Math.ceil(n / 2);
  const outerCount = rings === 1 ? 0 : (n - innerCount);

  // Radii tuned to look good across sizes
  const r1 = Math.min(maxR, Math.max(170, maxR * 0.72));
  const r2 = Math.min(maxR, Math.max(r1 + 90, maxR * 0.95));

  const cx = w / 2;
  const cy = h / 2;

  const placeRing = (startIndex, count, radius, phaseDeg) => {
    for (let i = 0; i < count; i++) {
      const node = nodes[startIndex + i];
      if (!node) continue;
      node.style.setProperty('--scale', String(scale));
      const angle = ((360 / Math.max(count, 1)) * i + phaseDeg) * (Math.PI / 180);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      node.style.setProperty('--x', `${x}px`);
      node.style.setProperty('--y', `${y}px`);
    }
  };

  // Phase so labels distribute nicely (top isn't always the same item)
  placeRing(0, innerCount, r1, -90);
  if (rings === 2) placeRing(innerCount, outerCount, r2, -90 + (180 / Math.max(outerCount, 1)));
}

function wireEvents() {
  // Delegated click handler (stable across rerenders)
  document.addEventListener("click", async (e) => {
    const el = e.target?.closest?.("[data-action]");
    if (!el) return;
      const action = el.getAttribute("data-action");
      const id = el.getAttribute("data-id");

  // Allow native <select> interactions without triggering a re-render on click.
  if (el && el.tagName === "SELECT") return;

      
      // Design Mode (slot editor): add a pick card into the dock slot
      if (action === "dm-add-dock-pick") {
        try {
          if (!(window && window.__HBCR_DESIGN__ === true)) return;
        } catch {}
        const slotId = id || "picksDock";
        // Quick template menu (keep no-code): pick an existing route/screen.
        const routes = [
          "cantrips",
          "spells",
          "feats",
          "passives",
          "metamagic",
          "wildshapes",
          "manoeuvres",
          "smites",
          "frontierBallistics",
          "dragonAncestor",
          "pactBinding",
          "steelforgedFlourishes",
          "combatTechniques",
          "elementalFletchings",
          "gatheredSwarm",
          "optimizationMatrix",
          "sabotageMatrix",
        ];
        const route = prompt("Add Pick Card\n\nChoose route:\n" + routes.join("\n"), "cantrips") || "";
        if (!route) return;
        const label = prompt("Label for this button:", route) || route;
        const needStr = prompt("Need count (0 for no badge):", "0") || "0";
        const need = Math.max(0, Number(needStr || 0));
        const props = { route: String(route).trim(), label: String(label).trim(), need };
        // Store in draft UIComponents (localStorage).
        const key = "hbcr_design_draft";
        const raw = localStorage.getItem(key);
        let d = {};
        try { d = raw ? JSON.parse(raw) : {}; } catch { d = {}; }
        d.UIComponents = Array.isArray(d.UIComponents) ? d.UIComponents : [];
        const now = Date.now();
        const compId = "custom." + props.route + "." + now;
        d.UIComponents.push({
          ScreenId: "radial",
          SlotId: slotId,
          ComponentId: compId,
          Type: "PickCard",
          Order: d.UIComponents.length + 1,
          Enabled: "true",
          PropsJson: JSON.stringify(props),
          VisibilityJson: ""
        });
        localStorage.setItem(key, JSON.stringify(d));
        // Force re-render by nudging UI state
        const ui = store.getState().ui || {};
        store.patchUI({ __dmTick: (ui.__dmTick || 0) + 1 });
        return;
      }

      // Trait dropdown (custom menu)
      if (action === "toggle-trait-menu") {
        const ui = store.getState().ui || {};
        store.patchUI({ traitMenuOpen: !ui.traitMenuOpen });
        return;
      }
      if (action === "pick-trait") {
        store.patchCharacter({ characterTrait: id ? (id || null) : null });
        store.patchUI({ traitMenuOpen: false });
        return;
      }
      const state = store.getState();

      const isRadial = router.getRoute() === "radial";

      const nodeLabel = () => {
        const n = el.querySelector('.radial-node-label');
        return (n?.textContent || '').trim();
      };
      const nodeIconSrc = () => {
        const img = el.querySelector('img');
        const src = img?.getAttribute('src');
        return src || null;
      };

      const setRadial = (patch) => {
        const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
        store.patchUI({ radial: { ...cur, ...patch } });
      };

      const upsertCrumb = (crumb) => {
        const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
        const order = ['race','subrace','class','subclass'];
        const existing = cur.breadcrumbs || [];
        const idx = existing.findIndex(c => c.stage === crumb.stage);
        let next = idx >= 0
          ? existing.map(c => (c.stage === crumb.stage ? crumb : c))
          : [...existing, crumb];
        next = next
          .filter(c => order.includes(c.stage))
          .sort((a,b) => order.indexOf(a.stage) - order.indexOf(b.stage));
        setRadial({ breadcrumbs: next });
      };

      // Simple route order for the starter
      const order = buildFlow(store.getState().character);
      const idx = order.indexOf(router.getRoute());
      const goNext = () => router.go(order[Math.min(idx+1, order.length-1)]);
      const goBack = () => router.go(order[Math.max(idx-1, 0)]);

      if (action === "select-origin") { 
        store.patchCharacter({ origin: id });
        if (!isRadial) goNext();
      }

      if (action === "select-race") {
        store.patchCharacter({ race: id, subrace: null, class: null, subclass: null });
        if (isRadial) {
          upsertCrumb({ stage: 'race', id, label: nodeLabel() || id, icon: nodeIconSrc() });
          // races without subraces go straight to class
          const noSubrace = new Set(["githyanki", "half-orc", "human"]);
          setRadial({ stage: noSubrace.has(id) ? 'class' : 'subrace', breadcrumbs: (store.getState().ui.radial?.breadcrumbs || []).filter(c => c.stage === 'race') });
        } else {
          goNext();
        }
      }

      if (action === "select-subrace") {
        store.patchCharacter({ subrace: id, class: null, subclass: null });
        if (isRadial) {
          upsertCrumb({ stage: 'subrace', id, label: nodeLabel() || id, icon: nodeIconSrc() });
          // keep race + subrace
          const keep = new Set(['race','subrace']);
          setRadial({ stage: 'class', breadcrumbs: (store.getState().ui.radial?.breadcrumbs || []).filter(c => keep.has(c.stage)) });
        } else {
          goNext();
        }
      }
      if (action === "select-class") { 
        // reset dependent choices when class changes
        store.patchCharacter({
          class: id,
          subclass: null,
          subclassFlow: [],
          cantrips: [],
          spells: [],
          metamagic: null, wildshapes: null, manoeuvres: null, smites: null, frontierBallistics: null,
          dragonAncestor: null, pactBinding: null, steelforgedFlourishes: null, combatTechniques: null,
          elementalFletchings: null, gatheredSwarm: null, optimizationMatrix: null, sabotageMatrix: null
        });

        // Keep build timeline (ACTIVE level) in sync with radial Class selection
        // The top radial "Class" button should edit the currently viewed build level,
        // not always Level 1.
        {
          const st2 = store.getState();
          const ch2 = st2.character;
          const lvl = Math.max(1, Math.min(12, Number(st2.ui?.radial?.buildLevel ?? ch2.level ?? 1)));
          const timeline2 = (ch2.build?.timeline || Array.from({length:12},(_,i)=>({lvl:i+1,classId:null,subclassId:null,picks:{}}))).map(x=>({...x}));
          timeline2[lvl - 1].classId = id;
          timeline2[lvl - 1].subclassId = null;
          timeline2[lvl - 1].picks = {};
          const timeline3 = applyPaladinDivineSmite(timeline2);
          store.patchCharacter({ build: { ...(ch2.build||{}), timeline: timeline3 } });
        }

        if (isRadial) {
          upsertCrumb({ stage: 'class', id, label: nodeLabel() || id, icon: nodeIconSrc() });
          const keep = new Set(['race','subrace','class']);
          setRadial({ stage: 'subclass', breadcrumbs: (store.getState().ui.radial?.breadcrumbs || []).filter(c => keep.has(c.stage)) });
        } else {
          goNext();
        }
      }
      if (action === "select-subclass") { 
        const classId = store.getState().character.class;
        const flow = subclassFlowMap?.[classId]?.[id] ?? baseTail;
        store.patchCharacter({
          subclass: id,
          subclassFlow: flow,
          // reset flow-dependent picks when subclass changes
          metamagic: null,
          manoeuvres: null,
          smites: null,
          frontierBallistics: null,
          pactBinding: null,
          cantrips: [],
          spells: [],
          characterTrait: null,
          personality: null,
          deity: null,
          background: null,
          dragonAncestor: null, steelforgedFlourishes: null, combatTechniques: null,
          elementalFletchings: null, gatheredSwarm: null, optimizationMatrix: null, sabotageMatrix: null,
          // Circle of the Moon doesn't use the Wildshapes step in your flow list.
          // Keep the value null so the builder doesn't carry over old picks.
          wildshapes: null
        });

        // Keep build timeline (ACTIVE level) in sync with radial Subclass selection
        {
          const st2 = store.getState();
          const ch2 = st2.character;
          const lvl = Math.max(1, Math.min(12, Number(st2.ui?.radial?.buildLevel ?? ch2.level ?? 1)));
          const timeline2 = (ch2.build?.timeline || Array.from({length:12},(_,i)=>({lvl:i+1,classId:null,subclassId:null,picks:{}}))).map(x=>({...x}));
          // Ensure the active level's class is set as well
          timeline2[lvl - 1].classId = timeline2[lvl - 1].classId || classId || ch2.class || null;
          timeline2[lvl - 1].subclassId = id;
          timeline2[lvl - 1].picks = {};
          const timeline3 = applyPaladinDivineSmite(timeline2);
          store.patchCharacter({ build: { ...(ch2.build||{}), timeline: timeline3 } });
        }

        if (isRadial) {
          upsertCrumb({ stage: 'subclass', id, label: nodeLabel() || id, icon: nodeIconSrc() });
          const keep = new Set(['race','subrace','class','subclass']);
          setRadial({ stage: 'build', breadcrumbs: (store.getState().ui.radial?.breadcrumbs || []).filter(c => keep.has(c.stage)) });
        } else {
          goNext();
        }
      }

      if (action === 'radial-nav') {
        // NAV ONLY: always switch the radial stage the user clicked.
        // Do not clear character selections and do not redirect/guard.
        const stage = id;

        const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
        store.patchUI({ radial: { ...cur, stage } });

        router.go('radial');
        return;
      }

      

        
        if (action === 'set-level') {
          const n = Math.max(1, Math.min(12, Number(id || 1)));
          store.patchCharacter({ level: n });
          const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
          store.patchUI({ radial: { ...cur, stage: 'build', buildLevel: n } });
          router.go('radial');
        }

        if (action === 'inc-level') {
          const curLvl = Number(store.getState().character.level || 1);
          const n = Math.max(1, Math.min(12, curLvl + 1));
          store.patchCharacter({ level: n });
          const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
          store.patchUI({ radial: { ...cur, stage: 'build', buildLevel: n } });
          router.go('radial');
        }

        if (action === 'dec-level') {
          const curLvl = Number(store.getState().character.level || 1);
          const n = Math.max(1, Math.min(12, curLvl - 1));
          store.patchCharacter({ level: n });
          const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
          store.patchUI({ radial: { ...cur, stage: 'build', buildLevel: n } });
          router.go('radial');
        }

if (action === 'build-level') {
          const n = Math.max(1, Math.min(12, Number(id || 1)));
          const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
          store.patchUI({ radial: { ...cur, stage: 'build', buildLevel: n } });
          router.go('radial');
        }

        if (action === 'build-step') {
          const step = id;
          const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
          store.patchUI({ radial: { ...cur, stage: 'build', buildStep: step } });
          router.go('radial');
        }

if (action === 'radial-go') {
        // In-place picker drawer for build-time choices (BG3-style).
        // id format:
        //   "<type>" OR
        //   "<type>|<need>" OR
        //   "<type>|<need>|<ownerType>|<ownerId>|<listOverride>"
        // The extra fields are used to enforce spell/cantrip list restrictions.
        const parts = String(id || "").split("|");
        const type = String(parts[0] || "").trim();
        const need = Number.isFinite(Number(parts[1])) ? Number(parts[1]) : null;
        const ownerType = String(parts[2] || "").trim() || null;
        const ownerId = String(parts[3] || "").trim() || null;
        const listOverride = String(parts[4] || "").trim() || null;

        const pickers = new Set(['cantrips','spells','passives','feats','metamagic','wildshapes','manoeuvres','smites','frontierBallistics','dragonAncestor','pactBinding','steelforgedFlourishes','combatTechniques','elementalFletchings','gatheredSwarm','optimizationMatrix','sabotageMatrix']);
        if (pickers.has(type)) {
          const st = store.getState();
          const lvl = Math.max(1, Math.min(12, Number(st.ui?.radial?.buildLevel || st.ui?.buildLevel || st.character?.level || 1)));
          store.patchUI({ picker: { open: true, type, level: lvl, need, ownerType, ownerId, listOverride } });

          // Keep legacy ui.buildLevel in sync for any older code paths.
          store.patchUI({ buildLevel: lvl });

          // Ensure we're on the Build stage.
          const cur = st.ui.radial || { stage: 'race', breadcrumbs: [] };
          store.patchUI({ radial: { ...cur, stage: 'build', buildLevel: lvl } });
          router.go('radial');
        } else {
          // Fallback: jump into existing screens when desired (guarded).
          if (screens[type]) router.go(type);
        }
      }

      // --- Ability point buy (+/-) ---
      // Handles the portrait +/- buttons in the Character Summary.
      if (action === "adj-ability") {
        const raw = String(id || "");
        const [statRaw, deltaRaw] = raw.split(":");
        const stat = (statRaw || "").trim();
        const delta = Number(deltaRaw);

        if (!stat || !Number.isFinite(delta)) return;

        const budget = 27;
        const cost = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
        const keys = ["str", "dex", "con", "int", "wis", "cha"];

        const ch = store.getState().character;
        const curAbilities = ch.abilities || {};
        const nextAbilities = { ...curAbilities };

        const curVal = Number(curAbilities[stat] ?? 8);
        const nextVal = curVal + delta;

        // Clamp to point buy bounds.
        if (nextVal < 8 || nextVal > 15) return;

        const spent = (abilities) =>
          keys.reduce((sum, k) => {
            const v = Math.max(8, Math.min(15, Number(abilities?.[k] ?? 8)));
            return sum + (cost[v] ?? 0);
          }, 0);

        nextAbilities[stat] = nextVal;

        // Only apply if within budget.
        if (spent(nextAbilities) > budget) return;

        store.patchCharacter({ abilities: nextAbilities });
      }


// --- Ability bonus assign (+3 / +1) ---
// BG3-style: one ability gets +3, one different ability gets +1.
// Stored separately from point-buy so it doesn't affect the 27-point budget.
if (action === "toggle-ability-bonus") {
  const raw = String(id || "");
  const [kindRaw, statRaw] = raw.split(":");
  const kind = (kindRaw || "").trim(); // "plus3" | "plus1"
  const stat = (statRaw || "").trim(); // "str" etc

  if (!stat || (kind !== "plus3" && kind !== "plus1")) return;

  const ch = store.getState().character;
  const cur = ch.abilityBonusAssign || { plus3: "", plus1: "" };
  const next = { plus3: String(cur.plus3 || ""), plus1: String(cur.plus1 || "") };

  if (kind === "plus3") {
    // toggle
    next.plus3 = (next.plus3 === stat) ? "" : stat;
    // can't stack on same stat
    if (next.plus1 === next.plus3) next.plus1 = "";
  } else {
    next.plus1 = (next.plus1 === stat) ? "" : stat;
    if (next.plus3 === next.plus1) next.plus3 = "";
  }

  store.patchCharacter({ abilityBonusAssign: next });
}

      // --- Per-level picks (timeline) ---
      // In the radial builder, pick screens record to the active buildLevel slot
      // so the Level Summary boxes can show per-level picks.
      const setTimelinePick = (key, value, { mode = "single" } = {}) => {
        const st = store.getState();
        const ch = st.character;
        const lvl = Math.max(1, Math.min(12, Number(st.ui?.radial?.buildLevel || ch.level || 1)));

        const tl = Array.isArray(ch.build?.timeline)
          ? ch.build.timeline.map(e => ({ ...e, picks: { ...(e?.picks || {}) } }))
          : Array.from({ length: 12 }, (_, i) => ({ lvl: i + 1, classId: null, subclassId: null, picks: {} }));

        // Ensure slot exists
        if (!tl[lvl - 1]) tl[lvl - 1] = { lvl, classId: null, subclassId: null, picks: {} };

        const slot = tl[lvl - 1];
        const picks = { ...(slot.picks || {}) };

        if (mode === "multi") {
          const arr = Array.isArray(picks[key]) ? picks[key] : [];
          picks[key] = Array.from(new Set([...arr, value].filter(Boolean)));
        } else {
          picks[key] = value;
        }

        tl[lvl - 1] = { ...slot, picks };
        store.patchCharacter({ build: { ...(ch.build || {}), timeline: tl } });
      };

      const isRadialBuild = () => {
        const r = store.getState().ui?.radial;
        return (r?.stage === "build");
      };

      const maybeGoNext = () => {
        // Legacy flow: advance to next screen when not using the radial build pane.
        if (!isRadialBuild() && !isRadial) goNext();
      };

      if (action === "select-metamagic") {
        store.patchCharacter({ metamagic: id });
        if (isRadialBuild()) setTimelinePick("metamagic", id);
        maybeGoNext();
      }
      if (action === "select-wildshapes") {
        // Legacy single-pick flow (kept for backwards compatibility).
        // Build-pane wildshape picks should use toggle-wildshape-lvl instead.
        store.patchCharacter({ wildshapes: id ? [id] : [] });
        if (isRadialBuild()) setTimelinePick("wildshapes", id);
        maybeGoNext();
      }
      if (action === "select-manoeuvres") {
        store.patchCharacter({ manoeuvres: id });
        if (isRadialBuild()) setTimelinePick("manoeuvres", id);
        maybeGoNext();
      }
      if (action === "select-smites") {
        store.patchCharacter({ smites: id });
        if (isRadialBuild()) setTimelinePick("smites", id);
        maybeGoNext();
      }
      if (action === "select-frontierBallistics") {
        store.patchCharacter({ frontierBallistics: id });
        if (isRadialBuild()) setTimelinePick("frontierBallistics", id);
        maybeGoNext();
      }
      if (action === "select-dragonAncestor") {
        store.patchCharacter({ dragonAncestor: id });
        if (isRadialBuild()) setTimelinePick("dragonAncestor", id);
        maybeGoNext();
      }
      if (action === "select-pactBinding") {
        store.patchCharacter({ pactBinding: id });
        if (isRadialBuild()) setTimelinePick("pactBinding", id);
        maybeGoNext();
      }
      if (action === "select-steelforgedFlourishes") {
        store.patchCharacter({ steelforgedFlourishes: id });
        if (isRadialBuild()) setTimelinePick("steelforgedFlourishes", id);
        maybeGoNext();
      }
      if (action === "select-combatTechniques") {
        store.patchCharacter({ combatTechniques: id });
        if (isRadialBuild()) setTimelinePick("combatTechniques", id);
        maybeGoNext();
      }
      if (action === "select-elementalFletchings") {
        store.patchCharacter({ elementalFletchings: id });
        if (isRadialBuild()) setTimelinePick("elementalFletchings", id);
        maybeGoNext();
      }
      if (action === "select-gatheredSwarm") {
        store.patchCharacter({ gatheredSwarm: id });
        if (isRadialBuild()) setTimelinePick("gatheredSwarm", id);
        maybeGoNext();
      }
      if (action === "select-optimizationMatrix") {
        store.patchCharacter({ optimizationMatrix: id });
        if (isRadialBuild()) setTimelinePick("optimizationMatrix", id);
        maybeGoNext();
      }
      if (action === "select-sabotageMatrix") {
        store.patchCharacter({ sabotageMatrix: id });
        if (isRadialBuild()) setTimelinePick("sabotageMatrix", id);
        maybeGoNext();
      }

      // Feats are stored per build level on the timeline.
      if (action === "select-feat") {
        const st = store.getState();
        const ch = st.character;
        const lvl = Math.max(1, Math.min(12, Number(st.ui?.radial?.buildLevel || ch.level || 1)));
        const tl = Array.isArray(ch.build?.timeline)
          ? ch.build.timeline.map(e => ({ ...e, picks: { ...(e?.picks || {}) } }))
          : Array.from({ length: 12 }, (_, i) => ({ lvl: i + 1, classId: null, subclassId: null, picks: {} }));
        if (!tl[lvl - 1]) tl[lvl - 1] = { lvl, classId: null, subclassId: null, picks: {} };
        const slot = tl[lvl - 1];
        const picks = { ...(slot.picks || {}) };
        picks.feats = [id];
        delete picks.feat;
        tl[lvl - 1] = { ...slot, picks };
        store.patchCharacter({ build: { ...(ch.build || {}), timeline: tl } });
      }

      if (action === "select-characterTrait") { store.patchCharacter({ characterTrait: id }); goNext(); }
      if (action === "select-personality") { store.patchCharacter({ personality: id }); goNext(); }
      if (action === "select-deity") { store.patchCharacter({ deity: id }); goNext(); }
      if (action === "select-background") { store.patchCharacter({ background: id }); goNext(); }

      // Return from build-step pickers back to the radial Build pane.
      if (action === "return-build") {
        const cur = store.getState().ui.radial || { stage: 'race', breadcrumbs: [] };
        // Close the in-place picker drawer (if open) and return to the Build pane.
        store.patchUI({ picker: { open: false, type: null, level: store.getState().ui.buildLevel ?? 1 } });
        store.patchUI({ radial: { ...cur, stage: 'build', buildStep: null } });
        router.go('radial');
      }

      if (action === "picker-close") {
        store.patchUI({ picker: { open: false, type: null, level: store.getState().ui.buildLevel ?? 1 } });
        router.go('radial');
      }

      // --- Layout-driven picks (Option 2) ---
      // Encoded id: "<choiceId>|<count>|<label>"
      if (action === "set-active-pick") {
        const raw = String(id || "");
        const [choiceId, countRaw, ...labelParts] = raw.split("|");
        const count = Math.max(0, Number(countRaw || 0));
        const label = labelParts.join("|") || choiceId;
        store.patchUI({ activePickType: choiceId || null, activePickLimit: count, activePickLabel: label || null });
      }

      // Toggle an item for the currently active pick type.
      // Encoded id: "<itemId>|<buildLevel>|<limit>"
      if (action === "toggle-activePick-lvl") {
        const raw = String(id || "");
        const [itemId, lvlRaw, limitRaw] = raw.split("|");
        const ui = store.getState().ui || {};
        const pickKey = ui.activePickType;
        if (!pickKey) return;
        const lvl = Math.max(1, Math.min(12, Number(lvlRaw || ui.radial?.buildLevel || ui.buildLevel || 1)));
        const limit = Math.max(0, Number(limitRaw || ui.activePickLimit || 0));

        const ch = store.getState().character;
        const timeline = Array.isArray(ch.build?.timeline) ? ch.build.timeline : [];
        const nextTimeline = timeline.map((e, idx) => {
          if (idx !== (lvl - 1)) return e;
          const picks = { ...(e?.picks || {}) };
          const curList = Array.isArray(picks[pickKey])
            ? picks[pickKey]
            : (picks[pickKey] ? [picks[pickKey]] : []);
          const has = curList.includes(itemId);
          const nextList = has ? curList.filter(x => x !== itemId) : [...curList, itemId].slice(0, limit);
          picks[pickKey] = nextList;
          return { ...e, picks };
        });

        store.patchCharacter({ build: { ...(ch.build || {}), timeline: nextTimeline } });
      }

      // --- Build-level Cantrips / Spells multi-select ---
      // Encoded id: "<spellId>|<buildLevel>|<limit>"
      
      // --- Build-level Passives multi-select ---
      // Encoded id: "<passiveId>|<buildLevel>|<limit>"
      if (action === "toggle-passive-lvl") {
        const raw = String(id || "");
        const [passiveId, lvlRaw, limitRaw] = raw.split("|");
        const lvl = Math.max(1, Math.min(12, Number(lvlRaw || 1)));
        const limit = Math.max(0, Number(limitRaw || 0));

        const ch = store.getState().character;
        const timeline = Array.isArray(ch.build?.timeline) ? ch.build.timeline : [];
        const nextTimeline = timeline.map((e, idx) => {
          if (idx !== (lvl - 1)) return e;
          const picks = { ...(e?.picks || {}) };
          const curList = Array.isArray(picks.passives) ? picks.passives : [];
          const has = curList.includes(passiveId);
          const nextList = has ? curList.filter(x => x !== passiveId) : [...curList, passiveId].slice(0, limit);
          picks.passives = nextList;
          return { ...e, picks };
        });

        const all = new Set();
        nextTimeline.forEach((e) => (Array.isArray(e?.picks?.passives) ? e.picks.passives : []).forEach(x => all.add(x)));
        store.patchCharacter({
          build: { ...(ch.build || {}), timeline: nextTimeline },
          passives: Array.from(all)
        });

        const ui = store.getState().ui;
        store.patchUI({ pickerFocus: { ...(ui.pickerFocus || {}), passives: passiveId } });
      }

// --- Build-level Smites multi-select ---
// Encoded id: "<smiteId>|<buildLevel>|<limit>"
if (action === "toggle-smite-lvl") {
  const raw = String(id || "");
  const [smiteId, lvlRaw, limitRaw] = raw.split("|");
  const lvl = Math.max(1, Math.min(12, Number(lvlRaw || 1)));
  const limit = Math.max(0, Number(limitRaw || 0));

  const ch = store.getState().character;
  const timeline = Array.isArray(ch.build?.timeline) ? ch.build.timeline : [];

  let nextTimeline = timeline.map((e, idx) => {
    if (idx !== (lvl - 1)) return e;
    const picks = { ...(e?.picks || {}) };
    const curList = Array.isArray(picks.smites) ? picks.smites : [];
    const curSelectable = curList.filter(x => x !== "divine");

    const has = curSelectable.includes(smiteId);
    const nextSelectable = has
      ? curSelectable.filter(x => x !== smiteId)
      : [...curSelectable, smiteId].slice(0, limit);

    // Preserve any auto-granted divine marker if present on this slot.
    const keepDivine = curList.includes("divine");
    picks.smites = keepDivine ? ["divine", ...nextSelectable] : nextSelectable;

    return { ...e, picks };
  });

  // Re-apply Paladin Divine Smite rule after any changes.
  nextTimeline = applyPaladinDivineSmite(nextTimeline);

  // Aggregate across timeline for convenience / export parity with other pick types.
  const all = new Set();
  nextTimeline.forEach((e) => (Array.isArray(e?.picks?.smites) ? e.picks.smites : []).forEach(x => all.add(x)));
  store.patchCharacter({
    build: { ...(ch.build || {}), timeline: nextTimeline },
    smites: Array.from(all)
  });
}

// --- Build-level Frontier Ballistics (Ranger) ---
// Encoded id: "<arrowId>|<buildLevel>|<limit>"
if (action === "toggle-frontierBallistics-lvl") {
  const raw = String(id || "");
  const [arrowId, lvlRaw, limitRaw] = raw.split("|");
  const lvl = Math.max(1, Math.min(12, Number(lvlRaw || 1)));
  const limit = Math.max(0, Number(limitRaw || 0));

  const ch = store.getState().character;
  const timeline = Array.isArray(ch.build?.timeline) ? ch.build.timeline : [];

  const nextTimeline = timeline.map((e, idx) => {
    if (idx !== (lvl - 1)) return e;
    const picks = { ...(e?.picks || {}) };
    const curList = Array.isArray(picks.frontierBallistics) ? picks.frontierBallistics : [];
    const has = curList.includes(arrowId);
    const nextList = has ? curList.filter(x => x !== arrowId) : [...curList, arrowId].slice(0, limit);
    picks.frontierBallistics = nextList;
    return { ...e, picks };
  });

  const all = new Set();
  nextTimeline.forEach((e) => (Array.isArray(e?.picks?.frontierBallistics) ? e.picks.frontierBallistics : []).forEach(x => all.add(x)));
  store.patchCharacter({
    build: { ...(ch.build || {}), timeline: nextTimeline },
    frontierBallistics: Array.from(all)
  });
}


      // --- Build-level Metamagic multi-select ---
      // Encoded id: "<metamagicId>|<buildLevel>|<limit>"
      if (action === "toggle-metamagic-lvl") {
        const raw = String(id || "");
        const [mmId, lvlRaw, limitRaw] = raw.split("|");
        const lvl = Math.max(1, Math.min(12, Number(lvlRaw || 1)));
        const limit = Math.max(0, Number(limitRaw || 0));

        const ch = store.getState().character;
        const timeline = Array.isArray(ch.build?.timeline) ? ch.build.timeline : [];
        const nextTimeline = timeline.map((e, idx) => {
          if (idx !== (lvl - 1)) return e;
          const picks = { ...(e?.picks || {}) };
          const curList = Array.isArray(picks.metamagic)
            ? picks.metamagic
            : (picks.metamagic ? [picks.metamagic] : []);

          const has = curList.includes(mmId);
          const nextList = has ? curList.filter(x => x !== mmId) : [...curList, mmId].slice(0, limit);
          picks.metamagic = nextList;
          return { ...e, picks };
        });

        // Flatten across all build levels
        const all = new Set();
        nextTimeline.forEach((e) =>
          (Array.isArray(e?.picks?.metamagic) ? e.picks.metamagic : (e?.picks?.metamagic ? [e.picks.metamagic] : []))
            .forEach(x => all.add(x))
        );

        store.patchCharacter({
          build: { ...(ch.build || {}), timeline: nextTimeline },
          metamagic: Array.from(all)
        });

        // Keep UI focused on last interacted metamagic.
        const ui = store.getState().ui;
        store.patchUI({ pickerFocus: { ...(ui.pickerFocus || {}), metamagic: mmId } });
      }


      // --- Generic Build-level multi-select (data-driven pickers) ---
      // Encoded id: "<key>|<itemId>|<buildLevel>|<limit>"
      if (action === "toggle-multi-lvl") {
        const raw = String(id || "");
        const [key, itemId, lvlRaw, limitRaw] = raw.split("|");
        const lvl = Math.max(1, Math.min(12, Number(lvlRaw || 1)));
        const limit = Math.max(0, Number(limitRaw || 0));

        const ch = store.getState().character;
        const tl = Array.isArray(ch.build?.timeline)
          ? ch.build.timeline.map(e => ({ ...e, picks: { ...(e?.picks || {}) } }))
          : Array.from({ length: 12 }, (_, i) => ({ lvl: i + 1, classId: null, subclassId: null, picks: {} }));

        if (!tl[lvl - 1]) tl[lvl - 1] = { lvl, classId: null, subclassId: null, picks: {} };
        const slot = tl[lvl - 1];
        const picks = { ...(slot.picks || {}) };

        const cur = Array.isArray(picks[key]) ? picks[key].map(String) : (picks[key] ? [String(picks[key])] : []);
        const sItem = String(itemId || "");
        const has = cur.includes(sItem);

        let next = cur;
        if (has) {
          next = cur.filter(x => x !== sItem);
        } else {
          if (limit > 0 && cur.length >= limit) {
            // at limit, ignore
            next = cur;
          } else {
            next = Array.from(new Set([...cur, sItem].filter(Boolean)));
          }
        }

        picks[key] = next;
        tl[lvl - 1] = { ...slot, picks };

        // Keep a top-level mirror for convenience (not required for timeline display).
        store.patchCharacter({
          [key]: next,
          build: { ...(ch.build || {}), timeline: tl }
        });

        maybeGoNext();
      }

if (action === "toggle-cantrip-lvl") {
        const raw = String(id || "");
        const [spellId, lvlRaw, limitRaw] = raw.split("|");
        const lvl = Math.max(1, Math.min(12, Number(lvlRaw || 1)));
        const limit = Math.max(0, Number(limitRaw || 0));

        const ch = store.getState().character;
        const timeline = Array.isArray(ch.build?.timeline) ? ch.build.timeline : [];
        const nextTimeline = timeline.map((e, idx) => {
          if (idx !== (lvl - 1)) return e;
          const picks = { ...(e?.picks || {}) };
          const curList = Array.isArray(picks.cantrips) ? picks.cantrips : [];
          const has = curList.includes(spellId);
          const nextList = has ? curList.filter(x => x !== spellId) : [...curList, spellId].slice(0, limit);
          picks.cantrips = nextList;
          return { ...e, picks };
        });

        const all = new Set();
        nextTimeline.forEach((e) => (Array.isArray(e?.picks?.cantrips) ? e.picks.cantrips : []).forEach(x => all.add(x)));
        store.patchCharacter({
          build: { ...(ch.build || {}), timeline: nextTimeline },
          cantrips: Array.from(all)
        });

        // Keep the details panel focused on the last interacted item.
        const ui = store.getState().ui;
        store.patchUI({ pickerFocus: { ...(ui.pickerFocus || {}), cantrips: spellId } });
      }

      if (action === "toggle-spell-lvl") {
        const raw = String(id || "");
        const [spellId, lvlRaw, limitRaw] = raw.split("|");
        const lvl = Math.max(1, Math.min(12, Number(lvlRaw || 1)));
        const limit = Math.max(0, Number(limitRaw || 0));

        const ch = store.getState().character;
        const timeline = Array.isArray(ch.build?.timeline) ? ch.build.timeline : [];
        const nextTimeline = timeline.map((e, idx) => {
          if (idx !== (lvl - 1)) return e;
          const picks = { ...(e?.picks || {}) };
          const curList = Array.isArray(picks.spells) ? picks.spells : [];
          const has = curList.includes(spellId);
          const nextList = has ? curList.filter(x => x !== spellId) : [...curList, spellId].slice(0, limit);
          picks.spells = nextList;
          return { ...e, picks };
        });

        const all = new Set();
        nextTimeline.forEach((e) => (Array.isArray(e?.picks?.spells) ? e.picks.spells : []).forEach(x => all.add(x)));
        store.patchCharacter({
          build: { ...(ch.build || {}), timeline: nextTimeline },
          spells: Array.from(all)
        });

        const ui = store.getState().ui;
        store.patchUI({ pickerFocus: { ...(ui.pickerFocus || {}), spells: spellId } });
      }

      // --- Build-level Wildshapes multi-select ---
      // Encoded id: "<wildshapeId>|<buildLevel>|<limit>"
      if (action === "toggle-wildshape-lvl") {
        const raw = String(id || "");
        const [wsId, lvlRaw, limitRaw] = raw.split("|");
        const lvl = Math.max(1, Math.min(12, Number(lvlRaw || 1)));
        const limit = Math.max(0, Number(limitRaw || 0));

        const ch = store.getState().character;
        const timeline = Array.isArray(ch.build?.timeline) ? ch.build.timeline : [];
        const nextTimeline = timeline.map((e, idx) => {
          if (idx !== (lvl - 1)) return e;
          const picks = { ...(e?.picks || {}) };
          const curList = Array.isArray(picks.wildshapes) ? picks.wildshapes : [];
          const has = curList.includes(wsId);
          const nextList = has ? curList.filter(x => x !== wsId) : [...curList, wsId].slice(0, limit);
          picks.wildshapes = nextList;
          return { ...e, picks };
        });

        const all = new Set();
        nextTimeline.forEach((e) => (Array.isArray(e?.picks?.wildshapes) ? e.picks.wildshapes : []).forEach(x => all.add(x)));
        store.patchCharacter({
          build: { ...(ch.build || {}), timeline: nextTimeline },
          wildshapes: Array.from(all)
        });

        const ui = store.getState().ui;
        store.patchUI({ pickerFocus: { ...(ui.pickerFocus || {}), wildshapes: wsId } });
      }

      // --- Cantrips / Spells multi-select ---
      if (action === "toggle-cantrip") {
        const ch = store.getState().character;
        const current = Array.isArray(ch.cantrips) ? ch.cantrips : [];
        const has = current.includes(id);
        const next = has ? current.filter(x => x !== id) : [...current, id].slice(0, 2);
        store.patchCharacter({ cantrips: next });
      }

      if (action === "toggle-spell") {
        const ch = store.getState().character;
        const current = Array.isArray(ch.spells) ? ch.spells : [];
        const has = current.includes(id);

        // Level-1 "spells known" count using Homebrew guide rules.
        const cls = ch.class;
        const sub = (ch.subclass ?? "").toLowerCase();
        const isLore = cls === "bard" && sub.includes("lore");
        const full = ["cleric","druid","sorcerer","warlock","wizard"].includes(cls);
        const half = ["artificer","paladin","ranger"].includes(cls)
          || (cls === "fighter" && sub.includes("ldritch"))
          || (cls === "rogue" && sub.includes("rcane"))
          || (cls === "barbarian" && (sub.includes("wild") || sub.includes("magic")))
          || (cls === "monk" && sub.includes("arcane"));

        const limit = full ? 2 : (cls === "bard" ? (isLore ? 2 : 1) : (half ? 1 : 0));

        const next = has
          ? current.filter(x => x !== id)
          : [...current, id].slice(0, Math.max(limit, 0));

        store.patchCharacter({ spells: next });
      }

      // Filter/sort UI removed (search-only, always A→Z).

      if (action === "next") { if (!isRadial) goNext(); }
      if (action === "back") {
        // In radial workflow, picker screens should return to the Build pane.
        const cur = store.getState().ui?.radial;
        if (cur?.stage === "build") {
          store.patchUI({ radial: { ...cur, stage: "build", buildStep: null } });
          router.go("radial");
        } else if (!isRadial) {
          goBack();
        }
      }

      await render();
  }, { capture: true });

  // Text input listeners (search boxes)
  appEl.querySelectorAll("[data-input]").forEach((el) => {
    el.addEventListener("input", async () => {
      const kind = el.getAttribute("data-input");
      const value = el.value ?? "";
      const ui = store.getState().ui;
      if (kind === "spell-search") {
        store.patchUI({ spellFilters: { ...ui.spellFilters, search: value } });
      }
      if (kind === "cantrip-search") {
        store.patchUI({ cantripFilters: { ...ui.cantripFilters, search: value } });
      }
      await render();
    }, { passive: true });
  });

  // Input bindings (search boxes)
  appEl.querySelectorAll("[data-input]").forEach((el) => {
    el.addEventListener("input", () => {
      const key = el.getAttribute("data-input");
      const value = el.value ?? "";
      if (key === "spell-search") {
        const f = { ...store.getState().ui.spellFilters, search: value };
        store.patchUI({ spellFilters: f });
      }
      if (key === "cantrip-search") {
        const f = { ...store.getState().ui.cantripFilters, search: value };
        store.patchUI({ cantripFilters: f });
      }
    }, { passive: true });
  });
  // Close Trait dropdown when clicking outside it
  document.addEventListener("click", (e) => {
    const ui = store.getState().ui || {};
    if (!ui.traitMenuOpen) return;
    const inside = e.target?.closest?.("[data-role='trait-dd']");
    if (!inside) store.patchUI({ traitMenuOpen: false });
  }, true);


}

// Mural drift disabled

(async () => {
  await loadModMeta();
  await loadFlowsConfig();
  wireEvents();
  installDesignMode({ appEl, store });
  await render();
  store.subscribe(render);
})();

// --- Multiclass + Trait dropdown handlers ---
document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el) return;

  if (el.matches("[data-action='set-trait']")) {
    store.patchCharacter({ characterTrait: el.value || null });
    return;
  }

  if (el.matches("[data-action='set-build-class']")) {
    // Back-compat: some templates used data-id instead of data-level.
    const level = Number(el.getAttribute("data-level") || el.getAttribute("data-id") || 1);
    const classId = el.value || null;

    const st = store.getState();
    const ch = st.character;

    const timeline = (ch.build?.timeline
      || Array.from({ length: 12 }, (_, i) => ({ lvl: i + 1, classId: null, subclassId: null, picks: {} }))
    ).map(x => ({ ...x, picks: { ...(x.picks || {}) } }));

    const idx = Math.max(0, Math.min(11, level - 1));
    if (!timeline[idx]) return;

    // Set class for this character level
    timeline[idx].classId = classId;
    timeline[idx].picks = {}; // changing class changes available picks

    // Subclass locking rule:
    // - The FIRST (earliest) time a class appears, the user chooses its subclass.
    // - Any later occurrences of that class auto-lock to that first subclass.
    if (!classId) {
      timeline[idx].subclassId = null;
      store.patchCharacter({ build: { ...(ch.build || {}), timeline: applyPaladinDivineSmite(timeline) } });
      return;
    }

    const firstIdx = timeline.findIndex(t => String(t?.classId || "") === String(classId));
    if (firstIdx < 0) {
      timeline[idx].subclassId = null;
      store.patchCharacter({ build: { ...(ch.build || {}), timeline: applyPaladinDivineSmite(timeline) } });
      return;
    }

    // If the class already exists later with a subclass, carry that forward so inserting the class earlier
    // doesn't "lose" the subclass.
    const carriedSubclass =
      (timeline[firstIdx]?.subclassId || null)
      || (timeline.find((t, j) => j !== firstIdx && String(t?.classId || "") === String(classId) && t?.subclassId)?.subclassId || null);

    if (idx !== firstIdx) {
      // Not first occurrence → locked to first subclass (if any).
      timeline[idx].subclassId = carriedSubclass;
    } else {
      // First occurrence → selectable (but may start with carried subclass).
      timeline[idx].subclassId = carriedSubclass;
      if (carriedSubclass) {
        for (let i = 0; i < timeline.length; i++) {
          if (String(timeline[i]?.classId || "") === String(classId)) {
            timeline[i].subclassId = carriedSubclass;
          }
        }
      }
    }

    store.patchCharacter({ build: { ...(ch.build || {}), timeline: applyPaladinDivineSmite(timeline) } });
    return;
  }

  if (el.matches("[data-action='set-build-subclass']")) {
    // Back-compat: some templates used data-id instead of data-level.
    const level = Number(el.getAttribute("data-level") || el.getAttribute("data-id") || 1);
    const subclassId = el.value || null;

    const st = store.getState();
    const ch = st.character;

    const timeline = (ch.build?.timeline || []).map(x => ({ ...x, picks: { ...(x.picks || {}) } }));
    const idx = Math.max(0, Math.min(11, level - 1));
    if (!timeline[idx]) return;

    const classId = timeline[idx].classId || null;
    if (!classId) return;

    const firstIdx = timeline.findIndex(t => String(t?.classId || "") === String(classId));
    if (firstIdx < 0) return;

    // Subclass can only be chosen at the FIRST occurrence of the class.
    if (idx !== firstIdx) return;

    // Apply the chosen subclass to ALL entries of this class (later levels mirror/lock correctly).
    for (let i = 0; i < timeline.length; i++) {
      if (String(timeline[i]?.classId || "") === String(classId)) {
        timeline[i].subclassId = subclassId;
        // Changing subclass can alter level-granted picks; clear per-level picks for this class.
        timeline[i].picks = {};
      }
    }

    store.patchCharacter({ build: { ...(ch.build || {}), timeline: applyPaladinDivineSmite(timeline) } });
    return;
  }
});
