// PBKDF2-based password hashing using Web Crypto API (no npm deps)

const ITERATIONS = 100000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt);
  const keyBuffer = await crypto.subtle.exportKey("raw", key) as ArrayBuffer;
  const keyBytes = new Uint8Array(keyBuffer);
  return `${toHex(salt)}:${toHex(keyBytes)}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(":");
  if (!saltHex || !keyHex) return false;

  const salt = fromHex(saltHex);
  const key = await deriveKey(password, salt);
  const keyBuffer = await crypto.subtle.exportKey("raw", key) as ArrayBuffer;
  const keyBytes = new Uint8Array(keyBuffer);
  const expected = fromHex(keyHex);
  return timingSafeEqual(keyBytes, expected);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: KEY_LENGTH * 8 },
    true,
    ["encrypt"]
  );
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// JWT helpers using Web Crypto (HMAC-SHA256)

interface JWTPayload {
  sub: string;
  exp: number;
  iat: number;
}

export async function signJWT(payload: JWTPayload, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  const sigB64 = btoa(String.fromCharCode(...sig))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${data}.${sigB64}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const data = `${parts[0]}.${parts[1]}`;
  const sig = parts[2];

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Decode base64url signature
  const sigB64 = sig.replace(/-/g, "+").replace(/_/g, "/");
  const sigPadded = sigB64 + "=".repeat((4 - (sigB64.length % 4)) % 4);
  const sigBytes = Uint8Array.from(atob(sigPadded), (c) => c.charCodeAt(0));

  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
  if (!valid) return null;

  // Decode payload
  const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const payloadPadded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
  const payload: JWTPayload = JSON.parse(atob(payloadPadded));

  // Check expiry
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}
