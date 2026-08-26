# Message privacy and encryption status

## Scope

The current Angara release does **not** implement end-to-end encryption (E2EE).
It is a conventional authenticated web chat with multi-device access: users can
sign in from multiple browsers or devices and see the same message history.

Messages travel over HTTPS/WebSocket TLS, but the Node.js application stores
their plaintext bodies in PostgreSQL. The application server, database
administrators, database backups, and anyone who compromises those systems can
read message text. Do not use this release for communications that require E2EE
or confidentiality from the service operator.

## Authentication and device access

Google authentication establishes a server-side session in a secure, `HttpOnly`
cookie. There are no device keys, key fingerprints, trust-on-first-use checks, or
device-linking flows. Clearing browser data does not make stored conversation
history unreadable; signing in again restores access to the account history.

## Message storage and delivery

The client sends a UTF-8 message body to the API over TLS. The server validates
the authenticated sender and conversation membership, stores `body`, sender ID,
client message ID, and timestamps, then relays the body to authorized
conversation members. The `(conversationId, clientId)` constraint keeps retried
sends idempotent.

TLS protects the connection in transit but does not encrypt the message body from
the application server or database. Push notifications remain generic and do not
include a message preview.

## What the service can observe

- Google account identity and profile fields
- conversation participants and plaintext message bodies
- sender IDs, timestamps and online presence implicit in socket connections
- push subscription endpoints
- network metadata available to the VPS

## Security limitations

- The server and database can read message text; database-only compromise exposes
  stored messages.
- Backups must be encrypted and access controlled because they contain plaintext
  message bodies.
- TLS does not protect messages from the service operator or a compromised VPS.
- Message bodies, lengths, timing and participants are not hidden from the
  service.
- This design is not Signal Protocol and has no forward secrecy,
  post-compromise security, encrypted device backup, or independently audited
  E2EE protocol.

An E2EE future release would require a new, audited protocol design and a clear
migration strategy before any E2EE claim is made.
