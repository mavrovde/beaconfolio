# Multi-stage build for Angular frontend
FROM node:26-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies using cache mount for npm
RUN --mount=type=cache,target=/root/.npm \
    npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the public SSR app (and the shared library it depends on)
RUN npm run build:shared && npm run build:public

# Production stage with nginx
FROM node:26-slim

# Take Debian security updates, install nginx and clear default config.
# Then REMOVE npm/npx/corepack: the runtime only ever runs `node` (see CMD), and
# npm's own bundled node_modules (undici, …) were the bulk of Snyk's findings
# for this image — shipping a package manager to prod is pure attack surface.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* && rm -f /etc/nginx/sites-enabled/default \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Clear default nginx assets
RUN rm -rf /usr/share/nginx/html/*

# Copy built public app from builder
COPY --from=builder /app/dist/public/browser /usr/share/nginx/browser
COPY --from=builder /app/dist/public/server /usr/share/nginx/server

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start both Node server and Nginx
CMD ["sh", "-c", "node /usr/share/nginx/server/server.mjs & nginx -g 'daemon off;'"]
