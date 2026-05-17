import type { Context } from "hono";

/**
 * Resolve the client source IP for a Hono request running under
 * @hono/node-server. Honors `X-Forwarded-For` (first value) per D-14,
 * else falls back to the raw socket address.
 *
 * Note (D-14, T-01-06): Phase 1 has no auth and no trusted front proxy,
 * so X-Forwarded-For is best-effort. Plan 2 will add the Cloudflare-Tunnel
 * trust boundary.
 */
export function resolveSourceIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff && xff.trim().length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  // @hono/node-server stashes the raw Node IncomingMessage on c.env.incoming
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } };
  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}
