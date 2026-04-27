# TASK_2025_294 — Future Test-Coverage Enhancements

TASK_2025_294 delivers a systematic, wave-based test-coverage rollout across the backend, frontend, and
platform layers of the Ptah extension. To keep the scope tractable and to avoid entangling this work with
in-flight refactors, platform shifts, and infra that is not yet stood up, the items below were consciously
deferred. They are recorded here so they do not get lost, and so a future planning pass can promote them
into the active backlog once their trigger conditions are met.

Each item names the initiative, explains why it is not part of TASK_2025_294, summarizes what it would
cover, estimates rough scope, and states the trigger that should make it re-prioritized.

## 1. Playwright webview E2E

**Why deferred.** `@playwright/test` is not yet installed or configured in the monorepo, and the VS Code
webview surface requires a custom harness (postMessage bridge, CSP, resource roots) rather than a stock
browser driver. Standing this up would double the scope of W5 without meaningfully improving unit-level
confidence, and the Angular webview is still undergoing signal-store migration.

**What it would cover.**
- Full-page chat flows (prompt → streaming response → tool call → permission prompt).
- Session switching, history browsing, resume behavior.
- Agent monitor tree rendering with real RPC fixtures.
- Command palette, settings panel, and template picker user journeys.

**Estimated scope.** ~15–25 spec files, 60–120 tests, plus one harness library
(`libs/frontend/webview-e2e-harness`) totaling roughly 800–1,200 lines.

**Trigger condition.** Webview surface stabilizes (no signal-store or RPC protocol churn for 2+ sprints)
**and** a customer-visible regression escapes unit coverage, **or** the extension moves to a paid tier
where UI-level SLAs become contractual.

## 2. `@vscode/test-electron` integration

**Why deferred.** Running the packaged VSIX inside a real VS Code instance requires CI shaping that does
not conflict with the marketplace "suspicious content" scanner rules learned in TASK_2025_245 /
TASK_2025_247 / TASK_2025_248. The integration test VSIX must be distinct from the published artifact, and
the current CI pipeline does not separate these cleanly.

**What it would cover.**
- Activation events firing end-to-end against a real extension host.
- `vscode.commands.executeCommand` coverage for all registered commands.
- Real webview panel lifecycle (create, dispose, reveal, serialize).
- File-system settings round-trip (`~/.ptah/settings.json`) against a real home directory.

**Estimated scope.** ~8–12 spec files, 40–70 tests, plus a CI job and a dedicated test-only VSIX build
target in `apps/ptah-extension-vscode/project.json`.

**Trigger condition.** A command-wiring regression ships to marketplace, **or** the CI pipeline is
refactored to cleanly separate "test VSIX" from "publish VSIX" artifacts.

## 3. `playwright-electron` for desktop app

**Why deferred.** `apps/ptah-electron` runs Electron 35 with an Angular 21 zoneless renderer. The
`playwright-electron` harness has not been validated against this combination, and the Electron shell is
still absorbing packaging changes (langchain runtime files, deep-agent dependency declarations) that
would make test flakes hard to diagnose.

**What it would cover.**
- Main process ↔ renderer IPC contracts.
- File dialog, notification, and tray interactions via real Electron APIs.
- Deep-agent invocation paths that only exist in the Electron build.
- Auto-update flow against a mocked update server.

**Estimated scope.** ~10–15 spec files, 50–80 tests, plus a harness module in `apps/ptah-electron-e2e`.

**Trigger condition.** Electron packaging is stable for two consecutive releases with no
`files`/`asarUnpack` changes, **and** Electron becomes a supported distribution channel with paying
users.

## 4. Stryker mutation testing

**Why deferred.** Mutation testing is CI-expensive (typically 10–50x normal test runtime) and only
produces trustworthy signal once line/branch coverage has plateaued. TASK_2025_294 is actively raising
coverage — adding Stryker now would churn baselines on every wave.

**What it would cover.**
- Money-path code: `apps/ptah-license-server` (auth, Paddle webhook handlers, subscription state).
- Security-sensitive code: signature verification, token exchange, session request validation.
- Critical domain logic: `libs/backend/agent-sdk` orchestration, RPC handler schemas.

**Estimated scope.** Stryker config per target package (~4 configs), a dedicated CI job, and a coverage
threshold tuning pass. Expected to mutate ~15k lines initially.

**Trigger condition.** Coverage on targeted packages is stable above 85% line / 80% branch for 4+
consecutive weeks, **or** a production incident is traced to a test that passed but did not actually
exercise the broken branch.

## 5. Visual regression (Chromatic / Percy)

**Why deferred.** Screenshot diffing is only valuable once the brand/visual system is locked in. Ptah's
webview and Electron shell are both pending design updates as part of the marketplace launch polish, so
baselines captured today would be invalidated within weeks.

**What it would cover.**
- Webview chat surface at common viewport sizes and themes (light/dark/high-contrast).
- Electron splash, settings, and agent-monitor screens.
- Landing page hero sections and marketing-critical components.

**Estimated scope.** ~50–100 baseline screenshots, one Chromatic/Percy project per app (3 total), and CI
integration on PR.

**Trigger condition.** Design system is locked in (brand colors, typography scale, component tokens
finalized), **and** a visual regression has shipped unnoticed.

## 6. Load / perf testing (k6 or artillery)

**Why deferred.** License-server throughput limits depend on the final DigitalOcean droplet sizing, which
is still being tuned alongside the Postgres migration. Load tests written against the current sizing
would produce numbers that do not reflect the steady-state deployment.

**What it would cover.**
- License verify endpoint under sustained high RPS.
- Paddle webhook storm simulation (burst of renewals, cancellations, chargebacks).
- Session-request endpoints under concurrent extension activations.
- Database connection pool saturation and Prisma query latency under load.

**Estimated scope.** ~6–10 k6 scripts, a docker-compose perf-lab harness, and a scheduled CI run against
a staging droplet.

**Trigger condition.** DigitalOcean droplet sizing is finalized and documented, **or** a production
latency incident occurs, **or** paid-tier SLA commitments are introduced.

## 7. `orchestrator.spec` rewrite

**Why deferred.** The original spec was deleted (commented-out and stale) during W0.B5 cleanup. Rewriting
it now would collide with TASK_2025_291, which is actively refactoring the orchestrator service surface.
Any spec written against today's API would likely need to be thrown away.

**What it would cover.**
- End-to-end orchestration of FEATURE / BUGFIX / REFACTORING workflows.
- Agent spawn, steer, stop lifecycle.
- Task-type routing (8 types defined in the orchestration skill).
- User-validation checkpoint gating behavior.

**Estimated scope.** 1 spec file, ~25–40 tests, ~400 lines including fixtures.

**Trigger condition.** TASK_2025_291 lands and the orchestrator public API is declared stable for at
least one release cycle.

## 8. Dashboard coverage

**Why deferred.** `apps/ptah-dashboard` has zero specs today. The dashboard is explicitly post-MVP — it
is not shipped to end users yet, and its surface is expected to change substantially before the first
customer-facing release.

**What it would cover.**
- Dashboard routing and layout shell.
- Session analytics widgets (charts, filters, drill-downs).
- License / subscription status cards.
- Admin-only surfaces (user search, manual license grants).

**Estimated scope.** ~12–20 spec files, 50–100 tests, plus page-object helpers for the Angular routes.

**Trigger condition.** Dashboard is promoted from "internal/preview" to a customer-facing release
surface, **or** the dashboard starts ingesting data that affects billing.

## 9. `tui` / `docs` / `landing` coverage

**Why deferred.** These apps currently have limited testable surface — the TUI is an early prototype,
the docs site is static content, and the landing page is primarily marketing HTML. Writing tests against
any of them today would lock in scaffolding that is likely to be regenerated.

**What it would cover.**
- TUI: keybind dispatch, command parsing, panel layout math.
- Docs: link integrity, code-block executability, search indexing.
- Landing: form submission, analytics events, responsive breakpoints.

**Estimated scope.** Roughly 5–8 specs per app (15–24 total), 30–60 tests.

**Trigger condition.** Any of these apps gets promoted to a supported release channel, **or** starts
carrying logic (non-static content) that can regress silently.

## 10. `vscode-lm-tools` deep coverage

**Why deferred.** W2 of TASK_2025_294 delivers shallow coverage for `libs/backend/vscode-lm-tools` — just
enough to protect the public surface. Deep coverage (MCP server internals, tool-schema round-trips,
streaming edge cases) is a larger effort that warrants its own task, especially because the VS Code LM
Tools API itself is still evolving.

**What it would cover.**
- MCP server request/response correctness for all registered tools.
- Tool schema validation edge cases (optional fields, oneOf branches, max-depth).
- Streaming chunk boundary behavior and backpressure.
- Error propagation from tool handlers back to the LM.
- Concurrency: multiple simultaneous tool calls from the same model turn.

**Estimated scope.** ~8–12 additional spec files, 60–100 tests, plus fixture tooling for MCP protocol
messages.

**Trigger condition.** VS Code LM Tools API reaches stable (non-proposed) status, **or** an LM-driven
tool call surfaces an incident in production, **or** a new CLI agent adapter depends on this library's
internals.

## Re-prioritization criteria

An item on this list should be promoted into the active backlog when **any** of the following become
true:

- **Incident-driven.** A production or marketplace incident is traced to a gap that the deferred item
  would have caught. This is the strongest signal and should trigger immediate promotion.
- **Dependency resolved.** The blocker cited under "Why deferred" goes away (infra stood up, upstream
  refactor lands, design system locks in, sizing finalized). Promote during the next planning cycle.
- **Surface promotion.** An app or library named above is promoted from internal/preview to a
  customer-facing release channel. Coverage must land before or alongside the promotion.
- **Contractual pressure.** A paid tier, SLA, or enterprise commitment introduces reliability
  requirements that shallow/unit-level coverage cannot satisfy.
- **Coverage plateau.** For mutation testing specifically: line and branch coverage on targeted packages
  plateau above agreed thresholds for 4+ weeks, indicating diminishing returns on traditional coverage
  and a readiness for mutation signal.

Items should be taken off this list only when they are either (a) promoted into an active task with an
assigned owner, or (b) explicitly declared obsolete (e.g., the underlying app is deleted). Do not let
items rot silently — revisit this document at the start of each quarter.
