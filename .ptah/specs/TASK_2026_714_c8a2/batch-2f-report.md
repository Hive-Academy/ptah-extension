# Batch 2f report

Implemented the permission decision function and runtime-owned in-memory rule store. Production routing remains disabled; no entry points, registrations, existing contracts, other batches, or task state were changed.

## Files

Paths relative to `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`:

- `libs/backend/codex-runtime/src/lib/codex-permission-policy.ts`
- `libs/backend/codex-runtime/src/lib/codex-permission-policy.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-permission-rule-store.ts`
- `libs/backend/codex-runtime/src/lib/codex-permission-rule-store.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-2f-report.md`

## Level mapping

The pure `codexPermissionPolicy(level, kind, ruleStoreHit)` function is at `libs/backend/codex-runtime/src/lib/codex-permission-policy.ts:11`. Profile/wire configuration belongs to Batch 2e, not this function.

| Level | Command | File change | MCP elicitation | Permissions | User input | Required observed profile mapping (2e) |
| --- | --- | --- | --- | --- | --- | --- |
| ask | present | present | present | present | present | granular approvals, all five flags true; read-only; experimentalApi=true |
| plan | decline | decline | decline | decline | present | on-request; read-only |
| auto-edit | present | accept | present | present | present | on-request; workspace-write |
| yolo | accept | accept | accept | accept | present | on-request; workspace-write; full access remains unproved |

Table entries assume no rule hit. A hit returns `acceptForSession` for ordinary classes outside plan mode. Plan mode still declines, and user input always presents. The store intentionally cannot create permissions or question grants. Reads allowed by the sandbox do not reach this approval function. Plan-exit questions remain interactive; this batch does not implement plan transitions.

Mapping evidence: `batches.md` C2/C7 and Batch 2f, `implementation-plan.md:205-224`, `tools/evidence-harness.ts:973-1000`, and task `native-route-evidence.md` (scope/level/plan parity still unproved). C2 overrides the stale workspace-write ask row in the plan.

## Rule-store semantics

All line references in this section are to `libs/backend/codex-runtime/src/lib/codex-permission-rule-store.ts`.

- `:6`, `:25`: exact provider + normalized home + workspace + thread scope, serialized as a JSON tuple to prevent delimiter collisions. Empty identities fail closed. Identity normalization is the profile builder's responsibility; the store does not case-fold or reinterpret paths.
- `:16`, `:37`: explicit attributed targets. Commands require exact command text and cwd (no shell-prefix parsing). Files require the exact nonempty path set, order-independent, with no directory/glob/subset expansion. MCP grants require exact server and tool. Empty target fields fail closed.
- `:69`: only `acceptForSession` records a grant. Accept-once, decline and cancel do not add rules. Repeating a grant is idempotent. Caller data is snapshotted into keys, never retained by reference.
- `:84`: matching is local and synchronous. A matching rule can answer a later request, across turns and process generations, in its exact scope. The file/tool rules are Ptah-side grants, not a claim that Codex's native acceptForSession grants broader scope.
- `:98`: `clear(scope)` removes every target for exactly that scope, preserving other scopes. An explicit subsequent grant may recreate it.
- `:103`: host `dispose()` clears all grants and permanently disables that instance. A fresh host/store starts empty. Retain the same instance on child restart; no process object, timer, persistence, or SDK-private rule store is involved.
- `:10`, `:58`: the bridge must supply validated attribution, reject stale responses, and record only live replies. It must not infer an MCP tool from elicitation prose or turn arbitrary elicitation into remembered tool approval. Unattributed actions remain interactive. Batch 2g owns protocol decisions and lifecycle; native scope correctness remains an unproved gate.

## Specs

- `codex-permission-policy.spec.ts`: 8 tests covering all five request kinds at all four levels, with and without a rule hit; question interactivity; plan precedence; auto-edit isolation.
- `codex-permission-rule-store.spec.ts`: 28 tests covering grants versus other decisions; provider/home/workspace/thread isolation; command/cwd/kind isolation; exact file sets; MCP server/tool isolation; process restart retention and fresh-host clearing; scoped clear; permanent/idempotent disposal; mutable caller data; delimiter collisions; empty scope/target rejection; policy integration.

## Verification

Ran the required checks in order, with PowerShell's `Select-Object -Last` / `Select-String` equivalents of tail/grep. No build, install, e2e, workspace-wide verification, or git commands ran.

1. Scoped `ptah_get_diagnostics` on the four source/spec files: TypeScript compiler source, clean coverage, **0 errors, 0 warnings**.
2. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-permission-policy.spec.ts libs/backend/codex-runtime/src/lib/codex-permission-rule-store.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20; exit $LASTEXITCODE`
   - Exit **0**. **2 suites passed; 36 tests passed; 0 snapshots; 3.965 s**.
   - Node emitted a Jest config ES-module loading warning; Jest completed successfully.
3. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 10; exit $LASTEXITCODE`
   - Exit **1**. `5 problems (1 error, 4 warnings)`; Nx reported the combined targets failed.
   - Error: `49:7 Expected a 'break' statement before 'case' no-fallthrough`. The corresponding case/comment is in parallel Batch 2h's `libs/backend/codex-runtime/src/lib/codex-event-translator.ts:49`. Left untouched as instructed.
   - Filtered output also included `1737:7` warning `preserve-caught-error`; the filename and other warning details were excluded by the required filter. The filter does not establish an independent Nx typecheck outcome; scoped diagnostics above were clean. The failed suite was not rerun merely to recover output.
4. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-permission-policy.ts libs/backend/codex-runtime/src/lib/codex-permission-policy.spec.ts libs/backend/codex-runtime/src/lib/codex-permission-rule-store.ts libs/backend/codex-runtime/src/lib/codex-permission-rule-store.spec.ts`
   - Exit **0**, all four files formatted (rule-store implementation unchanged). No behavioral edits followed verification.

`ptah_search_files` returned no directory instruction files; native fallback found no applicable additional instructions. Root CLAUDE.md's scoped verification and worker ownership conventions were followed; explicit task instructions override its general git workflow. Existing Batch 2a contracts/ports/tokens and Batch 2b validator/spec conventions were inspected; only the needed Batch 2a types are imported. No validator duplication or new DI layer was needed for these pure/local units.

## Decisions

1. **Exact action matching, no command-prefix or directory expansion.** Options: parse broad command/file scopes, or require exact command+cwd/file set. Chose exact matching because C3 and native-route evidence leave broader native scope correctness unproved. MCP uses explicit server+tool attribution as the batch requires. Reversible: matching can be expanded after reviewed evidence and tests; no persisted format exists.
2. **Include thread in every scope.** Options: provider/home/workspace-only lifetime, or thread-isolated lifetime. Chose thread isolation because settled C3 explicitly names thread. Process generation/turn are excluded to preserve child-restart and later-turn grants. Reversible through a deliberate contract change; current grants are ephemeral.
3. **Plan declines effect-bearing requests even on rule hits.** Options: prompt, or decline until the caller explicitly transitions out of plan. Chose decline because plan is read/planning-only and the batch forbids auto-authorizing writes. Safe reads proceed under the sandbox; questions remain present. Reversible in this function after the plan-transition contract is proved.
4. **No reusable permissions grants or generic elicitation grants.** Options: broad permission payload matching, or store only attributable command/file/tool targets. Chose the narrower store because this batch only specifies those targets and permissions can widen capabilities. The policy still supports ordinary permission decisions; unsupported remembered scopes produce no store hit. Reversible by adding an evidence-backed target shape.
5. **Plain exported function and runtime-owned class.** Options: add registration/abstraction or use direct pure/local units. Chose the latter per Batch 2f and repository simplicity rules; composition belongs to 2k and is outside ownership. Reversible without changing permission behavior.

Remaining integration: Batch 2g must connect validated request targets and live replies; runtime composition must retain/dispose this store correctly. This batch's unit results do not establish native Always Allow parity and do not enable routing.
