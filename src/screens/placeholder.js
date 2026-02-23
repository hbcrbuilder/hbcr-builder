export function PlaceholderScreen({ title, subtitle }) {
  return `
    <div class="screen">
      <div class="h1">${title}</div>
      <div class="h2">${subtitle || "Coming soon"}</div>

      <div class="hint">
        This screen is intentionally a placeholder while we lock in the BG3 look & flow.
      </div>

      <div class="bottom-nav">
        <button class="btn" data-action="back">Back</button>
        <button class="btn primary" data-action="next">Next</button>
      </div>
    </div>
  `;
}
