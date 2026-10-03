# Builds the web app and serves it with the small Node server on port 8080.
# The build stage runs on the native platform: its output is static files,
# so the arm64 image does not need to compile under emulation.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 CONFIG_DIR=/config STATIC_DIR=/app/public
WORKDIR /app
COPY server/package.json server/*.mjs ./
COPY --from=build /app/dist ./public
# Runs as root so it can write to an Unraid appdata folder created by Docker.
RUN mkdir -p /config
VOLUME /config
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "index.mjs"]
