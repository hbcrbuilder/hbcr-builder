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
  // ---- normalizer: map Sheets column names to UI-friendly keys ----
  const normalize = (arr) =>
    arr.map((r) => ({
      ...r,

      // UI expects `id`
      id:
        r.id ??
        r.Id ?? r.ID ??
        r.RaceId ?? r.ClassId ?? r.SubraceId ?? r.SubclassId ??
        r.SpellId ?? r.CantripId ??
        r.FeatureId ?? r.FeatId ?? r.TraitId ??
        r.ChoiceId ?? r.ItemId,

      // UI expects `name`
      name:
        r.name ??
        r.Name ?? r.Label ??
        r.RaceName ?? r.ClassName ?? r.SubraceName ?? r.SubclassName ??
        r.SpellName ?? r.CantripName ??
        r.FeatureName ?? r.FeatName ?? r.TraitName,

      // UI uses `icon` when present
      // Bundle sheets aren't perfectly consistent on icon column names.
      // Support common variants so radial/choice UIs keep rendering.
      icon:
        r.icon ??
        r.Icon ??
        r.iconUrl ?? r.IconUrl ?? r.ICON_URL ??
        r.IconPath ?? r.iconPath ??
        r.RaceIcon ?? r.SubraceIcon ?? r.ClassIcon ?? r.SubclassIcon ??
        r.Image ?? r.image ??
        null,
    }));

  // 1) Prefer Worker bundle
  try {
    const b = await getBundle();
    const fromBundle = b?.[sheetName];

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

  const norm = normalize(rows);
  return transform ? transform(norm) : norm;
}

/**
 * ---- Compatibility exports (keep these names!) ----
 * These match what your existing modules import.
 */
// NOTE:
// Local races.json is richer than the live sheet: it includes nested subraces + icon paths.
// The live bundle provides id/name but often omits the nested subrace structure and icon
// asset paths required by the radial UI.
//
// So we merge: keep local icon/subrace/rules data, but let the live bundle override id/name
// when present (and append any new live-only entries).
export async function loadRacesJson() {
  // 1) Load local rich data (source of truth for icons + subrace nesting)
  let local = { races: [] };
  try {
    const res = await fetch("./data/races.json", { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      local = (j && typeof j === "object") ? j : { races: [] };
      if (!Array.isArray(local.races)) local = { ...local, races: [] };
    }
  } catch {}

  // 2) Load live rows (if available) and normalize to {id,name}
  let liveRows = [];
  try {
    const b = await getBundle();
    const fromBundle = b?.Races;
    const src = Array.isArray(fromBundle) ? fromBundle : (Array.isArray(fromBundle?.rows) ? fromBundle.rows : null);
    if (src) {
      liveRows = src
        .map((r) => ({
          id: r?.RaceId ?? r?.id ?? r?.Id ?? r?.ID,
          name: r?.RaceName ?? r?.name ?? r?.Name,
        }))
        .filter((r) => r.id);
    }
  } catch {}

  if (!liveRows.length) return local;

  const byIdLocal = new Map((local.races || []).map((r) => [String(r.id), r]));
  const seen = new Set();

  const merged = [];
  for (const lr of liveRows) {
    const id = String(lr.id);
    const base = byIdLocal.get(id);
    if (base) {
      merged.push({
        ...base,
        // Let live override display name (but keep everything else local)
        name: lr.name || base.name,
      });
    } else {
      // Live-only entry: keep id/name; no icons/subraces available.
      merged.push({ id, name: lr.name || id, icon: null, subraces: [] });
    }
    seen.add(id);
  }

  // Keep any local-only entries that weren't present in liveRows (defensive)
  for (const r of (local.races || [])) {
    const id = String(r.id);
    if (!seen.has(id)) merged.push(r);
  }

  return { ...local, races: merged };
}
export const loadSubracesJson = () => loadData("./data/subraces.json", "Subraces");

// Local classes.json contains icon paths used by the radial UI.
// The live bundle often omits those icon paths, so merge similarly to races.
export async function loadClassesJson() {
  let local = { classes: [] };
  try {
    const res = await fetch("./data/classes.json", { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      local = (j && typeof j === "object") ? j : { classes: [] };
      if (!Array.isArray(local.classes)) local = { ...local, classes: [] };
    }
  } catch {}

  let liveRows = [];
  try {
    const b = await getBundle();
    const fromBundle = b?.Classes;
    const src = Array.isArray(fromBundle) ? fromBundle : (Array.isArray(fromBundle?.rows) ? fromBundle.rows : null);
    if (src) {
      liveRows = src
        .map((r) => ({
          id: r?.ClassId ?? r?.id ?? r?.Id ?? r?.ID,
          name: r?.ClassName ?? r?.name ?? r?.Name,
        }))
        .filter((r) => r.id);
    }
  } catch {}

  if (!liveRows.length) return local;

  const byIdLocal = new Map((local.classes || []).map((c) => [String(c.id), c]));
  const seen = new Set();
  const merged = [];

  for (const lr of liveRows) {
    const id = String(lr.id);
    const base = byIdLocal.get(id);
    if (base) {
      merged.push({
        ...base,
        name: lr.name || base.name,
      });
    } else {
      merged.push({ id, name: lr.name || id, icon: null });
    }
    seen.add(id);
  }

  for (const c of (local.classes || [])) {
    const id = String(c.id);
    if (!seen.has(id)) merged.push(c);
  }

  return { ...local, classes: merged };
}
export const loadClassesFullJson = () => loadData("./data/classesFull.json", "Classes");

export const loadSubclassesJson = () => loadData("./data/subclasses.json", "Subclasses");

export const loadSpellsJson = () => loadData("./data/spells.json", "Spells");
export const loadCantripsJson = () => loadData("./data/cantrips.json", "Cantrips");

export const loadLevelFlowsJson = () => loadData("./data/levelFlows.json", "LevelFlows");
export const loadTraitsJson = () => loadData("./data/traits.json", "Traits");
export const loadFeatsJson = () => loadData("./data/feats.json", "Feats");

export const loadClassFeaturesJson = () =>
  loadData("./data/classFeatures.json", "ClassFeatures");
export const loadRaceFeaturesJson = () =>
  loadData("./data/raceFeatures.json", "RaceFeatures");

export const loadChoicesJson = () => loadData("./data/choices.json", "Choices");
export const loadPickListItemsJson = () =>
  loadData("./data/pickListItems.json", "PickListItems");