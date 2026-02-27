export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Only guard /editor (and subpaths)
  if (!path.startsWith("/editor")) return next();

  // Allow login page and login POST
  if (path === "/editor/login") return next();

  // Allow static assets under /editor/assets or similar without auth? keep guarded unless you want public
  // We'll keep them guarded by default.

  // Admin page is guarded by a master key in query string
  if (path === "/editor/admin") {
    const key = url.searchParams.get("key") || "";
    const master = env.EDITOR_MASTER_KEY || "";
    if (!master) {
      return new Response("Missing EDITOR_MASTER_KEY env var", { status: 500 });
    }
    if (key !== master) return new Response("Forbidden", { status: 403 });
    return next();
  }

  // Logout can always be called (it just clears cookie)
  if (path === "/editor/logout") return next();

  // Validate KV binding exists
  const kv = env.EDITOR_AUTH;
  if (!kv || typeof kv.get !== "function") {
    return new Response("Missing KV binding EDITOR_AUTH", { status: 500 });
  }

  // Check cookie
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)hbcr_editor_session=([^;]+)/);
  const code = m ? decodeURIComponent(m[1]) : "";
  if (!code) {
    return Response.redirect(url.origin + "/editor/login", 302);
  }

  const recRaw = await kv.get("code:" + code);
  if (!recRaw) {
    return Response.redirect(url.origin + "/editor/login?err=invalid", 302);
  }

  let rec;
  try { rec = JSON.parse(recRaw); } catch { rec = null; }
  if (!rec || rec.disabled) {
    return Response.redirect(url.origin + "/editor/login?err=disabled", 302);
  }

  // ok
  return next();
}
