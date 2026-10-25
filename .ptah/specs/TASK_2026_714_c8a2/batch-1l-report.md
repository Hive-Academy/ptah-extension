# Batch 1l report

Implemented bounded agent-message evidence and aligned the edit-case instruction with the observed command accept/deny cases. No paid model turns were used; live ask-command-edit success is not claimed.

## Changes

- `libs/backend/codex-runtime/tools/evidence-harness.ts:435`: optional case-result `agentMessages: string[]` evidence, initialized only when eligible text arrives.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:621`: incoming item text is narrowed from unknown. Only completed agentMessage string text is recorded, sanitized before truncation to 400 characters, with at most three entries per case. Started items and other item types do not contribute text. Event summaries retain their existing fields and never contain message text.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1954`: edit instruction uses the accept/deny base with the stop rule scoped per user message. The shared command user prompt is unchanged; source confirms it is the same template as accept/deny.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:2055`: completed command turns without an approval request receive a note containing the recorded message count, including zero. Existing missing-approval notes and outcome gates remain intact.

## Developer instruction (verbatim)

> Evidence experiment. Only the single requested marker may be touched. Do not inspect credentials, config, home, environment or network. No subagents. No retries. Stop after one tool action per user message.

The wording matches the observed accept/deny instruction except for “per user message”. That qualifier permits one requested action for the subsequent user message delivered by turn/steer. It introduces no advance description of decline, steering, or a replacement. The native-route evidence for runs 6g and 6i supports removing the differing edit-specific wording while preserving the established single-action constraint.

## Specs

- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:1816`: existing successful decline/steer/accept regression additionally asserts the exact developer instruction and absence of the no-approval diagnostic when approvals occur.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:1871`: two parameterized cases verify a completed command turn without approvals reports one recorded message or zero, respectively, and remains unverified.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:2563`: existing event-summary privacy regression retained unchanged, including its private-text exclusion assertion.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:2619`: completed agent text is recorded and sanitized (email and bearer credential), capped at 400 characters and three entries, and never added to events. Started text, reasoning text, and malformed non-string text are excluded.

## Verification

Commands ran sequentially in the requested order. PowerShell `Select-Object -Last N` was used as the equivalent of `tail -N`.

1. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/tools/evidence-harness.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 30`: exit 0; **1 suite passed, 170 tests passed, 0 snapshots**, 24.426 seconds. Output included a Node ES-module loading warning and `SKIP symlink file: OS forbids symlink creation.`
2. `npx nx typecheck codex-runtime --parallel=1 2>&1 | Select-Object -Last 15`: exit 0; **1 task succeeded**, 0/1 cache hits, 3.4 seconds.
3. `npx eslint libs/backend/codex-runtime/tools/evidence-harness.ts libs/backend/codex-runtime/tools/evidence-harness.spec.ts 2>&1 | Select-Object -Last 15`: exit 0; **0 errors, 3 warnings**, all in evidence-harness.ts: line 739 max-lines (2325 versus 700), line 1718 preserve-caught-error, line 2211 no-useless-assignment. No unrelated cleanup was attempted.
4. `npx prettier --write libs/backend/codex-runtime/tools/evidence-harness.ts libs/backend/codex-runtime/tools/evidence-harness.spec.ts`: exit 0; harness unchanged, spec formatted.
5. Scoped `ptah_get_diagnostics` before verification and after formatting: TypeScript compiler, clean coverage, **0 errors, 0 warnings** on both calls.

No real harness, workspace-wide checks, builds, installs, or git operations were run. The next paid run is still needed to establish real model approval behavior.

## Decisions

- **Capture the first three completed string messages in optional case evidence.** Options: store text in events, require arrays on every fixture, or initialize an optional field when text arrives. Chosen optional evidence follows existing optional case-result fields, preserves event privacy and fixture compatibility, and avoids retaining started/delta text. Evidence: CaseResult and RpcChild event handling in the assigned source. Reversible: yes.
- **Sanitize before truncating.** Options: truncate first or redact first. Redact first preserves the sanitizer's ability to recognize complete credentials before applying the 400-character bound. Evidence: existing sanitize helper and requested privacy limits. Reversible: yes.
- **Scope the stop rule per user message.** Options: retain divergent edit wording, mention the replacement plan, or use accept/deny wording with a per-message qualifier. Chosen wording follows the explicit batch contract and native-route-evidence.md run 6g/6i findings; user prompt already shares the accept/deny template. Reversible: yes.
- **Add a diagnostic note without changing success gates.** Options: add a new failure path or append evidence to notes. Chosen note reports the retained count for completed command cases, including zero, while preserving existing status logic and other case behavior. Evidence: run 6i completed without approvals and the existing finally-block notes convention. Reversible: yes.
