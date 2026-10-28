# Personal-login diagnostic logic re-review — TASK_2026_719_4f64

Verdict: **REVISE** (NEEDS_REVISION)  
Score: **6/10**  
Findings: **1 Blocking, 0 Serious, 0 Moderate**. Failure modes: **2**, sharing one boundary defect.

## Scope and verification

This is the requested bounded re-review of the foreign-error classifier, its updated assertions, and the adapter refusal diagnostic. Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`.

Read the prior review, root guidance, relevant requirements/plan excerpts and D66; inspected source structures and the complete revised function, surrounding diagnostic construction, adapter catch, and relevant specs. Whole-file output was truncated; this report does not approve the complete files or unrelated lifecycle behavior. No source changes, git operations, builds or tests were performed. Scoped `ptah_get_diagnostics` for the three requested runtime files returned zero errors and warnings, source `typescript-compiler`, coverage `clean`. This is not behavioral test evidence.

## Finding 1 — Blocking: repeated access to mutable error.name bypasses the allowlist

Evidence: `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:438`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:286`, `:290`, `:308`.

The set at `claude-sdk-lane-runner.ts:413` fixes ordinary custom string names, but the conditional reads `error.name` once for membership and again for its return value. An Error can have a getter. The following static counterexample returns an unchecked string from the formatter:

```ts
let reads = 0;
const error = new Error('ignored');
Object.defineProperty(error, 'name', {
  get: () => ++reads === 1 ? 'TypeError' : 'CustomerSecretAbc123',
});
// claudeLaneForeignErrorClass(error) returns 'CustomerSecretAbc123'.
```

The adapter forwards that second value as `foreign` to its warning logger. Thus the original confidentiality finding remains reachable for an accessor-backed dependency error. This is a code-derived counterexample, not an observed production disclosure or an executed test.

The same access also remains unguarded: a throwing `name` getter escapes from the formatter. In the adapter catch this occurs after disposal but before `logRefusal` and `throw claudeLaneRefusal(code)` (`claude-cli.adapter.ts:284`–`:292`), replacing the intended fixed refusal with the accessor's thrown value. This violates the prior review's non-throwing formatting requirement and can propagate arbitrary error data to the caller.

Fix: read the name exactly once inside a guarded classification operation; validate that captured value against the closed set and return only the validated value or a literal fallback. Guard classification itself, including potentially throwing prototype operations on foreign proxies, so malformed foreign errors cannot escape this formatter. Add accessor regressions for changing and throwing names, including adapter logging/refusal assertions.

## Assertions and other diagnostic fields

- The changed custom-class assertion is correct: `claude-sdk-lane-runner.spec.ts:815` expects `other` for `SdkTransportError`. The data-shaped `ownerExampleTest` case at `:834` also correctly expects `other`.
- The ordinary refusal, primitive, punctuation-bearing name and TypeError assertions at `claude-sdk-lane-runner.spec.ts:831`–`:835` match the implementation. They do not cover accessors, so they cannot establish that every emitted string passed the set check.
- The adapter's added `hostStep`, phase, step and interrupt diagnostic fields follow locally assigned vocabulary, and `launchDiagnostic` emits only its explicit fields (`claude-cli.adapter.ts:145`, `:199`, `:287`; `claude-sdk-lane-runner.ts:489`). The personal-login diagnostic is constructed by `claudePersonalLoginCheck` from comparison booleans and fixed subscription categories (`libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts:168`–`:180`), then attached only at the personal-login step (`claude-sdk-lane-runner.ts:494`, `:641`). No additional arbitrary-string path was identified in those new fields within this scope.
- The early return for lane/certified refusals and the `non-error` fallback remain intact (`claude-sdk-lane-runner.ts:432`–`:437`). The observed defect is the incomplete boundary fix, not a newly established change to those branches.

## Five logic questions

1. **How does this fail silently?** A changing getter passes membership then supplies an unchecked value for an otherwise normal-looking warning (`claude-sdk-lane-runner.ts:438`; `claude-cli.adapter.ts:290`).
2. **What user action produces unexpected behavior?** A named-lane launch whose SDK/dependency rejects with such an Error reaches the adapter's classifier; a throwing getter replaces the fixed launch refusal (`claude-cli.adapter.ts:279`–`:292`). No ordinary user action alone was shown to create this error shape.
3. **What input produces a wrong answer?** A name accessor returning `TypeError` then an arbitrary string defeats classification; ordinary custom string names correctly become `other` (`claude-sdk-lane-runner.ts:438`; spec `:834`).
4. **What happens when a dependency fails?** Ordinary errors are classified, but accessor failure can itself escape the catch's normalization path (`claude-cli.adapter.ts:285`–`:292`).
5. **What is missing?** Accessor-backed foreign-error coverage is absent from the revised classifier cases (`claude-sdk-lane-runner.spec.ts:830`–`:836`). The prior explicit ANTHROPIC_AUTH_TOKEN test gap remains acknowledged in `decisions.md:523`–`:525`; it is not reopened or counted as a new finding here.

## Decisions

- Retain the blocking finding rather than close it based on the ordinary-string cases: the exact expression at `claude-sdk-lane-runner.ts:438` permits a deterministic bypass. Options were approval of the limited value cases or revision of the diagnostic boundary. Revision follows the requested no-arbitrary-data contract; this assessment is reversible once the boundary and regressions are corrected.
- Keep scope limited to the requested correction and preserve D66's deferred test decision (`decisions.md:521`–`:525`). No task state or source was changed.

The score remains 6 rather than 7–8 because the confidentiality boundary still has a concrete bypass. It is above 3–4 because fixed-name membership and the existing refusal/non-error branches work for ordinary values, and the inspected additional diagnostic fields remain bounded; the defect is localized and directly repairable.
