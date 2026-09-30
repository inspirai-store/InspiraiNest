ARG BASE_IMAGE=node:24-bookworm-slim
FROM ${BASE_IMAGE}
USER root
WORKDIR /app/collector
COPY LICENSE ./LICENSE
COPY collector/package.json collector/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY collector/src ./src
COPY collector/public ./public
COPY collector/mobile/android/app/src/main/assets/mobile-next ./mobile/android/app/src/main/assets/mobile-next
COPY assets/vendor /app/assets/vendor
COPY assets/library.js assets/library.css assets/library-time.js /app/assets/
COPY assets/client-prompt.js assets/client-prompt.css /app/assets/
COPY assets/brand-icon.png /app/assets/
COPY assets/brand.css /app/assets/
COPY index.html /app/index.html
COPY collector/mobile/dist/ /app/releases/
ENV HOST=0.0.0.0 PORT=4317 COLLECTOR_DATA=/data COLLECTOR_RELEASE_DIR=/app/releases
USER node
EXPOSE 4317
CMD ["node", "src/server.mjs"]
