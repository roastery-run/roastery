/**
 * Signing secrets: storage and use.
 *
 * A webhook secret is the one credential in this system that cannot be hashed.
 * We have to reproduce it to SIGN with it, so the one-way digest that protects
 * API keys is simply not available here. The next best thing is envelope
 * encryption: the secret is stored as AES-GCM ciphertext under a key-encryption
 * key that lives as a Worker secret, so a leaked database dump is missing the
 * one thing needed to forge a customer's webhooks.
 */

const KEK_BYTES = 32;

export type SealedSecret = { ciphertext: string; iv: string };

function b64encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function b64decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function importKek(kek: string | undefined): Promise<CryptoKey> {
  if (!kek) {
    throw new Error("WEBHOOK_KEK is not configured; webhook secrets cannot be stored safely");
  }
  const raw = b64decode(kek);
  if (raw.length !== KEK_BYTES) {
    throw new Error(`WEBHOOK_KEK must be ${KEK_BYTES} base64-encoded bytes`);
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealSecret(kek: string | undefined, secret: string): Promise<SealedSecret> {
  const key = await importKek(kek);
  // A fresh IV per encryption. Reusing one under AES-GCM is catastrophic, not
  // merely weak, so it is generated here and never derived from anything.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(secret),
  );
  return { ciphertext: b64encode(new Uint8Array(ciphertext)), iv: b64encode(iv) };
}

export async function openSecret(kek: string | undefined, sealed: SealedSecret): Promise<string> {
  const key = await importKek(kek);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(sealed.iv) as BufferSource },
    key,
    b64decode(sealed.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/** A new endpoint secret. Shown to the caller once and never again. */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `whsec_${toHex(bytes.buffer)}`;
}

/**
 * The signature over one delivery.
 *
 * Signing `${timestamp}.${body}` rather than the body alone is what makes a
 * captured request unusable later: a receiver that checks the timestamp is in
 * a tolerance window will reject a replay, and because the timestamp is inside
 * the signed material an attacker cannot advance it.
 */
export async function signPayload(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return toHex(mac);
}

/**
 * Builds the `Roastery-Signature` header value.
 *
 * During a rotation overlap this carries TWO values. That is the entire point:
 * an integrator cannot deploy a new secret at the same instant we start using
 * it, so for the overlap window either signature verifies and neither side has
 * to coordinate a cutover.
 */
export async function signatureHeader(
  secrets: string[],
  timestamp: number,
  body: string,
): Promise<string> {
  const signatures = await Promise.all(secrets.map((s) => signPayload(s, timestamp, body)));
  return signatures.map((sig) => `v1=${sig}`).join(", ");
}

/**
 * Reference verifier — the code an integrator writes, published in the docs
 * and used by our own tests so the documented procedure is the tested one.
 */
export async function verifySignature(
  secret: string,
  header: string,
  timestamp: number,
  body: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = await signPayload(secret, timestamp, body);
  const offered = header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  // Constant-time compare per candidate. A byte-by-byte early return here
  // would leak the correct prefix to anyone willing to send enough requests.
  return offered.some((candidate) => timingSafeEqual(candidate, expected));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
