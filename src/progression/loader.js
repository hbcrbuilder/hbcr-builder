/**
 * Data loader for class progression json in /data/class_progression.
 * Keeps IO separate from resolver logic.
 */

export async function loadClassProgressions(classIds) {
  // Cache per-class loads to avoid re-fetching on every UI render.
  // This matters a lot because the builder re-renders frequently.
  const out = {};
  for (const id of classIds) {
    if (!classProgressionCache[id]) {
      classProgressionCache[id] = (async () => {
        const res = await fetch(`./data/class_progression/${id}.json`);
        if (!res.ok) throw new Error(`Failed to load class progression: ${id} (${res.status})`);
        return await res.json();
      })();
    }
    out[id] = await classProgressionCache[id];
  }
  return out;
}

export async function loadClassesFull() {
  if (!classesFullCache) {
    classesFullCache = (async () => {
      const res = await fetch(`./data/classes.full.json`);
      if (!res.ok) throw new Error(`Failed to load classes.full.json (${res.status})`);
      return await res.json();
    })();
  }
  return await classesFullCache;
}

// --- Module caches ---
const classProgressionCache = {};
let classesFullCache = null;
