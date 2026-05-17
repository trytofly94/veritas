import type { Context } from "hono";

/**
 * Resolve the client source IP for a Hono request running under
 * @hono/node-server.
 *
 * CR-02: X-Forwarded-For is honored ONLY when the immediate peer
 * (`socket.remoteAddress`) is in the comma-separated `TRUSTED_PROXY_IPS`
 * env allowlist. Phase 1 has no built-in reverse proxy, so by default
 * (empty allowlist) the raw socket address is used and XFF is ignored.
 * This prevents arbitrary clients from forging the forensic `source_ip`
 * field in the bundle's metadata.json by setting their own
 * `X-Forwarded-For` header.
 *
 * Phase 2 (Cloudflare Tunnel) will populate TRUSTED_PROXY_IPS with the
 * tunnel sidecar's loopback address.
 */
export function resolveSourceIp(c: Context): string {
  // @hono/node-server stashes the raw Node IncomingMessage on c.env.incoming
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } };
  const peer = env?.incoming?.socket?.remoteAddress ?? "unknown";

  const trusted = (process.env.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (trusted.length > 0 && trusted.includes(peer)) {
    const xff = c.req.header("x-forwarded-for");
    const first = xff?.split(",")[0]?.trim();
    if (first) return first;
  }
  return peer;
}
