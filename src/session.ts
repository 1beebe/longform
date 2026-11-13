import type { Env } from "./env";
import { randomToken, seal, unseal } from "./crypto";

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface Section {
  index: number; // 1-based, as the outline shows it
  heading: string;
  text: string;
}

export interface Doc {
  url: string; // the link they gave, opened by "Open the doc"
  title: string;
  words: number;
  sections: Section[];
  loadedAt: number;
  fileId?: string; // picked from Google Drive
  modifiedTime?: string; // ISO, from Drive
  sample?: boolean; // the bundled sample piece
}

export type Role = "teaser" | "launch" | "pullquote" | "keyidea" | "followup";

export interface Suggestion {
  slot: number; // stable id inside the plan
  role: Role;
  channelId: string;
  service: string;
  channelName: string;
  date: string; // YYYY-MM-DD in the account's timezone
  sectionIndex?: number; // 0 = the whole draft
  sourceQuote?: string;
  text: string;
  included: boolean;
  bufferId?: string; // set once saved
  error?: string; // why the last save failed
}

export interface Plan {
  publishDate: string; // YYYY-MM-DD
  reason: string;
  suggestions: Suggestion[];
  placeholder: { channelId: string; included: boolean; bufferId?: string; error?: string };
  createdAt: number;
}

export interface Session {
  tokens: Tokens;
  organizationId?: string;
  organizationName?: string;
  orgs?: { id: string; name: string }[];
  timezone?: string; // the Buffer account's timezone, e.g. America/New_York
  channelIds?: string[]; // channels they plan for; empty = every usable one
  doc?: Doc;
  plan?: Plan;
  google?: GoogleTokens; // drive.file only: reads the docs they pick
  modelCalls?: number[]; // when this person last called the model, for an hourly cap
}

const SESSION_TTL = 60 * 60 * 24 * 30;
const COOKIE = "sid";

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("Cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function loadSession(req: Request, env: Env): Promise<{ id: string; data: Session } | null> {
  const id = readCookie(req, COOKIE);
  if (!id) return null;
  const sealed = await env.SESSIONS.get(`s:${id}`);
  if (!sealed) return null;
  try {
    return { id, data: await unseal<Session>(env.TOKEN_KEY, sealed) };
  } catch {
    return null;
  }
}

export async function saveSession(env: Env, id: string, data: Session): Promise<void> {
  await env.SESSIONS.put(`s:${id}`, await seal(env.TOKEN_KEY, data), { expirationTtl: SESSION_TTL });
}

export async function createSession(env: Env, data: Session): Promise<string> {
  const id = randomToken(24);
  await saveSession(env, id, data);
  return cookie(COOKIE, id, SESSION_TTL);
}

export async function destroySession(req: Request, env: Env): Promise<string> {
  const id = readCookie(req, COOKIE);
  if (id) await env.SESSIONS.delete(`s:${id}`);
  return cookie(COOKIE, "", 0);
}
