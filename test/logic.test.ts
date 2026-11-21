import { test } from "node:test";
import assert from "node:assert/strict";
import { DocIndex, LIMITS, fit, selfReference } from "../src/guard";
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

test("guard: rejects third-person references to the person who wrote the draft", () => {
  const ix = new DocIndex(DOC);
  const q = "It is the starting gun.";
  // Before: narrating the author from outside. Each of these is rejected.
  const before = [
    "The writer's take: It is the starting gun.",
    "The writer argues that it is the starting gun.",
    "The author says the real work is the week after. It is the starting gun.",
    "In this piece the writer calls it out. It is the starting gun.",
    "The author’s point: It is the starting gun.",
  ];
  for (const post of before) {
    const why = ix.passes(post, q).why ?? "";
    assert.match(why, /from outside/, post);
  }
  assert.match(selfReference("The Writer's take on the launch.") ?? "", /the writer's/i);
  // A named person is not "the writer". "authority" is not "the author".
  assert.equal(selfReference("Thoreau says the launch is the starting gun."), undefined);
  assert.equal(selfReference("The authority of a quiet day is the starting gun."), undefined);
  // After: the same points, spoken as the author or stated directly.
  const after = [
    "My take: It is the starting gun. The real work is the week after.",
    "Most teams treat the launch as the finish line. The real work is the week after. It is the starting gun.",
    "The real work is the week after, when nobody is watching. It is the starting gun.",
    "I learned this the hard way. It is the starting gun.",
    "Here is what I do now. I pick a quiet day. It is the starting gun.",
  ];
  for (const post of after) assert.equal(ix.passes(post, q).ok, true, post);
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

test("saved confirmation is built from the createPost payload", async () => {
  const { channelDraftsUrl, draftLinks, orderSavedDrafts, toSavedDraft } = await import("../src/saved");
  assert.equal(
    channelDraftsUrl("66ae4db8602872be45a280bb"),
    "https://publish.buffer.com/channels/66ae4db8602872be45a280bb/schedule?tab=drafts",
  );
  const text = "Thoreau says he has met with but one or two persons who understood the art of Walking, and that is the whole of it.";
  const draft = toSavedDraft({
    id: "p1",
    dueAt: "2026-11-30T15:00:00.000Z",
    text: `${text}\n\n[link]`,
    channelId: "ch-x",
    channel: { id: "ch-x", service: "twitter", name: "ignored-handle", displayName: "samplewriter" },
  }, "America/New_York", {
    channelId: "other", service: "linkedin", channelName: "Wrong Name", dueAt: "2026-01-01T00:00:00Z", text: "ignored text",
  });
  assert.equal(draft.id, "p1");
  assert.equal(draft.channelId, "ch-x");
  assert.equal(draft.service, "twitter");
  assert.equal(draft.channelName, "samplewriter");
  assert.equal(draft.href, channelDraftsUrl("ch-x"));
  assert.equal(draft.line, `X · samplewriter · Mon Nov 30, 10:00 AM · ${text.slice(0, 61).trimEnd()}...`);
  assert.equal(draft.line.includes("—"), false);
  const later = toSavedDraft({
    id: "p2", dueAt: "2026-12-01T13:00:00-05:00", text: "A second post.", channelId: "ch-x",
    channel: { id: "ch-x", service: "twitter", displayName: "samplewriter" },
  }, "America/New_York");
  const early = toSavedDraft({
    id: "p0", dueAt: "2026-11-27T15:00:00.000Z", text: "First.", channelId: "ch-li",
    channelService: "linkedin", channel: { id: "ch-li", service: "linkedin", name: "Sample Writer" },
  }, "America/New_York");
  const ordered = orderSavedDrafts([later, draft, early]);
  assert.deepEqual(ordered.map((d) => d.id), ["p0", "p1", "p2"]);
  assert.equal(draftLinks(ordered).length, 2);
  assert.equal(early.line.startsWith("LinkedIn · Sample Writer · Fri Nov 27, 10:00 AM · First."), true);
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

// ---- published Substack posts ----
import { substackRef, docFromPost, docFromPage, looksLikeSubstack } from "../src/substack";
import { placeAfter, reasonAfter } from "../src/plan";
import { suggest } from "../src/suggest";

const BODY = `<p>${DOC.split("\n\n")[0]}</p><div class="subscription-widget-wrap"><p>Thanks for reading! Subscribe for free to receive new posts.</p><form><input type="email"><button>Subscribe</button></form></div><h2>What I learned</h2><p>${DOC.split("\n\n")[1]}</p><figure><img src="x.png"><figcaption>A caption that isn't part of the text</figcaption></figure><p>${DOC.split("\n\n")[2]} And a few more words so the piece clears the eighty word floor with room to spare.</p><p class="button-wrapper"><a class="button"><span>Share</span></a></p>`;

test("substack: link forms", () => {
  assert.deepEqual(substackRef("https://lbeebe.substack.com/p/the-week-after?utm_source=x"), { host: "lbeebe.substack.com", slug: "the-week-after", link: "https://lbeebe.substack.com/p/the-week-after" });
  assert.equal(substackRef("https://open.substack.com/pub/lbeebe/p/the-week-after?r=abc").link, "https://lbeebe.substack.com/p/the-week-after");
  assert.equal(substackRef("https://www.example-newsletter.com/p/a-post").host, "www.example-newsletter.com");
  assert.equal(substackRef("https://substack.com/home/post/p-123456789").id, "123456789");
  assert.equal(substackRef("https://substack.com/@lbeebe/p-123456789").id, "123456789");
  assert.throws(() => substackRef("https://lbeebe.substack.com/"));
  assert.throws(() => substackRef("https://substack.com/p/x"));
  assert.throws(() => substackRef("file:///p/x"));
  assert.throws(() => substackRef("https://localhost/p/x"));
  assert.equal(looksLikeSubstack("https://docs.google.com/document/d/abc/edit"), false);
});

test("substack: post JSON becomes a published doc without the subscribe box", () => {
  const ref = substackRef("https://lbeebe.substack.com/p/the-week-after");
  const d = docFromPost({ title: "The week after", post_date: "2026-11-18T13:00:00.000Z", canonical_url: "https://lbeebe.substack.com/p/the-week-after", audience: "everyone", body_html: BODY, type: "newsletter" }, ref);
  assert.equal(d.title, "The week after");
  assert.equal(d.source, "substack");
  assert.equal(d.publishedAt, "2026-11-18T13:00:00.000Z");
  assert.equal(d.url, "https://lbeebe.substack.com/p/the-week-after");
  const all = d.sections.map((s) => s.text).join(" ");
  assert.ok(!/Thanks for reading|Subscribe|caption|Share/.test(all), all);
  assert.deepEqual(d.sections.map((s) => s.heading), ["Opening", "What I learned"]);
  assert.equal(d.preview, undefined);
  // A paid post whose free preview is too short says so.
  assert.throws(() => docFromPost({ title: "Paid", audience: "only_paid", body_html: "<p>Short teaser.</p>" }, ref), /paid subscribers/);
});

test("substack: falls back to the post page", () => {
  const ref = substackRef("https://www.example-newsletter.com/p/a-post");
  const html = `<html><head><meta property="og:title" content="A post"><script type="application/ld+json">{"datePublished":"2026-11-10T09:00:00+00:00"}</script></head><body><nav><p>Menu</p></nav><div class="available-content"><div class="body markup">${BODY}</div></div><div class="post-footer"><p>Ready for more?</p><p>A footer paragraph that should not be read as part of the piece at all.</p></div></body></html>`;
  const d = docFromPage(html, ref);
  assert.equal(d.title, "A post");
  assert.equal(d.publishedAt, "2026-11-10T09:00:00.000Z");
  const all = d.sections.map((s) => s.text).join(" ");
  assert.ok(!all.includes("Menu") && !all.includes("footer"), all);
});

test("published piece: follow-ups start tomorrow and avoid busy days", () => {
  const today = "2026-11-20";
  const q = (d: string, ch = "li") => ({ id: d + ch, channelId: ch, dueAt: `${d}T15:00:00Z`, status: "scheduled", text: "x" });
  const busy = busyByDay([q("2026-11-21"), q("2026-11-24", "x")], "UTC");
  const channels = [{ id: "li", service: "linkedin", name: "LI" }, { id: "x", service: "twitter", name: "X" }];
  const slots = placeAfter(busy, channels, today);
  assert.equal(slots.length, 5);
  assert.deepEqual(slots.map((s) => s.role), ["share", "pullquote", "keyidea", "keyidea", "followup"]);
  assert.equal(slots[0].channelId, "li");
  for (const s of slots) assert.ok(s.date > today && s.date <= addDays(today, 16));
  assert.ok(!slots.some((s) => s.date === "2026-11-21" && s.channelId === "li"));
  const keys = slots.map((s) => `${s.date}|${s.channelId}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.match(reasonAfter(busy, "2026-11-18", today, slots), /^Published on Wednesday, Nov 18\. Follow-ups run Nov \d+ to (Dec )?\d+/);
  assert.match(reasonAfter(busy, "2025-03-02", today, slots), /^Published on Mar 2, 2025\./);
});

test("fit holds back room for a real link", () => {
  const text = "A short opening line about launches. A second sentence that adds a little more length to it.\n\n[link]";
  assert.equal(fit(text, "twitter"), text);
  const out = fit(text, "twitter", 200)!;
  assert.ok(out.length <= 80 && out.endsWith("[link]"), out);
});

test("published piece: posts get the post's real link, not [link]", async () => {
  const url = "https://lbeebe.substack.com/p/the-week-after";
  const doc = docFromPost({ title: "The week after", post_date: "2026-11-18T13:00:00Z", canonical_url: url, audience: "everyone", body_html: BODY }, substackRef(url));
  const kv = new Map<string, string>();
  const env = { ANTHROPIC_API_KEY: "test", SESSIONS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } } } as any;
  const replies = [
    // The writer echoes the URL once and leaves the link off once: both end with the real link.
    JSON.stringify([
      { slot: 1, sectionIndex: 1, sourceQuote: "It is the starting gun.", text: `Publishing a piece is the starting gun, not the finish line.\n\n${url}` },
      { slot: 2, sectionIndex: 2, sourceQuote: "I pick a quiet day.", text: "Pick a quiet day, tease the problem twice before it goes out, and quote one line the day after." },
    ]),
    JSON.stringify([{ slot: 1, supported: true, unsupported: "" }, { slot: 2, supported: true, unsupported: "" }]),
  ];
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    seen.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ content: [{ type: "text", text: replies.shift() }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const slots = [
      { slot: 1, role: "share" as const, channelId: "li", service: "linkedin", channelName: "LI", date: "2026-11-21" },
      { slot: 2, role: "keyidea" as const, channelId: "x", service: "twitter", channelName: "X", date: "2026-11-23" },
    ];
    const { suggestions, dropped } = await suggest(env, doc, slots);
    assert.equal(dropped, 0);
    for (const s of suggestions) {
      assert.ok(s.text.endsWith(`\n\n${url}`), s.text);
      assert.ok(!s.text.includes("[link]"));
      assert.equal(s.text.split(url).length, 2, "link appears once");
      assert.ok(s.text.length <= LIMITS[s.service]);
    }
    assert.match(seen[0], /already published/);
    // The checker never sees the address.
    assert.ok(!seen[1].includes(url));
  } finally {
    globalThis.fetch = realFetch;
  }
});
