# Code logic review: 10d.C / 10d.V, revision 2

Review family: codex (same family as implementer, user-approved; weaker evidence)
Implementer family: codex

## Scope and evidence

Read the round-1 review, round-2 task and both reports; the shared helper and full spec; both host composition files and their specs; the runtime registration, runtime constructor and binary verifier; and the common rules and root instructions. `git status --short` confirms the host files and helper are untracked, so a tracked diff alone would omit them. The Ptah symbol index returned zero hits for `CodexRuntime`; native `rg` failed with access denied, so `Select-String` located its constructor. No skill loader was listed. No tests, verification, typecheck, lint, build, Nx, npm, or diagnostics were run, as expressly prohibited. The coordinator's two earlier failures are inputs, not rerun results.

## Round-1 findings and coordinator failures

| Item | Status | File:line evidence and assessment |
| --- | --- | --- |
| 1. Moderate: default and `readVersion` calls collide | **fixed** | `libs/backend/codex-runtime/src/lib/codex-executable-inspection.ts:29-36,112-142` keeps one digest but distinct default and callback-identity result promises. Both call orders and two callbacks are checked at `codex-executable-inspection.spec.ts:60-95`; a failed callback is retried at `:97-109`. |
| 2. Minor: realpath cache grows without bound | **fixed** | Helper `:39-40,98-104` caps the map at eight realpaths and removes the oldest insertion. The nine-path regression case is at `codex-executable-inspection.spec.ts:199-210`. An evicted in-flight digest remains owned by its caller, with a rejection handler at helper `:105-109`. |
| 3. Minor: VS Code port test cannot detect pin substitution | **fixed** | `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:213-227` overrides the measured digest with a value different from the fixture pin and inspects the runtime's binary port. Substituting the pin digest in `open()` would fail this assertion; source passes `inspected.sha256` at `codex-lane-runtime-composition.ts:185-188`. |
| 4. Minor: missing degradation-audit annotations | **fixed** | Both helper rejection cleanup handlers are annotated at `codex-executable-inspection.ts:106,135`; CLI failed-open cleanup is annotated at `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:265-270`. The original rejection remains visible in each case. |
| (a) Cross-realm `expect.any(Error)` failure | **fixed in source/spec; execution pending** | `codex-executable-inspection.spec.ts:168-181` matches `cause.code` or `cause.message` without relying on an Error realm. The helper preserves `{ cause }` through `super` at `codex-executable-inspection.ts:18-25,67-72`. |
| (b) TS2683 implicit `this` in CLI spec | **fixed in source; typecheck pending** | `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts:431-435` declares `this: CodexRuntime` and reads the runtime's `options` through bracket access. `codex-runtime.ts:46-52` defines that member, and `di/registration.ts:62-64` constructs the instance from the registered ports. No `any` cast or suppression was added. |

## New defects

None found in the round-2 changes. The cache key still contains realpath, size, modification time, pin digest and pin version (`codex-executable-inspection.ts:75-81`); one digest promise is shared per key (`:82-100`) and separate mode promises are shared at `:112-117,133-134`. The `void digest.catch` and `void promise.catch` handlers resolve their derived promises, while the original promises returned to callers remain rejected (`:105-109,135-143`); they neither conceal failure nor create an unhandled derived rejection. A source scan of the five changed files found no TypeScript `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`; `expect.any(Object)` in the VS Code spec is a Jest matcher. No MCP path was removed: both host profiles still carry `userMcpServerNames` (`cli-engine/.../codex-lane-runtime-composition.ts:152`; VS Code `codex-lane-runtime-composition.ts:142`), and their adapters still use the selected home (`CLI :273-275`; VS Code `:242-245`).

## Five logic questions

1. **Silent failure:** A failed digest or callback is evicted and rethrown to the inspector caller (`codex-executable-inspection.ts:105-109,135-143`); no new silent-success path was found.
2. **Unexpected user action:** A CLI explicit executable with a different realpath is refused before inspection (`cli-engine/.../codex-lane-runtime-composition.ts:160-166`); VS Code also compares its explicit path in the probe (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:149-155`).
3. **Wrong input answer:** Mixed default/callback calls now receive their own version outputs (`codex-executable-inspection.ts:112-131`); changed size or mtime creates a new key (`:75-83`). The requested key does not detect a same-size, same-mtime replacement; that is an existing cache-contract limit, not a round-2 regression.
4. **Dependency failure:** Missing pin/file and digest mismatch reject before a lane scope is opened (`codex-executable-inspection.ts:48-72,84-96`; CLI `:202-210`; VS Code `:182-213`). Cleanup failure is logged while the open error is rethrown (CLI `:262-270`; VS Code `:231-239`).
5. **Unstated case:** A stream failure after successful `stat` still propagates a raw filesystem error (`codex-executable-inspection.ts:84-88`). It fails closed; precise error recoding remains outside this round's requested fix. TUI startup coverage and the adapter's class-only log remain the deferred round-1 follow-ups.

## Scores and verdicts

| Batch | Score | Verdict | Basis |
| --- | --- | --- | --- |
| 10d.C | **8/10** | **APPROVED** | The shared cache contract and CLI test compilation issue are corrected in source, and the measured digest remains wired into runtime ports (`cli-engine/.../codex-lane-runtime-composition.ts:227-232`). Below 9 because C-3 adapter logging and TUI startup coverage remain deferred, and execution checks were prohibited. Above 7 because the earlier open-identity failure is fixed and no round-2 regression was found. |
| 10d.V | **8/10** | **APPROVED** | The measured-digest assertion can now detect pin substitution (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:213-227`), and source still passes that digest (`codex-lane-runtime-composition.ts:185-188`). Below 9 because of same-family review, prohibited execution checks and the existing D27 development routing tradeoff; above 7 because no new logic failure was found. |

Confidence: **medium**. These are source-review verdicts; the coordinator must confirm the specs and typecheck on the changed projects. The helper spec uses `mkdtemp(tmpdir())`, `join` and cleanup (`codex-executable-inspection.spec.ts:22-39`); the host specs use temporary absolute paths and normalize home/workspace comparisons (`CLI spec :123-139,343-362`; VS Code spec `:61-96,238-244`), with no new Windows/Linux-specific assumption in round 2.

## Decisions

- **Approve both batches while leaving the prior scoped follow-ups with their owners.** Options: require another revision for C-3/TUI/D27, or accept the round-2 corrections. Evidence: this round's task names findings 1-4 and failures (a)/(b); the earlier review already deferred C-3 and D27. Reversible.
- **Retain the requested stat-based cache identity.** Options: broaden the key to inode/content or keep realpath/size/mtime/pin. The task specifies the latter (`task-10d-fix-A.md`, rule 3), and helper `:75-81` implements it. Reversible; same-size, same-mtime replacement remains a documented limit.
- **Treat the typed mock receiver as a source-level fix pending coordinator typecheck.** Options: inspect registered ports through a new seam or use `this: CodexRuntime`. The runtime constructor stores ports in `options` (`codex-runtime.ts:52`), and the spec now types its receiver (`CLI spec :431-433`). Reversible.
