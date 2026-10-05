# Visual harness report — TASK_2026_596_0a19 (Phase 6 visual review)

Verdict: the harness scenario is built and green (12/12 tests, 48 screenshots). Every requested state rendered through the real webview bundle. No product code was touched.

## Build state captured

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets`
- HEAD `46ba54af744a3471b2b5d31e03ad3e265166d63a` (batch 20), **plus the parallel agent's uncommitted edits** that were on disk at build time (2026-10-04 23:26 UTC):
  - `libs/frontend/core/src/index.ts`
  - `libs/frontend/core/src/lib/services/plan-limits.store.ts` (+ spec)
  - `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (+ spec)
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` became dirty during or after the build. Whether the bundle has that edit is not known.
- Build: `npx nx build ptah-extension-webview --skip-nx-cache` → exit 0. Output is in `dist/apps/ptah-extension-webview`.
- The bundle was built once and not rebuilt. To capture the final store fix, rebuild and re-run (see "Re-run" below).

## Files created (only `scenarios/plan-limits/`)

- `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits.fixtures.ts`
  - Data typed with `import type` from `@ptah-extension/shared`: the snapshots, the transcript, the restored runs and the live-run pushes. Value imports of shared are not used, because they break the Playwright transform (`capability-toggles.e2e.spec.ts:28-37`).
  - Host and RPC plumbing comes from `../marketplace/marketplace.fixtures` (`installHost`, `installRpcAutoResponder`, `baseMarketplaceFixtures`). It is imported, not copied.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts`
  - Loops over themes × widths, as in `thoth-feed-visual.e2e.spec.ts`.
  - Fixed clock: `page.clock.setFixedTime(Date.UTC(2026, 9, 5, 12, 0))`.
  - Fixed zone and locale: `timezoneId: 'UTC'`, `locale: 'en-GB'`.

## How the scenario drives the real bundle

1. **Session open without a click.** `ptahConfig.initialSessionId` + `panelId` make `TabManagerService` queue `switchSession` on boot (`tab-manager.service.ts:619-632`). `installWorkspaceHost` adds this on top of `installHost`, together with `workspaceRoot`. `switchSession` throws without `workspaceRoot` (`session-loader.service.ts:792-797`), and the dashboard shows "No workspace detected" without it.
2. **`session:load` + `chat:resume` answers.** The resume returns two history messages, the session stats, and two restored lane runs in `cliSessions`. Restored runs always carry `usageTotals: null` (`agent-monitor.store.ts:1204`).
3. **No second restore.** `session:cli-sessions` answers empty. A second, non-empty restore would drop the live runs that have exited (`loadCliSessions` filter, `agent-monitor.store.ts:1158-1163`).
4. **Live lane runs are pushed with `bridge.inject` after the session settles.** The pushes are `agent-monitor:spawned`, then `agent-monitor:output` (segments with `usage`), then `agent-monitor:exited`. This is the only path that folds usage totals (`agent-monitor.store.ts:880-888`). It is the injection pattern of `monitor/agent-status.e2e.spec.ts`, using the real message types.
5. **Agent panel closed.** The agent monitor panel auto-opens on restored and live runs and overlays the whole canvas tile at these widths, so the spec clicks its `Close panel` button, as a user would.
6. **Layout.** The default layout is `grid` (`app-state.service.ts:400`), so the captures are of the canvas tile (`[data-testid="canvas-tile"]`), which is what a user sees. The main panel's chat view stays mounted but hidden.
7. **First-run hint.** The Thoth first-run popover is dismissed through `localStorage['ptah-thoth-first-run-dismissed'] = 'true'`.
8. **Push path.**
   - `provider:getPlanLimits` answers `RPC_SNAPSHOT` (generatedAt NOW-2m, session scope `sonnet`). The alert is **Near · 5-hour 94%**.
   - One `planLimits:changed` is then injected: `PUSHED_SNAPSHOT` (NOW-1m). The session moves to `opus` and the Opus weekly window is at its limit, so the alert turns to **At limit · Weekly · Opus**.
   - The spec asserts the change through `data-state`.
9. **Tall elements.** Elements taller than the viewport sit in inner scroll containers, so `fitViewportHeight` grows only the viewport height before the capture. The width under review never changes.

## Fixture coverage (requested state → where it shows)

| Requested state | Fixture | Visible in |
|---|---|---|
| 5-hour near limit (94%) | `FIVE_HOUR_NEAR` on Claude account A | collapsed-near alert, plan tile, dashboard |
| Weekly OK | `WEEKLY_OK` (40%) | plan tile, dashboard |
| Model-scoped weekly at limit with reset | `WEEKLY_OPUS_AT_LIMIT` (error-derived exhaustion, resets Wed 7 Oct 12:00 UTC) | collapsed-at-limit alert, plan tile (opened), dashboard |
| Window with unknown used | `MONTHLY_USED_UNKNOWN` | "Usage unknown" plan tile, dashboard |
| Reset passed, usage unknown | `RESET_PASSED_USAGE_UNKNOWN` ("Burst", reset NOW-40m after observation NOW-68m) | "Reset · usage unknown" plan tile, dashboard |
| Cooldown | `cooldown.until` NOW+14m on account A | Cooldown plan tile, dashboard cooldown notice |
| Estimated-limit note | Codex owner `ownerEvidence` with `source: 'estimated'` | Codex lane tile (opened), dashboard Codex section |
| Unknown-owner lane | live OpenCode run, owner `unknown#unknown:ppp`, failed `quota`; restored Copilot run with no owner | OPENCODE and COPILOT lane tiles |
| Different-owner lane | live Codex review run (`openai-codex` owner); restored run on Claude account B | CODEX · REVIEW (asserted `data-owner-status="different"`), PTAH-CLI lane tile |
| Lanes with usage totals | Claude docs (15.5k tokens, $0.21, running), Codex review (10.1k, $0.07), OpenCode (2.7k, cost unknown) | lane tiles + subtotal "28.3k tokens known · $0.28 known cost · 5 lanes · 5 runs · 3 cost unknown" |
| Lane with null totals | the two restored runs | "unknown tokens · cost unknown" lane tiles |
| Dashboard owners | A (available), B (`service-unavailable`, last evidence), Codex (Activity block, plan plus), Unknown owner (`no-usage-source`) | dashboard card |

Data reuse:
- `stats-limit-view-model.spec.ts`: owners, NOW, the window shapes, cooldown, reset-passed, estimated evidence.
- `provider-account-card.component.spec.ts`: the Codex Activity (`9007199254740993`), the estimated note, the usage-unknown window, the no-usage-source owner.

## Screenshots (48)

Folder: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\`

Names follow `<surface>-<state>-<theme>-<width>.png`. Every surface and state below exists for `anubis` and `anubis-light` at `280`, `360` and `440`:

- (a) Collapsed strip:
  - `stats-strip-collapsed-near-*` (RPC snapshot, warning alert)
  - `stats-strip-collapsed-at-limit-*` (after the push, error alert)
  - `chat-tile-collapsed-at-limit-*` (the whole canvas tile, for context)
- (b) Expanded grid: `stats-strip-expanded-*` (7 plan tiles, 5 lane tiles, subtotal)
- (c) Tiles opened:
  - `stats-strip-tiles-open-*` (the Opus plan tile and the Codex lane tile open together)
  - `plan-tile-open-at-limit-*` (close-up)
  - `lane-tile-open-different-owner-*` (close-up)
- (d) Dashboard: `dashboard-card-owners-*` (the `ptah-provider-account-card` element, VS Code host, `analytics` view)

Example absolute path:
`D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\stats-strip-tiles-open-anubis-light-280.png`

## Re-run

From `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets`:

```bash
npx nx build ptah-extension-webview          # rebuild after the store fix lands
cd libs/frontend/webview-e2e-harness
SHOT_DIR="D:/projects/ptah-extension/.claude-worktrees/task-596-quota-resets/.ptah/specs/TASK_2026_596_0a19/screenshots" \
  npx playwright test --config=playwright.config.ts plan-limits-visual --workers=2
```

Without `SHOT_DIR`, the shots go to the task folder's `screenshots/` (resolved from the spec file).

## Verification

- `npx playwright test --config=playwright.config.ts plan-limits-visual --workers=2` → **12 passed (20.6s)**.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness --parallel=1` → **typecheck ✓, lint ✓**. Nx Cloud printed a 401 plan notice; it did not affect the run.
- The project's `typecheck` target covers only `tsconfig.lib.json`, which excludes `*.spec.ts`. I also ran `tsc -p tsconfig.spec.json`:
  - Its only diagnostic on the new spec is TS1343 (`import.meta`).
  - That is the same pre-existing tsconfig module-setting error the file reports for 4 other harness files, including `marketplace-visual.e2e.spec.ts`, which uses the same `import.meta.url` pattern.
  - There are no type errors in the fixture data.

## States not rendered, and why

- **"Before" shots:** skipped. This is a new surface with an approved prototype, and a base-commit capture needs a second worktree and build, so it is not cheap.
- **Main-panel (single layout) strip:** not captured. The default layout is `grid`, so users see the canvas tile. Single layout is reachable only through the layout toggle and was not requested.

## For the visual reviewer (observations, not changed)

- **Restored lane label.**
  - Restored runs have no `displayName`, so the restored Claude-account-B lane is labelled with the raw CLI id **"PTAH-CLI"** (`toStatsLimitLaneRun` falls back to `agent.cli`, `chat-view.component.ts:101`).
  - Its collapsed face reads "Limit unknown", even though the owner is a known different account with last-known weekly evidence.
- **Ownership pill for the Codex lane.** Lane runs always carry `modelScope: null` in the chat view (`chat-view.component.ts:104`), so the Codex lane's collapsed face reads "Limit unknown" and its open panel shows only non-model windows.
- **Narrow width.** At 280 px, the two-column grid wraps most captions and chips onto 3-4 lines (for example "Claude account plan limit", "used · reset Provider API").
- **Light-theme contrast (carried from the Batch 21 note).** Check `text-base-content-muted` on base-200 in `dashboard-card-owners-anubis-light-*` (design measured 4.46:1).
