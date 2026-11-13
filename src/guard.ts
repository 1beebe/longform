// The own-words guard: every suggestion has to be built from the writer's lines.

export const MIN_OWN = 0.65;
export const LINK = "[link]";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return normalize(s.split(LINK).join(" "))
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/'(?=\s|$)|(?<=\s|^)'/g, " ")
    .split(" ")
    .filter(Boolean);
}

export class DocIndex {
  readonly text: string;
  private grams = new Set<string>();
  private vocab = new Set<string>();
  constructor(doc: string) {
    this.text = normalize(doc);
    const w = words(doc);
    for (const x of w) this.vocab.add(x);
    for (let i = 0; i + 2 < w.length; i++) this.grams.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  }

  // The quote must appear word for word (an ellipsis may join two pieces).
  hasQuote(quote: string): boolean {
    const parts = normalize(quote).replace(/^["']|["']$/g, "").split(/\s*\.\.\.\s*/).map((p) => p.trim()).filter((p) => p.length >= 3);
    return parts.length > 0 && parts.every((p) => this.text.includes(p));
  }

  // Share of the post's 3-word sequences that also appear in the doc.
  ownShare(post: string): number {
    const w = words(post);
    if (!w.length) return 0;
    if (w.length < 3) return w.every((x) => this.vocab.has(x)) ? 1 : 0;
    let hit = 0;
    for (let i = 0; i + 2 < w.length; i++) if (this.grams.has(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)) hit++;
    return hit / (w.length - 2);
  }

  passes(post: string, quote: string): { ok: boolean; why?: string } {
    if (!this.hasQuote(quote)) return { ok: false, why: "its source line isn't in the doc" };
    const share = this.ownShare(post);
    if (share < MIN_OWN) return { ok: false, why: `only ${Math.round(share * 100)}% of it comes from the doc` };
    return { ok: true };
  }
}

export const LIMITS: Record<string, number> = {
  twitter: 280, threads: 500, bluesky: 300, mastodon: 500, linkedin: 1300, facebook: 1500, instagram: 2200, substack: 1000,
};

// Fit a post to a channel's limit by dropping whole sentences from the end.
export function fit(text: string, service: string): string | undefined {
  const limit = LIMITS[service] ?? 500;
  let t = text.trim();
  if (t.length <= limit) return t;
  const keepLink = t.includes(LINK);
  const body = t.split(LINK).join("").trim();
  const sentences = body.match(/[^.!?]+[.!?]+["”’)]?\s*|[^.!?]+$/g) ?? [body];
  while (sentences.length > 1) {
    sentences.pop();
    t = sentences.join("").trim() + (keepLink ? `\n\n${LINK}` : "");
    if (t.length <= limit) return t;
  }
  return undefined;
}
