import { resolveAbilityIcon } from "../ui/abilityIcons.js";
import { resolveAllowedAbilityIds } from "../spells/spellListResolver.js";
import { loadData } from "../data/liveData.js";

let _spellsAllPromise = null;
async function loadSpells(){
  if (_spellsAllPromise) return _spellsAllPromise;
  _spellsAllPromise = (async () => {
    try{
      const data = await loadData("./data/spells.json", "Spells", (rows) => rows);
      return Array.isArray(data) ? data : (data?.spells || []);
    }catch(e){
      return [];
    }
  })();
  return _spellsAllPromise;
}

function matchesFilters(spell, f){
  const q = (f.search ?? "").trim().toLowerCase();
  if (!q) return true;
  const hay = `${spell.name} ${spell.text}`.toLowerCase();
  return hay.includes(q);
}

function sortSpells(list){
  return [...list].sort((a,b) => a.name.localeCompare(b.name));
}

function filterBar(kind, f){
  // Inline live-filter so search works even when picker content is created after
  // initial event wiring (innerHTML re-render).
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

function isSubclassId(subclassId, needle){
  return (subclassId ?? "").toLowerCase().includes(needle);
}

function getSpellPickCount(character){
  const cls = character.class;
  const sub = character.subclass;

  // Full casters learn 2 spells each level.
  if (["cleric","druid","sorcerer","warlock","wizard"].includes(cls)) return 2;

  // Bard: 1 spell per level, except Lore gets 2.
  if (cls === "bard") return isSubclassId(sub, "lore") ? 2 : 1;

  // Half casters: 1 spell per level.
  if (["artificer","paladin","ranger"].includes(cls)) return 1;

  // Subclass casters (treated as half-casters for spells known).
  if (cls === "fighter" && isSubclassId(sub, "ldritch")) return 1;
  if (cls === "rogue" && isSubclassId(sub, "rcane")) return 1;
  if (cls === "barbarian" && (isSubclassId(sub, "wild") || isSubclassId(sub, "magic"))) return 1;
  if (cls === "monk" && isSubclassId(sub, "arcane")) return 1;

  return 0;
}

export async function SpellsScreen({ state }) {
  const spellsAll = await loadSpells();

  // Enforce class/subclass spell list restrictions unless ListOverride=any.
  const allowed = await resolveAllowedAbilityIds({
    kind: "spells",
    ownerType: state.ui?.picker?.ownerType,
    ownerId: state.ui?.picker?.ownerId,
    listOverride: state.ui?.picker?.listOverride,
    universe: spellsAll,
  });
  const spells = allowed ? spellsAll.filter(s => allowed.has(s.id)) : spellsAll;

  const buildLevel = Math.max(1, Math.min(12, Number(state.ui?.picker?.level || state.ui?.radial?.buildLevel || state.character.level || 1)));
  const timeline = Array.isArray(state.character.build?.timeline) ? state.character.build.timeline : [];
  const slot = timeline[buildLevel - 1] || {};
  const classId = slot.classId || "";
  const clsLevel = (timeline || []).slice(0, buildLevel).filter(e => (e?.classId || "") === classId).length;

  // IMPORTANT (data-driven rule):
  // If the Build panel launched this picker via a pick card, it will pass the
  // exact required count from LevelFlows/Choices in ui.picker.need.
  // That count must be treated as the source of truth to avoid UI mismatches.
  const uiNeedRaw = state.ui?.picker?.need;

  // Prefer sheet-driven picker.need if present; fall back to progression/legacy
  // ONLY when the picker is opened outside of the Build pick cards.
  let need = Number.isFinite(Number(uiNeedRaw)) ? Math.max(0, Number(uiNeedRaw)) : 0;

  if (!Number.isFinite(Number(uiNeedRaw))) {
    // Prefer class progression data if available, otherwise fall back to legacy rules.
    try {
      if (classId) {
        const res = await fetch(`./data/class_progression/${classId}.json`, { cache: "no-store" });
        if (res.ok) {
          const prog = await res.json();
          const sc = prog?.spellcasting || null;
          if (sc?.spellsKnownByLevel) {
            const now = Number(sc.spellsKnownByLevel?.[String(clsLevel)] ?? 0);
            const prev = Number(sc.spellsKnownByLevel?.[String(Math.max(0, clsLevel - 1))] ?? 0);
            need = Math.max(0, now - prev);
          } else {
            need = getSpellPickCount({ ...state.character, class: classId, subclass: slot.subclassId || state.character.subclass });
          }
        } else {
          need = getSpellPickCount({ ...state.character, class: classId, subclass: slot.subclassId || state.character.subclass });
        }
      }
    } catch {
      need = getSpellPickCount({ ...state.character, class: classId, subclass: slot.subclassId || state.character.subclass });
    }
  }

  const picked = Array.isArray(slot?.picks?.spells) ? slot.picks.spells : [];

  // Search-only, always A→Z
  const f = { search: (state.ui?.spellFilters?.search ?? "") };
  const filtered = sortSpells(spells.filter(s => matchesFilters(s, f)));

  const cards = filtered.map((s) => {
    const isOn = picked.includes(s.id);
    const disabled = need > 0 && !isOn && picked.length >= need;
    const hay = `${s.name} ${s.text}`.replace(/"/g,'&quot;');
    const nm = `${s.name}`.replace(/"/g,'&quot;');
    const ds = `${s.text}`.replace(/"/g,'&quot;');
    return `
      <button class="card compact-row ${isOn ? "selected" : ""}" data-hay="${hay}" data-name="${nm}" data-desc="${ds}" data-action="toggle-spell-lvl" data-id="${s.id}|${buildLevel}|${need}" ${disabled ? "disabled" : ""}>
        <div class="card-top compact-row-top">
          <div class="icon sm">${((_)=>{
  const ic = resolveAbilityIcon(s.name);
  return ic
    ? `<img class="icon-img" src="${ic}" alt="" onerror="this.remove()">`
    : "";
})()}</div>

          <div class="card-copy">
            <div class="label">${s.name}</div>
            <div class="desc">${s.text}</div>
          </div>
        </div>
      </button>
    `;
  }).join("");

  const ok = need === 0 ? true : picked.length === need;

  return `
    <div class="screen picker-screen">
      <div class="h1">Spells</div>
      ${need === 0
        ? `<div class="h2">Level ${buildLevel} • No spells gained at this level</div>`
        : `<div class="h2">Level ${buildLevel} • Pick ${need} (${picked.length}/${need})</div>`
      }

      ${filterBar("spells", f)}

      <div class="mini-muted" data-role="mini-muted" data-total="${spells.length}">Showing ${filtered.length}/${spells.length}</div>

      <div class="grid grid-rows" style="margin-top:14px">
        ${cards}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build" ${ok ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
}
