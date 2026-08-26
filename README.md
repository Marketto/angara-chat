# Angara

Angara is a small, self-hosted text chat named after the Siberian river flowing from Lake Baikal. It combines a Vue PWA, Node.js + Socket.IO, PostgreSQL, Google Sign-In, Web Push and privacy-preserving contact discovery.

> **Security boundary:** this release is **not end-to-end encrypted**. Message
> text is protected in transit with TLS but stored as plaintext by the service;
> the server, database, and their backups can read it. Do not use it for
> sensitive communication. Read [docs/e2ee.md](docs/e2ee.md) before deployment.

Project orientation: [AI/contributor context](docs/ai-context.md), [architecture](docs/architecture.md), [development guide](docs/development.md), [operations runbook](docs/operations.md), and [agent router](AGENTS.md).

## What works

- Google Identity Services login with server-side ID-token verification
- server-side sessions in `HttpOnly`, `SameSite=Strict`, secure cookies
- one-to-one text messages stored server-side as plaintext
- multi-device access to the same account and conversation history
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
- Message text is available to the service operator, database administrators and
  anyone with access to database backups. TLS protects transport only.
- This version does not provide E2EE, forward secrecy, post-compromise security
  or encryption at rest for message bodies.

## PostgreSQL or MongoDB?

Angara uses PostgreSQL. Conversation membership, idempotent message IDs and
ordered message history benefit from relational constraints and transactions.
MongoDB's document model offers no meaningful advantage for this relational chat
model.

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

After deployment, test with two separate Google accounts on two devices: sign in
to one account on more than one device, create a chat by email, exchange messages
in both directions, enable notifications, close it, and send another message.
Confirm that the same account sees its conversation history from each signed-in
device. Treat PostgreSQL and its backups as sensitive because `Message.body`
contains plaintext.

## Secrets and privacy

The repository intentionally contains no IP, domain belonging to the operator, OAuth credential, VAPID private key, database password, user data or VPS configuration. `.env*` files are ignored except for the placeholder `.env.example`.

Contact emails are normalized, compared to registered users and discarded at the end of the request. They are not written to the database. Google ID tokens are verified and then discarded; the app stores the stable Google `sub`, email, display name and avatar URL. Push notifications contain only a generic “new message” notice.

See [SECURITY.md](SECURITY.md) before exposing the service to users.

## License

MIT
