/**
 * Turning a report's data into an artifact.
 *
 * HTML is generated here and PDF rendering is done by Cloudflare Browser
 * Rendering when the binding is present. The fallback is deliberate rather
 * than a stub: local development and CI have no browser binding, and a report
 * pipeline that only works in production is one nobody exercises until it
 * breaks in front of a customer. The HTML is the same document either way.
 */
import type { Env } from "../../env";

export type ReportSection = {
  heading: string;
  /** A table. The first row is the header. */
  rows: string[][];
  note?: string;
};

export type ReportDocument = {
  title: string;
  subtitle?: string;
  generatedAt: string;
  organization: string;
  sections: ReportSection[];
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderHtml(doc: ReportDocument): string {
  const sections = doc.sections
    .map((section) => {
      const [header, ...body] = section.rows;
      const head = header
        ? `<thead><tr>${header.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`
        : "";
      const rows = body
        .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
        .join("");
      return `<section>
  <h2>${escapeHtml(section.heading)}</h2>
  ${body.length ? `<table>${head}<tbody>${rows}</tbody></table>` : '<p class="empty">Nothing to report.</p>'}
  ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ""}
</section>`;
    })
    .join("\n");

  // Tabular numerals throughout: an operator comparing a column of weights by
  // eye cannot do it if the digits are proportional.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 13px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1c1917; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: .04em; color: #57534e; }
  .meta { color: #78716c; font-size: 12px; margin-bottom: 8px; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { border-bottom: 1px solid #e7e5e4; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { font-weight: 600; color: #44403c; background: #fafaf9; }
  td:not(:first-child), th:not(:first-child) { text-align: right; }
  .empty, .note { color: #78716c; font-size: 12px; }
  @page { margin: 16mm; }
</style>
</head>
<body>
<h1>${escapeHtml(doc.title)}</h1>
${doc.subtitle ? `<div class="meta">${escapeHtml(doc.subtitle)}</div>` : ""}
<div class="meta">${escapeHtml(doc.organization)} · generated ${escapeHtml(doc.generatedAt)}</div>
${sections}
</body>
</html>`;
}

export type RenderedArtifact = { body: Uint8Array; contentType: string; extension: string };

export async function renderArtifact(env: Env, doc: ReportDocument): Promise<RenderedArtifact> {
  const html = renderHtml(doc);

  if (!env.BROWSER) {
    return {
      body: new TextEncoder().encode(html),
      contentType: "text/html; charset=utf-8",
      extension: "html",
    };
  }

  const puppeteer = await import("@cloudflare/puppeteer");
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return { body: new Uint8Array(pdf), contentType: "application/pdf", extension: "pdf" };
  } finally {
    // A leaked browser session is far more expensive than a leaked connection,
    // and Browser Rendering caps how many can be open at once per account.
    await browser.close();
  }
}
