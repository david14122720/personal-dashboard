# syntax=docker/dockerfile:1.6
FROM rust:1.75-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY backend/Cargo.toml backend/Cargo.lock* ./Cargo.toml ./Cargo.lock
# Cache deps with dummy main
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
USER appuser
EXPOSE 3000
ENV SQLX_OFFLINE=true
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s CMD curl -fsS http://localhost:3000/health || exit 1
CMD ["./personal-dashboard-backend"]
