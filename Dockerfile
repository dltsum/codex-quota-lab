FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @quotalab/server deploy --prod --legacy /server

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4317
ENV QUOTALAB_DB=/data/quotalab.db
ENV QUOTALAB_WEB_DIST=/app/web
ENV QUOTALAB_SECURE_COOKIES=true
ENV QUOTALAB_TRUST_PROXY=true

WORKDIR /app
COPY --from=build /server ./
COPY --from=build /workspace/apps/web/dist ./web

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 4317
VOLUME ["/data"]
CMD ["node", "dist/index.js"]
