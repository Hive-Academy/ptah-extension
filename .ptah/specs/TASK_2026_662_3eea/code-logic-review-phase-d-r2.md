# Code Logic Review — Phase D B1 fix (round 2)

Review family: Claude (reviewer) vs codex (implementer)

## Summary

| Metric          | Value                 |
| --------------- | --------------------- |
| Overall score   | 9/10                  |
| Assessment      | APPROVED              |
| Blocking issues | 0                     |
| Serious issues  | 0                     |
| Minor notes     | 3                     |

Scope: the uncommitted diff (6 files), `skill-enhancer.service.ts`, `skill-judge.service.ts`, and a repo grep for other callers. Not re-run: tests (read-only brief; orchestrator reported green).

## 1. Preview path reaches the judge enabled at 6.0: YES

- Handler passes `MANUAL_PREVIEW_JUDGE_SETTINGS` (`skills-synthesis-rpc.handlers.ts` previewEnhancement block, diff hunk at ~337) to `enhancer.generateProposal`.
- `generateProposal` forwards `settings` unchanged to `this.judge.judge(...)` (`skill-enhancer.service.ts:379-386`).
- `judge` gate `if (!settings.judgeEnabled)` (`skill-judge.service.ts:178`) now sees `true`, so it proceeds to `laneRunner.run({ laneId: 'judge' ... })` (line 184) and no longer returns `disabled`.
- Threshold `decision.score >= settings.minJudgeScore` (`skill-enhancer.service.ts:411-414`) uses 6.0. Manual semantics (`:415-417`) refuse only an explicit low score, as designed.
- The constant is `{ judgeEnabled: true, minJudgeScore: 6.0 }` (`skill-judge.service.ts:55-58`), matching the shipped defaults cited in O43. It is exported through `index.ts` and imported by the handler, so there is no cast and no duplicated literal.

## 2. Narrowing to `JudgeGateSettings` is safe: YES

- Within `skill-enhancer.service.ts`, `settings` is read at only three sites: pass-through to `judge` (`:382`), `.minJudgeScore` (`:414`), and pass-through to `generateProposal` from `enhance` (`:558`). `isEligible` ignores its argument (`:276`). There is no spread and no other field read.
- Within `skill-judge.service.ts`, `settings` is read only at `:178` (`judgeEnabled`). `judgeModel` and `judgeProvider` are not read, so O43's wider constant (with `judgeModel: 'inherit'`) would have carried unused fields. The narrower type is the better fix, and the deviation from the O43 wording is benign.
- Callers: a repo-wide grep finds `generateProposal` / `enhance` / `judge` callers only in the handler and the enhancer and judge specs. The specs pass a full `SkillSynthesisSettings` (`makeSettings`, enhancer spec `:33-47`), which is structurally assignable to the `Pick`. Widening a parameter is source-compatible. No host or mcp-bench caller exists. The orchestrator's typecheck is green, consistent with this.

## 3. Tests pin the right behaviour: YES

- Handler spec (`skills-synthesis-rpc.handlers.spec.ts:1651-1654`) now asserts `{ judgeEnabled: true, minJudgeScore: 6 }`. The old literal would have passed the buggy code, so this closes the original gap.
- New judge spec (`skill-judge.service.spec.ts:149-161`) calls the real `judge` with the exported constant and asserts `query.calls` has length 1 and status `scored`. This directly guards against the `disabled` short-circuit. It also fails if someone weakens the constant.

## 4. M2 (user's `judgeEnabled` loss unrecorded): functionally resolved, not recorded

The code comment (`skill-judge.service.ts:52-53`) says the keys are retired, but `decisions.md` has no entry stating that a user's `judgeEnabled=false` no longer disables the preview judge. O38(b) covers only `minJudgeScore`, and O43 records the bug, not the behavioural change. Not a defect, since forcing the judge on for a user-initiated preview is a sound default. Record it as a decision for audit.

## Minor notes

- m1. Add an O44 line to `decisions.md`: "manual preview always runs the judge at the shipped defaults; retired `judgeEnabled` and `minJudgeScore` user values are ignored. Reversible: yes."
- m2. The handler spec asserts a literal rather than the constant, which is fine as an independent pin. The judge spec and the handler spec cannot drift apart silently, because the judge spec imports the constant and the handler spec hard-codes the values.
- m3. `isEligible`'s unused `_settings` parameter was retyped for no behavioural reason. Harmless.

## Verdict

- Recommendation: APPROVE (B1 resolved)
- Confidence: HIGH (a closed set of settings reads, verified by grep)
- Top risk: none on the fix. The only residual item is the missing decision record (m1).
