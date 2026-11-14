# Build Stage
FROM node:18-alpine AS builder

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
FROM node:18-alpine

WORKDIR /app

# Install build tools needed for better-sqlite3 native module in production
RUN apk add --no-cache python3 make g++

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/ui/dist ./src/ui/dist
COPY --from=builder /app/package*.json ./

# Install production only dependencies (better-sqlite3 compiles here too)
RUN npm ci --only=production

# Create the persistent data directory
RUN mkdir -p data

# Declare /app/data as a persistent volume.
# Docker and Coolify will automatically mount this as a named volume,
# ensuring the SQLite database survives container restarts and redeployments.
VOLUME ["/app/data"]

# Environment variables
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
