# Verdict push fix

## Payload decision

`agent-monitor:parent-delivery` carries optional `verdict` and `stopReason` on completion envelopes. `LaneCompletionNotifier` computes the verdict before it enqueues the completion; the same envelope drives the existing monitor push. This preserves the notifier's deliverable check.

## Changes

- Shared `agent-monitor.ts` and `schemas.ts`: typed and Zod-validated optional verdict and stop reason.
- Runtime `parent-envelope-store.service.ts`, `lane-completion-notifier.service.ts`, and `agent-events.ts`: carry the computed signal through the envelope to the push.
- Chat streaming store: its existing bounded parent-delivery map retains the complete payload; a regression test asserts verdict and stop reason.
- Chat `lane-thread.ts`: map pushed verdict to Deliverables written, No deliverable, Failed, or Unverified. Missing verdict falls back to Failed for a failed status and Unverified otherwise.

## Verification

- Shared schema spec accepts all four verdicts with a usage-limit stop reason; runtime wiring spec expects verdict and auth stop reason on the push; store and thread mapper specs verify retention and labels.
- Shared/runtime verify: lint and typecheck passed for both projects. Shared Jest initially failed four new cases due to misplaced schema fields; corrected. Runtime test phase produced no result and was stopped.
- Focused corrected tests: shared schema 13/13; runtime wiring 31/31; chat-streaming store 187/187; chat thread mapper 7/7 passed.
- Chat verify: chat-streaming tests passed 34/34 suites, 837 passed and one skipped. The wrapper forwarded `--maxWorkers=1` to ESLint and ngc, so its lint/typecheck stage rejected the option. Chat test phase produced no result and was stopped.
- Direct Angular typecheck: both chat-streaming and chat passed. Existing Angular extended diagnostic warnings remain.
- Scoped Ptah diagnostics: TypeScript check remained running after 45 seconds and returned unchecked in both attempts.

## Decisions

- Use the parent-delivery completion envelope: the notifier's verdict is available at creation, and the renderer already consumes this push. Reversible: yes.
- Keep the bounded store projection unchanged because it retains the full typed payload. Reversible: yes.
