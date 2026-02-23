function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadArcaneThreads() {
  const res = await fetch("./data/arcane_threads_wizard.json", { cache: "no-store" });
  return res.json();
}

export async function ArcaneThreadsScreen({ state, level }) {
  const lvl = Number(level ?? state.character.level ?? 1);
  const selectedByLevel = state.character.wizardArcaneThreadsByLevel || { 2: [], 6: [], 10: [] };
  const selected = Array.isArray(selectedByLevel?.[lvl]) ? selectedByLevel[lvl] : [];

  const data = await loadArcaneThreads();
  const options = (data.threads || []).map((t) => ({
    id: t.id,
    label: t.name,
    desc: t.description
  }));

  const picked = selected.length;

  return `
    <div class="screen choice-panel">
      <div class="h1">Arcane Threads</div>
      <div class="h2">Choose 2 passives for Level ${lvl} <span style="opacity:.75">(${picked}/2)</span></div>
      <div class="hint" style="margin-top:6px">Wizard-only passives from the Homebrew guide.</div>

      <div class="grid">
        ${options
          .map((o) => {
            const isSel = selected.includes(o.id);
            const disabled = !isSel && selected.length >= 2;
            return `
              <div
                class="card ${isSel ? "selected" : ""} ${disabled ? "disabled" : ""}"
                data-action="toggle-arcane-thread"
                data-id="${escapeHtml(o.id)}"
                ${disabled ? 'style="opacity:.6"' : ""}
              >
                <div class="icon" aria-hidden="true">🧵</div>
                <div class="label">${escapeHtml(o.label)}</div>
                ${o.desc ? `<div class="desc">${escapeHtml(o.desc)}</div>` : ""}
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="back">Back</button>
        <button class="btn primary" data-action="next">Next</button>
      </div>
    </div>
  `;
}
