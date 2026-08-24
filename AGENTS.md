# Angara agent router

This file is the entry point for coding agents working in this repository. Route
each task to the smallest specialist scope below, read that agent's instructions
before editing, and keep one agent responsible for each file at a time.

## Project at a glance

Angara is a pnpm workspace for a self-hosted, one-to-one encrypted text chat:

- `apps/web`: Vue 3 + Vite PWA. It creates and holds the non-exportable device
  private key and performs all message encryption/decryption.
- `apps/api`: Express 5 + Socket.IO API. It verifies Google login, manages
  sessions, authorizes requests, and persists opaque encrypted envelopes.
- `apps/api/prisma`: PostgreSQL schema and migrations.
- `deploy`, `Dockerfile`, `docker-compose.yml`: production image, Caddy TLS,
  and the constrained Compose deployment.

Read [docs/architecture.md](docs/architecture.md) before a cross-cutting change,
[docs/development.md](docs/development.md) before running the application, and
[docs/operations.md](docs/operations.md) before deployment work.
`docs/e2ee.md` and `SECURITY.md` are required reading for security-sensitive
work.

## Routing table

| Change area | Primary agent | Required review |
| --- | --- | --- |
| Vue UI, PWA, browser storage, client API, crypto implementation | `.agents/web-pwa.md` | `.agents/security-crypto.md` when keys, ciphertext, authentication, or message metadata change |
| Express routes, Socket.IO, sessions, validation, push | `.agents/api-data.md` | `.agents/security-crypto.md` for auth, authorization, origin, rate-limit, or message-flow changes |
| Prisma schema, migrations, database performance/integrity | `.agents/api-data.md` | `.agents/security-crypto.md` if data visibility, retention, identity, or message storage changes |
| Docker, Caddy, CI, dependencies, tests, release checks | `.agents/quality-release.md` | domain agent for application changes; `.agents/security-crypto.md` for exposure, headers, or secrets |
| Threat modeling, E2EE protocol, secrets, security findings | `.agents/security-crypto.md` | `.agents/quality-release.md` for verification coverage |

For a task spanning multiple rows, assign a lead to the layer containing the
user-visible behavior, then request focused reviews from the other listed
agents. Do not parallelize edits to the same file or implement protocol changes
without the security review.

## Universal working agreement

1. Inspect the relevant code, tests, and current `git status` before editing.
   Preserve unrelated user changes.
2. Make the smallest coherent change. Keep the server unable to read message
   plaintext and do not loosen authorization merely to simplify a flow.
3. Add or update focused tests for changed behavior. Do not log credentials,
   cookies, plaintext, contact lists, keys, or production configuration.
4. Run the narrowest relevant checks first, then the applicable workspace
   command(s) below. Report checks that cannot be run and why.
5. Update architecture, E2EE, security, or deployment documentation whenever a
   corresponding contract changes.

## Commands

```bash
pnpm install
docker compose up -d db
pnpm db:generate
pnpm db:migrate
pnpm dev

pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Use Node.js 22+ and pnpm 10. Copy `.env.example` to `.env` for local work;
never commit that file. Local development uses `APP_ORIGIN=http://localhost:5173`
and `COOKIE_SECURE=false`.

## Non-negotiable invariants

- Message plaintext and private device keys stay in the browser. PostgreSQL
  stores ciphertext, IV, version, and routing metadata only.
- Every HTTP and socket operation that accesses a conversation verifies session,
  origin where applicable, and membership.
- Device keys are single-device and TOFU-pinned. Do not claim forward secrecy,
  recovery, multi-device support, or Signal Protocol properties.
- Production secrets live only in deployment configuration. Keep PostgreSQL off
  the public network and preserve Caddy's HTTPS/WebSocket proxy behavior.

## Definition of done

The implementation, appropriate tests, relevant documentation, and the checks
for the touched packages are complete. For any changes to encryption,
authentication, authorization, persistence, or deployment exposure, include a
short explicit invariant review in the handoff.
