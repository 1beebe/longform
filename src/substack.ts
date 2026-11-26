// A piece that's already live on Substack. Reads its public text through
// Substack's own post API (the same JSON its web page loads), so follow-up
// posts can be planned from what the piece actually says.
import type { Doc } from "./session";
import { DocError, buildDoc, clean, htmlBlocks, type Block } from "./doc";
import { safeFetch, type SafeOptions } from "./safefetch";
import { docFromArticle } from "./article";


export interface PostRef {
  host: string; // the publication's host: name.substack.com or its own domain
  slug?: string;
  id?: string; // substack.com/home/post/p-123 style links carry only an id
  link: string; // a clean link to the post
}

// Substack links come in a few shapes:
//   https://name.substack.com/p/slug, https://own-domain.com/p/slug
//   https://open.substack.com/pub/name/p/slug  (the app's share link)
//   https://substack.com/home/post/p-123456, https://substack.com/@name/p-123456
export function substackRef(link: string): PostRef {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    throw new DocError("That doesn't look like a link. Paste the post's address.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new DocError("Paste a web link to the post.");
  const host = u.hostname.toLowerCase();
  const open = u.pathname.match(/^\/pub\/([\w-]+)\/p\/([\w-]+)/);
  if (host === "open.substack.com" && open) {
    return { host: `${open[1].toLowerCase()}.substack.com`, slug: open[2], link: `https://${open[1].toLowerCase()}.substack.com/p/${open[2]}` };
  }
  const byId = u.pathname.match(/^\/(?:home\/post|@[\w.-]+)\/p-(\d+)/);
  if ((host === "substack.com" || host === "www.substack.com") && byId) return { host: "substack.com", id: byId[1], link: u.origin + u.pathname };
  const slug = u.pathname.match(/^\/p\/([\w-]+)\/?$/)?.[1];
  if (slug && host !== "substack.com" && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !/^(localhost|.*\.local|.*\.internal)$/.test(host)) {
    return { host, slug, link: `https://${host}/p/${slug}` };
  }
  throw new DocError("That isn't a Google Doc or a Substack post link. For Substack, open the post and copy its address (it has /p/ in it).");
}

export const looksLikeSubstack = (link: string) => {
  try {
    substackRef(link);
    return true;
  } catch {
    return false;
  }
};

interface ApiPost {
  title?: string;
  post_date?: string;
  canonical_url?: string;
  audience?: string; // "everyone" | "only_paid" | "founding" | "only_free"
  body_html?: string | null;
  truncated_body_text?: string | null;
  type?: string;
}

// Subscribe boxes, share buttons and the like that sit inside a post's HTML.
const BOILERPLATE = /^(thanks for reading\b|subscribe\b|share\b|leave a comment\b|upgrade to paid\b|this post is for paid subscribers|keep reading with a 7-day free trial|type your email|discussion about this post|ready for more\?)/i;

export function postBlocks(bodyHtml: string): Block[] {
  const body = bodyHtml
    .replace(/<(form|button|figcaption|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<div class="[^"]*(?:subscription-widget|subscribe-widget|button-wrapper|captioned-button|footnote-anchor)[^"]*"[\s\S]*?<\/div>/gi, "");
  return htmlBlocks(body).filter((b) => !(b.text.length < 200 && BOILERPLATE.test(b.text)));
}

export function docFromPost(post: ApiPost, ref: PostRef): Doc {
  if (post.type && post.type !== "newsletter" && post.type !== "podcast" && post.type !== "thread") {
    throw new DocError("That Substack link isn't a written post.");
  }
  const title = clean(post.title ?? "") || "Untitled post";
  let blocks = post.body_html ? postBlocks(post.body_html) : [];
  if (!blocks.length && post.truncated_body_text) blocks = [{ kind: "p", text: post.truncated_body_text }];
  const paywalled = Boolean(post.audience && post.audience !== "everyone" && post.audience !== "only_free");
  let doc: Doc;
  try {
    doc = buildDoc(title, blocks, post.canonical_url || ref.link);
  } catch (err) {
    if (err instanceof DocError && paywalled) {
      throw new DocError("That post is for paid subscribers, and the free preview is too short to plan around. Make it free for a moment, or paste its text instead.");
    }
    throw err;
  }
  const publishedAt = post.post_date && !Number.isNaN(Date.parse(post.post_date)) ? new Date(post.post_date).toISOString() : new Date().toISOString();
  return { ...doc, source: "substack", publishedAt, preview: paywalled || undefined };
}

// The post's own page, for publications whose API path is blocked: the
// visible article sits between the title block and the footer.
export function docFromPage(html: string, ref: PostRef): Doc {
  const title = clean(html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const start = html.search(/class="(?:available-content|body markup)"/);
  if (start < 0) throw new DocError("That page doesn't look like a Substack post. Check the link, or paste the text instead.");
  let rest = html.slice(start);
  const end = rest.search(/class="(?:post-footer|paywall|subscribe-footer)|id="discussion"/);
  if (end > 0) rest = rest.slice(0, end);
  const date = html.match(/"datePublished":"([^"]+)"/)?.[1];
  return docFromPost({ title, body_html: rest.slice(rest.indexOf(">") + 1), post_date: date, audience: /class="paywall/.test(html) ? "only_paid" : "everyone" }, ref);
}

export async function fetchSubstack(link: string, opts: Omit<SafeOptions, "accept"> = {}): Promise<Doc> {
  const ref = substackRef(link);
  const api = ref.id ? `https://substack.com/api/v1/posts/by-id/${ref.id}` : `https://${ref.host}/api/v1/posts/${ref.slug}`;
  const onSubstack = ref.host === "substack.com" || ref.host.endsWith(".substack.com");
  // A custom domain may not be Substack at all, so its API answer can be
  // anything: an error page, or a 404. Then the page itself is read.
  const res = await safeFetch(api, { ...opts, accept: ["json", "html"] }).catch((err) => {
    if (onSubstack) throw err;
    return null;
  });
  if (res?.status === 404 && onSubstack) throw new DocError("Substack couldn't find that post. Check that it's published, then copy the link again.");
  if (res && res.status === 200 && /json/i.test(res.type)) {
    let json: (ApiPost & { post?: ApiPost }) | null = null;
    try { json = JSON.parse(res.body); } catch { json = null; }
    const post = json?.post ?? json;
    if (post && typeof post === "object" && (post.body_html || post.truncated_body_text)) {
      return docFromPost(post, { ...ref, link: typeof post.canonical_url === "string" && /^https:\/\//.test(post.canonical_url) ? post.canonical_url : ref.link });
    }
  }
  if (ref.id) throw new DocError("Substack didn't send that post. Open it on the publication's own page and copy that link.");
  const page = await safeFetch(ref.link, { ...opts, accept: ["html"] });
  if (page.status !== 200) throw new DocError(`That site didn't send the post (status ${page.status}). Try again in a minute, or paste the text instead.`);
  if (/class="(?:available-content|body markup)"/.test(page.body)) return docFromPage(page.body, ref);
  return docFromArticle(page.body, page.url); // a /p/ link on a site that isn't Substack
}
