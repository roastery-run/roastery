import { describe, expect, it } from "vitest";
import { isBlockedAddress, webhookUrlProblem } from "./ssrf";

/**
 * A webhook endpoint is a URL a customer chooses and we then POST to, signed,
 * on a schedule. Both halves of that are the problem: it is an outbound
 * request from inside our network, and it repeats.
 */

describe("webhookUrlProblem", () => {
  it("accepts an ordinary public endpoint", () => {
    expect(webhookUrlProblem("https://hooks.example.com/roastery")).toBeNull();
    expect(webhookUrlProblem("https://example.co.uk:443/x?y=1")).toBeNull();
  });

  it("refuses anything but https", () => {
    expect(webhookUrlProblem("http://hooks.example.com")).toMatch(/https/);
  });

  it("refuses an IP literal, which cannot be re-resolved and is usually inward", () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://192.168.1.10/hook",
      "https://[::1]/hook",
    ]) {
      expect(webhookUrlProblem(url), url).toBeTruthy();
    }
  });

  it("refuses names that only resolve inside a network", () => {
    for (const url of [
      "https://localhost/hook",
      "https://db.internal/hook",
      "https://printer.local/hook",
    ]) {
      expect(webhookUrlProblem(url), url).toBeTruthy();
    }
  });

  it("refuses our own hosts, which would make fan-out a load generator", () => {
    // With a valid signature, against our own rate-limit budget, re-triggered
    // by each delivery.
    expect(webhookUrlProblem("https://api.roastery.run/rpc/v1/orders.list")).toBeTruthy();
    expect(webhookUrlProblem("https://roastery.run/")).toBeTruthy();
  });

  it("refuses credentials in the URL and unusual ports", () => {
    expect(webhookUrlProblem("https://user:pass@hooks.example.com")).toBeTruthy();
    expect(webhookUrlProblem("https://hooks.example.com:22/hook")).toBeTruthy();
  });
});

describe("isBlockedAddress", () => {
  it("blocks every range that is not the public internet", () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      // The one that matters most on a cloud host.
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "fe80::1",
      "fd00::1",
      // The same metadata address wearing an IPv6 hat.
      "::ffff:169.254.169.254",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "203.0.113.10", "172.32.0.1", "2606:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("treats anything unparseable as blocked", () => {
    // Fail closed: an address we cannot reason about is not one to POST a
    // signed payload to.
    for (const address of ["", "not-an-address", "1.2.3", "999.1.1.1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });
});
