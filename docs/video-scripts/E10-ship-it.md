# E10 — Ship It (Deploy) — Full Script

**Length:** 10–12 min · **Trial day:** Day 22 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Take TaskFlow from the reviewed, hardened codebase of E08 to a live production URL — multi-stage Docker, webpack externals bundling, database migration strategy, production hardening — with devops grunt work delegated to CLI agents.
**Controlling thesis:** The same open-weight rig that planned and reviewed TaskFlow can take it to a live URL.

## Pre-record checklist

- Full reviewed, green codebase from E08 present; E09 ops layers in place.
- A disposable deploy target (staging/sandbox VPS or container host) registered and reachable. No real production account. [VERIFY which cloud provider is shown on camera.]
- All secrets stored in a vault or env file off-screen; editor will blur any token, registry URL, or credential.
- Test-mode database pre-seeded (two tenants, a few tasks each) on throwaway Postgres instance.
- Docker Desktop (or equivalent) running locally so the multistage build can be shown; pre-pull base images to avoid cold-pull dead time.
- Migration tested against a throwaway copy of the DB before recording; result is known-clean.
- `nestjs-deployment` skill installed and verified in the desktop app.
- `codex`/`copilot`/`ptah-cli` delegates confirmed reachable from within the desktop session.
- Smoke-test checklist (sign-up → create task → SSE board update) scripted so the live test is fast and predictable.

## Assets / overlays

- Multi-stage Docker build diagram (stage labels: deps → build → prune → runtime; final image size callout).
- "Migrations: safe, ordered, deploy-time" strategy card overlay.
- Production hardening checklist overlay (Helmet / CORS / throttler / ValidationPipe / no-stack-trace-leak).
- "LIVE" URL reveal badge (green, animated).
- Trial-day counter: "Day 22 / 100".
- Spawn → Poll → Read lower-third (reused from E02).
- Approval-flow callout on any deploy-mutating tool call.

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat open; the open-weight model badge (Kimi) is visible in the corner. Lower-third fades in.
- **ON-SCREEN (lower-third):** "Day 22 / 100"
- **VO:** "The codebase from E08 is reviewed and passing. Today I'm taking it the rest of the way — containerized, hardened, and deployed to a live URL."

### [00:20–01:00] Where we are (continuity bridge)

- **VISUAL:** Quick scroll through the chat history. The green terminal badge from E08's final review is visible. Cut to the workspace directory in the file tree.
- **VO:** "The E08 reviews cleared — code, logic, and security. The E09 ops layer is in place: cron jobs, gateway. The remaining gap is getting a reviewed codebase to a URL that actually responds. That's what `nestjs-deployment` handles."
- **ON-SCREEN:** "E08 → hardened · E09 → ops · E10 → live"

### [01:00–02:10] Invoke nestjs-deployment

- **VISUAL:** In the Ptah chat, the user invokes the `nestjs-deployment` skill. The orchestrator reads the workspace and returns a deployment plan covering docker-multistage, webpack-bundling, database-migrations, and production-hardening.
- **VO:** "I'm handing this to `nestjs-deployment`. It reads the Nx monorepo layout and generates the deployment pipeline from it — Dockerfiles, build config, migration strategy, and the hardening checklist."
- **VISUAL:** The orchestrator's plan streams in — four tracks labeled Docker, Webpack, Migrations, Hardening.
- **ON-SCREEN (lower-third):** "nestjs-deployment · docker-multistage · webpack-bundling · database-migrations · production-hardening"
- **VO:** "Four tracks. I'll walk each one. The orchestrator plans; the CLI agents do the file work."

### [02:10–04:00] Track 1 — Multi-stage Docker build

- **VISUAL:** The multi-stage Docker diagram overlay animates in. Four stages: deps, build, prune, runtime. The orchestrator directs a CLI agent to generate the Dockerfile. [VERIFY which delegate is used — codex, copilot, or ptah-cli.]
- **ON-SCREEN (lower-third):** "Spawn → Poll → Read"
- **VO:** "The first track is the Docker build. The goal is a small runtime image, which means a multi-stage build: install deps, compile the NestJS app, prune dev dependencies, then a runtime image with only what the app needs to run."
- **VISUAL:** The CLI agent completes; the Dockerfile result streams back. The orchestrator reviews it in-line.
- **VO:** "The orchestrator reviews the output before it lands. The final image has production deps only — no source, no dev tooling — which keeps the attack surface smaller and startup faster."
- **VISUAL:** Multi-stage diagram highlights the final image size callout.
- **ON-SCREEN:** Dockerfile diff in the editor pane; final stage size callout.

### [04:00–05:10] Track 2 — Webpack externals bundling

- **VISUAL:** Orchestrator delegates the webpack bundling config to a second CLI agent while the first is already writing Docker. Two Spawn → Poll cycles visible.
- **VO:** "In parallel, a second agent handles the webpack config. NestJS in production bundles to a single file, but native modules — including better-sqlite3 and any platform add-ons — have to stay external. `nestjs-deployment`'s webpack-bundling reference handles that list so they're excluded from the bundle and packaged alongside it."
- **VISUAL:** The bundling config and the external-modules list stream back. Milestone: build command runs, green.
- **ON-SCREEN:** Build terminal output scrolling; green checkmark.
- **VO:** "Build passes. That bundle is what goes into the container."

### [05:10–06:30] Track 3 — Database migration strategy

- **VISUAL:** The orchestrator explains the migration strategy on screen. Migration commands visible in the chat response.
- **VO:** "Migrations are where deploys go wrong. The strategy here: at deploy time, before the app starts, Prisma runs the pending migrations in order. No manual steps. If a migration fails, the container fails to start and the previous version stays live."
- **VISUAL:** The orchestrator generates a deploy-time migration step and wires it into the container startup sequence. [VERIFY exact entrypoint/start script approach used.]
- **ON-SCREEN:** "Migrations: safe, ordered, deploy-time" strategy card overlay.
- **VO:** "The safety convention we've followed throughout is additive-first — never drop before you add. The orchestrator checked the migration history against that before generating the entrypoint."
- **VISUAL:** Migrations run against the throwaway database; output shows clean execution. Green.
- **ON-SCREEN:** Migration run output; green checkmark.

### [06:30–07:30] Track 4 — Production hardening

- **VISUAL:** Production hardening checklist overlay fades in. Items check off as the orchestrator narrates each.
- **VO:** "The production-hardening checklist covers: Helmet for HTTP security headers, CORS locked to the domain, a throttler on public endpoints, the global ValidationPipe with whitelist and forbidNonWhitelisted, and no raw error messages leaking to clients. Most of these were applied earlier in the series. `nestjs-deployment` confirms them against the live code and flags what's missing."
- **VISUAL:** The orchestrator surfaces one gap — an endpoint missing the throttler decorator. [VERIFY this is a real gap to show, or add a deliberate one.] A CLI agent patches it; re-run passes.
- **ON-SCREEN:** Hardening checklist overlay; all items green.
- **VO:** "Everything checked. The app is ready to deploy."

### [07:30–08:40] Delegate the CI/CD pipeline

- **VISUAL:** Approval-flow callout appears as the orchestrator proposes writing CI/CD pipeline files.
- **ON-SCREEN (callout):** "Approval needed — deploy pipeline write"
- **VO:** "Now the pipeline. The orchestrator proposes the CI steps — build the image, push to the registry, run migrations, restart the service. Before any file gets written, the approval flow surfaces — the same pattern we've used since episode two."
- **VISUAL:** User approves. CLI agents take the pipeline tasks: one writes the container-build step, one writes the registry-push and deploy step. Spawn → Poll → Read twice.
- **ON-SCREEN (lower-third):** "Spawn → Poll → Read · CI/CD delegation"
- **VO:** "Two agents, two tracks, in parallel. The orchestrator holds the plan; the CLI agents handle the file work. Deploy pipelines have strict ordering and easy copy-paste mistakes, so having the orchestrator stitch the results together is useful here."
- **VISUAL:** Both agents complete; the orchestrator reviews and stitches the results together.

### [08:40–09:50] Deploy — the live URL reveal

- **VISUAL:** The deploy command runs. Container build log scrolls (summarized with an overlay so detail is readable). Migration runs clean. Service starts.
- **VO:** "Deploy. The image builds, migrations run, and the service comes up."
- **VISUAL:** The terminal reports the service is live. A URL appears.
- **ON-SCREEN:** "LIVE" badge animates green over the URL. [VERIFY the URL is a disposable staging domain — blur or replace the real host.]
- **VO:** "There it is. TaskFlow is responding from a public URL."

### [09:50–11:00] Production smoke test

- **VISUAL:** A browser opens to the live URL. The smoke-test sequence runs: sign up as a new user, create a task, open the board in a second tab — realtime SSE update fires.
- **VO:** "Smoke test: sign up, create a task, watch the board update in realtime. Same three-step check as episode five, except now it's running against a real server, a real database, and an SSE stream over the public internet."
- **VISUAL:** The task appears on the board in the second tab. Both tabs green.
- **ON-SCREEN:** "Sign-up → Create task → Realtime: passed" overlay.
- **VO:** "All three pass. The migrations landed clean. The hardening checklist is green. This ran on open weights — no closed lab involved."
- **ON-SCREEN (lower-third):** "Ran on open weights"

### [11:00–11:45] Payoff + CTA

- **VISUAL:** Side-by-side: the TaskFlow empty folder from episode one, and the live URL in the browser.
- **VO:** "Empty folder on day one. Day twenty-two: a containerized, hardened, deployed SaaS — auth, multi-tenancy, billing, realtime, smoke test passing. That's where we are."
- **VISUAL:** Trial counter animates.
- **ON-SCREEN:** "Day 22 / 100 — 78 days left."
- **VO:** "Next episode: we take everything built here and turn it into reusable skills and a harness — so the next project doesn't start from zero. See you there."
- **ON-SCREEN:** End card — "Next: Teach Ptah Your Stack (E11)" · playlist link.

---

## Shot list (quick capture summary)

1. Cold open — Ptah Desktop with Kimi badge + Day 22 lower-third.
2. Chat history scroll showing E08 green pass.
3. `nestjs-deployment` invocation + four-track plan streaming in.
4. Multi-stage Docker diagram overlay + CLI agent generating Dockerfile.
5. Dockerfile diff in editor pane; final image size callout.
6. Webpack bundling config + build terminal output (green).
7. Migration strategy card overlay + migration run output (green).
8. Production hardening checklist overlay; gap caught + patched; all items green.
9. Approval-flow callout on CI/CD pipeline write.
10. Two CLI agents in parallel (CI/CD delegation).
11. Deploy log scrolling (summarized overlay) + service-up signal.
12. "LIVE" badge over the URL reveal.
13. Browser smoke test: sign-up → create task → realtime two-tab shot.
14. Smoke-test passed overlay; "Ran on open weights" caption.
15. Side-by-side: empty folder vs live URL; Day 22 counter; end card.

## [VERIFY] flags

- Which cloud/container host is used as the disposable deploy target — confirm it can be shown without exposing account details, and that the staging domain is safe to display or will be blurred by the editor.
- Exact desktop path in Ptah to approve a deploy-pipeline write via the approval flow (confirm the callout/modal wording matches production UI).
- Which CLI delegate (`codex`, `copilot`, or `ptah-cli`) is used for Dockerfile generation vs CI/CD pipeline — confirm priority ordering in this context.
- The exact entrypoint/start-script approach the `nestjs-deployment` skill recommends for deploy-time migrations (e.g., a shell wrapper vs package.json script vs Docker CMD chain).
- Whether the production hardening gap (missing throttler) should be a deliberately planted real gap or an organic one from the codebase — confirm with the series producer so it isn't described as "natural" if it was planted.
- Confirm the "final image size" figure that appears in the Docker diagram overlay is derived from an actual dry-run build, not a placeholder.
- The smoke-test URL display policy — confirm whether the staging domain is blurred in post or replaced with a placeholder graphic.
