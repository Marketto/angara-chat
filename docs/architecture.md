# Architecture

Angara is a self-hosted, one-to-one text-chat MVP. It is a pnpm workspace with
a browser client, a Node.js API/realtime service, and PostgreSQL.

## Components and trust boundaries

```text
Vue PWA (apps/web) -- HTTPS / Socket.IO --> Express + Socket.IO (apps/api) --> PostgreSQL
    |                                               |
    | Google Identity Services                       +--> Web Push (generic notification)
    +-- browser session and PWA cache
```

The client verifies its Google credential through the API and receives an
`HttpOnly`, `SameSite=Strict` session cookie. An account can sign in from more
than one browser or device; no per-device cryptographic identity is registered.

Messages are sent to the API over HTTPS/WebSocket TLS and stored as plaintext in
PostgreSQL. The application server and any party with database access can read
message text. This is intentionally not end-to-end encryption.

## Data model and flows

`User` has sessions, push subscriptions, and conversation memberships. A direct
`Conversation` is uniquely identified by sorted participant IDs. A `Message` is
unique by `(conversationId, clientId)` to make retried socket sends idempotent;
it stores the message body, sender ID, and timestamps. All signed-in devices for
an account access the same complete conversation history. The MVP currently
returns that history in one chronological response; pagination should be added
before using Angara for high-volume conversations.

The REST API handles login, session state, email contact discovery, conversation
creation/history, and push subscription registration. An authenticated client
re-registers an existing browser push subscription on startup so the API can
recover if its subscription record was removed; logout removes only that
browser's endpoint so other signed-in devices keep receiving notifications. Socket.IO authenticates
the session, checks origin, joins authorized rooms, and validates membership
before creating a message. Push delivery does not depend on volatile socket
visibility state: every subscribed device of the recipient is eligible, while
the sender is excluded. The encrypted Web Push payload carries the sender
display name and optional avatar URL for OS-controlled presentation, but no
message text.

When an Angara window is focused, realtime delivery uses the bundled “Eco del
Baikal” cue and the service worker keeps the foreground system banner silent to
avoid duplicate sounds. When the app is unfocused or closed, Web Push remains
responsible for the notification and the browser or operating system chooses
its sound.

After reconnecting, the client drains its persistent IndexedDB outbox as soon
as the socket connects, independently from slower REST synchronization. The API
still marks the socket delivery-ready after restoring all authorized
conversation rooms; at that point the client refreshes the active history in
parallel with another idempotent outbox wake-up. Returning online or focusing
the app also wakes the queue. History snapshots are merged with
realtime events received while the request is in flight, so a late HTTP response
cannot overwrite a newly delivered message. Transient failures are retried, and
idempotent retries acknowledge the stored message to the retrying sender without
rebroadcasting it or creating a second row. Realtime messages are emitted only
for newly persisted records, so they reach the recipient and every connected
device belonging to the sender exactly once per accepted send. A notification
click navigates and focuses an existing app window before opening a new one. As
a non-destructive compatibility repair for already stored incidents, the client
collapses identical persisted copies from the same sender created within one
second while retaining later intentional repetitions.

## Deployment

Docker Compose runs PostgreSQL only on `angara-internal`; the app is connected to
that network and `angara-edge`; Caddy alone publishes ports 80/443 and terminates
TLS. The production container has a read-only filesystem, a temporary `/tmp`, a
PID cap, and a Node heap cap. Configuration comes from `.env` and is documented
by `.env.example`.

## Deliberate MVP limits

This release does not provide E2EE, encryption at rest, forward secrecy, or
post-compromise security. TLS protects network transport only. A compromised
server, database, or authorized operator can access message text. See [message
privacy details](e2ee.md) and [the security policy](../SECURITY.md).
