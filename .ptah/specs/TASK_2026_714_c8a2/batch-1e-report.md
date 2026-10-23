# Batch 1e report

Implemented the Windows PowerShell command identity fix in the three assigned source files. No git operations or compaction were run.

## Changes

- `libs/backend/codex-runtime/tools/evidence-harness.ts:1078`: write the per-case marker CJS file with exclusive creation and mode 0600; invoke Node with script, root and target rather than inline `-e`. The writer uses argv[2]/argv[3]. Reject double quotes in the constructed command before spawning. MCP fixture behavior and file-edit prompt remain unchanged.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:854`: exported pure `commandMatches` accepts exact identity or, only on Windows, the precise quoted absolute PowerShell/pwsh executable wrapper and identical inner command. Drive-rooted and UNC paths are supported. No extra flags, trailing text, inner case folding or quote unescaping is permitted.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:942`, `:1201`, `:1256`: apply the matcher to approval decisions, approval mismatch diagnostics and both item notifications. `:1130`, `:1217`, `:1266` record a deduplicated `Command accepted via PowerShell wrapper` note. Item start still does not grant approval; side-effect checks remain in place.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:44`: allowlist the path quote failure without including the offending path.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:146`: redact quoted absolute shell directories before generic path replacement, retaining their harmless executable basename for shape classification. Marker script paths still become `<MARKER_SCRIPT>` before root replacement.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:845`, `:1457`: suppress missing-approval diagnostics on exceptional harness exits, preserving the started-turn, ask-level and no-request prerequisites.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:51`: strict identity table tests; `:98`: file-backed command construction regression guard; `:118`: diagnostic fixture changed to a script path; `:259`: absolute PowerShell shape/redaction regression; `:1150`: missing-approval gate-failure regression.

## New spec names

- accepts the exact command on every platform
- accepts only the exact absolute PowerShell wrapper: %s
- rejects a non-identical or unsupported wrapper: %s
- rejects wrapper matching for double quotes and non-Windows platforms
- builds a file-backed marker command without inline code or double quotes
- preserves the PowerShell basename and classifies an absolute shell wrapper
- does not note missing approval after a harness gate failure

The rejection table covers relative and drive-relative executables, cmd/bash, extra flags, trailing text/newline, changed and case-variant inner commands, and quotes in executable paths.

## Decisions

- Suppress the missing-approval note for all exceptional exits, rather than maintaining a separate list of identity/safety/protocol exception messages. Evidence: RpcChild propagates callback/protocol failures through assertHealthy and pending request rejection; runCase already has one cleanup boundary. This conservatively avoids claiming absence of approval after any incomplete observation. Diagnostic only and reversible; approval decisions are unchanged.
- Preserve known shell basenames before generic path redaction rather than maintaining a second raw-command classifier. Evidence: recordCommandShape classifies its shaped command and then sanitizes it. This keeps classification and emitted evidence consistent while hiding directories, including paths with spaces. Reversible and diagnostic only.
- Keep exact-command equality as the first matcher rule, as explicitly requested. Double-quote protection applies to wrapper parsing and construction of the actual expected command. No normalization enters approval decisions.

## Verification and remaining work

- Scoped ptah_get_diagnostics after final source edits: TypeScript compiler source, clean coverage, zero errors and zero warnings across the three requested files.
- No Nx, Jest, tsc CLI, eslint, prettier, npm, ts-node, Codex binary, build or live spike was run, as instructed. The orchestrator must run scoped specs and a real Windows spike; no runtime success is claimed here.
- Formatting was adjusted manually. Source-construction assertions are static regression guards; the new marker invocation has not been executed in this lane.
- No files outside the three assigned sources and this requested report were written. Existing work was preserved; no git status/diff was run under the no-git lane rule, so unrelated worktree changes were not inventoried.
