# Security policy

## Before production

- Keep the VPS, Docker Engine and images patched.
- Restrict SSH to keys; disable password and root login where practical.
- Keep `.env` readable only by the deployment account and never copy it into support tickets or logs.
- Back up PostgreSQL encrypted, test restoration, and define a retention period.
- Configure Google OAuth for the exact HTTPS origin only.
- Confirm ports 80/443 and the chosen Amnezia VPN ports do not conflict.
- Apply firewall rules deliberately; do not expose PostgreSQL or the Node container directly.
- Add monitoring for disk space, certificate renewal, container health and backup failures.

## Threat model and known gaps

This release protects sessions against JavaScript access, checks same-origin state-changing requests, rate-limits login, verifies Google ID tokens on the server, validates input and authorizes conversation membership.

Message content is encrypted in the browser using a per-device ECDH P-256 key, HKDF-SHA-256 and AES-256-GCM. PostgreSQL stores ciphertext and authenticated routing metadata, not plaintext. A database-only compromise does not reveal message text without a device key.

The server still sees metadata: accounts, participants, device public keys, timestamps, ciphertext sizes, IP-level traffic and push endpoints. Trust on first use cannot detect a malicious server that substitutes a key before the first fingerprint comparison. Users must compare fingerprints through a separate trusted channel.

This is a web application: a fully compromised VPS can serve modified JavaScript that captures future plaintext or invokes a non-exportable key while the app is open. A non-exportable `CryptoKey` prevents direct key extraction but cannot make a hostile client bundle safe.

This version supports one device per account and has no key backup. Clearing browser storage or losing the device makes existing history permanently unreadable. Static ECDH does not provide forward secrecy or post-compromise security: theft of the device private key can decrypt past stored messages.

For higher-risk use, migrate to an audited asynchronous protocol with prekeys and Double Ratchet/PQ ratchet semantics, signed reproducible clients, multi-device session management, recovery design, abuse controls, account deletion/export, retention controls and an independent security review. See [docs/e2ee.md](docs/e2ee.md).

## Reporting a vulnerability

Do not open a public issue containing exploit details, user data, secrets or server addresses. Contact the repository owner privately through their published GitHub security contact.
