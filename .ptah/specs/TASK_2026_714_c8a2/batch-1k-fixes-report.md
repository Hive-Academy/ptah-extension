# Batch 1k fix-round report

## Summary

Implemented S1, S2, M1, M2 and M3 from code-logic-review-batch-1k.md. Changes are limited to evidence-harness.ts and evidence-harness.spec.ts plus this deliverable. evidence-failure-notes.ts did not need changes: the new informational notes are appended directly, not passed through the failure-message allowlist.

All source references below are relative to libs/backend/codex-runtime/tools/.

## Fixes and specs

| Fix | Change with file:line | Spec names and locations |
| --- | --- | --- |
| S1 | evidence-harness.ts:1469 checks only top-level tool/toolName and metadata toolName when present. Display tool_title and metadata tool no longer participate in identity comparison. Thread, server, round-count and existing MCP item checks remain. | evidence-harness.spec.ts:2271, `accepts supported elicitation and observes exactly one marker: title`, supplies `tool_title: 'Write marker'` with no tool field. The existing `declines unexpected elicitation: tool` now supplies a conflicting top-level tool (line 2186). |
| S2 | evidence-harness.ts:357 and :366 accept nullish turnId and metadata; :1470 rejects only a mismatching non-null turn ID; :1481 records `elicitation turnId: null`. | evidence-harness.spec.ts:2271, `accepts supported elicitation and observes exactly one marker: null-turn` and `...: null-meta`; line 2278 asserts the null-turn note. Line 2263 retains `declines unexpected elicitation: turn`. |
| M1 | evidence-harness.ts:1474 validates every required property as an own property with boolean type using Zod. Line 1479 creates true values for required names only; :1483 records sanitized, individually capped names; :1495 returns that content. | evidence-harness.spec.ts:2271, `accepts supported elicitation and observes exactly one marker: booleans`; fixture at :2183 has two required booleans and an optional boolean. The response assertion at :2225 requires exactly the two required keys; :2279 asserts the note. `declines unexpected elicitation: required` at :2263 retains rejection of a required string. |
| M2 | evidence-harness.ts:359 permits only literal `form`, retaining the typed requestedSchema validation. | evidence-harness.spec.ts:2263, `declines unexpected elicitation: openai/form` and `declines unexpected elicitation: openaiForm`, both require schema-correct decline and Unexpected request. |
| M3 | evidence-harness.ts:1844 parses the nested config path without throwing on absence. Line 1850 records `MCP approval mode not visible in config/read` when absent; :1851 rejects a present value other than prompt. Other bounded-config checks remain. | evidence-harness.spec.ts:2271, `accepts supported elicitation and observes exactly one marker: config-absent`, including the note assertion at :2280. Line 2284: `rejects a visible MCP approval mode other than prompt before starting a thread`, checks failure, no thread/start, and zero writes. |

The acceptance cases all assert successful observation, one marker write, and the hold before responding. Existing rejection cases for another server, another case, a second elicitation, and mismatched turn/tool remain in place.

## Decisions

- Followed the explicit fix-round design rather than introducing a new approval abstraction. All decisions are reversible source changes.
- Required names must resolve to own schema properties; inherited or missing properties cannot authorize a boolean response. Object.fromEntries preserves supplied property names without assigning prototype setters.
- Config visibility is separate from its value: missing paths produce the requested note, while a visible contradictory value still fails before thread/start.
- New informational notes do not require failure allowlist entries. Required-field names use the existing sanitizer and an 80-character per-name cap.

## Verification and limitations

- ptah_get_diagnostics scoped to the two edited TypeScript files returned zero errors and zero warnings, coverage clean.
- No tests, standalone typecheck, lint, prettier, build, install, real binary or paid-model runs were performed. Specs are added, not execution-verified.
- No git commands or state changes were performed.
- M4 and Minor findings were intentionally left outside this fix round.
- Real Codex 0.155.1 wire behavior remains unverified until an authorized evidence run.
