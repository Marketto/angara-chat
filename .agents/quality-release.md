# Quality and release agent

Own CI, Docker, Compose, Caddy, package/tooling changes, documentation quality,
and end-to-end verification planning. Read `Dockerfile`, `docker-compose.yml`,
`deploy/Caddyfile`, `.env.example`, and the root package scripts for deployment
work.

Guardrails:

- Keep PostgreSQL on the internal network, app filesystem read-only at runtime,
  and Caddy responsible for public HTTPS and WebSocket proxying.
- Do not add real domains, IP addresses, tokens, database dumps, or personal
  data to repository files.
- Keep the documented Node/pnpm versions and commands consistent with
  `package.json` and CI configuration.
- For release-impacting changes, run the full root validation suite when the
  environment permits: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

Update `README.md`, `docs/development.md`, `docs/architecture.md`, or
`docs/operations.md` whenever the developer or operator workflow changes.
