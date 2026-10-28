# Settings env allowlist — scoped re-review

Verdict: **APPROVED**

Score: **8/10**

Blocking: **0**. Serious: **0**. Moderate: **0**. New failure modes: **0**.

The two Part B implementation findings are closed. This verdict covers only removal of the two disputed entries, compatibility of related spec expectations, and selector risks in the remaining settings-safe list. Part A is not reopened.

## Evidence and findings

No remaining defect was identified within this scope.

- `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts:73` declares exactly 16 entries. Neither `USE_BUILTIN_RIPGREP` nor `DISABLE_NON_ESSENTIAL_MODEL_CALLS` remains. Neither belongs to the certified process list at `:14` either.
- Exact, case-insensitive membership at `claude-certified-launch.ts:162` and `:171` rejects both removed names for all values. The settings classifier at `:464` rejects the entire env block when any name is disallowed. Consequently either removed name alone, lowercase, or combined with `PATH` produces `override`; the flag boundary refuses that result at `:399`. These are code traces, not executed tests.
- A literal search across agent-sdk `*.spec.ts` found no occurrence of either removed name. The positive expectations at `claude-certified-launch.spec.ts:250` and `:256` iterate the current exported list, so removal introduces no stale expectation for the old membership or an 18-entry count. The explicit success cases at `:592` and `:594` use retained keys. Unknown and mixed unsafe blocks are expected to refuse at `:601` and `:603`.
- The remaining entries at `claude-certified-launch.ts:74` through `:89` govern tool discovery, token/output budgets, timeouts, traffic/reporting, update suppression, terminal presentation, or restoration of the original working directory. None specifies an executable, replacement path, credential, endpoint, provider, or config directory. This agrees with the earlier review's individual-key check (`code-logic-review-env-allowlist.md:21`) and the [official environment reference](https://code.claude.com/docs/en/env-vars). In particular, the working-directory toggle at `:89` restores the existing project directory; it does not supply a new path. Update suppression at `:85` does not select an alternative executable.

The score is above the 5–6 band because the actual executable-selector and unconfirmed-entry defects are removed and the finite membership checks reject them. It remains below 9–10 because there are no explicit regression cases pinning either removed name (the denial examples at `claude-certified-launch.spec.ts:262` omit them), and external CLI readers were not audited against a pinned binary. Those are verification limits, not evidence of a remaining selector defect. The earlier recommendation to add dedicated rejection tests remains useful follow-up, not a condition of this narrowly requested membership re-review.

## Five logic questions

1. **Silent failure:** no success-looking acceptance of the removed keys remains: `claude-certified-launch.ts:467` returns `override` for any rejected name, and `:400` checks the result before launch.
2. **Unexpected user action:** supplying either removed setting now refuses even when its value is empty or false-like. This follows from key-only membership at `:171` and `:467` and is the intended conservative behavior.
3. **Wrong input:** mixed blocks cannot hide a rejected key among retained names or `PATH`, because `some` checks every own enumerable name until a rejection at `:467`. The existing mixed-block expectation is `claude-certified-launch.spec.ts:603`.
4. **Dependency failure:** this change adds no dependency call. Invalid flag JSON becomes undefined at `claude-certified-launch.ts:335`, is classified malformed at `:454`, and refuses at `:399`. External CLI interpretation of retained values remains delegated to that CLI; this review does not establish its behavior under arbitrary malformed numeric values.
5. **Unspecified requirement:** the list at `:73` does not encode version-specific semantic evidence, and the name-pattern spec at `claude-certified-launch.spec.ts:231` cannot prove executable safety. Future additions still need semantic review; no remaining entry was identified with the rejected risk class.

## Scope and verification

Read the helper and its companion spec in full, the prior review, and relevant task-plan excerpts. Traced list → membership → whole-block classification → flag-boundary refusal. Searched all agent-sdk spec files for both removed literals. AST analysis reported clean parsing of the helper and spec. No tests, builds, git operations, or source edits were performed. No runtime or typecheck pass is claimed. The pre-existing certified process list, including PATH and proxy/config-home names, is outside the requested remaining-settings-safe-list review; its union with the settings-safe list remains explicit at `claude-certified-launch.ts:173`.

## Decisions

- Approve the corrected membership while recording missing dedicated regression cases as a verification limit. Alternatives were withholding approval until tests were added or approving without recording the gap. Evidence: finite-set rejection at `claude-certified-launch.ts:171`, whole-block rejection at `:467`, and the current spec matrix at `claude-certified-launch.spec.ts:262`. Reversible; no source was changed.
