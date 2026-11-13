import type { Env } from "./env";
import type { Session, Tokens } from "./session";

const AUTH_URL = "https://auth.buffer.com/auth";
const TOKEN_URL = "https://auth.buffer.com/token";
const API_URL = "https://api.buffer.com";

// Read the account, its channels and queue; create draft posts.
export const SCOPES = "account:read posts:read posts:write offline_access";

export class RateLimited extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Buffer asked us to wait ${retryAfterSeconds} seconds`);
  }
}
export class NeedsReconnect extends Error {
  constructor() {
    super("Buffer access was revoked or expired");
  }
}

export function authorizeUrl(env: Env, state: string, challenge: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", env.BUFFER_CLIENT_ID);
  u.searchParams.set("redirect_uri", `${env.APP_URL}/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") throw new NeedsReconnect();
    throw new Error(`Buffer token error: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim());
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
  };
}

export function exchangeCode(env: Env, code: string, verifier: string): Promise<Tokens> {
  return tokenRequest({
    client_id: env.BUFFER_CLIENT_ID,
    client_secret: env.BUFFER_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: `${env.APP_URL}/callback`,
    code_verifier: verifier,
  });
}

async function refresh(env: Env, tokens: Tokens): Promise<Tokens> {
  if (!tokens.refreshToken) throw new NeedsReconnect();
  const next = await tokenRequest({
    client_id: env.BUFFER_CLIENT_ID,
    client_secret: env.BUFFER_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
}

// The 15-minute window's remaining requests, from Buffer's RateLimit header.
function remaining15(res: Response): number | undefined {
  const live = res.headers.get("ratelimit") ?? "";
  const policy = res.headers.get("ratelimit-policy") ?? "";
  const names = new Map<string, number>();
  for (const p of policy.split(/,\s*(?=")/)) {
    const name = p.match(/"([^"]+)"/)?.[1];
    const w = p.match(/w=(\d+)/)?.[1];
    if (name && w) names.set(name, Number(w));
  }
  for (const p of live.split(/,\s*(?=")/)) {
    const name = p.match(/"([^"]+)"/)?.[1];
    const r = p.match(/r=(\d+)/)?.[1];
    if (name && r !== undefined && names.get(name) === 900) return Number(r);
  }
  return undefined;
}

export class BufferClient {
  public sessionChanged = false;
  public remaining?: number;
  constructor(private env: Env, private session: Session) {}

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (Date.now() >= this.session.tokens.expiresAt) {
      this.session.tokens = await refresh(this.env, this.session.tokens);
      this.sessionChanged = true;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.session.tokens.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      this.remaining = remaining15(res) ?? this.remaining;
      if (res.status === 401) throw new NeedsReconnect();
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? "60");
        if (attempt === 1 && wait <= 5) {
          await new Promise((r) => setTimeout(r, wait * 1000 + 200));
          continue;
        }
        throw new RateLimited(wait);
      }
      const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
      if (json.errors?.length) throw new Error(`Buffer API: ${json.errors.map((e) => e.message).join("; ")}`);
      return json.data as T;
    }
    throw new RateLimited(60);
  }
}
// ---- The calls the planner makes. Each asks only for the fields it uses. ----

export interface Org {
  id: string;
  name: string;
}

export async function getStart(client: BufferClient): Promise<{ orgs: Org[]; timezone?: string }> {
  const data = await client.query<{ account: { timezone?: string; organizations: Org[] } }>(
    `query Start { account { timezone organizations { id name } } }`,
  ).catch(() => client.query<{ account: { timezone?: string; organizations: Org[] } }>(`query Start { account { organizations { id name } } }`));
  return { orgs: data.account.organizations ?? [], timezone: data.account.timezone };
}

export interface Channel {
  id: string;
  service: string;
  name: string;
}

// Services that take a text-only draft. The rest need media we don't make.
export const TEXT_SERVICES = new Set(["twitter", "linkedin", "threads", "bluesky", "mastodon", "facebook", "instagram", "substack"]);

export async function getChannels(client: BufferClient, organizationId: string): Promise<{ usable: Channel[]; skipped: Channel[] }> {
  const data = await client.query<{ channels: { id: string; service: string; name?: string; displayName?: string; isDisconnected?: boolean; isLocked?: boolean }[] }>(
    `query Channels($o: OrganizationId!) { channels(input: { organizationId: $o }) { id service name displayName isDisconnected isLocked } }`,
    { o: organizationId },
  );
  const live = data.channels
    .filter((c) => c && !c.isDisconnected && !c.isLocked)
    .map((c) => ({ id: c.id, service: c.service, name: c.displayName || c.name || c.service }));
  return { usable: live.filter((c) => TEXT_SERVICES.has(c.service)), skipped: live.filter((c) => !TEXT_SERVICES.has(c.service)) };
}

export interface QueueItem {
  id: string;
  channelId: string;
  dueAt: string; // ISO
  status: string; // scheduled | draft
  text: string;
}

type PostsPage = {
  posts: {
    edges: { node: { id: string; channelId?: string; dueAt?: string; status?: string; text?: string } }[];
    pageInfo?: { hasNextPage: boolean; endCursor?: string };
  };
};

// Scheduled posts and dated drafts between two instants. Verified 2026-11-12
// against the live API: posts accepts filter.dueAt { start, end } with status.
// If Buffer ever rejects the date filter, fall back to paging by status and
// filtering here (the query Slop Cannon has run in production).
export async function getQueue(client: BufferClient, organizationId: string, start: string, end: string): Promise<{ items: QueueItem[]; complete: boolean }> {
  const read = async (withDates: boolean): Promise<{ items: QueueItem[]; complete: boolean }> => {
    const out: QueueItem[] = [];
    let complete = false;
    let after: string | undefined;
    for (let page = 0; page < 5; page++) {
      const data = await client.query<PostsPage>(
        withDates
          ? `query Queue($o: OrganizationId!, $after: String, $s: DateTime, $e: DateTime) {
              posts(first: 100, after: $after, input: { organizationId: $o, filter: { status: [scheduled, draft], dueAt: { start: $s, end: $e } }, sort: [{ field: dueAt, direction: asc }] }) {
                edges { node { id channelId dueAt status text } }
                pageInfo { hasNextPage endCursor }
              }
            }`
          : `query Queue($o: OrganizationId!, $after: String) {
              posts(first: 100, after: $after, input: { organizationId: $o, filter: { status: [scheduled, draft] } }) {
                edges { node { id channelId dueAt status text } }
                pageInfo { hasNextPage endCursor }
              }
            }`,
        withDates ? { o: organizationId, after, s: start, e: end } : { o: organizationId, after },
      );
      for (const { node } of data.posts.edges) {
        if (!node.dueAt) continue;
        out.push({ id: node.id, channelId: node.channelId ?? "", dueAt: node.dueAt, status: node.status ?? "scheduled", text: (node.text ?? "").slice(0, 140) });
      }
      if (!data.posts.pageInfo?.hasNextPage) { complete = true; break; }
      after = data.posts.pageInfo.endCursor;
    }
    const s = Date.parse(start), e = Date.parse(end);
    return { items: out.filter((p) => { const t = Date.parse(p.dueAt); return t >= s && t <= e; }), complete };
  };
  try {
    return await read(true);
  } catch (err) {
    if (err instanceof NeedsReconnect || err instanceof RateLimited) throw err;
    console.error(`date filter refused, paging instead: ${err instanceof Error ? err.message : String(err)}`);
    return read(false);
  }
}

// The post createPost actually stored. The confirmation is built from this,
// not from the time and channel we asked for.
export interface CreatedPost {
  id: string;
  dueAt?: string;
  text?: string;
  channelId?: string;
  channelService?: string;
  channel?: { id?: string; service?: string; name?: string; displayName?: string | null };
}

// One dated draft. Verified 2026-11-12 against the live API: customScheduled
// with dueAt and saveToDraft keeps the date and stays a draft.
export async function createDatedDraft(
  client: BufferClient,
  p: { channelId: string; service: string; text: string; dueAt: string },
): Promise<CreatedPost> {
  const metadata: Record<string, unknown> = {};
  if (p.service === "facebook") metadata.facebook = { type: "post" };
  if (p.service === "instagram") metadata.instagram = { type: "post", shouldShareToFeed: true };
  const data = await client.query<{ createPost: { post?: CreatedPost; message?: string } }>(
    `mutation Draft($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id dueAt text channelId channelService channel { id service name displayName } } }
        ... on MutationError { message }
      }
    }`,
    {
      input: {
        channelId: p.channelId,
        text: p.text,
        schedulingType: "automatic",
        mode: "customScheduled",
        dueAt: p.dueAt,
        saveToDraft: true,
        ...(Object.keys(metadata).length ? { metadata } : {}),
      },
    },
  );
  const post = data.createPost.post;
  if (!post?.id) throw new Error(data.createPost.message ?? "Buffer didn't take that draft");
  return post;
}
