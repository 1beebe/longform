// Local preview with fixture data: no Buffer, no AI. `npm run preview`, then open :8788.
import http from "node:http";
import { readFileSync } from "node:fs";
import { appPage } from "../src/page";
import { busyByDay, pickPublishDay, place, reasonFor, placeholderChannel } from "../src/plan";
import { addDays, localDate, mondayOf, zonedIso } from "../src/time";
import { LIMITS } from "../src/guard";
import { orderSavedDrafts, toSavedDraft, type CreatedPost } from "../src/saved";
import { serviceName } from "../src/suggest";

const tz = "America/New_York";
const today = localDate(Date.now(), tz);
const rangeStart = mondayOf(today);
const rangeEnd = addDays(rangeStart, 41);
const channels = [
  { id: "li", service: "linkedin", name: "Sample Writer" },
  { id: "x", service: "twitter", name: "samplewriter" },
  { id: "th", service: "threads", name: "samplewriter" },
  { id: "ss", service: "substack", name: "Sample Notes" },
];
const q = (n: number, ch: string, t: string) => ({ id: `${n}${ch}`, channelId: ch, dueAt: `${addDays(today, n)}T15:00:00.000Z`, status: "scheduled", text: t });
const queue = [q(1, "li", "[Queued post]"), q(2, "x", "[Queued post]"), q(4, "li", "[Queued post]"), q(5, "th", "[Queued post]"), q(6, "x", "[Queued post]"), q(8, "li", "[Queued post]"), q(9, "th", "[Queued post]"), q(13, "x", "[Queued post]"), q(21, "li", "[Queued post]"), q(22, "x", "[Queued post]"), q(25, "li", "[Queued post]")];
const busy = busyByDay(queue, tz);
const p = pickPublishDay(busy, today);
const slots = place(busy, channels, p, today);
const sample = (i: number) => `[Placeholder: a ${slots[i].role} built from your own lines in section ${(i % 6) + 1}]`;
const sections = ["[Section heading one]", "[Section heading two]", "[Section heading three]", "[Section heading four]", "[Section heading five]", "[Closing section]"].map((heading, i) => ({ index: i + 1, heading }));
let plan: any = {
  publishDate: p,
  reason: reasonFor(busy, p, false),
  suggestions: slots.map((s, i) => ({ ...s, sectionIndex: s.role === "launch" ? 0 : (i % 6) + 1, sourceQuote: "[a line from your draft]", text: s.role === "launch" ? `${sample(i)}\n\n[link]` : sample(i), included: true })),
  placeholder: { channelId: placeholderChannel(channels)!.id, included: true },
  createdAt: Date.now(),
};
// DEMO=1 swaps the bracketed fixtures for a public-domain draft (Thoreau's
// "Walking", 1862), so screenshots for the landing page read like the real
// thing without anyone's private queue or writing in them.
const DEMO = process.env.DEMO === "1";
let docTitle = "[Sample long-form title]";
let docWords = 1840;
if (DEMO) {
  docTitle = "Walking (Thoreau, 1862)";
  docWords = 12086;
  const heads = ["Sauntering", "Four hours a day", "Westward", "In wildness", "Fields and woods"];
  sections.splice(0, sections.length, ...heads.map((heading, i) => ({ index: i + 1, heading })));
  const texts = ["Weekly reading list", "Notes from the archive", "Book club reminder", "Reading list follow-up", "Weekly reading list", "Ask me anything thread", "Notes from the archive", "Weekly reading list", "Book club reminder", "Weekly reading list", "Notes from the archive"];
  queue.forEach((x, i) => (x.text = texts[i % texts.length]));
  const posts: Record<string, { sectionIndex: number; sourceQuote: string; text: string }[]> = {
    teaser: [
      { sectionIndex: 1, sourceQuote: "I have met with but one or two persons in the course of my life who understood the art of Walking", text: "In a whole lifetime, Thoreau met only one or two people who understood the art of taking walks." },
      { sectionIndex: 2, sourceQuote: "unless I spend four hours a day at least", text: "Four hours a day, at least. That is how long Thoreau said he had to spend sauntering through woods, hills and fields, free of all worldly engagements, to keep his health and spirits." },
    ],
    launch: [{ sectionIndex: 0, sourceQuote: "I wish to speak a word for Nature, for absolute freedom and wildness", text: "Walking speaks a word for nature, for absolute freedom and wildness, as against a freedom and culture that are merely civil.\n\n[link]" }],
    pullquote: [{ sectionIndex: 4, sourceQuote: "In Wildness is the preservation of the World.", text: "Thoreau's whole case in one line: wildness is what preserves the world." }],
    keyidea: [{ sectionIndex: 3, sourceQuote: "Eastward I go only by force; but westward I go free.", text: "When Thoreau set out on a walk, he kept turning west. East he went only by force. West he went free." }],
    followup: [{ sectionIndex: 5, sourceQuote: "what would become of us, if we walked only in a garden or a mall?", text: "A week on from Walking: Thoreau asks what would become of us if we only ever walked in a garden or a mall." }],
  };
  const used: Record<string, number> = {};
  plan.suggestions = slots.map((s) => {
    const list = posts[s.role] || posts.teaser;
    const k = used[s.role] = (used[s.role] ?? -1) + 1;
    return { ...s, ...list[k % list.length], included: true };
  });
}
const signedIn = process.env.STATE !== "out";
const withDoc = process.env.STATE !== "nodoc";
const me = () => ({
  signedIn, org: "My Organization", orgs: [{ id: "o", name: "My Organization" }], organizationId: "o", aiReady: true, google: { ready: true, connected: process.env.GOOGLE === "on" },
  doc: withDoc ? { title: docTitle, url: "https://docs.google.com/document/d/sample/edit", words: docWords, sections, picked: true, fileId: "sample", modifiedTime: new Date(Date.now() - 2 * 3600e3).toISOString() } : null,
  plan: withDoc && process.env.STATE !== "noplan" ? plan : null,
  board: withDoc ? { today, rangeStart, rangeEnd, timezone: tz, channels: channels.map((c) => ({ ...c, label: serviceName(c.service), selected: true })), skipped: [], queue: queue.map((x) => ({ ...x, date: localDate(Date.parse(x.dueAt), tz) })) } : null,
  limits: LIMITS,
});

http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  const send = (type: string, body: string, status = 200) => { res.writeHead(status, { "Content-Type": type }); res.end(body); };
  if (url.pathname === "/app.css") return send("text/css", readFileSync("public/app.css", "utf8"));
  if (url.pathname === "/app.js") return send("text/javascript", readFileSync("public/app.js", "utf8"));
  if (url.pathname === "/favicon.svg") return send("image/svg+xml", readFileSync("public/favicon.svg", "utf8"));
  const bin = url.pathname.match(/^\/(shots|fonts)\/([\w.-]+\.(webp|woff2))$/);
  if (bin) {
    try { const body = readFileSync(`public/${bin[1]}/${bin[2]}`); res.writeHead(200, { "Content-Type": bin[3] === "webp" ? "image/webp" : "font/woff2" }); return res.end(body); }
    catch { return send("text/plain", "not found", 404); }
  }
  if (url.pathname === "/api/me") return send("application/json", JSON.stringify(me()));
  if (url.pathname === "/api/publish-day") {
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
      const d = JSON.parse(raw).date;
      const moved = place(busy, channels, d, today, plan.suggestions);
      for (const s of plan.suggestions) s.date = moved.find((m) => m.slot === s.slot)?.date ?? s.date;
      plan = { ...plan, publishDate: d, reason: reasonFor(busy, d, true) };
      send("application/json", JSON.stringify(me()));
    });
    return;
  }
  if (url.pathname === "/api/save") {
    // Same shape createPost returns: id, dueAt, text, and the channel.
    const used = new Map<string, number>();
    const timeFor = (date: string, ch: string) => {
      const n = used.get(`${date}|${ch}`) ?? 0;
      used.set(`${date}|${ch}`, n + 1);
      return (["10:00", "13:00", "16:00", "19:00"] as const)[Math.min(n, 3)];
    };
    const drafts = [];
    const remember = (post: CreatedPost, fallback: { channelId: string; service: string; channelName: string; dueAt: string; text: string }) => {
      drafts.push(toSavedDraft(post, tz, fallback));
    };
    plan.suggestions.forEach((s: any, i: number) => {
      if (i >= 5) { s.error = "Buffer API: sample error for the preview"; return; }
      const ch = channels.find((c) => c.id === s.channelId)!;
      const dueAt = zonedIso(s.date, timeFor(s.date, ch.id), tz);
      s.bufferId = `b${i}`;
      remember({
        id: s.bufferId, dueAt, text: s.text, channelId: ch.id, channelService: ch.service,
        channel: { id: ch.id, service: ch.service, name: ch.name, displayName: ch.name },
      }, { channelId: ch.id, service: ch.service, channelName: ch.name, dueAt, text: s.text });
    });
    const ph = channels.find((c) => c.id === plan.placeholder.channelId)!;
    const phDue = zonedIso(plan.publishDate, "08:00", tz);
    const phText = `Publish day: “${docTitle}”\n\nPlaceholder saved by Longform. Publish the piece by hand.`;
    plan.placeholder.bufferId = "bp";
    remember({
      id: "bp", dueAt: phDue, text: phText, channelId: ph.id, channelService: ph.service,
      channel: { id: ph.id, service: ph.service, name: ph.name, displayName: ph.name },
    }, { channelId: ph.id, service: ph.service, channelName: ph.name, dueAt: phDue, text: phText });
    return send("application/json", JSON.stringify({ ...me(), saved: 6, failed: 1, savedDrafts: orderSavedDrafts(drafts) }));
  }
  if (url.pathname.startsWith("/api/")) return send("application/json", "{}");
  send("text/html", appPage("Longform", !signedIn));
}).listen(Number(process.env.PORT ?? 8788));
