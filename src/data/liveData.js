
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

async function fetchBundle() {
  const res = await fetch(`${BUNDLE_URL}?t=${Date.now()}`, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bundle fetch failed: ${res.status}`);
  const json = await res.json();
  // CMS Full Preview:
  // Only apply local draft overrides when preview is explicitly enabled.
  // This prevents stale experimental rows (e.g. a "test" Race) from
  // appearing for users who still have old drafts in localStorage.
  try {
    const params = new URLSearchParams(window.location?.search || "");
    const wantsPreview = params.get("cmsPreview") === "1";
    const enabled = localStorage.getItem("hbcr_cms_apply_preview") === "1";
    if (wantsPreview && enabled) {
      const raw =
        localStorage.getItem("hbcr_cms_draft_v3") ||
        localStorage.getItem("hbcr_cms_draft_v2") ||
        localStorage.getItem("hbcr_cms_draft_v1");
      if (raw) {
        const draft = JSON.parse(raw);
        applyCmsDraftOverrides(json, draft);
      }
    }
  } catch {}
  return json;
}

// Map sheet -> id key (matches CMS)
const __CMS_ID_KEYS__ = {
  Races: "RaceId",
  Subraces: "SubraceId",
  Classes: "ClassId",
  Subclasses: "SubclassId",
  Spells: "SpellId",
  Cantrips: "SpellId",
  Feats: "FeatId",
  Traits: "TraitId",
  Equipment: "EquipmentId",
  Weapons: "WeaponId",
  ClassFeatures: "FeatureId",
};

function applyCmsDraftOverrides(bundle, draft){
  if(!bundle || typeof bundle !== 'object' || !draft || typeof draft !== 'object') return;
  const perSheet = {};
  for(const k of Object.keys(draft)){
    const parts = String(k).split('::');
    if(parts.length < 2) continue;
    const sheet = parts[0];
    const id = parts.slice(1).join('::');
    (perSheet[sheet] ||= {})[id] = draft[k];
  }
  for(const sheet of Object.keys(perSheet)){
    const rows = bundle[sheet];
    if(!Array.isArray(rows)) continue;
    const idKey = __CMS_ID_KEYS__[sheet];
    if(!idKey) continue;
    const map = new Map();
    for(let i=0;i<rows.length;i++){
      const r = rows[i];
      const rid = r && r[idKey];
      if(rid != null) map.set(String(rid), i);
    }
    const overrides = perSheet[sheet];
    for(const id of Object.keys(overrides)){
      const idx = map.get(String(id));
      if(idx == null){
        // new item created in CMS: append it to the sheet
        rows.push({ [idKey]: id, ...overrides[id] });
        continue;
      }
      rows[idx] = { ...rows[idx], ...overrides[id] };
    }
  }
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
  let liveSubraceRows = [];
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

    // Also pull Subraces so new subraces added in Sheets/CMS can appear in the UI.
    // Without this, only the subraces present in local races.json will show.
    const subFromBundle = b?.Subraces;
    const subSrc = Array.isArray(subFromBundle)
      ? subFromBundle
      : (Array.isArray(subFromBundle?.rows) ? subFromBundle.rows : null);
    if (subSrc) {
      liveSubraceRows = subSrc
        .map((r) => ({
          id: r?.SubraceId ?? r?.id ?? r?.Id ?? r?.ID,
          raceId: r?.RaceId ?? r?.raceId ?? r?.RaceTo ?? r?.raceTo,
          name: r?.SubraceName ?? r?.name ?? r?.Name,
          description: r?.Description ?? r?.description ?? "",
        }))
        .filter((r) => r.id && r.raceId);
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

  // 3) Merge live subraces into the merged races list
  if (liveSubraceRows.length) {
    const byRace = new Map();
    for (const sr of liveSubraceRows) {
      const rid = String(sr.raceId);
      if (!byRace.has(rid)) byRace.set(rid, []);
      byRace.get(rid).push(sr);
    }

    for (const race of merged) {
      const rid = String(race.id);
      const liveSubs = byRace.get(rid) || [];
      if (!liveSubs.length) continue;

      const existing = Array.isArray(race.subraces) ? race.subraces : [];
      const map = new Map(existing.map((s) => [String(s.id), s]));
      const byName = new Map(existing
        .filter((s)=>s && (s.name||s.Name))
        .map((s)=>{
          const n = String(s.name ?? s.Name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
          return [n, String(s.id)];
        }));

      for (const ls of liveSubs) {
        const sid = String(ls.id);
        const base = map.get(sid);
        // If ids differ between local and live, fall back to a normalized name match.
        const nk = String(ls.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        const nameMatchedId = (!base && nk && byName.has(nk)) ? byName.get(nk) : null;
        const base2 = (!base && nameMatchedId) ? map.get(String(nameMatchedId)) : base;
        if (base2) {
          // Keep local icon/rules, but allow live to update display fields.
          map.set(nameMatchedId ? String(nameMatchedId) : sid, {
            ...base2,
            id: nameMatchedId ? String(nameMatchedId) : sid,
            name: ls.name || base2.name,
            description: ls.description || base2.description,
          });
        } else {
          // Live-only subrace: show it with minimal fields.
          map.set(sid, {
            id: nameMatchedId ? String(nameMatchedId) : sid,
            name: ls.name || sid,
            description: ls.description || "",
            icon: null,
          });
        }
      }

      // Preserve ordering: existing first, then any new ones.
      const ordered = [];
      const seen = new Set();
      for (const s of existing) {
        const sid = String(s.id);
        if (seen.has(sid)) continue;
        if (map.has(sid)) {
          ordered.push(map.get(sid));
          seen.add(sid);
        }
      }
      for (const [sid, s] of map.entries()) {
        if (!seen.has(sid)) ordered.push(s);
      }

      // Final defensive de-dupe: keep first by id, then by normalized name.
      const normName = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const seenId = new Set();
      const seenName = new Set();
      const deduped = [];
      for (const s of ordered) {
        const sid = String(s?.id ?? "");
        const nk = normName(s?.name ?? s?.Name);
        if (sid && seenId.has(sid)) continue;
        if (nk && seenName.has(nk)) continue;
        if (sid) seenId.add(sid);
        if (nk) seenName.add(nk);
        deduped.push(s);
      }
      race.subraces = deduped;
    }
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
  let liveSubclassRows = [];
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

    // Also pull Subclasses so new subclasses added in Sheets/CMS can appear.
    const subFromBundle = b?.Subclasses;
    const subSrc = Array.isArray(subFromBundle)
      ? subFromBundle
      : (Array.isArray(subFromBundle?.rows) ? subFromBundle.rows : null);
    if (subSrc) {
      liveSubclassRows = subSrc
        .map((r) => ({
          id: r?.SubclassId ?? r?.id ?? r?.Id ?? r?.ID,
          classId: r?.classId ?? r?.ClassId ?? r?.ClassID,
          name: r?.SubclassName ?? r?.name ?? r?.Name,
          description: r?.Description ?? r?.description ?? "",
        }))
        .filter((r) => r.id && r.classId);
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

  // Merge live subclasses into merged classes list
  if (liveSubclassRows.length) {
    const byClass = new Map();
    for (const sc of liveSubclassRows) {
      const cid = String(sc.classId);
      if (!byClass.has(cid)) byClass.set(cid, []);
      byClass.get(cid).push(sc);
    }

    for (const cls of merged) {
      const cid = String(cls.id);
      const liveSubs = byClass.get(cid) || [];
      if (!liveSubs.length) continue;

      const existing = Array.isArray(cls.subclasses) ? cls.subclasses : [];
      const map = new Map(existing.map((s) => [String(s.id), s]));
      // Helper map: normalized name -> existing subclass id
      const byName = new Map();
      for (const s of existing) {
        const nk = String(s.name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "");
        if (nk && !byName.has(nk)) byName.set(nk, String(s.id));
      }

      for (const ls of liveSubs) {
        const sid = String(ls.id);
        const base = map.get(sid);
        // If ids differ between local and live, fall back to a normalized name match.
        const nk = String(ls.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        const nameMatchedId = !base && nk && byName.has(nk) ? byName.get(nk) : null;
        const base2 = !base && nameMatchedId ? map.get(String(nameMatchedId)) : base;
        if (base2) {
          const outId = nameMatchedId ? String(nameMatchedId) : sid;
          map.set(outId, {
            ...base2,
            id: outId,
            name: ls.name || base2.name,
            description: ls.description || base2.description,
          });
        } else {
          const outId = nameMatchedId ? String(nameMatchedId) : sid;
          map.set(outId, {
            id: outId,
            name: ls.name || sid,
            description: ls.description || "",
            icon: null,
          });
        }
      }

      const ordered = [];
      const seen = new Set();
      for (const s of existing) {
        const sid = String(s.id);
        if (seen.has(sid)) continue;
        if (map.has(sid)) {
          ordered.push(map.get(sid));
          seen.add(sid);
        }
      }
      for (const [sid, s] of map.entries()) {
        if (!seen.has(sid)) ordered.push(s);
      }

      // Final defensive de-dupe (by id then normalized name)
      const normName = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const seenId = new Set();
      const seenName = new Set();
      const deduped = [];
      for (const s of ordered) {
        const sid = String(s?.id ?? "");
        const nk = normName(s?.name ?? s?.Name);
        if (sid && seenId.has(sid)) continue;
        if (nk && seenName.has(nk)) continue;
        if (sid) seenId.add(sid);
        if (nk) seenName.add(nk);
        deduped.push(s);
      }
      cls.subclasses = deduped;
    }
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