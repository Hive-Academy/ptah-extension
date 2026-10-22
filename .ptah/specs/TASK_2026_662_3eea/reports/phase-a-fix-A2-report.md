# Phase A fix round — Lane A2

## Results

| Item | Result | Source | Spec |
| --- | --- | --- | --- |
| 3b (L-M2) | Fixed: `isError` is optional for subagent reconciliation. When omitted, the update leaves `is_error` untouched; explicit true and false still write the column. | `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:1375`, `skill-candidate.store.ts:1425` | `skill-candidate.store.spec.ts:860` tests existing 0 and 1 values. |
| 6 (L-M5) | Fixed: empty attribution lists do nothing; `spec:` evidence is excluded from pruning in both selection and deletion. | `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts:163` | `skill-task-grade.store.spec.ts:51` |
| 7 (St-M1) | Fixed: attribution, prune, aggregate and grade rows use Zod schemas. Invalid rows produce a bounded warning and fail; injected Logger is used. | `skill-task-grade.store.ts:44`, `skill-task-grade.store.ts:85` | `skill-task-grade.store.spec.ts:64` |
| 8 (L-M3) | Fixed: both scope filters include `slash-command`. | `skill-invocation-event.store.ts:108`, `skill-candidate.store.ts:1661` | `skill-invocation-event.store.spec.ts:76`, `skill-candidate.store.spec.ts:251` |
| 9 (L-S3) | Not fixed within this lane's file ownership. The settings RPC write loop is in `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:638-660`; it must be changed there. | `skill-synthesis.service.ts:1619-1630` only reads old keys | No spec added: a service spec cannot verify the handler write path. |

## Item 9 write path

`skillSynthesis:updateSettings` writes `skillSynthesis.judgeProvider`, `skillSynthesis.judgeModel`, and `skillSynthesis.enhanceTimeoutMs` through `IWorkspaceProvider.setConfiguration` in `skills-synthesis-rpc.handlers.ts:650-656`. The same loop needs to write `skills.enhancement.provider`, `skills.enhancement.model`, and `skills.enhancement.timeoutMs`, respectively, when those three settings are supplied. The exact new key names are in `libs/backend/platform-core/src/file-settings-keys.ts:296-298`. `SkillEnhancerService` reads them at `skill-enhancer.service.ts:840-859`. `SkillSynthesisService.readSettings` reads the old keys at `skill-synthesis.service.ts:1619-1630`. None of these keys were dual-written by this lane.

## Decisions

- Retained the Logger dependency and used it for bounded invalid-row warnings. The nearby `SkillInvocationEventStore` uses the same injected logger and Zod row schema pattern; changing the constructor would affect registrations and specs outside this lane.
- Applied the `spec:` exclusion in both the read and delete SQL so the row cannot be pruned even if it changes between those statements. The 0056 backfill uses that evidence prefix.
- Left item 9 for the RPC handler owner because the write path lies outside the four assigned source files; adding write side effects to `readSettings` would not fix the RPC operation directly.
- Used separate fixed SQL statements for omitted and explicit `isError` in `applyReconciliation`. This preserves the existing error bit without reading a row or changing explicit caller behavior.

## Clarifications Needed

1. Which owner should implement item 9 in `skills-synthesis-rpc.handlers.ts` and its colocated spec? (Recommended) Lane B, which already owns that handler; alternative: assign a separate follow-up lane.

Tests, typecheck, lint, Nx, build and e2e were not run, as instructed. All edited source and spec files use LF line endings.
