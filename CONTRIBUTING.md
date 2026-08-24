# Contributing

Create a branch from `main`, keep changes focused, and include tests for behavior changes. Before opening a pull request run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Never commit `.env`, credentials, IP addresses, production hostnames, database dumps, contact data, logs containing tokens, or screenshots with personal information.
