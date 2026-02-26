import { loadPickListItems } from "../data/pickListItems.js";

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBuildLevel(state){
  return Math.max(1, Math.min(12, Number(
    state.ui?.picker?.level ||
    state.ui?.radial?.buildLevel ||
    state.character?.level ||
    1
  )));
}

function getPickedAtLevel(state, key){
  const buildLevel = getBuildLevel(state);
  const tl = Array.isArray(state.character?.build?.timeline) ? state.character.build.timeline : [];
  const entry = tl[Math.max(0, Math.min(11, buildLevel - 1))] || {};
  const picks = entry.picks || {};
  return (picks[key] ?? state.character?.[key] ?? null);
}

function filterBar(total){
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
          const name = (c.getAttribute('data-name')||'').toLowerCase();
          const desc = (c.getAttribute('data-desc')||'').toLowerCase();
          const ok = !q || hay.includes(q);
          c.style.display = ok ? '' : 'none';
          if(ok) shown++;

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
          const tot = Number(mm.getAttribute('data-total')||${total});
          mm.textContent = 'Showing ' + shown + '/' + tot;
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

export async function SabotageMatrixScreen({ state }) {
    const buildLevel = getBuildLevel(state);
  const selected = String(getPickedAtLevel(state, "sabotageMatrix") ?? "");
  const need = Math.max(0, Number(state.ui?.picker?.need || 0)) || 1;
  const subtitle = `Level ${buildLevel} • Pick ${need} (${selected ? 1 : 0}/${need})`;

  const items = await loadPickListItems("sabotage_matrix");
  const options = items.map(it => ({
    id: it.id,
    label: it.label,
    icon: it.icon,
    desc: it.desc
  }));

const rows = options.map(o => {
    const isOn = selected === o.id;
    const hay = `${o.label} ${o.desc || ""}`.replace(/"/g, "&quot;");
    const nm  = `${o.label}`.replace(/"/g, "&quot;");
    const ds  = `${o.desc || ""}`.replace(/"/g, "&quot;");
    const iconHtml = o.icon
      ? `<span class="icon-emoji">${escapeHtml(o.icon)}</span>`
      : `<span class="icon-fallback"></span>`;

    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-hay="${hay}" data-name="${nm}" data-desc="${ds}"
              data-action="select-sabotageMatrix" data-id="${escapeHtml(o.id)}">
        <div class="card-top compact-row-top">
          <div class="icon sm">${iconHtml}</div>
          <div class="card-copy">
            <div class="label">${escapeHtml(o.label)}</div>
            ${o.desc ? `<div class="desc">${escapeHtml(o.desc)}</div>` : ``}
          </div>
        </div>
      </button>
    `;
  }).join("");

  return `
    <div class="screen picker-screen">
      <div class="h1">Sabotage Matrix</div>
      <div class="h2">Choose sabotage</div>

      ${(options.length >= 25 ? filterBar(options.length) : "")}
      <div class="mini-muted" data-role="mini-muted" data-total="${options.length}">Showing ${options.length}/${options.length}</div>

      <div class="grid grid-rows" style="margin-top:14px">
        ${rows}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build">Done</button>
      </div>
    </div>
  `;
}
