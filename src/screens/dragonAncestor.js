import { loadData } from "../data/liveData.js";

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\'/g, "&#39;");
}

function normLower(s){
  return String(s ?? "").trim().toLowerCase();
}

function getBuildLevel(state){
  return Math.max(1, Math.min(12, Number(
    state.ui?.picker?.level ||
    state.ui?.radial?.buildLevel ||
    state.character?.level ||
    1
  )));
}

function getSelected(state){
  const buildLevel = getBuildLevel(state);
  const tl = Array.isArray(state.character?.build?.timeline) ? state.character.build.timeline : [];
  const entry = tl[Math.max(0, Math.min(11, buildLevel - 1))] || {};
  return (
    entry?.picks?.dragonAncestor ??
    state.character?.dragonAncestor ??
    null
  );
}

function iconHtml(iconName){
  const name = String(iconName ?? "").trim();
  if(!name) return `<span class="icon-fallback">◈</span>`;
  const src = `./assets/icons/draconic_ancestor/${name}.png`;
  return `
    <img src="${escapeHtml(src)}" alt=""
         style="width:38px;height:38px;object-fit:contain;filter: drop-shadow(0 6px 12px rgba(0,0,0,0.35));"
         onerror="this.style.display='none'; const fb=this.nextElementSibling; if(fb) fb.style.display='inline';">
    <span class="icon-fallback" style="display:none;">◈</span>
  `;
}

async function loadDragonAncestorRows(){
  const rows = await loadData("./data/picklistitems.json", "PickListItems", (r) => r);
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : []);

  const filtered = list
    .filter((r) => normLower(r?.PickType ?? r?.pickType) === "dragon_ancestor")
    .map((r) => {
      const id = String(r?.ItemId ?? r?.itemId ?? r?.id ?? "").trim();
      const label = String(r?.Label ?? r?.label ?? id).trim();
      const icon = r?.Icon ?? r?.icon;
      const sort = Number(r?.Sort ?? r?.sort ?? 0);
      return { id, label, icon, sort };
    })
    .filter((o) => o.id);

  filtered.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.label.localeCompare(b.label));
  return filtered;
}

function filterBar(){
  // Inline live-filter so search works without store changes.
  const oninput = `
    (function(el){
      try{
        const root = el.closest('.picker-screen');
        if(!root) return;
        const q = (el.value||'').toLowerCase().trim();
        const cards = Array.from(root.querySelectorAll('.grid-rows .card.compact-row'));
        let shown = 0;
        for(const c of cards){
          const hay = (c.getAttribute('data-hay')||'').toLowerCase();
          const ok = !q || hay.includes(q);
          c.style.display = ok ? '' : 'none';
          if(ok) shown++;
        }
        const mm = root.querySelector('[data-role="mini-muted"]');
        if(mm){
          const total = Number(mm.getAttribute('data-total')||cards.length||0);
          mm.textContent = 'Showing ' + shown + '/' + total;
        }
      }catch(_e){}
    })(this)
  `;

  return `
    <div class="filter-bar">
      <div class="search">
        <span class="search-ico">🔎</span>
        <input type="text" placeholder="Search..." oninput="${oninput}">
      </div>
    </div>
  `;
}

export async function DragonAncestorScreen({ state }){
  const buildLevel = getBuildLevel(state);

  const selected = getSelected(state);
  const universe = await loadDragonAncestorRows();

  const need = 1;
  const picked = selected ? [selected] : [];
  const ok = picked.length >= need;

  const rows = universe.map((o) => {
    const isOn = selected === o.id;
    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-hay="${escapeHtml((o.label + " " + o.id).toLowerCase())}"
              data-name="${escapeHtml(o.label)}"
              data-desc=""
              data-action="select-dragonAncestor"
              data-id="${escapeHtml(o.id)}">
        <div class="card-top compact-row-top">
          <div class="icon sm">${iconHtml(o.icon)}</div>
          <div class="card-copy">
            <div class="label">${escapeHtml(o.label)}</div>
            <div class="desc muted">Choose your draconic ancestry.</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  return `
    <div class="screen picker-screen">
      <div class="h1">Dragon Ancestor</div>
      <div class="h2">Level ${buildLevel} • Pick ${need} (${picked.length}/${need})</div>

      ${filterBar()}

      <div class="mini-muted" data-role="mini-muted" data-total="${universe.length}">Showing ${universe.length}/${universe.length}</div>

      <div class="grid grid-rows" style="margin-top:14px">
        ${rows || `<div class="muted">No dragon ancestor options found.</div>`}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build" ${ok ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
}
