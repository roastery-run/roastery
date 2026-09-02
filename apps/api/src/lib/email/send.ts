/**
 * Sending mail.
 *
 * Deliberately provider-agnostic: one HTTPS POST to a configured endpoint with
 * a bearer token. Every transactional provider worth using accepts that shape,
 * and hard-coding one would put a vendor in the middle of sign-in.
 *
 * When it is not configured, mail is LOGGED rather than dropped, and the caller
 * is told nothing failed. That is right for local development — a magic link on
 * the console is exactly what you want — and it is why the configuration check
 * in `assertProductionBindings` exists: silently logging sign-in links in
 * production would be a very quiet outage.
 */
import type { EmailSender } from "@roastery/auth";
import type { Env } from "../../env";

export type SendResult = { delivered: boolean; reason?: string };

/**
 * Builds a sender, or nothing when the environment has no mail configured.
 *
 * Returning `undefined` rather than a no-op sender is deliberate: Better Auth
 * branches on its absence to log the link instead, and a silent no-op would
 * leave a developer waiting for an email that was never going to arrive.
 */
export function createEmailSender(env: Env): EmailSender | undefined {
  if (!env.EMAIL_API_URL || !env.EMAIL_API_KEY || !env.EMAIL_FROM) return undefined;

  return async ({ to, subject, html, text }) => {
    const response = await fetch(env.EMAIL_API_URL as string, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.EMAIL_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text }),
      // A sign-in flow is waiting on this. Ten seconds is already longer than
      // anybody will sit and watch a spinner.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // Thrown, not swallowed: Better Auth surfaces it as a failed send, and a
      // user who is told the link could not be sent will try again. One who is
      // told it was sent will wait forever.
      throw new Error(`Email provider returned ${response.status}: ${body.slice(0, 200)}`);
    }
  };
}

/**
 * Sends without letting a failure take the caller down.
 *
 * For notifications rather than sign-in: an alert digest that cannot be
 * delivered must not abort the cron run that produced the other twenty. The
 * result says what happened so the caller can decide whether to mark them sent.
 */
export async function trySend(
  env: Env,
  message: { to: string; subject: string; html: string; text: string },
): Promise<SendResult> {
  const sender = createEmailSender(env);
  if (!sender) {
    console.log(
      JSON.stringify({ msg: "email_not_configured", to: message.to, subject: message.subject }),
    );
    // NOT "delivered". Reporting an unsent email as sent would let the dedupe
    // stamp it and guarantee nobody ever receives it.
    return { delivered: false, reason: "not_configured" };
  }

  try {
    await sender(message);
    return { delivered: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: "email_send_failed",
        to: message.to,
        subject: message.subject,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { delivered: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}
