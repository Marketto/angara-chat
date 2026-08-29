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

## Trial TURN relay without disturbing the VPN

The optional `turn` Compose service is a constrained relay trial; it does not
enable calling UI by itself. It does not use port 443, Caddy, the VPN network,
or the Angara app/database networks. Set `TURN_LISTEN_IP` to the public host
IPv4 and generate a random `TURN_AUTH_SECRET` only in the VPS `.env`; never use
a VPN/private address or commit either value. It publishes only TCP/UDP 3478
and UDP 49160–49175, with a maximum of four allocations (at most two calls).

Before and after starting it, record `free -h`, `docker stats --no-stream`,
`ufw status`, and Amnezia connectivity. The service is capped at 96 MiB and
0.20 CPU, has no CLI, TLS listener, TCP relay, persistent storage, or access to
the Angara networks. Stop it immediately at VPN degradation, memory pressure,
or unexpected traffic.

## Backup and restore rehearsal

Back up the database with encrypted, access-controlled storage outside the VPS.
The following writes a logical dump on the host; use a dated filename and move it
to the approved encrypted backup destination immediately:

```bash
docker compose exec -T db pg_dump -U chat -d chat --format=custom > angara-YYYY-MM-DD.dump
```

At least periodically, restore a backup into an isolated PostgreSQL instance and
verify that the expected schemas and records are present. A restore confirms the
backup is usable. Treat dumps as sensitive plaintext: they include messages,
attachment names and bytes, shared coordinates, and account metadata.

Attachments are stored in PostgreSQL and therefore increase the database,
volume, dump size, backup duration, and restore duration. Monitor both the whole
database and the attachment relation, for example from an authorized `psql`
session:

```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT pg_size_pretty(pg_total_relation_size('"MessageAttachment"'));
```

The 8 MiB per-file cap, upload rate limit, concurrency cap, and fixed 256 MiB
aggregate quota per sender are availability controls, not a retention policy.
Define how long messages and backups are retained before production use.
Deleting a message also deletes its attachment through the database relation;
coordinate deletion with backups and legal requirements rather than manually
deleting binary rows.

## Deployment and incident response

Before updating, back up the database, review `.env`, and run:

```bash
docker compose config
./deploy/deploy.sh
docker compose ps
```

For a sharing release, also verify before switching traffic:

```bash
node --test deploy/caddyfile.test.mjs
pnpm typecheck
pnpm lint
pnpm test
pnpm build
docker compose config
```

Record the previous release commit and a fresh backup before deployment. The
attachment migration is additive, so a code rollback can rebuild the recorded
previous commit from a clean deployment checkout while leaving the new table
and nullable message columns in place. Do not reverse or drop the migration as
an incident shortcut: that would delete attachment and location data. After a
rollback, repeat health, log, text-message, and multi-device checks; attachments
created by the newer release remain stored but are not available through the
older UI until the feature is deployed again.

`deploy/deploy.sh` generates a new build ID for every release. The API exposes
that ID through `/api/config`; an installed PWA compares it to its own build,
checks the service worker for an update and activates the new precache. A PWA
must be opened with network access to receive an update; a closed mobile app
cannot update itself in the background.
If registration is slow or temporarily unavailable, the client remains usable;
the forced fallback reload is limited to once per server build so a stale
installation cannot enter an infinite reload loop.

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
With the receiving PWA already in the background, open a message notification
and confirm the existing app window is focused on the conversation rather than
creating a second window. The incoming message must appear once on both sides.
The client shows **Enable notifications** only while the current device lacks a
usable browser subscription or cannot synchronize it with the server. After a
successful registration the action disappears. Focusing or reopening the PWA
checks the device again, so revoking browser permission makes the action return.

After an attachment/location release, use two accounts and a second device for
the sender. Send an allowed image, an allowed document, and a confirmed location
in both directions; each item must appear once on all three devices. Downloaded
documents must not render inline, and an authenticated non-member must receive
the same not-found result as an unknown attachment. Queue a small attachment
offline, reconnect, and confirm it uploads once without delaying the text
outbox. Reject a file over 8 MiB at the edge/API boundary without restarting the
app. Confirm the location prompt appears only after the explicit action and that
OpenStreetMap receives no tile request until the viewer opens the placeholder;
the opened map must show attribution.

Finally inspect application memory, PostgreSQL/volume growth, upload error rate,
`docker system df`, and `df -h /`. A 413 indicates the intentional per-file
limit; repeated 429/503 responses can indicate abusive rate/concurrency or a VPS
under memory pressure. Public OpenStreetMap tiles have no application-controlled
availability guarantee, so tile failure must not prevent reading the coordinates
or the rest of the conversation.

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
