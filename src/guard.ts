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

// Support checks: a post may summarize or rephrase the draft, but not add to it.
// Function words and neutral framing words never count as new material.
const STOP = new Set(("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each even every few for from further get gets got had has have having he her here hers him his how if in into is it its itself just let lets like make makes made many may more most much must new no nor not now of off on once one only or other our out over own same she should so some such than that the their theirs them then there these they this those through to too under until up upon very was way we well were what when where which while who whom why will with within without would yet you your yours " +
  "piece post essay article draft read reading reader readers writer writes wrote write written writing here's what's that's it's there's don't doesn't isn't aren't can't won't didn't today week thing things really still ever never always often").split(" "));
const FIRST_PERSON = /(^| )(i|i'm|i've|i'd|i'll|me|my|mine|myself)( |$)/;
const TAKEAWAYS = ["the lesson", "lesson learned", "takeaway", "changed my mind", "keep thinking", "stop thinking", "here's the thing", "the truth is", "game changer", "game-changer", "let that sink in", "what do you think", "thoughts?", "agree?"];
export const MAX_NEW = 0.4; // share of content words that may be new: room to rephrase; the AI check handles meaning

const stem = (w: string) => w.replace(/'s$/, "").replace(/(ingly|edly|ing|ed|ies|es|ly|s)$/, "") || w;
const isNumber = (w: string) => /\d/.test(w);

export class DocIndex {
  readonly text: string;
  private readonly docWords: string;
  private readonly stems = new Set<string>();
  private readonly prefixes = new Set<string>();
  private readonly numbers = new Set<string>();
  private readonly firstPerson: boolean;
  private readonly asks: boolean;

  constructor(doc: string) {
    this.text = normalize(doc);
    const w = words(doc);
    this.docWords = ` ${w.join(" ")} `;
    for (const x of w) {
      if (isNumber(x)) this.numbers.add(x.replace(/[^\d.]/g, ""));
      const st = stem(x);
      this.stems.add(st);
      if (st.length >= 5) this.prefixes.add(st.slice(0, 5));
    }
    this.firstPerson = FIRST_PERSON.test(this.docWords);
    this.asks = this.text.includes("?");
  }

  private known(w: string): boolean {
    const st = stem(w);
    return this.stems.has(st) || (st.length >= 6 && this.prefixes.has(st.slice(0, 5)));
  }

  // Content words, numbers and framings in the post that the draft never uses.
  unsupported(post: string): string | undefined {
    const w = words(post);
    const joined = ` ${w.join(" ")} `;
    const nums = w.filter(isNumber).filter((x) => !this.numbers.has(x.replace(/[^\d.]/g, "")));
    if (nums.length) return `it has numbers the draft doesn't: ${nums.join(", ")}`;
    if (!this.firstPerson && FIRST_PERSON.test(joined)) return "it speaks in the first person, but the draft doesn't";
    if (!this.asks && post.split(LINK).join("").includes("?")) return "it asks a question the draft doesn't ask";
    const lower = normalize(post);
    const added = TAKEAWAYS.find((t) => lower.includes(t) && !this.text.includes(t));
    if (added) return `it adds a framing the draft doesn't use ("${added}")`;
    const content = w.filter((x) => x.length >= 4 && !STOP.has(x));
    const fresh = [...new Set(content.filter((x) => !this.known(x)))];
    if (fresh.length > 3 && fresh.length / Math.max(1, content.length) > MAX_NEW) {
      return `it brings in words and ideas that aren't in the draft: ${fresh.slice(0, 8).join(", ")}`;
    }
    return undefined;
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
    const extra = this.unsupported(post);
    if (extra) return { ok: false, why: extra };
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
