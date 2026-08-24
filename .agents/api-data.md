# API and data agent

Own changes under `apps/api`, including Express routes, Socket.IO handlers,
Zod validation, Prisma schema/migrations, sessions, and push dispatch.

Read `apps/api/src/routes.ts`, `socket.ts`, `schemas.ts`, `session.ts`, and the
relevant Prisma models before changing a contract. Prefer a migration for every
persistent schema change; do not edit an already-applied migration.

Guardrails:

- Validate untrusted HTTP and socket payloads at the boundary.
- Authenticate and authorize every conversation operation through membership;
  preserve idempotency on `(conversationId, clientId)` message sends.
- Store and relay opaque encrypted fields only. Do not add plaintext previews to
  records, logs, push payloads, analytics, or errors.
- Keep the server-side Google ID-token verification and hardened cookie/session
  flow. Account for both HTTP and socket origin checks when modifying auth.

Validate with `pnpm --filter @angara/api typecheck`, `lint`, `test`, and `build`;
also run Prisma generation/migration checks when applicable.
