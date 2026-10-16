# Batch D3 fix

## S1 — Partial segment totals

- `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:4,78-83`: the fallback returns typed totals with `partial: true`; it still returns `null` when no usable usage exists.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts:25,68-83`: fallback input, output, and estimated cost show `≥`; the row has the partial title. Structured totals remain unmarked.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:196-204,335-368`: fallback token and cost badges show `≥`, use the partial title, and have an “at least” aria-label. Structured badges remain as before.
- Specs: `stats-bar.utils.spec.ts:26-31` checks the flag and null result; `cli-lane-usage-summary.component.spec.ts:60-93` checks restored-then-live and structured totals; `inspector-agents-section.component.spec.ts:74-94` checks partial and structured badges.

## M1 — CLI duration

- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:342-351`: CLI row duration and its accessible label now use `formatElapsed`; other agent kinds retain `formatAgentDuration`.
- Spec: `inspector-agents-section.component.spec.ts:87-94` checks the badge and aria-label against `formatElapsed(65_000)`.

## M2 — Fallback fields

- `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:72-75`: JSDoc states that only safe token and cost totals are folded; context and cache fields are deliberately omitted because retained segments are partial under Req 8.4.
- Spec: `stats-bar.utils.spec.ts:28-30` includes context and cache data and asserts they do not appear in the fallback result.

## Verification

- Targeted Jest: 3 suites passed, 21 tests passed, 0 failed (`--coverage=false --maxWorkers=1`).
- Scoped `ptah_get_diagnostics`: no diagnostics in the six changed files. It reported 266 errors in sibling files outside this batch's ownership.

## Decisions

- Used a `partial: true` field on the fallback totals and kept the store's Req 8.4 contract. Alternative was a wrapper `{ totals, partial }`; the field is the smaller typed change and is reversible.
- Rendered a local token badge for partial inspector totals so its visible prefix, hover title, and aria-label agree. Structured totals continue using `ptah-token-badge`. This is reversible.

## Open

- Existing diagnostics in sibling files are outside the allowed edit scope.

## Typecheck fix (round 2)

- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts:28,41-48,68,77-78`: context and cache fields now come only from the structured totals; input, output, and cost still use `usage()`. This removes the fallback union's invalid context/cache field access while retaining `ctx —` and no cache row for partial totals.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.spec.ts:43-45,77-79`: structured totals assert context and cache values; the partial fallback asserts `ctx —` and no cache row.
- Targeted Jest: 1 suite passed, 4 tests passed, 0 failed. Scoped diagnostics: no errors in the two changed files; sibling-file errors remain outside scope.
