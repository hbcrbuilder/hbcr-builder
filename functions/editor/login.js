function html(body, status = 200, headers = {}) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>HBCR Editor Login</title>` +
    `<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:40px;max-width:520px}input{width:100%;padding:10px;font-size:16px}button{padding:10px 14px;font-size:16px;margin-top:12px} .err{color:#b00020;margin:12px 0}</style>`+
    `</head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } }
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const kv = env.EDITOR_AUTH;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return html(`<h1>Editor not configured</h1><p>Missing KV binding <b>EDITOR_AUTH</b> on this Pages project.</p>`, 500);
  }

  if (request.method === "GET") {
    const err = url.searchParams.get("err");
    const msg = err === "invalid" ? "Invalid code." : err === "disabled" ? "Code disabled." : "";
    return html(`
      <h1>HBCR Editor</h1>
      <p>Enter your invite code to access the editor.</p>
      ${msg ? `<div class="err">${msg}</div>` : ""}
      <form method="POST">
        <input name="code" autocomplete="off" placeholder="Invite code" />
        <button type="submit">Sign in</button>
      </form>
    `);
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const code = String(form.get("code") || "").trim();
    if (!code) return Response.redirect(url.origin + "/editor/login?err=invalid", 302);

    const recRaw = await kv.get("code:" + code);
    if (!recRaw) return Response.redirect(url.origin + "/editor/login?err=invalid", 302);

    let rec;
    try { rec = JSON.parse(recRaw); } catch { rec = null; }
    if (!rec || rec.disabled) return Response.redirect(url.origin + "/editor/login?err=disabled", 302);

    const headers = new Headers({ "location": url.origin + "/editor/" });
    headers.append("set-cookie", `hbcr_editor_session=${encodeURIComponent(code)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60*60*24*30}`);
    return new Response(null, { status: 302, headers });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
