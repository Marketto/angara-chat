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

Use the OAuth web-server flow: retain both `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` only in the VPS `.env`; never commit them. The callback
exchanges the authorization code server-side and validates a short-lived,
HTTP-only `state` cookie before creating the normal session.

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
./deploy/deploy.sh
docker compose ps
```

`deploy/deploy.sh` generates a new build ID for every release. The API exposes
that ID through `/api/config`; an installed PWA compares it to its own build,
checks the service worker for an update and activates the new precache. A PWA
must be opened with network access to receive an update; a closed mobile app
cannot update itself in the background.

After a chat-delivery release, smoke-test with two signed-in devices: send two
messages rapidly and confirm each appears once, then put the receiving PWA in
the background (including a locked display) and confirm the generic push is
shown. The sender name should be the emphasized notification title, the sender
avatar should be the main icon when available, and the monochrome Angara badge
must not render as a solid square. Logging out on one device must not disable
push on the other.
Also open a second signed-in device for the sender: it must load the complete
existing history, receive new messages sent by either participant, and show no
duplicate for messages sent by the sender's other device.
The client shows **Enable notifications** only while the current device lacks a
usable browser subscription or cannot synchronize it with the server. After a
successful registration the action disappears. Focusing or reopening the PWA
checks the device again, so revoking browser permission makes the action return.

Every deployment clears dangling Angara release images before the build and
after the new release. The script never uses global Docker pruning on the shared
VPS, so it preserves VPN resources, other services, active containers, volumes,
and networks. Check `docker system df` and `df -h /` after releases on the small
VPS; investigate before available space becomes low.

For a suspected compromise, preserve relevant non-sensitive logs, rotate exposed
credentials (OAuth configuration, VAPID keys, database password, and deployment
access as appropriate), patch the host and images, and assess the warning in
`SECURITY.md`: a compromised server can serve hostile JavaScript to browsers.
Do not place credentials, user data, ciphertext dumps, or session cookies in
issues or support channels.
