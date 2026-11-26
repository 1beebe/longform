// A piece that's already live on any website: a blog, Medium, Ghost,
// WordPress, a personal site. Reads the article from the page's HTML: the
// structured data first (JSON-LD articleBody), then the <article> element,
// then the main content area, with menus, footers and forms taken out.
import type { Doc } from "./session";
import { DocError, buildDoc, clean, decode, htmlBlocks, type Block } from "./doc";
import { safeFetch, type SafeOptions } from "./safefetch";

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((x) => x != null);

// <meta property="og:title" content="…">, in either attribute order.
export function meta(html: string, key: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop");
    if (k && k.toLowerCase() === key.toLowerCase()) {
      const v = attr(tag, "content");
      if (v) return decode(v).trim();
    }
  }
  return undefined;
}

interface LdArticle { headline?: string; name?: string; datePublished?: string; articleBody?: string; "@type"?: string | string[] }

// JSON-LD blocks that describe an article. Parsed as data only.
export function ldArticles(html: string): LdArticle[] {
  const out: LdArticle[] = [];
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object" || depth > 4) return;
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    const o = v as Record<string, unknown>;
    const t = o["@type"];
    const types = (Array.isArray(t) ? t : [t]).map(String);
    if (types.some((x) => /Article|BlogPosting|Posting|Report|CreativeWork/i.test(x))) out.push(o as LdArticle);
    if (o["@graph"]) visit(o["@graph"], depth + 1);
    if (o.mainEntity) visit(o.mainEntity, depth + 1);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim()), 0); } catch { /* bad JSON-LD is common; skip it */ }
  }
  return out;
}

// Elements that are never the article: code, chrome, forms, embeds.
const STRIP = ["script", "style", "noscript", "template", "iframe", "object", "embed", "svg", "canvas", "form", "button", "select", "textarea", "nav", "header", "footer", "aside", "figcaption", "dialog"];

export function stripChrome(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const t of STRIP) s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}>`, "gi"), " ");
  // Short non-article blocks marked by class or role.
  s = s.replace(/<(div|section|ul|p)\b[^>]*(?:class|id|role)\s*=\s*["'][^"']*\b(?:share|social|subscribe|newsletter|related|comments?|byline-?share|cookie|banner|promo|advert|ad-slot|sidebar|breadcrumb|author-bio|navigation)\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, (m) => (m.length < 3000 ? " " : m)); // a long match is likely the article itself
  return s;
}

// The outermost <article> (first open to last close), else itemprop articleBody, else <main>, else <body>.
export function articleRegion(html: string): string {
  const a = html.search(/<article\b/i);
  const z = html.toLowerCase().lastIndexOf("</article>");
  if (a >= 0 && z > a) return html.slice(a, z);
  const ab = html.search(/itemprop\s*=\s*["']articleBody["']/i);
  if (ab >= 0) return html.slice(ab);
  const main = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i)?.[1];
  if (main) return main;
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
}

const BOILERPLATE = /^(share( this)?\b|subscribe\b|sign up\b|sign in\b|log in\b|follow\b|related\b|read more\b|read next\b|you might also like|recommended\b|advertisement\b|comments?\b|leave a (comment|reply)|posted in\b|tagged\b|filed under\b|copyright\b|©|all rights reserved|cookies?\b|thanks for reading\b|listen to this|min read$|\d+ min read)/i;

export function articleBlocks(html: string): Block[] {
  const region = articleRegion(stripChrome(html));
  return htmlBlocks(region).filter((b) => !(b.text.length < 160 && BOILERPLATE.test(b.text)));
}

function bodyFromLd(text: string): Block[] {
  return decode(text).replace(/\r/g, "").split(/\n\s*\n|\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).map((p) => ({ kind: "p" as const, text: p }));
}

const words = (blocks: Block[]) => blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);

function isoDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t) || t > Date.now() + 86_400_000 || t < Date.parse("1990-01-01")) return undefined;
  return new Date(t).toISOString();
}

export function docFromArticle(html: string, url: string): Doc {
  const ld = ldArticles(html);
  const title = clean(meta(html, "og:title") ?? ld.find((x) => x.headline)?.headline ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") || "Untitled piece";
  const date = isoDate(ld.find((x) => x.datePublished)?.datePublished)
    ?? isoDate(meta(html, "article:published_time"))
    ?? isoDate(meta(html, "datePublished"))
    ?? isoDate(meta(html, "date"))
    ?? isoDate(html.match(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/i)?.[1]);
  // The page's own markup keeps headings, so it wins when it holds the whole piece.
  let blocks = articleBlocks(html);
  const ldBody = ld.map((x) => (typeof x.articleBody === "string" ? x.articleBody : "")).sort((a, b) => b.length - a.length)[0];
  if (ldBody) {
    const fromLd = bodyFromLd(ldBody);
    if (words(fromLd) > words(blocks) * 1.3) blocks = fromLd;
  }
  // A published page repeats its title as the first heading.
  if (blocks[0]?.kind === "h" && clean(blocks[0].text) === title) blocks.shift();
  const canonical = html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i)?.[0];
  const href = canonical ? attr(canonical, "href") : undefined;
  let link = url;
  try {
    if (href) {
      const c = new URL(href, url);
      if (c.protocol === "https:" && c.hostname === new URL(url).hostname) link = c.toString();
    }
  } catch { /* keep the fetched address */ }
  let doc: Doc;
  try {
    doc = buildDoc(title, blocks, link);
  } catch (err) {
    if (err instanceof DocError) throw new DocError("Couldn't read enough of the article on that page. If it's behind a login or paywall, or the site builds the page with scripts, paste the text instead.");
    throw err;
  }
  const site = meta(html, "og:site_name") || new URL(link).hostname.replace(/^www\./, "");
  return { ...doc, source: "web", site: clean(site).slice(0, 80), publishedAt: date ?? new Date().toISOString(), dateUnknown: date ? undefined : true };
}

export async function fetchArticle(link: string, opts: Omit<SafeOptions, "accept"> = {}): Promise<Doc> {
  const res = await safeFetch(link, { ...opts, accept: ["html"] });
  if (res.status === 401 || res.status === 403) throw new DocError("That site wouldn't let the app read the page. If it's behind a login, paste the text instead.");
  if (res.status === 404 || res.status === 410) throw new DocError("That page wasn't found. Check the link.");
  if (res.status !== 200) throw new DocError(`That site didn't send the page (status ${res.status}). Try again in a minute, or paste the text instead.`);
  return docFromArticle(res.body, res.url);
}
