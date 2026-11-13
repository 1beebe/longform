import type { Doc, Section } from "./session";

export class DocError extends Error {}

const MAX_CHARS = 120_000;

// Accepts a normal Google Docs link (shared "anyone with the link can view")
// or a "Publish to the web" link. Returns the export URL to read.
export function exportUrl(link: string): string {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    throw new DocError("That doesn't look like a link. Paste the Google Doc's address.");
  }
  if (u.hostname !== "docs.google.com") throw new DocError("Paste a Google Docs link (docs.google.com).");
  const published = u.pathname.match(/^\/document\/d\/e\/([\w-]+)\/pub/);
  if (published) return `https://docs.google.com/document/d/e/${published[1]}/pub`;
  const id = u.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/)?.[1];
  if (!id) throw new DocError("That link isn't to a Google Doc. Open the doc and copy its address.");
  return `https://docs.google.com/document/d/${id}/export?format=html`;
}

export async function fetchDoc(link: string): Promise<Doc> {
  const res = await fetch(exportUrl(link), { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; LongformPlanner/0.1)" } });
  const finalHost = new URL(res.url || "https://docs.google.com").hostname;
  if (res.status === 401 || res.status === 403 || res.status === 404 || finalHost === "accounts.google.com") {
    throw new DocError("That doc is private. In Google Docs, click Share, set General access to \"Anyone with the link\", then try again.");
  }
  if (!res.ok) throw new DocError(`Google Docs didn't send the doc (status ${res.status}). Try again in a minute.`);
  const html = (await res.text()).slice(0, 3_000_000);
  if (/accounts\.google\.com\/(?:ServiceLogin|v3\/signin)/.test(html) && !/<h[1-6]|<p/i.test(html)) {
    throw new DocError("That doc is private. In Google Docs, click Share, set General access to \"Anyone with the link\", then try again.");
  }
  return parseDocHtml(html, link);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };

export function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function clean(inner: string): string {
  return decode(inner.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function parseDocHtml(html: string, url: string): Doc {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || "Untitled doc";
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  const blocks: { kind: "h" | "p"; text: string }[] = [];
  const re = /<(h[1-3]|h[4-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (let m; (m = re.exec(body)); ) {
    const text = clean(m[2]);
    if (!text) continue;
    blocks.push({ kind: /^h[1-3]$/i.test(m[1]) ? "h" : "p", text });
  }
  // A published doc repeats its title as a heading; drop that one.
  if (blocks[0]?.kind === "h" && blocks[0].text === title) blocks.shift();
  return buildDoc(title, blocks, url);
}

// Pasted text: lines starting with # are headings, as are short lines with no
// closing punctuation that sit alone between blank lines.
export function parsePasted(text: string, title?: string): Doc {
  const paras = text.replace(/\r/g, "").split(/\n\s*\n|\n(?=#)/).map((p) => p.trim()).filter(Boolean);
  const blocks: { kind: "h" | "p"; text: string }[] = [];
  for (const p of paras) {
    const lines = p.split("\n");
    if (/^#{1,3}\s/.test(lines[0])) {
      blocks.push({ kind: "h", text: lines[0].replace(/^#+\s*/, "").trim() });
      if (lines.length > 1) blocks.push({ kind: "p", text: lines.slice(1).join(" ").replace(/\s+/g, " ").trim() });
    } else if (lines.length === 1 && p.length < 80 && !/[.!?:;,"”’)]$/.test(p)) {
      blocks.push({ kind: "h", text: p });
    } else {
      blocks.push({ kind: "p", text: p.replace(/\s+/g, " ") });
    }
  }
  let t = title?.trim();
  if (!t && blocks[0]?.kind === "h") t = blocks.shift()!.text;
  return buildDoc(t || "Pasted draft", blocks, "");
}

export function buildDoc(title: string, blocks: { kind: "h" | "p"; text: string }[], url: string): Doc {
  const sections: Section[] = [];
  let cur: Section | undefined;
  for (const b of blocks) {
    if (b.kind === "h") {
      cur = { index: sections.length + 1, heading: b.text.slice(0, 160), text: "" };
      sections.push(cur);
    } else {
      if (!cur) {
        cur = { index: 1, heading: "Opening", text: "" };
        sections.push(cur);
      }
      cur.text = cur.text ? `${cur.text}\n\n${b.text}` : b.text;
    }
  }
  let kept = sections.filter((s) => s.text.trim());
  // No headings at all: split the text into parts of about five paragraphs.
  if (kept.length === 1 && !blocks.some((b) => b.kind === "h")) {
    const paras = kept[0].text.split("\n\n");
    kept = [];
    for (let i = 0; i < paras.length; i += 5) kept.push({ index: kept.length + 1, heading: `Part ${kept.length + 1}`, text: paras.slice(i, i + 5).join("\n\n") });
  }
  kept.forEach((s, i) => (s.index = i + 1));
  let total = 0;
  for (const s of kept) {
    if (total + s.text.length > MAX_CHARS) s.text = s.text.slice(0, Math.max(0, MAX_CHARS - total));
    total += s.text.length;
  }
  kept = kept.filter((s) => s.text);
  const words = kept.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  if (words < 80) throw new DocError("That doc is too short to plan around. It needs at least a few paragraphs.");
  return { url, title: title.slice(0, 200), words, sections: kept, loadedAt: Date.now() };
}
