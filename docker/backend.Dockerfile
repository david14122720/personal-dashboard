# Build stage
FROM rust:1.75-slim-bookworm AS builder

WORKDIR /app

# Install system dependencies for build
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests and build empty project to cache dependencies
COPY backend/Cargo.toml backend/Cargo.lock* ./Cargo.toml ./Cargo.lock
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

# Copy source and build the actual project
COPY backend/src ./src
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/personal-dashboard-backend .

# Expose port (standard for Axum/Rust backends)
EXPOSE 3000

CMD ["./personal-dashboard-backend"]
