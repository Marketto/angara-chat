FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm --filter @angara/api db:generate && pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN corepack enable && addgroup -S chat && adduser -S chat -G chat
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
RUN pnpm install --prod --no-frozen-lockfile --filter @angara/api
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/web/dist apps/web/dist
USER chat
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @angara/api db:deploy && node apps/api/dist/index.js"]
