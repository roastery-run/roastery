import { describe, expect, it } from "vitest";
import { LEGAL, legalBySlug } from "./legal";

/**
 * The legal documents, checked the way the pricing page is: as data with
 * invariants, rather than as prose nobody can test.
 *
 * What is worth asserting is not the wording — that is a lawyer's — but the
 * things that rot. A document nothing links to, an effective date that is not
 * a date, a page that exists in the footer and 404s.
 */
describe("legal documents", () => {
  it("publishes both documents a site selling to businesses needs", () => {
    expect(LEGAL.map((page) => page.slug).sort()).toEqual(["privacy", "terms"]);
  });

  it.each(LEGAL)("$slug carries a real effective date", (page) => {
    // Shown to the reader and diffed against their last copy, so it has to be
    // parseable and cannot be a placeholder from the future.
    const date = new Date(page.updatedAt);
    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(page.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);
  });

  it.each(LEGAL)("$slug has substance in every section", (page) => {
    expect(page.sections.length).toBeGreaterThanOrEqual(5);
    for (const section of page.sections) {
      expect(section.heading.length, page.slug).toBeGreaterThan(0);
      expect(section.paragraphs.length, section.heading).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) {
        expect(paragraph.trim().length, section.heading).toBeGreaterThan(20);
      }
    }
  });

  it("says where data is processed, which is the question customers ask first", () => {
    const privacy = legalBySlug("privacy");
    const text = JSON.stringify(privacy);
    // Naming sub-processors is a commitment, and one that changes when the
    // infrastructure does. If a provider is swapped, this fails and the policy
    // gets updated with it.
    for (const processor of ["Cloudflare", "Neon"]) {
      expect(text, processor).toContain(processor);
    }
  });

  it("describes rights the product can actually honour", () => {
    // Export and deletion are console operations. Promising them without the
    // operations existing is the one failure mode of a policy that is worse
    // than not having one.
    const text = JSON.stringify(legalBySlug("privacy"));
    expect(text).toMatch(/export/i);
    expect(text).toMatch(/delet/i);
  });

  it("resolves a known slug and refuses an unknown one", () => {
    expect(legalBySlug("privacy")?.title).toBeTruthy();
    expect(legalBySlug("cookies")).toBeUndefined();
  });
});
