# ptah-review infrastructure inventory

## Scope and evidence

This inventory supports one decision: how to build an automated pull-request review pipeline from scheduled tasks, CLI agent lanes, and the existing Ptah hosts. The event-source options are scheduled polling, GitHub Actions, a new GitHub webhook receiver, and messaging gateways.

**Verified** statements below come from the repository at the inspected `main` snapshot. **Inferred** statements describe integration consequences or effort. No external sources, runtime tests, builds, or state-changing commands were used. Effort means relative code and integration size, not elapsed time: **S** = adapter or glue, **M** = new service, state, or UI, **L** = new trust boundary or always-on infrastructure.

## Scheduled tasks

### Model and persistence — verified

- `ScheduledJob` stores an ID, name, cron expression, timezone, prompt, workspace root, enabled flag, timestamps, and last/next run times. It has no repository, pull-request number, head SHA, event payload, or review cursor (`libs/backend/cron-scheduler/src/lib/types.ts:37-52`).
- `JobRun` records the scheduled slot, start/end times, status, result summary, and error. Statuses are `pending`, `running`, `succeeded`, `failed`, and `skipped` (`libs/backend/cron-scheduler/src/lib/types.ts:21-26`, `libs/backend/cron-scheduler/src/lib/types.ts:54-65`).
- SQLite migration `0004_cron.ts` creates `scheduled_jobs` and `job_runs`. `UNIQUE(job_id, scheduled_for)` makes a slot claim idempotent (`libs/backend/persistence-sqlite/src/lib/migrations/0004_cron.ts:3-30`).
- The scheduler accepts a catchup window with a 24-hour ceiling. The global catchup policy is hard-coded to `last` (`libs/backend/cron-scheduler/src/lib/types.ts:110-121`, `libs/backend/cron-scheduler/src/lib/cron-scheduler.ts:27-29`).

### Triggers and execution — verified

- Cron time is the only persisted trigger. `runNow` adds manual execution. There is no pull-request event trigger (`libs/backend/cron-scheduler/src/lib/cron-scheduler.ts:156-217`).
- A job can name a registered handler with `handler:`. Otherwise, the runner executes its prompt through `SDK_INTERNAL_QUERY_SERVICE` (`libs/backend/cron-scheduler/src/lib/types.ts:123-146`, `libs/backend/cron-scheduler/src/lib/job-runner.ts:245-278`).
- A `JobHandler` receives the job and run context and returns a structured result. This is the cleanest existing backend extension point for a poll-and-review service (`libs/backend/cron-scheduler/src/lib/types.ts:145-183`).
- Handler registrations live in memory. A consumer must register its handler during each host boot (`libs/backend/cron-scheduler/src/lib/handler-registry.ts:16-43`).
- The runner claims a slot, enforces scheduler concurrency, dispatches the run, and records its outcome (`libs/backend/cron-scheduler/src/lib/job-runner.ts:132-243`).
- Ordinary prompt runs resolve workspace provider/model settings and MCP wiring. Their stored result summary is capped at 500 characters (`libs/backend/cron-scheduler/src/lib/job-runner.ts:261-300`). Detailed review findings therefore need separate artifact storage.

### Lifecycle, host support, and UI — verified

- Electron starts the scheduler during heavy-service boot and retains its reference (`apps/ptah-electron/src/activation/boot-heavy-services.ts:497-506`). DI registers scheduler services and cron RPC handlers (`apps/ptah-electron/src/di/phase-2-libraries.ts:447`, `apps/ptah-electron/src/di/phase-4-handlers.ts:136`).
- Startup performs catchup and arms enabled jobs. Electron power-resume also triggers catchup (`libs/backend/cron-scheduler/src/lib/cron-scheduler.ts:102-130`, `libs/backend/cron-scheduler/src/lib/catchup-coordinator.ts:1-24`).
- With policy `last`, catchup runs only the newest missed slot for each enabled job. The replay window is at most 24 hours (`libs/backend/cron-scheduler/src/lib/catchup-coordinator.ts:81-115`).
- Jobs do not execute while the host process is closed. Stop clears timers and detaches power handling (`libs/backend/cron-scheduler/src/lib/cron-scheduler.ts:133-142`).
- Nine RPC methods cover list, get, create, update, delete, toggle, run-now, run history, and next-fire (`libs/backend/rpc-handlers/src/lib/handlers/cron-rpc.handlers.ts:143-153`, `libs/backend/rpc-handlers/src/lib/handlers/cron-rpc.handlers.ts:261-294`).
- The Angular cron tab creates and edits cron expression, prompt, workspace root, timezone, and enabled state. It refreshes only for Electron (`libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts:479-481`, `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts:533-607`).
- The frontend cron service marks VS Code unavailable (`libs/frontend/cron-scheduler-ui/src/lib/services/cron-rpc.service.ts:41-45`). A CLI backend bootstrap can also start Thoth cron, but this does not create an always-on process or cron UI (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:324-379`).
- Thoth registers built-in backup, integrity, and retention handlers before scheduler start (`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:273-415`). Its activity-event surface covers built-in jobs only, not arbitrary user jobs (`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:229-233`).

### Consequence — inferred

Cron can schedule a review poll and retain operational history. It cannot detect new pushes, correlate a run with a PR head, or suppress duplicate reviews without a new review-state model.

## Lanes and sessions

### Programmatic CLI lanes — verified

- `SpawnAgentRequest` supports task text, CLI family, working directory, inactivity timeout, focus files, task folder, deliverables, model, effort, resume ID, Ptah CLI provider, model tier, role, task kind, routing source, and account selection (`libs/shared/src/lib/types/agent-process.types.ts:261-343`).
- Declared deliverables resolve against the task folder or working directory. Terminal processing checks that they exist and are nonempty (`libs/shared/src/lib/types/agent-process.types.ts:280-290`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:647-705`).
- `AgentProcessManager.spawn(request)` performs detection, workspace validation, preflight, account handling, and adapter start (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:409-520`).
- A non-chat caller can use `waitForAgents` and bounded `readOutput` directly (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1729-1831`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1940-1995`). No parent chat session is required for these APIs.
- Spawn capacity includes active agents and spawning reservations through `maxConcurrentAgents` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:2540-2552`).
- The strict MCP spawn boundary accepts at most 20 deliverables (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts:75-110`).
- Detection covers Codex, Copilot, Cursor, Antigravity, OpenCode, Pi, Grok, and host-registered Claude (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:1-8`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:111-134`). Detection is installation detection, not proof of authentication or plan capacity (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:77-85`).
- Terminal processing records outcomes before parent delivery. Signals include status, exit code, duration, deliverable checks, verdict, CLI session ID, and stop information (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:340-444`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:587-644`).
- A missing or inactive parent, or unavailable chat runtime, causes an explicit chat-delivery refusal. This does not remove direct outcome and deliverable processing (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:340-444`).

### Sessions and worktrees — verified

- `ptah_session_start` child snapshots include branch, base SHA, worktree, task folder, deliverables, and completion state (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts:55-95`).
- Child start requires a chat host, a live calling session, MCP, available depth, and child capacity (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:239-317`). It is not a general non-chat review-session factory.
- The child provisioner creates a fresh branch and worktree from `baseRef` or `HEAD`. It refuses existing branches and paths (`libs/backend/cli-agent-runtime/src/lib/session-children/child-worktree.provisioner.ts:73-142`).
- Lower-level worktree administration lists, adds, removes, and prunes worktrees. Removal protects locked worktrees (`libs/backend/vscode-core/src/services/git/agent-worktree-admin.ts:77-199`).
- Session organization validates and canonicalizes GitHub PR URLs and can extract a URL from successful `gh pr create` output (`libs/backend/session-organization/src/lib/utils/pr-url.ts:1-18`, `libs/backend/session-organization/src/lib/utils/pr-url.ts:108-143`). This links sessions to PRs; it is not incremental review state.

### Consequence — inferred

`AgentProcessManager` is the reusable lane API for unattended review. A new orchestrator must wait for lanes, read artifacts, apply review-specific concurrency, and persist results. Chat completion pushes and child sessions are optional UI integrations, not the execution foundation.

## Git and GitHub

### Existing reads and local review support — verified

- `GitReviewReader` compares local base/head refs through their merge base. It returns changed files, statistics, and SHAs, and returns authorized original/modified blobs (`libs/backend/vscode-core/src/services/git-review-reader.service.ts:74-189`, `libs/backend/vscode-core/src/services/git-review-reader.service.ts:192-241`).
- Git RPC exposes `git:reviewChanges`, `git:reviewFile`, worktree operations, diffs, fetch, pull, and push (`libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:180-205`, `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:236-263`).
- `GitHubPrStatusReader` finds PRs for the current branch with `gh pr list --head <branch> --state all --limit 50 --json ...` (`libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:449-482`, `libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:545-581`).
- The reader summarizes check rollup counts, classifies authentication/non-GitHub failures, bounds process output, applies timeouts, caches successful reads, and shares concurrent `gh` calls (`libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:142-192`, `libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:345-364`, `libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:622-660`).
- `GitPrInfo` contains number, title, state, draft state, review decision, URL, and head ref (`libs/shared/src/lib/types/rpc/rpc-git.types.ts:952-1004`). It lacks head/base SHAs, body, and existing review comments.
- `git:prStatus` accepts workspace scope only (`libs/shared/src/lib/types/rpc/rpc-git.types.ts:1006-1011`, `libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts:197-234`). It does not enumerate all open repository PRs or provide an incremental cursor.
- The frontend review-comment draft store manages local line comments and formats them as one agent-feedback message (`libs/frontend/git-ui/src/lib/services/review-comment-draft.store.ts:19-29`, `libs/frontend/git-ui/src/lib/services/review-comment-draft.store.ts:72-92`). It sends feedback through `IAgentFeedbackSender`, not GitHub (`libs/frontend/git-ui/src/lib/services/review-comment-draft.store.ts:139-247`).
- The benchmark contains paged, Zod-parsed `gh api graphql` merged-PR reads. It is reference code, not production infrastructure (`tools/mcp-bench/src/ground-truth/relevance-questions.ts:243-329`).

### Missing GitHub capabilities — verified by targeted source searches

No production implementation was found for repository-wide PR discovery, GitHub PR diff acquisition, existing-review reads, review/comment publication, check-run creation, commit-status creation, or GitHub webhook verification. No Octokit dependency was found. The marketplace GitHub client performs unauthenticated public content reads and is not a PR client (`libs/backend/plugin-marketplace/src/lib/github/github-content.client.ts:1-18`).

### Consequence — inferred

The local diff reader and worktree services can support review after ref acquisition. A new GitHub adapter must add PR discovery, head-SHA state, remote diff/ref acquisition, comment reads, and authenticated publication. The existing status reader supplies safe `gh` process patterns but not the required data or mutations.

## Event sources

### Option A: scheduled polling

- **Verified:** Cron supplies durable periodic execution and catchup. The current GitHub reader can inspect the current branch only (`libs/backend/cron-scheduler/src/lib/types.ts:37-52`, `libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:545-581`).
- **Inferred:** Add a named cron handler, repository-wide open-PR/head-SHA queries, and a persisted `(repository, PR, head SHA)` cursor. This is the smallest desktop-first route. Reviews stop while every configured host is closed, and catchup does not replace head-SHA change detection.

### Option B: GitHub Actions

- **Verified:** CI already triggers on pull requests to `main` and cancels obsolete runs (`.github/workflows/ci.yml:3-18`). It runs DI lint, degradation audit, builds, Electron dependency gates, affected typecheck, and sharded tests (`.github/workflows/ci.yml:67-111`, `.github/workflows/ci.yml:159-292`).
- **Verified:** Searches found no `repository_dispatch`, `workflow_call`, `workflow_run`, `pull_request_target`, or `issue_comment` trigger that connects PR events to Ptah lanes.
- **Inferred:** Actions can execute the review in CI or notify a reachable controller. Both need new orchestration, lane installation/authentication, artifact transport, and credential policy. A desktop app behind NAT cannot receive a workflow call without a new outbound connection or polling bridge.

### Option C: authenticated GitHub webhooks

- **Verified:** The local MCP HTTP server binds to `localhost` and routes MCP requests (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:68-105`, `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:172-179`). It is not a public webhook receiver.
- **Inferred:** This option needs a new reachable endpoint, signature verification, replay handling, secret storage, event persistence, and a delivery path to the review host. It has the largest operational cost and best event latency.

### Option D: messaging gateways

- **Verified:** `InboundMessage` models normalized chat messages. Adapters expose lifecycle, send/edit, connection state, and one `inbound` listener (`libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts:16-40`, `libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts:75-142`).
- **Verified:** `GatewayService` rate-limits, binds, persists, and deduplicates messages before emitting `inbound`. `sendNotice` can deliver review notifications (`libs/backend/messaging-gateway/src/lib/gateway.service.ts:618-635`, `libs/backend/messaging-gateway/src/lib/gateway.service.ts:754-799`).
- **Verified:** Slack, Telegram, and Discord adapt provider chat events/messages, not GitHub webhooks (`libs/backend/messaging-gateway/src/lib/adapters/slack/bolt.adapter.ts:276-302`, `libs/backend/messaging-gateway/src/lib/adapters/telegram/grammy.adapter.ts:313-359`).
- **Inferred:** Use gateways for notifications and operator commands. Do not treat them as PR event transport without a new external adapter.

## Review assets

### Review prompts and roles — verified

- The repository ships `/review-code`, `/review-logic`, and `/review-security` as `ptah-core` commands (`content-manifest.json:41-47`). The requested `.claude/skills/review-*` source paths were absent; the plugin commands are the reusable repository sources.
- `/review-code` covers stack-aware quality review, file/line findings, scoring, and diff targeting. It carries 40% triple-review weight (`plugins/ptah-core/commands/review-code.md:1-11`, `plugins/ptah-core/commands/review-code.md:109-239`).
- `/review-logic` covers placeholders, business rules, technical debt, priorities, and structured results. It carries 35% weight (`plugins/ptah-core/commands/review-logic.md:1-11`, `plugins/ptah-core/commands/review-logic.md:30-208`, `plugins/ptah-core/commands/review-logic.md:221-300`).
- `/review-security` covers secrets, injection, authorization, privacy, network security, severity, remediation, and verification. It carries 25% weight (`plugins/ptah-core/commands/review-security.md:1-11`, `plugins/ptah-core/commands/review-security.md:30-200`, `plugins/ptah-core/commands/review-security.md:213-353`).
- The review prompt catalogue exposes all three commands and Tribunal (`libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-catalogue.ts:95-120`).
- `code-logic-reviewer` requires behavioral review, failure injection, severity, evidence, a verdict, and `code-logic-review.md` (`.claude/agents/code-logic-reviewer.md:53-152`, `.claude/agents/code-logic-reviewer.md:154-251`).
- `code-style-reviewer` covers structure, repository boundaries, wiring, severity, evidence, and `code-style-review.md` (`.claude/agents/code-style-reviewer.md:53-158`, `.claude/agents/code-style-reviewer.md:160-251`). Generated role templates also exist under `libs/backend/agent-generation/templates/agents/`.
- Tribunal supplies Council, Forge, Race, Crucible, and Relay patterns with cited synthesis and family diversity (`plugins/ptah-core/skills/tribunal/SKILL.md:33-72`). Its panel discovery, cost presentation, and user confirmation are interactive and need an unattended policy (`plugins/ptah-core/skills/tribunal/SKILL.md:22-31`, `plugins/ptah-core/skills/tribunal/references/vendor-panel.md:30-81`).

### Linters, checks, and CI — verified

- The degradation audit uses AST checks for swallowed failures and floating promises. It enforces per-directory ratchet baselines and fails on parse failures (`tools/degradation-audit/check-degradation.ts:1-64`, `tools/degradation-audit/check-degradation.ts:791-859`).
- `ptah_run_check` validates one Nx project/target, runs workspace-local Nx without a shell, writes full logs, kills timed-out process trees, and returns structured verdicts (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/run-check.tool.ts:152-203`, `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/run-check.tool.ts:209-323`).
- Its allowed targets are `test`, `lint`, `typecheck`, and `build` (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/wait-tools-args.schema.ts:65-100`).
- `scripts/verify.mjs` supplies the mandatory machine-wide verification lock and affected/project-scoped Nx commands (`scripts/verify.mjs:1-20`, `scripts/verify.mjs:74-97`). `ptah_run_check` invokes Nx directly and does not acquire this lock.
- Semgrep, content-manifest, and Playwright workflows add focused PR coverage (`.github/workflows/semgrep.yml`, `.github/workflows/content-manifest.yml`, `.github/workflows/electron-e2e.yml`, `.github/workflows/webview-e2e.yml`). None orchestrates Ptah review lanes.

### Consequence — inferred

The rubrics, reviewer roles, lane verdicts, and local check tools are reusable. The walkthrough generator, cross-file finding verification, severity normalization, deduplication, stale-finding handling, and GitHub publication contract still need implementation.

## Reuse vs build

| Capability | Exists | Reuse or gap | Effort |
| --- | --- | --- | --- |
| Durable schedule, manual run, history | Yes | Register a review poll handler | S |
| PR event discovery and head-SHA cursor | No | Add repository polling state or event ingestion | M |
| Programmatic multi-vendor lanes | Yes | Wrap spawn/wait/read and map review artifacts | S |
| Lane capacity and deliverable checks | Yes | Add review queue policy and budgets | M |
| Automatic review worktree | Partial | Reuse worktree administration outside chat child sessions | M |
| Local merge-base diff and file blobs | Yes | Acquire PR refs, then adapt reader input | M |
| GitHub PR discovery and diff | Partial | Extend beyond current-branch status and local refs | M |
| Existing review/comment reads | No | Add authenticated GitHub reads | M |
| Walkthrough and severity findings | Partial | Adapt review rubrics to one machine-readable schema | M |
| Cross-file verification and deduplication | No | Add verifier lanes and persisted finding identity | M |
| Inline review and summary publication | No | Add authenticated GitHub mutations and retry policy | M |
| Re-review of new pushes | No | Compare head SHAs and define stale-finding behavior | M |
| Local Nx/degradation checks | Yes | Route execution through the required verify lock | S–M |
| GitHub check-run/status publication | No | Add a separate optional GitHub mutation surface | M |
| Public webhook ingestion | No | New authenticated, reachable service | L |
| Slack/Telegram/Discord notification | Partial | Map review results to gateway notices | S–M |
| Review operations UI | Partial | Extend cron/run and local review UI for PR state | M |

## Decisions

These are evidence-backed research conclusions. The deployment and publication choices remain open.

1. **Use `AgentProcessManager` for non-chat lanes.** It exposes spawn, wait, output, limits, and deliverable processing without a parent chat (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:409-520`).
2. **Do not use `ptah_session_start` as the unattended execution base.** Its live-parent chat and MCP requirements conflict with scheduled background operation (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:239-317`).
3. **Treat cron as a polling driver, not an event bus.** Its persisted model and triggers contain no PR identity or event payload (`libs/backend/cron-scheduler/src/lib/types.ts:37-65`).
4. **Separate review state from cron history.** A unique cron slot cannot deduplicate two pushes or identify the last reviewed head (`libs/backend/persistence-sqlite/src/lib/migrations/0004_cron.ts:18-30`).
5. **Reuse review commands and roles as rubrics, not as the pipeline.** Their output contracts target chat or task files, not GitHub reviews (`plugins/ptah-core/commands/review-logic.md:221-300`, `.claude/agents/code-logic-reviewer.md:154-251`).
6. **Use messaging gateways for notification only.** Their normalized contract carries chat messages, not authenticated PR events (`libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts:16-40`).
7. **Do not substitute direct `ptah_run_check` execution for repository verification policy.** The mandatory lock lives in `scripts/verify.mjs` (`scripts/verify.mjs:1-20`).

## Open questions

1. **Where must review run?** Electron-only polling stops when the app closes. CI or a hosted controller needs new credentials and connectivity.
2. **Which repositories and PR authors are trusted?** Fork PRs, secrets, write tokens, and arbitrary code execution need an explicit security policy.
3. **What should be published?** Decide walkthrough placement, severity threshold, inline-comment limits, and whether reviews request changes or only comment.
4. **How should updates behave?** Decide whether new pushes update one summary, resolve old comments, add new comments, or preserve all history.
5. **Which GitHub identity and credentials are allowed?** Current reads use the user's `gh` authentication, but unattended publication permissions are not defined.
6. **What lane budget applies?** Choose provider families, parallel reviewers, verification rounds, timeouts, and cost limits before unattended Tribunal use.
7. **Which checks may run on PR code?** Decide project scope, allowed targets, fork restrictions, and how every run enters the machine-wide verify lock.
8. **What state and UI are required?** Define cursor/finding retention, failure retry, manual rerun, review history, and notification destinations.
