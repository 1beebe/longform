import { test } from "node:test";
import assert from "node:assert/strict";
import { DocIndex, fit } from "../src/guard";
import { busyByDay, pickPublishDay, place, reasonFor } from "../src/plan";
import { parseDocHtml, parsePasted, exportUrl } from "../src/doc";
import { zonedIso, localDate, addDays, weekday } from "../src/time";

const DOC = `Most teams treat the launch as the finish line. It is the starting gun. The real work is the week after, when nobody is watching and the piece either finds its readers or doesn't.

I learned this the hard way. My first long essay went out on a Friday, I posted the link once, and then I went quiet for a month.

Here is what I do now. I pick a quiet day. I tease the problem twice before it goes out. I quote one line the day after.`;

test("guard: accepts a standalone adaptation with an excerpt from the draft", () => {
  const ix = new DocIndex(DOC);
  const quote = "It is the starting gun.";
  assert.equal(ix.hasQuote(quote), true);
  assert.equal(ix.hasQuote("It’s the starting gun."), false);
  assert.equal(ix.hasQuote("Most teams treat the launch as the finish line ... It is the starting gun"), true);
  const adapted = "Publishing an essay is the start. What you do the following week helps it find readers.";
  assert.equal(ix.passes(adapted, quote).ok, true);
  assert.equal(ix.passes(adapted, "Launching is just the beginning.").ok, false);
  assert.equal(ix.passes("“It is the starting gun!”", quote).ok, false);
  assert.equal(ix.passes(`${quote}\n\n[link]`, quote).ok, false);
  assert.equal(ix.passes(`An essay’s launch is only the beginning. “${quote}”`, quote).ok, true);
});

test("guard: rejects posts that add to the draft", () => {
  const ix = new DocIndex(DOC);
  const q = "It is the starting gun.";
  // Numbers the draft doesn't have.
  assert.equal(ix.passes("Launch is the starting gun. 3 out of 4 essays die in the first week.", q).ok, false);
  // A question the draft never asks.
  assert.equal(ix.passes("Is your launch the finish line, or the starting gun?", q).ok, false);
  // A bolted-on takeaway.
  assert.equal(ix.passes("The launch is the starting gun. The lesson: keep going after it goes out.", q).ok, false);
  // New ideas dressed up around the quote.
  assert.equal(ix.passes("Launching is just the beginning, friends! Five hot tips to boost engagement and grow your audience.", q).ok, false);
  // Rephrasing what the draft says is fine.
  assert.equal(ix.passes("Most teams think the launch is the finish line. The real work comes the week after.", q).ok, true);
});

test("guard: first person only when the draft speaks in it", () => {
  const ix = new DocIndex("Teams treat the launch as the finish line. It is the starting gun.");
  assert.equal(ix.passes("I used to think the launch was the finish line. It is the starting gun.", "It is the starting gun.").ok, false);
  assert.equal(ix.passes("Teams treat the launch like the finish line. It is really the starting gun.", "It is the starting gun.").ok, true);
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

test("saved drafts deleted in Buffer come back as unsaved", async () => {
  const { forgetDeleted } = await import("../src/plan");
  const mk = () => ({
    publishDate: "2026-11-18", reason: "", createdAt: 0,
    placeholder: { channelId: "c1", included: true, bufferId: "ph" },
    suggestions: [
      { slot: 1, role: "teaser", channelId: "c1", service: "twitter", channelName: "x", date: "2026-11-16", text: "a", included: true, bufferId: "gone" },
      { slot: 2, role: "teaser", channelId: "c1", service: "twitter", channelName: "x", date: "2026-11-17", text: "b", included: true, bufferId: "kept" },
      { slot: 3, role: "teaser", channelId: "c1", service: "twitter", channelName: "x", date: "2026-11-13", text: "c", included: true, bufferId: "today" },
      { slot: 4, role: "teaser", channelId: "c1", service: "twitter", channelName: "x", date: "2026-11-20", text: "d", included: false },
    ],
  }) as any;
  const queue = [{ id: "kept", channelId: "c1", dueAt: "", status: "draft", text: "" }, { id: "ph", channelId: "c1", dueAt: "", status: "draft", text: "" }];
  const p = mk();
  assert.equal(forgetDeleted(p, queue, "2026-11-13", "2026-12-20", true), 1);
  assert.equal(p.suggestions[0].bufferId, undefined);
  assert.equal(p.suggestions[0].included, true);
  assert.equal(p.suggestions[1].bufferId, "kept");
  assert.equal(p.suggestions[2].bufferId, "today"); // dated today: may have been sent
  assert.equal(p.placeholder.bufferId, "ph");
  const q = mk();
  assert.equal(forgetDeleted(q, [], "2026-11-13", "2026-12-20", false), 0); // partial read: trust nothing
  assert.equal(forgetDeleted(q, [], "2026-11-13", "2026-11-17", true), 2); // gone + kept in range; ph past range end
  assert.equal(q.placeholder.bufferId, "ph");
});

test("sample piece: Walking loads as a sectioned doc", async () => {
  const { sampleDoc } = await import("../src/sample");
  const d = sampleDoc();
  assert.equal(d.sample, true);
  assert.deepEqual(d.sections.map((s) => s.heading), ["Sauntering", "Four hours a day", "Westward", "In wildness", "Useful ignorance", "We hug the earth"]);
  assert.ok(d.words > 11000 && d.words < 13000, `words ${d.words}`);
  assert.ok(d.sections[0].text.startsWith("I wish to speak a word for Nature"));
  assert.ok(d.sections[3].text.includes("in Wildness is the preservation of the World"));
});
