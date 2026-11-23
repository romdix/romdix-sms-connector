# Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools required for better-sqlite3 native binary compilation
RUN apk add --no-cache python3 make g++

# Install all dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production Stage
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Build tools are needed to compile better-sqlite3 during the production install;
# su-exec lets the entrypoint drop privileges after fixing volume ownership.
RUN apk add --no-cache python3 make g++ su-exec

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/ui/dist ./src/ui/dist
COPY --from=builder /app/package*.json ./

# Install production only dependencies (better-sqlite3 compiles here too)
RUN npm ci --omit=dev && npm cache clean --force

# Create the persistent data directory owned by the unprivileged user
RUN mkdir -p data && chown -R node:node /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Declare /app/data as a persistent volume.
# Coolify mounts a named volume here so the SQLite database survives redeployments.
VOLUME ["/app/data"]

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
