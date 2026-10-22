# Decisions

| ID | Decision | Basis | Classification |
| D1 | FEATURE / Full workflow | New lane exposure, account state, cross-layer runtime and UI | project-rule |
| D2 | Isolated feat/provider-accounts worktree from main | CLAUDE.md | project-rule |
| D3 | Lanes enabled, lane-review document approvals; independent cross-side reviewers | Memory and available Grok/Glm lanes; orchestration Gate 0.1 | project-rule |
| D4 | Claude first, Codex next; preserve defaults and existing integrations | User request and follow-up implementation request | user-requested |
| D5 | Prefer SDK reuse for first-class Claude lane | T3 source and existing Ptah SDK lane path; architect must verify suitability | proposal |
| D6 | No shadow homes, automatic account rotation, credential copying or cross-account resume | Smallest isolated implementation; no user requirement for these behaviors | proposal |
| D7 | Do not infer Anthropic approval; raise release/onboarding decision if required | Official Agent SDK authentication restriction | unresolved-user-reserved |
| D8 | No commit/push, real credential operations or paid inference probes authorized | No explicit user request for these actions | project-rule |
| D8a (2026-10-22, supersedes the commit/push part of D8) | Commit verified batches on `feat/provider-accounts` (never `main`), push, open a draft PR; CI and the pre-push hook are the host test gate. Credential operations and paid probes stay unauthorized. | User: "continue the proper orchestration workflow and fix any issues"; global CLAUDE.md lanes-first rule (CI checks, no local typecheck/test before push) and no-orphaned-branch rule | user |
| D10 (2026-10-22) | Host `marked` failures root cause: worktree had no `node_modules`; `jest.preset.js:31` maps `marked` to `<worktree>/node_modules/...`. Fixed with a git-ignored junction `node_modules` → main checkout `node_modules` (same lockfile, last change `8be217319` on both). Missing `dist` artifacts are build-dependent test targets; disposed to CI per D8a. | Investigation of verification-batch-01-*-test-direct.log and jest.preset.js | orchestration-decision |
| D11 (2026-10-22) | Accept Batch 1 on passing shared checks (B01-V2) and Batch 2 on source inspection (declaration-only, type-only exports, two `Symbol.for` tokens); host gates delegated to CI per D8a. Phase P1-A code review remains at Batch 7. | B01-V2 checkpoint; AST of provider-account-admission.port.ts | orchestration-decision |
| D9 | Initial PM author on Grok, independent in-process document review | Available lane with confirmed room; user lanes-first preference | orchestration-decision |

## Requirements revision 1

The independent requirements review returned REVISE for R1–R7. Grok is revising the two requirements artifacts; Gate 1 remains pending. Restore account add/status/sign-in/out as requested scope, separating product functionality from unauthorized live verification. Distinguish profile selection from authenticated quota ownership and specify resume lifecycle, effective directories, model/effort parity, and dependent-host checks. These are evidence-backed requirements corrections, not approved removals.

Provider approval remains unresolved. Continue technical specification and mocked implementation without treating either as permission to enable or release disputed subscription onboarding. Preserve existing behavior. No licensing decision, live authentication, inference, or reduced-scope release is authorized by this continuation.

## Gate 1 outcome

Requirements revision 1 APPROVED by independent in-process software-architect reviewer after Grok CLI authorship (cross-side, lane-review mode). R1–R7 resolved; no technical requirements blockers. Gate 1 passes to Electron design/prototype, not production implementation or release. Subscription enablement/release authorization remains unresolved. No removals approved.

## Gate 1.7 outcome

Design revision 2 APPROVED by Grok CLI reviewer after in-process ui-ux-designer authorship (cross-side, lane-review mode). Both remaining blockers and associated source corrections verified; advance to architecture. This is source-level technical design approval only. Rendered Electron dark/light, focus and viewport evidence remains pending, as does subscription enablement/release authorization. No removals approved. Design used its two allowed revision pairs.

## Gate 2 outcome

Architecture revision 1 APPROVED by Grok CLI reviewer after in-process software-architect authorship (cross-side, lane-review mode). B1 final child-environment application and B2 preserved SDK execution/prompt-admission contracts are closed at plan level. Advance to team-leader decomposition and bounded technical implementation. Subscription enablement/release, A1–A4 installed-runtime compatibility, abandoned reservation recovery limitations, and rendered Electron evidence remain open as recorded in implementation-plan-review.md. No release, removals, live authentication/inference, commits or pushes authorized.

## Review budget
Each document gets one initial cross-side review and at most two author/reviewer revision pairs. No proposed removal can be approved by reviewer alone. Announce implementation batch budget after architecture establishes batch count.

## SEQ-B02 — bounded declaration-only sequencing exception

- **Decision / verdict:** ALLOW SEQUENCING ONLY for Batch 2's existing three-file backend token/admission-contract seam before Batch 1 acceptance. No executor is dispatched by this advisory; Batch 2 / Task 2.1 remain PENDING until the orchestrator assigns them. Batch 1 / Task 1.1 stay IN_PROGRESS, B01-V2 stays NOT ACCEPTED, acceptance remains OPEN and COMPLETE count stays 0/43.
- **Options:** (1) hold all dependent implementation until host remediation; (2) allow only the additive declaration/token seam while preserving every acceptance gate. Choose (2), not general pipelining: no runtime consumer, registration or host change is needed for the actual Batch 2 definition. Nothing here authorizes Batch 3–43 or further runtime work.
- **Evidence:** batches.md B01-V2 records fresh corrected shared typecheck/lint, 122 suites / 3748 passing tests and clean scoped diagnostics. implementation-report-batch-01.md documents the five-file correction, not host acceptance. host-verification-disposition.md:76–94 expressly distinguishes a possible sequencing-only exception from gate acceptance. Existing auth-providers-tokens src/lib/tokens.ts contains identifiers using Symbol.for; src/index.ts exports tokens/types, not service registration. project.json:18–23 defines typecheck via `tsc --noEmit --project libs/backend/auth-providers-tokens/tsconfig.lib.json`, with no build prerequisite or lint/test targets. nx.json:24–63 does not add a typecheck build dependency. No fresh verification was run for this decision.
- **Exact writable code ownership:** CREATE `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/lib/tokens.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/index.ts`. No other production/config/spec ownership is granted.
- **Boundary:** closed readonly backend route/resource types, admission/action interfaces, type-only imports/exports and token identifiers only. Existing token-constant evaluation is allowed, not an executable admission implementation or service wiring. No runtime registration/resolution, SDK/host consumer, env application, persistence, auth operation, tuple activation, infrastructure/dependency change or Batch 1 source edit. Structural route typing does not confer admission. Extra files or runtime behavior require stopping, not scope expansion.
- **Eventual commands, not executed here:** interim `npx nx typecheck @ptah-extension/auth-providers-tokens --parallel=1`, plus scoped diagnostics on the three owned absolute paths; record an interim declaration checkpoint only. Full acceptance remains `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers-tokens') -Hosts $H` from batches.md, retaining the explicit five-host typecheck/lint/test obligations. Builds required by four host test targets remain forbidden without separate authorization; do not execute those targets indirectly or treat direct-Jest diagnostics as equivalent passes. No invented token lint/test target.
- **Unresolved holds / stop:** historical host failures are unchanged-source/infrastructure observations, not baseline-proven, waived or passed. Batch 1 host disposition/remediation and required passing affected-host verification must be resolved before Batch 2 COMPLETE or P1-A foundation acceptance. Release/subscription enablement, A1–A4 compatibility, abandoned reservation limitations and rendered Electron dark/light evidence remain unresolved. No gate waiver, release claim, install/build/baseline authorization, credential/.env read, live auth/inference, external action, user question or git mutation is granted. Electron first; no TUI/VSCode polish. Future checks must be changed/affected scoped only, Nx --parallel=1, Jest --maxWorkers=2 and one heavy check across all lanes.
- **Reversible / handoff:** yes; return to hold on shared-input drift, scope expansion or token check failure. Orchestrator may assign one eligible contracts-capable lane with the exact Batch 2 ownership, mandatory lane rules and SEQ-B02 boundary from batches.md; no spawn in this advisory. Return after Batch 2 for team-leader verification and host-blocker disposition, not automatic next-batch dispatch. The exception expires at that declaration checkpoint and grants no further sequencing entitlement.

## P1-A interim review disposition (2026-10-22)

- Reviewer: Codex (OpenAI) on Grok (xAI) Batches 1–2; `code-logic-review-batch-01-02.md`, REVISE with 0 Blocking, 0 Serious, 2 Moderate, 1 Minor. Lean rule 4 applied; no fix round.
- R1 (Moderate, safe-text predicate accepts credential-shaped text): deferred to Batch 6, whose action results come from official CLI output; Batch 6 acceptance now includes "result text never passes raw or credential-shaped dependency output; only closed codes map to safe sentences".
- R2 (Moderate, `export *` in shared main barrel): no change. Orchestrator brief said "type-only"; batches.md:105 requires Zod-free, which holds, and matches repository convention.
- R3 (Minor, numeric/strict-union regression cases): recorded; add when Batch 25 touches the schemas.
- Full P1-A phase review remains at Batch 7.
