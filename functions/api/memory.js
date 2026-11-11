// GET  /api/memory  -> { profile, vocab } for the signed-in learner (or {} the first time)
// PUT  /api/memory  <- { profile, vocab }
// Stored in the MEMORY KV namespace under the learner's verified email.

const MAX_BYTES = 900_000;

export async function onRequestGet({ env, data }) {
  if (!env.MEMORY) return new Response("MEMORY KV binding is missing.", { status: 500 });
  const v = await env.MEMORY.get(`mem:${data.email}`);
  return new Response(v || "{}", { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function onRequestPut({ request, env, data }) {
  if (!env.MEMORY) return new Response("MEMORY KV binding is missing.", { status: 500 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return new Response("Memory too large.", { status: 413 });
  let parsed;
  try { parsed = JSON.parse(text); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || typeof parsed.profile !== "object") {
    return new Response("Expected { profile, vocab }", { status: 400 });
  }
  const clean = JSON.stringify({ profile: parsed.profile, vocab: parsed.vocab || {}, savedAt: Date.now() });
  await env.MEMORY.put(`mem:${data.email}`, clean);
  // Keep a dated backup so a bad save can be rolled back (kept 30 days).
  await env.MEMORY.put(`backup:${data.email}:${new Date().toISOString().slice(0, 10)}`, clean, { expirationTtl: 60 * 60 * 24 * 30 });
  return new Response(null, { status: 204 });
}
