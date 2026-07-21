# R1 Tires app — production image
FROM node:20-bookworm-slim

# Build tools for native modules (better-sqlite3), removed after install keeps
# layers lean; prebuilt binaries are used when available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Data (SQLite DB) lives on a mounted volume so it survives redeploys.
ENV NODE_ENV=production \
    PORT=3000 \
    DB_FILE=/data/r1.db

EXPOSE 3000
# Simple healthcheck hitting the app's own endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
