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
  // Turn headers like "RaceId" or "SpellListId" into stable snake_case keys.
  const s = String(key || '').trim();
  if (!s) return '';

  // Insert underscores between camel-case boundaries.
  // e.g. RaceId -> Race_Id, SpellListId -> Spell_List_Id
  const camelSplit = s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, '$1_$2');

  return camelSplit
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

    const titleCaseFromId = (raw) => {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    const words = s
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    return words.map(w => (w ? (w[0].toUpperCase() + w.slice(1)) : '')).join(' ');
  };

  // Common field harmonization across sheet tabs.
  // Many tabs use slightly different header labels (Title vs Name, Effect vs Description, etc.).
  if (out.name == null || String(out.name).trim() === '') {
    out.name = out.title
      ?? out.trait
      ?? out.traitName
      ?? out.spell
      ?? out.spellName
      ?? out.cantrip
      ?? out.cantripName
      ?? out.feature
      ?? out.featureName
      ?? out.race
      ?? out.raceName
      ?? out.subrace
      ?? out.subraceName
      ?? out.class
      ?? out.className
      ?? out.subclass
      ?? out.subclassName
      ?? out.passive
      ?? out.passiveName
      ?? out.feat
      ?? out.featName
      ?? out.choice
      ?? out.choiceName
      ?? out.name;
  }
  if (out.description == null || String(out.description).trim() === '') {
    out.description = out.desc ?? out.effect ?? out.details ?? out.text ?? out.tooltip ?? out.description;
  }
  // Some tabs use "Text" for spells/cantrips and choice entries.
  if (out.text == null || String(out.text).trim() === '') {
    out.text = out.description ?? out.effect ?? out.details ?? out.tooltip ?? out.text;
  }
  if (out.id == null || String(out.id).trim() === '') {
    out.id = out.uuid
      ?? out.guid
      ?? out.key
      ?? out.raceId
      ?? out.subraceId
      ?? out.classId
      ?? out.subclassId
      ?? out.spellId
      ?? out.cantripId
      ?? out.featId
      ?? out.traitId
      ?? out.featureId
      ?? out.choiceId
      ?? out.passiveId
      ?? out.id;
  }

  // Friendly fallback label if the sheet row only has an id.
  if ((out.name == null || String(out.name).trim() === '') && out.id != null) {
    out.name = titleCaseFromId(out.id);
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
  const normalizeRaceId = (rid) => {
    const s = String(rid || '').trim();
    if (!s) return '';
    if (s.startsWith('half_')) return s.replace(/_/g, '-');
    return s;
  };

  const baseRaceIcon = (raceId) => {
    const rid = normalizeRaceId(raceId);
    if (!rid) return null;
    if (rid === 'half-elf') return './assets/icons/races/half-elf/halfelf.png';
    if (rid === 'half-orc') return './assets/icons/races/half-orc/halforc.png';
    return `./assets/icons/races/${rid}/${rid}.png`;
  };

  
  const normalizeSubraceTokenForAsset = (rid, sid) => {
    // sid is expected hyphenated already.
    const s = String(sid || '').trim();
    if (!rid || !s) return '';

    // Common BG3 filename tokens in this repo (no extra hyphens)
    const map = {
      elf: { 'high-elf': 'highelf', 'wood-elf': 'woodelf' },
      drow: { 'lolth-sworn': 'lolthsworn' },
      dwarf: { 'gold-dwarf': 'golddwarf', 'shield-dwarf': 'shielddwarf' },
      gnome: { 'deep-gnome': 'deepgnome', 'forest-gnome': 'forestgnome', 'rock-gnome': 'rockgnome' },
      tiefling: { 'mephistopheles': 'mephistopeles' }
    };

    if (map[rid] && map[rid][s]) return map[rid][s];

    // Half-elf icons are in /half-elf and use halfelf-<token>.png
    if (rid === 'half-elf') {
      // Sheet might provide high_elf / wood_elf / drow
      if (s === 'high-elf' || s === 'high') return 'high';
      if (s === 'wood-elf' || s === 'wood') return 'wood';
      if (s === 'drow') return 'drow';
      // If it comes as something like "half-elf-high", caller may not have stripped prefix:
      const stripped = s.replace(/^half-elf-/, '');
      return stripped;
    }

    // Otherwise, assume token already matches file naming.
    return s;
  };

  const subraceIcon = (raceId, subId) => {
    const rid = normalizeRaceId(raceId);
    const sid = String(subId || '').trim();
    if (!rid || !sid) return null;

    const token = normalizeSubraceTokenForAsset(rid, sid);
    if (!token) return null;

    if (rid === 'half-elf') return `./assets/icons/races/half-elf/halfelf-${token}.png`;

    // Default pattern used in this repo: <race>/<race>-<token>.png
    return `./assets/icons/races/${rid}/${rid}-${token}.png`;
  };

  const byRace = new Map();

  for (const r of racesRows) {
    const idRaw = ensureId(pick(r, ['id', 'raceId', 'race_id', 'raceid']));
    const id = normalizeRaceId(idRaw);
    if (!id) continue;
    byRace.set(id, {
      id,
      name: pick(r, ['name', 'race', 'raceName', 'race_name'], id),
      icon: pick(r, ['icon', 'iconPath', 'icon_path'], null) ?? baseRaceIcon(id),
      description: pick(r, ['description', 'desc'], ''),
      subraces: []
    });
  }

  for (const sr of subracesRows) {
    const raceIdRaw = ensureId(pick(sr, ['raceId', 'race', 'parentId', 'parent', 'race_id', 'raceid', 'parentid']));
    const raceId = normalizeRaceId(raceIdRaw);
    const rawId = ensureId(pick(sr, ['id', 'subraceId', 'subrace_id', 'subraceid']));
    if (!raceId || !rawId) continue;
    const race = byRace.get(raceId) || {
      id: raceId,
      name: raceId,
      icon: baseRaceIcon(raceId),
      subraces: []
    };

    // If the base race didn't exist, add it now.
    if (!byRace.has(raceId)) byRace.set(raceId, race);

    let subId = rawId;

// Strip "<race>_" prefixes from sheet IDs.
// Handles both hyphen and underscore race ids (e.g. "half-elf_" and "half_elf_").
const prefixes = [
  `${raceId}_`,
  `${raceId.replace(/-/g, "_")}_`
];
for (const pre of prefixes) {
  if (subId.startsWith(pre)) {
    subId = subId.slice(pre.length);
    break;
  }
}

// Normalize to hyphen form for internal ids.
subId = subId.replace(/_/g, '-');

    race.subraces.push({
      id: subId,
      name: pick(sr, ['name', 'subrace', 'subraceName', 'subrace_name'], subId),
      icon: pick(sr, ['icon', 'iconPath', 'icon_path'], null) ?? subraceIcon(raceId, subId),
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
          icon: pick(r, ['icon', 'iconPath', 'icon_path'], null) ?? `./assets/icons/classes/${id}/${id}.png`
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
