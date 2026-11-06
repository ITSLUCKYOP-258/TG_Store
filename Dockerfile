# ---- Stage 1: Build frontend ----
FROM node:20-slim AS frontend
# Build tools needed for native deps in devDependencies (e.g. sharp)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: Runtime (server + built frontend) ----
FROM node:20-slim
# python3 + make + g++ needed by better-sqlite3 native addon
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

# Copy built React app from stage 1
COPY --from=frontend /app/client/dist ./client/dist

# Install server deps (native compile happens here)
COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev

# Copy server source
COPY server/src ./src

# DATA_DIR is the persistent volume mount point.
# SQLite DB + config.json both live there so they survive redeploys.
ENV DATA_DIR=/data
EXPOSE 8787
CMD ["node", "src/index.js"]
