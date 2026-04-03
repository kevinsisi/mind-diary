# ── Stage 1: Build ─────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# Install all dependencies (including devDependencies for build)
# Remove lock file to avoid cross-platform optional dependency issues (rollup native modules)
RUN rm -f package-lock.json && npm install

# Copy source code
COPY tsconfig.json ./
COPY packages/server/ packages/server/
COPY packages/web/ packages/web/

# Build server and web
RUN npm run build

# ── Stage 2: Runtime ───────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# Install production dependencies only
RUN npm install --omit=dev

# Copy built server output
COPY --from=build /app/packages/server/dist packages/server/dist

# Copy built web output
COPY --from=build /app/packages/web/dist packages/web/dist

# Create data directory for SQLite + uploads
RUN mkdir -p /app/data/uploads

VOLUME /app/data

EXPOSE 8823

CMD ["node", "packages/server/dist/index.js"]
