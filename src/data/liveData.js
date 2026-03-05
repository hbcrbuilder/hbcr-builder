
// ===============================
// HBCR API base (Worker)
// ===============================
const HBCR_WORKER_BASE = (typeof window !== "undefined" && window.__HBCR_WORKER_BASE__)
  ? String(window.__HBCR_WORKER_BASE__).replace(/\/$/, "")
  : "https://hbcr-api.hbcrbuilder.workers.dev";

function hbcrApi(path) {
  const p = String(path || "");
  if (p.startsWith("http")) return p;
  return HBCR_WORKER_BASE + (p.startsWith("/") ? p : ("/" + p));
}

// src/data/liveData.js

const BUNDLE_URL = "https://hbcr-api.hbcrbuilder.workers.dev/api/bundle";

// cache the bundle in-memory
let _bundlePromise = null;

// ===============================
// CMS Preview Overlay (Easy Mode)
// ===============================
// When the Content Editor runs with the Builder embedded behind it, we allow a LOCAL
// (browser-only) overlay of a single edited/added row so the maintainer can verify
// the UI before pasting TSV into Google Sheets.
//
// Enabled only when:
//  - URL includes ?cmsPreview=1
//  - localStorage.hbcr_cms_apply_preview === "1"
const CMS_DRAFT_KEY = "hbcr_cms_draft_v3";
const CMS_APPLY_KEY = "hbcr_cms_apply_preview";

function cmsPreviewEnabled() {
  try {
    if (typeof window === "undefined") return false;
    const sp = new URLSearchParams(window.location.search || "");
    if (sp.get("cmsPreview") !== "1") return false;
    return String(localStorage.getItem(CMS_APPLY_KEY) || "0") === "1";
  } catch {
    return false;
  }
}

function readCmsDraft() {
  try {
    const raw = localStorage.getItem(CMS_DRAFT_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch {
    return {};
  }
}

// Apply local draft rows onto a fetched bundle.
// Draft keys are like: "Races::race_test"  -> row object with sheet columns.
function applyCmsDraftToBundle(bundle) {
  const draft = readCmsDraft();
  const out = { ...(bundle || {}) };

  const META = {
    Races: { idKey: "RaceId" },
    Subraces: { idKey: "SubraceId" },
    Classes: { idKey: "ClassId" },
    Subclasses: { idKey: "SubclassId" },
    Spells: { idKey: "SpellId" },
    Cantrips: { idKey: "CantripId" },
    Traits: { idKey: "TraitId" },
    Feats: { idKey: "FeatId" },
    ClassFeatures: { idKey: "FeatureId" },
  };

  const normId = (v) => String(v ?? "").trim();

  for (const k of Object.keys(draft)) {
    const parts = String(k).split("::");
    if (parts.length !== 2) continue;
    const sheet = parts[0];
    const idFromKey = parts[1];

    const meta = META[sheet];
    if (!meta) continue;

    const row = draft[k];
    if (!row || typeof row !== "object") continue;

    const id = normId(row[meta.idKey] ?? row.id ?? row.Id ?? idFromKey);
    if (!id) continue;

    // ensure sheet array exists
    const arr = Array.isArray(out[sheet]) ? out[sheet].slice() : [];
    // set idKey if missing
    const newRow = { ...row, [meta.idKey]: id };

    // upsert by idKey
    let replaced = false;
    for (let i = 0; i < arr.length; i++) {
      const rid = normId(arr[i]?.[meta.idKey] ?? arr[i]?.id ?? arr[i]?.Id ?? "");
      if (rid === id) {
        arr[i] = { ...arr[i], ...newRow };
        replaced = true;
        break;
      }
    }
    if (!replaced) arr.push(newRow);

    // de-dupe (keep first occurrence per id)
    const seen = new Set();
    const deduped = [];
    for (const r of arr) {
      const rid = normId(r?.[meta.idKey] ?? r?.id ?? r?.Id ?? "");
      if (!rid) continue;
      if (seen.has(rid)) continue;
      seen.add(rid);
      deduped.push(r);
    }

    out[sheet] = deduped;
  }

  return out;
}


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
  const b = await _bundlePromise;
  return cmsPreviewEnabled() ? applyCmsDraftToBundle(b) : b;
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
  // Bundle is the source of truth for what exists.
  // Local /data/races.json is cosmetic enrichment only (icons/extra fields),
  // and is NEVER treated as an additional source of rows (prevents duplicates).
  const normKey = (v) =>
    String(v ?? "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "");

  // 1) Build races + nested subraces from bundle
  let bundle = {};
  try { bundle = await getBundle(); } catch { bundle = {}; }

  const raceRows = Array.isArray(bundle?.Races)
    ? bundle.Races
    : (Array.isArray(bundle?.Races?.rows) ? bundle.Races.rows : []);

  const subraceRows = Array.isArray(bundle?.Subraces)
    ? bundle.Subraces
    : (Array.isArray(bundle?.Subraces?.rows) ? bundle.Subraces.rows : []);

  const races = raceRows
    .map(r => ({
      id: String(r?.RaceId ?? r?.id ?? r?.Id ?? r?.ID ?? "").trim(),
      name: (r?.RaceName ?? r?.name ?? r?.Name ?? "").trim(),
      icon: r?.icon ?? r?.Icon ?? r?.RaceIcon ?? r?.IconPath ?? null,
      subraces: [],
    }))
    .filter(r => r.id);

  const racesById = new Map(races.map(r => [String(r.id), r]));
  const racesByName = new Map(races.filter(r => r.name).map(r => [normKey(r.name), r]));

  // Attach subraces by RaceId
  for (const sr of subraceRows) {
    const sid = String(sr?.SubraceId ?? sr?.id ?? sr?.Id ?? sr?.ID ?? "").trim();
    if (!sid) continue;

    const raceId = String(sr?.RaceId ?? sr?.raceId ?? sr?.ParentRaceId ?? sr?.parentRaceId ?? "").trim();
    const raceName = (sr?.RaceName ?? sr?.raceName ?? "").trim();
    const parent = raceId ? racesById.get(raceId) : (raceName ? racesByName.get(normKey(raceName)) : null);
    if (!parent) continue;

    const name = (sr?.SubraceName ?? sr?.name ?? sr?.Name ?? sid).trim();
    const icon = sr?.icon ?? sr?.Icon ?? sr?.SubraceIcon ?? sr?.IconPath ?? null;

    if (!Array.isArray(parent.subraces)) parent.subraces = [];
    parent.subraces.push({ id: sid, name, icon });
  }

  // Deduplicate subraces within each race (by id primary, name secondary)
  for (const r of races) {
    const seenId = new Set();
    const seenName = new Set();
    const out = [];
    for (const sr of (r.subraces || [])) {
      const id = String(sr?.id ?? "").trim();
      const nk = sr?.name ? normKey(sr.name) : "";
      if (id && seenId.has(id)) continue;
      if (!id && nk && seenName.has(nk)) continue;
      if (id) seenId.add(id);
      if (nk) seenName.add(nk);
      out.push(sr);
    }
    r.subraces = out;
  }

  // 2) Cosmetic overlay from local /data/races.json (icons/extra fields)
  // Never add extra races; only enrich existing. Allow fallback for subraces ONLY
  // when a bundle race has zero subraces (so UI still works if Subraces sheet is empty).
  try {
    const res = await fetch("/data/races.json", { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      const local = (j && typeof j === "object") ? j : { races: [] };
      const localRaces = Array.isArray(local.races) ? local.races : [];

      const localById = new Map(localRaces.filter(x => x?.id).map(x => [String(x.id), x]));
      const localByName = new Map(localRaces.filter(x => x?.name).map(x => [normKey(x.name), x]));

      for (const r of races) {
        const lr = localById.get(String(r.id)) || (r.name ? localByName.get(normKey(r.name)) : null);
        if (!lr) continue;

        // Overlay top-level cosmetics
        for (const [k, v] of Object.entries(lr)) {
          if (k === "subraces") continue;
          if (r[k] == null && v != null) r[k] = v;
        }
        if (!r.icon && lr.icon) r.icon = lr.icon;

        // Overlay subrace cosmetics by id/name; no row creation unless bundle has none
        const localSubs = Array.isArray(lr.subraces) ? lr.subraces : [];
        if (!r.subraces || r.subraces.length === 0) {
          // fallback: if bundle has no subraces for this race, use local subraces
          r.subraces = localSubs.map(s => ({
            id: String(s?.id ?? s?.SubraceId ?? s?.subraceId ?? "").trim(),
            name: (s?.name ?? s?.SubraceName ?? s?.Name ?? "").trim(),
            icon: s?.icon ?? s?.Icon ?? null
          })).filter(s => s.id);
          continue;
        }

        const byId = new Map(r.subraces.map(s => [String(s.id), s]));
        const byName = new Map(r.subraces.filter(s => s?.name).map(s => [normKey(s.name), s]));

        for (const ls of localSubs) {
          const lid = String(ls?.id ?? ls?.SubraceId ?? ls?.subraceId ?? "").trim();
          const lname = (ls?.name ?? ls?.SubraceName ?? ls?.Name ?? "").trim();
          const target = (lid && byId.get(lid)) || (lname ? byName.get(normKey(lname)) : null);
          if (!target) continue;
          if (!target.icon && (ls.icon || ls.Icon)) target.icon = ls.icon || ls.Icon;
          for (const [k, v] of Object.entries(ls || {})) {
            if (k === "id" || k === "name") continue;
            if (target[k] == null && v != null) target[k] = v;
          }
        }
      }
    }
  } catch {}

  return { races };
}
export const loadSubracesJson = () => loadData("./data/subraces.json", "Subraces");

// Local classes.json contains icon paths used by the radial UI.
// The live bundle often omits those icon paths, so merge similarly to races.
export async function loadClassesJson() {
  let local = { classes: [] };
  try {
    const res = await fetch("/data/classes.json", { cache: "no-store" });
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
export async function loadClassesFullJson() {
  // Bundle is the source of truth for what exists.
  // Local /data/classes.full.json is cosmetic/enrichment only (icons, levels, feature text).
  const normKey = (v) =>
    String(v ?? "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "");

  let bundle = {};
  try { bundle = await getBundle(); } catch { bundle = {}; }

  const classRows = Array.isArray(bundle?.Classes)
    ? bundle.Classes
    : (Array.isArray(bundle?.Classes?.rows) ? bundle.Classes.rows : []);

  const subclassRows = Array.isArray(bundle?.Subclasses)
    ? bundle.Subclasses
    : (Array.isArray(bundle?.Subclasses?.rows) ? bundle.Subclasses.rows : []);

  const classes = classRows
    .map(r => ({
      id: String(r?.ClassId ?? r?.id ?? r?.Id ?? r?.ID ?? "").trim(),
      name: (r?.ClassName ?? r?.name ?? r?.Name ?? "").trim(),
      icon: r?.icon ?? r?.Icon ?? r?.ClassIcon ?? r?.IconPath ?? null,
      subclasses: [],
    }))
    .filter(c => c.id);

  const classesById = new Map(classes.map(c => [String(c.id), c]));
  const classesByName = new Map(classes.filter(c => c.name).map(c => [normKey(c.name), c]));

  // Attach subclasses by ClassId
  for (const sc of subclassRows) {
    const sid = String(sc?.SubclassId ?? sc?.id ?? sc?.Id ?? sc?.ID ?? "").trim();
    if (!sid) continue;

    const classId = String(sc?.ClassId ?? sc?.classId ?? sc?.ParentClassId ?? sc?.parentClassId ?? "").trim();
    const className = (sc?.ClassName ?? sc?.className ?? "").trim();
    const parent = classId ? classesById.get(classId) : (className ? classesByName.get(normKey(className)) : null);
    if (!parent) continue;

    const name = (sc?.SubclassName ?? sc?.name ?? sc?.Name ?? sid).trim();
    const description = (sc?.Description ?? sc?.desc ?? sc?.Desc ?? sc?.description ?? "").trim();
    const icon = sc?.icon ?? sc?.Icon ?? sc?.SubclassIcon ?? sc?.IconPath ?? null;

    if (!Array.isArray(parent.subclasses)) parent.subclasses = [];
    parent.subclasses.push({ id: sid, name, description, icon, levels: {} });
  }

  // Deduplicate subclasses within each class
  for (const c of classes) {
    const seenId = new Set();
    const seenName = new Set();
    const out = [];
    for (const sc of (c.subclasses || [])) {
      const id = String(sc?.id ?? "").trim();
      const nk = sc?.name ? normKey(sc.name) : "";
      if (id && seenId.has(id)) continue;
      if (!id && nk && seenName.has(nk)) continue;
      if (id) seenId.add(id);
      if (nk) seenName.add(nk);
      out.push(sc);
    }
    c.subclasses = out;
  }

  // Cosmetic/enrichment overlay from local classes.full.json
  try {
    const res = await fetch("/data/classes.full.json", { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      const local = (j && typeof j === "object")
        ? (Array.isArray(j) ? { classes: j } : j)
        : { classes: [] };

      const localClasses = Array.isArray(local.classes) ? local.classes : [];

      const localById = new Map(localClasses.filter(x => x?.id).map(x => [String(x.id), x]));
      const localByName = new Map(localClasses.filter(x => x?.name).map(x => [normKey(x.name), x]));

      for (const c of classes) {
        const lc = localById.get(String(c.id)) || (c.name ? localByName.get(normKey(c.name)) : null);
        if (!lc) continue;

        for (const [k, v] of Object.entries(lc)) {
          if (k === "subclasses") continue;
          if (c[k] == null && v != null) c[k] = v;
        }
        if (!c.icon && lc.icon) c.icon = lc.icon;

        const localSubs = Array.isArray(lc.subclasses) ? lc.subclasses : [];
        if (!c.subclasses || c.subclasses.length === 0) {
          c.subclasses = localSubs
            .map(s => ({
              id: String(s?.id ?? s?.SubclassId ?? "").trim(),
              name: (s?.name ?? s?.SubclassName ?? s?.Name ?? "").trim(),
              description: (s?.description ?? s?.Description ?? s?.desc ?? s?.Desc ?? "").trim(),
              icon: s?.icon ?? s?.Icon ?? null,
              levels: s?.levels ?? {}
            }))
            .filter(s => s.id);
          continue;
        }

        const byId = new Map(c.subclasses.map(s => [String(s.id), s]));
        const byName = new Map(c.subclasses.filter(s => s?.name).map(s => [normKey(s.name), s]));

        for (const ls of localSubs) {
          const lid = String(ls?.id ?? ls?.SubclassId ?? "").trim();
          const lname = (ls?.name ?? ls?.SubclassName ?? ls?.Name ?? "").trim();
          const target = (lid && byId.get(lid)) || (lname ? byName.get(normKey(lname)) : null);
          if (!target) continue;

          if (!target.icon && (ls.icon || ls.Icon)) target.icon = ls.icon || ls.Icon;
          if (!target.description && (ls.description || ls.Description || ls.desc || ls.Desc)) {
            target.description = (ls.description || ls.Description || ls.desc || ls.Desc || "").trim();
          }
          if ((!target.levels || Object.keys(target.levels).length === 0) && ls.levels) {
            target.levels = ls.levels;
          }
          for (const [k, v] of Object.entries(ls || {})) {
            if (k === "id" || k === "name") continue;
            if (target[k] == null && v != null) target[k] = v;
          }
        }
      }
    }
  } catch {}

  return { classes };
}

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
    const res = await fetch("/data/spells.json", { cache: "no-store" });
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
    const res = await fetch("/data/cantrips.json", { cache: "no-store" });
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