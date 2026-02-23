import { resolveAllowedPassiveIds } from "../passives/passiveListResolver.js";
import { loadData } from "../data/liveData.js";

async function loadPassives(){
  try{
    const json = await loadData("./data/passives.json", "Passives", (rows) => rows);

    // Sheet exports may wrap rows; normalize to a flat array and normalize keys.
    const rows = Array.isArray(json)
      ? json
      : (json?.passives || json?.rows || json?.data || json?.items || []);

    if (!Array.isArray(rows)) return [];

    return rows.map((p) => {
      const id = String(p?.id ?? p?.PassiveId ?? "").trim();
      const name = String(p?.name ?? p?.Name ?? "").trim();
      const text = String(
        p?.text ?? p?.Text ?? p?.description ?? p?.Description ?? p?.desc ?? p?.Desc ?? ""
      ).trim();

      return { ...p, id, name, text };
    }).filter(p => p.id && p.name);
  }catch{
    return [];
  }
}

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sortPassives(list){
  return [...list].sort((a,b) => String(a.name||"").localeCompare(String(b.name||"")));
}

function filterBar(f){
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
            <input class="search" placeholder="Search…" value="${(f.search ?? "").replace(/"/g,'&quot;')}" oninput="${oninput.replace(/"/g,'&quot;')}" />
          </div>
        </div>
      </div>
    </div>
  `;
}

function classLevelAt(timeline, buildLevel, classId){
  if (!classId) return 0;
  return (timeline || []).slice(0, buildLevel).filter(e => (e?.classId || "") === classId).length;
}

export async function PassivesScreen({ state }) {
  const all = await loadPassives();

  const buildLevel = Math.max(1, Math.min(12, Number(state.ui?.picker?.level || state.ui?.radial?.buildLevel || state.character.level || 1)));
  const timeline = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const slot = timeline[buildLevel - 1] || {};
  const classId = slot.classId || "";
  const clsLevel = classLevelAt(timeline, buildLevel, classId);

  const need = (state.ui?.picker?.need != null ? Number(state.ui.picker.need) : 0);
  const picked = Array.isArray(slot?.picks?.passives) ? slot.picks.passives : [];

  // Passives always pull from the CLASS passive list (not subclass).
  const allowed = await resolveAllowedPassiveIds({
    ownerType: "class",
    ownerId: classId,
    universe: all,
  });
  const passives = allowed ? all.filter(p => allowed.has(p.id)) : all;

  const f = { search: (state.ui?.passiveFilters?.search ?? "") };
  const q = (f.search ?? "").trim().toLowerCase();
  const filtered = sortPassives(passives.filter(p => {
    if(!q) return true;
    const hay = `${p.name} ${p.text}`.toLowerCase();
    return hay.includes(q);
  }));

  const rows = filtered.map(p => {
    const isOn = picked.includes(p.id);
    const disabled = need > 0 && !isOn && picked.length >= need;

    const hay = `${p.name} ${p.text}`.replace(/"/g, "&quot;");
    const nm  = `${p.name}`.replace(/"/g, "&quot;");
    const ds  = `${p.text}`.replace(/"/g, "&quot;");

    return `
      <button class="card compact-row ${isOn ? "selected" : ""}"
              data-hay="${hay}" data-name="${nm}" data-desc="${ds}"
              data-action="toggle-passive-lvl" data-id="${escapeHtml(p.id)}|${buildLevel}|${need}"
              ${disabled ? "disabled" : ""}>
        <div class="card-top compact-row-top">
          <div class="card-copy">
            <div class="label">${escapeHtml(p.name)}</div>
            <div class="desc">${escapeHtml(p.text)}</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  const ok = need === 0 ? true : picked.length === need;

  if (!classId) {
    return `
      <div class="screen picker-screen">
        <div class="h1">Passives</div>
        <div class="h2">Level ${buildLevel} • Select a class for this level first</div>
        <div style="opacity:.8;margin-top:14px">No class selected at this build level.</div>
        <div class="bottom-nav">
          <button class="btn" data-action="return-build">Back to Level</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="screen picker-screen">
      <div class="h1">Passives</div>
      <div class="h2">Level ${buildLevel} • Pick ${need} (${picked.length}/${need})</div>

      ${filterBar(f)}

      <div class="mini-muted" data-role="mini-muted" data-total="${passives.length}">Showing ${filtered.length}/${passives.length}</div>

      <div class="grid grid-rows" style="margin-top:14px">
        ${rows || `<div style="opacity:.8">No passives found. (Did you import the Passives tabs from the sheet?)</div>`}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build" ${ok ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
}
