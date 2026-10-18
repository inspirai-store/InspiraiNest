ARG BASE_IMAGE=node:24-bookworm-slim
FROM ${BASE_IMAGE} AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --no-audit --no-fund && npm run plugins:check && npm run build:web && npm prune --omit=dev --ignore-scripts
FROM ${BASE_IMAGE}
WORKDIR /app
COPY --from=build --chown=node:node /app /app
ENV HOST=0.0.0.0 PORT=4317 COLLECTOR_DATA=/data COLLECTOR_RELEASE_DIR=/app/collector/mobile/dist
USER node
EXPOSE 4317
CMD ["node", "services/api/server.mjs"]
