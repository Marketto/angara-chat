# Operations runbook

Use this guide for a production instance deployed with the repository's Docker
Compose configuration. It complements the security checklist in
[`SECURITY.md`](../SECURITY.md).

## Health and routine checks

The `app` container is healthy only when `GET /api/health` can query PostgreSQL;
Caddy waits for that health check before starting. Check the stack after a deploy:

```bash
docker compose ps
docker compose logs --tail=100 app caddy db
```

Monitor certificate renewal, container health, disk use, PostgreSQL backup jobs,
and host updates. PostgreSQL must remain reachable only on `angara-internal`;
do not publish port 5432.

When the VPS reserves 443 for a VPN, Angara listens on HTTPS port 8443 while
Caddy keeps port 80 for ACME HTTP validation. Use an explicit URL such as
`https://chat.example.com:8443` and set `APP_ORIGIN` and the Google OAuth origin
with the same port. In Google Auth Platform also register
`https://chat.example.com:8443/api/auth/google/redirect` as an authorized redirect
URI: this is the PWA-safe Sign in with Google return endpoint. Do not reassign
port 443 or restart the VPN containers.

## Backup and restore rehearsal

Back up the database with encrypted, access-controlled storage outside the VPS.
The following writes a logical dump on the host; use a dated filename and move it
to the approved encrypted backup destination immediately:

```bash
docker compose exec -T db pg_dump -U chat -d chat --format=custom > angara-YYYY-MM-DD.dump
```

At least periodically, restore a backup into an isolated PostgreSQL instance and
verify that the expected schemas and records are present. A restore confirms the
backup is usable, but it does **not** make old messages readable after a user has
lost their browser device key.

## Deployment and incident response

Before updating, back up the database, review `.env`, and run:

```bash
docker compose config
docker compose up -d --build
docker compose ps
```

For a suspected compromise, preserve relevant non-sensitive logs, rotate exposed
credentials (OAuth configuration, VAPID keys, database password, and deployment
access as appropriate), patch the host and images, and assess the warning in
`SECURITY.md`: a compromised server can serve hostile JavaScript to browsers.
Do not place credentials, user data, ciphertext dumps, or session cookies in
issues or support channels.
