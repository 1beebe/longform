import { test } from "node:test";
import assert from "node:assert/strict";
import { DocIndex, fit } from "../src/guard";
import { busyByDay, pickPublishDay, place, reasonFor } from "../src/plan";
import { parseDocHtml, parsePasted, exportUrl } from "../src/doc";
import { zonedIso, localDate, addDays, weekday } from "../src/time";

const DOC = `Most teams treat the launch as the finish line. It is the starting gun. The real work is the week after, when nobody is watching and the piece either finds its readers or doesn't.

I learned this the hard way. My first long essay went out on a Friday, I posted the link once, and then I went quiet for a month.

Here is what I do now. I pick a quiet day. I tease the problem twice before it goes out. I quote one line the day after.`;

test("guard: quote must be in the doc and posts must be mostly theirs", () => {
  const ix = new DocIndex(DOC);
  assert.equal(ix.hasQuote("It is the starting gun."), true);
  assert.equal(ix.hasQuote("It’s the starting gun."), false);
  assert.equal(ix.hasQuote("Most teams treat the launch as the finish line ... It is the starting gun"), true);
  const theirs = "Most teams treat the launch as the finish line. It is the starting gun.";
  assert.equal(ix.passes(theirs, "It is the starting gun.").ok, true);
  const rewritten = "Launching is just the beginning, friends! Here are five hot tips to boost engagement today.";
  assert.equal(ix.passes(rewritten, "It is the starting gun.").ok, false);
  assert.equal(ix.passes(`${theirs}\n\n[link]`, "It is the starting gun.").ok, true);
});

test("fit trims whole sentences and keeps [link]", () => {
  const long = "One sentence here. ".repeat(20) + "\n\n[link]";
  const out = fit(long, "twitter")!;
  assert.ok(out.length <= 280);
  assert.ok(out.endsWith("[link]"));
});

test("time: zoned ISO handles DST", () => {
  assert.equal(zonedIso("2026-12-01", "10:00", "America/New_York"), "2026-12-01T10:00:00-05:00");
  assert.equal(zonedIso("2026-07-01", "10:00", "America/New_York"), "2026-07-01T10:00:00-04:00");
  assert.equal(zonedIso("2026-12-01", "10:00", "UTC"), "2026-12-01T10:00:00+00:00");
  assert.equal(localDate(Date.parse("2026-12-01T03:00:00Z"), "America/New_York"), "2026-11-30");
});

test("gap finder picks a clear mid-week day and places six roles without clashes", () => {
  const today = "2026-11-12"; // Thursday
  const q = (d: string, ch = "li") => ({ id: d + ch, channelId: ch, dueAt: `${d}T15:00:00Z`, status: "scheduled", text: "x" });
  const queue = [q("2026-11-17"), q("2026-11-18"), q("2026-11-19"), q("2026-11-24", "x"), q("2026-11-25"), q("2026-11-26")];
  const busy = busyByDay(queue, "UTC");
  const p = pickPublishDay(busy, today);
  assert.ok(p >= addDays(today, 3));
  assert.ok(weekday(p) <= 3, `weekday ${p}`);
  assert.ok(!busy.has(p));
  const channels = [{ id: "li", service: "linkedin", name: "LI" }, { id: "x", service: "twitter", name: "X" }];
  const slots = place(busy, channels, p, today);
  assert.equal(slots.length, 6);
  assert.equal(slots.find((s) => s.role === "launch")!.date, p);
  assert.equal(slots.find((s) => s.role === "launch")!.channelId, "li");
  const keys = slots.map((s) => `${s.date}|${s.channelId}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const s of slots) assert.ok(s.date > today);
  assert.match(reasonFor(busy, p, false), /^Publish \w+day, \w+ \d+\./);
  // Moving the publish day keeps channels and moves dates.
  const moved = place(busy, channels, addDays(p, 7), today, slots);
  assert.deepEqual(moved.map((s) => s.channelId), slots.map((s) => s.channelId));
  assert.equal(moved.find((s) => s.role === "launch")!.date, addDays(p, 7));
});

test("doc: Google export HTML becomes sections", () => {
  const html = `<html><head><title>My Essay</title><style>p{}</style></head><body><h1 class="c1"><span>Why it matters</span></h1><p><span>${DOC.split("\n\n")[0]}</span></p><h2><span>What I learned</span></h2><p><span>${DOC.split("\n\n")[1]}</span></p><p>${DOC.split("\n\n")[2]} &amp; more words to pass the floor of eighty words in total, which this sentence helps with nicely.</p></body></html>`;
  const d = parseDocHtml(html, "https://docs.google.com/document/d/abc/edit");
  assert.equal(d.title, "My Essay");
  assert.deepEqual(d.sections.map((s) => s.heading), ["Why it matters", "What I learned"]);
  assert.ok(d.sections[1].text.includes("& more"));
  const pasted = parsePasted(`# The Title\n\n## Opening\n\n${DOC}`);
  assert.equal(pasted.title, "The Title");
  assert.equal(pasted.sections[0].heading, "Opening");
});

test("doc: link forms", () => {
  assert.equal(exportUrl("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit?usp=sharing"), "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=html");
  assert.throws(() => exportUrl("https://example.com/x"));
});
