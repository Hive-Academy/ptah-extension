## Backend implementation — `TASK_2026_701_9e4b`, batch 8b

**Tasks completed**: 8b.1 — attach the unattached suppression in `WizardAgentOriginStore.read` (D23)

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.ts — moved the first catch's `// degradation-audit: optional-capability - ...` marker from after the ENOENT `if` (outside every attach zone) to the first lines of the `catch (error: unknown) {` body (zone 2, `tools/degradation-audit/check-degradation.ts:36-41`). Reworded the reason to cover both returns: ENOENT is the normal missing-file state and stays silent; any other read error is warned and gives `{}`. No behaviour change, no API change, spec untouched.

**Why a marker instead of other handling**: the catch already logs the non-ENOENT error through the injected `Logger`. The audit flags every `return {}` in a catch no matter what it logs. An empty record is the documented, intended result: the module comment says a damaged record can only remove the "unchanged" label. Task 8b.1 requires this behaviour to stay as it is. A marker in a zone the audit reads is therefore the right fix. The second catch (JSON/zod parse) already had its marker in zone 2 and was never flagged.

**Stack observed**: tsyringe `@injectable`/`@inject(TOKENS.LOGGER)` and the `Logger` from `@ptah-extension/vscode-core` (store file). Marker grammar and attach zones come from `tools/degradation-audit/check-degradation.ts:27-53`. The ratchet is `tools/degradation-audit/baseline.json:14` (`libs/backend/agent-generation: 1`), which I did not change.

**Verification**:

1. `node scripts/verify.mjs --exec --task degradation-audit -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0. The output shows `libs/backend/agent-generation: 1 ok (baseline 1)`. agent-generation has no orphaned-suppression, and nothing is flagged in `wizard-agent-origin.store.ts`. The one remaining agent-generation site is `user-layer-mirror.service.ts:2229` (`catch { return; }` after `readdir(legacyRoot)`). The same code is on main at line 2087, so it is the existing baseline site and was not added by this task. Overall result: `TOTAL 276 unsuppressed site(s)`.
2. `npm run verify -- -p @ptah-extension/agent-generation`: `NX 3 tasks: 3 succeeded` (lint, test, typecheck), lock released with exit code 0. A first attempt was killed by a background time limit while it waited for the lock. Its orphaned child then exited with 0xC0000142 without running anything. I re-ran the check, and the result quoted above is from that rerun.
3. `ptah_get_diagnostics` on the store: 0 errors.
4. Host checks (ptah-electron, ptah-extension-vscode, ptah-cli): not run; the orchestrator runs them later, as the brief says.

**session-importer marker (`libs/backend/agent-sdk/src/lib/session-importer.service.ts:993`)**: this marker is on main and this task did not add it. `git diff --stat main -- <path>` shows no change in the worktree, and `git show main:<path>` lines 989-1000 are identical to the worktree. The marker sits after the `if (context?.kind === 'named') throw ...` line, which is outside the attach zones; that is the same defect as D23. The last commit to touch the file on main is e3965c65c (`feat(agent-sdk,shared): require both stores for named session resume`). The audit still reports it as `[orphaned-suppression]`, yet the run passes, and agent-sdk is `3 ok (baseline 4)`. Not fixed here: it is outside this batch and outside this task.

**Plan deviations**: none.

**Out-of-scope observations**:

- The orphaned marker in `session-importer.service.ts:993` on main needs its own fix: move the marker into the first lines of the catch body, above the `throw` guard.
- Batch 7 files were not touched. Batch 7's verify held the lock during my run, and I saw no failures from its files in my output.

## Decisions

- **Decision**: move the existing marker into the first lines of the catch body (zone 2), with no restructure and no "reported" result type. **Options**: (a) move the marker; (b) change `read` to return a reported result; (c) split the ENOENT check into a helper. **Evidence**: Task 8b.1 says the behaviour stays and there is no API change; the catch already logs. **Reversible**: yes.
