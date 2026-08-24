# Angara

Angara is a small, self-hosted text chat named after the Siberian river flowing from Lake Baikal. It combines a Vue PWA, Node.js + Socket.IO, PostgreSQL, Google Sign-In, Web Push and privacy-preserving contact discovery.

> **Security boundary:** message text is encrypted and decrypted in the browser. The server persists only authenticated ciphertext. This first E2EE version is single-device and does not implement Signal's Double Ratchet, forward secrecy or post-compromise security. Read [docs/e2ee.md](docs/e2ee.md) before using it for sensitive communication.

Project orientation: [AI/contributor context](docs/ai-context.md), [architecture](docs/architecture.md), [development guide](docs/development.md), [operations runbook](docs/operations.md), and [agent router](AGENTS.md).

## What works

- Google Identity Services login with server-side ID-token verification
- server-side sessions in `HttpOnly`, `SameSite=Strict`, secure cookies
- one-to-one text messages encrypted with ECDH P-256, HKDF-SHA-256 and AES-256-GCM
- non-exportable private device key stored in browser IndexedDB
- verifiable contact-key fingerprints with trust-on-first-use pinning
- opaque encrypted envelopes persisted in PostgreSQL
- idempotent message sends and membership checks on every read/write
- installable Vue PWA with standard Web Push notifications
- contact discovery by email without storing the address book
- responsive mobile/desktop UI
- Docker Compose deployment with Caddy-managed HTTPS
- validation tests, linting, type checking, CI and Dependabot

## Important platform limits

- A WhatsApp-style phone-address-book match requires verified phone numbers (typically SMS OTP). Google login alone does not verify a phone number. This MVP matches email addresses.
- The browser contact picker is not universal. It only exposes contacts the user explicitly chooses and may be unavailable on iPhone; manual email search is always available.
- On iPhone/iPad, push notifications require adding the PWA to the Home Screen first and granting permission from a user action.
- This project is text-only: no files, voice, calls, groups, read receipts or typing indicators.
- One Google account currently supports one browser device. Clearing site data loses the private key and makes existing history unreadable.
- There is no key backup or recovery by design in this version. Install and use the PWA on the intended primary device.
- Key compromise reveals past messages because the protocol does not yet ratchet keys. This is not Signal Protocol.

## PostgreSQL or MongoDB?

Angara uses PostgreSQL. Conversation membership, unique device ownership, idempotent message IDs and ordered message history benefit from relational constraints and transactions. MongoDB's document model offers no meaningful advantage because message content is an opaque ciphertext envelope.

For a minimal VPS, PostgreSQL is also easier to budget: this Compose configuration uses `shared_buffers=64MB`, `max_connections=20`, a five-connection Prisma pool and a 192 MB Node heap cap. MongoDB WiredTiger reserves at least roughly 256 MB for its internal cache and also relies on filesystem cache. If the complete VPS has substantially less than 1 GB RAM, benchmark Amnezia and Angara together before production; SQLite would be the next option to evaluate, not MongoDB.

## Local development

Requirements: Node.js 22+, pnpm 10, Docker, and a Google OAuth Web client.

```bash
cp .env.example .env
docker compose up -d db
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

For local development set `APP_ORIGIN=http://localhost:5173`, `COOKIE_SECURE=false`, and expose the API on port 3000. Vite proxies `/api` and `/socket.io` to it.

Generate VAPID keys once:

```bash
pnpm dlx web-push generate-vapid-keys
```

Copy the generated public/private values into the VPS `.env`; never commit that file.

## VPS deployment

1. Point a DNS `A`/`AAAA` record such as `chat.example.com` to the VPS.
2. In Google Cloud Console create an OAuth 2.0 **Web application** client and add `https://chat.example.com` as an authorized JavaScript origin.
3. Clone the repository on the VPS and create `.env` from `.env.example`.
4. Replace every placeholder with fresh values. Use a long random PostgreSQL password.
5. Check that TCP 80/443 are not already bound. Amnezia commonly uses separate VPN ports, but the actual VPS configuration is authoritative.
6. Start the application:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f app caddy
```

Caddy obtains and renews TLS certificates automatically. PostgreSQL is reachable only on the internal Docker network; the application shares only the edge network with Caddy. Do not publish port 5432.

If port 443 is already reserved by a VPN, this configuration serves Angara on `https://chat.example.com:8443`. Keep port 80 available for certificate validation and configure Google OAuth with the exact `:8443` origin.

If the VPS already has a reverse proxy on 80/443, remove the `caddy` service and its published ports, attach `app` to the existing proxy network, and proxy both HTTP and WebSocket traffic to `app:3000`.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

After deployment, test with two separate Google accounts on two devices: install/open the PWA on each primary device, create a chat by email, compare the displayed fingerprints through another channel, exchange messages in both directions, enable notifications, close it, and send another message. Confirm directly in PostgreSQL that the `Message` table contains ciphertext but no plaintext column.

## Secrets and privacy

The repository intentionally contains no IP, domain belonging to the operator, OAuth credential, VAPID private key, database password, user data or VPS configuration. `.env*` files are ignored except for the placeholder `.env.example`.

Contact emails are normalized, compared to registered users and discarded at the end of the request. They are not written to the database. Google ID tokens are verified and then discarded; the app stores the stable Google `sub`, email, display name and avatar URL. Push notifications contain only a generic “encrypted message” notice.

See [SECURITY.md](SECURITY.md) before exposing the service to users.

## License

MIT
