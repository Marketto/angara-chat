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

Messages composed while offline, pending attachment `Blob`s, and pending shared
coordinates are also retained as plaintext in the browser's IndexedDB until the
server acknowledges them. They are removed on acknowledgement or explicit
sign-out, but remain readable to anyone with access to the unlocked browser
profile before then.

## Authentication and device access

Google authentication establishes a server-side session in a secure, `HttpOnly`
cookie. There are no device keys, key fingerprints, trust-on-first-use checks, or
device-linking flows. Clearing browser data does not make stored conversation
history unreadable; signing in again restores access to the account history.

## Message storage and delivery

The client sends a UTF-8 message body, attachment, or coordinates to the API over
TLS. The server validates the authenticated sender and conversation membership,
stores content, sender ID, client message ID, and timestamps, then relays content
or attachment metadata to authorized conversation members. The
`(conversationId, clientId)` constraint keeps retried sends idempotent. File
bytes are fetched separately through an authenticated, membership-authorized
endpoint. Image bytes are purged from the running service no later than 48 hours
after upload; message metadata stays in history and a browser that has already
received the image keeps an account-scoped local Blob cache until explicit
sign-out. Documents do not have this expiry.

TLS protects the connection in transit but does not encrypt the message body,
file bytes and metadata, or coordinates from the application server or database
while they are retained there. Image expiry is not a guarantee about previously
created database backups, which retain bytes according to their backup policy.
Image files may retain EXIF metadata such as capture time, camera details, and a
photo's own GPS coordinates; Angara does not strip it. Push notifications remain
generic and do not include a message preview, attachment name, or location.

## What the service can observe

- Google account identity and profile fields
- conversation participants and plaintext message bodies
- attachment names, media types, sizes, digests, and embedded metadata; image
  bytes while the temporary 48-hour server copy exists, and document bytes
- precise shared coordinates and reported accuracy
- sender IDs, timestamps and online presence implicit in socket connections
- push subscription endpoints
- network metadata available to the VPS

## Security limitations

- The server and database can read message text; database-only compromise exposes
  stored messages.
- Backups must be encrypted and access controlled because they contain plaintext
  message bodies, attachment metadata, shared coordinates, and any attachment
  bytes present when the backup was made.
- TLS does not protect messages from the service operator or a compromised VPS.
- Message bodies, lengths, timing and participants are not hidden from the
  service.
- Opening a shared map sends the viewer's IP address and requested tile area to
  OpenStreetMap's public tile service. Tiles load only after an explicit click;
  they are not prefetched or saved for offline use.
- This design is not Signal Protocol and has no forward secrecy,
  post-compromise security, encrypted device backup, or independently audited
  E2EE protocol.

An E2EE future release would require a new, audited protocol design and a clear
migration strategy before any E2EE claim is made.
