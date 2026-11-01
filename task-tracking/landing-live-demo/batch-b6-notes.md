# B6 — PtahCode live demo scenarios

Three synthetic replays use `/workspace/acme-app` on branch `demo`, fixed fake UUIDs, English text, and a 1440×900 dark viewport. Each starts from session history, advances on a sessionId-only timeline, supplies a synthetic plan-limit owner, and reports nonzero tokens and cost through stats fixtures. The generated TypeScript companions were refreshed with `node scripts/landing/generate-live-demo-types.mjs`.

## Tribunal council — `tribunal-council` (33.15 s)

The orchestrator convenes a three-member council inside a chat session to choose between a direct launch and a staged rollout for a small TypeScript web app. Architecture, Reliability, and Product give distinct opinions; the orchestrator repeats each recommendation in its final message and closes with a staged-rollout verdict and release gates. The retired standalone Tribunal route is not used.

RPC answers: shared boot fixtures for workspace, readiness, auth, license, config, setup, git, plugins, analytics, indexing, and voice; `session:list` has the council session, `chat:resume` seeds the user request, `chat:running-agents`/`chat:subagent-query` supply council state, `session:stats-batch` supplies usage, and `provider:getPlanLimits` supplies one synthetic Claude account owner with 5-hour and weekly windows. Timeline types: `chat:chunk` (message, task, council member progress and verdict stream events), `session:subagentEnded`, `session:stats-live`, `session:turnEnded`. The end frame shows the verdict and no running agents.

Screenshots: [mid](evidence/b6-tribunal-council-mid.png), [end](evidence/b6-tribunal-council-end.png). Inspected against the chat design reference: council members and task rows appear during the run; the verdict, usage, plan limits, and done state appear at the end.

## Multi-agent — `multi-agent` (35.65 s)

The orchestrator splits dashboard polish between two SDK helpers (Accessibility and State review) and two CLI lanes (Copilot and Codex). Each lane reports progress, usage and completion; the final chat message summarizes the loading, empty-state, semantic-control and refresh improvements.

RPC answers: the same shared boot fixtures, `session:list`/`chat:resume` for the dashboard request, `chat:running-agents` and `chat:subagent-query` for SDK helpers, `session:cli-sessions` for CLI lanes, `session:stats-batch` for usage, and `provider:getPlanLimits` with a synthetic owner. Timeline types: `chat:chunk`, `agent-monitor:spawned`, `agent-monitor:output`, `agent-monitor:exited`, `session:subagentEnded`, `session:stats-live`, `session:turnEnded`. CLI output uses the privacy sanitizer's canonical placeholder while process metadata and usage remain visible. The end frame shows all four agents done and the summary in chat.

Screenshots: [mid](evidence/b6-multi-agent-mid.png), [end](evidence/b6-multi-agent-end.png). Inspected against the chat design reference: SDK tabs, CLI lanes, status chips, usage, plan limits, and final summary render; no agent remains running.

## Command Center — `command-center` (31 s)

The Electron Command Center opens from a `switchView` boot message and visualizes a dashboard-release session with concurrent Copilot and Codex lanes. `session:list` also includes two inactive sessions for checkout and accessibility work. The graph moves from one running CLI node to both completed, with session totals and a local voice fixture.

RPC answers: the same shared boot fixtures, `session:list` with three sessions, `chat:resume` for the selected release request, `session:cli-sessions` for lane history, `session:stats-batch` for totals, `voice:getProviderConfig` for local voice readiness, and `provider:getPlanLimits` with a synthetic owner. Timeline types: `session:stats-live`, `agent-monitor:spawned`, `agent-monitor:output`, `agent-monitor:exited`. The capture selects the release session from the recent-session picker so the graph has its root and child nodes. The end graph has two completed CLI nodes and an idle root. The Command Center context badge reads “Context unknown” even though the provisional stats push includes a context reading; this appears to depend on the command-center marked tab rather than the session totals.

Screenshots: [mid](evidence/b6-command-center-mid.png), [end](evidence/b6-command-center-end.png). Inspected against the Command Center design reference: graph nodes, selected orchestrator, live activity, cost and token totals, and completed lane states render at 1440×900 dark.

## Checks

`node scripts/landing/build-live-demo.mjs --out /tmp/ptah-b6/demo` succeeded on the final scenario inputs. `node scripts/landing/check-live-demo.mjs --root /tmp/ptah-b6 --scenario <id>` passed for each final scenario:

| Scenario | Status | Misses | Console errors | Console warnings | CSP | External requests |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| tribunal-council | PASS | 0 | 0 | 0 | 0 | 0 |
| multi-agent | PASS | 0 | 0 | 0 | 0 | 0 |
| command-center | PASS | 0 | 0 | 0 | 0 | 0 |

Strict B5 sanitizer passed for all three with no dropped RPC/push types, redacted fields, secrets, paths, PII, payloads, or timestamp changes. Each sanitized output is semantically identical to its scenario input (JSON equality). The sanitizer's UUID remap counters were 1, 3, and 5 respectively, but the canonical IDs were already present in the inputs.

`npm run verify -- -p web-landing` passed on the final scenario inputs: lint, test (including the scenario contract and privacy checks), and typecheck all succeeded. The final run waited 1432 seconds for a lock slot, then completed successfully.

Scoped Ptah diagnostics reported no errors in the three generated scenario files. Its standalone TypeScript compiler also reported six errors in unrelated shared files and the landing test setup under its own compiler target; the project verify typecheck passed.

Skill discovery: Ptah harness search returned no matching local replay-scenario skill; the work followed the repository plan and examples directly.
