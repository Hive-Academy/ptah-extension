# Code Logic Review, TASK_2026_857_f660 Phase B fix round 3 (round 4 review)

Review family: reviewer claude, implementer codex.

Verdict: APPROVED, 8/10. No Critical or Serious findings. Two Moderate and two Minor findings.

Scope read: full `git diff HEAD` for platform-core file-settings-manager (+spec), the three workspace providers, `IWorkspaceProvider`, `HostRoutingSetting`, `NextTurnReminderQueue`, `UserPromptSubmitHookHandler`, `HostRoutingCoordinator`, and the deleted `host-routing-config-tracker.ts`. I did not run tests, per instructions.

## Criteria

1. Stale results discarded on any routing write: MET.
   - The counter bumps synchronously in `set()` before the persist, for both keys (`file-settings-manager.ts:155`). It bumps again on failed-persist restore (`:176`) and on a cross-process reload that changes either key (`:524`).
   - `set()` is the only writer of `settings[key]` after construction. `loadSync` runs only in the constructor.
   - `decisionModel` is in `FILE_BASED_OBJECT_SETTINGS_KEYS`, so `flattenObject` keeps it as one key and the cross-process `changedKeys` match works (`file-settings-keys.ts:307`).
   - `applyAssessment` (`host-routing.coordinator.ts` ~277-285) and `settlePreflight` (~434-443) compare the admission-time generation before any mutation. The scope-check path runs `syncConfig`, the epoch check and the generation check first, then the generation-superseded and enabled checks.
   - Off->on and A->B->A are covered because the counter never decreases. Writes that fire no event, failed-persist restores and settings-store writes are covered because all go through `fileSettings.set`.
   - The coordinator spec and the file-settings spec cover these cases (`file-settings-manager.spec.ts` new test).
2. A request admitted after the latest write survives a late event: MET.
   - Admission calls `syncConfig()` and then reads the generation with no await between (coordinator ~196-197).
   - A late event calls `syncConfig()`. It finds `previous === live` and does nothing (~`onSettingChanged`/`syncConfig`).
   - This removes the old tracker's "unannounced" counter heuristic, which was the source of the residual in F1. The generation is a monotonic stamp, so it is simpler and correct.
3. Reminder injected only if no routing write since it was produced: MET.
   - Both `put` sites pass `configGeneration`: the reminder in `settlePreflight` and the nudge in `actOnRevision`.
   - The gate requires `generation !== undefined`, `isEnabled()` and `generation === live` (coordinator ~168-174).
   - The hook checks at drain (`takeEntry` -> `allows`). It checks again after the awaited pointer and before returning `additionalContext` (`user-prompt-submit-hook-handler.ts:112-118`, `stillAllowed` at `:179-186`). There is no await between the final check and the return.
   - Other owners are untagged or have no gate (`allows` returns true). The pointer is independent.
4. D4 `switchChanged` removed: MET.
   - A grep of libs and apps finds no remaining `switchChanged`, `HostRoutingSettingChange` or `HostRoutingConfigTracker`.
   - The `lane-routing` index export is trimmed. The only listener is the coordinator's `onDidChange(() => ...)`, whose signature is compatible.

## Findings

1. Moderate. Silent loss of write detection when the provider lacks the optional method.
   - Location: `host-routing-setting.ts:35-37` (`getRoutingConfigurationGeneration?.() ?? 0`) and `workspace-provider.interface.ts:40-41` (optional member).
   - On such a host the generation is a constant 0, so every discard guard is a no-op. That is a regression versus the old value-stamp tracker, which worked without host support. It has no `degradation-audit` comment and no log.
   - Impact today is bounded. Host routing is registered Electron-only, and the Electron, VS Code and CLI providers all implement the method.
   - Smallest fix, either of:
     - Make the method required on `IWorkspaceProvider`. This forces any mock to implement it; the mocks I could see do not break because the member is optional today.
     - Keep it optional, and add a `// degradation-audit:` comment plus a one-time `logger.warn` at construction when it is missing.
2. Moderate. The generation is a single counter shared by both routing keys, and a same-value `set()` also bumps it.
   - Location: `file-settings-manager.ts:155`.
   - Re-saving the same value resets all tabs and drops queued reminders. This is bounded: only two keys bump it, and the UI writes these keys rarely. It also matches the old behaviour where a change event reset everything. Accepted as written; I note it for the record.
3. Minor. Cross-process reload during an in-flight local write.
   - Location: `file-settings-manager.ts:521-525`.
   - The in-memory value differs from the disk value, so this produces one extra bump and one event. It is harmless and bounded.
4. Minor. No test seen for the hook's second `allows` check on a generation bump during the pointer await.
   - Location: `user-prompt-submit-hook-handler.spec.ts` (+71 lines).
   - I did not trace each added case; the hook logic itself is correct.

## Other hunts

- Races in the hook path: the drain is synchronous. The post-await re-check is the last step. The drained entry is consumed even if withheld, which is the intended single-use behaviour.
- Silent failures: none new. The failed-persist path still rejects. Hook errors keep their `degradation-audit` comments.
- Prompt or scope text in logs: none added in this diff.
- DI guard: no new tokens or injects. `HostRoutingSetting` is still resolved at `apps/ptah-electron/src/di/expected-resolvable.ts:41`. The coordinator's `Pick<>` type now includes `getConfigurationGeneration`, which the real class provides.
- VS Code native configuration path: `vscode-workspace-provider.ts:84-105` routes `ptah.*` file-based keys to `fileSettings`, so the generation does change on its writes. The same holds for the CLI provider (`cli-workspace-provider.ts:93-114`).
