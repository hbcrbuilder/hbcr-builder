/**
 * HBCR Progression Resolver
 *
 * Purpose:
 *  - Consume normalized class progression JSON (data/class_progression/*.json)
 *  - Combine with subclass level tables from data/classes.full.json
 *  - Produce a deterministic "resolved progression" for 1–12 and multiclass.
 *
 * Notes (HBCR rules from homebrew guide):
 *  - Multiclass spell slots are earned PER CLASS and then ADDED together.
 *  - Spell slots can be used by any spellcasting class.
 *  - Warlock uses Pact slots (short rest) which we keep as a separate pool.
 *
 * This module is UI-agnostic (pure functions). No DOM, no router changes.
 */

/** @typedef {{ pdf?: string, page?: number, bbox?: [number,number,number,number], note?: string }} SourceRef */

/**
 * @typedef {Object} LevelGrantFeature
 * @property {"feature"} type
 * @property {string} id
 * @property {string} name
 * @property {string=} text
 * @property {SourceRef=} source
 */

/**
 * @typedef {Object} LevelGrantChoice
 * @property {"choice"} type
 * @property {string} id
 * @property {string} prompt
 * @property {number} count
 * @property {Array<{id:string,name:string,meta?:any}>} options
 * @property {any=} rules
 */

/**
 * @typedef {Object} LevelGrant
 * @property {string} type
 */

/**
 * @typedef {Object} Spellcasting
 * @property {"prepared"|"known"|"pact"|"half"|"third"|"none"} kind
 * @property {"int"|"wis"|"cha"=} ability
 * @property {Object<string, number[]>=} slotsByLevel        // level -> [1st..6th]
 * @property {Object<string, number>=} cantripsKnownByLevel
 * @property {Object<string, number>=} spellsKnownByLevel
 * @property {Object<string, number>=} pactSlotsByLevel
 * @property {Object<string, number>=} pactSlotLevelByLevel  // level -> slot level (1..6)
 */

/**
 * @typedef {Object} ClassProgression
 * @property {string} classId
 * @property {string} displayName
 * @property {Object<string, LevelGrant[]>} levels            // "1".."12"
 * @property {{pickLevel:number, options:string[]}=} subclass
 * @property {Spellcasting=} spellcasting
 */

/**
 * @typedef {Object} SubclassDef
 * @property {string} id
 * @property {string} name
 * @property {Object<string, string[]>} levels                // "1st".."12th" -> feature names
 */

/**
 * @typedef {Object} ResolveInput
 * @property {Array<{classId:string, level:number, subclassId?:string}>} classes
 * @property {Object<string, any>=} selections               // choiceId -> selection(s)
 */

/**
 * @typedef {Object} ResolveOutput
 * @property {number} totalLevel
 * @property {Array<LevelGrantFeature>} features
 * @property {Array<any>} pendingChoices
 * @property {{longRest: Record<number, number>, shortRest: Record<number, number>}} spellSlots
 * @property {Array<any>} perClass
 */

/** Utility */
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/** Convert "1st"/"2nd"/"10th" -> 1/2/10 */
export function ordinalToInt(ordinal) {
  const m = String(ordinal).trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Slug for stable ids */
export function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Build a lookup from classes.full.json.
 * @param {any} classesFullJson
 */
export function indexSubclasses(classesFullJson) {
  const out = new Map(); // classId -> Map(subclassId -> SubclassDef)
  const classes = classesFullJson?.classes || [];
  for (const c of classes) {
    const scMap = new Map();
    for (const sc of (c.subclasses || [])) scMap.set(sc.id, sc);
    out.set(c.id, scMap);
  }
  return out;
}

/**
 * Merge base class level grants with subclass level grants (if subclassId provided).
 * Subclass features come from classes.full.json and are converted into LevelGrantFeature / Choice grants.
 *
 * @param {ClassProgression} base
 * @param {SubclassDef | null} subclassDef
 * @returns {ClassProgression}
 */
export function withSubclass(base, subclassDef) {
  if (!subclassDef) return base;

  // Clone shallow
  const merged = {
    ...base,
    levels: { ...base.levels }
  };

  // Apply subclass feature names into matching numeric levels
  for (const [ordinal, featNames] of Object.entries(subclassDef.levels || {})) {
    const lvl = ordinalToInt(ordinal);
    if (!lvl || lvl < 1 || lvl > 12) continue;

    const grants = merged.levels[String(lvl)] ? [...merged.levels[String(lvl)]] : [];
    for (const rawName of featNames) {
      const name = String(rawName).trim();
      if (!name) continue;

      // Normalize gates used by HBCR
      if (name.toLowerCase() === "feat selection") {
        grants.push({ type: "asi_or_feat_gate", level: lvl });
        continue;
      }
      const passiveMatch = name.match(/^passive selection\s*\((\d+)\)\s*$/i);
      if (passiveMatch) {
        const count = Number(passiveMatch[1]);
        grants.push({
          type: "choice",
          id: `${base.classId}.${subclassDef.id}.passive_selection.${lvl}`,
          prompt: "Passive Selection",
          count,
          options: [], // engine/UI will populate from passives/traits data
          rules: { kind: "passive" }
        });
        continue;
      }

      // Default: feature
      grants.push({
        type: "feature",
        id: `${base.classId}.${subclassDef.id}.${slugify(name)}`,
        name
      });
    }
    merged.levels[String(lvl)] = grants;
  }

  return merged;
}

/**
 * Core resolver.
 * - Applies per-class levels 1..N
 * - Produces aggregated features + pending choices
 * - Spell slots are additive PER CLASS LEVEL (HBCR rule), with Pact slots as short-rest pool.
 *
 * @param {ResolveInput} input
 * @param {{ classProgressions: Record<string, ClassProgression>, subclassesIndex: Map<string, Map<string, SubclassDef>> }} data
 * @returns {ResolveOutput}
 */
export function resolveProgression(input, data) {
  const selections = input.selections || {};
  const classes = (input.classes || []).map(c => ({
    classId: c.classId,
    level: clamp(Number(c.level || 0), 0, 12),
    subclassId: c.subclassId || null
  }));

  const allFeatures = new Map(); // id -> feature
  const pendingChoices = [];

  // spell slots: 1..6
  const longRest = {1:0,2:0,3:0,4:0,5:0,6:0};
  const shortRest = {1:0,2:0,3:0,4:0,5:0,6:0};

  const perClass = [];

  for (const c of classes) {
    const base = data.classProgressions[c.classId];
    if (!base) {
      perClass.push({ ...c, error: `Missing progression for classId="${c.classId}"` });
      continue;
    }

    const scMap = data.subclassesIndex.get(c.classId);
    const scDef = c.subclassId && scMap ? (scMap.get(c.subclassId) || null) : null;

    const prog = withSubclass(base, scDef);
    const applied = [];
    const classPending = [];

    for (let lvl = 1; lvl <= c.level; lvl++) {
      const grants = prog.levels[String(lvl)] || [];
      for (const g of grants) {
        applied.push({ level: lvl, grant: g });

        if (g.type === "feature") {
          allFeatures.set(g.id, g);
        } else if (g.type === "choice" || g.type === "spell_choice" || g.type === "subclass_pick") {
          const choiceId = g.id || `${c.classId}.choice.${lvl}.${applied.length}`;
          const chosen = selections[choiceId];
          const satisfied = isChoiceSatisfied(g, chosen);

          if (!satisfied) {
            const pending = {
              classId: c.classId,
              subclassId: c.subclassId,
              level: lvl,
              ...g,
              id: choiceId,
              remaining: remainingCount(g, chosen)
            };
            pendingChoices.push(pending);
            classPending.push(pending);
          }
        } else if (g.type === "asi_or_feat_gate") {
          // Gate is already handled elsewhere in your engine;
          // still emit as a pending choice if not satisfied.
          const choiceId = `${c.classId}.feat_gate.${lvl}`;
          const chosen = selections[choiceId];
          const satisfied = Boolean(chosen); // expect feat id or "asi"
          if (!satisfied) {
            const pending = {
              classId: c.classId,
              subclassId: c.subclassId,
              level: lvl,
              type: "asi_or_feat_gate",
              id: choiceId,
              prompt: "Feat or Ability Score Improvement",
              count: 1,
              options: [],
              remaining: 1
            };
            pendingChoices.push(pending);
            classPending.push(pending);
          }
        }
      }
    }

    // Spell slots
    const sc = prog.spellcasting;
    let classSlotsLong = {1:0,2:0,3:0,4:0,5:0,6:0};
    let classSlotsShort = {1:0,2:0,3:0,4:0,5:0,6:0};

    if (sc) {
      // Standard long-rest slots
      if (sc.slotsByLevel && sc.slotsByLevel[String(c.level)]) {
        const arr = sc.slotsByLevel[String(c.level)];
        for (let i = 0; i < arr.length; i++) {
          const lvl = i + 1;
          const v = Number(arr[i] || 0);
          longRest[lvl] += v;
          classSlotsLong[lvl] += v;
        }
      }
      // Pact short-rest slots (warlock)
      if (sc.pactSlotsByLevel && sc.pactSlotLevelByLevel) {
        const pactCount = Number(sc.pactSlotsByLevel[String(c.level)] || 0);
        const pactLvl = Number(sc.pactSlotLevelByLevel[String(c.level)] || 0);
        if (pactCount > 0 && pactLvl >= 1 && pactLvl <= 6) {
          shortRest[pactLvl] += pactCount;
          classSlotsShort[pactLvl] += pactCount;
        }
      }
    }

    perClass.push({
      classId: c.classId,
      level: c.level,
      subclassId: c.subclassId,
      displayName: prog.displayName,
      appliedCount: applied.length,
      pendingChoices: classPending,
      spellSlots: { longRest: classSlotsLong, shortRest: classSlotsShort },
      spellcasting: sc ? summarizeSpellcasting(sc, c.level) : null
    });
  }

  const totalLevel = classes.reduce((a, c) => a + (c.level || 0), 0);

  return {
    totalLevel,
    features: Array.from(allFeatures.values()),
    pendingChoices,
    spellSlots: { longRest, shortRest },
    perClass
  };
}

/** Choice satisfaction helpers */
function isChoiceSatisfied(grant, chosen) {
  if (!grant) return true;
  if (grant.type === "subclass_pick") return Boolean(chosen);
  const cnt = Number(grant.count || 1);

  if (Array.isArray(chosen)) return chosen.length >= cnt;
  if (chosen == null) return false;
  // allow scalar choice for count=1
  return cnt <= 1;
}

function remainingCount(grant, chosen) {
  const cnt = Number(grant.count || 1);
  if (Array.isArray(chosen)) return Math.max(0, cnt - chosen.length);
  if (chosen == null) return cnt;
  return 0;
}

function summarizeSpellcasting(sc, classLevel) {
  const L = String(classLevel);
  const out = { kind: sc.kind, ability: sc.ability || null };

  if (sc.cantripsKnownByLevel) out.cantripsKnown = Number(sc.cantripsKnownByLevel[L] || 0);
  if (sc.spellsKnownByLevel) out.spellsKnown = Number(sc.spellsKnownByLevel[L] || 0);

  if (sc.slotsByLevel && sc.slotsByLevel[L]) out.longRestSlots = sc.slotsByLevel[L];
  if (sc.pactSlotsByLevel && sc.pactSlotLevelByLevel) {
    out.pactSlots = {
      slots: Number(sc.pactSlotsByLevel[L] || 0),
      slotLevel: Number(sc.pactSlotLevelByLevel[L] || 0)
    };
  }
  return out;
}
