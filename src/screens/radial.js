import { loadClassProgressions, loadClassesFull } from "../progression/loader.js";
import { indexSubclasses, resolveProgression, withSubclass } from "../progression/resolver.js";

import { CantripsScreen } from "./cantrips.js";
import { SpellsScreen } from "./spells.js";
import { FeatsScreen } from "./feats.js";
import { PassivesScreen } from "./passives.js";
import { MetamagicScreen } from "./metamagic.js";
import { WildshapesScreen } from "./wildshapes.js";
import { ManoeuvresScreen } from "./manoeuvres.js";
import { SmitesScreen } from "./smites.js";
import { FrontierBallisticsScreen } from "./frontierBallistics.js";
import { DragonAncestorScreen } from "./dragonAncestor.js";
import { PactBindingScreen } from "./pactBinding.js";
import { SteelforgedFlourishesScreen } from "./steelforgedFlourishes.js";
import { CombatTechniquesScreen } from "./combatTechniques.js";
import { ElementalFletchingsScreen } from "./elementalFletchings.js";
import { GatheredSwarmScreen } from "./gatheredSwarm.js";
import { OptimizationMatrixScreen } from "./optimizationMatrix.js";
import { SabotageMatrixScreen } from "./sabotageMatrix.js";

import { isDesignMode, readDesignDraft } from "../design/designMode.js";

import {
  loadRacesJson,
  loadSubracesJson,
  loadClassesJson,
  loadData
} from "../data/liveData.js";

// --- Hot-path caches ---
// The UI re-renders on every click; re-fetching big JSON files can bog down the browser.
let racesCachePromise = null;
let subracesCachePromise = null;
let classesCachePromise = null;
let spellsCachePromise = null;
let levelFlowsCachePromise = null;
let traitsCachePromise = null;
let featsCachePromise = null;
let classFeaturesCachePromise = null;
let raceFeaturesCachePromise = null;
let choicesCachePromise = null;

async function loadRaces() {
  if (!racesCachePromise) {
    racesCachePromise = loadRacesJson();
  }
  return await racesCachePromise;
}

async function loadSubraces() {
  if (!subracesCachePromise) {
    // In live (bundle) mode this comes from bundle.Subraces.
    // Local fallback file may not exist in older repo snapshots; loadData() will safely return [].
    subracesCachePromise = loadSubracesJson();
  }
  return await subracesCachePromise;
}

async function loadClasses() {
  if (!classesCachePromise) {
    classesCachePromise = loadClassesJson();
  }
  return await classesCachePromise;
}

async function loadSpells() {
  if (!spellsCachePromise) {
    spellsCachePromise = loadData("./data/spells.json", "Spells", (rows) => rows);
  }
  return await spellsCachePromise;
}


async function loadLevelFlows() {
  if (!levelFlowsCachePromise) {
    levelFlowsCachePromise = loadData("./data/levelFlows.json", "LevelFlows", (rows) => rows);
  }
  return await levelFlowsCachePromise;
}


async function loadClassFeatures() {
  if (!classFeaturesCachePromise) {
    classFeaturesCachePromise = loadData("./data/class_features.json", "ClassFeatures", (rows) => rows)
      .then((json) => (Array.isArray(json) ? json : (json?.features || json?.classFeatures || json?.rows || json?.data || [])))
      .catch(() => []);
  }
  return await classFeaturesCachePromise;
}

async function loadRaceFeatures() {
  if (!raceFeaturesCachePromise) {
    raceFeaturesCachePromise = loadData("./data/race_features.json", "RaceFeatures", (rows) => rows)
      .then((json) => (Array.isArray(json) ? json : (json?.features || json?.raceFeatures || json?.rows || json?.data || [])))
      .catch(() => []);
  }
  return await raceFeaturesCachePromise;
}

async function loadChoices() {
  if (!choicesCachePromise) {
    const normalize = (row) => {
      if (!row || typeof row !== "object") return row;
      // Support both local JSON (camelCase) and live sheet normalized keys (snake_case / PascalCase)
      const ownerType = row.ownerType ?? row.OwnerType ?? row.owner_type ?? row.ownertype ?? "";
      const ownerId = row.ownerId ?? row.OwnerId ?? row.owner_id ?? row.ownerid ?? "";
      const level = row.level ?? row.Level ?? row.lvl ?? row.Lvl ?? row.level_number ?? row.levelnumber;
      const pickType = row.pickType ?? row.PickType ?? row.pick_type ?? row.picktype ?? "";
      const count = row.count ?? row.Count ?? row.pickCount ?? row.pick_count ?? row.pickcount ?? 0;
      const listOverride = row.listOverride ?? row.ListOverride ?? row.list_override ?? row.listoverride ?? null;


      const nOwnerType = String(ownerType || "").trim().toLowerCase();
      const nOwnerId = String(ownerId || "").trim().toLowerCase();
      const nPickType = String(pickType || "").trim().toLowerCase();
      const nListOverride = listOverride == null ? null : String(listOverride || "").trim().toLowerCase();

      return {
        ...row,
        ownerType: nOwnerType,
        ownerId: nOwnerId,
        level,
        pickType: nPickType,
        count,
        listOverride: nListOverride
      };
    };

    choicesCachePromise = loadData("./data/choices.json", "Choices", (rows) => (rows || []).map(normalize))
      .then((json) => {
        const arr = Array.isArray(json) ? json : (json?.choices || json?.rows || json?.data || []);
        return (arr || []).map(normalize);
      })
      .catch(() => []);
  }
  return await choicesCachePromise;
}


async function loadTraits() {
  if (!traitsCachePromise) {
    traitsCachePromise = loadData("./data/traits.json", "Traits", (rows) => ({ traits: rows }))
      .then((json) => (json?.traits ? json : { traits: [] }))
      .catch(() => ({ traits: [] }));
  }
  return await traitsCachePromise;
}

async function loadFeats() {
  if (!featsCachePromise) {
    featsCachePromise = loadData("./data/feats.json", "Feats", (rows) => ({ feats: rows }))
      .then((json) => (json?.feats ? json : { feats: [] }))
      .catch(() => ({ feats: [] }));
  }
  return await featsCachePromise;
}




async function safePickerScreen(fn){
  try{ return await fn(); }
  catch(e){ return `<div class="screen"><div style="opacity:.8">No entries available.</div></div>`; }
}

async function renderPickerDrawer(state) {
  const p = state?.ui?.picker;
  if (!p || !p.open || !p.type) return "";

  let inner = "";
  if (p.type === "cantrips") inner = await safePickerScreen(() => CantripsScreen({ state }));
  else if (p.type === "spells") inner = await safePickerScreen(() => SpellsScreen({ state }));
  else if (p.type === "feats") inner = await safePickerScreen(() => FeatsScreen({ state }));
  else if (p.type === "passives") inner = await safePickerScreen(() => PassivesScreen({ state }));
  else if (p.type === "metamagic") inner = await safePickerScreen(() => MetamagicScreen({ state }));
  else if (p.type === "wildshapes") inner = await safePickerScreen(() => WildshapesScreen({ state }));
  else if (p.type === "manoeuvres") inner = await safePickerScreen(() => ManoeuvresScreen({ state }));
  else if (p.type === "smites") inner = await safePickerScreen(() => SmitesScreen({ state }));
  else if (p.type === "frontierBallistics") inner = await safePickerScreen(() => FrontierBallisticsScreen({ state }));
  else if (p.type === "dragonAncestor") inner = await safePickerScreen(() => DragonAncestorScreen({ state }));
  else if (p.type === "pactBinding") inner = await safePickerScreen(() => PactBindingScreen({ state }));
  else if (p.type === "steelforgedFlourishes") inner = await safePickerScreen(() => SteelforgedFlourishesScreen({ state }));
  else if (p.type === "combatTechniques") inner = await safePickerScreen(() => CombatTechniquesScreen({ state }));
  else if (p.type === "elementalFletchings") inner = await safePickerScreen(() => ElementalFletchingsScreen({ state }));
  else if (p.type === "gatheredSwarm") inner = await safePickerScreen(() => GatheredSwarmScreen({ state }));
  else if (p.type === "optimizationMatrix") inner = await safePickerScreen(() => OptimizationMatrixScreen({ state }));
  else if (p.type === "sabotageMatrix") inner = await safePickerScreen(() => SabotageMatrixScreen({ state }));
  else inner = `<div class="screen"><div class="h1">${escapeHtml(p.type)}</div><div class="mini-muted">Picker not implemented.</div><div class="bottom-nav"><button class="btn primary" data-action="picker-close">Close</button></div></div>`;

  return `
    <div class="picker-overlay" data-action="picker-close" aria-hidden="true"></div>
    <div class="picker-drawer" role="dialog" aria-label="Picker">
      <button class="picker-close" type="button" data-action="picker-close" aria-label="Close">✕</button>
      <div class="picker-inner">${inner}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Design Mode wrapper helper.
// IMPORTANT: This must be available to helpers like renderOrbit() which live
// at module scope (outside the main render function).
function dmWrap(id, html) {
  try {
    const design = typeof window !== "undefined" && window.__HBCR_DESIGN__ === true;
    return design
      ? `<div class="hbcr-dm-inner" data-ui-component="${escapeHtml(id)}">${html}</div>`
      : html;
  } catch (_e) {
    return html;
  }
}

function pill(text) {
  return `<span class="sheet-pill">${escapeHtml(text)}</span>`;
}

function renderOrbit(options) {
  // NOTE: Node positions are computed after render (ResizeObserver) so the layout
  // stays centered and responds to browser resizes.
  return `
    <div class="radial-orbit">
      ${options
        .map((o, i) => {
          // Orbit nodes are part of the radial wheel (not the top tabs row).
          // Wrap them with a stable id so Design Mode can target them later.
          const nodeId = o?.id ?? i;
          return dmWrap(
            `radial.orbit.node.${nodeId}`,
            `
              <button class="radial-node" data-idx="${i}" data-action="${o.action}" data-id="${o.id}">
                <div class="radial-node-button">${o.icon ?? ""}</div>
                <div class="radial-node-label">${escapeHtml(o.label)}</div>
              </button>
            `
          );
        })
        .join("")}
    </div>
  `;
}

// ------------------------------
// Responsive orbit layout
// ------------------------------

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function polarToXY(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
}

function layoutOrbits(stageEl) {
  if (!stageEl) return;

  // Context for stage-specific tweaks (kept VERY narrow to avoid regressions).
  const stage = stageEl.dataset.stage || "";
  const race = stageEl.dataset.race || "";

  // IMPORTANT:
  // Measure and position within the SAME element that owns the absolutely
  // positioned orbit nodes. If we measure a parent (with padding/transform)
  // but position children inside a different coordinate space, nodes will
  // appear scattered and won't reflow correctly.
  const centerEl = stageEl.querySelector(".radial-center");
  const nodes = Array.from(stageEl.querySelectorAll(".radial-node"));
  if (!centerEl || nodes.length === 0) return;

  const rect = stageEl.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  // Force the center circle to be truly centered in the pane.
  centerEl.style.left = `${cx}px`;
  centerEl.style.top = `${cy}px`;
  centerEl.style.transform = `translate(-50%, -50%)`;

  // Measure a node so we can keep them within the pane bounds.
  const nodeW = nodes[0].offsetWidth || 120;
  const nodeH = nodes[0].offsetHeight || 140;
  const nodeR = Math.max(nodeW, nodeH) / 2;

  const padding = 10;
  const maxR = Math.min(rect.width, rect.height) / 2 - nodeR - padding;
  const minR = 140;

  // ------------------------------------------------------------
  // Special case: Dragonborn Subrace stage
  // ------------------------------------------------------------
  // The Dragonborn subrace list is large and labels are long, which can make
  // 2-ring layouts look "scattered" (nodes bunch up unevenly). We keep the
  // rest of the game untouched by only applying this when:
  //   stage === 'subrace' && race === 'dragonborn'
  // Goal: a single, clean ring with even spacing. If it would overlap, we
  // reduce scale instead of switching to multiple radii.
  const n = nodes.length;
  if (stage === "subrace" && race === "dragonborn" && n >= 12) {
    const startDeg = -90;
    const step = 360 / n;

    // Choose the largest safe radius.
    const r = clamp(maxR * 0.90, minR, maxR);

    // Compute a scale that guarantees enough arc/chord space.
    // chord ~= 2r * sin(pi/n)
    const chord = 2 * r * Math.sin(Math.PI / n);
    const target = nodeW * 1.02; // small safety margin
    const s = clamp(chord / target, 0.70, 0.95);
    nodes.forEach((el) => el.style.setProperty("--scale", String(s)));

    for (let i = 0; i < n; i++) {
      const deg = startDeg + step * i;
      const { x, y } = polarToXY(cx, cy, r, deg);
      const node = nodes[i];
      node.style.setProperty("--x", `${x}px`);
      node.style.setProperty("--y", `${y}px`);
    }
    return;
  }

  // Ring strategy (keeps nodes evenly spaced and avoids "random" clustering):
  // - <= 12 items: 1 ring
  // - 13..24 items: 2 rings
  // - > 24 items: 3 rings (rare but safe)
  const ringCount = n <= 14 ? 1 : n <= 24 ? 2 : 3;

  // Scale nodes down a bit for dense stages.
  const scale = n <= 10 ? 1 : n <= 14 ? 0.92 : n <= 24 ? 0.88 : 0.82;
  nodes.forEach((el) => el.style.setProperty("--scale", String(scale)));

  // Radii per ring (outer rings slightly larger). Clamp to avoid clipping.
  const r1 = clamp(maxR * (ringCount === 1 ? 0.82 : 0.56), minR, maxR);
  const r2 = clamp(maxR * 0.82, minR + 40, maxR);
  const r3 = clamp(maxR * 0.96, minR + 80, maxR);
  const radii = (ringCount === 2) ? [r2, r1] : [r1, r2, r3].slice(0, ringCount);

  // Distribute nodes across rings. Prefer more nodes on the OUTER ring.
  // This looks cleaner and keeps labels readable.
  const perRing = [];
  if (ringCount === 1) {
    perRing.push(n);
  } else if (ringCount === 2) {
    const outer = Math.ceil(n * 0.6);
    perRing.push(outer, n - outer);
  } else {
    const outer = Math.ceil(n * 0.45);
    const mid = Math.ceil(n * 0.35);
    perRing.push(outer, mid, n - outer - mid);
  }

  let offset = 0;
  for (let ring = 0; ring < ringCount; ring++) {
    const count = perRing[ring];
    if (count <= 0) continue;

    // Start at the top (-90deg) and spread evenly.
    // Keep a consistent start per ring so the layout doesn't "jump" oddly.
    const startDeg = -90 + ring * 8; // slight stagger between rings
    const step = 360 / count;
    for (let i = 0; i < count; i++) {
      const node = nodes[offset + i];
      if (!node) continue;
      const deg = startDeg + step * i;
      const { x, y } = polarToXY(cx, cy, radii[ring], deg);
      node.style.setProperty("--x", `${x}px`);
      node.style.setProperty("--y", `${y}px`);
    }
    offset += count;
  }
}

/**
 * Called after each render while on the radial screen.
 * Keeps orbit nodes correctly placed and responsive to browser resizing.
 */
export function installRadialLayout() {
  const stageEl = document.querySelector(".radial-stage");
  if (!stageEl) return;

  // Clean up previous observers/listeners (we re-render the DOM often).
  if (window.__hbcrRadialRO) {
    try { window.__hbcrRadialRO.disconnect(); } catch {}
    window.__hbcrRadialRO = null;
  }
  if (window.__hbcrRadialResize) {
    window.removeEventListener("resize", window.__hbcrRadialResize);
    window.__hbcrRadialResize = null;
  }

  const relayout = () => layoutOrbits(stageEl);
  window.__hbcrRadialResize = relayout;
  window.addEventListener("resize", relayout);

  const ro = new ResizeObserver(() => relayout());
  ro.observe(stageEl);
  window.__hbcrRadialRO = ro;

  // Do one layout pass immediately.
  relayout();
}


function normalizeAssetPath(path) {
  const p = String(path || "");
  return p.startsWith("assets/") ? `./${p}` : p;
}

function nodeIcon(path) {
  if (!path) return `<div class="radial-fallback">◈</div>`;

  const p = String(path);

  // Some sheets may store inline SVG or prebuilt <img> HTML.
  // If it looks like markup, trust it.
  if (p.trim().startsWith("<")) return p;

  const normalized = p.startsWith("assets/") ? `./${p}` : p;
  return `<img src="${escapeHtml(normalized)}" alt="" />`;
}


function formatSubraceLabel(name, raceName) {
  // Example: "Black Dragonborn" -> "Black" (when raceName is "Dragonborn")
  // Keep it conservative: only strip a trailing " <RaceName>" match.
  if (!name) return name;
  if (!raceName) return name;
  const suffix = " " + raceName;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}



function mod(score) {
  const s = Number(score || 10);
  return Math.floor((s - 10) / 2);
}

function fmtSigned(n) {
  return (n >= 0 ? `+${n}` : `${n}`);
}

function calcAbilityPointsRemaining(abilities) {
  // Standard 5e point buy: 27 points, scores 8-15
  const cost = {8:0,9:1,10:2,11:3,12:4,13:5,14:7,15:9};
  let spent = 0;
  for (const k of ['str','dex','con','int','wis','cha']) {
    const v = Math.max(8, Math.min(15, Number(abilities?.[k] ?? 8)));
    spent += cost[v] ?? 0;
  }
  return Math.max(0, 27 - spent);
}


function applyAbilityBonuses(baseAbilities, bonusAssign) {
  const a = { ...(baseAbilities || {}) };
  const p3 = bonusAssign && bonusAssign.plus3 ? String(bonusAssign.plus3) : "";
  const p1 = bonusAssign && bonusAssign.plus1 ? String(bonusAssign.plus1) : "";
  if (p3) a[p3] = Number(a[p3] ?? 0) + 3;
  if (p1) a[p1] = Number(a[p1] ?? 0) + 1;
  return a;
}


function calcHitPoints(ch) {
  const clsId = ch.cls?.id;
  const hitDieByClass = {
    barbarian: 12,
    fighter: 10,
    paladin: 10,
    ranger: 10,
    cleric: 8,
    druid: 8,
    monk: 8,
    rogue: 8,
    bard: 8,
    warlock: 8,
    artificer: 8,
    sorcerer: 6,
    wizard: 6,
  };
  const hd = hitDieByClass[clsId] ?? 8;
  const lvl = Number(ch.level || 1);
  const conMod = mod(ch.abilities?.con ?? 10);
  // Simple baseline: max at level 1, average thereafter
  const avg = Math.floor((hd + 1) / 2) + 0; // D&D average rounding down
  const hp = hd + conMod + Math.max(0, lvl - 1) * (avg + conMod);
  return Math.max(1, hp);
}

function calcArmourClass(ch) {
  // Baseline (no gear): 10 + DEX mod
  return 10 + mod(ch.abilities?.dex ?? 10);
}

function calcMovement(ch) {
  const raceId = ch.race?.id;
  const slow = new Set(['dwarf','gnome','halfling']);
  const meters = slow.has(raceId) ? 7.5 : 9;
  return `${meters}m`;
}

function formatProficiencies(profs) {
  if (!profs) return '—';
  const parts = [];
  if (profs.weapons?.length) parts.push(`Weapons: ${profs.weapons.join(', ')}`);
  if (profs.armour?.length) parts.push(`Armour: ${profs.armour.join(', ')}`);
  if (profs.shields) parts.push('Shields');
  if (profs.tools?.length) parts.push(`Tools: ${profs.tools.join(', ')}`);
  if (profs.skills?.length) parts.push(`Skills: ${profs.skills.join(', ')}`);
  return parts.length ? parts.join('<br/>') : '—';
}

function formatSpellNames(ids, spells) {
  if (!ids?.length) return '—';
  const names = ids.map(id => spells[id]?.name || id);
  return names.join(', ');
}

function formatSpellsBySpellLevel(cantripIds, spellIds, spells) {
  const cantrips = (cantripIds || []).map(id => spells[id] || {name:id, level:0});
  const spellObjs = (spellIds || []).map(id => spells[id] || {name:id, level:1});
  const groups = new Map();
  for (const s of [...cantrips, ...spellObjs]) {
    const lvl = Number(s.level ?? 0);
    const key = lvl === 0 ? 'Cantrips' : `Level ${lvl}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s.name);
  }
  if (groups.size === 0) return '—';
  const order = ['Cantrips','Level 1','Level 2','Level 3','Level 4','Level 5','Level 6'];
  const keys = [...groups.keys()].sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  return keys.map(k => `<div style="margin-bottom:6px"><b>${k}:</b> ${groups.get(k).join(', ')}</div>`).join('');
}

function toAbilityRow(abilities) {
  const keys = ["str", "dex", "con", "int", "wis", "cha"];
  return `
    <div class="sheet-abilities">
      ${keys
        .map((k) => {
          const v = Number(abilities?.[k] ?? 8);
          const mod = Math.floor((v - 10) / 2);
          const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
          return `
            <div class="sheet-ability">
              <div class="k">${k.toUpperCase()}</div>
              <div class="v">${v}</div>
              <div class="m">${modStr}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}


function abilityMod(score) {
  const v = Number(score ?? 10);
  return Math.floor((v - 10) / 2);
}

function pointBuyCost(score) {
  const v = Number(score ?? 10);
  if (v <= 8) return 0;
  if (v === 9) return 1;
  if (v === 10) return 2;
  if (v === 11) return 3;
  if (v === 12) return 4;
  if (v === 13) return 5;
  if (v === 14) return 7;
  if (v === 15) return 9;
  // Beyond point-buy cap; approximate extra cost.
  return 9 + (v - 15) * 2;
}

function computeAbilityPointsRemaining(abilities, budget = 27) {
  const a = abilities || {};
  const spent = ['str','dex','con','int','wis','cha'].reduce((sum, k) => sum + pointBuyCost(a[k] ?? 8), 0);
  return { spent, remaining: budget - spent, budget };
}

function movementSpeedMeters(raceId) {
  // BG3 default is 9m (30ft). Dwarves, gnomes, halflings: 7.5m (25ft).
  const slow = new Set(['dwarf','gnome','halfling']);
  return slow.has(raceId) ? 7.5 : 9;
}

function groupSpellsByLevel(spellIds, spellsIndex) {
  const by = new Map();
  (spellIds || []).forEach((id) => {
    const s = spellsIndex.get(id);
    const lvl = Number(s?.level ?? 0);
    if (!by.has(lvl)) by.set(lvl, []);
    by.get(lvl).push(s?.name ?? id);
  });
  for (const [lvl, arr] of by) {
    arr.sort((a, b) => String(a).localeCompare(String(b)));
  }
  return Array.from(by.entries()).sort((a, b) => a[0] - b[0]);
}

export async function RadialScreen({ state }) {
  const ch = state.character;
  const ui = state.ui?.radial ?? { stage: "race", breadcrumbs: [] };
  const design = isDesignMode();
  let stage = ui.stage || "race";
  const buildLevel = Number(ui.buildLevel ?? 1);

  // liveData.loadData() may return either:
  //   - an array of normalized rows (bundle path)
  //   - an object wrapper like { races:[...], classes:[...], spells:[...] } (older/local json shape)
  // Radial UI must tolerate both.
  const unwrapList = (data, key) => {
    if (Array.isArray(data)) return data;
    const v = data?.[key];
    if (Array.isArray(v)) return v;
    // Some sheets ship as {rows:[...]} in a few places
    if (Array.isArray(data?.rows)) return data.rows;
    return [];
  };

  // Core data is needed for initial navigation.
  const [racesData, subracesData, classesData, classesFull] = await Promise.all([
    loadRaces(),
    loadSubraces(),
    loadClasses(),
    loadClassesFull(),
  ]);

  // Heavy build data (spells/flows/features/choices) is only needed once you're in Build
  // or actively opening a picker. This cuts first-load latency drastically in live mode.
  const pickerOpen = Boolean(state.ui?.picker?.open);
  const needBuildData = stage === "build" || pickerOpen;

  let spellsData = null;
  let levelFlows = null;
  let traitsData = null;
  let featsData = null;
  let classFeaturesRaw = null;
  let raceFeaturesRaw = null;
  let choicesRaw = null;

  if (needBuildData) {
    [spellsData, levelFlows, traitsData, featsData, classFeaturesRaw, raceFeaturesRaw, choicesRaw] = await Promise.all([
      loadSpells(),
      loadLevelFlows(),
      loadTraits(),
      loadFeats(),
      loadClassFeatures(),
      loadRaceFeatures(),
      loadChoices(),
    ]);
  }

  const races = unwrapList(racesData, "races");
  const subracesFlat = unwrapList(subracesData, "subraces");
  const classes = unwrapList(classesData, "classes");

  // ---- Attach subraces to races (live bundle provides Subraces as a separate sheet) ----
  // Supports multiple possible parent-id columns.
  const subracesByRace = new Map();
  for (const sr of (subracesFlat || [])) {
    const parentRaceId =
      sr?.raceId ?? sr?.RaceId ??
      sr?.parentRaceId ?? sr?.ParentRaceId ??
      sr?.ownerId ?? sr?.OwnerId ??
      sr?.Race ?? sr?.race ??
      null;
    const rid = parentRaceId ? String(parentRaceId) : null;
    if (!rid) continue;
    if (!subracesByRace.has(rid)) subracesByRace.set(rid, []);
    subracesByRace.get(rid).push(sr);
  }

  // Mutate-in-place is OK here; we only use these objects for UI rendering.
  for (const r of (races || [])) {
    if (!r || typeof r !== "object") continue;
    if (!Array.isArray(r.subraces) || r.subraces.length === 0) {
      const list = subracesByRace.get(String(r.id)) || [];
      if (list.length) r.subraces = list;
    }
  }

  const NO_SUBRACE = new Set((races || []).filter(r => !(r?.subraces?.length)).map(r => r.id));
  const subclassesIndex = indexSubclasses(classesFull);
  const spells = unwrapList(spellsData, "spells");
  const traits = unwrapList(traitsData, "traits");
  const feats = unwrapList(featsData, "feats");

  const spellsIndex = new Map(spells.map((s) => [s.id, s]));
  const featsIndex = new Map(feats.map((f) => [f.id, f]));

  
  // Character/UI context (set near top)

  // Load only the class progression files currently used in the multiclass timeline.
  const usedClassIds = Array.from(new Set((ch.build?.timeline || []).map(e => e?.classId).filter(Boolean)));
  const classProgressions = usedClassIds.length ? await loadClassProgressions(usedClassIds) : {};

  // Stage navigation (always visible, always clickable)
    const raceMap = new Map(races.map((r) => [r.id, r]));
  const classMap = new Map(classes.map((c) => [c.id, c]));

    
// Skip empty subrace stages (e.g. Half-Orc, Human): go straight to Class.
if (stage === "subrace") {
  const _raceObj = raceMap.get(ch.race);
  const _subs = _raceObj?.subraces ?? [];
  if (!Array.isArray(_subs) || _subs.length === 0) stage = "class";
}
const currentRace = raceMap.get(ch.race);
  const currentSubrace = currentRace?.subraces?.find((s) => s.id === ch.subrace) ?? null;


  // Class/Subclass icons should reflect the currently selected build level (with fallback to prior levels).
  const timeline = ch.build?.timeline || [];
  const findAtOrBefore = (key) => {
    for (let i = buildLevel - 1; i >= 0; i--) {
      const v = timeline?.[i]?.[key];
      if (v) return v;
    }
    return null;
  };

  const effectiveClassId = findAtOrBefore("classId") || ch.class || null;

// Subclass fallback must be scoped to the effective class (don't carry a Barbarian subclass into Artificer).
const findSubclassForClassAtOrBefore = (classId) => {
  if (!classId) return null;
  for (let i = buildLevel - 1; i >= 0; i--) {
    const e = timeline?.[i];
    if (!e) continue;
    if ((e.classId || null) !== classId) continue;
    if (e.subclassId) return e.subclassId;
  }
  return null;
};

// Builder context: subclass should come ONLY from the build timeline.
// Falling back to `ch.subclass` (main radial flow) incorrectly forces a default/previous subclass.
const effectiveSubclassId = findSubclassForClassAtOrBefore(effectiveClassId) || null;

const currentClass = classMap.get(effectiveClassId);
const currentSubclass =
  (subclassesIndex.get(effectiveClassId)?.get(effectiveSubclassId)) ?? null;


  
  // ------------------------------
  // Sheet-driven indexes
  // ------------------------------

  // class_features.json / race_features.json are exported from the Google Sheet.
  // They are authoritative for "what you get at each level" and must be keyed by
  // the selected class/subclass (NOT "first subclass in the class").
  const classFeatRows = Array.isArray(classFeaturesRaw)
    ? classFeaturesRaw
    : (classFeaturesRaw?.features || classFeaturesRaw?.classFeatures || classFeaturesRaw?.rows || []);

  const raceFeatRows = Array.isArray(raceFeaturesRaw)
    ? raceFeaturesRaw
    : (raceFeaturesRaw?.features || raceFeaturesRaw?.raceFeatures || raceFeaturesRaw?.rows || []);

  const choiceRows = Array.isArray(choicesRaw)
    ? choicesRaw
    : (choicesRaw?.choices || choicesRaw?.rows || []);

  // Index feature rows as: "<ownerType>|<ownerId>" -> level(int) -> [featureName...]
  const featureIndex = new Map();
  const addFeature = (ownerType, ownerId, level, name) => {
    const ot = String(ownerType || "").trim().toLowerCase();
    const oid = String(ownerId || "").trim();
    const lvl = Number(level);
    const nm = String(name || "").trim();
    if (!ot || !oid || !Number.isFinite(lvl) || !nm) return;

    const key = `${ot}|${oid}`;
    let byLvl = featureIndex.get(key);
    if (!byLvl) { byLvl = new Map(); featureIndex.set(key, byLvl); }
    const arr = byLvl.get(lvl) || [];
    if (!arr.includes(nm)) arr.push(nm);
    byLvl.set(lvl, arr);
  };

  for (const row of (classFeatRows || [])) {
    addFeature(row?.ownerType || row?.OwnerType || "subclass",
               row?.ownerId || row?.OwnerId || row?.subclassId || row?.SubclassId,
               row?.level ?? row?.Level,
               row?.name || row?.FeatureName || row?.featureName || row?.Name);
  }

  for (const row of (raceFeatRows || [])) {
    addFeature(row?.ownerType || row?.OwnerType || "race",
               row?.ownerId || row?.OwnerId,
               row?.level ?? row?.Level ?? 1,
               row?.name || row?.FeatureName || row?.featureName || row?.Name);
  }

  // Index choices as: "<ownerType>|<ownerId>" -> level(int) -> [{pickType,count,...}]
  const choiceIndex = new Map();
  const addChoice = (ownerType, ownerId, level, pickType, count, listOverride) => {
    const ot = String(ownerType || "").trim().toLowerCase();
    const oid = String(ownerId || "").trim();
    const lvl = Number(level);
    const pt = String(pickType || "").trim().toLowerCase();
    const ct = Number(count);
    if (!ot || !oid || !Number.isFinite(lvl) || !pt || !Number.isFinite(ct)) return;

    const lo = String(listOverride || "").trim().toLowerCase();

    const key = `${ot}|${oid}`;
    let byLvl = choiceIndex.get(key);
    if (!byLvl) { byLvl = new Map(); choiceIndex.set(key, byLvl); }
    const arr = byLvl.get(lvl) || [];
    // Keep owner context so pickers can enforce list restrictions.
    arr.push({ pickType: pt, count: ct, listOverride: lo || null, ownerType: ot, ownerId: oid });
    byLvl.set(lvl, arr);
  };

  for (const row of (choiceRows || [])) {
    addChoice(row?.ownerType || row?.OwnerType,
              row?.ownerId || row?.OwnerId,
              row?.level ?? row?.Level,
              row?.pickType || row?.PickType,
              row?.count ?? row?.Count ?? 0,
              row?.listOverride || row?.ListOverride);
  }

  const getFeatures = (ownerType, ownerId, level) => {
    const key = `${String(ownerType||"").toLowerCase().trim()}|${String(ownerId||"").toLowerCase().trim()}`;
    const byLvl = featureIndex.get(key);
    if (!byLvl) return [];
    return byLvl.get(Number(level)) || [];
  };

  const getChoices = (ownerType, ownerId, level) => {
    const key = `${String(ownerType||"").toLowerCase().trim()}|${String(ownerId||"").toLowerCase().trim()}`;
    const byLvl = choiceIndex.get(key);
    if (!byLvl) return [];
    return byLvl.get(Number(level)) || [];
  };

  // Resolve build-time pick steps directly from choices.json (sheet-driven).
  // Returns steps like: { route: "cantrips", label: "Cantrips", need: 2 }.
  function resolveBuildSteps(classId, subclassObj, classLevel) {
    const steps = [];
    const cid = String(classId || "").trim();
    const sid = String(subclassObj?.id || "").trim();
    const lvl = Number(classLevel);

    // Subclass is optional: many classes gain picks before a subclass is chosen,
    // and multiclass timelines can include levels without a subclass.
    if (!cid || !Number.isFinite(lvl)) return steps;

    const buckets = [
      ...getChoices("class", cid, lvl),
      ...(sid ? getChoices("subclass", sid, lvl) : []),
    ];

	    const mapPickTypeToRoute = (pt) => {
		const k = String(pt || "").toLowerCase().trim();

		// core spell-ish picks
		if (k === "cantrip" || k === "cantrips") return "cantrips";
		if (k === "spell" || k === "spells") return "spells";
		if (k === "frontier_ballistics" || k === "frontier ballistics" || k === "frontierballistics") return "frontierBallistics";
		if (k === "smite" || k === "smites") return "smites";
		if (k === "metamagic" || k === "metamagics") return "metamagic";

		// feature picks
		if (k === "passive" || k === "passives") return "passives";
		if (k === "feat" || k === "feats") return "feats";

		// new systems
		if (k === "manoeuvre" || k === "manoeuvres" || k === "maneuver" || k === "maneuvers") return "manoeuvres";
		if (k === "combat_technique" || k === "combat_techniques" || k === "combat technique" || k === "combat techniques") return "combatTechniques";
		if (k === "elemental_fletching" || k === "elemental_fletchings" || k === "fletching" || k === "fletchings") return "elementalFletchings";
		if (k === "optimization_matrix" || k === "optimization matrix" || k === "optimization matrices") return "optimizationMatrix";
		if (k === "sabotage_matrix" || k === "sabotage matrix" || k === "sabotage matrices") return "sabotageMatrix";
		if (k === "wildshape" || k === "wildshapes" || k === "wild shape" || k === "wild shapes") return "wildshapes";

		// Draconic Bloodline L1: Dragon Ancestor / Draconic Ancestry
		if (k === "dragon_ancestor" || k === "draconic_ancestry" || k === "draconic ancestry") return "dragonAncestor";

		return null;
		};


    const acc = new Map(); // route -> { need, ownerType, ownerId, listOverride }
    for (const b of buckets) {
      const route = mapPickTypeToRoute(b?.pickType);
      if (!route) continue;
      const need = Math.max(0, Number(b?.count || 0));

      const cur = acc.get(route) || { need: 0, ownerType: null, ownerId: null, listOverride: null };
      cur.need += need;

      // Owner context: prefer subclass when present (e.g. Wild Soul spells come from subclass).
      if (!cur.ownerType || !cur.ownerId || cur.ownerType !== "subclass") {
        if (b?.ownerType === "subclass") {
          cur.ownerType = "subclass";
          cur.ownerId = b?.ownerId || null;
        } else if (!cur.ownerType) {
          cur.ownerType = b?.ownerType || null;
          cur.ownerId = b?.ownerId || null;
        }
      }

      // listOverride: if any contributing row says "any", treat the whole pick as any.
      if (String(b?.listOverride || "").toLowerCase() === "any") {
        cur.listOverride = "any";
      } else if (!cur.listOverride) {
        cur.listOverride = String(b?.listOverride || "").toLowerCase() || null;
      }

      acc.set(route, cur);
    }

    // Some classes get class-wide spellcasting; only these should derive picks from class spellcasting tables.
    // Subclass-only casters (e.g. Eldritch Knight, Arcane Trickster, Way of the Arcane) must be driven by Choices rows.
    const CLASS_WIDE_SPELLCASTERS = new Set([
      "bard","cleric","druid","paladin","ranger","sorcerer","warlock","wizard","artificer"
    ]);
    // Some classes/subclasses express spell picks via the spellcasting progression
    // tables rather than explicit Choices rows. Those tables are still sheet-driven
    // (exported via classes.full.json), so we can derive pick steps from them when
    // Choices does not specify them.
    // IMPORTANT: Choices (if present) remains the source of truth to avoid
    // double-counting or mismatches.
    if (CLASS_WIDE_SPELLCASTERS.has(cid) && !acc.has("cantrips")) {
      const scNeed = deltaFromSpellcasting(cid, lvl, "cantripsKnownByLevel");
      if (Number(scNeed) > 0) acc.set("cantrips", { need: Number(scNeed), listOverride: "any" });
    }
    if (CLASS_WIDE_SPELLCASTERS.has(cid) && !acc.has("spells")) {
      const scNeed = deltaFromSpellcasting(cid, lvl, "spellsKnownByLevel");
      if (Number(scNeed) > 0) acc.set("spells", { need: Number(scNeed), listOverride: "class" });
    }

    for (const [route, meta] of acc.entries()) {
      steps.push({
        route,
        label: prettyStepLabel(route),
        need: meta?.need ?? 0,
        ownerType: meta?.ownerType ?? null,
        ownerId: meta?.ownerId ?? null,
        listOverride: meta?.listOverride ?? null,
      });
    }

	    // Stable ordering (matches BG3-ish expectation).
	    const order = [
	      // spell-ish
	      "cantrips",
	      "spells",
	      "metamagic",
	      "smites",
	      "frontierBallistics",

	      // new systems
	      "optimizationMatrix",
	      "sabotageMatrix",
	      "manoeuvres",
	      "combatTechniques",
	      "elementalFletchings",
	      "wildshapes",
	      "dragonAncestor",

	      // generic
	      "passives",
	      "feats",
	    ];
	    const idx = (r) => {
	      const i = order.indexOf(r);
	      return i === -1 ? 999 : i;
	    };
	    steps.sort((a,b) => idx(a.route) - idx(b.route));

    return steps;
  }
function mapStepToRoute(stepId) {
    // Normalise step IDs coming from PDFs/data. Some sources use Title Case
    // (e.g. "Cantrips") while our routes are lowercase.
    const raw = String(stepId || "");
    const k = raw.toLowerCase();

    const m = {
      // Canonical mappings
      cantrips: "cantrips",
      spells: "spells",
      feats: "feats",
      // Legacy aliases
      featorcrosspassives: "feats",
      spellsanylist: "spells",
    };

    // Strip non-alphanumerics so "Feat / Cross Passives" still maps.
    const compact = k.replace(/[^a-z0-9]+/g, "");
    return m[compact] || m[k] || raw;
  }

  function prettyStepLabel(stepId) {
    const labels = {
      cantrips: "Cantrips",
      spells: "Spells",
      spellsAnyList: "Spells (Any List)",
      feats: "Feats",
      featOrCrossPassives: "Feat / Cross Passives",
      classPassives: "Class Passives",
      arcaneThreads: "Arcane Threads",
      metamagic: "Metamagic",
      manoeuvres: "Manoeuvres",
      smites: "Smites",
      wildshapes: "Wildshapes",
      frontierBallistics: "Frontier Ballistics",
      dragonAncestor: "Dragon Ancestor",
      pactBinding: "Pact Binding",
      steelforgedFlourishes: "Steelforged Flourishes",
      combatTechniques: "Combat Techniques",
      elementalFletchings: "Elemental Fletchings",
      gatheredSwarm: "Gathered Swarm",
      optimizationMatrix: "Optimization Matrix",
      sabotageMatrix: "Sabotage Matrix"
    };
    return labels[stepId] || stepId;
  }

  function deltaFromSpellcasting(classId, classLevel, field){
    const prog = classProgressions?.[classId] || null;
    const sc = prog?.spellcasting || null;
    const tbl = sc?.[field] || null;
    if (!tbl) return null;
    const now = Number(tbl[String(classLevel)] ?? 0);
    const prev = Number(tbl[String(Math.max(0, classLevel - 1))] ?? 0);
    return Math.max(0, now - prev);
  }

  function stepStatusForLevel(entryPicks, stepId, classId, classLevel) {
    const picks = entryPicks || {};

    if (stepId === "cantrips") {
      const need = deltaFromSpellcasting(classId, classLevel, "cantripsKnownByLevel") ?? 0;
      const cur = Array.isArray(picks.cantrips) ? picks.cantrips.length : 0;
      return { kind: "count", cur, need };
    }
    if (stepId === "spells" || stepId === "spellsAnyList") {
      const need = deltaFromSpellcasting(classId, classLevel, "spellsKnownByLevel") ?? 0;
      const cur = Array.isArray(picks.spells) ? picks.spells.length : 0;
      return { kind: "count", cur, need };
    }
    if (stepId === "feats" || stepId === "featOrCrossPassives") {
      const cur = Array.isArray(picks.feats) ? picks.feats.length : (picks.feat ? 1 : 0);
      // Most feat gates are 1 pick; if you want to drive this from progression later, we can.
      const need = 1;
      return { kind: "count", cur, need };
    }

    // Default: no completion tracking yet
    return { kind: "none" };
  }

  
function featureNamesAtLevel(classId, subclassObj, classLevel) {
    const cid = String(classId || "").trim();
    const sid = String(subclassObj?.id || "").trim();
    const lvl = Number(classLevel);

    if (!cid || !sid || !Number.isFinite(lvl)) return [];

    const base = getFeatures("class", cid, lvl);
    const sub  = getFeatures("subclass", sid, lvl);

    // Keep a stable, deduped list.
    const out = [];
    for (const n of [...base, ...sub]) {
      const nm = String(n || "").trim();
      if (nm && !out.includes(nm)) out.push(nm);
    }
    return out;
  }


  
function renderBuildSteps(classLevel, classId, subclassObj) {
    if (!classId || !subclassObj) return `<div style="opacity:.8">Pick a subclass to unlock steps.</div>`;

    const steps = resolveBuildSteps(classId, subclassObj, classLevel) || [];
    if (!steps.length) return `<div style="opacity:.75">No picks at this level.</div>`;

    // Pull current slot picks for this character level to render completion.
    const entry = (ch.build?.timeline || [])[Math.max(0, Math.min(11, Number(ui.buildLevel ?? 1) - 1))] || {};
    const entryPicks = entry.picks || {};

    const curFor = (route) => {
      if (route === "cantrips") return Array.isArray(entryPicks.cantrips) ? entryPicks.cantrips.length : 0;
      if (route === "spells") return Array.isArray(entryPicks.spells) ? entryPicks.spells.length : 0;
      if (route === "feats") return Array.isArray(entryPicks.feats) ? entryPicks.feats.length : (entryPicks.feat ? 1 : 0);
      // Generic fallback for any other picker types.
      const v = entryPicks[route];
      return Array.isArray(v) ? v.length : (v ? 1 : 0);
    };

    const card = (route, label, need, disabled, meta) => {
      const cur = curFor(route);
      const showBadge = Number.isFinite(Number(need)) && Number(need) > 0;
      const badge = showBadge ? `<span class="pick-badge">${cur}/${need}</span>` : ``;
      const done = showBadge ? (cur >= Number(need)) : Boolean(cur);

      // For spell/cantrip pickers, include owner context + listOverride so the picker can
      // enforce restricted spell lists vs full access.
      const extra = (route === "spells" || route === "cantrips")
        ? `|${escapeHtml(String(meta?.ownerType || ""))}|${escapeHtml(String(meta?.ownerId || ""))}|${escapeHtml(String(meta?.listOverride || ""))}`
        : ``;

      return dmWrap(`radial.picker.card.${route}`, `
        <button type="button"
          class="pick-card ${done ? "is-done" : ""} ${disabled ? "is-disabled" : ""}"
          data-action="${disabled ? "" : "radial-go"}"
          data-id="${escapeHtml(String(route))}${showBadge ? `|${escapeHtml(String(need))}` : ""}${extra}">
          <div class="pick-card-l">${escapeHtml(label || route)}</div>
          <div class="pick-card-r">${badge}</div>
        </button>
      `);
    };

    return `
      <div class="pick-grid">
        ${steps.map(s => card(s.route, s.label, s.need, false, s)).join("")}
      </div>
    `;
  }



  // Replace breadcrumb icons with always-clickable stage buttons.
  // Icons appear under the label once a choice is made.
  const stageTabs = [
    {
      id: "race",
      label: "Race",
      picked: !!ch.race,
      icon: currentRace?.icon || "",
      locked: false,
    },
    {
      id: "subrace",
      label: "Subrace",
      picked: !!ch.subrace && !!ch.race && !NO_SUBRACE.has(ch.race),
      icon: currentSubrace?.icon || currentRace?.icon || "",
      locked: false,
    },
    {
      id: "class",
      label: "Class",
      picked: !!ch.class,
      icon: currentClass?.icon || "",
      locked: false,
    },
    {
      id: "subclass",
      label: "Subclass",
      picked: !!ch.subclass,
      icon: currentSubclass?.icon || currentClass?.icon || "",
      locked: false,
    },
  ];

  // Top-right dock: compact buttons for the current level's pick windows (spells, cantrips, etc.)
  const dockCharLvl = Number(ui.buildLevel ?? 1);
  const dockTimeline = ch.build?.timeline || [];
  const dockEntry = dockTimeline[dockCharLvl - 1] || {};
  const dockClassId = dockEntry.classId || "";
  const dockSubclassId = (() => {
    if (!dockClassId) return "";
    for (let k = dockCharLvl - 1; k >= 0; k--) {
      const e = dockTimeline[k];
      if (!e) continue;
      if (String(e.classId || "") !== String(dockClassId)) continue;
      if (e.subclassId) return String(e.subclassId);
    }
    return "";
  })();
  const dockClassLevel = dockClassId
    ? dockTimeline.slice(0, dockCharLvl).filter((e) => (e?.classId || "") === dockClassId).length
    : 0;
  const dockSubclassObj = dockClassId && dockSubclassId
    ? (subclassesIndex.get(dockClassId)?.get(dockSubclassId) || null)
    : null;
  // Pull current slot picks for this character level so the dock can show completion (cur/need).
  const dockActiveEntry = (dockTimeline || [])[Math.max(0, Math.min(11, dockCharLvl - 1))] || {};
  const dockEntryPicks = dockActiveEntry.picks || {};
  const picksDockHtml = renderBuildStepsDock(dockClassLevel || 1, dockClassId, dockSubclassObj, dockEntryPicks);

  const dmWrap = (id, html) => design ? `<div class="hbcr-dm-inner" data-ui-component="${escapeHtml(id)}">${html}</div>` : html;

  const stageTabsDock = `
    <div class="stage-and-picks" aria-label="Stage navigation">
      <div class="stage-tabs">
        ${stageTabs
          .map((t) => {
            const target = t.id;
            const isActive = stage === t.id;
            const iconSrc = t.picked ? t.icon : "";
            const iconSrcNorm = iconSrc ? normalizeAssetPath(iconSrc) : "";
            return dmWrap(`radial.tabs.${t.id}`, `
              <button
                class="stage-tab ${isActive ? "active" : ""}"
                data-action="radial-nav"
                data-id="${escapeHtml(target)}"
                type="button"
                style="position:relative;z-index:5001;pointer-events:auto;
                  width:110px;
                  padding:10px 10px 12px;
                  border-radius:14px;
                  border:1px solid rgba(209,170,85,0.35);
                  background:linear-gradient(180deg, rgba(40,28,18,0.68), rgba(10,8,6,0.58));
                  box-shadow:0 10px 28px rgba(0,0,0,0.38), inset 0 0 0 1px rgba(255,215,128,0.06);
                  color:rgba(233,215,184,0.95);
                  text-shadow:0 1px 0 rgba(0,0,0,0.85);
                  cursor:pointer;
                  ${isActive ? "border-color:rgba(255,215,128,0.65);" : ""}
                "
              >
                <div style="
                  font-size:12px;
                  letter-spacing:0.10em;
                  text-transform:uppercase;
                  text-align:center;
                  margin-bottom:8px;
                  font-weight:650;
                ">${escapeHtml(t.label)}</div>

                <div style="height:52px;display:grid;place-items:center;">
                  ${iconSrc
                    ? `<img src="${escapeHtml(iconSrcNorm)}" style="width:48px;height:48px;object-fit:contain;" alt="">`
                    : `<div style="
                         width:48px;height:48px;border-radius:999px;
                         border:1px solid rgba(255,215,128,0.25);
                         background:rgba(255,215,128,0.04);
                       "></div>`}
                </div>
              </button>
            `);
          })
          .join("")}
      </div>
      <div class="picks-dock">${picksDockHtml}</div>
    </div>
  `;

  const levelStripDock = stage === "build"
    ? `
      <div class="level-strip"
           style="display:flex;gap:6px;align-items:center;padding:10px 12px;
                  margin-top:10px;border-radius:14px;
                  background:rgba(0,0,0,0.18);
                  border:1px solid rgba(255,215,128,0.10);
                  position:relative;z-index:4000;pointer-events:auto;">

        <div style="font-size:12px;letter-spacing:.10em;text-transform:uppercase;opacity:.9;margin-right:6px;">
          Character Level
        </div>

        ${Array.from({ length: 12 })
          .map((_, i) => {
            const n = i + 1;
            const active = Number(ui.buildLevel ?? 1) === n;
            const filled = !!(ch.build?.timeline?.[n-1]?.classId);
            return `<button data-action="build-level"
                            data-id="${n}"
                            type="button"
                            style="width:26px;height:26px;border-radius:999px;
                                   border:1px solid rgba(209,170,85,0.35);
                                   background:${active ? "rgba(255,215,128,0.18)" : filled ? "rgba(255,215,128,0.10)" : "rgba(0,0,0,0.20)"};
                                   color:rgba(233,215,184,0.95);
                                   cursor:pointer;">
                      ${n}
                    </button>`;
          })
          .join("")}

      </div>
    `
    : ``;

  // Determine options for current stage
  let centerTitle = "Race";
  let centerSubtitle = "";
  let orbitOptions = [];

  if (stage === "race") {
    centerTitle = "Race";
    centerSubtitle = "";
    orbitOptions = races.map((r) => ({
      id: r.id,
      label: r.name,
      icon: nodeIcon(r.icon),
      action: "select-race"
    }));
  }

  if (stage === "subrace") {
    centerTitle = "Subrace";
    centerSubtitle = currentRace ? `for ${currentRace.name}` : "Select a subrace";
    const subs = currentRace?.subraces ?? [];
    orbitOptions = subs.map((s) => ({
      id: s.id,
      label: formatSubraceLabel(s.name, currentRace?.name),
      icon: nodeIcon(s.icon || currentRace?.icon),
      action: "select-subrace"
    }));
  }

  if (stage === "class") {
    centerTitle = "Class";
    centerSubtitle = "Select a class";
    orbitOptions = classes.map((c) => ({
      id: c.id,
      label: c.name,
      icon: nodeIcon(c.icon),
      action: "select-class"
    }));
  }

  if (stage === "subclass") {
    centerTitle = "Subclass";
    centerSubtitle = currentClass ? `for ${currentClass.name}` : "Select a subclass";
    const scMap = subclassesIndex.get(ch.class);
    const scList = scMap ? Array.from(scMap.values()) : [];
    orbitOptions = scList.map((s) => ({
      id: s.id,
      label: s.name,
      icon: nodeIcon(s.icon || currentClass?.icon),
      action: "select-subclass"
    }));
  }

  
  
if (stage === "build") {
  // Build happens in the LEFT pane. No orbit nodes after Subclass.
  orbitOptions = [];
}

// Compact version of build-step buttons for the top-right "Picks" dock.
function renderBuildStepsDock(classLevel, classId, subclassObj, entryPicks) {
  if (!classId) return "";
  const steps = resolveBuildSteps(classId, subclassObj, classLevel);
  if (!steps || steps.length === 0) return "";

  const picks = entryPicks || {};
  const curFor = (route) => {
    if (route === "cantrips") return Array.isArray(picks.cantrips) ? picks.cantrips.length : 0;
    if (route === "spells") return Array.isArray(picks.spells) ? picks.spells.length : 0;
    if (route === "feats") return Array.isArray(picks.feats) ? picks.feats.length : (picks.feat ? 1 : 0);
    const v = picks[route];
    return Array.isArray(v) ? v.length : (v ? 1 : 0);
  };

  return `
    <div class="pick-grid pick-grid--dock" aria-label="Picks this level">
      ${steps.map((s) => {
        const need = Math.max(0, Number(s.need || 0));
        const cur = curFor(s.route);
        const showBadge = Number.isFinite(need) && need > 0;
        const badge = showBadge ? `<div class="pick-count">${cur}/${need}</div>` : ``;

        // Match the existing routing contract used by the left panel:
        //   route|need|ownerType|ownerId|listOverride
        // Only spell/cantrip pickers require the extra owner/list context.
        const extra = (s.route === "spells" || s.route === "cantrips")
          ? `|${escapeHtml(String(s.ownerType || ""))}|${escapeHtml(String(s.ownerId || ""))}|${escapeHtml(String(s.listOverride || ""))}`
          : "";
        const routeId = `${escapeHtml(String(s.route))}|${escapeHtml(String(need))}${extra}`;

        return dmWrap(`radial.picks.dock.${s.route}`, `
          <button class="pick-card pick-card--dock" type="button"
              data-action="radial-go" data-id="${routeId}">
            <div class="pick-name">${escapeHtml(s.label)}</div>
            ${badge}
          </button>
        `);
      }).join("")}
    </div>
  `;
}

  // Spell slot totals are tracked in progression data if needed, but we do not render them in the UI.

  // Breadcrumbs are now rendered globally (top-left) from app.js so they are visible
  // across every screen.

  const lvl = Number(ch.level ?? 1);
  const ap = computeAbilityPointsRemaining(ch.abilities, 27);
  const initMod = abilityMod(ch.abilities?.dex ?? 10);
  const initStr = initMod >= 0 ? `+${initMod}` : `${initMod}`;
  const speed = movementSpeedMeters(ch.race);

  const cantripNames = (ch.cantrips || []).map((id) => spellsIndex.get(id)?.name ?? id);
  const spellGroups = groupSpellsByLevel(ch.spells || [], spellsIndex);

  // ------------------------------
  // Character Summary panel (right side)
  // ------------------------------
  // IMPORTANT: render ability scores ONCE.
  // Previously this template called toAbilityRow() six times (STR/DEX/...),
  // but toAbilityRow() actually renders the *entire* 6-stat grid. That caused
  // the whole ability section to repeat multiple times.
  
  const traitValue = ch.characterTrait ?? "";
  const selectedTrait =
    traits.find(t => String(t.id ?? t.name ?? "") === String(traitValue)) ||
    traits.find(t => String(t.name ?? "") === String(traitValue)) ||
    null;
  const traitDesc = selectedTrait
    ? String(selectedTrait.description ?? selectedTrait.desc ?? selectedTrait.text ?? selectedTrait.details ?? "")
    : "";
  const traitLabelForWidth = selectedTrait
    ? String(selectedTrait.name ?? selectedTrait.id ?? "")
    : "— None —";

  // Size the trait select to hug the current label (+ a small buffer),
  // without stretching across the header.
  const traitSelectWidthPx = (() => {
    const s = String(traitLabelForWidth || "");
    const len = Array.from(s).length; // handles unicode safely
    const px = Math.round(len * 8.2 + 64); // text + padding + chevron + ~4 spaces
    return Math.max(180, Math.min(360, px));
  })();



  // ------------------------------
  // Level-by-level summary boxes (right side)
  // ------------------------------
  function renderLevelBoxes() {
    const tl = ch.build?.timeline || [];
    const esc = (s) => escapeHtml(String(s ?? ""));

    // Timeline safety: some builds store entries sparsely or with a "lvl" field.
    // Always resolve by character level first, then fall back to array index.
    const getEntry = (lvl) => {
      const found = (tl || []).find(e => Number(e?.lvl) === Number(lvl));
      return found || tl[lvl - 1] || {};
    };

    // Resolve the subclass for a given class as-of a specific character level.
    // IMPORTANT: do not trust entry.subclassId on later levels; it may be null/stale.
    const findSubclassForClassAtOrBeforeLevel = (classId, uptoIdx) => {
      if (!classId) return null;
      for (let k = uptoIdx; k >= 0; k--) {
        const e = getEntry(k + 1);
        if (!e) continue;
        if ((e.classId || "") !== classId) continue;
        if (e.subclassId) return e.subclassId;
      }
      return null;
    };

    const fmtItems = (items, max = 6) => {
      const arr = (items || []).filter(Boolean);
      if (arr.length === 0) return "";
      const shown = arr.slice(0, max);
      const more = arr.length > max ? ` <span class="lvlmore">+${arr.length - max} more</span>` : "";
      return `${shown.map(esc).join(", ")}${more}`;
    };

    const row = (label, itemsHtml) => {
      if (!itemsHtml) return "";
      return `
        <div class="lvlrow">
          <div class="lvlk">${esc(label)}</div>
          <div class="lvlv">${itemsHtml}</div>
        </div>
      `;
    };

    const boxes = Array.from({ length: 12 }).map((_, i) => {
      const lvl = i + 1;
      const entry = getEntry(lvl);

      // Carry the most recent class forward if this slot is empty (matches setBuildLevel auto-fill behavior).
      const findClassAtOrBeforeLevel = (uptoIdx) => {
        for (let k = uptoIdx; k >= 0; k--) {
          const e = getEntry(k + 1);
          const cid = (e?.classId || "");
          if (cid) return cid;
        }
        return "";
      };

      const classId = entry.classId || findClassAtOrBeforeLevel(i) || "";

      if (!classId) {
        return `
          <div class="lvlbox empty">
            <div class="lvlbox-h">
              <div class="lvlbox-lvl">Level ${lvl}</div>
              <div class="lvlbox-class">—</div>
            </div>
            <div class="lvlbox-body">
              <div class="lvlbox-muted">No selections.</div>
            </div>
          </div>
        `;
      }

      // Character-level -> class-level for that class (multiclass aware)
      let classLevel = 0;
      for (let j = 0; j <= i; j++) {
        const eJ = getEntry(j + 1);
        const cidJ = (eJ?.classId || "") || findClassAtOrBeforeLevel(j) || "";
        if (cidJ === classId) classLevel++;
      }

      const clsName = classMap.get(classId)?.name || classId;
      const resolvedSubclassId = findSubclassForClassAtOrBeforeLevel(classId, i);
      const subObj = subclassesIndex.get(classId)?.get(resolvedSubclassId) || null;
      const subName = subObj?.name || "";

      const picks = entry.picks || {};
      const cantrips = (picks.cantrips || []).map((id) => spellsIndex.get(id)?.name ?? id);
      const spellsPicked = (picks.spells || []).map((id) => spellsIndex.get(id)?.name ?? id);
      const featsPicked = (picks.feats || []).map((id) => featsIndex.get(id)?.name ?? String(id));
      let features = featureNamesAtLevel(classId, subObj, classLevel);

      // Race/Subrace features should also surface in the summary (they are sheet-driven).
      // Treat them as Level 1 grants in the Character Summary.
      if (lvl === 1) {
        const raceId = String(ch.race || "").trim();
        const subraceId = String(ch.subrace || "").trim();
        const raceFeats = [
          ...getFeatures("race", raceId, 1),
          ...getFeatures("subrace", subraceId, 1),
        ].filter(Boolean);

        const merged = [];
        for (const n of [...raceFeats, ...features]) {
          const nm = String(n || "").trim();
          if (nm && !merged.includes(nm)) merged.push(nm);
        }
        features = merged;
      }

      const cantripsHtml = fmtItems(cantrips, 6);
      const spellsHtml = fmtItems(spellsPicked, 6);
      const featsHtml = fmtItems(featsPicked, 4);
      const featuresHtml = fmtItems(features, 6);

      // Any other picks recorded for this level (metamagic, manoeuvres, etc.)
      // Render them generically so the Level Summary always reflects the timeline state.
      const extraRows = Object.entries(picks)
        .filter(([k]) => !["cantrips", "spells", "feats"].includes(k) && !/slot/i.test(String(k)))
        .map(([k, v]) => {
          const arr = Array.isArray(v) ? v : (v ? [v] : []);
          const html = fmtItems(arr.map(x => String(x)), 6);
          return row(prettyStepLabel(k), html);
        })
        .join("");

      return `
        <div class="lvlbox">
          <div class="lvlbox-h">
            <div class="lvlbox-lvl">Level ${lvl}</div>
            <div class="lvlbox-class">
              ${esc(clsName)} <span class="lvlbox-clvl">L${classLevel}</span>
              ${subName ? `<span class="lvlbox-sub">— ${esc(subName)}</span>` : ``}
            </div>
          </div>
          <div class="lvlbox-body">
            ${row("Cantrips", cantripsHtml)}
            ${row("Spells", spellsHtml)}
            ${row("Feats", featsHtml)}
            ${row("Features", featuresHtml)}
            ${extraRows}
          </div>
        </div>
      `;
    });

    return `<div class="level-boxes">${boxes.join("")}</div>`;
  }

  const bonusAssign = ch.abilityBonusAssign || {};
  const effAbilities = applyAbilityBonuses(ch.abilities || {}, bonusAssign);
  const chEff = { ...ch, abilities: effAbilities };

const sheet = `
    <div class="sheet-title">CHARACTER SUMMARY</div>

    <div class="summary-grid">
      <div class="summary-left">
        <div class="sheet-controls summary-top">
          <div class="sheet-pill" title="${NO_SUBRACE.has(String(ch.race||'')) ? 'Race' : 'Subrace'}">${escapeHtml((NO_SUBRACE.has(String(ch.race||'')) ? (currentRace?.name || ch.race) : currentSubrace?.name) || '—')}</div>

          ${design ? `<div class="sheet-pill trait-pill" data-ui-component="radial.summary.trait" title="Trait" style="margin-left:12px">` : `<div class="sheet-pill trait-pill" title="Trait" style="margin-left:12px">`}
            <span class="trait-label">TRAIT</span>
            <select class="trait-select" data-action="set-trait" style="width:${traitSelectWidthPx}px">
              <option value="">— None —</option>
              ${(traits || [])
                .map(t => {
                  const id = String(t.id ?? t.name ?? "");
                  const name = String(t.name ?? t.id ?? "");
                  const sel = String(traitValue) === id ? "selected" : "";
                  return `<option value="${escapeHtml(id)}" ${sel}>${escapeHtml(name)}</option>`;
                })
                .join("")}
            </select>
          </div>
        </div>

        <div class="sheet-muted trait-desc">${traitDesc ? escapeHtml(traitDesc) : "No trait selected."}</div>

        <div class="summary-ability-points" title="Point Buy">
          Ability Points: ${(ch.abilityPointsRemaining ?? calcAbilityPointsRemaining(ch.abilities))} / 27
        </div>

        
<div class="summary-abilities-compact" aria-label="Ability scores">
          <div class="ability-row ability-row--head" aria-hidden="true">
            <div class="ability-k"></div>
            <div></div>
            <div class="ability-v"></div>
            <div class="ability-m"></div>
            <div></div>
            <div class="ability-bonus-h">+3</div>
            <div class="ability-bonus-h">+1</div>
          </div>

          ${["str","dex","con","int","wis","cha"].map((k) => {
            const base = Number(ch.abilities?.[k] ?? 8);
            const v = Number(effAbilities?.[k] ?? base);
            const m = Math.floor((v - 10) / 2);
            const modStr = m >= 0 ? `+${m}` : `${m}`;
            const label = k.toUpperCase();
            const minusImg = "./assets/ui/shadowheartminus.png";
            const plusImg  = "./assets/ui/karlachplus.png";

            const has3 = String(bonusAssign?.plus3 || "") === k;
            const has1 = String(bonusAssign?.plus1 || "") === k;

            return `
              <div class="ability-row">
                <div class="ability-k">${label}</div>

                <button class="ability-face-btn" type="button"
                        data-action="adj-ability" data-id="${k}:-1" aria-label="Decrease ${label}">
                  <img src="${minusImg}" alt="">
                </button>

                <div class="ability-v">${v}</div>
                <div class="ability-m">${modStr}</div>

                <button class="ability-face-btn" type="button"
                        data-action="adj-ability" data-id="${k}:1" aria-label="Increase ${label}">
                  <img src="${plusImg}" alt="">
                </button>

                <button class="ability-bonus-box ${has3 ? "is-on" : ""}" type="button"
                        data-action="toggle-ability-bonus" data-id="plus3:${k}"
                        aria-label="Assign +3 to ${label}" aria-pressed="${has3 ? "true" : "false"}"></button>

                <button class="ability-bonus-box ${has1 ? "is-on" : ""}" type="button"
                        data-action="toggle-ability-bonus" data-id="plus1:${k}"
                        aria-label="Assign +1 to ${label}" aria-pressed="${has1 ? "true" : "false"}"></button>
              </div>
            `;
          }).join("")}
        </div>

        <div class="summary-under-abilities">
          <div class="sheet-section-title">ATTRIBUTES</div>
          <div class="sheet-attrs">
            <div class="sheet-attr"><span>Hit Points</span><b>${calcHitPoints(chEff)}</b></div>
            <div class="sheet-attr"><span>Armour Class</span><b>${calcArmourClass(chEff)}</b></div>
            <div class="sheet-attr"><span>Initiative</span><b>${fmtSigned(mod(chEff.abilities.dex))}</b></div>
            <div class="sheet-attr"><span>Movement</span><b>${calcMovement(chEff)}</b></div>
          </div>

          <div class="sheet-section-title" style="margin-top:10px">PROFICIENCIES</div>
          <div class="sheet-muted">${formatProficiencies(ch.proficiencies)}</div>
        </div>
      </div>

      <div class="summary-right">
        ${renderLevelBoxes()}
      </div>
    </div>
  `;


  // (Left nav removed; stageTabsDock handles navigation.)
  // ------------------------------
  // Design Mode: expose a small, movable layout for the editor.
  // This does NOT change the runtime UI in normal mode.
  // ------------------------------
  // Absolute layout defaults (pixel-based). This is now the permanent layout system.
  const defaultLayoutRows = [
    { ScreenId: "radial", ComponentId: "radial.pane",    Type: "block", ParentId: "", X: 24,  Y: 24,  W: 760, H: 760, Z: 10, Enabled: true, BindingId: "", PropsJson: "{}", StyleJson: "{}", VisibilityJson: "" },
    { ScreenId: "radial", ComponentId: "radial.summary", Type: "block", ParentId: "", X: 820, Y: 24,  W: 520, H: 760, Z: 20, Enabled: true, BindingId: "", PropsJson: "{}", StyleJson: "{}", VisibilityJson: "" },
    { ScreenId: "radial", ComponentId: "radial.picker",  Type: "block", ParentId: "", X: 220, Y: 120, W: 920, H: 700, Z: 90, Enabled: true, BindingId: "", PropsJson: "{}", StyleJson: "{}", VisibilityJson: "" },
  ];

  if (typeof window !== "undefined") {
    window.__HBCR_LAST_LAYOUT__ = defaultLayoutRows;
    window.__HBCR_LAST_ZONES__ = [];
  }

  const getLayoutRows = () => {
    const draft = (design ? readDesignDraft() : null);
    const draftRows = Array.isArray(draft?.UILayout) ? draft.UILayout : null;
    const rows = (draftRows && draftRows.length)
      ? draftRows.filter(r => String(r?.ScreenId || "") === "radial")
      : defaultLayoutRows;
    return rows;
  };

  const styleFor = (componentId) => {
    const rows = getLayoutRows();
    const row = rows.find(r => String(r?.ComponentId) === String(componentId));
    const n = (v, f=0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : f;
    };
    const px = (v) => `${Math.round(n(v, 0))}px`;
    if (!row) return "position:absolute;left:24px;top:24px;z-index:10";
    return `position:absolute;left:${px(row.X)};top:${px(row.Y)};width:${px(row.W)};height:${px(row.H)};z-index:${Math.round(n(row.Z, 10))}`;
  };

  const wrapComponent = (componentId, innerHtml) => {
    // Always wrap: absolute layout is the permanent renderer.
    const extraClass = componentId === "radial.pane" ? "radial-pane" : (componentId === "radial.summary" ? "radial-summary" : (componentId === "radial.picker" ? "radial-overlay" : ""));
    return `
      <div class="hbcr-ui-wrap ${extraClass}" data-ui-component="${escapeHtml(componentId)}" style="${styleFor(componentId)}">
        ${innerHtml}
      </div>
    `;
  };

  const pickerHtml = await renderPickerDrawer(state);

  return `
    <div class="radial-shell" style="position:relative;">
      ${wrapComponent("radial.pane", `
          ${stageTabsDock}
          ${
          ${levelStripDock}
          <div class="build-panel" style="margin-top:10px">
            <div class="sheet-section-title">CLASS AT THIS LEVEL</div>
            <select class="sheet-select" data-action="set-build-class" data-level="${Number(ui.buildLevel ?? 1)}"
                    style="width:100%;margin-top:6px;">
              <option value="">— Select Class —</option>
              ${classes.map(c => {
                const tl = ch.build?.timeline?.[Number(ui.buildLevel ?? 1)-1] || {};
                const sel = String(tl.classId || "") === String(c.id) ? "selected" : "";
                return `<option value="${escapeHtml(c.id)}" ${sel}>${escapeHtml(c.name)}</option>`;
              }).join("")}
            </select>

            <div class="sheet-section-title" style="margin-top:12px;">SUBCLASS</div>
            ${(() => {
              const lvl = Number(ui.buildLevel ?? 1);
              const idx = Math.max(0, Math.min(11, lvl - 1));
              const timeline = ch.build?.timeline || [];
              const tl = timeline[idx] || {};
              const clsId = tl.classId || "";
              const scMap = subclassesIndex.get(clsId);
              const scList = scMap ? Array.from(scMap.values()) : [];

              if (!clsId) {
                return `
                  <select class="sheet-select" data-action="set-build-subclass" data-level="${lvl}"
                          disabled
                          style="width:100%;margin-top:6px;opacity:.6;pointer-events:none;">
                    <option value="">— Select Subclass —</option>
                  </select>
                `;
              }

              // Subclass locking rule:
              // first occurrence of class = subclass selectable
              // later occurrences = locked to the first subclass choice
              const firstIdx = timeline.findIndex(t => String(t?.classId || "") === String(clsId));
              const isLocked = firstIdx >= 0 && idx !== firstIdx;
              const firstSubclassId = firstIdx >= 0 ? String(timeline[firstIdx]?.subclassId || "") : "";
              const effectiveSubclassId = isLocked ? firstSubclassId : String(tl.subclassId || "");

              return `
                <select class="sheet-select" data-action="set-build-subclass" data-level="${lvl}"
                        ${isLocked ? "disabled" : ""}
                        style="width:100%;margin-top:6px;${isLocked ? "opacity:.6;pointer-events:none;" : ""}">
                  <option value="">— Select Subclass —</option>
                  ${scList.map(s => {
                    const sel = String(effectiveSubclassId || "") === String(s.id) ? "selected" : "";
                    return `<option value="${escapeHtml(s.id)}" ${sel}>${escapeHtml(s.name)}</option>`;
                  }).join("")}
                </select>
                ${isLocked ? `<div class="sheet-muted" style="margin-top:6px;">Locked to subclass chosen at character level ${firstIdx+1}.</div>` : ``}
              `;
            })()}

            ${(() => {
              const charLvl = Number(ui.buildLevel ?? 1);
              const timeline = ch.build?.timeline || [];
              const entry = timeline[charLvl-1] || {};
              const classId = entry.classId || "";
              const subclassId = (() => {
                if (!classId) return "";
                for (let k = charLvl - 1; k >= 0; k--) {
                  const e = timeline[k];
                  if (!e) continue;
                  if (String(e.classId || "") !== String(classId)) continue;
                  if (e.subclassId) return String(e.subclassId);
                }
                return "";
              })();

              const classLevel = classId
                ? timeline.slice(0, charLvl).filter(e => (e?.classId || "") === classId).length
                : 0;
              const subclassObj = classId && subclassId ? (subclassesIndex.get(classId)?.get(subclassId) || null) : null;
              return `
                <div style="margin-top:10px;opacity:.9;font-size:12px;">
                  ${classId ? `${escapeHtml((classMap.get(classId)?.name || classId))} Class Level: <b>${classLevel}</b>` : ""}
                </div>
                <!-- Picks (this level) moved to the top-right dock -->
                ${(() => {
                  let feats = featureNamesAtLevel(classId, subclassObj, classLevel || 1);

                  // Also show Race/Subrace features when editing Level 1.
                  if (Number(buildLevel) === 1) {
                    const raceId = String(ch.race || "").trim();
                    const subraceId = String(ch.subrace || "").trim();
                    const raceFeats = [
                      ...getFeatures("race", raceId, 1),
                      ...getFeatures("subrace", subraceId, 1),
                    ].filter(Boolean);

                    const merged = [];
                    for (const n of [...raceFeats, ...feats]) {
                      const nm = String(n || "").trim();
                      if (nm && !merged.includes(nm)) merged.push(nm);
                    }
                    feats = merged;
                  }
                  if (!feats.length) return ``;
                  return `
                    <div style="margin-top:12px">
                      <div class="sheet-section-title">FEATURES (THIS LEVEL)</div>
                      <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
                        ${feats.map(n => `
                          <div style="padding:10px 12px;border-radius:14px;border:1px solid rgba(255,215,128,0.12);background:rgba(0,0,0,0.18);opacity:.95;">
                            ${escapeHtml(n)}
                          </div>
                        `).join("")}
                      </div>
                    </div>
                  `;
                })()}
              `;
            })()}
          </div>
          
          ${stage !== "build" ? `
          <div class="radial-stage-overlay" style="position:absolute;inset:0;z-index:6000;pointer-events:auto;">
            <div style="position:absolute;inset:0;background:rgba(0,0,0,0.18);"></div>
            <button type="button" class="radial-overlay-close"
                    data-action="radial-nav" data-id="build"
                    style="position:absolute;top:10px;right:10px;z-index:6002;width:34px;height:34px;border-radius:12px;
                           border:1px solid rgba(255,215,128,0.25);background:rgba(0,0,0,0.45);color:rgba(255,235,190,0.92);
                           cursor:pointer;">
              ✕
            </button>
            <div style="position:absolute;inset:0;padding:96px 18px 18px 18px;z-index:6001;">

          <div class="radial-stage" data-stage="${escapeHtml(stage)}" data-race="${escapeHtml(ch.race ?? "")}" style="position:relative;z-index:1;">
            <div class="radial-center">
              <div class="radial-center-title">${escapeHtml(centerTitle)}</div>
              ${centerSubtitle ? `<div class="radial-center-sub">${escapeHtml(centerSubtitle)}</div>` : ``}
            </div>
            ${renderOrbit(orbitOptions)}
          </div>
          
            </div>
          </div>
          ` : ``}
        `)}

      ${wrapComponent("radial.summary", sheet)}
      ${wrapComponent("radial.picker", pickerHtml)}
    </div>
    `;
}