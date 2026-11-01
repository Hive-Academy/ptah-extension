# Batch B5 bounded correction review

Review family: reviewer codex, implementer claude

Score: 9/10

Verdict: APPROVED

## Findings

1. **N1 fixed** — `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:1992-1996,2481-2484`: the sole `resetDraft()` caller is the `open() === false` effect. `resetDraft()` now clears `_credentialModeSwitch` before setting `_step` to `provider`. Thus the gate is false when the Credential step's inner panel is removed on reset. `leaveCredentialModePanel` (`:1630-1635`) completes that inner leave immediately when the gate is false, leaving only the outer Credential panel's `leaveSensitivePanel` animation (`:640-653`). The close and discard handlers (`:2438-2462`) emit `closed`; the parent then changes `open`, which reaches this reset effect.
2. **No local behavior regression found** — `provider-setup-wizard.component.ts:1575-1577,2030-2048,2070-2075,2210-2213`: a genuine Credential mode toggle still sets the gate true, so `credentialModeEnterClass` supplies `ptah-motion-enter`, the inner leave animates, and the focus effect targets the opposite toggle. On reset, the gate becomes false and the focus effect is skipped while `open()` is false; on a later open it falls back to the step heading. `goToStep` retains its earlier gate clear before a changed `_step`, so ordinary step navigation behaves as before. A subsequent mode toggle can set the gate true again.
3. **Regression test recommended** — `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts:245-267,280-342,1294-1341`: existing cases cover mode switching, step navigation after a switch, and close/discard separately, but not close after a switch. Add a case that selects `kimi-code`, enters Credential, clicks `wizard-use-api-key`, confirms `credentialModeSwitch()` is true, captures the current inner panel, sets the `open` input false and runs change detection. Assert the gate is false and the step is `provider`; call `leaveCredentialModePanel` with the captured panel and a completion spy, then assert completion occurs once and the panel does not acquire `ptah-motion-leave`. Reopen and assert `credentialModeEnterClass()` is empty. This directly guards the corrected reset path without changing production code.

## Check result

Source trace: pass for the bounded N1 correction. The only permitted check, `npm run verify -- -p @ptah-extension/chat -- --testPathPatterns=provider-setup-wizard`, exited 1 after obtaining the machine-wide slot. Its filtered summary reports 3 Nx tasks, 1 succeeded and 2 failed (`@ptah-extension/chat:lint` and `@ptah-extension/chat:typecheck`); failure details were not included, so their cause is undetermined. The Ptah symbol index had no usable hits; I used PowerShell `Select-String` and `Get-Content` for the source trace after `rg.exe` was denied access. Skill discovery found no invocable `angular-frontend-patterns` skill. No rendered UI was inspected; visual behavior remains outside this source and spec review.
