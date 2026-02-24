import { loadData } from "../data/liveData.js";
// Resolve which spells/cantrips are available for a given pick.
//
// Priority:
//  1) If listOverride === "any" => allow everything.
//  2) If data exports exist, use them:
//       - data/spell_lists.json  (or spellLists.json)
//       - data/spell_list_owners.json (or spellListOwners.json)
//  3) If exports are missing, fall back to a small owner->ListId mapping.
//     NOTE: Without spell_lists content we can't restrict by IDs, so in that case
//     we intentionally allow everything (UI stays usable).

let cachePromise = null;

const BUNDLE_URL = "https://hbcr-api.hbcrbuilder.workers.dev/api/bundle";

async function tryFetchJson(paths) {
  for (const p of paths) {
    try {
      const res = await fetch(p, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      // ignore
    }
  }
  return null;
}

async function tryFetchBundle() {
  try {
    const res = await fetch(BUNDLE_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function buildListMapFromClassColumns(rows, kind) {
  // Builds listId -> [spell/cantrip names or ids]
  // from wide-sheet rows that mark class membership with an "X".
  // Example spell row keys:
  //   "Cleric Spell List": "X", "Wizard Spell List": ""
  // Example cantrip row keys (if present):
  //   "Cleric Cantrip List": "X", ...
  const out = { "1": [], "2": [], "3": [], "4": [], "5": [] };
  if (!Array.isArray(rows) || rows.length === 0) return out;

  const valueKeyCandidates = kind === "cantrip"
    ? ["CantripId", "Cantrip", "Cantrip Name", "CantripName", "name"]
    : ["SpellId", "Spell", "Spell Name", "SpellName", "name"];

  const getValue = (r) => {
    for (const k of valueKeyCandidates) {
      const v = r?.[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };

  const keyNeedle = kind === "cantrip" ? "cantrip list" : "spell list";

  for (const r of rows) {
    const value = getValue(r);
    if (!value) continue;

    for (const [k, v] of Object.entries(r || {})) {
      const kk = String(k).toLowerCase();
      if (!kk.includes(keyNeedle)) continue;
      const mark = String(v || "").trim().toLowerCase();
      if (mark !== "x" && mark !== "true" && mark !== "1" && mark !== "yes") continue;

      // Determine which listId this column implies.
      // list 1 = cleric/paladin, 2 = druid/ranger, 3 = sorcerer, 4 = warlock, 5 = wizard
      if (kk.includes("cleric") || kk.includes("paladin")) out["1"].push(value);
      else if (kk.includes("druid") || kk.includes("ranger")) out["2"].push(value);
      else if (kk.includes("sorcerer")) out["3"].push(value);
      else if (kk.includes("warlock")) out["4"].push(value);
      else if (kk.includes("wizard")) out["5"].push(value);
    }
  }

  return out;
}

async function loadSpellListData() {
  if (cachePromise) return await cachePromise;

  cachePromise = (async () => {
    const bundle = await tryFetchBundle();

    // IMPORTANT:
    // Our local spell_lists.json is map-shaped ({lists:{...}}), not row-shaped.
    // liveData.loadData() only returns arrays of rows, so it will return [] for
    // map-shaped json files. Therefore we must fetch the raw json first.
    // When the live bundle includes SpellLists, we'll still pick that up below.
    const lists =
      (await tryFetchJson(["./data/spell_lists.json", "./data/spellLists.json"])) ??
      (await loadData("./data/spell_lists.json", "SpellLists", (rows) => rows).catch(() => null));

    const owners =
      (await loadData("./data/spell_list_owners.json", "SpellListOwners", (rows) => rows).catch(() => null)) ??
      (await tryFetchJson(["./data/spell_list_owners.json", "./data/spellListOwners.json"]));

    // spell_lists.json can be either:
    //  - { lists: { "1": ["guiding-bolt", ...], ... } }
    //  - { "1": [..], "2": [..] }
    //  - [ { listId: 1, spellId: "..." }, ... ]
    let listMap = null;
    if (lists) {
      if (Array.isArray(lists)) {
        listMap = {};
        for (const r of lists) {
          const lid = String(r?.listId ?? r?.ListId ?? r?.SpellListId ?? "").trim();
          const sid = String(r?.spellId ?? r?.SpellId ?? r?.Spell ?? "").trim();
          if (!lid || !sid) continue;
          (listMap[lid] ||= []).push(sid);
        }
      } else if (lists?.lists && typeof lists.lists === "object") {
        listMap = lists.lists;
      } else if (typeof lists === "object") {
        listMap = lists;
      }
    }

    // If we couldn't load SpellLists content (common if the live bundle doesn't include that sheet),
    // build listMap from the wide "Spells" sheet columns in the live bundle.
    const isEmptyObject = (v) =>
      v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0;

    if ((!listMap || isEmptyObject(listMap)) && bundle?.Spells) {
      listMap = buildListMapFromClassColumns(bundle.Spells, "spell");
    }

    // owners can be either:
    //  - { owners: [ ... ] }
    //  - [ ... ]
    let ownerRows = null;
    if (owners) {
      ownerRows = Array.isArray(owners) ? owners : (owners?.owners || owners?.rows || owners?.data || null);
      if (!Array.isArray(ownerRows)) ownerRows = null;
    }

    // If SpellListOwners isn't available via loadData/json, use the live bundle if present.
    if (!ownerRows && bundle?.SpellListOwners && Array.isArray(bundle.SpellListOwners)) {
      ownerRows = bundle.SpellListOwners;
    }

    return { listMap, ownerRows };
  })();

  return await cachePromise;
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    // treat underscores, dashes, spaces, punctuation all the same
    .replace(/[^a-z0-9]+/g, "");
}

function isAlwaysAny(ownerType, ownerId) {
  const ot = norm(ownerType);
  const oid = norm(ownerId);

  // Explicit design rules (these should also be true in the sheet, but this keeps
  // the app usable even if the sheet config drifts temporarily).
  if (ot === "class" && oid === "bard") return true;
  if (ot === "subclass" && oid.includes("artificerarcanist")) return true;
  if (ot === "subclass" && (oid.includes("wayofthearcane") || (oid.includes("monk") && oid.includes("arcane")))) return true;
  return false;
}

function fallbackListId(ownerType, ownerId) {
  const ot = norm(ownerType);
  const oid = norm(ownerId);

  // List 0 = all spells (no restriction)
  if (isAlwaysAny(ot, oid)) return 0;

  // Classes
  if (ot === "class") {
    if (oid === "cleric" || oid === "paladin") return 1;
    if (oid === "druid" || oid === "ranger") return 2;
    if (oid === "sorcerer") return 3;
    if (oid === "warlock") return 4;
    if (oid === "wizard") return 5;
    // Note: Bard is handled above.
  }

  // Subclasses
  if (ot === "subclass") {
    // NOTE: oid is normalized by norm() (punctuation removed), so match normalized tokens too.
    if (oid.includes("wildsoul")) return 3;
    if (oid.includes("eldritchknight")) return 4;
    if (oid.includes("arcanetrickster")) return 5;
  }

  return null;
}

function resolveListIdFromOwners(ownerRows, ownerType, ownerId) {
  if (!Array.isArray(ownerRows)) return null;
  const ot = norm(ownerType);
  const oid = norm(ownerId);
  for (const r of ownerRows) {
    const rot = norm(r?.ownerType ?? r?.OwnerType);
    const roid = norm(r?.ownerId ?? r?.OwnerId);
    const roName = norm(r?.ownerName ?? r?.OwnerName ?? r?.name ?? r?.Name);

    if (!rot) continue;

    const ownerMatches =
      (roid && roid === oid) ||
      (roName && roName === oid);

    if (rot === ot && ownerMatches) {
      const lid = r?.spellListId ?? r?.SpellListId ?? r?.listId ?? r?.ListId;
      if (lid === 0 || lid === "0") return 0;
      const n = Number(lid);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export async function resolveAllowedAbilityIds({ kind, ownerType, ownerId, listOverride, universe }) {
  // If override says any, allow everything.
  if (norm(listOverride) === "any") return null;

  // If the owner is in the always-any set, allow everything.
  if (isAlwaysAny(ownerType, ownerId)) return null;

  const { listMap, ownerRows } = await loadSpellListData();

  // If we have a concrete list mapping, use it.
  let listId = resolveListIdFromOwners(ownerRows, ownerType, ownerId);
  if (listId == null) listId = fallbackListId(ownerType, ownerId);

  // No mapping => allow everything (keeps the app usable).
  if (listId == null || listId === 0) return null;

  // Without a spell list content export, we cannot restrict.
  if (!listMap) return null;

  const raw = listMap[String(listId)] || listMap[listId] || null;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  // Build a fast lookup from the full universe (spells.json / cantrips.json)
  // so the sheet can store either ids or human-readable names.
  const idSet = new Set();
  const nameToId = new Map();
  const slugToId = new Map();

  const slugify = (s) => {
    s = String(s || "").trim().toLowerCase();
    // normalize apostrophes
    s = s.replace(/[’']/g, "");
    // replace non-alnum with hyphen
    s = s.replace(/[^a-z0-9]+/g, "-");
    s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
    return s;
  };

  if (Array.isArray(universe)) {
    for (const a of universe) {
      const id = String(a?.id || "").trim();
      const name = String(a?.name || "").trim();
      if (!id) continue;
      idSet.add(id);
      if (name) {
        nameToId.set(norm(name), id);
        slugToId.set(slugify(name), id);
      }
      slugToId.set(slugify(id), id);
    }
  }

  const splitEntry = (v) => {
    const s = String(v || "").trim();
    if (!s) return [];
    // allow multiple entries in one cell separated by comma/semicolon/newline
    return s.split(/[\n\r,;]+/g).map(x => x.trim()).filter(Boolean);
  };

  const out = new Set();
  const missing = [];

  for (const cell of raw) {
    for (const entry of splitEntry(cell)) {
      // Exact id match
      if (idSet.size && idSet.has(entry)) {
        out.add(entry);
        continue;
      }
      // Case-insensitive name match
      const byName = nameToId.get(norm(entry));
      if (byName) {
        out.add(byName);
        continue;
      }
      // Slugified match (handles punctuation / extra spaces)
      const bySlug = slugToId.get(slugify(entry));
      if (bySlug) {
        out.add(bySlug);
        continue;
      }
      // If we have no universe, best-effort keep the trimmed value
      if (!idSet.size) {
        out.add(entry);
      } else {
        missing.push(entry);
      }
    }
  }

  if (missing.length) {
    // Helpful debug without breaking the app.
    console.warn(`[spellListResolver] Unmatched ${kind} entries for ${ownerType}:${ownerId} (list ${listId}):`, missing.slice(0, 50));
  }

  return out.size ? out : null;
}