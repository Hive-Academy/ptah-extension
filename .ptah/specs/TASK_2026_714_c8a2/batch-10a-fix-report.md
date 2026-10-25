# Batch 10a fix report — revise round 1

Implemented findings 6 and 7 and the zero-turn-limit minor. Only the lane profile and its colocated spec changed. Lane events, legacy files, interfaces, registrations, codex-runtime, and gateway-chat-bridge were not edited. No git commands or real Codex process were run.

## Findings and evidence

Paths below are relative to `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/`.

- **6 — explicit permission policy:** `codex-lane-profile.ts:20` makes `permissionLevel` required; `:64` throws if an untyped caller omits it; `:98` passes the supplied value without a default. `codex-lane-profile.spec.ts:66` covers both the compile-time contract (`@ts-expect-error`) and runtime refusal. Existing policy tests at `:173` and `:228` cover explicitly supplied ask/plan/auto-edit/yolo. Batch 10b must choose its policy and supply its approval handling; this batch does not choose a production permission level.
- **7 — requirements cannot be silently discarded:** `codex-lane-profile.ts:41` adds a private unique-symbol brand to the single result object. The `settings` getter at `:151` throws until `assertAllRequirementsHandled` (`:161`) has received every present requirement key. Missing keys are listed in the error; partial acknowledgement does not expose settings. The requirement object and its server-name array are frozen at `:136`. Contract documentation at `:49` requires 10b to enforce requirements and call the assertion before opening a context. Specs at `codex-lane-profile.spec.ts:75`, `:86`, and `:96` cover blocked settings access, each of the ten missing keys individually, frozen requirements, and optional absent keys. The helper is an acknowledgement contract, not an implementation of the unsupported features.
- **7 — actual core refusal:** `codex-lane-profile.spec.ts:122` calls the real public `CodexRuntime.open` API with the built lane execution profile. With and without Ptah MCP attachment, non-empty suppression remains and open rejects with `Codex profile requires unsupported runtime configuration`. Dependency getters throw if the runtime touches process or other infrastructure; the spec asserts none were accessed. No Codex binary can spawn. This exercises the existing guard in `libs/backend/codex-runtime/src/lib/codex-runtime.ts:87` without copying its refusal logic.
- **Minor — consistent zero omission:** `codex-lane-profile.ts:127` omits both `0` and `-0` turn limits, matching money/token zero omission. `codex-lane-profile.spec.ts:248` verifies all zero limits are absent, suppression remains, and the core profile builder accepts the settings. Positive limits remain covered at `:294`.

## Verification

All commands ran from `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`. PowerShell filters below are the equivalents of the requested tail/grep filters. Checks were sequential, scoped, and each command was executed once.

1. Formatting, exit 0:

```powershell
npx prettier --write libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.spec.ts
```

2. `ptah_get_diagnostics`, scoped to the two changed absolute source/spec paths: typescript-compiler, clean coverage, 0 errors, 0 warnings.

3. Focused Jest, exit 0: **2 suites, 57 tests passed**. The existing jest.config.ts ESM-loading warning appeared but did not prevent success.

```powershell
npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20; exit $LASTEXITCODE
```

4. Typecheck and lint, exit 0: `Successfully ran targets typecheck, lint for project @ptah-extension/cli-agent-runtime`; **51 warnings, 0 errors**. The running shell command needed two output checks because the first returned before completion; it was not rerun.

```powershell
npx nx run-many -t typecheck lint -p @ptah-extension/cli-agent-runtime --parallel=1 --output-style=static 2>&1 | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 10; exit $LASTEXITCODE
```

5. Degradation audit, exit 0, no FAIL; `degradation-audit: TOTAL 276 unsuppressed site(s)`.

```powershell
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String -Pattern 'FAIL|TOTAL'; exit $LASTEXITCODE
```

The filtered audit output establishes the requested ratchet result, not per-file coverage. The earlier batch report documented a scanner directory-coverage limitation; no audit baseline was modified.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Require caller-selected permission without a default | Keep ask default; require caller choice | Finding 6; explicit task instruction; core supports four permission levels | Yes, but no default should return without an approved policy |
| Brand the result and gate settings behind complete requirement acknowledgement | Documentation alone; brand/helper alone; guarded settings plus helper | Finding 7; core settings lack requirement fields; batch 10b is the integration owner | Yes, local profile contract can evolve with proven core support |
| Exercise actual public runtime refusal using fail-on-access dependency getters | Duplicate refusal logic; real binary; public runtime with inert dependencies | Core open rejects unsupported configuration before consuming process dependencies | Yes, test fixture only |
| Keep shared legacy rules in place | Extract a shared module; leave existing implementations | Explicit batch ownership and instruction prohibit deduplication here | Yes, separate follow-up |

**Runtime import disclosure:** the spec adds the value import `CodexRuntime` from `@ptah-extension/codex-runtime` alongside the existing `buildCodexExecutionProfile` value import. The production profile still imports only a type from codex-runtime. No package dependency or registration changed.

## Follow-ups

- Batch 10b must supply an explicit permission level, implement each present requirement, and call `assertAllRequirementsHandled` with only keys it actually enforces before reading settings/building/opening a context. Do not acknowledge all keys mechanically in production. The spec's exhaustive acknowledgement is fixture setup only.
- Today's core still refuses lane suppression/MCP configuration; acknowledgement intentionally does not make native lanes runnable. Future core support and parity evidence remain prerequisites for enabling lanes.
- Deduplicate legacy token-validation/role-resend rules only in a separately owned batch after checking both consumers' contracts. No new shared module was added.
- The separate event-serialization observation in review minor 9 was not part of this requested profile fix; lane events were left unchanged and their existing suite passed.
