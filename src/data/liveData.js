// src/data/liveData.js

const BUNDLE_URL = "https://hbcr-api.hbcrbuilder.workers.dev/api/bundle";

// cache the bundle in-memory
let _bundlePromise = null;

async function fetchBundle() {
  const res = await fetch(`${BUNDLE_URL}?t=${Date.now()}`, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bundle fetch failed: ${res.status}`);
  return await res.json();
}

export async function getBundle() {
  if (!_bundlePromise) _bundlePromise = fetchBundle();
  return _bundlePromise;
}

// Generic loader:
// 1) Prefer bundle[sheetName] (array)
// 2) Fall back to local json file at `path`
// Supports local shapes: [] OR { ok:true, rows:[...] } OR { rows:[...] }
export async function loadData(path, sheetName, transform) {
  // 1) Prefer Worker bundle
  try {
    const b = await getBundle();
    const fromBundle = b?.[sheetName];

    // normalize Sheets-style columns (Id/Name/Icon) to UI-style (id/name/icon)
    const normalize = (arr) =>
      arr.map((r) => ({
        ...r,
        id: r.id ?? r.Id ?? r.ID,
        name: r.name ?? r.Name ?? r.Label,
        icon: r.icon ?? r.Icon,
      }));

    if (Array.isArray(fromBundle)) {
      const norm = normalize(fromBundle);
      return transform ? transform(norm) : norm;
    }

    if (fromBundle?.rows && Array.isArray(fromBundle.rows)) {
      const norm = normalize(fromBundle.rows);
      return transform ? transform(norm) : norm;
    }
  } catch (e) {
    // ignore; fall back to local file
  }

  // 2) Fallback to local file
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) return [];
  const j = await res.json();

  const rows = Array.isArray(j) ? j : (Array.isArray(j?.rows) ? j.rows : []);

  // local files might already be normalized, but normalize anyway (harmless)
  const norm = rows.map((r) => ({
    ...r,
    id: r.id ?? r.Id ?? r.ID,
    name: r.name ?? r.Name ?? r.Label,
    icon: r.icon ?? r.Icon,
  }));

  return transform ? transform(norm) : norm;
}

/**
 * ---- Compatibility exports (keep these names!) ----
 * These match what your existing modules import.
 * If you have more sheets, add another line here.
 */
export const loadRacesJson = () => loadData("./data/races.json", "Races");
export const loadSubracesJson = () => loadData("./data/subraces.json", "Subraces");
export const loadClassesJson = () => loadData("./data/classes.json", "Classes");
export const loadSpellsJson = () => loadData("./data/spells.json", "Spells");
export const loadCantripsJson = () => loadData("./data/cantrips.json", "Cantrips");
export const loadLevelFlowsJson = () => loadData("./data/levelFlows.json", "LevelFlows");
export const loadTraitsJson = () => loadData("./data/traits.json", "Traits");
export const loadFeatsJson = () => loadData("./data/feats.json", "Feats");
export const loadClassFeaturesJson = () => loadData("./data/classFeatures.json", "ClassFeatures");
export const loadRaceFeaturesJson = () => loadData("./data/raceFeatures.json", "RaceFeatures");
export const loadChoicesJson = () => loadData("./data/choices.json", "Choices");
export const loadPickListItemsJson = () => loadData("./data/pickListItems.json", "PickListItems");
export const loadClassesFullJson = () => loadData("./data/classesFull.json", "Classes");
export const loadSubclassesJson   = () => loadData("./data/subclasses.json", "Subclasses");