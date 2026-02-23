// Live Google Sheet loader (Apps Script Web App) with local JSON fallback.
//
// Maintainer workflow (no-code): edit the Google Sheet → site updates automatically.
// Developer workflow: local /data/*.json still works as a fallback.

let _cfgPromise = null;

async function getLiveConfig() {
  if (_cfgPromise) return _cfgPromise;
  _cfgPromise = (async () => {
    try {
      const res = await fetch('./data/live_source.json', { cache: 'no-store' });
      if (!res.ok) return { mode: 'local' };
      const cfg = await res.json();
      if (!cfg || cfg.mode !== 'live' || !cfg.apiBase) return { mode: 'local' };
      return cfg;
    } catch {
      return { mode: 'local' };
    }
  })();
  return _cfgPromise;
}

function tryParseCell(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return v;

  // JSON-ish values embedded in sheet cells
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { return JSON.parse(s); } catch { /* ignore */ }
  }

  // Booleans
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;

  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }

  return v;
}

function toSnakeKey(key) {
  return String(key)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase();
}

function toCamelKey(snake) {
  const s = String(snake).toLowerCase();
  return s.replace(/_([a-z0-9])/g, (_, c) => String(c).toUpperCase());
}

function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    const key = String(k || '').trim();
    if (!key) continue;

    const parsed = tryParseCell(v);

    // Preserve original key (for debugging / unexpected columns)
    out[key] = parsed;

    // Add stable aliases so the UI can be case/space-insensitive.
    // e.g. "ID" -> "id"; "Race Id" -> "race_id" and "raceId".
    const snake = toSnakeKey(key);
    if (!(snake in out)) out[snake] = parsed;

    const camel = toCamelKey(snake);
    if (!(camel in out)) out[camel] = parsed;

    // Also add a pure-lowercase alias (some sheets use headers like "Name")
    const lower = String(key).trim().toLowerCase();
    if (!(lower in out)) out[lower] = parsed;
  }

  // Common field harmonization across sheet tabs.
  // Many tabs use slightly different header labels (Title vs Name, Effect vs Description, etc.).
  if (out.name == null || String(out.name).trim() === '') {
    out.name = out.title ?? out.trait ?? out.spell ?? out.feature ?? out.race ?? out.class ?? out.subclass ?? out.passive ?? out.feat ?? out.choice ?? out.name;
  }
  if (out.description == null || String(out.description).trim() === '') {
    out.description = out.desc ?? out.effect ?? out.details ?? out.text ?? out.tooltip ?? out.description;
  }
  if (out.id == null || String(out.id).trim() === '') {
    out.id = out.uuid ?? out.guid ?? out.key ?? out.id;
  }

  return out;
}

async function fetchSheetRows(apiBase, sheetName) {
  const url = `${apiBase}?sheet=${encodeURIComponent(sheetName)}&v=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status})`);
  const payload = await res.json();
  if (!payload || payload.ok !== true) {
    throw new Error(payload?.error || 'Sheet response not ok');
  }
  return (payload.rows || []).map(normalizeRow);
}

function pick(row, keys, fallback = null) {
  for (const k of keys) {
    if (row && row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  return fallback;
}

function ensureId(s) {
  return String(s || '').trim();
}

function buildRacesJson(racesRows, subracesRows) {
  const byRace = new Map();

  for (const r of racesRows) {
    const id = ensureId(pick(r, ['id', 'raceId', 'race_id', 'raceid']));
    if (!id) continue;
    byRace.set(id, {
      id,
      name: pick(r, ['name', 'race', 'raceName', 'race_name'], id),
      icon: pick(r, ['icon', 'iconPath', 'icon_path'], null),
      description: pick(r, ['description', 'desc'], ''),
      subraces: []
    });
  }

  for (const sr of subracesRows) {
    const raceId = ensureId(pick(sr, ['raceId', 'race', 'parentId', 'parent', 'race_id', 'raceid', 'parentid']));
    const id = ensureId(pick(sr, ['id', 'subraceId', 'subrace_id', 'subraceid']));
    if (!raceId || !id) continue;
    const race = byRace.get(raceId) || {
      id: raceId,
      name: raceId,
      icon: null,
      subraces: []
    };

    // If the base race didn't exist, add it now.
    if (!byRace.has(raceId)) byRace.set(raceId, race);

    // Compute an icon path that matches the repo's assets naming.
    const ridNorm = String(raceId).replace(/_/g, '-');

    // Sheet subrace ids are often like: dragonborn_black, elf_high, half_elf_high, etc.
    // We need just the subrace token for the filename (black/high/etc).
    let subToken = String(id);
    const prefixes = [
      `${raceId}_`, `${raceId}-`,
      `${ridNorm}_`, `${ridNorm}-`
    ];
    for (const p of prefixes) {
      if (subToken.startsWith(p)) { subToken = subToken.slice(p.length); break; }
    }
    subToken = subToken.replace(/_/g, '-');

    const computedIcon = (() => {
      // Half-elf files use "halfelf-<token>.png"
      if (ridNorm === 'half-elf') return `./assets/icons/races/half-elf/halfelf-${subToken}.png`;

      // Drow Lolth-Sworn filename uses no hyphen: drow-lolthsworn.png
      if (ridNorm === 'drow' && subToken === 'lolth-sworn') return './assets/icons/races/drow/drow-lolthsworn.png';

      return `./assets/icons/races/${ridNorm}/${ridNorm}-${subToken}.png`;
    })();

    race.subraces.push({
      id,
      name: pick(sr, ['name', 'subrace', 'subraceName', 'subrace_name'], id),
      icon: pick(sr, ['icon', 'iconPath', 'icon_path', 'image', 'png'], null) || computedIcon,
      description: pick(sr, ['description', 'desc'], ''),
      // Pass through any extra fields (keeps things flexible for mod updates)
      ...Object.fromEntries(Object.entries(sr).filter(([k]) => !['raceId','race','parentId','parent','id','name','icon','description'].includes(k)))
    });
}

  return {
    meta: { source: 'live-sheet' },
    races: Array.from(byRace.values())
  };
}

function buildClassesJson(classesRows) {
  return {
    classes: (classesRows || [])
      .map(r => {
        const id = ensureId(pick(r, ['id', 'classId', 'class_id', 'classid']));
        if (!id) return null;
        return {
          id,
          name: pick(r, ['name', 'class', 'className', 'class_name'], id),
          icon: pick(r, ['icon', 'iconPath', 'icon_path'], null)
        };
      })
      .filter(Boolean)
  };
}

function buildClassesFullJson(classesRows, subclassesRows) {
  const base = buildClassesJson(classesRows);
  const byId = new Map((base.classes || []).map(c => [c.id, { ...c, sourceFile: 'sheet', subclasses: [] }]));

  for (const sr of (subclassesRows || [])) {
    const classId = ensureId(pick(sr, ['classId', 'class', 'parentId', 'parent', 'class_id', 'classid', 'parentid']));
    const rawId = ensureId(pick(sr, ['id', 'subclassId', 'subclass_id', 'subclassid']));
    if (!classId || !rawId) continue;

    const cls = byId.get(classId) || {
      id: classId,
      name: classId,
      icon: null,
      sourceFile: 'sheet',
      subclasses: []
    };
    if (!byId.has(classId)) byId.set(classId, cls);

    // If the sheet already provides a full id like "sorcerer_draconic_bloodline", keep it.
    // Otherwise, compose a stable id.
    const fullId = rawId.includes('_') ? rawId : `${classId}_${rawId}`;
    cls.subclasses.push({
      id: fullId,
      name: pick(sr, ['name', 'subclass', 'subclassName', 'subclass_name'], rawId),
      levels: {},
      icon: pick(sr, ['icon', 'iconPath', 'icon_path'], null)
    });
  }

  return { classes: Array.from(byId.values()) };
}

async function fetchLocalJson(localPath) {
  const res = await fetch(localPath, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Local fetch failed (${res.status})`);
  return await res.json();
}

/**
 * Load data from the live sheet (if enabled), otherwise from local JSON.
 *
 * @param {string} localPath e.g. "./data/spells.json"
 * @param {string|null} sheetName e.g. "Spells" (tab name)
 * @param {(rows: any[]) => any} [transform] optional transform for complex files
 */
export async function loadData(localPath, sheetName, transform) {
  const cfg = await getLiveConfig();

  // Live mode: attempt sheet → fallback to local JSON
  if (cfg?.mode === 'live' && cfg?.apiBase && sheetName) {
    try {
      const rows = await fetchSheetRows(cfg.apiBase, sheetName);
      return typeof transform === 'function' ? transform(rows) : rows;
    } catch {
      // fall back
    }
  }
  return await fetchLocalJson(localPath);
}

// Convenience loaders for files that require combining multiple sheet tabs.
export async function loadRacesJson() {
  const cfg = await getLiveConfig();
  if (cfg?.mode === 'live' && cfg?.apiBase) {
    try {
      const [racesRows, subracesRows] = await Promise.all([
        fetchSheetRows(cfg.apiBase, 'Races'),
        fetchSheetRows(cfg.apiBase, 'Subraces')
      ]);
      const built = buildRacesJson(racesRows, subracesRows);
      // If the sheet returned rows but we couldn't parse any IDs, fall back to local.
      if ((racesRows?.length || subracesRows?.length) && (!built?.races || built.races.length === 0)) {
        throw new Error('Live Races/Subraces parsed empty');
      }
      return built;
    } catch {
      // fall back
    }
  }
  return await fetchLocalJson('./data/races.json');
}

export async function loadClassesJson() {
  const cfg = await getLiveConfig();
  if (cfg?.mode === 'live' && cfg?.apiBase) {
    try {
      const rows = await fetchSheetRows(cfg.apiBase, 'Classes');
      const built = buildClassesJson(rows);
      if (rows?.length && (!built?.classes || built.classes.length === 0)) {
        throw new Error('Live Classes parsed empty');
      }
      return built;
    } catch {
      // fall back
    }
  }
  return await fetchLocalJson('./data/classes.json');
}

export async function loadClassesFullJson() {
  const cfg = await getLiveConfig();
  if (cfg?.mode === 'live' && cfg?.apiBase) {
    try {
      const [classesRows, subclassesRows] = await Promise.all([
        fetchSheetRows(cfg.apiBase, 'Classes'),
        fetchSheetRows(cfg.apiBase, 'Subclasses')
      ]);
      const built = buildClassesFullJson(classesRows, subclassesRows);
      if ((classesRows?.length || subclassesRows?.length) && (!built?.classes || built.classes.length === 0)) {
        throw new Error('Live Classes/Subclasses parsed empty');
      }
      return built;
    } catch {
      // fall back
    }
  }
  return await fetchLocalJson('./data/classes.full.json');
}
