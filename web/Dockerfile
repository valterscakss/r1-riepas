# R1 Tires — self-hosted image (Next.js standalone server).
# Needs DATABASE_URL (any Postgres) and AUTH_SECRET at runtime.
#   docker build -t r1-web .
#   docker run -p 3000:3000 -e DATABASE_URL=… -e AUTH_SECRET=… r1-web
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# No DATABASE_URL at build time: migrations run when the container starts.
RUN npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migrations and the tools to apply them.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/scripts/migrate.mjs ./migrate.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node migrate.mjs && node server.js"]
