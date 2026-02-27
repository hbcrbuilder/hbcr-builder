function page(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0b0b0b;color:#eee;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{background:#141414;border:1px solid #2a2a2a;border-radius:14px;padding:22px;max-width:420px;width:92%}
    h1{margin:0 0 10px;font-size:20px}
    p{margin:0 0 14px;color:#bdbdbd;font-size:14px;line-height:1.4}
    input{width:100%;padding:12px 12px;border-radius:10px;border:1px solid #333;background:#0f0f0f;color:#eee;font-size:14px}
    button{margin-top:12px;width:100%;padding:12px;border-radius:10px;border:0;background:#2f6fed;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
    .err{margin-top:10px;color:#ff6b6b;font-size:13px}
    .hint{margin-top:10px;color:#9a9a9a;font-size:12px}
  </style>
</head>
<body>
  <div class="card">
    ${body}
  </div>
</body>
</html>`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "GET") {
    const err = url.searchParams.get("err");
    const msg = err === "invalid"
      ? "Invalid invite code."
      : err === "disabled"
      ? "That invite code has been disabled."
      : "";

    const html = page("HBCR Editor Login", `
      <h1>HBCR Editor</h1>
      <p>Enter an invite code to access the editor.</p>
      <form method="POST">
        <input name="code" autocomplete="off" placeholder="Invite code" />
        <button type="submit">Continue</button>
      </form>
      ${msg ? `<div class="err">${msg}</div>` : ``}
      <div class="hint">If you don’t have a code, ask the maintainer for one.</div>
    `);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (request.method === "POST") {
    if (!env.EDITOR_AUTH) {
      return new Response("Server misconfigured: missing EDITOR_AUTH KV binding", { status: 500 });
    }

    const form = await request.formData();
    const code = String(form.get("code") || "").trim();

    if (!code) {
      return Response.redirect(new URL("/editor/login?err=invalid", url.origin), 302);
    }

    const raw = await env.EDITOR_AUTH.get(`code:${code}`);
    if (!raw) {
      return Response.redirect(new URL("/editor/login?err=invalid", url.origin), 302);
    }

    let rec;
    try { rec = JSON.parse(raw); } catch (e) { rec = null; }

    if (!rec || rec.enabled !== true) {
      return Response.redirect(new URL("/editor/login?err=disabled", url.origin), 302);
    }

    const res = Response.redirect(new URL("/editor", url.origin), 302);
    // HttpOnly cookie so it can't be read by JS. Lax is fine.
    res.headers.append("Set-Cookie", `hbcr_editor_session=${encodeURIComponent(code)}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return res;
  }

  return new Response("Method not allowed", { status: 405 });
}