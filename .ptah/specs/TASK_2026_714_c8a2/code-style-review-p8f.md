# Code Style Review (P8 fix round) — `TASK_2026_714_c8a2`

Scope: `git diff 020ec6fd8~1..c16226865`, non-spec source. Read in full: `codex-session-binding.ts`, `codex-legacy-session-settings.ts`, `codex-executable-pin.ts`, `codex-executable-pin-data.ts`, the ipc-bridge/agent-sdk/rpc-handlers index diffs, and `bindElectronCodexChat` (lines 596-650). Read only in part: the rest of `codex-runtime-composition.ts`, `codex-chat-turn-stream.ts` (header), `codex-chat-adapter.ts` (line count only). No checks were run.

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 8/10     |
| Assessment      | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 0        |
| Minor issues    | 5        |
| Files reviewed  | ~16 non-spec |

## Prior findings

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 adapter size | FIXED | `codex-chat-adapter.ts` is 678 lines, down from 823. Turn handling moved to `codex-chat-turn-stream.ts` (200 lines). Both are under the `max-lines` 700 limit at `eslint.config.mjs:563`, which also skips blanks and comments. |
| S2 `bindElectronCodexChat` size and post-handoff mutation | FIXED | The function is now about 40 lines of wiring (`codex-runtime-composition.ts:604-650`) over named helpers. The lifecycle is composed once by `createElectronCodexSessionLifecycle` (`codex-session-binding.ts:113-138`) and passed to the adapter ports, so no object is mutated after it is captured. The legacy-settings reader moved to `rpc-handlers` (`codex-legacy-session-settings.ts:21`), as recommended. The composition file is 650 lines, still large but under the limit. |
| S3 ipc-bridge duck-typing | FIXED | `ipc-bridge.ts` resolves `Pick<CodexChatHostPorts, 'handlePermissionResponse'> \| null` and calls it through optional chaining. A method rename now fails at compile time. The `resolve<T>` generic is still an assertion at the container boundary, which is the repository norm. |
| S4 barrel exports | PARTIAL (deferral not accepted as written) | The barrel was narrowed: error classes and many types were removed from `agent-sdk/src/index.ts`. `CodexChatAdapter` and `registerCodexChatServices` are still exported (`index.ts:142-147,~160`), and the only consumer is `codex-runtime-composition.spec.ts:26-27,377,458`. The new comments say "hosts must override only nullable port tokens", which is not a consumer for the barrel. See M1. |
| S5 pin data | FIXED | `require()` of the manifest is gone. `codex-executable-pin-data.ts` carries only the six portable fields. `codex-executable-pin.spec.ts:7-21` asserts they equal the manifest projection, which guards the drift. Zod validation is now lazy (`codex-executable-pin.ts:~14`). |
| Minor: `console.warn` in ipc-bridge | DEFERRED, accepted | The bridge has no injected Logger (`batches.md` "Batch 8f deferred"). The change adds no new `console` calls. |
| Minor: process-global binding registry | DEFERRED, accepted | The reason is boot refs and the quit paths, as recorded. |
| Minor: `tabId` falls back to the session id | DEFERRED, accepted | `codex-session-binding.ts:~40` keeps `tabs.get(id) ?? lifecycle().find(id)?.tabId ?? id`. Fixing it needs library contract changes, so a later task is reasonable. |
| Minor: `UUID_REGEX` accepts v4 and v7 for every consumer, unrelated reformatting, `readFileSync` helper inlined | Not touched in this diff. Carried forward unchanged. |

## New findings

No blocking and no serious issues.

### Minor

- M1. `libs/backend/agent-sdk/src/index.ts:142-147,~160`: the barrel exports `registerCodexChatServices` and the concrete `CodexChatAdapter`, whose only importer is a spec. The added comments justify this with a spec, which makes the public API test-driven. Either construct the adapter in the spec through the container token (`SDK_TOKENS.CODEX_CHAT_ADAPTER`) or mark the exports `@internal` for tests.
- M2. `apps/ptah-electron/src/di/codex-session-binding.ts:19-22`: a type-level import cycle with `codex-runtime-composition.ts`, which imports this file's functions. It is type-only, so there is no runtime cycle. Moving `ElectronCodexBindingInput` and `createElectronCodexIdentityLookup`'s result type to the binding file or a small types file would remove it. The same file uses `ReturnType<typeof createX>` aliases (`:22-23,38,~42`) in place of exported interfaces, so the state shape is implicit.
- M3. `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-legacy-session-settings.ts:~47-57`: the effort check repeats the allowed literal list by hand after a Zod parse, so it is duplicated and can drift from the schema. Parse with a Zod enum for the effort values instead. The `throw new Error(...)` calls carry no typed error code, while the sibling `CodexSessionSettingsError` does.
- M4. `libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts:4`: the pin is hard-coded for `win32`/`x64` only. `findCodexExecutablePin` returns `undefined` on every other platform. That matches the Electron-first scope, but the file name and the comment do not say it is single-platform data. Adding a short note would help.
- M5. `codex-runtime-composition.ts` (650 lines) and `codex-session-binding.ts`: the helpers `createElectronCodexBindingContext` and `BindingContext` are internal but in the same file as the exported helpers. A reader cannot tell from the file which are public. Not urgent.

## Checks across the diff

| Rule | Status | Evidence |
| --- | --- | --- |
| Public `@ptah-extension/*` aliases only, no deep relative cross-lib imports | PASS | All new imports in `codex-session-binding.ts`, `codex-legacy-session-settings.ts` and `ipc-bridge.ts` use the aliases. |
| No `vscode`/`electron` import in host-neutral libs | PASS | The new lib files (`codex-chat-turn-stream.ts`, `codex-legacy-session-settings.ts`, pin files) import only workspace libs and `zod`. `electron` stays in `apps/ptah-electron`. |
| `rpc-handlers` dependencies for the new file | PASS | `settings-core`, `auth-providers` and `platform-core` are already imported by sibling codex-host files (`codex-session-settings-record.ts`). |
| DI registration | PASS | Registration remains in `registerElectronCodexBinding` with `SDK_TOKENS`. No new tokens. |
| No added `any`, `as unknown as`, `@ts-ignore`, `eslint-disable` | PASS | A scan of the added non-spec lines found none. |
| No new `console` calls, logging via injected Logger | PASS | `Logger` resolved from `TOKENS.LOGGER` (`codex-runtime-composition.ts:609`) and passed down. |
| File size under 700 lines | PASS | 678, 650, 391, 200, 139, 80. |
| Naming (kebab-case, role suffix) | PASS | `codex-session-binding.ts`, `codex-chat-turn-stream.ts`, `codex-legacy-session-settings.ts`. |

## Five style questions (short)

1. Six months out: the pin data file must be updated by hand when the Codex binary is bumped. The spec catches drift (`codex-executable-pin.spec.ts:7`), so the failure is loud.
2. A new reader may misread `Pick<CodexChatHostPorts, ...>` as the registered type; it is a narrowed view of the same token.
3. Maintenance: the composition remains the heaviest unit, but each helper now has one purpose.
4. Consistency: the legacy settings reader now sits beside the sibling port factories, as the repository does elsewhere.
5. Different: keep the adapter class off the barrel (M1) and give the settings reader typed errors (M3).

## Verdict

- Recommendation: APPROVE
- Score: 8/10
- Confidence: MEDIUM (large files read only in part)
- Key concern: the barrel still exports test-only symbols (M1).
- Maintenance debt: the five original serious findings are retired (four fixed, one partial). Net direction is down.
