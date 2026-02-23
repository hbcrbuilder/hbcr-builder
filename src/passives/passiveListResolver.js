// Resolve which passives are available for a given class.
//
// Uses sheet-driven exports:
//   - data/passive_lists.json (or passiveLists.json)
//   - data/passive_list_owners.json (or passiveListOwners.json)
//
// If exports are missing or incomplete, we allow everything (keeps UI usable).

let cachePromise = null;

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

async function loadPassiveListData() {
  if (cachePromise) return await cachePromise;

  cachePromise = (async () => {
    const lists = await tryFetchJson(["./data/passive_lists.json", "./data/passiveLists.json"]);
    const owners = await tryFetchJson(["./data/passive_list_owners.json", "./data/passiveListOwners.json"]);

    // passive_lists.json can be either:
    //  - { lists: { "<listId>": ["<passiveId>", ...], ... } }
    //  - { "<listId>": [..], ... }
    //  - [ { passiveListId: "...", passiveId: "..." }, ... ]
    let listMap = null;
    if (lists) {
      if (Array.isArray(lists)) {
        listMap = {};
        for (const r of lists) {
          const lid = String(r?.passiveListId ?? r?.PassiveListId ?? r?.listId ?? r?.ListId ?? "").trim();
          const pid = String(r?.passiveId ?? r?.PassiveId ?? r?.Passive ?? r?.Id ?? "").trim();
          if (!lid || !pid) continue;
          (listMap[lid] ||= []).push(pid);
        }
      } else if (lists?.lists && typeof lists.lists === "object") {
        listMap = lists.lists;
      } else if (typeof lists === "object") {
        listMap = lists;
      }
    }

    // owners can be either:
    //  - { owners: [ ... ] }
    //  - [ ... ]
    let ownerRows = null;
    if (owners) {
      ownerRows = Array.isArray(owners) ? owners : (owners?.owners || owners?.rows || owners?.data || null);
      if (!Array.isArray(ownerRows)) ownerRows = null;
    }

    // de-dupe listMap rows
    if (listMap && typeof listMap === "object") {
      for (const k of Object.keys(listMap)) {
        const raw = listMap[k];
        if (!Array.isArray(raw)) continue;
        const uniq = Array.from(new Set(raw.map(x => String(x||"").trim()).filter(Boolean)));
        listMap[k] = uniq;
      }
    }

    return { listMap, ownerRows };
  })();

  return await cachePromise;
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function resolveListIdFromOwners(ownerRows, ownerType, ownerId) {
  if (!Array.isArray(ownerRows)) return null;
  const ot = norm(ownerType);
  const oid = norm(ownerId);
  for (const r of ownerRows) {
    const rot = norm(r?.ownerType ?? r?.OwnerType);
    const roid = norm(r?.ownerId ?? r?.OwnerId);
    if (!rot || !roid) continue;
    if (rot === ot && roid === oid) {
      const lid = r?.passiveListId ?? r?.PassiveListId ?? r?.listId ?? r?.ListId;
      const s = String(lid ?? "").trim();
      return s ? s : null;
    }
  }
  return null;
}

export async function resolveAllowedPassiveIds({ ownerType, ownerId, universe }) {
  const { listMap, ownerRows } = await loadPassiveListData();

  const listId = resolveListIdFromOwners(ownerRows, ownerType, ownerId);
  if (!listId) return null; // no mapping => allow everything

  if (!listMap) return null; // can't restrict without lists content

  const raw = listMap[String(listId)] || listMap[listId] || null;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  // Universe mapping: allow IDs OR names in sheet.
  const idSet = new Set();
  const nameToId = new Map();
  const slugToId = new Map();

  const out = new Set();

  const slugify = (s) => {
    s = String(s || "").trim().toLowerCase();
    s = s.replace(/[’']/g, "");
    s = s.replace(/[^a-z0-9]+/g, "-");
    s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
    return s;
  };

  if (Array.isArray(universe)) {
    for (const a of universe) {
      const id = String(a?.id ?? a?.PassiveId ?? "").trim();
      const name = String(a?.name ?? a?.Name ?? "").trim();
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
  return s.split(/[\n\r,;]+/g).map(x => x.trim()).filter(Boolean);
};
  const missing = [];

  for (const cell of raw) {
    for (const entry of splitEntry(cell)) {
      if (idSet.size && idSet.has(entry)) { out.add(entry); continue; }
      const byName = nameToId.get(norm(entry));
      if (byName) { out.add(byName); continue; }
      const bySlug = slugToId.get(slugify(entry));
      if (bySlug) { out.add(bySlug); continue; }
      if (!idSet.size) out.add(entry);
      else missing.push(entry);
    }
  }

  if (missing.length) {
    console.warn(`[passiveListResolver] Unmatched passives for ${ownerType}:${ownerId} (list ${listId}):`, missing.slice(0, 50));
  }

  return out.size ? out : null;
}
