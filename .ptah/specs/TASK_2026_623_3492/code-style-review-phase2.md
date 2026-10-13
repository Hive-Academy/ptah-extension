# Code Style Review — `TASK_2026_623_3492` Phase 2

## Summary

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| Blocking / Serious / Moderate / Minor findings | 0 / 0 / 0 / 0 |
| Scope | Combined diff `f0d5df3a4..c8c137611` (Batches 7–12), 22 files |

The change is structurally consistent with the established RPC-handler and host-profile patterns. It introduces the shared contract, handler, capability, manifest registration, host exclusion assertions, formatter export, and focused tests as one coherent vertical slice. The score is sound rather than exemplary because the public formatter still exposes positional `string[]` cells, a deliberate pre-existing formatter shape retained by the agreed D13 design rather than a new defect. It is above 7 because the contract, public barrels, capability boundary, DI registration, and negative-host coverage are all explicit and tested; it is below 9 because that positional public shape leaves future consumers coupled to undocumented indexes beyond the inline cells documentation.

## Findings

No Blocking, Serious, Moderate, or Minor style findings.

## Five style questions

### 1. What breaks when requirements change in six months?

The main maintenance seam is the deliberately shared positional formatter result: a changed cell order would require coordinated updates to both `formatPlanLimitsSection` and the RPC projection in `lane-plan-limits-rpc.handlers.ts:89`, whose `toRow` maps indexes 0–4 (`lane-plan-limits-rpc.handlers.ts:136-144`). This is contained by the single implementation and explicit parity tests (`agent-limit.formatter.spec.ts:563-570`; `lane-plan-limits-rpc.handlers.spec.ts:330-342`), so it is documented maintenance cost, not an approval-blocking split.

### 2. What would a new team member misread?

They could mistake this for a general provider quota endpoint. The narrow shared result prevents that: it is a closed display-text/count contract (`rpc-lane-plan-limits.types.ts:35-69`), while the registry names the distinct `agent:getLanePlanLimits` method (`rpc.types.ts:1374-1383`). The contract tests also pin that `provider:getPlanLimits` remains unchanged (`rpc-lane-plan-limits.contract.spec.ts:146-155`).

### 3. What does this cost to maintain that a simpler shape would not?

The capability and expected-absent lists require edits in each host-facing assertion, but that cost buys an auditable Electron-only boundary: the capability defaults false (`host-profile.ts:67-97`), Electron opts in (`apps/ptah-electron/src/rpc-host-profile.ts:46-49`), and VS Code/CLI explicitly assert exclusion (`apps/ptah-extension-vscode/src/di/expected-absent.ts:57-80`; `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts:28-30`). A simpler unconditional registration would weaken that boundary.

### 4. Where is this inconsistent with how the same problem is solved elsewhere in the repo?

No material inconsistency found. `LanePlanLimitsRpcHandlers` follows the sibling handler form: `@injectable`, `static METHODS`, constructor token injection, `registerMethod`, and a strict Zod schema (`lane-plan-limits-rpc.handlers.ts:26-84`; compare `boot-rpc.handlers.ts:28-67` and `boot-rpc.schema.ts:12-18`). Manifest gating follows diagnostics consent (`manifest.ts:465-476` versus `manifest.ts:459-468`). Public exports go through both handler and package barrels (`handlers/index.ts:12-13`; `index.ts:57-67`).

### 5. What would you have done differently, and why is that better rather than merely other?

For a fresh API, a named readonly row-cell tuple or a formatter-specific row interface would make index coupling impossible. Here, changing it would broaden the intentional public API and duplicate the list’s existing six-cell representation; keeping `formatPlanLimitRows` as the shared source is better for this change because it guarantees byte-level text parity (`agent-limit.formatter.ts:226-245`) and matches the agreed D13 contract. No change recommended.

## Pattern compliance

| Repository convention | Status | Evidence and impact |
| --- | --- | --- |
| Cross-library imports use package barrels; types use `import type` | PASS | The handler imports shared, core, and LM-tools only by package aliases and marks type-only imports (`lane-plan-limits-rpc.handlers.ts:27-40`); its only relative import is its local schema (`:41`). This preserves Nx/library boundaries. |
| RPC input is validated at the handler boundary | PASS | A strict empty Zod object is defined in `lane-plan-limits-rpc.schema.ts:10-14` and parsed before API construction (`lane-plan-limits-rpc.handlers.ts:75-86`), preventing an undocumented `refresh` contract. |
| Handler DI and logging use local conventions | PASS | `@injectable`, `TOKENS` injection, `RpcHandler`, and injected `Logger` match the boot sibling (`lane-plan-limits-rpc.handlers.ts:48-73`; `boot-rpc.handlers.ts:41-67`). Logs retain only error type, not row/identity data (`lane-plan-limits-rpc.handlers.ts:108-126`). |
| Electron-only functionality is capability-gated in the manifest | PASS | `lanePlanLimits` is a total capability with safe false default (`capabilities.ts:80-87`; `host-profile.ts:67-97`) and its manifest entry is gated (`manifest.ts:469-477`). Electron alone enables it (`apps/ptah-electron/src/rpc-host-profile.ts:46-49`). |
| Public API is minimal and barrel-exported | PASS | The requested formatter/type and handler exports are explicit (`vscode-lm-tools/src/index.ts:20-25`; `rpc-handlers/src/index.ts:57-67`), with no deep consumer import added. |
| Shared RPC type precision and privacy | PASS | Closed readonly response shapes live in their dedicated contract file (`rpc-lane-plan-limits.types.ts:35-69`); registry and runtime/compile-time contract tests pin exact fields and no identity forwarding (`rpc.types.ts:1374-1383`; `rpc-lane-plan-limits.contract.spec.ts:84-155`). |

## Decisions

- Decisions #41–#43 support the extra default-capability and host-exclusion edits as necessary structural wiring, not scope drift (`decisions.md:45-47`).
- Decision #42 expressly accepts the fixed plain `Error` unavailable boundary and cause removal; this review found its injected logger and fixed-text behavior consistent with that decision (`lane-plan-limits-rpc.handlers.ts:114-125`).
- Decision #44 records scoped diagnostics/typecheck evidence for sibling diagnostic noise. No tests, lint, typecheck, build, Nx command, or diagnostic tool was run in this review, per the task instruction.

## Verdict

APPROVED. The implementation is cohesive, follows the nearest RPC handler/schema/manifest conventions, keeps public exports intentional, and makes the Electron-only boundary explicit. Review confidence: high for style and structure; runtime behavior was intentionally out of scope.
