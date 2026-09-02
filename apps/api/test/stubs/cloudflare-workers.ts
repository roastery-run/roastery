/**
 * Minimal stand-in for the `cloudflare:workers` module.
 *
 * The authorization tests import the Hono app to read its route registry, and
 * the app re-exports the Durable Object class, which extends a base only the
 * Workers runtime provides. Those tests never construct a DO — they inspect
 * registered routes — so a structural stub is enough and keeps them running in
 * a plain Node environment, which is what makes them fast enough to run on
 * every save.
 *
 * Anything that actually exercises DO behaviour belongs in a Workers-pool
 * test, not here.
 */
export class DurableObject<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
