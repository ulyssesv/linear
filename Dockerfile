# syntax=docker/dockerfile:1
# Image for linear.sesv.co (SEED-R23, SEED-R24). Contract for infra: docs/deploy.md.
# Release builds pass --platform linux/amd64; nothing here is tied to an architecture.

# Node 26 LTS slim, pinned by tag and multi-arch index digest. Bump both together.
ARG NODE_IMAGE=node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39

FROM ${NODE_IMAGE} AS build
# Node 26 no longer bundles corepack; install a pinned one so pnpm comes from packageManager.
RUN npm install --global --no-fund --no-audit corepack@0.36.0 && corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /src

# Manifests first so the dependency layer is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
COPY apps/web/package.json apps/web/
COPY tools/specs/package.json tools/specs/
RUN corepack install && pnpm install --frozen-lockfile --filter @sesv/web

COPY tsconfig.base.json ./
COPY apps/web apps/web
ARG APP_VERSION=dev
ARG APP_COMMIT=unknown
RUN APP_VERSION=${APP_VERSION} APP_COMMIT=${APP_COMMIT} pnpm --filter @sesv/web run build

# Production dependencies only, plus the build output. --legacy because @sesv/web has no
# workspace dependencies to inject.
RUN pnpm --filter @sesv/web deploy --prod --legacy /deploy \
  && mkdir /out \
  && mv /deploy/package.json /deploy/node_modules /out/ \
  && cp -r apps/web/dist /out/dist

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
  PORT=3000 \
  HOME=/tmp
WORKDIR /app
COPY --from=build --chown=0:0 /out /app
# Root owns /app and it stays read-only; the process writes only to /tmp.
USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["node", "dist/cli.mjs"]
CMD ["serve"]
