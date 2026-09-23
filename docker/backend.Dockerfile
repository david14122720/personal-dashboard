# syntax=docker/dockerfile:1.6
# Backend-only image used by docker-compose.yml: it serves no static assets
# (the root Dockerfile is the combined frontend + backend image for Dokploy).
# The rust base must satisfy the tree's MSRVs (sqlx 0.9 requires >= 1.94).
FROM rust:1-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY backend/Cargo.toml backend/Cargo.lock* ./Cargo.toml ./Cargo.lock
# Cache deps with dummy main (tolerant by design; only the gated build enforces --locked)
RUN mkdir -p src && echo "fn main(){}" > src/main.rs && cargo build --release 2>/dev/null || true
COPY backend/src ./src
# Touch so Cargo sees the real sources as newer than the dummy build above.
RUN find ./src -type f -exec touch {} +
COPY backend/.sqlx ./.sqlx
ENV SQLX_OFFLINE=true
RUN cargo build --release --locked

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libssl3 ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 10001 appuser
COPY --from=builder /app/target/release/personal-dashboard-backend ./personal-dashboard-backend
USER appuser
EXPOSE 3000
ENV SQLX_OFFLINE=true
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s CMD curl -fsS http://localhost:3000/health || exit 1
CMD ["./personal-dashboard-backend"]
