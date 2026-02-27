export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/editor")) return next();
  // Delegate to /editor middleware by reusing same logic via dynamic import isn't supported reliably.
  // So we just call next() and let route handlers enforce auth.
  return next();
}
