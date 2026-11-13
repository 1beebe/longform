// Local preview with fixture data: no Buffer, no AI. `npm run preview`, then open :8788.
import http from "node:http";
import { readFileSync } from "node:fs";
import { appPage } from "../src/page";
import { busyByDay, pickPublishDay, place, reasonFor, placeholderChannel } from "../src/plan";
import { addDays, localDate, mondayOf } from "../src/time";
import { LIMITS } from "../src/guard";

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
const label: Record<string, string> = { linkedin: "LinkedIn", twitter: "X", threads: "Threads", substack: "Substack" };
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
const signedIn = process.env.STATE !== "out";
const withDoc = process.env.STATE !== "nodoc";
const me = () => ({
  signedIn, org: "My Organization", orgs: [{ id: "o", name: "My Organization" }], organizationId: "o", aiReady: true, google: { ready: true, connected: process.env.GOOGLE === "on" },
  doc: withDoc ? { title: "[Sample long-form title]", url: "https://docs.google.com/document/d/sample/edit", words: 1840, sections, picked: true, fileId: "sample", modifiedTime: new Date(Date.now() - 2 * 3600e3).toISOString() } : null,
  plan: withDoc && process.env.STATE !== "noplan" ? plan : null,
  board: withDoc ? { today, rangeStart, rangeEnd, timezone: tz, channels: channels.map((c) => ({ ...c, label: label[c.service], selected: true })), skipped: [], queue: queue.map((x) => ({ ...x, date: localDate(Date.parse(x.dueAt), tz) })) } : null,
  limits: LIMITS,
});

http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  const send = (type: string, body: string, status = 200) => { res.writeHead(status, { "Content-Type": type }); res.end(body); };
  if (url.pathname === "/app.css") return send("text/css", readFileSync("public/app.css", "utf8"));
  if (url.pathname === "/app.js") return send("text/javascript", readFileSync("public/app.js", "utf8"));
  if (url.pathname === "/favicon.svg") return send("image/svg+xml", readFileSync("public/favicon.svg", "utf8"));
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
    plan.suggestions.forEach((s: any, i: number) => { if (i < 5) s.bufferId = `b${i}`; else s.error = "Buffer API: sample error for the preview"; });
    plan.placeholder.bufferId = "bp";
    return send("application/json", JSON.stringify({ ...me(), saved: 6, failed: 1 }));
  }
  if (url.pathname.startsWith("/api/")) return send("application/json", "{}");
  send("text/html", appPage("Longform"));
}).listen(Number(process.env.PORT ?? 8788));
