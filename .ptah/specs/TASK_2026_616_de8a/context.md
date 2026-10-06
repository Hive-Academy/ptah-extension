# TASK_2026_616 — context

Follow-ups of TASK_2026_615_04b0 (plan-limit owners and quota windows).
Branch `fix/task-615-owner-followups` from `origin/main` 04a64064e, worktree
`.claude-worktrees/task-615-owner-followups`.

Scope (priority order) is in the user request: 1 Antigravity account owner from the
language server, 2 cli-store owner upgrade at exit, 3 google_accounts.json cache,
4 broadcaster bound, 5 Claude-only resolveModelScope, 6 null modelScope in
agent-monitor.store, 7 UI meter and captions, then TASK_2026_596 Minors.

## Item 1 investigation (2026-10-05) — STOPPED for a user decision

### Local probe

- No Antigravity language server runs on this machine, and the Antigravity app is not
  installed (only `~/.gemini/antigravity` data exists). A live `GetUserStatus` capture
  was not possible.

### Public evidence (third party, not official)

Source: CodexBar (github.com/steipete/CodexBar, last change to the probe 2026-10-02),
`Sources/CodexBarCore/Providers/Antigravity/AntigravityStatusProbe.swift` and
`AntigravityStatusProbe+ResponseModels.swift`, with test fixtures in
`Tests/CodexBarTests/AntigravityStatusProbeTests.swift`.

- `GetUserStatus` reply: `{ userStatus: { email, userTier{id,name}, planStatus{planInfo{...}},
  cascadeModelConfigData{ clientModelConfigs[]{ label, modelOrAlias{model},
  quotaInfo{ remainingFraction, resetTime } } } } }`.
- So an account field exists: `userStatus.email`.

### Mismatch with our reader (larger than item 1)

CodexBar's request and reply do not match `antigravity-plan-usage.reader.ts` /
`antigravity-ls.provisional.ts`:

| Aspect        | Our reader                      | CodexBar                                                                  |
| ------------- | ------------------------------- | ------------------------------------------------------------------------- |
| Reply schema  | `{ models: { [name]: {remainingFraction, resetTime} } }` | `userStatus.cascadeModelConfigData.clientModelConfigs[].quotaInfo` |
| CSRF header   | `x-goog-csrf-token`             | `X-Codeium-Csrf-Token`                                                    |
| Request body  | none                            | JSON `{ metadata: { ideName, extensionName, ideVersion, locale } }`, `Content-Type: application/json`, `Connect-Protocol-Version: 1` |
| Port          | `--port` argument               | listening ports of the process, plus `--extension_server_port`            |
| Scheme        | https only                      | https and http                                                            |

If CodexBar is correct, our reader never parses a real reply and always answers
`service-unavailable`. Adding `email` to the current `{ models }` schema would then have
no effect.

### Live transport test against `agy` 1.2.16 (2026-10-05, Windows)

`agy` (signed in) listens on two loopback ports. With a bogus token and the CodexBar JSON body:

| Request                                   | Reply                                   |
| ----------------------------------------- | --------------------------------------- |
| no CSRF header                            | 401 `missing CSRF token`                |
| `x-goog-csrf-token: bogus` (our header)   | 401 `missing CSRF token`                |
| `x-codeium-csrf-token: bogus`             | 401 `invalid CSRF token`                |
| no JSON body / no `Content-Type`          | 415                                     |
| port A over http                          | 400 "HTTP request to an HTTPS server"   |
| port B over https                         | EPROTO (port B is plain http)           |

Facts confirmed live: the header name is `X-Codeium-Csrf-Token`, a JSON body with
`Content-Type: application/json` is required, and the server has one https port and one
http port. `agy` needs a CSRF token too (CodexBar says it does not), and `agy` puts the
token on no command line and in no file, so a full `agy` reply was not captured. The
reply shape (`userStatus.email`, `clientModelConfigs[].quotaInfo`) stays third-party
evidence. The IDE language server passes `--csrf_token` on its command line.

### Decision (user: "fix all", 2026-10-05)

Rewrite the reader to the confirmed transport and the CodexBar reply shape, read
`userStatus.email`, hash it only in `provider-owner.resolver.ts`, keep
google_accounts.json as fallback, and keep the reply schema marked provisional.

### Options for the user (superseded by the decision above)

1. Rewrite the reader to the CodexBar shape (header, body, schema, port discovery), read
   `userStatus.email` and hash it only in `provider-owner.resolver.ts`. Keep
   google_accounts.json as fallback. Still unverified until a live capture.
2. Wait for a live capture on a machine with Antigravity running, then do option 1.
3. Leave item 1 open and continue items 2-7.

## Git status timeout (added scope, user request 2026-10-05)

The review panel showed "Git status is unavailable (git timed out)". Git is not slow on this
checkout (`git status` ~180 ms). Each git call had a fixed 10 s budget, a status refresh spawned
5 git processes, and watcher refreshes retried with no backoff, so host stalls during heavy agent
activity (seen in the Electron logs) ran the calls past 10 s. Batch G: 30 s budget for the status
and numstat calls, no separate repository probe (exit 128 + "not a git repository" from `git status`
is classified as not-a-repo), a 30 s watcher backoff after a timeout that never blocks a user/RPC
refresh, and one follow-up push from the Electron git watcher when the window closes.

## Outcome

Branch `fix/task-615-owner-followups` (from 04a64064e). Executors: CLI lanes codex, opencode and
Glm (Glm stopped at its Ollama Cloud usage limit during Batch G; opencode completed that batch).
Reviews: in-process code-logic-reviewer, Phase 1, Phase 2 and two fix re-reviews (all in
code-logic-review.md). Final verdict: APPROVED.

| Item | Result | Commits |
| ---- | ------ | ------- |
| 1 Antigravity owner from the language server | Reader rewritten to the live-confirmed transport; `userStatus.email` hashed only in provider-owner.resolver.ts; observation expires after 5 min and is cleared when no server answers; google_accounts.json stays as fallback; windows without `remainingFraction` are omitted | b2c21bfc8, 683c1d3a8 |
| 2 cli-store owner upgrade | cli-store -> account for the same provider (mid-run and at exit) | 546aa31af, daac44d51 |
| 3 google_accounts.json cache | 5 s TTL, then re-read only on mtime/size change | b2c21bfc8 |
| 4 Broadcaster bound | 10 s bound per push; `pushing` is always freed | 002495a1c |
| 5 resolveModelScope | Claude family scope only for ptah-cli lanes; no ledger rows were keyed by a lane scope, so nothing migrates | 546aa31af |
| 6 null modelScope | `null` clears a known scope, `undefined` keeps it | 002495a1c |
| 7 UI | Opened plan tile keeps the meter without the repeated text; owner suffix visible at 280 px; LANES subtotal caption on one line; Model/Context/Cost contrast 4.5:1; LANES pill accessible name; per-model table split into its own component | 36701343b, d1f7c4625, ff248a9ff, b568407fe |
| TASK_2026_596 Minors | A4, A5, A6, B1, B7, B8, Batch 17 and 19 Minors, FU-PHASE6 contrast done; FU-PHASE4 #2 did not reproduce in limits/ (see FU-616-JEST-WORKER-EXIT) | b2c21bfc8, e56c1583d, 002495a1c, ff248a9ff |
| Git status timeout | See above | 81c2e674d + the Batch G fix-round commit |

Not in this task: FU-PHASE2 #4 (agent-sdk), FU-PHASE5 #1 (vscode-lm-tools) and the Batch 20 Minor
(frontend `chat`) are outside the libs of items 1-7; FU-PHASE4 #3 stays provisional by design.

Screenshots (not committed): dark + light at 280/360/440 px, before (base 04a64064e) and after,
in `%TEMP%\task616-shots\before` and `%TEMP%\task616-shots\after`.

## Follow-ups (open)

1. Major: the `GetUserStatus` reply shape is still third-party evidence (CodexBar). Capture a live
   reply from an Antigravity IDE language server (it passes `--csrf_token` on its command line) and
   confirm `userStatus.email` and `clientModelConfigs[].quotaInfo`.
2. FU-616-P1-M1: de-duplicate listener ports; put the extension-port candidates ahead of the 8-attempt cap.
3. FU-616-P1-M2: cap `failingSince` in plan-usage.service.ts at `PLAN_USAGE_MAX_OWNERS`.
4. FU-616-P1-M4: a per-candidate sub-timeout (~1 s) inside the 3 s reader budget.
5. FU-616-JEST-WORKER-EXIT: the broad cli-agent-runtime `src/lib/cli-agents` jest run still prints the
   generic worker-exit warning (not reproduced in limits/).
6. Minors: unneeded `target` cast (reader :99-101); dead generation guard (plan-limits-broadcaster.ts
   :143, :150); vacuous logger-privacy assertion and weak `.rejects.toBeDefined()` in the reader spec;
   no production invalidation of the account-file cache (5 s TTL only); exit-time owner upgrade emits no
   `agent:quota-owner`; no spec for the reader clears at :147/:151; `.ok-solid-text` is dark-only (the
   light cost badge uses the daisyUI ink, 6.01:1, not pinned by a test); an unknown owner status string
   is shown as-is; a redundant follow-up push after a normal success in the Electron git watcher;
   git-watcher.service.ts is at 709 lines (max-lines warning 700) — split it.
