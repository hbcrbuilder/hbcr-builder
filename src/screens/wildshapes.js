function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadWildshapes(){
  try{
    const res = await fetch("./data/wildshapes.json", { cache: "no-store" });
    if(!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data?.wildshapes || []);
  }catch(e){
    return [];
  }
}

function iconHtml(ws){
  const key = ws?.iconKey;
  if(!key) return "<span class=\"icon-fallback\">🐾</span>";

  // Convention: iconKey maps to ./assets/wildshapes/<iconKey>.png
  // (You can drop your icons into assets/wildshapes and keep iconKey stable.)
  const src = `./assets/wildshapes/${encodeURIComponent(String(key))}.png`;
  return `<img class=\"icon-img\" src=\"${src}\" alt=\"\" onerror=\"this.remove()\">`;
}

export async function WildshapesScreen({ state }) {
  const wildshapes = await loadWildshapes();

  const buildLevel = Math.max(1, Math.min(12, Number(state.ui?.picker?.level || state.ui?.radial?.buildLevel || state.character.level || 1)));
  const timeline = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const slot = timeline[buildLevel - 1] || {};

  // Source-of-truth required count comes from the Build pick card.
  const need = Number.isFinite(Number(state.ui?.picker?.need)) ? Math.max(0, Number(state.ui.picker.need)) : 0;
  const picked = Array.isArray(slot?.picks?.wildshapes) ? slot.picks.wildshapes : [];

  // Wildshape choices are cumulative across levels (e.g. pick 3 at L1, then 3 new at L5, etc.).
  // So when picking at a later level, hide anything already chosen in earlier levels.
  const prevPicked = new Set();
  for (let i = 0; i < buildLevel - 1; i++) {
    const prior = timeline[i];
    const arr = Array.isArray(prior?.picks?.wildshapes) ? prior.picks.wildshapes : [];
    for (const id of arr) prevPicked.add(id);
  }

  // For now, show all wildshapes (except already-picked from earlier levels).
  // If/when you add per-subclass pools, we can filter by ws.pool based on the choice's ListOverride.
  const rows = (wildshapes || []).flatMap(ws => {
    // Hide items already chosen in previous levels (but keep any already picked at this level visible).
    if (prevPicked.has(ws.id) && !picked.includes(ws.id)) return [];

    const isOn = picked.includes(ws.id);
    const disabled = need > 0 && !isOn && picked.length >= need;
    const nm = escapeHtml(ws.name || ws.id);

    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-action="toggle-wildshape-lvl" data-id="${escapeHtml(ws.id)}|${buildLevel}|${need}"
              ${disabled ? "disabled" : ""}>
        <div class="card-top compact-row-top">
          <div class="icon sm">${iconHtml(ws)}</div>
          <div class="card-copy">
            <div class="label">${nm}</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  const ok = need === 0 ? true : picked.length === need;

  return `
    <div class="screen picker-screen">
      <div class="h1">Wildshapes</div>
      ${need === 0
        ? `<div class="h2">Level ${buildLevel} • No wildshapes gained at this level</div>`
        : `<div class="h2">Level ${buildLevel} • Pick ${need} (${picked.length}/${need})</div>`
      }

      <div class="grid grid-rows" style="margin-top:14px">
        ${rows || `<div class="mini-muted">No wildshapes found. Ensure your sheet has a Wildshapes tab and export generated data/wildshapes.json.</div>`}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build" ${ok ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
}
