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

// Paladin Smite picker.
// NOTE: Divine Smite is granted automatically at Paladin Class Level 1 for all subclasses.
// This picker is for *additional* smites gained at later Paladin levels.
const SMITES = [
  {
    id: "blinding",
    label: "Blinding Smite",
    desc: "Radiant damage. Inflicts Blind for 3 turns.",
  },
  {
    id: "branding",
    label: "Branding Smite",
    desc: "Radiant damage. Prevents Invisibility for 3 turns. Can be used with a melee or ranged weapon.",
  },
  {
    id: "searing",
    label: "Searing Smite",
    desc: "Fire damage. Inflicts Searing for 3 turns (1d12 Fire damage).",
  },
  {
    id: "staggering",
    label: "Staggering Smite",
    desc: "Psychic damage. Staggers for 3 turns (Disadvantage on attacks/ability checks; cannot take reactions).",
  },
  {
    id: "thunderous",
    label: "Thunderous Smite",
    desc: "Thunder damage. Inflicts prone for 1 turn.",
  },
  {
    id: "wrathful",
    label: "Wrathful Smite",
    desc: "Psychic damage. Inflicts Frightened for 3 turns.",
  },
];

export function SmitesScreen({ state }) {
  const buildLevel = Math.max(1, Math.min(12, Number(state.ui?.picker?.level || state.ui?.radial?.buildLevel || state.character.level || 1)));
  const timeline = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const slot = timeline[buildLevel - 1] || {};
  const classId = slot.classId || "";

  // Count comes from resolveBuildSteps -> state.ui.picker.need.
  const need = (state.ui?.picker?.need != null ? Math.max(0, Number(state.ui.picker.need)) : 0);

  // Underlying stored list may include the auto-granted 'divine'.
  const pickedRaw = Array.isArray(slot?.picks?.smites) ? slot.picks.smites : [];
  const picked = pickedRaw.filter(x => x !== "divine");

  const rows = SMITES.map(s => {
    const isOn = picked.includes(s.id);
    const disabled = need > 0 && !isOn && picked.length >= need;

    const iconHtml = (() => {
      const ic = resolveAbilityIcon(s.label);
      return ic
        ? `<img class="icon-img" src="${ic}" alt="" onerror="this.remove()">`
        : `<span class="icon-fallback"></span>`;
    })();

    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-action="toggle-smite-lvl" data-id="${s.id}|${buildLevel}|${need}"
              ${disabled ? "disabled" : ""}>
        <div class="card-top compact-row-top">
          <div class="icon sm">${iconHtml}</div>
          <div class="card-copy">
            <div class="label">${escapeHtml(s.label)}</div>
            <div class="desc">${escapeHtml(s.desc)}</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  const ok = need === 0 ? true : picked.length === need;

  return `
    <div class="screen picker-screen">
      <div class="h1">Smites</div>
      <div class="h2">Level ${buildLevel} • ${classId ? `Pick ${need} (${picked.length}/${need})` : "Select a class for this level first"}</div>

      <div class="mini-muted" style="margin-top:10px">
        Divine Smite is granted automatically at Paladin 1. All Smites consume a Crusader's Smite charge.
      </div>

      
      ${filterBar(SMITES.length)}
      <div class="mini-muted" data-role="mini-muted" style="margin-top:10px">Showing ${SMITES.length}/${SMITES.length}</div>

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
