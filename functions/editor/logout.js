export async function onRequest(context) {
  const url = new URL(context.request.url);
  const res = Response.redirect(new URL("/", url.origin), 302);
  res.headers.append("Set-Cookie", "hbcr_editor_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  return res;
}