# Code Logic Review - TASK_2026_714_c8a2 batch 8p-7

Score: 9/10. Verdict: APPROVED. Blocking 0, Serious 0, Moderate 0, Minor 1.

## Scope
`session-rpc.handlers.ts` (helper `storedCodexMessageCount`, call site near line 560) and `session-metadata-store.ts` (catch near line 1064). Read the diff, the surrounding code and `tools/degradation-audit/check-degradation.ts`. No tests or verification were run, per instructions.

## 1. Equivalence of the helper
Old: `Number.isSafeInteger(v) && (v ?? -1) >= 0 ? v ?? 0 : 0`.
New: `v !== undefined && Number.isSafeInteger(v) && v >= 0 ? v : 0`.

| Input | Old | New |
| --- | --- | --- |
| undefined | isSafeInteger false -> 0 | guard false -> 0 |
| negative (-3) | -3 >= 0 false -> 0 | 0 |
| non-integer (1.5) | false -> 0 | 0 |
| NaN | false -> 0 | 0 |
| Infinity | false -> 0 | 0 |
| > MAX_SAFE_INTEGER | false -> 0 | 0 |
| 0 | true, 0 >= 0 -> 0 | 0 |
| positive safe int | -> v | -> v |
| -0 | isSafeInteger(-0) true, -0 >= 0 true -> -0 | -0 (also identical) |

Behaviour is identical for every case. The `v !== undefined` guard is redundant with `isSafeInteger` (it is false for undefined), but it narrows the type, so the `?? 0` and `?? -1` fallbacks can go. The ternary chain keeps the same precedence (`&&` binds tighter than `?:`). The call site passes `s.codexMessageCount` (`number | undefined`), which matches the helper's signature.

## 2. degradation-audit marker
- Format: `// degradation-audit: optional-capability - <reason>` matches `SUPPRESSION_MARKER_RE` and `SUPPRESSION_BODY_RE` (kind `optional-capability`, ASCII hyphen separator, non-empty reason).
- The wrapped three-line comment is accepted. Zone 2 reads the leading comment lines inside the catch body (`commentBlockBelow`), and the marker is on the first of them. Continuation lines are plain `//` text and are not parsed as markers.
- Zone 2 consumption is recorded for every `CatchClause`, flagged or not, so the marker cannot be reported as `orphaned-suppression`. Other repo usages (`codex-chat-approval-sink.ts:115, 162`) use the same form.
- Comment only: the catch body still does `storedCallerPath = undefined`, so runtime behaviour is unchanged.

## Five logic questions (brief)
1. Silent failure: the invalid stored count lists as 0 by design, and the old code did the same. The catch falls back to the proposed workspace path, and the new comment says so.
2. User action: none introduced.
3. Wrong-answer input: a corrupt negative or NaN count shows 0 messages, as before.
4. Dependency failure: `normalizeCodexWorkspaceKey` throwing is handled by the catch, unchanged.
5. Missing: no test pins `storedCodexMessageCount` directly. The helper is module-private, so it is covered only through the list handler.

## Findings
- Minor: `session-rpc.handlers.ts` helper has no direct unit test. If the list handler tests do not cover a negative or NaN `codexMessageCount`, add one. Not blocking, since behaviour is verified identical by analysis.

## Verdict
APPROVED, confidence HIGH. Top risk: none material.
