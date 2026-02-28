/**
 * HBCR Editor Overlay: Subclass "+ Add" (non-invasive)
 * - Runs only in editor/builder (design flags)
 * - Does NOT touch core app code
 * - Adds a small + button on Subclass radial stage
 * - Lets maintainer "pin" subclass ids to front (per class optional later)
 * - Persists pins to localStorage (editor-only) for now
 */
(function () {
  const DESIGN = !!window.__HBCR_DESIGN__;
  const KIND = window.__HBCR_DESIGN_KIND__ || "";
  if (!DESIGN) return; // not editor
  // allow both "slots" and future kinds
  const isEditor = true;

  const PINS_KEY = "hbcr_editor_pins_subclass"; // JSON array of subclass ids

  function readPins() {
    try {
      const v = localStorage.getItem(PINS_KEY);
      const arr = v ? JSON.parse(v) : [];
      return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
    } catch {
      return [];
    }
  }
  function writePins(arr) {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(arr)); } catch {}
  }

  async function fetchBundle() {
    // Use same endpoint the app uses
    const res = await fetch("/api/bundle", { cache: "no-store" });
    if (!res.ok) throw new Error("bundle fetch failed");
    return await res.json();
  }

  function el(tag, attrs = {}, html = "") {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k.startsWith("data-")) n.setAttribute(k, v);
      else n.setAttribute(k, v);
    }
    if (html) n.innerHTML = html;
    return n;
  }

  function ensureModal() {
    let root = document.getElementById("hbcr-editor-subclass-modal");
    if (root) return root;

    root = el("div", {
      id: "hbcr-editor-subclass-modal",
      style: [
        "position:fixed",
        "inset:0",
        "z-index:9999",
        "display:none",
        "align-items:center",
        "justify-content:center",
        "background:rgba(0,0,0,0.55)",
      ].join(";"),
    });

    const panel = el("div", {
      style: [
        "width:min(520px, calc(100vw - 40px))",
        "max-height:min(70vh, 640px)",
        "overflow:auto",
        "background:rgba(20,16,12,0.92)",
        "border:1px solid rgba(200,160,80,0.35)",
        "border-radius:14px",
        "box-shadow:0 12px 40px rgba(0,0,0,0.55)",
        "padding:16px",
        "color:#e8dcc6",
        "font-family:inherit",
      ].join(";"),
    });

    panel.appendChild(el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;" },
      `<div style="font-weight:700;letter-spacing:.04em;">Add / Pin Subclasses</div>
       <button type="button" id="hbcr-editor-subclass-close" style="all:unset;cursor:pointer;padding:6px 10px;border-radius:10px;border:1px solid rgba(200,160,80,0.35);">Close</button>`
    ));

    panel.appendChild(el("div", { style: "opacity:.85;margin-bottom:10px;line-height:1.35;" },
      `Pins are editor-only for now (saved in your browser). Pinned subclasses will float to the front of the radial.`
    ));

    panel.appendChild(el("input", {
      id: "hbcr-editor-subclass-search",
      placeholder: "Search subclasses...",
      style: [
        "width:100%",
        "box-sizing:border-box",
        "padding:10px 12px",
        "border-radius:12px",
        "border:1px solid rgba(200,160,80,0.25)",
        "background:rgba(0,0,0,0.25)",
        "color:#e8dcc6",
        "outline:none",
        "margin-bottom:12px",
      ].join(";"),
    }));

    const list = el("div", { id: "hbcr-editor-subclass-list" });
    panel.appendChild(list);

    root.appendChild(panel);
    document.body.appendChild(root);

    root.addEventListener("click", (e) => {
      if (e.target === root) hideModal();
    });
    panel.querySelector("#hbcr-editor-subclass-close").addEventListener("click", hideModal);
    panel.querySelector("#hbcr-editor-subclass-search").addEventListener("input", () => {
      renderList(panel._subclassData || []);
    });

    function hideModal() {
      root.style.display = "none";
    }
    root.hideModal = hideModal;

    function renderList(items) {
      const q = (panel.querySelector("#hbcr-editor-subclass-search").value || "").trim().toLowerCase();
      const pins = new Set(readPins());
      list.innerHTML = "";
      const filtered = items.filter(it => {
        if (!q) return true;
        const name = String(it.Name ?? it.name ?? it.Subclass ?? it.subclass ?? it.label ?? "").toLowerCase();
        const id = String(it.SubclassId ?? it.subclassId ?? it.Id ?? it.id ?? "").toLowerCase();
        return name.includes(q) || id.includes(q);
      });

      if (!filtered.length) {
        list.appendChild(el("div", { style: "opacity:.8;padding:10px 4px;" }, "No matches."));
        return;
      }

      filtered.slice(0, 200).forEach(it => {
        const id = String(it.SubclassId ?? it.subclassId ?? it.Id ?? it.id ?? it.Subclass ?? it.subclass ?? "").trim();
        const name = String(it.Name ?? it.name ?? it.SubclassName ?? it.subclassName ?? it.Subclass ?? it.subclass ?? id).trim();
        if (!id) return;

        const isPinned = pins.has(id);
        const row = el("div", {
          style: [
            "display:flex",
            "align-items:center",
            "justify-content:space-between",
            "gap:10px",
            "padding:10px 8px",
            "border-top:1px solid rgba(200,160,80,0.12)",
          ].join(";"),
        });

        row.appendChild(el("div", { style: "min-width:0;" },
          `<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</div>
           <div style="opacity:.75;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(id)}</div>`
        ));

        const btn = el("button", {
          type: "button",
          style: [
            "all:unset",
            "cursor:pointer",
            "padding:7px 10px",
            "border-radius:10px",
            "border:1px solid rgba(200,160,80,0.35)",
            "background:rgba(0,0,0,0.18)",
            "font-weight:600",
          ].join(";"),
        }, isPinned ? "Unpin" : "Pin");

        btn.addEventListener("click", () => {
          const arr = readPins();
          const idx = arr.indexOf(id);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.unshift(id);
          writePins(arr);
          applyPinsToDom();
          renderList(items);
        });

        row.appendChild(btn);
        list.appendChild(row);
      });
    }

    root.setSubclasses = (items) => {
      panel._subclassData = items;
      panel.querySelector("#hbcr-editor-subclass-search").value = "";
      renderList(items);
    };

    return root;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function currentStageEl() {
    // The app renders .radial-stage with data-stage
    return document.querySelector(".radial-stage[data-stage]");
  }

  function isSubclassStage() {
    const st = currentStageEl();
    return st && (st.getAttribute("data-stage") || "").toLowerCase() === "subclass";
  }

  function ensurePlusButton() {
    let btn = document.getElementById("hbcr-editor-plus-subclass");
    if (btn) return btn;

    btn = el("button", {
      id: "hbcr-editor-plus-subclass",
      type: "button",
      style: [
        "position:absolute",
        "right:14px",
        "bottom:14px",
        "z-index:50",
        "width:44px",
        "height:44px",
        "border-radius:999px",
        "border:1px solid rgba(200,160,80,0.45)",
        "background:rgba(0,0,0,0.35)",
        "color:#e8dcc6",
        "font-size:26px",
        "line-height:42px",
        "text-align:center",
        "cursor:pointer",
        "user-select:none",
      ].join(";"),
    }, "+");

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.textContent = "…";
        const modal = ensureModal();
        const bundle = await fetchBundle();
        const subs = Array.isArray(bundle.Subclasses) ? bundle.Subclasses : [];
        modal.setSubclasses(subs);
        modal.style.display = "flex";
      } catch (e) {
        console.error(e);
        alert("Failed to load subclasses. Check console.");
      } finally {
        btn.disabled = false;
        btn.textContent = "+";
      }
    });

    return btn;
  }

  function applyPinsToDom() {
    const pins = readPins();
    if (!pins.length) return;

    const stage = currentStageEl();
    if (!stage) return;

    const orbit = stage.querySelector(".radial-orbit");
    if (!orbit) return;

    // Collect nodes by id
    const nodes = Array.from(orbit.querySelectorAll(".radial-node[data-id]"));
    const byId = new Map(nodes.map(n => [String(n.getAttribute("data-id") || ""), n]));
    // Move pinned nodes to the beginning in order of pins
    pins.slice().reverse().forEach(id => {
      const n = byId.get(String(id));
      if (n) orbit.insertBefore(n, orbit.firstChild);
    });

    // trigger re-layout (radial.js listens to resize)
    window.dispatchEvent(new Event("resize"));
  }

  // main loop: watch stage changes
  let lastStage = "";
  function tick() {
    const stEl = currentStageEl();
    const st = stEl ? (stEl.getAttribute("data-stage") || "") : "";
    if (st !== lastStage) {
      lastStage = st;
      // Clean up button if stage changes
      const old = document.getElementById("hbcr-editor-plus-subclass");
      if (old) old.remove();

      if (isSubclassStage()) {
        // attach button to stage element
        stEl.style.position = stEl.style.position || "relative";
        stEl.appendChild(ensurePlusButton());
        // apply pins reorder
        applyPinsToDom();
      }
    } else {
      // still on same stage; ensure pins applied once DOM nodes exist
      if (isSubclassStage()) applyPinsToDom();
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
