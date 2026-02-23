async function loadFeats() {
  const res = await fetch("./data/feats.json", { cache: "no-store" });
  return res.json();
}

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sortByName(list){
  return [...list].sort((a,b)=>String(a?.name||"").localeCompare(String(b?.name||"")));
}

function filterBar(f){
  // NOTE: no backticks in the inline handler (choice.js bug) — keep this plain.
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

          let grp = 9;
          if(!q) grp = 0;
          else {
            const name = (c.getAttribute('data-name')||'').toLowerCase();
            const desc = (c.getAttribute('data-desc')||'').toLowerCase();
            if(name.startsWith(q)) grp = 0;
            else if(name.includes(q)) grp = 1;
            else if(desc.includes(q)) grp = 2;
          }

          meta.push({ el: c, ok, grp, name: (c.getAttribute('data-name')||'') });
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
            <input class="search" placeholder="Search…" value="${(f.search ?? "").replace(/\"/g,'&quot;')}" oninput="${oninput.replace(/\"/g,'&quot;')}" />
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function FeatsScreen({ state }) {
  const buildLevel = Math.max(1, Math.min(12, Number(state.ui?.radial?.buildLevel || state.character.level || 1)));
  const timeline = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const slot = timeline[buildLevel - 1] || {};

  const picked = Array.isArray(slot?.picks?.feats) ? slot.picks.feats : (slot?.picks?.feat ? [slot.picks.feat] : []);
  const selectedId = picked[0] || null;

  const data = await loadFeats();
  const feats = data?.feats ?? [];

  const f = { search: (state.ui?.featFilters?.search ?? "") };
  const q = (f.search ?? "").trim().toLowerCase();
  const filtered = sortByName(feats.filter(ft => {
    if(!q) return true;
    const hay = `${ft?.name || ""} ${ft?.description || ""}`.toLowerCase();
    return hay.includes(q);
  }));

  const rows = filtered.map((ft) => {
    const isOn = selectedId === ft.id;
    const hay = `${ft?.name || ""} ${ft?.description || ""}`.replace(/\"/g, "&quot;");
    const nm  = `${ft?.name || ""}`.replace(/\"/g, "&quot;");
    const ds  = `${ft?.description || ""}`.replace(/\"/g, "&quot;");

    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-hay="${hay}" data-name="${nm}" data-desc="${ds}"
              data-action="select-feat" data-id="${escapeHtml(ft.id)}">
        <div class="card-top compact-row-top">
          <div class="card-copy">
            <div class="label">${escapeHtml(ft.name)}</div>
            <div class="desc">${escapeHtml(ft.description || "")}</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  return `
    <div class="screen picker-screen">
      <div class="h1">Feat</div>
      <div class="h2">Level ${buildLevel} • Pick 1 ${selectedId ? "(1/1)" : "(0/1)"}</div>

      ${filterBar(f)}

      <div class="mini-muted" data-role="mini-muted" data-total="${feats.length}">Showing ${filtered.length}/${feats.length}</div>

      <div class="grid grid-rows" style="margin-top:14px">
        ${rows || `<div style="opacity:.8">No feats available.</div>`}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build" ${selectedId ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
}
