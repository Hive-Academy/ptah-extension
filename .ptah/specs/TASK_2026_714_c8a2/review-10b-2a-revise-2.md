# Review 10b-2a revise 2

Verdict: APPROVE
Score: 8/10
Review family: claude vs codex

## Defects

None.

## Dispute of defect 1

Accepted. `codexProfileFingerprint` digests only `permissionLevel`, `sandboxPolicy` and `approvalPolicy` (`libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:221-223`, identity built at `:334-338`, digest at `:343`). `essentialLaneSession` spreads `...session` and changes only lane settings (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-rejection.ts:20-44`), so the retry profile keeps the same fingerprint. The check at `codex-runtime.ts:76-80` therefore does not fire on resume. My earlier finding was wrong.

## Defect 2 pin

The new case `retries a resumed pre-turn config rejection with the same identity and fingerprint` (`codex-app-server-lane.adapter.spec.ts`, after the `retries a pre-turn config rejection` case) pins the resumed retry correctly at the adapter level. It asserts the saved identity on both resume opens, equal fingerprints, one notice, and a single close per context.

Limit: `runtime.open` is mocked, so the real fingerprint check in `codex-runtime.ts:76-80` does not run in this case. A future change to the digest inputs would fail only in codex-runtime tests. This gap does not block approval.

## Checked

- Read `batch-10b-2a-revise-2.md` and the revise 2 spec diff.
- Read `codex-execution-profile.ts:221-223, 315-344`.
- Read `codex-runtime.ts:76-80`.
- Read `essentialLaneSession` in `codex-app-server-lane-rejection.ts:20-44`.
- Read the adapter diff for `retryConfig` and `openContext` (identity passed as `previous?.identity ?? resume`).
- Hygiene in the new spec cases: no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, or real timers. Not run: tests, typecheck, lint.
