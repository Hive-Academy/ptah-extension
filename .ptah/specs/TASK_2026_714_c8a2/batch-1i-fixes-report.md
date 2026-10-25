# Batch 1i fixes report

## Summary

Implemented S1, S2 and S4 in the existing harness and its specs. Only `evidence-harness.ts`, `evidence-harness.spec.ts` and this deliverable were written. Case order, subset selection and run-loop stop semantics were not changed.

## S1 — Neutral prompt and approval evidence

- `libs/backend/codex-runtime/tools/evidence-harness.ts:1746`: read-rule prompt now starts exactly `Run exactly this command once` and does not ask for approval. Other command prompts retain their existing wording.
- `evidence-harness.ts:341-369`: approval summaries include sorted, sanitised `paramKeys`, sanitised `reason`, `kind` and `type` when supplied as strings (400-character cap after sanitisation), preserve explicit nulls, and always include `hasProposedExecpolicyAmendment`. Amendment content is never retained.
- `evidence-harness.ts:567-606`: capture happens at request receipt, before transport failure/ending checks or case validation. Automatic declines are recorded too.
- `evidence-harness.ts:1264,1344-1361,1376,1471-1473,1799`: a separate local list of validated approvals preserves existing marker-outcome checks; tolerated-read evidence cannot shift the original/replacement indices or satisfy the outcome count.
- Specs: `uses a neutral read-rule prompt without requesting approval` (`evidence-harness.spec.ts:1812`); `records sanitised approval evidence for %s without amendment content` for both rule approval and tolerated-read approval (`:1819`); updated `continues the edit flow after %s` and `rejects a second approval repeating the original command` (`:1842`) to include the additional decline evidence.

Schema fields checked against `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:2756-2871`, definition `CommandExecutionRequestApprovalParams`: `reason` (string/null), `kind` (CommandExecutionApprovalKind, default command), and `proposedExecpolicyAmendment` (string array/null). The boolean is true for a non-null supplied amendment and false for absent/null. The schema also declares `approvalId`, `command`, `commandActions`, `cwd`, `environmentId`, `itemId`, `networkApprovalContext`, `proposedNetworkPolicyAmendments`, `startedAtMs`, `threadId`, `turnId`; their presence is recorded through the key list. `type` is a defensive top-level discriminator capture for other approval requests, not a claimed field of this command schema. No nested command-action or amendment payloads are copied.

## S2 — Additional prompt prefix rules

- `evidence-harness.ts:1212-1217`: retains the full read-command argv rule, adds `["Get-Content"]` and `["powershell.exe"]` on Windows or `["cat"]` elsewhere. Each rule uses decision `prompt` and occupies its own line. Existing exact-command identity checks remain in force.
- Spec: `observes rule approval before output, declines it, and records completion status` (`evidence-harness.spec.ts:1795-1809`) now compares the entire rules file, including full argv, short prefixes, order and newlines. Existing fake-spawn checks still verify CODEX_HOME placement and cleanup.
- Schema fields used: none added; this is exec-policy file content, not approval wire data.

## S4 — Marker-command source regression guard

- `evidence-harness.spec.ts:147-152`: source-shape assertion now matches the read-rule conditional and requires the marker branch to call `markerCommand` with `process.execPath`, `markerScript`, `experiment.root`, and `target`, in that order.
- Spec: `builds a file-backed marker command without inline code or double quotes`. The other assertions guarding against inline code and double quotes remain.
- Schema fields used: none.

## Decisions

- Record approval evidence at transport receipt, with validated approvals tracked separately for outcomes. Alternative: capture only inside the case handler. Evidence: RpcChild can decline requests while failed/ending before calling that handler, and tolerated reads must not shift marker indices. This is a reversible internal harness change.
- Capture only top-level scalar discriminators (`kind`, `type`) and the amendment-presence boolean, rather than copying request objects. Evidence: the pinned command schema exposes `kind`; nested action arrays contain data beyond the requested evidence. This avoids retaining amendment content and is reversible.

## Verification and limitations

- Scoped `ptah_get_diagnostics` for the two edited TypeScript files ultimately reported Errors: 0, Warnings: 0, clean coverage. The first request reported an asynchronous compiler check still running; the subsequent call returned the completed result.
- No tests, standalone typecheck, lint, formatter, build, package installation or real binary/model run was executed. No git commands were run. Added/updated specs require the orchestrator's check slot.
- Existing rule-location uncertainty remains explicitly recorded by the harness. A prompt observed in a real run still needs interpretation using the newly retained reason/discriminator/amendment-presence evidence.
- S3 and M1 remain with the orchestrator's runner, as instructed.
