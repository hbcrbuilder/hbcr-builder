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
  const s = String(key || '').trim();
  if (!s) return '';

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
    const nk = toSnakeKey(k);
    if (!nk) continue;
    out[nk] = v;
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

  // Harmonize common fields
  if (out.name == null || String(out.name).trim() === '') {
    out.name =
      out.title ??
      out.trait ??
      out.trait_name ??
      out.race_name ??
      out.subrace_name ??
      out.class_name ??
      out.subclass_name ??
      out.spell_name ??
      out.cantrip_name ??
      out.feature_name ??
      out.passive_name ??
      out.feat_name ??
      out.choice_name ??
      out.name;
  }

  if (out.description == null || String(out.description).trim() === '') {
    out.description =
      out.desc ??
      out.effect ??
      out.details ??
      out.text ??
      out.tooltip ??
      out.description;
  }

  if (out.text == null || String(out.text).trim() === '') {
    out.text = out.description ?? out.effect ?? out.details ?? out.tooltip ?? out.text;
  }

  if (out.id == null || String(out.id).trim() === '') {
    out.id =
      out.uuid ??
      out.guid ??
      out.key ??
      out.race_id ??
      out.subrace_id ??
      out.class_id ??
      out.subclass_id ??
      out.spell_id ??
      out.cantrip_id ??
      out.feat_id ??
      out.trait_id ??
      out.feature_id ??
      out.choice_id ??
      out.passive_id ??
      out.id;
  }

  // Friendly label fallback
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
    // Assets + local JSON use hyphens for these
    if (s.startsWith('half_')) return s.replace(/_/g, '-');
    return s;
  };

  const normalizeSubraceToken = (raceId, rawSubId) => {
    let sid = String(rawSubId || '').trim();
    if (!sid) return '';

    // Strip "<race>_" prefix in BOTH half-elf styles:
    // raceId might be "half-elf" but sheet IDs might be "half_elf_high_elf"
    const ridHyphen = normalizeRaceId(raceId);
    const ridUnderscore = ridHyphen.replace(/-/g, '_');

    const p1 = `${ridHyphen}_`;
    const p2 = `${ridUnderscore}_`;

    if (sid.startsWith(p1)) sid = sid.slice(p1.length);
    if (sid.startsWith(p2)) sid = sid.slice(p2.length);

    // Normalize separators
    sid = sid.replace(/_/g, '-');

    // Normalize common BG3 subrace tokens -> filename tokens
    const map = {
      'high-elf': 'highelf',
      'wood-elf': 'woodelf',
      'gold-dwarf': 'golddwarf',
      'shield-dwarf': 'shielddwarf',
      'deep-gnome': 'deepgnome',
      'forest-gnome': 'forestgnome',
      'rock-gnome': 'rockgnome',
      'lolth-sworn': 'lolthsworn',
      // asset typo:
      'mephistopheles': 'mephistopeles'
    };

    return map[sid] ?? sid;
  };

  const baseRaceIcon = (raceId) => {
    const rid = normalizeRaceId(raceId);
    if (!rid) return null;
    if (rid === 'half-elf') return './assets/icons/races/half-elf/halfelf.png';
    if (rid === 'half-orc') return './assets/icons/races/half-orc/halforc.png';
    return `./assets/icons/races/${rid}/${rid}.png`;
  };

  const subraceIcon = (raceId, rawSubId) => {
    const rid = normalizeRaceId(raceId);
    const token = normalizeSubraceToken(raceId, rawSubId);
    if (!rid || !token) return null;

    if (rid === 'half-elf') {
      // Half-elf filenames: halfelf-high.png / halfelf-wood.png / halfelf-drow.png
      const map = {
        highelf: 'high',
        woodelf: 'wood',
        drow: 'drow'
      };
      const suffix = map[token] ?? token;
      return `./assets/icons/races/half-elf/halfelf-${suffix}.png`;
    }

    // Many races have BOTH forms (e.g. dwarf-gold.png and dwarf-golddwarf.png).
    // Prefer the longer token (more specific) when we normalized it.
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
    const raceIdRaw = ensureId(
      pick(sr, ['raceId', 'race', 'parentId', 'parent', 'race_id', 'raceid', 'parentid'])
    );
    const raceId = normalizeRaceId(raceIdRaw);
    const rawId = ensureId(pick(sr, ['id', 'subraceId', 'subrace_id', 'subraceid']));
    if (!raceId || !rawId) continue;

    const race = byRace.get(raceId) || {
      id: raceId,
      name: raceId,
      icon: baseRaceIcon(raceId),
      subraces: []
    };

    if (!byRace.has(raceId)) byRace.set(raceId, race);

    const subId = normalizeSubraceToken(raceId, rawId);

    race.subraces.push({
      id: subId,
      name: pick(sr, ['name', 'subrace', 'subraceName', 'subrace_name'], subId),
      icon: pick(sr, ['icon', 'iconPath', 'icon_path'], null) ?? subraceIcon(raceId, rawId),
      description: pick(sr, ['description', 'desc'], ''),
      ...Object.fromEntries(
        Object.entries(sr).filter(
          ([k]) => !['raceId', 'race', 'parentId', 'parent', 'id', 'name', 'icon', 'description'].includes(k)
        )
      )
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
