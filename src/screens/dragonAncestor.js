import { loadData } from "../data/liveData.js";

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function filterBar(f){
  // Same search bar + behavior as Spells/Metamagic.
  const oninput = `
    (function(el){
      try{
        const root = el.closest('.picker-screen');
        if(!root) return;
        const q = (el.value||'').toLowerCase().trim();
        const grid = root.querySelector('.grid-rows');
        const cards = Array.from(root.querySelectorAll('.grid-rows .card.compact-row'));
        const meta = [];
        let shown = 0;

        for(const c of cards){
          const hay  = (c.getAttribute('data-hay')||'').toLowerCase();
          const ok = !q || hay.includes(q);
          c.style.display = ok ? '' : 'none';
          if(ok) shown++;

          const name = (c.getAttribute('data-name')||'').toLowerCase();
          const desc = (c.getAttribute('data-desc')||'').toLowerCase();
          let grp = 9;
          if(!q) grp = 0;
          else if(name.startsWith(q)) grp = 0;
          else if(name.includes(q)) grp = 1;
          else if(desc.includes(q)) grp = 2;
          meta.push({ el: c, ok, grp, name });
        }

        meta.sort((a,b)=>{
          if(a.ok !== b.ok) return a.ok ? -1 : 1;
          if(a.ok){
            if(a.grp !== b.grp) return a.grp - b.grp;
          }
          return (a.name||'').localeCompare((b.name||''), undefined, { sensitivity:'base' });
        });

        if(grid){
          for(const m of meta) grid.appendChild(m.el);
        }

        const mm = root.querySelector('[data-role="mini-muted"]');
        if(mm){
          const total = Number(mm.getAttribute('data-total')||cards.length||0);
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
            <input class="search" placeholder="Search…" value="${(f.search ?? "").replace(/"/g,'&quot;')}" oninput="${oninput.replace(/"/g,'&quot;')}" />
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadDragonAncestorItems(){
  // Live mode: reads from bundle -> PickListItems. Offline/dev: local JSON fallback.
  const rows = await loadData("./data/picklistitems.json", "PickListItems", (r) => r);
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : []);

  const filtered = list
    .filter(r => normLower(r?.PickType ?? r?.pickType) === "dragon_ancestor")
    .map(r => {
      const id = String(r?.ItemId ?? r?.itemId ?? r?.id ?? "").trim();
      const label = String(r?.Label ?? r?.label ?? id).trim();
      const icon = String(r?.Icon ?? r?.icon ?? "").trim();
      const sort = Number(r?.Sort ?? r?.sort ?? 0);
      return { id, label, icon, sort };
    })
    .filter(o => o.id);

  filtered.sort((a,b)=>(a.sort||0)-(b.sort||0) || a.label.localeCompare(b.label));
  return filtered;
}

export async function DragonAncestorScreen({ state }) {
  const buildLevel = getBuildLevel(state);
  const selected = String(getSelected(state) ?? "");
  const need = 1;
  const subtitle = `Pick ${need} (${selected ? 1 : 0}/${need})`;

  const items = await loadDragonAncestorItems();
  const f = { search: (state.ui?.dragonAncestorFilters?.search ?? "") };
  const universe = items;
  const q = (f.search ?? "").trim().toLowerCase();
  const filtered = !q ? universe : universe.filter(o => `${o.label} ${o.id}`.toLowerCase().includes(q));

  const rows = filtered.map(o => {
    const isOn = selected === o.id;

    const hay = `${o.label} ${o.id}`.replace(/"/g, "&quot;");
    const nm  = `${o.label}`.replace(/"/g, "&quot;");
    const ds  = `Choose your draconic ancestry.`;

    const iconPath = `./assets/icons/draconic_ancestor/${o.icon}.png`;
    const iconHtml = `
      <img class="icon-img" src="${iconPath}" alt=""
           onerror="this.style.display='none'; const fb=this.nextElementSibling; if(fb) fb.style.display='inline';">
      <span class="icon-fallback" style="display:none;">◈</span>
    `;

    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-hay="${hay}" data-name="${nm}" data-desc="${escapeHtml(ds)}"
              data-action="select-dragonAncestor" data-id="${escapeHtml(o.id)}">
        <div class="card-top compact-row-top">
          <div class="icon sm">${iconHtml}</div>
          <div class="card-copy">
            <div class="label">${escapeHtml(o.label)}</div>
            <div class="desc">${escapeHtml(ds)}</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  const ok = !!selected;

  return `
    <div class="screen picker-screen">
      <div class="h1">Dragon Ancestor</div>
      <div class="h2">Level ${buildLevel} • ${subtitle}</div>

      ${filterBar(f)}

      <div class="mini-muted" data-role="mini-muted" data-total="${universe.length}">Showing ${filtered.length}/${universe.length}</div>

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
