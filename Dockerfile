# syntax=docker/dockerfile:1.6
# Personal Dashboard — imagen única para Dokploy:
# Stage frontend (Next.js static export) + Stage backend (Rust Axum que sirve STATIC_DIR).

FROM node:22-slim AS frontend
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm fetch --lockfile-only || true
COPY frontend/ ./
RUN pnpm install --frozen-lockfile --offline || pnpm install --frozen-lockfile
ENV NEXT_PUBLIC_API_URL=/api
RUN pnpm build

FROM rust:1.75-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY backend/Cargo.toml backend/Cargo.lock* ./Cargo.toml ./Cargo.lock
RUN mkdir -p src && echo "fn main(){}" > src/main.rs && cargo build --release 2>/dev/null || true
COPY backend/src ./src
COPY backend/.sqlx ./.sqlx
ENV SQLX_OFFLINE=true
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libssl3 ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 10001 appuser
COPY --from=builder /app/target/release/personal-dashboard-backend ./personal-dashboard-backend
COPY --from=frontend /app/frontend/out ./static
ENV STATIC_DIR=/app/static
ENV PORT=3000
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s CMD curl -fsS http://localhost:3000/health || exit 1
CMD ["./personal-dashboard-backend"]
