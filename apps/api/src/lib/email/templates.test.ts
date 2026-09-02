import { describe, expect, it } from "vitest";
import type { Alert } from "../domain/alerts";
import { alertDigest, webhookDisabled } from "./templates";

const alert = (severity: Alert["severity"], message: string): Alert => ({
  ruleId: "contract.milestone.overdue",
  subjectId: crypto.randomUUID(),
  severity,
  message,
});

describe("alertDigest", () => {
  it("is ONE message for everything, not one per alert", () => {
    // The failure mode of an alerting system is being muted, and twenty
    // separate emails on a bad morning is exactly how that happens.
    const digest = alertDigest(
      "Acme",
      [alert("critical", "A is overdue"), alert("warning", "B is due soon")],
      "https://app.roastery.run",
    );
    expect(digest.text).toContain("A is overdue");
    expect(digest.text).toContain("B is due soon");
  });

  it("leads the subject with what is critical", () => {
    // The subject line is the only part most people read before deciding
    // whether to open it.
    const digest = alertDigest(
      "Acme",
      [alert("critical", "Fixation overdue"), alert("warning", "Vessel due soon")],
      "https://app.roastery.run",
    );
    expect(digest.subject).toBe("1 thing needs attention at Acme");
  });

  it("does not cry wolf when nothing is critical", () => {
    const digest = alertDigest(
      "Acme",
      [alert("warning", "Vessel due soon"), alert("info", "Lot low")],
      "https://app.roastery.run",
    );
    expect(digest.subject).toContain("2 updates");
    expect(digest.subject).not.toContain("attention");
  });

  it("says the same thing in text as in HTML", () => {
    // Half the audience reads plain text. A detail that exists only in the
    // HTML part is a detail half the recipients never see.
    const digest = alertDigest(
      "Acme",
      [alert("critical", "Fixation overdue on CO-2026-01")],
      "https://app.roastery.run",
    );
    expect(digest.text).toContain("Fixation overdue on CO-2026-01");
    expect(digest.html).toContain("Fixation overdue on CO-2026-01");
    expect(digest.text).toContain("https://app.roastery.run");
    expect(digest.html).toContain("https://app.roastery.run");
  });

  it("escapes alert text into the HTML part", () => {
    // Alert messages carry lot names and notes, which are user input.
    const digest = alertDigest(
      "Acme",
      [alert("critical", 'Lot <script>alert("x")</script> is overdue')],
      "https://app.roastery.run",
    );
    expect(digest.html).not.toContain("<script>");
    expect(digest.html).toContain("&lt;script&gt;");
  });

  it("agrees the verb with the count", () => {
    // The subject is the line most people read before deciding whether to
    // open it, and "1 thing need attention" reads as a bug in the product.
    expect(alertDigest("Acme", [alert("critical", "a")], "https://x").subject).toBe(
      "1 thing needs attention at Acme",
    );
    expect(
      alertDigest("Acme", [alert("critical", "a"), alert("critical", "b")], "https://x").subject,
    ).toBe("2 things need attention at Acme");
  });
});

describe("webhookDisabled", () => {
  it("names the endpoint and the reason", () => {
    const message = webhookDisabled(
      "Acme",
      "https://example.com/hook",
      "20 consecutive delivery failures",
      "https://app.roastery.run",
    );
    expect(message.text).toContain("https://example.com/hook");
    expect(message.text).toContain("20 consecutive delivery failures");
  });

  it("says nothing has been lost", () => {
    // The first question anyone asks on reading this is whether they missed
    // events. Answering it in the mail avoids a support ticket.
    const message = webhookDisabled("Acme", "https://example.com/hook", "410 Gone", "https://x");
    expect(message.text).toMatch(/nothing has been lost/i);
    expect(message.text).toMatch(/replay/i);
  });

  it("points at the screen that fixes it", () => {
    const message = webhookDisabled(
      "Acme",
      "https://e.com/h",
      "410 Gone",
      "https://app.roastery.run",
    );
    expect(message.text).toContain("/settings/webhooks");
    expect(message.html).toContain("/settings/webhooks");
  });

  it("escapes the endpoint URL, which is user input", () => {
    const message = webhookDisabled(
      "Acme",
      'https://e.com/"><script>x</script>',
      "410 Gone",
      "https://x",
    );
    expect(message.html).not.toContain("<script>");
  });
});
