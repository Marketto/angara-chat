# Angara E2EE protocol v1

## Scope

Version 1 prevents the normal Node.js application, PostgreSQL database, push provider and database backups from reading message text. It is designed as a small, understandable single-device MVP, not as a new replacement for Signal Protocol.

## Device identity

On first authenticated use, the browser generates an ECDH P-256 key pair with Web Crypto. The public JWK and its SHA-256 fingerprint are registered on the server. The private key is immediately re-imported as a non-exportable `CryptoKey` and stored in IndexedDB. The server schema permits one device per user.

The fingerprint is:

```text
SHA-256(UTF8("P-256:" || publicJwk.x || ":" || publicJwk.y))
```

The client pins the first observed fingerprint for each contact locally. A later change blocks sending. Users should compare fingerprints out of band because trust on first use cannot detect substitution before the first observation.

## Message encryption

For each one-to-one conversation, both clients derive the same 256-bit ECDH secret from their device keys. A conversation-specific AES-256-GCM key is derived with:

```text
salt = SHA-256(UTF8("angara:conversation:" || conversationId))
info = UTF8("angara-message-v1")
key  = HKDF-SHA-256(ECDH-secret, salt, info, 32 bytes)
```

Every message uses a fresh random 96-bit IV. AES-GCM authenticates both the UTF-8 message body and this additional data:

```json
[1, "conversationId", "clientId", "senderUserId", "senderDeviceId", "recipientDeviceId"]
```

The server validates conversation membership and device ownership, then stores only `ciphertext`, `iv`, `version`, IDs and timestamps. Changing the ciphertext, IV or authenticated routing context causes decryption to fail.

## What the server can observe

- Google account identity and profile fields
- conversation participants
- device public keys and fingerprints
- sender/recipient device IDs, timestamps and ciphertext sizes
- online presence implicit in socket connections
- push subscription endpoints
- network metadata available to the VPS

Push payloads deliberately contain no message preview.

## Security limitations

- No Double Ratchet, forward secrecy or post-compromise recovery.
- One device per user; no device linking or encrypted key backup.
- Loss of IndexedDB means loss of access to message history.
- Trust on first use requires manual fingerprint comparison for server-key-substitution detection.
- A compromised web server can serve a malicious future client bundle. Signed native clients or reproducible independently hosted bundles provide a stronger delivery boundary.
- Message length, timing and participants are not hidden.
- The design has not received an independent cryptographic audit.

The official `libsignal` implementation includes the Double Ratchet but states that use outside Signal is unsupported, while the former browser JavaScript implementation is archived. A production upgrade should therefore select a maintained, browser-compatible, auditable protocol implementation and cover prekeys, out-of-order delivery, skipped-key limits, multi-device Sesame-style session management and migrations before claiming Signal-equivalent security.
