function filterBar(total){
  const oninput = `
    (function(inp){
      try{
        const root = inp.closest('.screen') || document;
        const q = (inp.value || '').toLowerCase().trim();
        const cards = Array.from(root.querySelectorAll('.grid-rows .card'));
        let shown = 0;
        for(const el of cards){
          const t = (el.textContent || '').toLowerCase();
          const ok = !q || t.includes(q);
          el.style.display = ok ? '' : 'none';
          if(ok) shown++;
        }
        const mm = root.querySelector('[data-role="mini-muted"]');
        if(mm){
          mm.textContent = 'Showing ' + shown + '/' + total;
        }
      }catch(e){}
    })(this)
  `.trim().replace(/\s+/g,' ');
  return `
    <div class="filter-panel compact">
      <div class="filter-row" style="margin-top:0">
        <div class="filter-left" style="flex:1">
          <div class="search-wrap" style="width:100%">
            <span class="search-ico">⌕</span>
            <input class="search" placeholder="Search…" oninput="${oninput.replace(/"/g,'&quot;')}" />
          </div>
        </div>
      </div>
    </div>
  `;
}

import { resolveAbilityIcon } from "../ui/abilityIcons.js";

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Ranger: Frontier Ballistics
// At Ranger class levels 1,3,5,7,9,11 pick 1 special arrow to learn.
// Stored per build level in build.timeline[level-1].picks.frontierBallistics (array).
const ARROWS = [
  { id: "aberration_slaying", label: "Arrow of Aberration Slaying", desc: "Rolls an additional damage die against Aberrations." },
  { id: "acid", label: "Arrow of Acid", desc: "Rolls an additional 1d6 acid damage and creates acid surface." },
  { id: "arcane_interference", label: "Arrow of Arcane Interference", desc: "Breaks target’s Concentration and inflicts Silence." },
  { id: "beast_slaying", label: "Arrow of Beast Slaying", desc: "Rolls an additional damage die against Beasts." },
  { id: "construct_slaying", label: "Arrow of Construct Slaying", desc: "Rolls an additional damage die against Constructs." },
  { id: "darkness", label: "Arrow of Darkness", desc: "Creates 3m/10ft radius Darkness for 3 turns." },
  { id: "dispelling", label: "Arrow of Dispelling", desc: "Casts Lesser Restoration on target." },
  { id: "elemental_slaying", label: "Arrow of Elemental Slaying", desc: "Rolls an additional damage die against Elementals." },
  { id: "fiend_slaying", label: "Arrow of Fiend Slaying", desc: "Rolls an additional damage die against Fiends." },
  { id: "fire", label: "Arrow of Fire", desc: "Rolls an additional 1d6 fire damage and creates fire surface." },
  { id: "humanoid_slaying", label: "Arrow of Humanoid Slaying", desc: "Rolls an additional damage die against Humanoids." },
  { id: "ice", label: "Arrow of Ice", desc: "Rolls an additional 1d6 ice damage and creates ice surface." },
  { id: "ilmater", label: "Arrow of Ilmater", desc: "Rolls an additional 1d6 necrotic damage and prevents healing." },
  { id: "lightning", label: "Arrow of Lightning", desc: "Rolls an additional 1d6 lightning damage." },
  { id: "many_targets", label: "Arrow of Many Targets", desc: "Arrow can strike up to two targets within 3m/10ft." },
  { id: "monstrosity_slaying", label: "Arrow of Monstrosity Slaying", desc: "Rolls an additional damage die against Monstrosities." },
  { id: "piercing", label: "Arrow of Piercing", desc: "Deals half damage to targets directly behind your initial target." },
  { id: "roaring_thunder", label: "Arrow of Roaring Thunder", desc: "Pushes target back 9m/30ft." },
  { id: "teleportation", label: "Arrow of Teleportation", desc: "Teleport to wherever arrow lands." },
  { id: "undead_slaying", label: "Arrow of Undead Slaying", desc: "Rolls an additional damage die against Undead." },
];

export function FrontierBallisticsScreen({ state }) {
  const buildLevel = Math.max(1, Math.min(12, Number(state.ui?.picker?.level || state.ui?.radial?.buildLevel || state.character.level || 1)));
  const timeline = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const slot = timeline[buildLevel - 1] || {};
  const classId = slot.classId || "";

  const need = (state.ui?.picker?.need != null ? Math.max(0, Number(state.ui.picker.need)) : 0);
  const picked = Array.isArray(slot?.picks?.frontierBallistics) ? slot.picks.frontierBallistics : [];

  const defaultIcon = resolveAbilityIcon("Frontier Ballistics") || "";

  const iconHtmlForArrow = (arrowId) => {
    const perArrow = resolveAbilityIcon(`frontierBallistics:${arrowId}`) || "";
    const src = perArrow || defaultIcon;
    if (!src) return `<span class="icon-fallback"></span>`;

    // Try per-arrow first, then fall back to the default Frontier Ballistics icon.
    // (This lets you add new arrow icons later without touching code again.)
    if (perArrow && defaultIcon) {
      return `<img class="icon-img" src="${perArrow}" alt="" onerror="this.onerror=null; this.src='${defaultIcon}';">`;
    }
    return `<img class="icon-img" src="${src}" alt="" onerror="this.remove()">`;
  };

  const rows = ARROWS.map(a => {
    const isOn = picked.includes(a.id);
    const disabled = need > 0 && !isOn && picked.length >= need;
    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-action="toggle-frontierBallistics-lvl" data-id="${a.id}|${buildLevel}|${need}"
              ${disabled ? "disabled" : ""}>
        <div class="card-top compact-row-top">
          <div class="icon sm">${iconHtmlForArrow(a.id)}</div>
          <div class="card-copy">
            <div class="label">${escapeHtml(a.label)}</div>
            <div class="desc">${escapeHtml(a.desc)}</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  const ok = need === 0 ? true : picked.length === need;

  return `
    <div class="screen picker-screen">
      <div class="h1">Frontier Ballistics</div>
      <div class="h2">Level ${buildLevel} • ${classId ? `Pick ${need} (${picked.length}/${need})` : "Select a class for this level first"}</div>

      <div class="mini-muted" style="margin-top:10px">
        Action, consumes Natural Focus charge, requires a Ranged Weapon.
        At first level and every odd level thereafter, select one special arrow to learn.
      </div>

      
      ${filterBar(ARROWS.length)}
      <div class="mini-muted" data-role="mini-muted" style="margin-top:10px">Showing ${ARROWS.length}/${ARROWS.length}</div>

      <div class="grid grid-rows" style="margin-top:14px">
        ${rows}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build" ${ok ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
}
