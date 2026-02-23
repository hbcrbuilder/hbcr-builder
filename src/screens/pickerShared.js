// Shared BG3-style picker UI for choice screens.
// Compact list on the left, full details on the right.

function esc(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function clamp(n, a, b){
  return Math.max(a, Math.min(b, n));
}

function normTags(entry){
  const t = entry?.tags ?? {};
  return {
    roles: Array.isArray(t.roles) ? t.roles : [],
    mechanics: Array.isArray(t.mechanics) ? t.mechanics : [],
    damageTypes: Array.isArray(t.damageTypes) ? t.damageTypes : []
  };
}

function pill(label){
  return `<span class="pill">${esc(label)}</span>`;
}

function renderMiniTags(entry){
  const t = normTags(entry);
  const out = [];
  if (t.mechanics.includes("concentration")) out.push(pill("⏳ Conc"));
  if (t.roles.includes("healing")) out.push(pill("✚ Heal"));
  if (t.roles.includes("buff")) out.push(pill("✨ Buff"));
  if (t.roles.includes("debuff")) out.push(pill("☠ Debuff"));
  if (t.roles.includes("control")) out.push(pill("🕸 Control"));
  if (t.roles.includes("utility")) out.push(pill("🧰 Utility"));
  if (t.roles.includes("mobility")) out.push(pill("🌀 Mobility"));
  if (t.roles.includes("summon")) out.push(pill("🐺 Summon"));
  if (t.roles.includes("damage")) {
    const d = t.damageTypes?.[0];
    out.push(pill(d ? `⚔ ${d}` : "⚔ Damage"));
  }
  return out.length ? `<div class="pill-row">${out.join("")}</div>` : "";
}

function shortText(text, max=88){
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, clamp(max, 10, 500))}…`;
}

function pickFocusId({ focusId, pickedIds, items }){
  if (focusId && items.some(x => x.id === focusId)) return focusId;
  const firstPicked = (pickedIds || []).find(id => items.some(x => x.id === id));
  if (firstPicked) return firstPicked;
  return items?.[0]?.id || "";
}

export function renderPickerLayout({
  title,
  subtitle,
  buildLevel,
  need,
  pickedIds,
  items,
  focusId,
  toggleAction,
  focusAction,
  emptyHint,
  topHtml
}){
  const picked = Array.isArray(pickedIds) ? pickedIds : [];
  const list = Array.isArray(items) ? items : [];
  const effFocus = pickFocusId({ focusId, pickedIds: picked, items: list });
  const focus = list.find(x => x.id === effFocus) || null;

  const rows = list.map((it) => {
    const isOn = picked.includes(it.id);
    const disabled = need > 0 && !isOn && picked.length >= need;
    const meta = shortText(it.text, 90);
    const toggleId = `${it.id}|${buildLevel}|${need}`;
    return `
      <button class="picker-row ${isOn ? "selected" : ""} ${it.id === effFocus ? "focused" : ""}"
              data-action="${toggleAction}" data-id="${esc(toggleId)}" ${disabled ? "disabled" : ""}>
        <div class="picker-row-top">
          <div class="picker-check" aria-hidden="true">${isOn ? "✓" : "✦"}</div>
          <div class="picker-row-main">
            <div class="picker-row-name">${esc(it.name)}</div>
            <div class="picker-row-meta">${esc(meta)}</div>
          </div>
        </div>
        ${renderMiniTags(it)}
      </button>
    `;
  }).join("");

  const pickedLabel = need > 0 ? `Pick ${need} (${picked.length}/${need})` : "No picks at this level";
  const ok = need === 0 ? true : picked.length === need;

  return `
    <div class="screen">
      <div class="h1">${esc(title)}</div>
      <div class="h2">${esc(subtitle)} • ${pickedLabel}</div>

      ${topHtml || ""}

      <div class="picker-shell">
        <div class="picker-list">
          ${list.length ? rows : `<div class="mini-muted" style="padding:12px">${esc(emptyHint || "Nothing to show")}</div>`}
        </div>
        <div class="picker-details">
          ${focus ? `
            <div class="picker-details-head">
              <div class="picker-details-title">${esc(focus.name)}</div>
              ${renderMiniTags(focus)}
            </div>
            <div class="picker-details-body">${esc(focus.text || "")}</div>
          ` : `<div class="mini-muted">Select an option to view details</div>`}
        </div>
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="return-build">Back to Level</button>
        <button class="btn primary" data-action="return-build" ${ok ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
}
