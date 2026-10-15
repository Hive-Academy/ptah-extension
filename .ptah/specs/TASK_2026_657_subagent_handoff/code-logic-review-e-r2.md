Verdict: NEEDS_REVISION — 5/10

# Scoped code logic re-review: ac1898c22 vs 3404ddca4

Normal publication and pointer paths are sound, but prompt text can still enter logs and a failed temporary-file removal can leave a durable orphan. This is above 4/10 because the ordinary stop and read paths work; it is below 6/10 because a privacy invariant remains broken.

## Scoped outcomes

- **B1 RESOLVED.** The pointer, record body and task rule say to leave a still-running subagent's record pending (`subagent-handoff-index.ts:51-56`, `subagent-handoff-record.ts:136-143`, `task-spec.contract.ts:531-540`). The stopped record is published after invocation even when the stop rejects (`subagent-budget-monitor.ts:952-969`). Regression tests pin all three wordings (`subagent-handoff-index.spec.ts:133-144`, `subagent-handoff-record.spec.ts:47-54`, `task-spec.contract.spec.ts:520-528`), but do not run reject → parent prompt → retry as one scenario.
- **B2 PARTIAL.** The leading-dot `.tmp` name cannot pass `RECORD_NAME`, so neither indexing nor seven-day resolved-record deletion touches it (`subagent-handoff-record.ts:53-54,502-505`, `subagent-handoff-index.ts:218-220,317-321`). The file is written and closed before exclusive `fs.link` publishes the final name; an existing final name fails, and readers cannot see a partial final file (`subagent-handoff-record.ts:506-515`). On normal success, link failure or write failure, `finally` attempts temporary-file removal (`:507-516`). EEXIST, EIO, reader overlap, and old-temp tests pin those cases (`subagent-handoff-record.spec.ts:195-259`; `subagent-handoff-index.spec.ts:230-240`). Removal failure is not covered and violates the requested every-path guarantee (Serious finding below). A hard-link EPERM/ENOTSUP becomes a typed failed write (`subagent-handoff-record.ts:480-484,513-515`); a handoff stop is skipped and warned by type/code (`subagent-budget-monitor.ts:1077-1108`, `subagent-handoff-record.ts:459-465`). No unsupported-link regression test exists.
- **S3 RESOLVED.** Every visit, including the first, races the remaining 600 ms; an expired visit does not advance the cursor and returns the directory timeout line (`subagent-handoff-index.ts:257-289`). The hook's outer bound is 1,000 ms (`user-prompt-submit-hook-handler.ts:16-20,130-148`). The timer is cleared and `Promise.race` observes a later rejection from the abandoned visit (`subagent-handoff-index.ts:368-397`); the underlying read may continue. First- and later-read stall tests pin the pointer and cursor behavior (`subagent-handoff-index.spec.ts:310-339`); the bound comparison is tested (`user-prompt-submit-hook-handler.spec.ts:141-143`).
- **M5 PARTIAL.** The message is omitted, and the changed test pins that case (`user-prompt-submit-hook-handler.ts:108-117`; `user-prompt-submit-hook-handler.spec.ts:105-139`). The fields that replace it are still caller-controlled (Blocking finding below).

## Blocking

1. **Prompt text can still enter logs through exception metadata.** A callback can throw `Object.assign(new Error(), { name: prompt, code: prompt })`; `fanOut` logs both strings unchanged (`user-prompt-submit-hook-handler.ts:102-117`). The regression test only puts the prompt in `message` and uses fixed `TypeError`/`E_CALLBACK` metadata (`user-prompt-submit-hook-handler.spec.ts:105-139`). Impact: a prompt-submission callback can disclose the full prompt to logs despite the privacy rule. Use a fixed error classification and a constrained code before logging.

## Serious

2. **A failed unlink leaves an untracked full handoff copy.** `publishComplete` calls `removeTemp` in `finally`, but `removeTemp` catches an `fs.unlink` rejection and returns (`subagent-handoff-record.ts:498-528`). After a successful link, `create` therefore reports success with the temporary hard link still present; after a failed link, it reports the link error while the temporary file remains (`:470-485,513-528`). The index rejects that name and cannot age it out (`subagent-handoff-index.ts:218-220,317-321`). Impact: a transient unlink failure retains handoff content indefinitely, even after the final record is consumed and deleted. The EIO test verifies cleanup only when unlink succeeds (`subagent-handoff-record.spec.ts:210-225`).

## Five logic questions

1. Silent success: successful publication plus failed unlink returns `ok:true` with an orphan (`subagent-handoff-record.ts:480-482,513-528`).
2. User action: a parent prompt between a rejected stop and its retry now instructs leaving the record pending (`subagent-handoff-index.ts:51-56`; `subagent-budget-monitor.ts:983-994,1186-1205`).
3. Wrong answer from input: no new record-content wrong-answer path found in this diff; the changed data exposure is callback-controlled exception metadata (`user-prompt-submit-hook-handler.ts:108-117`).
4. Dependency failure: unsupported hard links fail the write and defer the handoff stop; failed unlink leaks the temp copy (`subagent-handoff-record.ts:513-528`; `subagent-budget-monitor.ts:1097-1108`).
5. Missing requirement: temp cleanup has no recovery when unlink fails, though the index deliberately ignores temp names (`subagent-handoff-record.ts:519-528`; `subagent-handoff-index.ts:218-220`).

Checks: scoped agent-sdk Jest, 4 suites/143 tests passed; scoped TypeScript diagnostics, 0 errors. No source files were changed.

