export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Only guard /editor (and subpaths). If this middleware is placed under /functions/editor/_middleware.js
  // it will only run for /editor/* routes.
  // Allow login endpoint always.
  if (path === "/editor/login" || path === "/editor/login/") {
    return next();
  }

  // Admin endpoint: must provide master key query param.
  if (path === "/editor/admin" || path === "/editor/admin/") {
    const key = url.searchParams.get("key") || "";
    if (!env.EDITOR_MASTER_KEY || key !== env.EDITOR_MASTER_KEY) {
      return new Response("Forbidden", { status: 403 });
    }
    return next();
  }

  // Validate session cookie -> invite code
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)hbcr_editor_session=([^;]+)/);
  const code = m ? decodeURIComponent(m[1]) : "";

  if (!code) {
    return Response.redirect(new URL("/editor/login", url.origin), 302);
  }

  // KV binding required
  if (!env.EDITOR_AUTH) {
    return new Response("Server misconfigured: missing EDITOR_AUTH KV binding", { status: 500 });
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

  // ok
  return next();
}