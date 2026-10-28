# Personal-login diagnostic logic re-review r3

Verdict: **REVISE** (NEEDS_REVISION)
Score: **7/10**
Findings: **0 Blocking, 0 Serious, 1 Moderate**. Remaining failure modes: **1**.

## Scope and verification

Bounded static review of the two r2 accessor failures, foreign-error formatting, adapter refusal fields and matching assertions. Paths below are relative to D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts. No source edits, git operations, builds or tests. Scoped ptah_get_diagnostics returned zero errors and warnings, source typescript-compiler, coverage clean. AST analysis parsed all three requested files without syntax errors. Whole-file read output was truncated; this is not approval of the complete files or unrelated lifecycle behavior. Relevant functions and assertions were read directly. Broader task-document output was also truncated; the explicit r3 request and r2 report define this review's scope.

## Closure of r2 accessor cases

- **Switching name accessor: closed.** claude-sdk-lane-runner.ts:441 captures name exactly once. At :446 strict equality selects the tuple's own constant, never the caller's object or a subsequent accessor result. The literal union at :432 matches this behavior. The spec at claude-sdk-lane-runner.spec.ts:835-841 checks both TypeError and exactly one read.
- **Throwing name accessor: closed.** claude-sdk-lane-runner.ts:440-444 catches the getter exception and returns the literal other. The degradation-audit comment identifies the fallback. The assertion at claude-sdk-lane-runner.spec.ts:842-848 fails if the getter's error escapes.
- Ordinary custom names, primitive throws and built-in TypeError remain covered at claude-sdk-lane-runner.spec.ts:831-849. No caller-controlled string is returned by the revised name classification expression (:446); it performs no coercion.

## Moderate finding M1 — prototype inspection remains outside the classification guard

Evidence: libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:433-440 and :363-368; libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:285-292.

The r2 report explicitly requested guarding classification including foreign proxies. Only the name read is guarded. A dependency can reject with:

```ts
const error = new Proxy(new Error('ignored'), {
  getPrototypeOf() { throw new Error('foreign payload'); },
});
```

Calling claudeLaneForeignErrorClass(error) throws while evaluating its first instanceof, before reaching the try. In the adapter, claudeLaneRefusalCode(error) performs the same unguarded prototype operation first (:285). Thus this malformed dependency error bypasses the fixed refusal and warning entirely. This is an unlikely error shape, classified Moderate; it is a static counterexample, not an executed test or an observed production leak.

Guard the full foreign classification operation and normalize prototype-check failures in refusal-code extraction to identity-unproved. Add a proxy regression, preferably at the adapter boundary to establish that the fixed refusal survives both formatters. The new accessor tests correctly cover their stated behavior but do not cover this remaining r2 case.

## Refusal log data flow

1. Adapter hostStep is assigned local literals (claude-cli.adapter.ts:134-156); stage is a local literal union (:304, :347). Request inputs such as working directory, model and profile are not forwarded in the refusal detail.
2. launchDiagnostic explicitly projects phase, step, interrupt and personalLogin (claude-sdk-lane-runner.ts:497-505). Personal-login input passes through comparison booleans and fixed subscription classification (libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts:164-180), then is stored at claude-sdk-lane-runner.ts:649.
3. Adapter adds only hostStep, that projection and the classifier result (claude-cli.adapter.ts:283-291). Its logger writes these fields at :308-312.
4. The refusal code remains a trust boundary: recognized refusal instances supply their code (claude-sdk-lane-runner.ts:363-368), and preparation uses the typed admission port's result.code (claude-cli.adapter.ts:393-395, :443-444). These are existing trusted internal contracts, not runtime sanitizers for forged refusal instances or malformed port results. Within those contracts, no additional caller-input string path was identified. Arbitrary prototype spoofing and invalid internal port implementations are not certified safe by this review.

## Five logic questions

1. **Silent failure?** Neither corrected name accessor produces an unchecked diagnostic value (:441-446). M1 instead skips the warning before :287 of the adapter.
2. **Unexpected user action?** A named launch whose dependency rejects with a hostile proxy encounters M1; no ordinary user action alone is shown to construct that shape (adapter :279-292).
3. **Wrong answer from input?** Switching names now classify the captured first value; unknown names return other (runner :441-446; spec :835-841).
4. **Dependency failure?** Throwing name accessors normalize correctly, but throwing prototype traps still replace the refusal (runner :433-444; adapter :285).
5. **Missing requirement or coverage?** Proxy coverage remains absent from the revised assertion block (spec :830-850), despite r2 explicitly naming prototype operations. Tests were inspected, not executed.

## Decisions

- Keep the two concrete accessor findings closed while retaining the narrower prototype failure. Options: approve only ordinary Error accessors, or retain the remaining r2 non-throwing requirement. Chosen: retain it, based on r2's explicit proxy instruction and the unguarded instanceof operations. Reversible by broadening the guards and adding regression evidence.
- Score 7/10: the confidentiality defect in name classification is repaired and both requested tests match it, separating this from the prior 6/10. The remaining malformed-error escape and lack of executed behavior evidence prevent an exemplary score. Recommendation: revise the remaining guard before claiming all r2 boundary failures closed.

