/**
 * The mail this system sends.
 *
 * Plain text is written FIRST and is not a fallback: a good part of the
 * audience reads mail in a client that shows it, and an operations alert that
 * degrades to a wall of link text is one nobody acts on.
 *
 * Both parts carry the same facts. An HTML-only detail is a detail half the
 * recipients never see.
 */
import type { Alert } from "../domain/alerts";

export type Message = { subject: string; text: string; html: string };

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const shell = (heading: string, body: string, action?: { label: string; url: string }) => `
<div style="font:14px/1.5 -apple-system,'Segoe UI',system-ui,sans-serif;color:#1c1917;max-width:560px">
  <h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(heading)}</h1>
  ${body}
  ${
    action
      ? `<p style="margin:20px 0 0"><a href="${escapeHtml(action.url)}" style="background:#8a4321;color:#fdf6f1;padding:9px 14px;border-radius:4px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`
      : ""
  }
  <p style="margin:24px 0 0;font-size:12px;color:#78716c">ROASTERY</p>
</div>`;

/**
 * The daily digest.
 *
 * ONE message for everything, not one per alert. An alerting system fails by
 * being muted, and twenty separate emails on a bad morning is how that happens.
 */
export function alertDigest(orgName: string, alerts: Alert[], consoleUrl: string): Message {
  const critical = alerts.filter((a) => a.severity === "critical");
  const rest = alerts.filter((a) => a.severity !== "critical");

  // Verb agreement matters here: this is the line most people read before
  // deciding whether to open it, and "1 thing need attention" reads as a bug.
  const subject = critical.length
    ? critical.length === 1
      ? `1 thing needs attention at ${orgName}`
      : `${critical.length} things need attention at ${orgName}`
    : `${alerts.length} update${alerts.length === 1 ? "" : "s"} at ${orgName}`;

  const line = (a: Alert) => `${a.severity === "critical" ? "!" : "-"} ${a.message}`;

  const text = [
    critical.length ? "Needs attention now:" : "",
    ...critical.map(line),
    critical.length && rest.length ? "" : "",
    rest.length ? "Coming up:" : "",
    ...rest.map(line),
    "",
    `Open the console: ${consoleUrl}`,
  ]
    .filter((part) => part !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const list = (items: Alert[]) =>
    `<ul style="margin:6px 0 0;padding-left:18px">${items
      .map((a) => `<li style="margin:4px 0">${escapeHtml(a.message)}</li>`)
      .join("")}</ul>`;

  const html = shell(
    subject,
    [
      critical.length
        ? `<p style="margin:0;font-weight:600;color:#9f2d1f">Needs attention now</p>${list(critical)}`
        : "",
      rest.length ? `<p style="margin:16px 0 0;font-weight:600">Coming up</p>${list(rest)}` : "",
    ].join(""),
    { label: "Open the console", url: consoleUrl },
  );

  return { subject, text, html };
}

/**
 * A webhook endpoint that switched itself off.
 *
 * Worth an email precisely because the failure is invisible: the integration
 * simply stops receiving events, and whoever built it is not watching our
 * console.
 */
export function webhookDisabled(
  orgName: string,
  url: string,
  reason: string,
  consoleUrl: string,
): Message {
  const subject = `A webhook endpoint was disabled at ${orgName}`;

  const text = [
    `We stopped delivering to ${url}.`,
    "",
    `Reason: ${reason}`,
    "",
    "Events are still recorded and can be replayed once the endpoint is fixed —",
    "nothing has been lost. Re-enable it from Settings → Webhooks.",
    "",
    `${consoleUrl}/settings/webhooks`,
  ].join("\n");

  const html = shell(
    subject,
    `<p style="margin:0">We stopped delivering to <code>${escapeHtml(url)}</code>.</p>
     <p style="margin:12px 0 0"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
     <p style="margin:12px 0 0">Events are still recorded and can be replayed once the endpoint is
     fixed — nothing has been lost.</p>`,
    { label: "Review webhooks", url: `${consoleUrl}/settings/webhooks` },
  );

  return { subject, text, html };
}
