import type { Env } from "./env";
import { pkcePair, randomToken } from "./crypto";
import {
  BufferClient, NeedsReconnect, RateLimited, authorizeUrl, createDatedDraft, exchangeCode, getChannels, getQueue, getStart,
  type Channel, type CreatedPost, type QueueItem,
} from "./buffer";
import { DocError, fetchDoc, parsePasted } from "./doc";
import { GoogleReconnect, googleAuthUrl, googleExchange, googleReady, googleToken, readPickedDoc, revokeGoogle } from "./google";
import { LIMITS } from "./guard";
import { ModelBusy, ModelError, hasModel } from "./model";
import { busyByDay, forgetDeleted, pickPublishDay, place, placeholderChannel, reasonFor, type Slot } from "./plan";
import { cookie, createSession, destroySession, loadSession, readCookie, saveSession, type Session, type Suggestion } from "./session";
import { RevisionRejected, revise, serviceName, suggest } from "./suggest";
import { orderSavedDrafts, toSavedDraft, type DraftFallback, type SavedDraft } from "./saved";
import { addDays, localDate, mondayOf, validZone, zonedIso } from "./time";
import { appPage, privacyPage } from "./page";
import { STATIC } from "./static";
import { sampleDoc } from "./sample";

const RANGE_DAYS = 42; // the calendar spans six weeks from this Monday
const MODEL_CALLS_PER_HOUR = 20;

class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const SECURITY: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com https://*.gstatic.com; connect-src 'self' https://*.googleapis.com; frame-src https://docs.google.com https://drive.google.com https://accounts.google.com https://content.googleapis.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://auth.buffer.com",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin", // origin only, so Google can match the picker key's website restriction
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
const headers = (extra: Record<string, string> = {}) => new Headers({ ...SECURITY, ...extra });
const html = (body: string, status = 200) => new Response(body, { status, headers: headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }) });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers({ "Content-Type": "application/json", "Cache-Control": "no-store" }) });
const redirect = (to: string, extra: Record<string, string> = {}) => new Response(null, { status: 302, headers: headers({ Location: to, ...extra }) });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      const file = STATIC[url.pathname];
      if (req.method === "GET" && file) return new Response(file.body, { headers: headers({ "Content-Type": file.type, "Cache-Control": file.immutable ? "public, max-age=86400" : "no-cache, must-revalidate" }) });
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/app")) return html(appPage(env.APP_NAME || "Longform", !readCookie(req, "sid")));
      if (req.method === "GET" && url.pathname === "/privacy") return html(privacyPage(env.APP_NAME || "Longform"));
      if (req.method === "GET" && url.pathname === "/connect") return connect(env);
      if (req.method === "GET" && url.pathname === "/callback") return callback(req, env, url);
      if (req.method === "GET" && url.pathname === "/google/connect") return googleConnect(req, env);
      if (req.method === "GET" && url.pathname === "/google/callback") return googleCallback(req, env, url);
      if (req.method === "POST" && url.pathname === "/logout") {
        if (req.headers.get("Origin") !== new URL(env.APP_URL).origin) return json({ error: "Requests have to come from the app." }, 403);
        const loaded = await loadSession(req, env);
        if (loaded?.data.google) await revokeGoogle(loaded.data.google);
        return redirect("/", { "Set-Cookie": await destroySession(req, env) });
      }
      if (url.pathname.startsWith("/api/")) return await api(req, env, url.pathname);
      return html("<!doctype html><meta charset=utf-8><title>Not found</title><p style='font-family:system-ui;padding:40px'>Not found. <a href='/'>Back to the planner</a></p>", 404);
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function connect(env: Env): Promise<Response> {
  const { verifier, challenge } = await pkcePair();
  const state = randomToken(16);
  await env.SESSIONS.put(`auth:${state}`, verifier, { expirationTtl: 600 });
  return redirect(authorizeUrl(env, state, challenge), { "Set-Cookie": cookie("oauth_state", state, 600) });
}

async function callback(req: Request, env: Env, url: URL): Promise<Response> {
  const state = url.searchParams.get("state") ?? "";
  const clear = cookie("oauth_state", "", 0);
  if (!state || state !== readCookie(req, "oauth_state")) return redirect("/?error=state", { "Set-Cookie": clear });
  const verifier = await env.SESSIONS.get(`auth:${state}`);
  await env.SESSIONS.delete(`auth:${state}`);
  if (url.searchParams.get("error")) return redirect("/?error=denied", { "Set-Cookie": clear });
  const code = url.searchParams.get("code");
  if (!code || !verifier) return redirect("/?error=expired", { "Set-Cookie": clear });

  let tokens;
  try {
    tokens = await exchangeCode(env, code, verifier);
  } catch (err) {
    console.error(err);
    return redirect("/?error=signin", { "Set-Cookie": clear });
  }
  let existing = await loadSession(req, env);
  let session: Session = existing ? { ...existing.data, tokens } : { tokens };
  const { orgs, timezone, accountId } = await getStart(new BufferClient(env, session));
  // A different Buffer account on this browser gets a new session: the last
  // person's draft, plan and Google access don't carry over.
  if (existing && existing.data.accountId && accountId && existing.data.accountId !== accountId) {
    if (existing.data.google) await revokeGoogle(existing.data.google);
    await env.SESSIONS.delete(`s:${existing.id}`);
    existing = null;
    session = { tokens: session.tokens };
  }
  session.accountId = accountId;
  session.orgs = orgs.map(({ id, name }) => ({ id, name }));
  session.timezone = validZone(timezone);
  if (!orgs.some((o) => o.id === session.organizationId)) {
    Object.assign(session, { organizationId: orgs[0]?.id, organizationName: orgs[0]?.name, channelIds: undefined, plan: undefined });
  }
  const h = headers({ Location: "/", "Cache-Control": "no-store" });
  if (existing) await saveSession(env, existing.id, session);
  else h.append("Set-Cookie", await createSession(env, session));
  h.append("Set-Cookie", clear);
  return new Response(null, { status: 302, headers: h });
}

async function googleConnect(req: Request, env: Env): Promise<Response> {
  if (!googleReady(env)) return redirect("/?error=google-off");
  if (!(await loadSession(req, env))) return redirect("/");
  const { verifier, challenge } = await pkcePair();
  const state = randomToken(16);
  await env.SESSIONS.put(`gauth:${state}`, verifier, { expirationTtl: 600 });
  return redirect(googleAuthUrl(env, state, challenge), { "Set-Cookie": cookie("g_state", state, 600) });
}

async function googleCallback(req: Request, env: Env, url: URL): Promise<Response> {
  const state = url.searchParams.get("state") ?? "";
  const clear = cookie("g_state", "", 0);
  if (!state || state !== readCookie(req, "g_state")) return redirect("/?error=state", { "Set-Cookie": clear });
  const verifier = await env.SESSIONS.get(`gauth:${state}`);
  await env.SESSIONS.delete(`gauth:${state}`);
  if (url.searchParams.get("error")) return redirect("/?error=google-denied", { "Set-Cookie": clear });
  const code = url.searchParams.get("code");
  const loaded = await loadSession(req, env);
  if (!code || !verifier || !loaded) return redirect("/?error=expired", { "Set-Cookie": clear });
  try {
    loaded.data.google = await googleExchange(env, code, verifier);
  } catch (err) {
    console.error(err);
    return redirect(err instanceof DocError ? "/?error=google-scope" : "/?error=google", { "Set-Cookie": clear });
  }
  await saveSession(env, loaded.id, loaded.data);
  return redirect("/?pick=1", { "Set-Cookie": clear });
}

async function body(req: Request, max = 8_000): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > max) throw new UserError("That request is too large.", 413);
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new UserError("That request wasn't valid JSON.");
  }
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

function reserveModel(s: Session, calls: number): void {
  const recent = (s.modelCalls ?? []).filter((t) => Date.now() - t < 3_600_000);
  if (recent.length + calls > MODEL_CALLS_PER_HOUR) throw new UserError("That's a lot of planning for one hour. Give it a few minutes and try again.", 429);
  s.modelCalls = [...recent, ...Array(calls).fill(Date.now())];
}

interface Board {
  today: string;
  rangeStart: string;
  rangeEnd: string;
  timezone: string;
  channels: Channel[]; // the ones this plan uses
  allChannels: Channel[];
  skipped: Channel[];
  queue: QueueItem[];
  forgotten: number; // saved drafts found deleted in Buffer, now unsaved
}

async function board(client: BufferClient, s: Session): Promise<Board> {
  if (!s.organizationId) throw new UserError("This Buffer account has no organization to plan for.");
  const tz = validZone(s.timezone);
  const today = localDate(Date.now(), tz);
  const rangeStart = mondayOf(today);
  const rangeEnd = addDays(rangeStart, RANGE_DAYS - 1);
  const { usable, skipped } = await getChannels(client, s.organizationId);
  const picked = s.channelIds?.length ? usable.filter((c) => s.channelIds!.includes(c.id)) : usable;
  const { items: queue, complete } = await getQueue(client, s.organizationId, zonedIso(rangeStart, "00:00", tz), zonedIso(rangeEnd, "23:59", tz));
  const forgotten = s.plan ? forgetDeleted(s.plan, queue, today, rangeEnd, complete) : 0;
  return { today, rangeStart, rangeEnd, timezone: tz, channels: picked.length ? picked : usable, allChannels: usable, skipped, queue, forgotten };
}

function view(s: Session, b?: Board) {
  return {
    signedIn: true,
    org: s.organizationName,
    orgs: s.orgs ?? [],
    organizationId: s.organizationId,
    aiReady: undefined as boolean | undefined,
    google: { ready: false, connected: Boolean(s.google) },
    doc: s.doc ? { title: s.doc.title, url: s.doc.url, words: s.doc.words, sample: Boolean(s.doc.sample), picked: Boolean(s.doc.fileId), fileId: s.doc.fileId, modifiedTime: s.doc.modifiedTime, sections: s.doc.sections.map((x) => ({ index: x.index, heading: x.heading })) } : null,
    plan: s.plan ?? null,
    board: b
      ? {
          today: b.today, rangeStart: b.rangeStart, rangeEnd: b.rangeEnd, timezone: b.timezone,
          channels: b.allChannels.map((c) => ({ ...c, label: serviceName(c.service), selected: b.channels.some((x) => x.id === c.id) })),
          skipped: b.skipped.map((c) => ({ ...c, label: serviceName(c.service) })),
          queue: b.queue.map((q) => ({ ...q, date: localDate(Date.parse(q.dueAt), b.timezone) })),
        }
      : null,
    limits: LIMITS,
  };
}

function placeholderText(s: Session, app: string): string {
  const d = s.doc!;
  return [`📌 Publish day: “${d.title}”`, d.url ? `The draft: ${d.url}` : "", `Placeholder saved by ${app}. Publish the piece by hand, then replace or delete this draft.`]
    .filter(Boolean).join("\n\n");
}

async function api(req: Request, env: Env, path: string): Promise<Response> {
  if (req.method === "POST" && req.headers.get("Origin") !== new URL(env.APP_URL).origin) {
    return json({ error: "Requests have to come from the app." }, 403);
  }
  const loaded = await loadSession(req, env);
  if (path === "/api/me" && !loaded) return json({ signedIn: false });
  if (!loaded) return json({ error: "Connect Buffer first.", reconnect: true }, 401);
  const s = loaded.data;
  const client = new BufferClient(env, s);
  const save = () => saveSession(env, loaded.id, s);
  try {
    try {
      if (path === "/api/me") {
        const b = s.doc ? await board(client, s) : undefined;
        if (b?.forgotten) await save();
        const v = view(s, b);
        return json({ ...v, aiReady: hasModel(env), google: { ...v.google, ready: googleReady(env) }, forgotten: b?.forgotten ?? 0 });
      }

      if (req.method === "POST" && path === "/api/org") {
        const b = await body(req);
        const org = (s.orgs ?? []).find((o) => o.id === b.id);
        if (!org) throw new UserError("That organization isn't on this Buffer account.");
        Object.assign(s, { organizationId: org.id, organizationName: org.name, channelIds: undefined, plan: undefined });
        await save();
        return json({ ok: true });
      }

      // The picker runs in the browser and needs a short-lived token. drive.file
      // scope: it can only reach files this person picks for this app.
      if (req.method === "POST" && path === "/api/google/token") {
        if (!googleReady(env)) throw new UserError("Google isn't set up on this server yet.", 503);
        if (!s.google) return json({ error: "Connect Google first.", google: true }, 401);
        const { tokens, changed } = await googleToken(env, s.google);
        if (changed) { s.google = tokens; await save(); }
        return json({ accessToken: tokens.accessToken, pickerKey: env.GOOGLE_PICKER_KEY, appId: env.GOOGLE_APP_ID, clientId: env.GOOGLE_CLIENT_ID });
      }

      if (req.method === "POST" && path === "/api/google/disconnect") {
        if (s.google) await revokeGoogle(s.google);
        s.google = undefined;
        await save();
        return json({ ok: true });
      }

      if (req.method === "POST" && path === "/api/doc") {
        const b = await body(req, 200_000);
        let doc;
        if (b.sample === true) doc = sampleDoc();
        else if (typeof b.fileId === "string" && b.fileId) {
          if (!s.google) return json({ error: "Connect Google first.", google: true }, 401);
          const { tokens, changed } = await googleToken(env, s.google);
          if (changed) { s.google = tokens; await save(); }
          doc = await readPickedDoc(tokens.accessToken, b.fileId);
        } else if (typeof b.url === "string" && b.url.trim()) doc = await fetchDoc(b.url);
        else if (typeof b.text === "string" && b.text.trim()) doc = parsePasted(b.text.slice(0, 150_000), typeof b.title === "string" ? b.title.slice(0, 200) : undefined);
        else throw new UserError("Paste a Google Doc link first.");
        s.doc = doc;
        s.plan = undefined;
        await save();
        return json({ ok: true });
      }

      if (req.method === "POST" && path === "/api/channels") {
        const b = await body(req);
        const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
        if (!ids.length) throw new UserError("Pick at least one channel.");
        s.channelIds = ids;
        await save();
        return json({ ok: true });
      }

      if (req.method === "POST" && path === "/api/suggest") {
        if (!s.doc) throw new UserError("Choose your Google Doc first.");
        if (!hasModel(env)) throw new UserError("The AI step isn't set up on this server yet.", 503);
        const b = await board(client, s);
        if (!b.channels.length) throw new UserError("None of your Buffer channels take text posts. Connect LinkedIn, X, Threads, Bluesky, Mastodon or Facebook in Buffer first.");
        reserveModel(s, 4); // write, check, retry, check
        await save();
        const busy = busyByDay(b.queue, b.timezone);
        const publishDate = pickPublishDay(busy, b.today);
        const slots = place(busy, b.channels, publishDate, b.today);
        const { suggestions, dropped } = await suggest(env, s.doc, slots);
        const ph = placeholderChannel(b.channels)!;
        s.plan = {
          publishDate,
          reason: reasonFor(busy, publishDate, false),
          suggestions,
          placeholder: { channelId: ph.id, included: true },
          createdAt: Date.now(),
        };
        await save();
        return json({ ...view(s, b), aiReady: true, dropped });
      }

      if (req.method === "POST" && path === "/api/publish-day") {
        const p = s.plan;
        if (!p) throw new UserError("Make a plan first.");
        const req2 = await body(req);
        if (!isDate(req2.date)) throw new UserError("Pick a day on the calendar.");
        const b = await board(client, s);
        if (req2.date < addDays(b.today, 1) || req2.date > b.rangeEnd) throw new UserError("Pick a day from tomorrow to the end of the calendar.");
        const busy = busyByDay(b.queue, b.timezone);
        const unsaved = p.suggestions.filter((x) => !x.bufferId);
        const fixed: Slot[] = unsaved.map((x) => ({ slot: x.slot, role: x.role, channelId: x.channelId, service: x.service, channelName: x.channelName, date: x.date }));
        const channels = b.allChannels.filter((c) => fixed.some((f) => f.channelId === c.id));
        const placed = place(busy, channels, req2.date, b.today, fixed);
        for (const x of unsaved) {
          const np = placed.find((q) => q.slot === x.slot);
          if (np) x.date = np.date;
        }
        p.publishDate = req2.date;
        p.reason = reasonFor(busy, req2.date, true);
        await save();
        return json(view(s, b));
      }

      if (req.method === "POST" && path === "/api/revise") {
        const p = s.plan;
        if (!p || !s.doc) throw new UserError("Make a plan first.");
        const b = await body(req);
        const card = p.suggestions.find((x) => x.slot === b.slot);
        if (!card) throw new UserError("That post isn't in the plan anymore.");
        const instruction = typeof b.instruction === "string" ? b.instruction.trim().slice(0, 300) : "";
        if (instruction.length < 3) throw new UserError("Say what you'd like changed.");
        const current = typeof b.text === "string" && b.text.trim() ? { ...card, text: b.text.slice(0, 3000) } : card;
        reserveModel(s, 2); // write and check
        await save();
        const next = await revise(env, s.doc, current, instruction);
        Object.assign(card, next);
        await save();
        return json({ suggestion: card });
      }

      if (req.method === "POST" && path === "/api/save") {
        const p = s.plan;
        if (!p || !s.doc) throw new UserError("Make a plan first.");
        const b = await body(req, 60_000);
        const bd = await board(client, s);
        const earliest = addDays(bd.today, 1);
        const edits = Array.isArray(b.posts) ? (b.posts as Record<string, unknown>[]) : [];
        for (const e of edits) {
          const card = p.suggestions.find((x) => x.slot === e.slot);
          if (!card || card.bufferId) continue;
          card.included = e.included !== false;
          if (typeof e.text === "string") card.text = e.text.slice(0, 5000);
          if (isDate(e.date)) card.date = e.date;
        }
        const ph = b.placeholder as Record<string, unknown> | undefined;
        if (ph && !p.placeholder.bufferId) {
          p.placeholder.included = ph.included !== false;
          if (typeof ph.channelId === "string" && bd.allChannels.some((c) => c.id === ph.channelId)) p.placeholder.channelId = ph.channelId;
        }
        const byId = new Map(bd.allChannels.map((c) => [c.id, c]));
        const used = new Map<string, number>(); // `${date}|${channel}` -> posts we've timed there
        const timeFor = (date: string, ch: string) => {
          const n = used.get(`${date}|${ch}`) ?? 0;
          used.set(`${date}|${ch}`, n + 1);
          return ["10:00", "13:00", "16:00", "19:00"][Math.min(n, 3)];
        };
        let saved = 0;
        const savedDrafts: SavedDraft[] = [];
        // fallback fills only a field createPost left out. The line the person
        // sees is built from the post Buffer returned.
        const note = (post: CreatedPost, fallback: DraftFallback) => {
          savedDrafts.push(toSavedDraft(post, bd.timezone, fallback));
        };
        const todo: Suggestion[] = p.suggestions.filter((x) => x.included && !x.bufferId);
        for (const card of todo) {
          card.error = undefined;
          const ch = byId.get(card.channelId);
          if (!ch) { card.error = "That channel isn't connected in Buffer anymore."; continue; }
          if (!card.text.trim()) { card.error = "This post is empty."; continue; }
          if (card.text.length > (LIMITS[ch.service] ?? 500)) { card.error = `Too long for ${serviceName(ch.service)} (${card.text.length} of ${LIMITS[ch.service] ?? 500} characters).`; continue; }
          if (card.date < earliest || card.date > addDays(bd.today, 90)) { card.error = "Move this one to a day from tomorrow on."; continue; }
          const dueAt = zonedIso(card.date, timeFor(card.date, ch.id), bd.timezone);
          try {
            const post = await createDatedDraft(client, { channelId: ch.id, service: ch.service, text: card.text, dueAt });
            card.bufferId = post.id;
            note(post, { channelId: ch.id, service: ch.service, channelName: ch.name, dueAt, text: card.text });
            saved++;
          } catch (err) {
            if (err instanceof NeedsReconnect || err instanceof RateLimited) throw err;
            card.error = err instanceof Error ? err.message.replace(/^Buffer API: /, "") : "Buffer didn't take it.";
          }
          await save();
        }
        if (p.placeholder.included && !p.placeholder.bufferId) {
          p.placeholder.error = undefined;
          const ch = byId.get(p.placeholder.channelId);
          if (!ch) p.placeholder.error = "Pick a channel for the placeholder.";
          else if (p.publishDate < earliest) p.placeholder.error = "Pick a publish day from tomorrow on.";
          else {
            const dueAt = zonedIso(p.publishDate, "08:00", bd.timezone);
            const text = placeholderText(s, env.APP_NAME || "Longform");
            try {
              const post = await createDatedDraft(client, { channelId: ch.id, service: ch.service, text, dueAt });
              p.placeholder.bufferId = post.id;
              note(post, { channelId: ch.id, service: ch.service, channelName: ch.name, dueAt, text });
              saved++;
            } catch (err) {
              if (err instanceof NeedsReconnect || err instanceof RateLimited) throw err;
              p.placeholder.error = err instanceof Error ? err.message.replace(/^Buffer API: /, "") : "Buffer didn't take it.";
            }
          }
        }
        await save();
        const failed = todo.filter((x) => x.error).length + (p.placeholder.error ? 1 : 0);
        return json({ ...view(s, bd), saved, failed, savedDrafts: orderSavedDrafts(savedDrafts) });
      }

      if (req.method === "POST" && path === "/api/reset") {
        s.plan = undefined;
        await save();
        return json({ ok: true });
      }
    } finally {
      if (client.sessionChanged) await save();
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, err.status);
    if (err instanceof DocError) return json({ error: err.message }, 400);
    if (err instanceof GoogleReconnect) {
      s.google = undefined;
      await save();
      return json({ error: err.message, google: true }, 401);
    }
    if (err instanceof ModelBusy) return json({ error: err.message }, 429);
    if (err instanceof ModelError) { console.error(err); return json({ error: "The AI step didn't answer. Try again in a minute." }, 502); }
    if (err instanceof NeedsReconnect) return json({ error: "Buffer signed you out. Connect again.", reconnect: true }, 401);
    if (err instanceof RateLimited) return json({ error: `Buffer asked us to wait ${err.retryAfterSeconds} seconds.` }, 429);
    if (err instanceof RevisionRejected) return json({ error: err.message }, 422);
    throw err;
  }
}

