/**
 * Refusing to make requests on a tenant's behalf to places they should not
 * reach.
 *
 * A webhook endpoint is a URL a customer supplies and we then POST to, signed,
 * repeatedly, on a schedule. Validating only that it is https leaves two
 * problems.
 *
 * The first is the classic one: `https://127.0.0.1`, `https://[::1]`,
 * `https://192.168.1.10` or a cloud metadata address turns the delivery worker
 * into a probe inside whatever network it runs in.
 *
 * The second is specific to us: `https://api.roastery.run/...` as an endpoint
 * makes the platform generate load against itself, with our own IP reputation
 * and our own rate-limit budget, in a loop that each delivery re-triggers.
 *
 * Checked twice, because neither check alone is enough. At registration, so a
 * bad URL is rejected while somebody is looking at the error message. At
 * delivery, resolving the name first, because a hostname that pointed
 * somewhere public at registration can point at 169.254.169.254 an hour later
 * and DNS is the attacker's to change.
 */

/** Hostnames that are never a customer's endpoint, whatever they resolve to. */
const BLOCKED_HOST_SUFFIXES = [
  "localhost",
  ".local",
  ".internal",
  ".localdomain",
  // Our own zone. A tenant pointing a webhook at the API turns fan-out into a
  // self-inflicted load generator that also carries a valid signature.
  "roastery.run",
];

/** The ports a legitimate public HTTPS endpoint listens on. */
const ALLOWED_PORTS = new Set(["", "443", "8443"]);

export type UrlProblem = string | null;

/**
 * Whether a URL may be REGISTERED as a webhook endpoint.
 *
 * Returns a reason rather than a boolean: this is shown to the person typing
 * the URL, and "invalid" without a why is a support ticket.
 */
export function webhookUrlProblem(raw: string): UrlProblem {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a valid URL.";
  }

  if (url.protocol !== "https:") {
    return "Webhook URLs must be https — a signature does not protect a payload in transit.";
  }
  if (url.username || url.password) {
    return "Webhook URLs must not contain credentials.";
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return "Webhook URLs must use the default HTTPS port.";
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (isIpLiteral(host)) {
    return "Webhook URLs must use a hostname, not an IP address.";
  }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`) || host.endsWith(suffix)) {
      return "That host is not reachable as a webhook destination.";
    }
  }
  if (!host.includes(".")) {
    return "Webhook URLs must use a fully qualified hostname.";
  }
  return null;
}

function isIpLiteral(host: string): boolean {
  // A bracketed IPv6 literal arrives from URL.hostname already stripped of its
  // brackets, so a colon is enough to recognise one.
  if (host.includes(":")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Whether an address is one nothing outside our network should be asked to
 * reach.
 *
 * Pure and exhaustive over the ranges that matter, so it can be tested as a
 * table rather than trusted.
 */
export function isBlockedAddress(address: string): boolean {
  if (address.includes(":")) return isBlockedIpv6(address.toLowerCase());
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a = 0, b = 0] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "");
  if (host === "::1" || host === "::") return true;
  if (host.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(host)) return true; // unique local
  // IPv4-mapped (::ffff:169.254.169.254) is the same address wearing a hat.
  const mapped = host.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) return isBlockedAddress(mapped[1]);
  return false;
}

/**
 * Resolves a hostname and reports whether every address is safe to reach.
 *
 * DNS over HTTPS because a Worker has no resolver of its own. On failure this
 * returns `blocked`: a name that cannot be resolved is not a name we should
 * POST a signed payload to, and treating "unknown" as "fine" would let a
 * refusing resolver bypass the check.
 */
export async function resolvesToBlockedAddress(hostname: string): Promise<boolean> {
  try {
    const addresses = await Promise.all([resolve(hostname, "A"), resolve(hostname, "AAAA")]);
    const all = addresses.flat();
    if (all.length === 0) return true;
    return all.some(isBlockedAddress);
  } catch {
    return true;
  }
}

async function resolve(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
    { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) },
  );
  if (!response.ok) throw new Error(`DNS lookup failed: ${response.status}`);
  const body = (await response.json()) as { Answer?: { type: number; data: string }[] };
  // Types 1 and 28 are A and AAAA; a CNAME in the chain is followed by the
  // resolver, so only the address records matter here.
  return (body.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
}
