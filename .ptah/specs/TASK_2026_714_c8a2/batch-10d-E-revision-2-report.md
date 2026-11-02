# Batch 10d.E revision 2 report

## Changes

1. **Complete — output newline normalization.** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:184` restores `/\r(?!\n)/g`. `codex-app-server-lane.adapter.spec.ts:186-190` checks that `"line 1\nline 2\r\n"` keeps its line endings and `"a\rb"` becomes `"ab"`.
2. **Complete — R3 isolation regression.** `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:59-72,148-158,190-275` retains the actual profile supplied to each opened fake context, derives `turnPermissionLevel` from it, and deep copies each context's profile, fingerprint, turn permission, sandbox policy, and approval policy immediately after open. Both chat-first and lane-first sequences open a second chat and lane with distinct model/workspace options; the second chat also uses `plan` permission. After each open, the spec compares every earlier context with its own snapshot and checks distinct profile objects and policy values.
3. **Complete — records-backed lane row exclusion.** `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:378-412` uses the existing records repository mock with `SessionMetadataStore`. It checks that the persisted lane row is marked child, remains readable by the lane identity store, is absent from chat identity reads and both workspace listing modes, and is excluded by chat resume lookup. The records repository listing call is asserted.

## Decisions

- **Isolation fixture:** Keep the mocked `CodexRuntime.open` to avoid a real App Server process, but expose each per-scope profile on its corresponding context. Alternatives were a static context or a real process-backed runtime. The re-review identifies the static context as the defect, while the composition supplies real per-scope profile objects. Reversible.
- **Records fixture:** Use `createMockSessionRecordRepository`, which follows the SQLite repository's `isChild` listing rule and already serves the records-backed store path in this spec. Alternatives were a SQLite database fixture or legacy storage only. The task asks to reuse the spec's existing fixtures, and the production SQLite query uses `is_child = 0` for default listings. Reversible.

## Verification

Manually reviewed the edited lines, profile policy mapping, and the records-backed listing branch. No verify, tests, typecheck, lint, build, nx, npm, `ptah_get_diagnostics`, or Git command was run, as required. The coordinator owns automated checks.
