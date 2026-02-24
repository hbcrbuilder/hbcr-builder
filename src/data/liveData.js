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
        r.MetamagicName ?? r.DragonAncestorName ??
        r.FeatureName ?? r.FeatName ?? r.TraitName,

      // Many pickers expect a description/text field.
      // Spells/Cantrips: `text`
      // Metamagic/Traits/Feats/etc: `desc`
      text:
        r.text ??
        r.Text ??
        r.SpellText ?? r.CantripText ??
        r.Description ?? r.Desc ?? r.desc ??
        r.SpellDescription ?? r.CantripDescription ??
        "",

      desc:
        r.desc ??
        r.Desc ??
        r.Description ??
        r.MetamagicDesc ?? r.MetamagicDescription ??
        r.TraitDesc ?? r.FeatDesc ??
        r.SpellDesc ?? r.CantripDesc ??
        "",

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

      // If the bundle sheet exists but is clearly not in the expected shape
      // for certain pickers (e.g. Spells/Cantrips coming through as unrelated
      // rows), fall back to the local json.
      if (sheetName === "Spells" && norm.length && !norm.some(s => (s.name || s.SpellName) && (s.text || s.SpellText || s.Description))) {
        throw new Error("Bundle Spells sheet missing name/text");
      }
      if (sheetName === "Cantrips" && norm.length && !norm.some(s => (s.name || s.CantripName) && (s.text || s.CantripText || s.Description))) {
        throw new Error("Bundle Cantrips sheet missing name/text");
      }
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

  const normKey = (v) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  const byIdLocal = new Map((local.races || []).map((r) => [String(r.id), r]));
  const byNameLocal = new Map(
    (local.races || [])
      .filter((r) => r?.name)
      .map((r) => [normKey(r.name), r])
  );

  // Track which local entries have been represented in the merged list so we
  // don't append duplicates (e.g. local id uses '_' while live id uses '-').
  const seenLocalIds = new Set();
  const seenLiveIds = new Set();

  const merged = [];
  for (const lr of liveRows) {
    const id = String(lr.id);
    let base = byIdLocal.get(id);
    // If ids don't line up between local and live, fall back to a name match.
    if (!base && lr.name) base = byNameLocal.get(normKey(lr.name));
    if (base) {
      merged.push({
        ...base,
        // Let live override display name (but keep everything else local)
        id,
        name: lr.name || base.name,
      });
      seenLocalIds.add(String(base.id));
    } else {
      // Live-only entry: keep id/name; no icons/subraces available.
      merged.push({ id, name: lr.name || id, icon: null, subraces: [] });
    }
    seenLiveIds.add(id);
  }

  // Keep any local-only entries that weren't present in liveRows (defensive)
  for (const r of (local.races || [])) {
    const id = String(r.id);
    if (!seenLocalIds.has(id) && !seenLiveIds.has(id)) merged.push(r);
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

  const normKey = (v) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  const byIdLocal = new Map((local.classes || []).map((c) => [String(c.id), c]));
  const byNameLocal = new Map(
    (local.classes || [])
      .filter((c) => c?.name)
      .map((c) => [normKey(c.name), c])
  );

  const seenLocalIds = new Set();
  const seenLiveIds = new Set();
  const merged = [];

  for (const lr of liveRows) {
    const id = String(lr.id);
    let base = byIdLocal.get(id);
    if (!base && lr.name) base = byNameLocal.get(normKey(lr.name));
    if (base) {
      merged.push({
        ...base,
        id,
        name: lr.name || base.name,
      });
      seenLocalIds.add(String(base.id));
    } else {
      merged.push({ id, name: lr.name || id, icon: null });
    }
    seenLiveIds.add(id);
  }

  for (const c of (local.classes || [])) {
    const id = String(c.id);
    if (!seenLocalIds.has(id) && !seenLiveIds.has(id)) merged.push(c);
  }

  return { ...local, classes: merged };
}
export const loadClassesFullJson = () => loadData("./data/classesFull.json", "Classes");

export const loadSubclassesJson = () => loadData("./data/subclasses.json", "Subclasses");

// Spells/Cantrips are tightly coupled to spell list restrictions + icon mapping.
// The local jsons are the canonical source for ids/text used across the app.
// If the live bundle has updated display names we can overlay them, but we
// should never replace the local universe with bundle ids that don't match the
// resolver lists.
export async function loadSpellsJson() {
  // local canonical
  let local = { spells: [] };
  try {
    const res = await fetch("./data/spells.json", { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      local = Array.isArray(j) ? { spells: j } : (j && typeof j === "object" ? j : { spells: [] });
      if (!Array.isArray(local.spells)) local = { ...local, spells: [] };
    }
  } catch {}

  // overlay from bundle when it matches canonical ids
  try {
    const b = await getBundle();
    const src = Array.isArray(b?.Spells) ? b.Spells : (Array.isArray(b?.Spells?.rows) ? b.Spells.rows : null);
    if (src) {
      const live = src.map(r => ({
        id: r?.SpellId ?? r?.id,
        name: r?.SpellName ?? r?.name,
        text: r?.SpellText ?? r?.text ?? r?.Text ?? r?.Description ?? "",
      })).filter(x => x.id);

      const byId = new Map(live.map(x => [String(x.id), x]));
      const merged = (local.spells || []).map(s => {
        const o = byId.get(String(s.id));
        return o ? { ...s, name: o.name || s.name, text: o.text || s.text } : s;
      });
      return { ...local, spells: merged };
    }
  } catch {}

  return local;
}

export async function loadCantripsJson() {
  let local = { cantrips: [] };
  try {
    const res = await fetch("./data/cantrips.json", { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      local = Array.isArray(j) ? { cantrips: j } : (j && typeof j === "object" ? j : { cantrips: [] });
      if (!Array.isArray(local.cantrips)) local = { ...local, cantrips: [] };
    }
  } catch {}

  try {
    const b = await getBundle();
    const src = Array.isArray(b?.Cantrips) ? b.Cantrips : (Array.isArray(b?.Cantrips?.rows) ? b.Cantrips.rows : null);
    if (src) {
      const live = src.map(r => ({
        id: r?.CantripId ?? r?.id,
        name: r?.CantripName ?? r?.name,
        text: r?.CantripText ?? r?.text ?? r?.Text ?? r?.Description ?? "",
      })).filter(x => x.id);

      const byId = new Map(live.map(x => [String(x.id), x]));
      const merged = (local.cantrips || []).map(c => {
        const o = byId.get(String(c.id));
        return o ? { ...c, name: o.name || c.name, text: o.text || c.text } : c;
      });
      return { ...local, cantrips: merged };
    }
  } catch {}

  return local;
}

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