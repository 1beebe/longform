import type { Env } from "./env";
import type { Doc, Role, Suggestion } from "./session";
import type { Slot } from "./plan";
import { DocIndex, LIMITS, LINK, fit } from "./guard";
import { generate, ModelFormatError, parseJson } from "./model";

const SERVICE_NAMES: Record<string, string> = {
  twitter: "X", linkedin: "LinkedIn", threads: "Threads", bluesky: "Bluesky", mastodon: "Mastodon", facebook: "Facebook", instagram: "Instagram", substack: "Substack Notes",
};
export const serviceName = (s: string) => SERVICE_NAMES[s] ?? s;

const ROLE_BRIEF: Record<Role, string> = {
  teaser: "goes out before the piece. Makes a reader curious about the problem the piece takes on, drawing on the opening or the setup. Doesn't give the answer away.",
  launch: `announces the piece on the day it goes out. Built from the piece's central claim. Ends with ${LINK} on its own line, where the link to the piece will go.`,
  pullquote: "uses a short exact quote from the body and frames it with a sentence that makes its point clear to someone who hasn't read the piece.",
  keyidea: "turns one idea from the body into a brief post with enough context to make the idea clear on its own.",
  followup: "goes out about a week later. Revisit a point the draft actually makes. Use a closing thought or question only if it appears in the draft.",
};

// Spoken as the account holder, who wrote the draft. The forbidden phrases are
// named here so the model avoids them; the guard rejects them if one slips through.
const VOICE = `The person publishing these posts wrote the draft. Write each post in their voice, as them, not about them.

Say the idea the way they would post it. Where the draft speaks in the first person, the post may too, for example "My take:" or "I argue", and only for things the draft says they did, thought, or felt. Where it does not, state the point directly ("Most teams treat the launch as the finish line.") instead of narrating it from outside.

Never refer to them in the third person. Do not write "the writer", "the writer's", "the author", or "the author's" (including "the writer's take", "the writer argues", "the author says", and "in this piece the writer").

Exception: if the draft is clearly someone else's published work, such as a public-domain essay that names its author, attribute the claim to that person by name ("Thoreau says"). Still never write "the writer" or "the author".`;

const SYSTEM = `You're editing someone's long-form draft into short social posts they will publish themselves. Your only tools are summarizing and rephrasing what the draft already says. Write each post for someone who hasn't read the piece: name what it's about and make one point they can follow on its own.

${VOICE}

Everything in a post must already be in the draft: every claim, opinion, feeling, experience, example, number and name. Don't add a takeaway, lesson, moral, prediction, question or call to action the draft doesn't state. Don't infer thoughts, feelings, or motives the draft doesn't state, or say they changed their mind or keep thinking about something. Use "I" only where the draft does, and only for things the draft says they did, thought, or felt. Keep their degree of certainty. Keep emoji and hashtags only if the draft has them.

Use sourceQuote for the exact excerpt that supports the post's main point. In text, rephrase or condense that point, with a sentence of context from the draft if it needs one. If a slot needs more than the draft gives you, keep the point narrow and the post short, or leave the slot out.

Your posts are checked afterwards against the draft, word by word and claim by claim. Anything the draft doesn't support gets the post thrown out. A post that talks about its author from the outside gets thrown out too.

Reply with JSON only.`;

function docBlock(doc: Doc): string {
  return doc.sections.map((s) => `## Section ${s.index}: ${s.heading}\n${s.text}`).join("\n\n").slice(0, 60_000);
}

export class RevisionRejected extends Error {}

const CHECKER = `You check social posts against the long-form draft they were made from. A post may only summarize or rephrase the draft. Flag a post if any part of it states something the draft doesn't: a claim, fact, number, name, example, opinion, feeling, experience, motive, lesson, takeaway, prediction, question or call to action. Rewording, shortening and combining things the draft says is fine. Be strict: if you can't point to where the draft says it, flag it.

Also flag a post that talks about the person who wrote the draft from the outside. That includes "the writer", "the writer's", "the author", and "the author's". Speaking as them, or stating the idea directly, is fine. If the draft is someone else's published work, naming that person (for example "Thoreau says") is fine.

Reply with JSON only.`;

function voiceNote(doc: Doc): string {
  if (!doc.sample) return "";
  return `This draft is the bundled sample: a public-domain essay by someone else, not the account holder's own piece. Attribute ideas to the person named in the title. Do not write as if the account holder lived it, and do not write "the writer" or "the author".\n\n`;
}

// A second, independent read: which posts say anything the draft doesn't?
// Returns slot -> reason. If the check itself fails, the word-level guard stands alone.
async function verify(env: Env, doc: Doc, posts: { slot: number; text: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!posts.length) return out;
  const message = `The draft, titled "${doc.title}":

${docBlock(doc)}

The posts:
${posts.map((p) => `- slot ${p.slot}: ${JSON.stringify(p.text.split(LINK).join("").trim())}`).join("\n")}

For every post, reply with a JSON array like [{"slot": 1, "supported": false, "unsupported": "the exact words in the post the draft doesn't support"}]. Use "supported": true and "unsupported": "" when the whole post is backed by the draft. Mark supported false when the post refers to its author as "the writer" or "the author" instead of speaking as them or stating the idea. Naming another person the draft is about is fine.`;
  try {
    const rows = parseJson<{ slot: number; supported?: boolean; unsupported?: string }[]>(await generate(env, CHECKER, message, 1500));
    if (!Array.isArray(rows)) throw new ModelFormatError("checker reply was not a list");
    for (const p of posts) {
      const r = rows.find((x) => x && Number(x.slot) === p.slot);
      if (!r) out.set(p.slot, "the check didn't cover it");
      else if (r.supported !== true) out.set(p.slot, `the draft doesn't support ${r.unsupported ? JSON.stringify(String(r.unsupported).slice(0, 200)) : "part of it"}`);
    }
  } catch (err) {
    console.error("support check failed", err);
  }
  return out;
}

interface Raw { slot: number; sectionIndex?: number; sourceQuote?: string; text?: string }

function slotLines(slots: Slot[]): string {
  return slots.map((s) => `- slot ${s.slot}: a ${s.role} for ${serviceName(s.service)} (at most ${LIMITS[s.service] ?? 500} characters). A ${s.role} ${ROLE_BRIEF[s.role]}`).join("\n");
}

const SHAPE = `[{"slot": 1, "sectionIndex": 2, "sourceQuote": "the exact line from the draft this post is built on", "text": "the post"}]`;

async function ask(env: Env, doc: Doc, slots: Slot[], failures?: Map<number, string>, formatRetry = false): Promise<Raw[]> {
  const retry = failures?.size
    ? `\n\nFix the issue listed for each slot. Only summarize or rephrase what the draft says, in the voice of the person who will publish it. Keep the supporting excerpt exact.\n${[...failures].map(([n, why]) => `- slot ${n}: ${why}`).join("\n")}`
    : "";
  const message = `The draft, titled "${doc.title}":

${voiceNote(doc)}${docBlock(doc)}

Write one post for each slot below. Use a different section for each post where you can. For each, give the section it came from, the exact sentence or phrase from the draft it's built on (copied character for character), and the post.

${slotLines(slots)}${retry}

Reply with a JSON array like ${SHAPE}. Escape double quotes and line breaks inside JSON strings.${formatRetry ? " Your previous reply could not be parsed. Return compact, valid JSON only." : ""}`;
  const out = parseJson<Raw[]>(await generate(env, SYSTEM, message, 3000));
  if (!Array.isArray(out)) throw new ModelFormatError("The AI reply did not contain a list of posts");
  return out.filter((item) => item && typeof item === "object");
}

function accept(raw: Raw | undefined, slot: Slot, index: DocIndex, doc: Doc): { s?: Suggestion; why?: string } {
  if (!raw?.text || !raw.sourceQuote) return { why: "no post came back" };
  let text = String(raw.text).trim();
  if (slot.role === "launch" && !text.includes(LINK)) text = `${text}\n\n${LINK}`;
  const fitted = fit(text, slot.service);
  if (!fitted) return { why: "too long for the channel" };
  const quote = String(raw.sourceQuote).trim().replace(/^["“]|["”]$/g, "");
  const check = index.passes(fitted, quote);
  if (!check.ok) return { why: check.why };
  const sectionIndex = doc.sections.some((s) => s.index === Number(raw.sectionIndex)) ? Number(raw.sectionIndex) : 0;
  return { s: { ...slot, sectionIndex, sourceQuote: quote.slice(0, 400), text: fitted, included: true } };
}

export function fullText(doc: Doc): string {
  return doc.sections.map((s) => `${s.heading}\n${s.text}`).join("\n\n");
}

// Ask once for every slot; retry the ones that fail the guard once; drop the rest.
export async function suggest(env: Env, doc: Doc, slots: Slot[]): Promise<{ suggestions: Suggestion[]; dropped: number }> {
  const index = new DocIndex(fullText(doc));
  let retriedFormat = false;
  const first = await ask(env, doc, slots).catch((err: unknown) => {
    if (!(err instanceof ModelFormatError)) throw err;
    retriedFormat = true;
    return ask(env, doc, slots, undefined, true);
  });
  const kept = new Map<number, Suggestion>();
  const failed = new Map<number, string>();
  const take = async (raws: Raw[], forSlots: Slot[]) => {
    const passed: Suggestion[] = [];
    for (const slot of forSlots) {
      const { s, why } = accept(raws.find((r) => Number(r.slot) === slot.slot), slot, index, doc);
      if (s) passed.push(s);
      else { failed.set(slot.slot, why ?? "invalid post"); console.log(`slot ${slot.slot} failed: ${why}`); }
    }
    const flagged = await verify(env, doc, passed);
    for (const s of passed) {
      const why = flagged.get(s.slot);
      if (why) { failed.set(s.slot, why); console.log(`slot ${s.slot} failed check: ${why}`); }
      else { kept.set(s.slot, s); failed.delete(s.slot); }
    }
  };
  await take(first, slots);
  if (failed.size && !retriedFormat) {
    const retrySlots = slots.filter((s) => failed.has(s.slot));
    const again = await ask(env, doc, retrySlots, new Map(failed)).catch(() => [] as Raw[]);
    await take(again, retrySlots);
  }
  const suggestions = slots.map((s) => kept.get(s.slot)).filter((s): s is Suggestion => Boolean(s));
  return { suggestions, dropped: slots.length - suggestions.length };
}

// "Ask for changes" on one card, held to the same guard.
export async function revise(env: Env, doc: Doc, card: Suggestion, instruction: string): Promise<Suggestion> {
  const index = new DocIndex(fullText(doc));
  const section = doc.sections.find((s) => s.index === card.sectionIndex);
  const message = `The draft, titled "${doc.title}":

${voiceNote(doc)}${docBlock(doc)}

This post is a ${card.role} for ${serviceName(card.service)} (at most ${LIMITS[card.service] ?? 500} characters). A ${card.role} ${ROLE_BRIEF[card.role]}
${section ? `It was built from section ${section.index}, "${section.heading}".` : ""}

The post now:
${card.text}

Requested change: ${instruction}

Apply that request by summarizing or rephrasing what the draft says, in the same voice as the rest of the posts, keeping the post self-contained. Preserve the post's main point unless the request asks for a different point supported by the draft. If the requested change needs anything the draft doesn't say (a claim, experience, opinion, takeaway or question), return {"unsupported": true} and no revised text. Do not substitute another topic. Otherwise reply with JSON only: {"sectionIndex": 3, "sourceQuote": "the exact line from the draft it's built on", "text": "the revised post"}`;
  let retry = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await generate(env, SYSTEM, message + retry, 1200);
    let raw: (Raw & { unsupported?: boolean }) | null;
    try {
      raw = parseJson<Raw & { unsupported?: boolean }>(output);
    } catch (err) {
      if (!(err instanceof ModelFormatError)) throw err;
      retry = "\n\nReturn valid JSON only. Escape quotes and line breaks inside JSON strings.";
      continue;
    }
    if (raw?.unsupported === true) {
      throw new RevisionRejected("That change would add something the article doesn’t support. Your draft was kept.");
    }
    const { s, why: lexical } = accept({ ...raw, slot: card.slot }, card, index, doc);
    const why = s ? (await verify(env, doc, [{ slot: card.slot, text: s.text }])).get(card.slot) : lexical;
    if (s && !why) return { ...card, text: s.text, sourceQuote: s.sourceQuote, sectionIndex: s.sectionIndex, included: card.included, bufferId: undefined, error: undefined };
    retry = `\n\nFix the issue with the last attempt: ${why}. Keep the supporting excerpt exact, speak as the person who will publish it, and only summarize or rephrase what the draft says.`;
  }
  throw new RevisionRejected("I couldn’t revise this post. Your draft was kept.");
}
