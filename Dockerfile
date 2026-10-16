# syntax=docker/dockerfile:1

###############################################################################
# Stage 1 — deps: resolve the lockfile and install production dependencies.
###############################################################################
# Bun 1.4.2 (was 1.3.6): 1.3.6's HTMLRewriter keeps every onEndTag callback
# alive with everything it closes over. extractPage registers one per text
# element, so each crawled page leaked ~120 KB and the nightly ingest was
# OOM-killed at 2Gi every night (measured 2026-10-09: heap +30 MB per 500
# pages on 1.3.6, flat on 1.4.2). Keep both stages on the same version.
# The text lockfile (bun.lock, lockfileVersion 1) needs Bun >= 1.2. Alpine is
# fine: the dependency tree has no native (.node) modules.
FROM oven/bun:1.4.2-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./
# --production omits devDependencies. Bun executes TypeScript directly, so the
# typescript package is not needed at runtime either.
RUN bun install --frozen-lockfile --production

###############################################################################
# Stage 2 — runtime: production node_modules + source only.
###############################################################################
FROM oven/bun:1.4.2-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
# tsconfig.json is read by Bun at startup (compiler options only; no path aliases).
COPY package.json tsconfig.json ./
COPY src ./src
# The ingest CronJob runs scripts/ingest.ts from this same image; data/ holds the
# partner seed list the registry is bootstrapped from.
COPY scripts ./scripts
COPY data ./data

# Built-in unprivileged user shipped in the oven/bun images; numeric form so
# Kubernetes runAsNonRoot can verify it.
USER 1000:1000

# The app reads PORT (src/config/env.ts); 3000 is the default.
ENV PORT=3000
EXPOSE 3000

# No bundling step: bun runs the TS sources directly. Exec form keeps bun as
# PID 1 so it receives SIGTERM for the graceful shutdown in src/server.ts.
CMD ["bun", "run", "src/server.ts"]
