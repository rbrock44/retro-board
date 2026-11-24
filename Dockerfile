# One image: the API serves the built Angular app and everything under /api and /socket.io.

# ---- build: install everything, build web + api ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- deps: production dependencies of the API only ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund --workspace @retro/api --include-workspace-root=false

# ---- runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web \
    UPLOAD_DIR=/data/uploads \
    DATABASE_URL=pglite:/data/pglite \
    AUTH_CONFIG=
# Keep the workspace layout so packages npm nested under apps/api/node_modules still resolve.
COPY --from=deps /app /app
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/web/dist/browser /app/web
WORKDIR /app/apps/api
RUN mkdir -p /data /app/config && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
