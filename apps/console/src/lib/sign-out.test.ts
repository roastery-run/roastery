import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing out has to leave nothing behind.
 *
 * The console shipped without any sign-out at all, on a product whose auth is
 * passwordless precisely because it expects shared shop-floor terminals. A
 * seven-day session and a day of cached orders stayed with whoever last used
 * the machine.
 *
 * What is checked here is the clearing, not the button: three separate stores
 * hold something a second person could see, and forgetting any one of them
 * leaves the same exposure with a signed-out header.
 */

const KEYS = {
  cache: "roastery.query-cache.v1",
  owner: "roastery.query-cache.owner",
  org: "roastery.org",
  location: "roastery.location",
};

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe("clearClientState", () => {
  let store: Storage;

  beforeEach(async () => {
    vi.resetModules();
    store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store, location: { assign: vi.fn() } });
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("document", { cookie: "" });
  });

  it("removes every store a second person could read", async () => {
    for (const key of Object.values(KEYS)) store.setItem(key, "previous-user-data");

    const { clearClientState } = await import("./sign-out");
    clearClientState();

    for (const [name, key] of Object.entries(KEYS)) {
      expect(store.getItem(key), `${name} survived sign-out`).toBeNull();
    }
  });

  it("clears the in-memory cache too, not only what is on disk", async () => {
    const clear = vi.fn();
    const { clearClientState } = await import("./sign-out");
    clearClientState({ clear } as unknown as Parameters<typeof clearClientState>[0]);
    expect(clear).toHaveBeenCalledOnce();
  });
});
