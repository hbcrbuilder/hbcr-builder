function page(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0b0b0b;color:#eee;margin:0;padding:24px}
    .wrap{max-width:820px;margin:0 auto}
    .card{background:#141414;border:1px solid #2a2a2a;border-radius:14px;padding:18px;margin:14px 0}
    h1{margin:0 0 10px;font-size:20px}
    h2{margin:0 0 10px;font-size:16px}
    p{margin:0 0 12px;color:#bdbdbd;font-size:13px;line-height:1.4}
    input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #333;background:#0f0f0f;color:#eee;font-size:14px}
    button{margin-top:10px;padding:10px 12px;border-radius:10px;border:0;background:#2f6fed;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .ok{color:#7CFC9A;font-size:13px}
    .err{color:#ff6b6b;font-size:13px}
    code{background:#0f0f0f;border:1px solid #333;padding:2px 6px;border-radius:8px}
  </style>
</head>
<body>
  <div class="wrap">
    ${body}
  </div>
</body>
</html>`;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let out = "";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.EDITOR_AUTH) {
    return new Response("Server misconfigured: missing EDITOR_AUTH KV binding", { status: 500 });
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const created = url.searchParams.get("created") || "";
    const disabled = url.searchParams.get("disabled") || "";
    const err = url.searchParams.get("err") || "";

    const html = page("HBCR Editor Admin", `
      <h1>HBCR Editor Admin</h1>
      <p>Create / disable invite codes. Share a code with someone who needs editor access. Disable a code to revoke access.</p>

      <div class="card">
        <h2>Create invite code</h2>
        <form method="POST">
          <input type="hidden" name="action" value="create" />
          <input name="note" placeholder="Optional note (who is this for?)" />
          <button type="submit">Create code</button>
        </form>
        ${created ? `<p class="ok">Created: <code>${created}</code></p>` : ``}
      </div>

      <div class="card">
        <h2>Disable invite code</h2>
        <form method="POST">
          <input type="hidden" name="action" value="disable" />
          <input name="code" placeholder="Invite code to disable" />
          <button type="submit">Disable code</button>
        </form>
        ${disabled ? `<p class="ok">Disabled: <code>${disabled}</code></p>` : ``}
      </div>

      ${err ? `<p class="err">${err}</p>` : ``}

      <p>Tip: send users to <code>/editor/login</code> to enter their invite code.</p>
    `);

    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (request.method === "POST") {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    if (!env.EDITOR_MASTER_KEY || key !== env.EDITOR_MASTER_KEY) {
      return new Response("Forbidden", { status: 403 });
    }

    const form = await request.formData();
    const action = String(form.get("action") || "");
    if (action === "create") {
      const note = String(form.get("note") || "").trim();
      const code = makeCode();
      const rec = { enabled: true, createdAt: new Date().toISOString(), note };
      await env.EDITOR_AUTH.put(`code:${code}`, JSON.stringify(rec));
      return Response.redirect(new URL(`/editor/admin?key=${encodeURIComponent(key)}&created=${encodeURIComponent(code)}`, url.origin), 302);
    }

    if (action === "disable") {
      const code = String(form.get("code") || "").trim();
      if (!code) {
        return Response.redirect(new URL(`/editor/admin?key=${encodeURIComponent(key)}&err=${encodeURIComponent("Missing code")}`, url.origin), 302);
      }
      const raw = await env.EDITOR_AUTH.get(`code:${code}`);
      if (!raw) {
        return Response.redirect(new URL(`/editor/admin?key=${encodeURIComponent(key)}&err=${encodeURIComponent("Unknown code")}`, url.origin), 302);
      }
      let rec;
      try { rec = JSON.parse(raw); } catch (e) { rec = {}; }
      rec.enabled = false;
      rec.disabledAt = new Date().toISOString();
      await env.EDITOR_AUTH.put(`code:${code}`, JSON.stringify(rec));
      return Response.redirect(new URL(`/editor/admin?key=${encodeURIComponent(key)}&disabled=${encodeURIComponent(code)}`, url.origin), 302);
    }

    return Response.redirect(new URL(`/editor/admin?key=${encodeURIComponent(key)}&err=${encodeURIComponent("Unknown action")}`, url.origin), 302);
  }

  return new Response("Method not allowed", { status: 405 });
}