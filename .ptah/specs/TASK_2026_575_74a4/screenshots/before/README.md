# TASK_2026_575 — Session Analytics baseline ("before") captures

Captured from the real Angular webview bundle built at commit
`722d921abd1a39bbb5cda3da7cda25c5c93a7b5f` (the base commit, before any pricing fix), in an
isolated agent worktree verified to be at that commit.

## Commands

```
# node_modules junction to the main checkout (also at 722d921ab), removed afterwards.
NX_DAEMON=false npx nx build ptah-extension-webview --skip-nx-cache   # exit 0
#   -> dist/apps/ptah-extension-webview/browser/ (only warning: initial bundle budget 3.45 MB > 2.50 MB)
cd libs/frontend/webview-e2e-harness
npx playwright test src/lib/scenarios/_tmp-baseline-575/baseline.e2e.spec.ts --config=playwright.config.ts --workers=2 --reporter=list
#   -> 2 passed
```

The temporary spec was deleted after the run; `git status --short` in that worktree was empty.

## Harness wiring

- `test.use({ useAppBuild: true })`, then `installCspStub`, `installPostMessageBridge`,
  `installRpcAutoResponder` (from `marketplace.fixtures.ts`).
- Host config `{ ...vscodeHostConfig('analytics'), workspaceRoot: 'C:\\ptah-e2e-ws-a', workspaceName: 'ptah-e2e-ws-a' }`
  set in ONE init script instead of `installHost` (without `workspaceRoot` the card shows
  "No workspace detected"; Playwright does not order separate init scripts).
- Dark: no `ptah-theme` (`data-theme="anubis"`). Light: `localStorage.setItem('ptah-theme', 'anubis-light')`
  in an init script before `goto` (`data-theme="anubis-light"`).
- Viewport 1280x1400. Wait for the section, 3 `ptah-session-stats-card` elements, and no
  `[aria-busy="true"]` / `.loading-spinner`. Element screenshot of `[aria-label="Session analytics"]`
  (animations disabled), then resize to 480 and capture again. Default range "1 week".

## Fixture data

`session:list` returns 3 sessions, `hasMore: false`, each `isActive: false`,
`lastActivityAt = now - N min`, `createdAt = lastActivityAt - 60 min`.

| id | name | messageCount | last activity |
|---|---|---|---|
| sess-full | Auth refactor | 42 | now − 30 min |
| sess-partial | Mixed-agent debugging | 27 | now − 120 min |
| sess-1m | Long context session | 9 | now − 300 min |

`session:stats-batch` is a per-call resolver echoing the request's `scope`/`since`/`until`.
Every entry: `status:'ok'`, `coverage:'complete'`, `scope:'range'`.

| id | model | totalCost | knownCost | pricingCoverage | tokens in/out/cR/cC | modelUsageList |
|---|---|---|---|---|---|---|
| sess-full | claude-opus-5-5 | 4.82 | 4.82 | full | 120000/8000/50000/2000 | opus 120000/8000 $4.82 |
| sess-partial | claude-opus-5-5 | null | 1.15 | partial | 100000/8000/0/0 | opus 40000/3000 $1.15; opencode-go/glm-5.3 60000/5000 null |
| sess-1m | claude-opus-5-5[1m] | null | null | none | 300000/4000/0/0 | claude-opus-5-5[1m] 300000/4000 null |

## Files

| File | Theme | Width |
|---|---|---|
| analytics-dark.png | anubis | 1280 |
| analytics-light.png | anubis-light | 1280 |
| analytics-dark-480.png | anubis | 480 |
| analytics-light-480.png | anubis-light | 480 |

## Observed values (same in both themes and widths)

Header "Session Analytics", badge "Estimated from recorded usage and current rate card";
range 1 day / 2 days / 3 days / **1 week** / 2 weeks; "3 sessions".

Tiles: EST. TOTAL COST `$4.82`; TOTAL TOKENS `592.0K`; MESSAGES `78`; SESSIONS `3`; SUBAGENTS `0`; AVG / SESSION `$4.82`.

Notes (verbatim):
- analytics-unknown-cost: "Cost unknown for 2 sessions (no current rate-card price); the total leaves them out."
- analytics-partial-pricing: "Some usage in 1 session has no rate-card price; the total is a lower bound."
- analytics-partial, analytics-progress, analytics-cap, analytics-errors: not rendered.

| Card | Badges | EST. COST | MESSAGES | $/MSG | Tokens | Per-model usage |
|---|---|---|---|---|---|---|
| Auth refactor (30m ago) | Opus 5.5 | $4.82 | 42 | $0.11 | 180.0K (In 120.0K, Out 8.0K, Cache Read 50.0K, Cache Write 2.0K) | not shown |
| Mixed-agent debugging (2h ago) | Opus 5.5, Partial | Unknown | 27 | $-- | 108.0K (In 100.0K, Out 8.0K) | Opus 5.5 40.0K / 3.0K $1.15; opencode-go/glm-5.3 60.0K / 5.0K Unknown |
| Long context session (5h ago) | Opus 5.5 (1m) | Unknown | 9 | $-- | 304.0K (In 300.0K, Out 4.0K) | not shown |

## Diff notes (defects visible in the baseline)

- The partial session's known $1.15 subtotal appears only in its per-model row; it is not the
  card's EST. COST and is not added to the total (defect 3).
- The `[1m]` session reads Unknown / $-- and counts in "Cost unknown for 2 sessions" (defect 4).
- Fixtures reproduce backend output (`costUSD: null` for `[1m]`); the backend rate card is not exercised here.
- For the "after" capture, re-use this fixture but set sess-1m to the priced value the fixed backend
  produces (the `[1m]` id now resolves to base Opus 5.5 rates).
