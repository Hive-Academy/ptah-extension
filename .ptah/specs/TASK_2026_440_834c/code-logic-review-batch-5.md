# Code logic review — Batch 5

## Summary

| Item | Result |
|---|---:|
| Score | 9.0 / 10 |
| Verdict | **APPROVED WITH FIXES** |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 1 |
| Minor | 0 |

Batch 5's production logic is correct: the shared job spec prevents host drift, both hosts guard registration on the retention service, the handler resolves live collaborators per run and forwards the cron abort signal, failed reports use the scheduler's failure channel without exposing diagnostic text, and the daily-backup change preserves the established host-specific behaviour. The only finding is a missing CLI repeated-start reachability proof required by the review checklist.

## Findings

### MODERATE — CLI reachability specs do not prove repeated-start registration idempotency

- **Trigger:** Call `activateThoth(container, 'runtime', logger)` twice with the same container and handler registry.
- **Symptom:** Production has the correct `handlerRegistry.has(...)` guard, but the CLI test suite never exercises two runtime activations. Its default fake also returns `false` from `has()` forever, rather than reflecting prior `register()` calls. Consequently, the suite cannot prove that repeated starts register `memory:retention` once while upserting `@ptah/memory-retention` twice, and it would not catch removal or breakage of the `has()` guard.
- **Evidence:** `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:544` contains the production guard and `:550` performs the unconditional upsert. The fake registry is non-stateful at `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:109`. The retention registration test invokes `activateThoth` only once at `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:466` and expects one registration/one upsert at `:468-486`. By contrast, the Electron reachability test invokes `startThothCron` twice and asserts one registration/two upserts at `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts:881-896`.
- **Recommendation:** Add a CLI retention test that uses a stateful registry (or makes `has('memory:retention')` reflect the first registration), calls `activateThoth(..., 'runtime', ...)` twice, and asserts exactly one `memory:retention` registration and two exact retention upserts.

## Answers to checks 1–7

### 1. Reachability

**Production: pass. Specs: pass except for the CLI repeated-start gap above.**

- Electron returns early unless `MEMORY_RETENTION_SERVICE` is registered (`start-thoth-cron.ts:273-275`), registers behind `has()` (`:277-285`), and unconditionally upserts the exact shared job (`:287-294`). Its stateful reachability fixture is at `start-thoth-cron.spec.ts:797-840`; exact registration/upsert is asserted at `:848-858`; two starts → one registration/two upserts is asserted at `:881-896`; absence of the token is asserted at `:899-920`.
- CLI requires the job store, handler registry, and retention service (`cli-engine/src/lib/bootstrap/thoth-runtime.ts:532-538`), registers behind `has()` (`:540-549`), and unconditionally upserts the exact shared job (`:550-557`). Exact single-start registration/upsert is asserted at `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:462-487`; absence of the service is asserted at `:512-523`.
- Both host reachability suites retrieve the function received by `register`, invoke it with a fake context, and assert `service.run` was called once with the identical `ctx.signal`: Electron at `start-thoth-cron.spec.ts:860-878`, CLI at `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:489-509`.
- The Electron and CLI reachability-call specs would fail if registration were removed: each first requires the captured handler (`start-thoth-cron.spec.ts:865-866`; `cli-engine/.../thoth-runtime.spec.ts:494-501`). They would also fail if the handler stopped calling `service.run`, because each asserts a single call and the forwarded signal (`start-thoth-cron.spec.ts:872-875`; CLI spec `:503-506`).

### 2. Handler

**Pass.**

- The service is resolved inside every invocation and a service-resolution failure maps to `{ outcome: 'skipped', reason: 'retention-service-unavailable' }` (`memory-retention-job.ts:65-76`).
- The power monitor is resolved per run (`:78-80`). Its resolution failure remains unhandled, matching the skill-drain precedent at `start-thoth-cron.ts:68-80`; `JobRunner` therefore records a failed run. This is acceptable under the requested precedent.
- The optional foreground tracker is checked and resolved per run, `start()` is called, and the live reader is returned; absence maps to `Infinity` (`memory-retention-job.ts:81,113-125`). Presence/start/live-reader and absence are covered at `memory-retention-job.spec.ts:97-112` and `:189-200`.
- The cron signal and live gate readers are passed to `service.run` (`memory-retention-job.ts:83-87`), pinned by `memory-retention-job.spec.ts:97-112`.
- `skipped` maps to the scheduler's skipped outcome (`memory-retention-job.ts:89-91`); `completed` and `partial` map to the required summaries (`:97-103`); `failed` throws (`:92-95`). Mapping coverage is at `memory-retention-job.spec.ts:114-169`.
- The thrown failure message uses only `report.reason` (or the constant `unknown`) and never `report.error` (`memory-retention-job.ts:92-95`). The failed-report test injects path-bearing error text and proves it is absent from the thrown error (`memory-retention-job.spec.ts:151-169`). Current service failure reasons are controlled tokens (`memory-retention.service.ts:516-522`).

### 3. Boot safety

**Pass.**

- Host registration performs only dependency resolution, registry operations, and the one job-store upsert; it does not invoke the retention service or issue retention SQL (`start-thoth-cron.ts:266-298`; CLI `thoth-runtime.ts:528-566`).
- Cold-start catch-up can invoke the handler, but the service rejects work for ten minutes after construction (`memory-retention-config.ts:74-75`; `memory-retention.service.ts:265-267`). Thus a boot catch-up is a cheap `boot-deferred` skip rather than retention work.
- `17 * * * *` is fixed in the shared spec (`memory-retention-job.ts:39-45`). It avoids backup/nightly drain at `:00`, frequent drain at quarter hours, integrity at `03:30`, and weekly drain at `04:00` (`skill-drain-jobs.ts:43-65`; `start-thoth-cron.ts:120-129,417-424`).
- The handler adds no independent wait, retry, or post-processing around `await service.run(...)` (`memory-retention-job.ts:83-103`). The service's configured run budget is 60 seconds (`memory-retention-config.ts:54-58`) and is checked between bounded work steps (`memory-retention.service.ts:304-330,347-370,380-404,468-495`), so the handler does not extend its scheduler-slot occupancy beyond the service call.

### 4. Daily backup handler

**Pass.**

- Electron now calls `rotate('daily', KEEP_BY_KIND.daily)` and retains only `pragma('optimize')`; the fixed incremental vacuum block is gone (`start-thoth-cron.ts:372-412`). The spec asserts rotation with the daily value, absence of any incremental-vacuum pragma, exactly one pragma, optimize, and the unchanged success summary (`start-thoth-cron.spec.ts:152-166`).
- Electron's torn-down-connection behaviour remains intact: backup and rotation still run, no pragma runs, and the established `pragmas skipped: no sqlite connection` summary is returned (`start-thoth-cron.spec.ts:173-210`; production `start-thoth-cron.ts:390-396`).
- CLI retains its intentionally guard-free backup handler, uses `KEEP_BY_KIND.daily`, preserves rotation warning handling, and preserves both summary variants (`cli-engine/src/lib/bootstrap/thoth-runtime.ts:386-428`). Its new assertion pins backup and daily rotation (`cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:441-454`).
- Production grep found no `incremental_vacuum(100)`, `rotate('daily', 7)`, or `rotate('pre-migration', 3)` literals outside specs/docs.

### 5. CLI host

**Pass in production; one spec gap recorded above.**

- Registration is called immediately after skill-drain registration (`cli-engine/src/lib/bootstrap/thoth-runtime.ts:327-331`). It guards the store, registry, and retention service (`:532-538`), emits no activity event, uses the shared `MEMORY_RETENTION_JOB` and `createMemoryRetentionHandler` imports (`:23-29,544-557`), and warns non-fatally on failure (`:558-565`).
- The Electron host imports/uses the same job object and handler factory (`start-thoth-cron.ts:24-28,277-294`), preventing host drift while leaving host lifecycle and logging separate.
- The oneshot return occurs before runtime startup, and its test asserts no handler registration, job upsert, or retention run (`cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:525-534`).

### 6. Documentation, exports, and boundaries

**Pass.**

- The public barrel exports the shared value, factory, and type-only interface (`thoth-runtime/src/index.ts:21-27`).
- `thoth-runtime/CLAUDE.md` accurately describes ownership/public API (`:7-27`), daily-backup rotation/optimize behaviour (`:46`), the shared two-host retention job and failure channel (`:48`), and allowed cross-lib dependencies (`:54-56`).
- `thoth-runtime` imports the permitted `memory-curator`, `cron-scheduler`, and `skill-synthesis` packages (`memory-retention-job.ts:3-15`; `start-thoth-cron.ts:11-22`). No concrete `platform-vscode`, `platform-electron`, or `platform-cli` adapter import was found in `thoth-runtime` or `memory-curator`.
- No production import from `memory-curator` to `thoth-runtime` was found. The only text references describe the ownership direction in documentation/comments.

### 7. Other defects

No additional Batch 5 behavioural defect was located. The CLI fixture's pre-existing migration warnings during the passing Jest run and the unrelated lint warnings are not Batch 5 logic failures. In-flight changes under `persistence-sqlite`, `memory-curator` diagnostics, `shared`, and `rpc-handlers` were not attributed to Batch 5.

## Command output summary

Command run exactly as requested:

```text
npx nx run-many -t typecheck test lint -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine --parallel=1
```

- Exit code: **0**.
- Header: `NX Running targets typecheck, test, lint for 2 projects` and listed `@ptah-extension/thoth-runtime` plus `@ptah-extension/cli-engine`.
- Final line: `NX Successfully ran targets typecheck, test, lint for 2 projects`.
- `@ptah-extension/thoth-runtime`: typecheck passed; 5 suites / 87 tests passed; lint passed with no findings.
- `@ptah-extension/cli-engine`: typecheck passed; 17 suites / 178 tests passed; lint completed with 0 errors and 2 warnings.
- Warning at `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:14`: unused `ThothRefs`; the import predates the Batch 5 diff.
- Warning at `cli-engine/src/lib/adapters/cli-adapters.ts:249`: empty `dispose`; unrelated to Batch 5.
- Nx used cached results for 3 of 6 targets. The combined command still completed successfully with the required two-project header.
- Repeated non-fatal `withEngine` fixture messages about missing mock migration/configuration methods appeared during CLI tests; all suites passed and the messages do not point to the Batch 5 retention path.

## Verdict

**APPROVED WITH FIXES** — the implementation is safe and correct, but the CLI host needs the explicit repeated-start idempotency reachability test required by the checklist before Batch 5's verification proof is complete.
