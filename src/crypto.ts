const enc = new TextEncoder();
const dec = new TextDecoder();

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// PKCE pair: the verifier stays on our server, Buffer only sees the S256 challenge.
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

async function aesKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(secret: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(secret),
    enc.encode(JSON.stringify(value)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(data))}`;
}

export async function unseal<T>(secret: string, sealed: string): Promise<T> {
  const [iv, data] = sealed.split(".");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await aesKey(secret),
    fromBase64(data),
  );
  return JSON.parse(dec.decode(plain)) as T;
}
