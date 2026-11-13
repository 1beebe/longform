import type { Env } from "./env";
import type { Doc, Role, Suggestion } from "./session";
import type { Slot } from "./plan";
import { DocIndex, LIMITS, LINK, fit } from "./guard";
import { generate, parseJson } from "./model";

const SERVICE_NAMES: Record<string, string> = {
  twitter: "X", linkedin: "LinkedIn", threads: "Threads", bluesky: "Bluesky", mastodon: "Mastodon", facebook: "Facebook", instagram: "Instagram", substack: "Substack Notes",
};
export const serviceName = (s: string) => SERVICE_NAMES[s] ?? s;

const ROLE_BRIEF: Record<Role, string> = {
  teaser: "goes out before the piece. Makes a reader curious about the problem the piece takes on, drawing on the opening or the setup. Doesn't give the answer away.",
  launch: `announces the piece on the day it goes out. Built from the piece's central claim. Ends with ${LINK} on its own line, where the writer will paste the link.`,
  pullquote: "uses a short exact quote from the body and frames it with a sentence that makes its point clear to someone who hasn't read the piece.",
  keyidea: "turns one idea from the body into a brief post with enough context to make the idea clear on its own.",
  followup: "goes out about a week later. A closing thought, or a question the piece ends on, from the last part of the draft.",
};

const SYSTEM = `You're an editor adapting a writer's long-form piece into short social posts. Write each post for someone who hasn't read the piece. Give it a clear opening, name what it's about, and develop one point the reader can understand on its own.

Keep the writer's voice and meaning. Rephrase where needed and supply missing context using details from the draft. Use sourceQuote for the exact supporting excerpt. In text, turn the idea into a complete post, with framing around any quote you include. Don't add facts, claims, numbers, names, emoji or hashtags that aren't in the draft. Don't add a call to action unless the draft has one.

Reply with JSON only.`;

function docBlock(doc: Doc): string {
  return doc.sections.map((s) => `## Section ${s.index}: ${s.heading}\n${s.text}`).join("\n\n").slice(0, 60_000);
}

interface Raw { slot: number; sectionIndex?: number; sourceQuote?: string; text?: string }

function slotLines(slots: Slot[]): string {
  return slots.map((s) => `- slot ${s.slot}: a ${s.role} for ${serviceName(s.service)} (at most ${LIMITS[s.service] ?? 500} characters). A ${s.role} ${ROLE_BRIEF[s.role]}`).join("\n");
}

const SHAPE = `[{"slot": 1, "sectionIndex": 2, "sourceQuote": "the exact line from the draft this post is built on", "text": "the post"}]`;

async function ask(env: Env, doc: Doc, slots: Slot[], failures?: Map<number, string>): Promise<Raw[]> {
  const retry = failures?.size
    ? `\n\nFix the issue listed for each slot. Keep the supporting excerpt exact and write a standalone post.\n${[...failures].map(([n, why]) => `- slot ${n}: ${why}`).join("\n")}`
    : "";
  const message = `The draft, titled "${doc.title}":

${docBlock(doc)}

Write one post for each slot below. Use a different section for each post where you can. For each, give the section it came from, the exact sentence or phrase from the draft it's built on (copied character for character), and the post.

${slotLines(slots)}${retry}

Reply with a JSON array like ${SHAPE}.`;
  const out = parseJson<Raw[]>(await generate(env, SYSTEM, message, 3000));
  return Array.isArray(out) ? out : [];
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
  const first = await ask(env, doc, slots);
  const kept = new Map<number, Suggestion>();
  const failed = new Map<number, string>();
  for (const slot of slots) {
    const raw = first.find((r) => Number(r.slot) === slot.slot);
    const { s, why } = accept(raw, slot, index, doc);
    if (s) kept.set(slot.slot, s);
    else { failed.set(slot.slot, why ?? "invalid post"); console.log(`slot ${slot.slot} failed: ${why}`); }
  }
  if (failed.size) {
    const again = await ask(env, doc, slots.filter((s) => failed.has(s.slot)), failed).catch(() => [] as Raw[]);
    for (const slot of slots.filter((s) => failed.has(s.slot))) {
      const { s } = accept(again.find((r) => Number(r.slot) === slot.slot), slot, index, doc);
      if (s) kept.set(slot.slot, s);
    }
  }
  const suggestions = slots.map((s) => kept.get(s.slot)).filter((s): s is Suggestion => Boolean(s));
  return { suggestions, dropped: slots.length - suggestions.length };
}

// "Ask for changes" on one card, held to the same guard.
export async function revise(env: Env, doc: Doc, card: Suggestion, instruction: string): Promise<Suggestion> {
  const index = new DocIndex(fullText(doc));
  const section = doc.sections.find((s) => s.index === card.sectionIndex);
  const message = `The draft, titled "${doc.title}":

${docBlock(doc)}

This post is a ${card.role} for ${serviceName(card.service)} (at most ${LIMITS[card.service] ?? 500} characters). A ${card.role} ${ROLE_BRIEF[card.role]}
${section ? `It was built from section ${section.index}, "${section.heading}".` : ""}

The post now:
${card.text}

The writer asks: ${instruction}

Apply the writer's request while keeping the post self-contained and grounded in the draft. Reply with JSON only: {"sectionIndex": 3, "sourceQuote": "the exact line from the draft it's built on", "text": "the revised post"}`;
  let retry = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = parseJson<Raw>(await generate(env, SYSTEM, message + retry, 1200));
    const { s, why } = accept({ ...raw, slot: card.slot }, card, index, doc);
    if (s) return { ...card, text: s.text, sourceQuote: s.sourceQuote, sectionIndex: s.sectionIndex, included: card.included, bufferId: undefined, error: undefined };
    retry = `\n\nFix the issue with the last attempt: ${why}. Keep the supporting excerpt exact and write a standalone post.`;
  }
  throw new Error("I couldn’t revise this post. Your current draft is still available to edit.");
}
