import { describe, expect, it } from "vitest";
import { subscriptionMatches } from "./events";
import { classifyResponse, MAX_ATTEMPTS, RETRY_DELAYS_SECONDS } from "./webhook-delivery";

describe("subscriptionMatches", () => {
  it("treats an empty subscription as everything", () => {
    // Including types added after the endpoint was created — making an
    // integrator re-opt-in for each new type is how a feed quietly stops.
    expect(subscriptionMatches([], "orders.order.created")).toBe(true);
  });

  it("matches an exact type", () => {
    expect(subscriptionMatches(["orders.order.created"], "orders.order.created")).toBe(true);
    expect(subscriptionMatches(["orders.order.created"], "orders.order.confirmed")).toBe(false);
  });

  it("matches prefix wildcards at either depth", () => {
    expect(subscriptionMatches(["inventory.*"], "inventory.green_lot.created")).toBe(true);
    expect(subscriptionMatches(["inventory.green_lot.*"], "inventory.green_lot.adjusted")).toBe(
      true,
    );
    expect(subscriptionMatches(["inventory.green_lot.*"], "inventory.roasted_lot.created")).toBe(
      false,
    );
  });

  it("does not let a wildcard leak across a name boundary", () => {
    // "orders.*" must not match a hypothetical "orders_archive" domain.
    expect(subscriptionMatches(["orders.*"], "orders_archive.thing.created")).toBe(false);
  });

  it("matches the global wildcard", () => {
    expect(subscriptionMatches(["*"], "quality.grading.recorded")).toBe(true);
  });
});

describe("classifyResponse", () => {
  const ms = 12;

  it("treats 2xx as delivered", () => {
    for (const code of [200, 201, 202, 204]) {
      expect(classifyResponse(code, 0, null, ms).kind).toBe("delivered");
    }
  });

  it("does NOT treat a redirect as success, and does not chase it", () => {
    // Following a redirect on a POST would deliver a signed payload to a host
    // the customer never registered — and a wrong URL is not transient, so
    // retrying it for eight hours is pure noise.
    const outcome = classifyResponse(302, 0, null, ms);
    expect(outcome.kind).toBe("dead");
    expect(outcome.kind === "dead" && outcome.error).toContain("register the final URL");
  });

  it("stops immediately on 410 Gone and disables the endpoint", () => {
    const outcome = classifyResponse(410, 0, null, ms);
    expect(outcome.kind).toBe("disable_endpoint");
  });

  it("does not retry a client error, which will be just as wrong in six hours", () => {
    for (const code of [400, 401, 403, 404, 422]) {
      expect(classifyResponse(code, 0, null, ms).kind).toBe("dead");
    }
  });

  it("does retry the two client errors that are actually transient", () => {
    expect(classifyResponse(408, 0, null, ms).kind).toBe("retry");
    expect(classifyResponse(429, 0, null, ms).kind).toBe("retry");
  });

  it("retries every server error", () => {
    for (const code of [500, 502, 503, 504]) {
      expect(classifyResponse(code, 0, null, ms).kind).toBe("retry");
    }
  });

  it("retries a connection failure, where nothing was learned about the receiver", () => {
    const outcome = classifyResponse(null, 0, "TimeoutError: timed out", ms);
    expect(outcome.kind).toBe("retry");
    expect(outcome.kind === "retry" && outcome.error).toContain("Timeout");
  });

  it("follows the documented schedule attempt by attempt", () => {
    const delays = RETRY_DELAYS_SECONDS.map((_, attempt) => {
      const outcome = classifyResponse(503, attempt, null, ms);
      return outcome.kind === "retry" ? outcome.delaySeconds : null;
    });
    expect(delays).toEqual(RETRY_DELAYS_SECONDS);
  });

  it("covers roughly eight hours, then gives up", () => {
    const total = RETRY_DELAYS_SECONDS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(7 * 3600);
    expect(total).toBeLessThan(9 * 3600);

    // One past the last delay: the schedule is exhausted, not extended.
    const last = classifyResponse(503, RETRY_DELAYS_SECONDS.length, null, ms);
    expect(last.kind).toBe("dead");
    expect(MAX_ATTEMPTS).toBe(RETRY_DELAYS_SECONDS.length + 1);
  });

  it("gives up on a connection failure once the schedule is exhausted", () => {
    expect(classifyResponse(null, RETRY_DELAYS_SECONDS.length, "gone", ms).kind).toBe("dead");
  });
});
