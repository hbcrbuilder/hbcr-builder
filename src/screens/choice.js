export function ChoiceScreen({ title, subtitle, selectedId, options, selectAction, note, disableAll=false }) {
  const safeSubtitle = subtitle || "Make your selection";

  return `
    <div class="screen choice-panel">
      <div class="h1">${title}</div>
      <div class="h2">${safeSubtitle}</div>

      ${note ? `<div class="hint" style="margin-top:6px">${note}</div>` : ""}

      ${options.length >= 25 ? `
        <div class="filter-panel compact" style="margin-top:12px">
          <div class="filter-row" style="margin-top:0">
            <div class="filter-left" style="flex:1">
              <div class="search-wrap" style="width:100%">
                <span class="search-ico">⌕</span>
                <input class="search" placeholder="Search…" oninput="(function(el){try{const root=el.closest('.choice-panel');if(!root)return;const q=(el.value||'').toLowerCase().trim();const cards=Array.from(root.querySelectorAll('.grid .card'));let shown=0;for(const c of cards){const name=(c.getAttribute('data-name')||'').toLowerCase();const desc=(c.getAttribute('data-desc')||'').toLowerCase();const ok=!q||name.includes(q)||desc.includes(q);c.style.display=ok?'':'none';if(ok)shown++;}const mm=root.querySelector('[data-role=mini-muted]');if(mm){const total=Number(mm.getAttribute('data-total')||cards.length);mm.textContent='Showing '+shown+'/'+total;}}catch(e){}})(this)">
              </div>
            </div>
          </div>
        </div>
        <div class="mini-muted" data-role="mini-muted" data-total="${options.length}">Showing ${options.length}/${options.length}</div>
      ` : ``}

      <div class="grid">
        ${options.map(o => `
          <div class="card ${selectedId===o.id ? "selected" : ""} ${disableAll ? "disabled" : ""}"
               data-action="${selectAction}"
               data-id="${o.id}"
               ${disableAll ? 'style="pointer-events:none; opacity:.7"' : ""}>
            <div class="icon" aria-hidden="true">${o.icon ?? "◈"}</div>
            <div class="label">${o.label}</div>
            ${o.desc ? `<div class="desc">${o.desc}</div>` : ""}
          </div>
        `).join("")}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="back">Back</button>
      </div>
    </div>
  `;
}
