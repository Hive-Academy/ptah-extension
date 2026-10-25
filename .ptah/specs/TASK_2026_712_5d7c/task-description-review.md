# Task-description review — TASK_2026_712_5d7c

**Verdict: APPROVED**  
**Revision reviewed: 1**  
**Author execution side: Grok CLI lane (task-description.md and parity-inventory.md).**  
**Reviewer execution side: independent in-process reviewer, opposite execution side from the author.**  
**Technical requirements blockers: none.**  
**Release status: HOLD — unresolved user-reserved subscription enablement/release authorization. Document approval is not release permission.**

## Review scope and evidence convention

Reviewed the revised task description and parity inventory against the previous revision-0 review, context, decisions, and the worktree's `CLAUDE.md`. This is requirements review only: no architecture, implementation plan, production changes, removal approval, provider-policy determination, or release clearance.

All paths below are relative to the absolute worktree root `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/`. Document basenames refer to `.ptah/specs/TASK_2026_712_5d7c/` under that root. Citations identify actual file lines from targeted reads, not abbreviated tool-outline positions. Source reads used explicit absolute worktree paths; no MCP default-root source evidence was substituted for this worktree.

## R1–R7 disposition

| Finding | Disposition | Revision-1 evidence and conclusion |
| --- | --- | --- |
| R1 — Requested account management versus live verification restriction | Resolved | `task-description.md:123-124` requires add, status, sign-in, sign-out, and selection, including not-signed-in/signed-in/signed-out transitions. `:132` explicitly confines the live-operation prohibition to verification, not implementation. `:176-178` requires mocked actions and Electron interaction coverage. `parity-inventory.md:63,75,79` restores those actions, preserves existing screens, and rejects a directory-picker substitute. Claude first and Codex next remain the requested delivery scope; no scope reduction is approved. |
| R2 — Authorization concerns actual use/onboarding, not merely wording | Resolved for technical requirements; release hold remains open | `task-description.md:88-105` separates permitted technical/mock work and preservation of current behaviour from disputed enablement/release. `:119` expressly forbids treating directory selection as approval and preserves the current provider entry. `decisions.md:16-18` authorizes continuation of technical specification and mocked implementation, not licensing clearance or reduced scope. This is sufficient to approve technical requirements without demanding a user answer now. |
| R3 — Profile identity versus quota owner, aggregation, duplicate directories | Resolved | `task-description.md:112,114-115,121` separates local profiles from verified quota identity, requires same-real-account aggregation across directories, separates proven distinct identities, and leaves unknown identity unknown. Duplicate canonical directories cannot be presented as isolated accounts. `parity-inventory.md:48-51,54` applies the same rule to owner resolution and dashboard tiles, including Codex Phase 2. Directory uniqueness is an isolation check, not evidence of distinct real accounts. |
| R4 — Resume lifecycle and legacy records | Resolved | `task-description.md:113` covers stable profile id, label rename, selection/default changes, directory retargeting, missing/deleted/unavailable bindings, historical ambient routing for legacy unbound records, and sign-out/external reauthentication. Different or unprovable bound identity fails visibly rather than silently rebinding. `:124,173` supplies action and regression outcomes. `parity-inventory.md:22,38-39` carries run and persisted-session binding forward; a new default cannot capture an old conversation. Storage/comparison mechanics remain architecture work, not a requirements blocker. |
| R5 — Actual effective directory versus empty native-auth object | Resolved | `task-description.md:111,118,171,190` preserves each runner's existing effective default separately, including a preconfigured directory on paths that already honor it. It distinguishes no injected credential from selected-directory metadata and forbids foreign-route token/base-URL replacement. `parity-inventory.md:35-37` explicitly distinguishes the native-auth result, safe-env allowlist, and one-shot inheritance. The universal `~/.claude` inference has been removed. |
| R6 — Model/effort and honest runner capability parity | Resolved | `task-description.md:125-126` requires actual messaging/permission/MCP/resume declarations, explicit supported model/effort forwarding, existing omitted-value defaults and precedence, truthful unsupported values, existing unsupported-effort ignore behaviour, and no extension of `modelTier` to standard CLI lanes. `:117,174` preserves other lanes and native-provider behaviour. `parity-inventory.md:19,23-25` carries adapter and public-tool contracts into verification without demanding a new protocol or speculative steer support. |
| R7 — Dependent-host verification | Resolved | `task-description.md:131-133,180` requires preserved default runs on dependent hosts and scoped typechecks/tests for changed projects plus each affected dependent host. `parity-inventory.md:66` repeats the full verification scope and concurrency caps. This now carries `CLAUDE.md:23-30` and `:8-15` through to implementers: Electron-first feature/visual work, no TUI/VS Code polish, host compatibility, Nx `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time, no workspace-wide checks or unauthorized build/serve/dev/e2e/package. No checks were run in this review. |

## Targeted source cross-checks

These reads confirm the material factual corrections without executing any provider action:

- **Verified:** `libs/backend/agent-sdk/src/lib/helpers/build-safe-env.ts:46-85` forwards home/XDG variables and spreads the supplied auth environment; it does not independently forward ambient `CLAUDE_CONFIG_DIR`. The revised per-path preservation requirement is accurate; adding selected-directory metadata is not equivalent to inheriting arbitrary host credentials.
- **Verified:** `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:600-615` starts the one-shot environment with `process.env`; provider-identity clearing is conditional on `input.auth`. This supports preserving this path's preconfigured directory separately from the safe-env path. It does not establish live credential-store isolation.
- **Verified:** `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1542-1551` returns the empty native-auth object. Its ambient-directory comment does not prove a universal default across runners, exactly as the revision now states.
- **Verified:** `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:518-546` keys Claude ownership from email plus organization and uses route-keyed unknown identity when email is absent. `:549-575` resolves Codex ownership through the current home/account-usage service. Neither function makes local profile labels distinct billing owners.
- **Verified:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:697-716,732-737` states omitted model uses the configured default, `modelTier` applies only to Ptah CLI providers, explicit effort wins over settings/chat effort, and unsupported effort is ignored. Revision-1 criterion 18 preserves these contracts.

## Contradiction and completeness check

No new blocking contradiction was found between the two revised artifacts and the supplied intent.

- **Usage failure versus resume refusal are separate boundaries.** `task-description.md:114` lets a usage/account-info read fail to unknown without failing an otherwise valid run; `:113` requires visible refusal when continuation cannot establish the bound identity. An unknown quota owner must not become permission to rebind a resumed conversation. Both requirements can be satisfied without choosing persistence or validation machinery in this review.
- **In-flight preservation is not a promise that revoked credentials remain usable.** `task-description.md:116,124` preserves the run's original binding; it does not authorize switching to another identity to keep work alive. Provider/authentication failure must not be disguised as successful account continuity.
- **Legacy migration is a compatibility route, not reassignment.** `task-description.md:113` and `parity-inventory.md:39` preserve historical ambient routing for unbound records instead of adopting a new named default. The same criterion prohibits silent continuation under a different/unprovable identity; historical routing is not an exception to that safety rule.
- **Codex default preservation and Phase 2 extension are consistent.** `task-description.md:120-122` preserves the singleton-home route before Phase 2 and requires per-run home alignment and fail-closed handling of unverified shared stores in Phase 2. `parity-inventory.md:50-52` agrees. No claim of experimentally verified keyring/auto/ephemeral isolation is made.
- **Mocked sign-in remains product scope under a release hold.** `task-description.md:92-103,119,123-124` specifies the actions and mock verification while withholding disputed live enablement/release. Approval does not certify that any provider has authorized the flow.
- **No removals.** `parity-inventory.md:77-79` proposes none. Account actions augment rather than replace current provider screens (`:63`); preservation of other lane contracts is explicit (`task-description.md:117`). Any later removal or narrowed release still requires the user's decision.

Exact lane id, UI placement, runner adaptation, storage format, identity-comparison implementation, and isolation checks are subsequent design/architecture responsibilities. The observable contracts are now sufficiently specified; they are not reasons to withhold requirements approval or ask the user technical implementation questions.

## Remaining user-reserved release hold

`context.md:41-45` and `decisions.md:7-11,16-18` leave authorization unresolved. Technical specification and mocked implementation may proceed. Existing behaviour must be preserved. Neither prior behaviour, a local directory selection, nor this APPROVED verdict supplies provider approval.

Disputed subscription-authenticated enablement/onboarding/release stays held until the user records the necessary authorization evidence or explicitly decides a narrower release. The document also withholds separate clearance for new Codex subscription sign-in (`task-description.md:101`). This review neither adjudicates provider terms nor invents an approved policy exception. Scope reductions, removals, live authentication/inference, commits, pushes, and other outward actions are not authorized here. No user answer is required merely to accept these technical requirements.

## Review execution

Only this review file was overwritten. No agents were launched. No production source, credentials, credential stores, or `.env` files were edited or read. No authentication, logout, inference, tests, diagnostics/typechecks, builds, heavy checks, screenshots, git mutation, or user questions were performed. Later implementation must follow the scoped dependent-host verification and memory-safety rules above; document approval does not substitute for those checks.
