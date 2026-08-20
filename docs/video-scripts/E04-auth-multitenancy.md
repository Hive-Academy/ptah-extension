# E04 — Auth + Multi-Tenancy — Full Script

**Length:** 10–12 min · **Trial day:** Day 6 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Ship authentication plus tenant isolation on the domain from E03, with two agents working in parallel and a security review gate before merge.
**Controlling thesis:** Tenant isolation belongs at the data layer, not the service layer — ZenStack policies enforce it regardless of what the service code does.

## Pre-record checklist

- Green workspace from E03 (domain layer compiled + unit tests passing).
- Postgres running via `docker:db:start`; Prisma/ZenStack dependencies installed.
- Two test tenant seeds prepared with overlapping task names (to make the isolation test visual).
- Pre-test ZenStack policy generation so it doesn't stall on camera.
- Intentionally leave ONE planted gap in the tenancy policy (missing `WHERE tenant_id = :tenant` on a list query) — label it clearly as an intentional demo bug for the security reviewer to catch.
- Orchestrator model (Kimi via Ollama Cloud) responding in a dry run.
- No real JWT secrets or DB credentials on screen; editor blurs any `.env` values.

## Assets / overlays

- Two-track split capture (Auth tile left, Tenancy tile right).
- Tenant-isolation diagram (Tenant → ZenStack policy → data rows).
- `/review-security` findings card overlay.
- "Fails closed — 403" green-check overlay.
- Trial-day counter "Day 6 / 100".
- Planted-bug callout: "intentional demo gap — watch the reviewer catch it."

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat open. Open-weight model badge visible in the corner. Domain libs from E03 visible in the file tree.
- **ON-SCREEN (lower-third):** "Day 6 / 100"
- **VO:** "Multi-tenant data isolation is one of those things you either get right at the data layer or you keep patching at the service layer indefinitely. Today we build it right: ZenStack policies, NestJS guards, tenant context at the request boundary — two agents in parallel, then a security review before anything merges."

### [00:20–01:10] Context handoff from E03

- **VISUAL:** Scroll the Ptah Desktop chat to show the E03 session summary — domain bounded contexts and entities visible. Switch to the current session.
- **VO:** "We left Episode Three with four bounded contexts modeled and compiling. Identity and Tenancy were already sketched at the domain level — entities, value objects, the TenantId aggregate root. Today we implement it. Prisma schema wired to ZenStack policies, NestJS guards on every route, and tenant context injected at the request boundary. Two separate tracks: auth on the left, tenancy on the right."
- **ON-SCREEN (lower-third):** "Continuing from E03 green domain layer"

### [01:10–02:30] Orchestrate the feature split

- **VISUAL:** Type `/orchestrate` into the Ptah chat. Kimi produces the task breakdown — two parallel tracks clearly labeled.
- **VO:** "First move: hand the orchestrator a clear scope and let it plan the split. I'm using `/orchestrate` — it reads our roadmap, reads what's in memory from the earlier domain decisions, and produces a concrete execution plan."
- **VISUAL:** Kimi's response outlines Track A (auth: login, session, JWT guards) and Track B (tenancy: middleware, ZenStack row-level policies, tenant resolver). Orchestrator references `nestjs-backend-patterns`.
- **VO:** "It pulls `nestjs-backend-patterns` — the skill that encodes NestJS authentication, authorization, multitenancy, and Prisma/ZenStack patterns. Track A builds the login and session flow. Track B enforces isolation at the data layer."
- **ON-SCREEN:** Overlay: "Track A: Authentication · Track B: Tenancy"

### [02:30–04:00] Parallel agents — auth track

- **VISUAL:** A second Ptah canvas tile opens for the auth track. Agent starts building. Code streams in.
- **VO:** "The auth track takes the `authentication` and `authorization` refs from `nestjs-backend-patterns`. It builds the login endpoint, the JWT strategy, the session guard, and the role-based access decorators. The approval prompt fires when it writes the Prisma migration — Ptah asking before it mutates the schema."
- **VISUAL:** Approval prompt appears for the migration write. Presenter accepts. Migration runs.
- **VO:** "I accept. Filesystem reads happen automatically; schema mutations require explicit sign-off. The orchestrator cannot write to your database without your confirmation."
- **ON-SCREEN (lower-third):** "Approval gate — schema migration"

### [04:00–05:30] Parallel agents — tenancy track

- **VISUAL:** Return to the tenancy tile (or second background workspace tile). A CLI agent (`ptah-cli` via `ptah_agent_spawn`) is delegated the auth e2e test suite while the orchestrator focuses on the tenancy layer.
- **VO:** "Meanwhile, the tenancy track. We're not just adding a `tenantId` column — we're enforcing isolation at the data layer with ZenStack policies. The idea is that even if a service method forgets to filter by tenant, the policy catches it."
- **VISUAL:** ZenStack policy file being written — `@@allow('read', tenant == auth().tenant)` pattern visible. Redact any auth() details that look like real secrets.
- **VO:** "Every model that belongs to a tenant gets a ZenStack `@@allow` rule. The policy compiles down to a row-level filter that ZenStack injects into every Prisma query. The service layer doesn't have to remember. The data layer enforces it."
- **ON-SCREEN:** Tenant-isolation diagram animates in — Tenant → ZenStack policy → Prisma query → data rows.
- **VISUAL:** Also visible: `ptah_agent_spawn` delegating the auth e2e test scaffold to `ptah-cli`; Spawn → Poll → Read cycle shown briefly.
- **VO:** "While tenancy is being built out, I've delegated the auth end-to-end test suite to a CLI agent — spawn, poll, read. It comes back with tests while the orchestrator stays on the harder problem."
- **ON-SCREEN (lower-third):** "CLI delegate: ptah-cli · auth e2e tests"

### [05:30–06:30] Merge the tracks — tenant context middleware

- **VISUAL:** Both tiles green. Orchestrator merges the outputs. Tenant context middleware code shown: extracts tenant from JWT claim, binds to `AsyncLocalStorage`.
- **VO:** "Both tracks are green. The orchestrator merges them. The seam is the tenant context middleware — it reads the tenant claim out of the validated JWT, stashes it in `AsyncLocalStorage`, and every downstream service and ZenStack policy can read it without prop-drilling. That's the `multitenancy` ref from `nestjs-backend-patterns`."
- **ON-SCREEN:** Code callout: `TenantContext.run(tenantId, ...)` in the middleware.

### [06:30–08:00] Security review — the planted gap

- **VISUAL:** Run `/review-security` on the diff. Kimi runs the review. Findings stream in.
- **VO:** "Before any of this merges, it goes through a security review. `/review-security` scans the whole diff — guards, policies, middleware — against OWASP criteria and the multi-tenant threat model."
- **VISUAL:** Review output surfaces a finding: a list endpoint is missing ZenStack policy coverage — it falls back to an unscoped Prisma query. A callout overlay appears: "Intentional demo gap — watch the reviewer catch it."
- **VO:** "There it is. I planted a gap deliberately — one list endpoint that bypasses the ZenStack client and goes straight to raw Prisma. The overlay marks it as an intentional demo bug. The reviewer caught it because it matches a known multi-tenant escape: service code forgetting to use the tenant-scoped client."
- **ON-SCREEN:** Findings card overlay — severity HIGH, description "Unscoped Prisma query on task list — tenant isolation bypass."
- **VO:** "High severity, isolation bypass. Let's fix it."
- **VISUAL:** Fix applied — endpoint switched to ZenStack-scoped client. Re-run `/review-security` on the delta. Reviewer confirms resolved.
- **VO:** "One line change. The ZenStack client replaces the raw Prisma call. Reviewer passes it. Build in parallel, review before merge."

### [08:00–09:30] Prove it — cross-tenant isolation test

- **VISUAL:** Terminal pane (xterm in the editor) — show two pre-seeded tenants (Tenant Alpha, Tenant Beta) with overlapping task names. Run the cross-tenant test.
- **VO:** "Now let's verify it holds. Two pre-seeded tenants, same task names, completely separate data. The test logs in as Tenant Beta and tries to read Tenant Alpha's tasks. If isolation is working, it gets back an empty list — or a 403."
- **VISUAL:** Test runs. The cross-tenant request returns a 403 or empty set. Test passes green.
- **ON-SCREEN:** "Fails closed — 403" green-check overlay pops.
- **VO:** "Fails closed. Tenant Beta sees nothing from Tenant Alpha. The policy blocked it at the data layer — not the route guard, not the service — the data layer. That's the invariant we came here to enforce."

### [09:30–10:30] Close green — full build/test pass

- **VISUAL:** Run `nx run-many -t lint test build` in the xterm terminal. All targets pass. Green terminal output fills the screen.
- **VO:** "Full green. Lint, tests, build — all targets pass. The domain layer from E03 is still clean underneath. Day six, and we have a running, tested, security-reviewed authentication and multi-tenant system."
- **ON-SCREEN (lower-third):** "Day 6 / 100 · Build: green"

### [10:30–11:20] CTA / End screen

- **VISUAL:** Ptah chat showing the session; both tiles visible and green. End card animates in.
- **VO:** "Auth and tenant isolation, built in parallel and security-reviewed — cross-tenant access fails closed at the data layer. Next episode: the Tasks engine, with real-time SSE updates, retry logic, and the Rewind feature. I'll see you in Episode Five."
- **ON-SCREEN:** End card — "Next: The Tasks Engine" · "Day 8 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop with open-weight badge and E03 domain tree visible.
2. E03 context handoff — chat summary scroll, domain entities called out.
3. `/orchestrate` planning turn — two-track split output from Kimi.
4. Auth tile: JWT strategy, guard, approval prompt on migration write.
5. Tenancy tile: ZenStack policy file, `@@allow` pattern, tenant-isolation diagram.
6. CLI delegate: `ptah_agent_spawn` → `ptah-cli` for auth e2e tests (Spawn → Poll → Read).
7. Merge: tenant context middleware code, `TenantContext.run` callout.
8. `/review-security` findings stream — planted gap surfaced, findings card overlay.
9. One-line fix applied; re-review passes.
10. Cross-tenant isolation test in xterm: 403/empty-set result, "fails closed" overlay.
11. `nx run-many` green build.
12. End card.

## [VERIFY] flags

- Exact Ptah Desktop path for opening a second canvas tile for the parallel auth/tenancy agents. [Confirm whether this uses Canvas multi-tile, two background workspaces, or a single chat with subagent delegation.]
- Confirm `/review-security` is invoked as a slash command from the main chat or as a skill invocation — and whether it operates on a diff, a file selection, or the whole repo.
- Confirm the exact `ptah_agent_spawn` surface in Ptah Desktop (is it typed inline in chat or triggered via a UI control?) and which delegate agents (`codex`/`copilot`/`ptah-cli`) are available for the auth e2e test scaffold task.
- ZenStack `@@allow` syntax — verify against the ZenStack version being used in TaskFlow's stack so on-screen code is accurate.
- Confirm the approval-gate trigger: does Ptah Desktop prompt on every `prisma migrate` call, or only on certain tool categories? Adjust VO if the trigger is different.
- Planted-bug reveal: confirm that clearly labeling it "intentional demo gap" on-screen via overlay (not just in the VO) is sufficient per honesty rules — add a spoken callout if needed.
