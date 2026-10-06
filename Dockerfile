# syntax=docker/dockerfile:1.6
# Personal Dashboard — single image for Dokploy:
# Stage frontend (Next.js static export) + Stage backend (Rust Axum serving STATIC_DIR)
# + Stage mcp (TypeScript Streamable HTTP server on :3002, same container).

FROM node:22-slim AS frontend
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm fetch --lockfile-only || true
COPY frontend/ ./
RUN pnpm install --frozen-lockfile --offline || pnpm install --frozen-lockfile
ENV NEXT_PUBLIC_API_URL=/api
RUN pnpm build

FROM rust:1-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY backend/Cargo.toml ./
COPY backend/Cargo.lock* ./
RUN mkdir -p src && echo "fn main(){}" > src/main.rs && cargo build --release 2>/dev/null || true
COPY backend/src ./src
# The dummy build above is newer than the freshly copied sources, so without
# this touch Cargo sees everything as fresh and ships the dummy binary.
RUN find ./src -type f -exec touch {} +
COPY backend/.sqlx ./.sqlx
ENV SQLX_OFFLINE=true
RUN cargo build --release --locked

# Stage mcp: compile the TypeScript MCP server, then drop devDependencies so
# only the production runtime (dist + pruned node_modules) ships downstream.
FROM node:22-slim AS mcp
WORKDIR /app/mcp-dashboard
COPY mcp-dashboard/ ./
RUN npm ci && npm run build && npm prune --omit=dev

# Final stage on node:22-slim (bookworm family) so one image runs both the
# Rust backend and the Node MCP server. Keeps the previous runtime behaviour
# (appuser uid 10001, setcap on the backend binary, STATIC_DIR, PORT).
FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libssl3 ca-certificates curl libcap2-bin && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 10001 appuser
COPY --from=builder /app/target/release/personal-dashboard-backend ./personal-dashboard-backend
COPY --from=frontend /app/frontend/out ./static
COPY --from=mcp /app/mcp-dashboard/dist ./mcp-dashboard/dist
COPY --from=mcp /app/mcp-dashboard/node_modules ./mcp-dashboard/node_modules
COPY --from=mcp /app/mcp-dashboard/package.json ./mcp-dashboard/package.json
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && setcap 'cap_net_bind_service=+ep' ./personal-dashboard-backend
ENV STATIC_DIR=/app/static
ENV PORT=80
# MCP defaults inside the container (overridable via the Dokploy env field).
# PERSONAL_DASHBOARD_API_URL points at the sibling backend on :80.
# MCP_ALLOWED_HOSTS opens the host guard for LAN access; localhost stays allowed.
# PERSONAL_DASHBOARD_TOKEN is intentionally unset: auth stays per-request Bearer.
ENV MCP_PORT=3002
ENV PERSONAL_DASHBOARD_API_URL=http://127.0.0.1:80/api
ENV MCP_ALLOWED_HOSTS=192.168.50.120
USER appuser
EXPOSE 80 3002
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s CMD curl -fsS http://localhost:80/health && curl -fsS http://localhost:3002/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
