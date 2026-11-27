// Fetching a page someone pasted a link to. The link is untrusted, so every
// hop is checked: web links only, public hosts only, a few redirects, a time
// limit, a size limit, and only the content types we asked for.
import { DocError } from "./doc";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2_000_000;
export const MAX_REDIRECTS = 3;
const UA = "Mozilla/5.0 (compatible; LongformPlanner/0.1; +https://longform.lbeebe.com)";

// Hosts that are never fetched, whatever they resolve to.
const BLOCKED_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa|onion)$/i;
// Cloud metadata names; the IP form is caught by the private-range check.
const METADATA = new Set(["metadata.google.internal", "metadata", "instance-data"]);

export function privateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // not a clean address: refuse
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 // this net, private, loopback, multicast and reserved
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2))
    || (a === 198 && (b === 18 || b === 19)) // benchmarking
    || (a === 198 && b === 51 && p[2] === 100) || (a === 203 && b === 0 && p[2] === 113); // documentation
}

export function privateV6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(s)) return true; // mapped v4 written in hex: refuse rather than decode
  return /^(fc|fd|fe[89ab]|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8:") || s.startsWith("::");
}

const isV4 = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h);
const isV6 = (h: string) => h.includes(":");

// The link itself: syntax only, no network.
export function checkUrl(raw: string, ownHost?: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new DocError("That doesn't look like a link. Copy the full address, starting with https://.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new DocError("Only web links (https://) work here.");
  if (u.username || u.password) throw new DocError("Links with a username or password in them aren't allowed.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new DocError("That link uses an unusual port. Use the piece's normal web address.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (isV4(host) ? privateV4(host) : isV6(host) ? privateV6(host) : false) throw new DocError("That address points to a private network. Use the piece's public web address.");
  if (!isV4(host) && !isV6(host)) {
    if (!host.includes(".") || BLOCKED_HOST.test(host) || METADATA.has(host)) throw new DocError("That address isn't a public website. Use the piece's public web address.");
    if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) throw new DocError("That address isn't a public website. Use the piece's public web address.");
  }
  if (ownHost && host === ownHost.toLowerCase()) throw new DocError("That's a link to this app. Paste the link to your piece instead.");
  return u;
}

// What the name resolves to, via DNS over HTTPS. Every address must be public.
// Workers can't reach private networks anyway; this is the second lock.
export type Resolver = (host: string) => Promise<string[]>;

export const dohResolve: Resolver = async (host) => {
  const out: string[] = [];
  for (const type of ["A", "AAAA"]) {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new DocError("Couldn't look up that website. Try again in a minute.");
    const j = (await res.json()) as { Answer?: { type: number; data: string }[] };
    for (const a of j.Answer ?? []) if (a.type === 1 || a.type === 28) out.push(a.data);
  }
  return out;
};

export async function checkHost(u: URL, resolve: Resolver): Promise<void> {
  const host = u.hostname.toLowerCase();
  if (isV4(host) || isV6(host)) return; // already checked in checkUrl
  const ips = await resolve(host);
  if (!ips.length) throw new DocError("That website doesn't exist, or its address can't be found. Check the link.");
  if (ips.some((ip) => (isV4(ip) ? privateV4(ip) : privateV6(ip)))) throw new DocError("That address points to a private network. Use the piece's public web address.");
}

async function readCapped(res: Response, max: number): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) throw new DocError("That page is too large to read.");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new DocError("That page is too large to read.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder("utf-8").decode(all);
}

export interface Fetched { url: string; status: number; type: string; body: string }

export interface SafeOptions {
  accept: ("html" | "json")[];
  ownHost?: string;
  resolve?: Resolver;
  fetcher?: typeof fetch;
}

const TYPES = { html: /^(text\/html|application\/xhtml\+xml)\b/i, json: /^application\/(?:[\w.+-]+\+)?json\b/i };

// Follows up to MAX_REDIRECTS redirects by hand, checking each hop.
export async function safeFetch(raw: string, opts: SafeOptions): Promise<Fetched> {
  const resolve = opts.resolve ?? dohResolve;
  const doFetch = opts.fetcher ?? fetch;
  let u = checkUrl(raw, opts.ownHost);
  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    await checkHost(u, resolve);
    let res: Response;
    try {
      res = await doFetch(u.toString(), {
        redirect: "manual",
        signal: deadline,
        headers: { "User-Agent": UA, Accept: opts.accept.includes("json") ? "application/json" : "text/html,application/xhtml+xml" },
      });
    } catch (err) {
      if (err instanceof DocError) throw err;
      throw new DocError(deadline.aborted ? "That site took too long to answer. Try again, or paste the text instead." : "Couldn't reach that site. Check the link and try again.");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new DocError("That link redirects too many times. Open it in your browser and copy the final address.");
      u = checkUrl(new URL(res.headers.get("location")!, u).toString(), opts.ownHost);
      continue;
    }
    const type = (res.headers.get("content-type") ?? "").trim();
    if (res.ok && !opts.accept.some((k) => TYPES[k].test(type))) {
      await res.body?.cancel().catch(() => undefined);
      throw new DocError("That link isn't a web page (it looks like a file or something else). Paste the link to the article itself.");
    }
    const body = res.ok ? await readCapped(res, MAX_BYTES) : (await res.body?.cancel().catch(() => undefined), "");
    return { url: u.toString(), status: res.status, type, body };
  }
}
