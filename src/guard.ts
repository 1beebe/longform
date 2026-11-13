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
  private readonly docWords: string;

  constructor(doc: string) {
    this.text = normalize(doc);
    this.docWords = ` ${words(doc).join(" ")} `;
  }

  // The quote must appear word for word (an ellipsis may join two pieces).
  hasQuote(quote: string): boolean {
    const parts = normalize(quote).replace(/^["']|["']$/g, "").split(/\s*\.\.\.\s*/).map((p) => p.trim()).filter((p) => p.length >= 3);
    return parts.length > 0 && parts.every((p) => this.text.includes(p));
  }

  passes(post: string, quote: string): { ok: boolean; why?: string } {
    if (!this.hasQuote(quote)) return { ok: false, why: "its source line isn't in the doc" };
    const body = words(post).join(" ");
    if (!body) return { ok: false, why: "the post has no body text" };
    if (this.docWords.includes(` ${body} `)) {
      return { ok: false, why: "the post only repeats an excerpt from the doc" };
    }
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
