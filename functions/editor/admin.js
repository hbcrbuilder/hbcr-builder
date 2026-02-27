function html(body, status = 200, headers = {}) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>HBCR Editor Admin</title>` +
    `<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:40px;max-width:760px}code{background:#f2f2f2;padding:2px 6px;border-radius:4px}button{padding:8px 12px;font-size:14px}input{padding:8px;font-size:14px;width:360px}</style>`+
    `</head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } }
  );
}

function randCode() {
  // 20 chars, base32-ish
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i=0;i<20;i++) out += alphabet[Math.floor(Math.random()*alphabet.length)];
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const master = env.EDITOR_MASTER_KEY || "";
  if (!master) return html(`<h1>Missing EDITOR_MASTER_KEY</h1><p>Add it in Pages → Settings → Variables and Secrets.</p>`, 500);

  const key = url.searchParams.get("key") || "";
  if (key !== master) return new Response("Forbidden", { status: 403 });

  const kv = env.EDITOR_AUTH;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return html(`<h1>Editor not configured</h1><p>Missing KV binding <b>EDITOR_AUTH</b>.</p>`, 500);
  }

  if (request.method === "GET") {
    return html(`
      <h1>HBCR Editor Admin</h1>
      <p>Create and revoke invite codes.</p>

      <h2>Create</h2>
      <form method="POST" action="/editor/admin?key=${encodeURIComponent(key)}">
        <input name="action" type="hidden" value="create" />
        <button type="submit">Create new invite code</button>
      </form>

      <h2>Disable</h2>
      <form method="POST" action="/editor/admin?key=${encodeURIComponent(key)}">
        <input name="action" type="hidden" value="disable" />
        <input name="code" placeholder="Invite code to disable" />
        <button type="submit">Disable code</button>
      </form>

      <p style="margin-top:24px;color:#666">Tip: share a code with a maintainer. They go to <code>/editor/login</code> and paste it once.</p>
    `);
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const action = String(form.get("action") || "");
    if (action === "create") {
      const code = randCode();
      const rec = { createdAt: new Date().toISOString(), disabled: false };
      await kv.put("code:" + code, JSON.stringify(rec));
      return html(`<h1>Invite code created</h1><p><b><code>${code}</code></b></p><p><a href="/editor/admin?key=${encodeURIComponent(key)}">Back</a></p>`);
    }
    if (action === "disable") {
      const code = String(form.get("code") || "").trim();
      if (!code) return Response.redirect("/editor/admin?key=" + encodeURIComponent(key), 302);
      const recRaw = await kv.get("code:" + code);
      if (!recRaw) return html(`<h1>Not found</h1><p>Code <code>${code}</code> does not exist.</p><p><a href="/editor/admin?key=${encodeURIComponent(key)}">Back</a></p>`, 404);
      let rec;
      try { rec = JSON.parse(recRaw); } catch { rec = {}; }
      rec.disabled = true;
      rec.disabledAt = new Date().toISOString();
      await kv.put("code:" + code, JSON.stringify(rec));
      return html(`<h1>Disabled</h1><p>Code <code>${code}</code> is now disabled.</p><p><a href="/editor/admin?key=${encodeURIComponent(key)}">Back</a></p>`);
    }
    return new Response("Bad Request", { status: 400 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
