// Guards every /api/* call. Cloudflare Access sits in front of the whole site;
// this middleware additionally verifies the Access token's signature, audience
// and expiry, and checks the email against ALLOWED_EMAILS, so the API cannot be
// used even if Access were misconfigured or a preview URL were left open.
//
// Required environment variables (Pages > Settings > Variables):
//   ACCESS_TEAM     your Zero Trust team name (the "xyz" in xyz.cloudflareaccess.com)
//   ACCESS_AUD      the Application Audience (AUD) tag of the Access application
//   ALLOWED_EMAILS  comma-separated list, e.g. "you@gmail.com"

let certCache = { at: 0, keys: [] };

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJSON = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKeys(team) {
  if (Date.now() - certCache.at < 3600_000 && certCache.keys.length) return certCache.keys;
  const r = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("certs fetch failed");
  const j = await r.json();
  certCache = { at: Date.now(), keys: j.keys || [] };
  return certCache.keys;
}

async function verifyAccess(request, env) {
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    (request.headers.get("Cookie") || "").match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const header = b64urlJSON(h);
  const payload = b64urlJSON(p);
  const jwk = (await getKeys(env.ACCESS_TEAM)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  const email = String(payload.email || "").toLowerCase();
  const allowed = String(env.ALLOWED_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!email || !allowed.includes(email)) return null;
  return email;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD || !env.ALLOWED_EMAILS) {
    return new Response("Server not configured: set ACCESS_TEAM, ACCESS_AUD and ALLOWED_EMAILS.", { status: 500 });
  }
  let email = null;
  try { email = await verifyAccess(request, env); } catch (e) { email = null; }
  if (!email) return new Response("Not authorized", { status: 403 });
  context.data.email = email;
  return context.next();
}
