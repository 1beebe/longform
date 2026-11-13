import type { Env } from "./env";

export class ModelError extends Error {}
export class ModelBusy extends Error {}

export const hasModel = (env: Env) => Boolean(env.MINDSTUDIO_API_KEY || env.ANTHROPIC_API_KEY);

const MS_BASE = "https://v1.mindstudio-api.com/developer/v2";

// App-wide daily brake on model calls; provider budgets stay the hard cap.
async function countCall(env: Env): Promise<void> {
  const key = `calls:${new Date().toISOString().slice(0, 10)}`;
  const n = Number((await env.SESSIONS.get(key)) ?? 0);
  if (n >= Number(env.DAILY_MODEL_CALLS ?? 400)) throw new ModelBusy("The planner has hit today's AI limit. Try again tomorrow.");
  await env.SESSIONS.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
}

// MindStudio's step API: start a step, then poll until it finishes.
async function mindstudio(env: Env, system: string, message: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const start = await fetch(`${MS_BASE}/steps/userMessage/execute-async`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MINDSTUDIO_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ step: { message, modelOverride: { model: env.MINDSTUDIO_MODEL || "claude-5-5-sonnet", maxResponseTokens: maxTokens, preamble: system } } }),
  });
  if (!start.ok) throw new ModelError(`MindStudio ${start.status}: ${(await start.text()).slice(0, 300)}`);
  const { executionToken } = (await start.json()) as { executionToken: string };
  const deadline = Date.now() + timeoutMs;
  for (let delay = 250; Date.now() < deadline; delay = Math.min(delay * 2, 800)) {
    await new Promise((r) => setTimeout(r, delay));
    const res = await fetch(`${MS_BASE}/steps/userMessage/execute-async/poll/${executionToken}`);
    if (res.status >= 502 && res.status <= 504) continue;
    if (!res.ok) throw new ModelError(`MindStudio poll ${res.status}`);
    const poll = (await res.json()) as { status: string; output?: { content: string }; outputUrl?: string; message?: string; error?: string };
    if (poll.status === "pending") continue;
    if (poll.status === "error") throw new ModelError(`MindStudio: ${poll.message ?? poll.error ?? "failed"}`);
    if (poll.output != null) return poll.output.content;
    if (poll.outputUrl) return ((await (await fetch(poll.outputUrl)).json()) as { value: { content: string } }).value.content;
    throw new ModelError("MindStudio: no output");
  }
  throw new ModelError("MindStudio: timed out");
}

async function anthropic(env: Env, system: string, message: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: message }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new ModelError(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { content: { type: string; text?: string }[] };
  return json.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}

export async function generate(env: Env, system: string, message: string, maxTokens = 3000, timeoutMs = 55_000): Promise<string> {
  if (!hasModel(env)) throw new ModelError("No AI key is set (MINDSTUDIO_API_KEY or ANTHROPIC_API_KEY).");
  await countCall(env);
  if (env.MINDSTUDIO_API_KEY) {
    try {
      return await mindstudio(env, system, message, maxTokens, timeoutMs);
    } catch (err) {
      if (!env.ANTHROPIC_API_KEY) throw err;
      console.error(`MindStudio failed, trying Anthropic: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return anthropic(env, system, message, maxTokens, timeoutMs);
}

// The first JSON value in a reply, tolerating a code fence or a sentence around it.
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.search(/[[{]/);
  if (start < 0) throw new ModelError("The AI reply had no JSON");
  const open = fenced[start];
  const close = open === "[" ? "]" : "}";
  const end = fenced.lastIndexOf(close);
  return JSON.parse(fenced.slice(start, end + 1)) as T;
}
