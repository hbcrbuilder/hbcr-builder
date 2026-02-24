import { resolveAbilityIcon } from "../ui/abilityIcons.js";
import { resolveAllowedAbilityIds } from "../spells/spellListResolver.js";
import { loadData } from "../data/liveData.js";
async function loadCantrips(){
  const data = await loadData("./data/cantrips.json", "Cantrips", (rows) => rows);
  const arr = Array.isArray(data) ? data : (data?.cantrips || []);
  // Live-sheet rows may store description under a different header; normalize to `text`.
  return (arr || []).map((c) => ({
    ...c,
    text: c?.text ?? c?.description ?? c?.desc ?? c?.effect ?? c?.details ?? "",
  }));
}

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function matchesFilters(spell, f){
  const q = (f.search ?? "").trim().toLowerCase();
  if (!q) return true;
  const hay = `${spell.name} ${spell.text}`.toLowerCase();
  return hay.includes(q);
}

function sortCantrips(list){
  return [...list].sort((a,b) => a.name.localeCompare(b.name));
}

function filterBar(f){
  // NOTE: The app re-renders via innerHTML; input listeners bound during initial load
  // won't attach to picker drawers created later. Use an inline oninput live-filter
  // so search always works without relying on global wiring.
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
          const name = (c.getAttribute('data-name')||'').toLowerCase();
          const desc = (c.getAttribute('data-desc')||'').toLowerCase();
          const hay  = (c.getAttribute('data-hay')||'').toLowerCase();

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

function getCantripPickCount(character){
  // Legacy fallback (kept for safety).
  return 2;
}

async function loadClassProgression(classId){
  if (!classId) return null;
  const res = await fetch(`./data/class_progression/${classId}.json`, { cache: "no-store" });
  if (!res.ok) return null;
  return await res.json();
}

function classLevelAt(timeline, buildLevel, classId){
  if (!classId) return 0;
  return (timeline || []).slice(0, buildLevel).filter(e => (e?.classId || "") === classId).length;
}

function deltaByLevel(map, lvl){
  const now = Number(map?.[String(lvl)] ?? 0);
  const prev = Number(map?.[String(Math.max(0, lvl-1))] ?? 0);
  return Math.max(0, now - prev);
}

export async function CantripsScreen({ state }) {
  const all = await loadCantrips();

  // Enforce class/subclass cantrip list restrictions unless ListOverride=any.
  const allowed = await resolveAllowedAbilityIds({
    kind: "cantrips",
    ownerType: state.ui?.picker?.ownerType,
    ownerId: state.ui?.picker?.ownerId,
    listOverride: state.ui?.picker?.listOverride,
    universe: all,
  });
  const cantrips = allowed ? all.filter(c => allowed.has(c.id)) : all;

  const buildLevel = Math.max(1, Math.min(12, Number(state.ui?.picker?.level || state.ui?.radial?.buildLevel || state.character.level || 1)));
  const timeline = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const slot = timeline[buildLevel - 1] || {};
  const classId = slot.classId || "";
  const clsLevel = classLevelAt(timeline, buildLevel, classId);

  const prog = await loadClassProgression(classId);
  const sc = prog?.spellcasting || null;
  const need = (state.ui?.picker?.need != null ? Number(state.ui.picker.need) : (sc?.cantripsKnownByLevel ? deltaByLevel(sc.cantripsKnownByLevel, clsLevel) : getCantripPickCount(state.character)));
  const picked = Array.isArray(slot?.picks?.cantrips) ? slot.picks.cantrips : [];

  const f = { search: (state.ui?.cantripFilters?.search ?? "") };
  const filtered = sortCantrips(cantrips.filter(c => matchesFilters(c, f)));

const rows = filtered.map(c => {
  const isOn = picked.includes(c.id);
  const disabled = need > 0 && !isOn && picked.length >= need;

  const hay = `${c.name} ${c.text}`.replace(/"/g, "&quot;");
  const nm  = `${c.name}`.replace(/"/g, "&quot;");
  const ds  = `${c.text}`.replace(/"/g, "&quot;");

  const iconHtml = (() => {
    const ic = resolveAbilityIcon(c.name);
    return ic
      ? `<img class="icon-img" src="${ic}" alt="" onerror="this.remove()">`
      : `<span class="icon-fallback"></span>`;
  })();

  return `
    <button class="card compact-row ${isOn ? "selected" : ""}"
            data-hay="${hay}" data-name="${nm}" data-desc="${ds}"
            data-action="toggle-cantrip-lvl" data-id="${c.id}|${buildLevel}|${need}"
            ${disabled ? "disabled" : ""}>
      <div class="card-top compact-row-top">
        <div class="icon sm">${iconHtml}</div>
        <div class="card-copy">
          <div class="label">${escapeHtml(c.name)}</div>
          <div class="desc">${escapeHtml(c.text)}</div>
        </div>
      </div>
    </button>
  `;
}).join("");


  const ok = need === 0 ? true : picked.length === need;

  return `
    <div class="screen picker-screen">
      <div class="h1">Cantrips</div>
      <div class="h2">Level ${buildLevel} • ${classId ? `Pick ${need} (${picked.length}/${need})` : "Select a class for this level first"}</div>

      ${(cantrips.length>=25 ? filterBar(f) : "")}

      <div class="mini-muted" data-role="mini-muted" data-total="${cantrips.length}">Showing ${filtered.length}/${cantrips.length}</div>

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