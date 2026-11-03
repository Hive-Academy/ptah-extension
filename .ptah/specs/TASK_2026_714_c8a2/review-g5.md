# Review G5

Verdict: REVISE
Score: 5/10
Review family: codex (implementer: kimi-code)

## Specs checked

| Spec | Exercises production path? | Fails on wrong level? | Note |
| --- | --- | --- | --- |
| Auto-edit (`codex-runtime.spec.ts:760`) | No, for host restore; yes, for `CodexRuntime.open`/`RuntimeContext.open` | Yes if the reopened context becomes Ask: `turnPermissionLevel` at 763/765 and approval `accept` at 783-785 | The helper passes Auto-edit to the reopened profile itself. The wire policy assertion cannot distinguish Auto-edit from Ask. |
| Ask (`codex-runtime.spec.ts:790`) | No, for host restore; yes, for runtime resume | Yes if the reopened context becomes Auto-edit or Plan: `turnPermissionLevel` at 792/794 and sink call at 810; no if a lost level defaults to Ask | The initial profile is Auto-edit, but the resumed profile is constructed as Ask by the helper. |
| Plan (`codex-runtime.spec.ts:819`) | No, for host restore; yes, for runtime resume | Yes if the reopened context becomes Ask: `turnPermissionLevel` at 821/823 and `on-request`/`readOnly` at 829-830 | The helper passes Plan and the saved fingerprint directly. The decline assertion alone also passes under Ask. |

## Defects

1. **High — The helper supplies the result it intends to verify** (`libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:341-343`). `profileAtLevel(permissionLevel, identity.profileFingerprint)` inserts the desired level and copies the persisted fingerprint before calling `runtime.open`. In production, `codex-chat-host-ports.ts:293-314,372-387,413-427` reads the resume identity, chooses the level from the resume config or saved workspace setting, and builds a profile whose fingerprint is computed from that level (`codex-execution-profile.ts:291-324`). `chat-session.service.ts:1886-1906` supplies no session permission level on a normal resume. If the host restores Ask after Auto-edit or Plan was saved, production gets an Ask profile and a fingerprint mismatch/refusal at `codex-runtime.ts:51-55`; these specs still pass because the helper supplies Auto-edit or Plan and the matching fingerprint. Exercise the host profile path or a host-facing fixture that reads the saved setting and recomputes the fingerprint.
2. **Medium — The save-to-resume handoff remains in memory** (`libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:329-343`). The helper captures `context.identity` directly, while `store.persist` is a no-op mock and the reopened runtime never reads `store.read`. `expect(persist).toHaveBeenCalledWith(identity)` at line 762 proves a call occurred, but does not prove a stored identity was available to the host's `readResumeIdentity` path. A broken host identity lookup or absent persisted record would leave all three specs green. Use a stateful identity store and drive the same host read used by resume if the claim is save → close → resume persistence.

## Notes

- Within the supplied low-level runtime call, the specs do exercise `RuntimeContext` initialization, `updateNextTurn` persistence, `turn/start` policy, and the real approval bridge. The plain file-change fixture has the allowed fields, and the Ask/Auto-edit policy difference is asserted through the sink and response rather than wire policy alone.
- Static inspection found no added strict TypeScript error, invalid fixture field, `any`, `as unknown as`, suppression, private bracket access, or readonly assignment. The approval interaction disposes its real timer after the sink resolves; two `setImmediate` flushes allow the response to be written. Jest, typecheck, lint, diagnostics, and builds were prohibited and were not run, so execution remains unverified.
- Skill discovery was available, but it found no invocable local code-review skill; the marketplace matches were marked non-invocable. `rg` was access-denied, so source text was searched with PowerShell.
