# E2E tests

Hermetic Playwright tests — every API call is mocked via `fixtures/mock-api.ts`,
so tests do not need the daemon, the Bun API server, or any real data.

## Setup

```bash
bun install
bunx playwright install
```

## Run

```bash
bun run test:e2e            # headless, all browsers
bun run test:e2e:ui         # interactive UI
bun run test:e2e -- --project=chromium   # single browser
bun run test:e2e:report     # open last HTML report
```

The Playwright config starts `vite --port 5173` automatically and reuses an
existing server if one is already running.

## Coverage

| File | Covers |
|------|--------|
| `navigation.spec.ts` | Sidebar nav, URL routing, back/forward, deep links |
| `memories.spec.ts` | List, search, type filter, detail, edit, archive, wiki links |
| `chat.spec.ts` | Send/stream, no-duplicate-message regression, escape-to-stop, history |
| `sources.spec.ts` | Source list, daemon stopped/running, Start daemon button |
| `workflows.spec.ts` | List, empty state, detail navigation |
| `activity.spec.ts` | Feed render, unread badge |
| `identity.spec.ts` | Load and render identity |
| `settings.spec.ts` | Render and routing |
| `setup.spec.ts` | First-run redirect, sidebar hidden on setup |
| `home.spec.ts` | Render and navigation to memories |

## Adding tests

Always mock through `installApiMocks(page, state)`. If a new API endpoint is
introduced, add a route to `fixtures/mock-api.ts` rather than calling
`page.route()` ad-hoc per spec.
