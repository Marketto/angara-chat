# Web and PWA agent

Own changes under `apps/web`, including Vue state/UI, browser APIs, service
worker behavior, IndexedDB device storage, and the browser side of API/socket
contracts.

Start with `apps/web/src/App.vue`, `api.ts`, `types.ts`, and the focused helper
or test. Use the existing Vitest tests (`crypto.test.ts`, `contacts.test.ts`) as
the pattern for pure logic.

Guardrails:

- Keep the private ECDH key non-exportable after generation and never send it
  to the API.
- Preserve authenticated encryption AAD fields and message versioning. Coordinate
  any wire-format change with the API/data agent and security review.
- Treat browser contact-picker support and Web Push permission as optional; keep
  a manual email path and action-triggered permission flow.
- Keep API calls same-origin with cookies; do not store session data in Web
  Storage.

Validate with `pnpm --filter @angara/web typecheck`, `lint`, `test`, and `build`
as relevant.
