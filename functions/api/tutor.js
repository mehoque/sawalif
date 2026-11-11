// POST /api/tutor  ->  calls the Claude API with the key kept server-side.
// Body: { system?: string, messages: [{role, content}], tier: "default"|"quick", max_tokens?: number }
// Returns: { text }
//
// Environment:
//   ANTHROPIC_API_KEY  (secret)  your Claude API key
//   MODEL_DEFAULT      optional, default "claude-sonnet-5-5"
//   MODEL_QUICK        optional, default "claude-haiku-5-5"
//   DAILY_LIMIT        optional, max calls per day (default 400)
// Binding:
//   MEMORY             KV namespace (also used for the daily counter)

const MAX_MESSAGES = 60;
const MAX_CHARS = 120_000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestPost({ request, env, data }) {
  const apiKey = String(env.ANTHROPIC_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey) return new Response("ANTHROPIC_API_KEY is not set.", { status: 500 });
  if (!apiKey.startsWith("sk-ant-")) return new Response(`ANTHROPIC_API_KEY does not look like a Claude API key (it should start with sk-ant-). Saved value starts with "${apiKey.slice(0, 4)}" and is ${apiKey.length} characters long.`, { status: 500 });

  let body;
  try { body = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  // Validate and normalise messages (merge consecutive same-role turns, must start and end with user).
  const raw = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
  const msgs = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) continue;
    const last = msgs[msgs.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else msgs.push({ role: m.role, content: m.content });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return new Response("Messages must start and end with a user turn.", { status: 400 });
  const totalChars = msgs.reduce((n, m) => n + m.content.length, 0) + String(body.system || "").length;
  if (totalChars > MAX_CHARS) return new Response("Request too large.", { status: 413 });

  // Daily cap, as a second guard on spend (set a hard limit in the Anthropic Console too).
  const limit = Number(env.DAILY_LIMIT || 400);
  const day = new Date().toISOString().slice(0, 10);
  const ckey = `count:${data.email}:${day}`;
  if (env.MEMORY) {
    const used = Number((await env.MEMORY.get(ckey)) || 0);
    if (used >= limit) return new Response("Daily limit reached.", { status: 429 });
    await env.MEMORY.put(ckey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  }

  const model = body.tier === "quick"
    ? (env.MODEL_QUICK || "claude-haiku-5-5")
    : (env.MODEL_DEFAULT || "claude-sonnet-5-5");
  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 1200, 64), 4000);

  // Prompt caching: the fixed tutor instructions and the growing conversation are cached,
  // so each new turn mostly pays the low cache-read rate.
  const messages = msgs.map((m, i) =>
    i === msgs.length - 1 && m.role === "user"
      ? { role: "user", content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] }
      : m
  );
  const payload = { model, max_tokens: maxTokens, messages };
  if (typeof body.system === "string" && body.system.trim()) {
    payload.system = [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }];
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text();
    const status = r.status === 429 || r.status === 529 ? 429 : 502;
    return new Response(`Claude API error ${r.status}: ${detail.slice(0, 500)}`, { status });
  }
  const out = await r.json();
  const text = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return json({ text, usage: out.usage });
}
