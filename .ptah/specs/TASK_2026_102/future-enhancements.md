# TASK_2026_102 — Future Test-Coverage & Quality Enhancements

This document records the prioritized backlog left after TASK_2026_101 (P1 bugfixes + Playwright-Electron E2E). Each item names the initiative, explains current state, summarizes scope, estimates effort relative to TASK_2026_101 batches, and states the trigger that should make it re-prioritized.

---

## Tier 1 — Direct follow-ups from TASK_2026_101

### 1.1 Unblock the 14 skipped Electron E2E tests

**Why deferred.** Each skip in TASK_2026_101 has a root cause documented in `.ptah/specs/TASK_2026_101/handoff-final.md`. Resolving them requires harness-level work, not spec rewrites.

**Sub-batches:**

#### 1.1.A — PTY Manager (7 tests)
- **Blocker.** `node-pty` native binary isn't ABI-matched to the Electron version because `nx build-dev` skips `electron-rebuild`. Spawning a PTY in-test crashes with a NAPI mismatch.
- **Approach.** Add an E2E target variant `e2e:packaged` that depends on `nx run ptah-electron:package` and launches the produced installer's `dist/installers/.../resources/app.asar`. Existing `e2e` target stays for fast iteration on non-PTY specs.
- **Estimated scope.** ~80 lines of project.json wiring + a packaged-app launcher helper (`apps/ptah-electron-e2e/src/support/electron-launcher-packaged.ts`) + flipping `test.skip(!PTY_AVAILABLE, ...)` to an env-aware predicate.
- **Trigger.** PTY tests have escaped a real regression OR a paying customer reports terminal misbehavior.

#### 1.1.B — Git Watcher (5 tests)
- **Blocker.** `electronApp.evaluate()` closures execute inside the ESM main bundle without access to `require()` (CJS shim not injected) or dynamic `import()` resolution (Playwright wraps in `eval` without `importModuleDynamically`). Tests can't reach `chokidar`/`fs` mocks at runtime.
- **Approach.** Add a small `__test__` IPC channel to `apps/ptah-electron/src/ipc-bridge.ts` that exposes watcher state queries (`__test__:git-watcher:events`, `__test__:git-watcher:reset`) — gated behind `PTAH_E2E === '1'` env so it never ships in production. Tests then use `sendRpc('__test__:git-watcher:events', ...)` instead of `electronApp.evaluate`.
- **Estimated scope.** ~30 lines main-process + ~30 lines fixture helper + spec rewrite (5 tests).
- **Trigger.** Git-watcher logic changes (e.g., debounce window tuning, ignored-paths config) AND we want regression coverage.

#### 1.1.C — License Watcher (2 tests)
- **Blocker.** Phase 7 is an `EventEmitter` on `LicenseService` backed by SecretStorage, not a JSON-file watcher. The original brief assumed `~/.ptah/license.json` mutation; that file doesn't exist.
- **Approach.** Stand up a minimal in-process Express stub (~50 lines) that mocks the license-server endpoints (`/license/verify`, `/license/refresh`). Add `PTAH_LICENSE_SERVER_URL` override to `LicenseClient`. Tests redirect to `http://127.0.0.1:<port>` and exercise `license:setKey` RPC.
- **Estimated scope.** ~120 lines (mock server + harness fixture + 4 reactivated tests).
- **Trigger.** License flow changes OR a billing incident traces back to silent license-validation failures.

**Total Tier 1.1 estimate.** ~10 spec adjustments + 200–300 lines of harness infra. Single wave (~1 task).

### 1.2 Fix flaky `agent-generation:test`

**Why deferred.** Pre-existing flake; passes on retry. Did not gate any TASK_2026_101 commit but slows down `nx run-many -t test --all` runs.

**What to investigate.** The handoff for TASK_2025_294 P2 noted this suite has 287 tests against the orchestrator service. Likely candidates: timer-based code without `useFakeTimers`, race conditions in the orchestrator's `cancel()` path, or shared mutable state across tests in the same suite.

**Estimated scope.** ~half-day investigation + targeted fix; could be larger if root cause is structural.

**Trigger.** CI flakiness rate > 5% on this suite (currently below threshold but watch the trend).

---

## Tier 2 — Promoted from `TASK_2025_294/future-enhancements.md`

### 2.1 `@vscode/test-electron` integration tests (item #2)

**Why deferred.** Marketplace "suspicious content" scanner rules (TASK_2025_245/247/248) require a separate test-only VSIX distinct from the published artifact. CI pipeline doesn't separate these cleanly today.

**What it would cover.**
- Activation events firing end-to-end against a real extension host.
- `vscode.commands.executeCommand` coverage for all registered commands.
- Real webview panel lifecycle (create, dispose, reveal, serialize).
- File-system settings round-trip (`~/.ptah/settings.json`) against a real home directory.

**Estimated scope.** ~8–12 spec files, 40–70 tests, plus a CI job and a dedicated test-only VSIX build target in `apps/ptah-extension-vscode/project.json`.

**Trigger.** A command-wiring regression ships to marketplace, OR the CI pipeline is refactored to cleanly separate "test VSIX" from "publish VSIX" artifacts.

### 2.2 Stryker mutation testing (item #4)

**Why deferred.** Mutation testing is CI-expensive (10–50× normal test runtime) and only produces trustworthy signal once line/branch coverage has plateaued. TASK_2025_294 raised coverage; TASK_2026_100/101 added more — we're approaching plateau but not there yet on every package.

**What it would cover.**
- Money-path code: `apps/ptah-license-server` (auth, Paddle webhook handlers, subscription state).
- Security-sensitive code: signature verification, token exchange, session request validation.
- Critical domain logic: `libs/backend/agent-sdk` orchestration, RPC handler schemas.

**Estimated scope.** Stryker config per target package (~4 configs), a dedicated CI job, and a coverage threshold tuning pass. Expected to mutate ~15k lines initially.

**Trigger.** Coverage on targeted packages stable above 85% line / 80% branch for 4+ consecutive weeks, OR a production incident traces to a test that passed but did not actually exercise the broken branch.

### 2.3 Visual regression — Chromatic / Percy (item #5)

**Why deferred.** Brand/visual system pending design updates as part of the marketplace launch polish. Baselines captured today would be invalidated within weeks.

**What it would cover.**
- Webview chat surface at common viewport sizes and themes (light/dark/high-contrast).
- Electron splash, settings, and agent-monitor screens.
- Landing page hero sections and marketing-critical components.

**Estimated scope.** ~50–100 baseline screenshots, one Chromatic/Percy project per app (3 total), and CI integration on PR.

**Trigger.** Design system locked in (brand colors, typography scale, component tokens finalized), AND a visual regression has shipped unnoticed.

### 2.4 Load / perf testing — k6 or artillery (item #6)

**Why deferred.** License-server throughput limits depend on the final DigitalOcean droplet sizing. Self-hosted Postgres migration completed (per project memory), but droplet sizing still being tuned. Numbers from current sizing wouldn't reflect steady-state.

**What it would cover.**
- License verify endpoint under sustained high RPS.
- Paddle webhook storm simulation (burst of renewals, cancellations, chargebacks).
- Session-request endpoints under concurrent extension activations.
- Database connection pool saturation and Prisma query latency under load.

**Estimated scope.** ~6–10 k6 scripts, a docker-compose perf-lab harness, and a scheduled CI run against a staging droplet.

**Trigger.** DigitalOcean droplet sizing finalized and documented, OR a production latency incident, OR paid-tier SLA commitments introduced.

### 2.5 Dashboard coverage (item #8)

**Why deferred.** `apps/ptah-dashboard` has zero specs today. Dashboard is post-MVP; surface expected to change substantially before customer-facing release.

**What it would cover.**
- Dashboard routing and layout shell.
- Session analytics widgets (charts, filters, drill-downs).
- License / subscription status cards.
- Admin-only surfaces (user search, manual license grants).

**Estimated scope.** ~12–20 spec files, 50–100 tests, plus page-object helpers for the Angular routes.

**Trigger.** Dashboard promoted from "internal/preview" to a customer-facing release surface, OR dashboard starts ingesting data that affects billing.

### 2.6 TUI / docs / landing coverage (item #9)

**Why deferred.** TUI is early prototype; docs site is largely static; landing is marketing HTML. Tests written today would lock in scaffolding likely to be regenerated.

**What it would cover.**
- TUI: keybind dispatch, command parsing, panel layout math.
- Docs: link integrity, code-block executability, search indexing.
- Landing: form submission, analytics events, responsive breakpoints.

**Estimated scope.** ~5–8 specs per app (15–24 total), 30–60 tests.

**Trigger.** Any of these apps gets promoted to a supported release channel, OR starts carrying logic (non-static content) that can regress silently.

---

## Tier 3 — Quality follow-ups from TASK_2026_101 P1 review

These are surfaced behaviors flagged during P1 spec coverage that didn't get fixed because they're either documented design decisions or false positives. Worth a UX review pass when convenient.

### 3.1 `permission-prompt.service.ts:315` — broad `ToolName:*` from "Always Allow"
Approving `npm test` also approves `rm -rf <anything>`. Documented design (broad approval is the intended UX), but worth a UX review: should "Always Allow" capture the specific tool input pattern instead?

### 3.2 `permission-prompt.service.ts:91` — minimatch slash semantics
`*` doesn't cross `/` in default minimatch options. Specs document this as intentional. Worth confirming the contract is documented in user-facing docs as well.

### 3.3 `code-execution.engine.ts` — AsyncFunction detection under ts-jest
Already handled at runtime by IIFE wrapping (lines 179/189/206). Spec documents the ts-jest transpile limitation. Engine robustness could be improved by detecting `AsyncFunction` via `(async () => {}).constructor.name === 'AsyncFunction'` instead of prototype chain — would unlock top-level `await` in test environments. Low priority.

---

## Re-prioritization criteria

An item should be promoted into the active backlog when **any** of the following become true:

- **Incident-driven.** A production or marketplace incident traces to a gap that the deferred item would have caught. Strongest signal — promote immediately.
- **Dependency resolved.** The blocker cited under "Why deferred" goes away (infra stood up, upstream refactor lands, design system locks in, sizing finalized). Promote during the next planning cycle.
- **Surface promotion.** An app or library named above is promoted from internal/preview to a customer-facing release channel. Coverage must land before or alongside the promotion.
- **Contractual pressure.** A paid tier, SLA, or enterprise commitment introduces reliability requirements that shallow/unit-level coverage cannot satisfy.
- **Coverage plateau.** For mutation testing specifically: line and branch coverage on targeted packages plateau above agreed thresholds for 4+ weeks, indicating diminishing returns on traditional coverage and readiness for mutation signal.

Items should leave this list only when (a) promoted into an active task with an assigned owner, or (b) explicitly declared obsolete (e.g., underlying app deleted).

Revisit this document at the start of each quarter.
