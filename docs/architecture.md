# Architecture

Angara is a self-hosted, one-to-one encrypted text-chat MVP. It is a pnpm
workspace with a browser client, a Node.js API/realtime service, and PostgreSQL.

## Components and trust boundaries

```text
Vue PWA (apps/web) -- HTTPS / Socket.IO --> Express + Socket.IO (apps/api) --> PostgreSQL
    |                                               |
    | Google Identity Services                       +--> Web Push (generic notification)
    +-- IndexedDB: non-exportable private device key
```

The client verifies its Google credential through the API and receives an
`HttpOnly`, `SameSite=Strict` session cookie. The browser generates a P-256 ECDH
device keypair, keeps the private key in IndexedDB, and registers only the public
key and its fingerprint with the API.

For each message, the browser derives an AES-256-GCM key from its private ECDH
key and the peer public key using HKDF-SHA-256. The conversation ID is used in
the HKDF salt; authenticated additional data binds protocol version, conversation
ID, client message ID, sender ID, and both device IDs. The API persists and
relays the resulting ciphertext envelope but cannot decrypt it.

## Data model and flows

`User` has one `Device`, sessions, push subscriptions, and conversation
memberships. A direct `Conversation` is uniquely identified by sorted participant
IDs. A `Message` is unique by `(conversationId, clientId)` to make retried socket
sends idempotent; it stores ciphertext, IV, version, sender/recipient device IDs,
and timestamps.

The REST API handles login, session state, device registration, email contact
discovery, conversation creation/history, and push subscription registration.
Socket.IO authenticates the session, checks origin, joins authorized rooms, and
validates membership and devices before creating a message. Push notifications
are intentionally generic and contain no message content.

## Deployment

Docker Compose runs PostgreSQL only on `angara-internal`; the app is connected to
that network and `angara-edge`; Caddy alone publishes ports 80/443 and terminates
TLS. The production container has a read-only filesystem, a temporary `/tmp`, a
PID cap, and a Node heap cap. Configuration comes from `.env` and is documented
by `.env.example`.

## Deliberate MVP limits

This is not Signal Protocol. It supports one browser device per account, TOFU
fingerprint pinning, static ECDH, no key backup/recovery, no forward secrecy, and
no post-compromise security. A compromised server can still serve hostile client
JavaScript. See [E2EE details](e2ee.md) and [the security policy](../SECURITY.md).
