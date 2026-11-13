// Google sign-in for one thing: reading the doc the person picks in Google's
// own file picker. drive.file means the app can open only files they pick.
import type { Env } from "./env";
import type { GoogleTokens } from "./session";
import { DocError, parseDocHtml } from "./doc";
import type { Doc } from "./session";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file";

export class GoogleReconnect extends Error {
  constructor() {
    super("Google access expired. Connect Google again.");
  }
}

export const googleReady = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_PICKER_KEY && env.GOOGLE_APP_ID);

export function googleAuthUrl(env: Env, state: string, challenge: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", `${env.APP_URL}/google/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") throw new GoogleReconnect();
    throw new Error(`Google token error: ${json.error ?? res.status}`);
  }
  if (json.scope && !json.scope.includes("drive.file")) throw new DocError("Google didn't give access to pick files. Connect Google again and leave the Drive box ticked.");
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
}

export function googleExchange(env: Env, code: string, verifier: string): Promise<GoogleTokens> {
  return tokenRequest({
    client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: "authorization_code",
    code, redirect_uri: `${env.APP_URL}/google/callback`, code_verifier: verifier,
  });
}

// Returns a live access token, refreshing it when needed. The caller saves the session if `changed`.
export async function googleToken(env: Env, t: GoogleTokens): Promise<{ tokens: GoogleTokens; changed: boolean }> {
  if (Date.now() < t.expiresAt) return { tokens: t, changed: false };
  if (!t.refreshToken) throw new GoogleReconnect();
  const next = await tokenRequest({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token", refresh_token: t.refreshToken });
  return { tokens: { ...next, refreshToken: next.refreshToken ?? t.refreshToken }, changed: true };
}

export async function revokeGoogle(t: GoogleTokens): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refreshToken ?? t.accessToken)}`, { method: "POST" }).catch(() => undefined);
}

// Read a Google Doc the person picked: its name and edit time, then its HTML export.
export async function readPickedDoc(accessToken: string, fileId: string): Promise<Doc> {
  if (!/^[\w-]{10,200}$/.test(fileId)) throw new DocError("That file id doesn't look right. Pick the doc again.");
  const auth = { Authorization: `Bearer ${accessToken}` };
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,modifiedTime,webViewLink`, { headers: auth });
  if (meta.status === 401) throw new GoogleReconnect();
  if (meta.status === 404 || meta.status === 403) throw new DocError("The app can't open that file. Pick it again from the Google window.");
  if (!meta.ok) throw new DocError(`Google Drive didn't answer (status ${meta.status}). Try again in a minute.`);
  const m = (await meta.json()) as { name: string; mimeType: string; modifiedTime?: string; webViewLink?: string };
  if (m.mimeType !== "application/vnd.google-apps.document") throw new DocError("That's not a Google Doc. Pick a Google Docs file.");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text%2Fhtml`, { headers: auth });
  if (!res.ok) throw new DocError(`Google Drive couldn't export that doc (status ${res.status}).`);
  const doc = parseDocHtml((await res.text()).slice(0, 3_000_000), m.webViewLink ?? `https://docs.google.com/document/d/${fileId}/edit`);
  return { ...doc, title: m.name || doc.title, fileId, modifiedTime: m.modifiedTime };
}
