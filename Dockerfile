# ---------- Stage 1: production dependencies ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- Stage 2: build (TypeScript compile) ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:22-bookworm-slim AS runtime

# openssl + ca-certificates are MANDATORY (D-01, D-02). curl is intentionally
# NOT installed (CONCERN-5) — HEALTHCHECK uses Node 22 built-in fetch.
#
# WR-04: Debian's apt does not let us pin to a stable major-version glob
# without breaking builds when patch versions rotate out of the repo. We
# instead capture the exact installed versions into /etc/veritas-build
# so they are queryable from the running image, and we set an OCI label
# with the openssl version for reproducibility audits.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && openssl version \
 && mkdir -p /etc \
 && { \
      echo "openssl_version=$(openssl version)"; \
      dpkg-query -W -f='${Package}=${Version}\n' openssl ca-certificates; \
    } > /etc/veritas-build

LABEL org.opencontainers.image.title="Veritas"

# Non-root user (T-03-01). uid 10001 is documented in README for Unraid chown notes.
RUN groupadd --system --gid 10001 app \
 && useradd  --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

# Copy prod deps from `deps`, compiled JS from `build`, plus the runtime assets.
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist
COPY assets ./assets
COPY src/static ./src/static
COPY src/db/migrations ./src/db/migrations
COPY package.json ./

# Bundle output volume — bind-mounted from host at runtime (./data:/data).
VOLUME ["/data"]

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3700

EXPOSE 3700

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3700/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
