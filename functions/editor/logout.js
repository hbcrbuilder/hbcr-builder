export async function onRequest(context) {
  const url = new URL(context.request.url);
  const headers = new Headers({ "location": url.origin + "/editor/login" });
  headers.append("set-cookie", "hbcr_editor_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return new Response(null, { status: 302, headers });
}
