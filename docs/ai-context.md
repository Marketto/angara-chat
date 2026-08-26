# Angara: AI and contributor context

This file is a compact, stable entry point for AI agents and contributors. Read it
before changing the project, then follow the linked specialist documents.

## Purpose

Angara is a self-hosted, one-to-one encrypted text-chat PWA. The web client
encrypts and decrypts message text; the API and database only handle opaque
encrypted envelopes and routing metadata.

## Repository map

| Path | Responsibility | Do not violate |
| --- | --- | --- |
| `apps/web` | Vue 3 PWA, browser storage, device keys, encryption, UI | Private device keys and plaintext stay in the browser. |
| `apps/api` | Express, Socket.IO, sessions, authorization, encrypted envelope persistence | Validate input and membership; never inspect or log plaintext. |
| `apps/api/prisma` | PostgreSQL schema and migrations | Change persistence through new migrations. |
| `deploy`, `Dockerfile`, `docker-compose.yml` | Caddy, image build, production topology | Do not expose PostgreSQL or take over a VPN port. |

## Mandatory invariants

1. Message plaintext and private ECDH keys never leave the browser.
2. Each conversation operation requires a session, same-origin protection where
   applicable, and membership authorization.
   Google Identity intentionally uses `Cross-Origin-Opener-Policy:
   same-origin-allow-popups` so its non-FedCM popup can return its credential;
   keep the CSP limited to the documented Google Identity origins.
3. This is a one-device, TOFU, static-ECDH MVP. Do not claim Signal Protocol,
   forward secrecy, recovery, or multi-device support.
4. Production secrets are only in the VPS `.env`; never commit or log them.
5. In the current VPS topology Amnezia uses port `443`; Angara uses Caddy on
   `80` and `8443`. Do not restart, reconfigure, or prune VPN containers/images.

## UI and localisation

- Bootstrap 5 CSS is bundled locally, not loaded from a CDN.
- `apps/web/src/i18n.ts` detects the browser language and supports `it`, `en`,
  and `ru`, falling back to English. The in-app selector is intentionally not
  persisted: no session data is stored in browser Web Storage.
- The chat surface randomly selects one of four lightweight inline CSS textile
  patterns whenever a conversation is opened: Siberian border, Irtysh, steppe,
  or winter. They make no network request and must remain low contrast behind
  readable message bubbles. The choice is intentionally not persisted.

## Development and verification

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Use focused checks while iterating:

```bash
pnpm --filter @angara/web typecheck
pnpm --filter @angara/api test
```

## Production deployment

1. Work only in the Angara checkout, currently `/opt/angara` on the VPS.
2. Keep `.env` on the VPS. Its `APP_ORIGIN` and Google OAuth origin must exactly
   match `https://chat.marketto.it:8443` (or the configured public origin). Also
   configure its `/api/auth/google/redirect` URL as the Google redirect URI.
3. Run `./deploy/deploy.sh` from the Angara directory. It generates the shared
   frontend/backend build ID used for installed-PWA update checks.
4. Verify `https://<host>:8443/api/health`, `docker compose ps`, and recent
   Angara logs. Confirm the Amnezia containers remain healthy afterwards.
5. Before cleanup, remove only files or dangling images proven to belong to
   Angara. Do not use global Docker prune commands on this shared VPS.

## Required reading by change type

| Change | Read first |
| --- | --- |
| Any task | `AGENTS.md` |
| Cross-cutting code | `docs/architecture.md` |
| Auth, crypto, storage, or message flow | `docs/e2ee.md`, `SECURITY.md` |
| Deployment or VPS work | `docs/operations.md`, `.agents/quality-release.md` |
| Web/PWA work | `.agents/web-pwa.md` |
| API/database work | `.agents/api-data.md` |
