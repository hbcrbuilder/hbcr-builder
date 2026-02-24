import { loadData } from "../data/liveData.js";

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadMetamagic(){
  try{
    let data = await loadData("./data/metamagic.json", "Metamagic", (rows) => rows);
    // Back-compat: if the sheet doesn't have a Metamagic tab, fall back to Choices and filter.
    if (!Array.isArray(data) || data.length === 0) {
      const all = await loadData("./data/choices.json", "Choices", (rows) => rows);
      if (Array.isArray(all)) {
        data = all.filter(r => String(r?.pickType || r?.PickType || "").toLowerCase().includes("metamagic"));
      }
    }
    if(Array.isArray(data)) return data;
    if(Array.isArray(data?.metamagic)) return data.metamagic;
    return [];
  }catch(e){
    return [];
  }
}

function matchesFilters(m, f){
  const q = (f.search ?? "").trim().toLowerCase();
  if(!q) return true;
  const hay = `${m?.name||m?.label||""} ${m?.desc||m?.description||""}`.toLowerCase();
  return hay.includes(q);
}

function sortMetamagic(list){
  return [...list].sort((a,b)=>String(a?.name||a?.label||a?.id||"")
    .localeCompare(String(b?.name||b?.label||b?.id||"")));
}

function filterBar(f){
  // Inline live-filter so search works even when the app re-renders with innerHTML.
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
          const hay = (c.getAttribute('data-hay')||'').toLowerCase();
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

export async function MetamagicScreen({ state }) {
  const metasAll = await loadMetamagic();

  const buildLevel = Math.max(1, Math.min(12, Number(
    state.ui?.picker?.level ||
    state.ui?.radial?.buildLevel ||
    state.character.level ||
    1
  )));

  const need = Math.max(0, Number(state.ui?.picker?.need || 0));

  const timeline = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const entry = timeline[Math.max(0, Math.min(11, buildLevel - 1))] || {};
  const picks = entry.picks || {};
  const picked = Array.isArray(picks.metamagic)
    ? picks.metamagic
    : (picks.metamagic ? [picks.metamagic] : []);

  // Prevent duplicates across earlier levels: hide metamagics already chosen before this buildLevel.
  const prevPicked = new Set();
  for(let i=0;i<Math.max(0, buildLevel-1);i++){
    const e = timeline[i];
    const arr = Array.isArray(e?.picks?.metamagic)
      ? e.picks.metamagic
      : (e?.picks?.metamagic ? [e.picks.metamagic] : []);
    for(const id of arr) prevPicked.add(String(id));
  }

  const subtitle = need > 0 ? `Pick ${need} (${picked.length}/${need})` : "Choose metamagic";

  const f = { search: (state.ui?.metamagicFilters?.search ?? "") };

  const universe = (metasAll || []).filter(m => m && m.id && !prevPicked.has(String(m.id)));
  const filtered = sortMetamagic(universe.filter(m => matchesFilters(m, f)));

  const rows = filtered.map(m => {
    const id = String(m.id);
    const name = m.name || m.label || id;
    const descRaw = (m.desc || m.description || "");
    const cost = Number(m.cost || 0);

    const isOn = picked.includes(id);
    const disabled = need > 0 && !isOn && picked.length >= need;

    const hay = `${name} ${descRaw} ${cost ? `SP ${cost}` : ''}`.replace(/"/g, "&quot;");
    const nm  = `${name}`.replace(/"/g, "&quot;");
    const ds  = `${descRaw}`.replace(/"/g, "&quot;");

    // Match your existing asset strategy (same as src/ui/abilityIcons.js).
    const iconPath = `./src/assets/icons/metamagic/${id}.png`;
    const iconHtml = `
      <img class="icon-img" src="${iconPath}" alt=""
           onerror="this.style.display='none'; const fb=this.nextElementSibling; if(fb) fb.style.display='inline';">
      <span class="icon-fallback" style="display:none;">✨</span>
    `;

    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-hay="${hay}" data-name="${nm}" data-desc="${ds}"
              data-action="toggle-metamagic-lvl" data-id="${escapeHtml(id)}|${buildLevel}|${need}"
              ${disabled ? "disabled" : ""}>
        <div class="card-top compact-row-top">
          <div class="icon sm">${iconHtml}</div>
          <div class="card-copy">
            <div class="label">${escapeHtml(name)}${cost ? ` <span class=\"muted\" style=\"margin-left:10px\">SP ${escapeHtml(cost)}</span>` : ""}</div>
            <div class="desc">${escapeHtml(descRaw)}</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  const ok = need === 0 ? true : picked.length === need;

  return `
    <div class="screen picker-screen">
      <div class="h1">Metamagic</div>
      <div class="h2">Level ${buildLevel} • ${subtitle}</div>

      ${filterBar(f)}

      <div class="mini-muted" data-role="mini-muted" data-total="${universe.length}">Showing ${filtered.length}/${universe.length}</div>

      <div class="grid grid-rows" style="margin-top:14px">
        ${rows || `<div class="muted">No metamagic options found.</div>`}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build" ${ok ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
}
