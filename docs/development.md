# Development guide

## Prerequisites

Use Node.js 22+, pnpm 10, Docker, PostgreSQL through Docker Compose, and a
Google OAuth Web client. Copy the template without committing the result:

```bash
cp .env.example .env
```

For local development set `APP_ORIGIN=http://localhost:5173` and
`COOKIE_SECURE=false` in `.env`. Configure the Google client with that origin.

## Start locally

```bash
docker compose up -d db
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Vite serves the client at `http://localhost:5173` and proxies `/api` and
`/socket.io` to the API on port 3000. Generate VAPID keys with
`pnpm dlx web-push generate-vapid-keys`; place them only in `.env`.

## Validation

Run a focused package check while iterating:

```bash
pnpm --filter @angara/web test
pnpm --filter @angara/api test
```

Before handoff or a pull request, run the workspace suite:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Change guide

- Update `apps/web/src/types.ts` and API schemas together when an API payload
  changes; include both HTTP and Socket.IO consumers.
- Change Prisma models through a new migration, then regenerate the client.
- Read `docs/e2ee.md` and `SECURITY.md` before changing crypto, identity,
  session, ciphertext, device, or notification behavior.
- Use `AGENTS.md` to select a focused implementation/review agent. Keep
  documentation aligned with behavior and never place real secrets or user data
  in fixtures, logs, commits, or screenshots.
