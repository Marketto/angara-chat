# Development guide

## Prerequisites

Use Node.js 22+, pnpm 10, Docker, PostgreSQL through Docker Compose, and a
Google OAuth Web client. Copy the template without committing the result:

```bash
cp .env.example .env
```

For local development set `APP_ORIGIN=http://localhost:5173` and
`COOKIE_SECURE=false` in `.env`. Configure the Google client with that origin.
To enable the non-native-contact fallback, enable the Google People API in the
same Google Cloud project; Angara requests the read-only Contacts scope only
after the user presses **Nuova chat**.

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

### Local login without Google

For local multi-account testing, choose a test-only token of at least 32
characters and provide the same value to the API and Vite. The API exposes the
local login only outside production, on a localhost origin, and with
`COOKIE_SECURE=false`:

```bash
DOTENV_CONFIG_PATH=../../.env TEST_AUTH_TOKEN=replace-with-a-local-test-token pnpm --filter @angara/api dev
VITE_TEST_AUTH_TOKEN=replace-with-the-same-local-test-token pnpm --filter @angara/web dev
```

Open separate browser profiles and sign in with different test email addresses.
To verify multi-device behavior, sign in to two profiles with the same Alice
address and one profile with a Bob address, create one conversation, then send
in both directions. Both Alice profiles and Bob must receive each realtime
message, and a newly opened Alice profile must load the complete server history.
The non-regression socket test runs the equivalent three-client topology without
Google:

```bash
pnpm --filter @angara/api exec vitest run test/socket-multidevice.integration.test.ts
```

For sharing smoke tests, use the same Alice/Bob profiles and verify in both
directions: an allowed image, an allowed document, and an explicitly confirmed
location. Take one sender offline before selecting a small file, restore the
network, and confirm the pending item uploads once and appears on the sender's
second device and the recipient. A non-member attachment URL must return 404.
The OpenStreetMap request must not occur until the recipient chooses to open the
map, and its attribution must remain visible. Browser geolocation requires a
secure context; localhost is accepted for local development.

Images are limited to JPEG, PNG, GIF, and WebP. Documents are limited to PDF and
UTF-8 plain text. SVG and HTML are rejected; each file is capped at exactly
8 MiB (8,388,608 bytes), with a fixed aggregate quota of 256 MiB per sender
account. Test fixtures should be minimal and contain neither personal files nor
real coordinates.

## Validation

Run a focused package check while iterating:

```bash
pnpm --filter @angara/web test
pnpm --filter @angara/api test
node --test deploy/caddyfile.test.mjs
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
