# Shared base stage for common OS dependencies
FROM python:3.12-slim AS base

WORKDIR /app

# Install runtime dependencies once in base.
# NOTE: the backend does NOT run any browser/Node tooling at runtime — LinkedIn
# ingest uses the pure-HTTP Python `linkedin-api` client (see
# app/services/linkedin.py, "no Node.js"), the entrypoint is Python/alembic, and
# the only subprocess is `pg_dump` (postgresql-client). The former
# Node.js + `playwright install --with-deps chromium` install was vestigial dead
# weight (~500MB+, the dominant build-time + a slow `type=gha` cache layer) and
# has been removed (#91). `libpq5` = asyncpg/libpq; `postgresql-client` = pg_dump
# (admin SQL export) + psql; `curl` kept for debugging/health probes.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    libpq5 \
    postgresql-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Builder stage for compiling dependencies
FROM base AS builder

# Install build tools in builder stage
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    g++ \
    cargo \
    && rm -rf /var/lib/apt/lists/*

# Create and populate virtualenv
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV VIRTUAL_ENV="/opt/venv"

# Copy requirements for dependency installation
COPY requirements.txt .

# Upgrade pip and install maturin with cache mount
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install maturin

# Install production dependencies
# linkedin-api PyPI wheel has broken entry point (lint = black:None) that pip rejects.
# scripts/patch_linkedin.sh downloads the wheel, patches the entry point out, and
# installs it — the version comes from requirements.txt, the ONE pin (#381; this
# RUN previously inlined a second hardcoded copy of the whole patch).
COPY scripts/patch_linkedin.sh scripts/
RUN --mount=type=cache,target=/root/.cache/pip \
    bash scripts/patch_linkedin.sh && \
    pip install -r requirements.txt

# Final runtime stage inherits from base
FROM base AS runtime

# Copy virtualenv from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV VIRTUAL_ENV="/opt/venv"

# CVE-2024-6345 (GHSA-cx63-2mw6-8hw5) is closed by the setuptools pin in
# requirements.txt (fixed in 70.0.0; we pin far past it). The historical sed
# that patched package_index.py in place was removed in #239: setuptools no
# longer ships that module (verified against the 83/84 wheels), and
# `find -exec … +` with zero matches exits 0 — the layer always "succeeded"
# while patching nothing, i.e. a dead security control giving false assurance.
# Guard: fail the build if the module ever reappears (a downgrade below the
# fixed version would resurface the vulnerable file).
RUN test -z "$(find /opt/venv -name package_index.py)" || { echo "package_index.py is back — setuptools downgraded below the CVE-2024-6345 fix?" >&2; exit 1; }

# Copy application code
COPY . .
RUN chmod +x docker-entrypoint.sh

# Set environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 8000

# Alembic is the authoritative schema-management mechanism: the entrypoint
# runs `alembic upgrade head` before every container start (idempotent), then
# execs the app. See "Database Migrations" in the root README.md.
ENTRYPOINT ["./docker-entrypoint.sh"]
# --no-proxy-headers (SECURITY, #273): uvicorn ships a SECOND, independent
# implementation of "who is the client" — ProxyHeadersMiddleware REWRITES
# scope["client"] from X-Forwarded-For whenever the peer is in
# `--forwarded-allow-ips` / FORWARDED_ALLOW_IPS, and with the very common
# `*` setting it takes hop 0, the value the caller typed. That would silently
# feed a forged address to `app.services.rate_limit.client_ip` (which trusts
# request.client.host as the one unforgeable fact) and re-open the bypass this
# flag's own fix closed. Turning it off makes the app's TRUSTED_PROXY_CIDRS
# check the single decision point. Nothing here reads scope["scheme"], and the
# real client IP is in nginx's access log (proxy/real_ip.conf), so the only
# change is that uvicorn's access log now names the true TCP peer.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
