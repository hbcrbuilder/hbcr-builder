// src/data/liveData.js
const BUNDLE_URL = "https://hbcr-api.hbcrbuilder.workers.dev/api/bundle";

let _bundlePromise = null;

async function fetchBundle() {
  // If you ever inject it globally, support that too:
  if (typeof window !== "undefined" && window.__HBCR_BUNDLE) return window.__HBCR_BUNDLE;

  const url = `${BUNDLE_URL}?t=${Date.now()}`; // cache-bust so "disable cache" behaves predictably
  const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`Bundle fetch failed: ${res.status}`);
  return await res.json();
}

export async function getBundle() {
  if (!_bundlePromise) _bundlePromise = fetchBundle();
  return _bundlePromise;
}

/**
 * loadData(path, sheetName, transform?)
 * - Prefer Worker bundle[sheetName]
 * - Fall back to local JSON at `path`
 */
export async function loadData(path, sheetName, transform) {
  // 1) Try Worker bundle first
  try {
    const b = await getBundle();
    const rows = b?.[sheetName];

    if (Array.isArray(rows)) {
      return transform ? transform(rows) : rows;
    }

    // Support { ok:true, sheet:"X", rows:[...] } shapes too
    if (rows?.rows && Array.isArray(rows.rows)) {
      return transform ? transform(rows.rows) : rows.rows;
    }
  } catch (e) {
    // ignore and fall back to local
  }

  // 2) Fall back to local file
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) return [];
  const j = await res.json();

  // handle either raw array or {rows:[...]}
  const rows = Array.isArray(j) ? j : (Array.isArray(j?.rows) ? j.rows : []);
  return transform ? transform(rows) : rows;
}