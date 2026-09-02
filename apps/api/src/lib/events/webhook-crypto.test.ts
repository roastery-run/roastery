import { describe, expect, it } from "vitest";
import {
  generateSecret,
  openSecret,
  sealSecret,
  signatureHeader,
  signPayload,
  timingSafeEqual,
  verifySignature,
} from "./webhook-crypto";

// 32 bytes, base64. Test-only; production holds this as a Worker secret.
const KEK = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("secret storage", () => {
  it("round-trips a sealed secret", async () => {
    const secret = generateSecret();
    const sealed = await sealSecret(KEK, secret);
    expect(sealed.ciphertext).not.toContain(secret);
    expect(await openSecret(KEK, sealed)).toBe(secret);
  });

  it("uses a fresh IV every time, so the same secret seals differently", async () => {
    // IV reuse under AES-GCM is catastrophic rather than merely weak, so this
    // asserts the property rather than trusting the call site.
    const a = await sealSecret(KEK, "whsec_same");
    const b = await sealSecret(KEK, "whsec_same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("cannot be opened with a different key", async () => {
    const sealed = await sealSecret(KEK, "whsec_secret");
    const otherKek = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    await expect(openSecret(otherKek, sealed)).rejects.toThrow();
  });

  it("refuses a missing or wrong-sized key rather than degrading", async () => {
    await expect(sealSecret(undefined, "x")).rejects.toThrow(/WEBHOOK_KEK/);
    await expect(sealSecret(btoa("short"), "x")).rejects.toThrow(/32/);
  });
});

describe("signing", () => {
  it("verifies a signature it produced", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: "evt_1", type: "orders.order.created" });
    const header = await signatureHeader(["whsec_a"], ts, body);
    expect(await verifySignature("whsec_a", header, ts, body)).toBe(true);
  });

  it("rejects a body that changed by one byte", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = await signatureHeader(["whsec_a"], ts, '{"amount":10}');
    expect(await verifySignature("whsec_a", header, ts, '{"amount":11}')).toBe(false);
  });

  it("binds the signature to the timestamp, so a captured request cannot be replayed later", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = "{}";
    const header = await signatureHeader(["whsec_a"], ts, body);
    // An attacker advancing the timestamp to escape the tolerance window
    // invalidates the signature, because the timestamp is signed material.
    expect(await verifySignature("whsec_a", header, ts + 600, body)).toBe(false);
  });

  it("rejects a signature outside the tolerance window", async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const header = await signatureHeader(["whsec_a"], old, "{}");
    expect(await verifySignature("whsec_a", header, old, "{}")).toBe(false);
  });

  it("carries both secrets during a rotation, and either verifies", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"id":"evt_2"}';
    const header = await signatureHeader(["whsec_new", "whsec_old"], ts, body);

    expect(header.split(",")).toHaveLength(2);
    // This is the whole point of the overlap: an integrator who has deployed
    // the new secret and one who has not both verify successfully.
    expect(await verifySignature("whsec_new", header, ts, body)).toBe(true);
    expect(await verifySignature("whsec_old", header, ts, body)).toBe(true);
    expect(await verifySignature("whsec_unrelated", header, ts, body)).toBe(false);
  });

  it("is stable for the same inputs", async () => {
    expect(await signPayload("s", 1700000000, "b")).toBe(await signPayload("s", 1700000000, "b"));
  });
});

describe("timingSafeEqual", () => {
  it("compares equal and unequal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
