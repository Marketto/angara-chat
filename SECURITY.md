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

Message content is protected in transit by HTTPS/WebSocket TLS, but it is stored
as plaintext in PostgreSQL. The application server, database administrators, and
a database-only compromise can read message text. Database backups therefore
contain sensitive plaintext and require encryption, access control, retention,
and restoration testing.

The server sees accounts, participants, plaintext message content, timestamps,
online presence implicit in socket connections, IP-level traffic and push
endpoints. Push payloads remain generic and contain no message preview.

This is a web application: a fully compromised VPS can serve modified JavaScript
and can read stored message text. The current design provides no confidentiality
from the service operator.

The same account can be used from multiple devices; all authenticated sessions
access the same server-stored history. There are no device keys or key recovery
flows in this release.

For higher-risk use, do not rely on this release for message confidentiality.
Before claiming E2EE, adopt an audited protocol and design multi-device key
management, recovery, retention, account deletion/export, abuse controls and an
independent security review. See [docs/e2ee.md](docs/e2ee.md).

## Reporting a vulnerability

Do not open a public issue containing exploit details, user data, secrets or server addresses. Contact the repository owner privately through their published GitHub security contact.
